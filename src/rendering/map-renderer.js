import * as THREE from 'three';
import { createMapMaterials } from './map-materials.js';
import { createMapMeshes } from './map-meshes.js';
import { createMapControls } from './map-controls.js';
import { createAmbientLoop } from './ambient-motion.js';
import { createPartyToken } from './party-token.js';
import { createPartyPiece } from './party-piece.js';
import { PARTY_STYLES } from '../application/party-token.js';
import { createPartyKeyHints } from './party-key-hints.js';
import { createDaylight } from './daylight.js';
import { createFeatureLighting } from './feature-lighting.js';
import { DAYLIGHT } from '../application/time-of-day.js';
import { mapArtStyle } from '../application/map-art-style.js';

export function createMapRenderer(
  host,
  {
    onSelect = () => {},
    onHover = () => {},
    onPartyMove,
    onPartySelect,
    motion = true,
    touchMultiSelect = false,
    navigation = true,
    background = null,
    transparent = false,
    groundShadow = true,
    artStyle = 'low-poly',
  } = {},
) {
  artStyle = mapArtStyle(artStyle);
  const loading = host.querySelector('#hp-loading');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: transparent,
      powerPreference: 'default',
    });
  } catch (error) {
    if (loading) loading.textContent = 'This preview needs WebGL support.';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  // Snapshots can precede the first frame, which normally installs the clear alpha.
  if (transparent) renderer.setClearAlpha(0);
  host.append(renderer.domElement);
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute(
    'aria-label',
    'Interactive isometric hex map. Arrow keys jump two hexes; + and − zoom. Select a hex or the party with the map dropdown. With the party selected, Q W E and A S D move it to adjacent hexes. Drag to pan or move the party; scroll, pinch, or double-tap and slide to zoom.',
  );
  const scene = new THREE.Scene();
  const daylight = createDaylight(scene);
  // The sun and its shadow camera are fixed while the view pans/zooms.
  daylight.sun.shadow.autoUpdate = false;
  let shadowTime = NaN,
    frame = 0,
    needsRender = true,
    disposed = false;
  const featureLighting = createFeatureLighting(scene);
  let dayMode = 'day';
  const shadowFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.ShadowMaterial({ opacity: 0.17 }),
  );
  shadowFloor.rotation.x = -Math.PI / 2;
  // Tile bases end at y=0; a lower catcher makes their shadows appear detached.
  shadowFloor.position.y = -0.001;
  shadowFloor.receiveShadow = true;
  shadowFloor.visible = groundShadow;
  scene.add(shadowFloor);
  const palette = createMapMaterials();
  let backgroundColor = background;
  function updateBackground() {
    scene.background = transparent
      ? null
      : new THREE.Color(backgroundColor ?? palette.background());
  }
  const meshes = createMapMeshes(palette, { artStyle });
  scene.add(meshes.group);
  const party = onPartyMove
    ? createPartyToken({ host, draw, onMove: onPartyMove, onSelect: onPartySelect, artStyle })
    : null;
  const keyHints = onPartyMove ? createPartyKeyHints(host) : null;
  let partyKey,
    showPartyKeys = false;
  let previewPiece;
  const controls = createMapControls({
    host,
    renderer,
    scene,
    map: meshes.group,
    cells: meshes.cells,
    materials: palette.materials,
    draw,
    requestHover: queueFrame,
    onSelect,
    touchMultiSelect,
    navigation,
    onHover,
    party,
  });
  // Input, token animation and ambient motion may all request the same frame.
  function draw() {
    needsRender = true;
    queueFrame();
  }
  function queueFrame() {
    if (!frame && !disposed) frame = requestAnimationFrame(renderNow);
  }
  function renderNow() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (disposed) return;
    // Pick the latest pointer position before painting, without a second RAF.
    const hoverChanged = controls.updateHover();
    if (!needsRender && !hoverChanged) return;
    needsRender = false;
    if (shadowTime !== palette.ambientTime.value) {
      daylight.sun.shadow.needsUpdate = true;
      shadowTime = palette.ambientTime.value;
    }
    renderer.domElement.dataset.zoom = String(controls.camera.zoom);
    featureLighting.update(palette.ambientTime.value, controls.camera);
    renderer.clear();
    renderer.render(scene, controls.camera);
    party?.render(renderer, controls.camera);
    keyHints?.render(controls.camera);
  }
  const ambientLoop = createAmbientLoop({
    renderer,
    ambientTime: palette.ambientTime,
    draw,
    motion,
  });
  if (loading) loading.hidden = true;
  return {
    setMotion: ambientLoop.setMotion,
    setBackground(value) {
      backgroundColor = value;
      updateBackground();
      draw();
    },
    setFrameInsets: controls.setFrameInsets,
    setTimeOfDay(value) {
      dayMode = daylight.setMode(value);
      palette.setTimeOfDay(dayMode);
      featureLighting.setMode(dayMode);
      party?.setTimeOfDay(dayMode);
      shadowFloor.material.opacity = DAYLIGHT[dayMode].shadowOpacity;
      updateBackground();
      renderer.domElement.dataset.timeOfDay = dayMode;
      draw();
      return dayMode;
    },
    setMap(layout, options) {
      const previousStyle = artStyle;
      artStyle = mapArtStyle(options?.artStyle ?? artStyle);
      previewPiece?.group.removeFromParent();
      previewPiece?.dispose();
      previewPiece = null;
      if (options?.resetView) party?.deselect();
      meshes.setMap(layout, { artStyle });
      if (previousStyle === 'pixelart' && artStyle !== previousStyle)
        palette.releasePixelMaterials();
      party?.setArtStyle(artStyle);
      renderer.domElement.dataset.artStyle = artStyle;
      daylight.sun.shadow.needsUpdate = true;
      featureLighting.setSources(meshes.lightSources, layout, { artStyle });
      controls.refresh(options);
    },
    cancelInteraction: controls.cancelInteraction,
    select: controls.select,
    focus: controls.focus,
    setSelection: controls.setSelection,
    setParty(token, seeds) {
      partyKey = token.key;
      keyHints?.set(partyKey, meshes.cells, showPartyKeys);
      party?.set(token, meshes.cells, seeds);
    },
    setPartyKeys(visible) {
      if (showPartyKeys === visible) return;
      showPartyKeys = visible;
      keyHints?.set(partyKey, meshes.cells, visible);
      draw();
    },
    isInteracting: controls.isInteracting,
    setPartySelected: (selected) => party?.setSelected(selected),
    setPartyPiece(style, color, styleOfArt = 'low-poly') {
      const previousStyle = artStyle;
      artStyle = mapArtStyle(styleOfArt);
      previewPiece?.group.removeFromParent();
      previewPiece?.dispose();
      meshes.setMap([], { artStyle });
      if (previousStyle === 'pixelart' && artStyle !== previousStyle)
        palette.releasePixelMaterials();
      featureLighting.setSources([], [], { artStyle });
      previewPiece = createPartyPiece(PARTY_STYLES.indexOf(style), color, artStyle);
      meshes.group.add(previewPiece.group);
      daylight.sun.shadow.needsUpdate = true;
      controls.refresh({ resetView: true, fitContent: true });
    },
    zoom: controls.zoom,
    pan: controls.pan,
    snapshot() {
      needsRender = true;
      renderNow();
      return renderer.domElement.toDataURL('image/png');
    },
    setPalette(seeds) {
      palette.setPalette(seeds);
      updateBackground();
      draw();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      ambientLoop.dispose();
      party?.dispose();
      keyHints?.dispose();
      previewPiece?.group.removeFromParent();
      previewPiece?.dispose();
      controls.dispose();
      meshes.dispose();
      featureLighting.dispose();
      daylight.dispose();
      palette.dispose();
      shadowFloor.geometry.dispose();
      shadowFloor.material.dispose();
      scene.clear();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
