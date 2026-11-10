// @ts-check
import * as THREE from 'three';
import { createMapMaterials } from './map-materials.js';
import { createMapMeshes } from './map-meshes.js';
import { createMapBuilds } from './map-builds.js';
import { createMapPicker } from './map-picking.js';
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

/**
 * Coordinate scene resources and an interchangeable map-build lifetime owner.
 * @param {HTMLElement} host
 * @param {import('./map-renderer-types.js').RendererOptions} [options]
 */
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
    createBuilds = createMapBuilds,
  } = {},
) {
  artStyle = mapArtStyle(artStyle);
  const loading = /** @type {HTMLElement | null} */ (host.querySelector('#hp-loading'));
  const hasLoadingBackdrop = Boolean(loading?.querySelector('.hp-map-skeleton'));
  /** @type {THREE.WebGLRenderer} */
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
  /** @type {keyof typeof DAYLIGHT} */
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
  // The mesh group holds only build records; the stage also frames previews.
  const stage = new THREE.Group();
  stage.add(meshes.group);
  scene.add(stage);
  /** @type {import('./map-renderer-types.js').MapBuilds} */
  let builds;
  /** @type {Pick<import('./incremental-map-builds.js').BuildContext, 'build' | 'show' | 'release'>} */
  const buildOptions = {
    build(layout, style, context = layout) {
      const map = meshes.build(layout, { artStyle: style });
      const lighting = featureLighting.build(map.lightSources, context, { artStyle: style });
      return { map, lighting, picker: null };
    },
    show(record) {
      meshes.show(record?.map ?? null);
      featureLighting.show(record?.lighting ?? null);
    },
    release(record) {
      meshes.release(record.map);
      featureLighting.release(record.lighting);
    },
  };
  // The picker derives from the shown record and is kept with it.
  /** @returns {import('./map-renderer-types.js').Picker} */
  function picker() {
    const record = builds?.active();
    return record ? (record.picker ??= createMapPicker([record.map.root])) : createMapPicker([]);
  }
  const party = onPartyMove
    ? createPartyToken({ host, draw, onMove: onPartyMove, onSelect: onPartySelect, artStyle })
    : null;
  const keyHints = onPartyMove ? createPartyKeyHints(host) : null;
  /** @type {string | undefined} */
  let partyKey;
  let showPartyKeys = false;
  /** @type {ReturnType<typeof createPartyPiece> | null | undefined} */
  let previewPiece;
  const controls = createMapControls({
    host,
    renderer,
    scene,
    map: stage,
    cells: meshes.cells,
    picker,
    materials: palette.materials,
    draw,
    requestHover: queueFrame,
    onSelect,
    touchMultiSelect,
    navigation,
    onHover,
    party,
  });
  builds = createBuilds({
    ...buildOptions,
    renderer,
    scene,
    camera: controls.camera,
    featureLighting,
    draw,
    onCommit() {
      daylight.sun.shadow.needsUpdate = true;
      controls.refreshPicking();
      draw();
    },
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
    if (builds.tick?.(performance.now())) {
      needsRender = true;
      daylight.sun.shadow.needsUpdate = true;
    }
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
    shadowFloor.material.depthWrite = !builds.animating?.();
    renderer.clear();
    renderer.render(scene, controls.camera);
    party?.render(renderer, controls.camera);
    keyHints?.render(controls.camera);
    builds.afterRender?.(performance.now());
    if (
      loading &&
      !host.closest('[data-loading]') &&
      !builds.animating?.() &&
      renderer.domElement.dataset.renderState !== 'building'
    )
      loading.hidden = true;
    if (builds.animating?.()) draw();
  }
  const ambientLoop = createAmbientLoop({
    renderer,
    ambientTime: palette.ambientTime,
    draw,
    motion,
  });
  if (loading && !hasLoadingBackdrop) loading.hidden = true;
  return {
    setMotion: ambientLoop.setMotion,
    /** @param {THREE.ColorRepresentation | null} value */
    setBackground(value) {
      backgroundColor = value;
      updateBackground();
      draw();
    },
    setFrameInsets: controls.setFrameInsets,
    /** @param {string} value */
    setTimeOfDay(value) {
      builds.finishTransitions?.();
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
    /**
     * @param {import('./incremental-map-builds.js').Tile[]} layout
     * @param {import('./map-renderer-types.js').RefreshOptions & {source?: import('./incremental-map-builds.js').Tile[], artStyle?: string}} [options]
     */
    setMap(layout, options) {
      const previousStyle = artStyle;
      artStyle = mapArtStyle(options?.artStyle ?? artStyle);
      previewPiece?.group.removeFromParent();
      previewPiece?.dispose();
      previewPiece = null;
      if (options?.resetView) party?.deselect();
      // A fog projection names its source layout so the source build is kept.
      builds.show(layout, options?.source ?? layout, artStyle);
      if (previousStyle === 'pixelart' && artStyle !== previousStyle)
        palette.releasePixelMaterials();
      party?.setArtStyle(artStyle);
      renderer.domElement.dataset.artStyle = artStyle;
      daylight.sun.shadow.needsUpdate = true;
      controls.refresh(options);
    },
    cancelInteraction: controls.cancelInteraction,
    select: controls.select,
    focus: controls.focus,
    setSelection: controls.setSelection,
    /** @param {import('./map-renderer-types.js').PartyToken} token @param {import('./map-renderer-types.js').PaletteSeeds} seeds */
    setParty(token, seeds) {
      partyKey = token.key;
      keyHints?.set(partyKey, meshes.cells, showPartyKeys);
      party?.set(token, meshes.cells, seeds);
    },
    /** @param {boolean} visible */
    setPartyKeys(visible) {
      if (showPartyKeys === visible) return;
      showPartyKeys = visible;
      keyHints?.set(partyKey, meshes.cells, visible);
      draw();
    },
    isInteracting: controls.isInteracting,
    /** @param {boolean} selected */
    setPartySelected: (selected) => party?.setSelected(selected),
    /** @param {string} style @param {string} color @param {string} [styleOfArt] */
    setPartyPiece(style, color, styleOfArt = 'low-poly') {
      const previousStyle = artStyle;
      artStyle = mapArtStyle(styleOfArt);
      previewPiece?.group.removeFromParent();
      previewPiece?.dispose();
      builds.clear();
      if (previousStyle === 'pixelart' && artStyle !== previousStyle)
        palette.releasePixelMaterials();
      previewPiece = createPartyPiece(PARTY_STYLES.indexOf(style), color, artStyle);
      stage.add(previewPiece.group);
      daylight.sun.shadow.needsUpdate = true;
      controls.refresh({ resetView: true, fitContent: true });
    },
    zoom: controls.zoom,
    pan: controls.pan,
    /** Composite the CSS background for campaign exports, without changing the live canvas.
     * @param {{opaque?: boolean}} [options]
     */
    snapshot({ opaque = false } = {}) {
      builds.flush?.();
      needsRender = true;
      renderNow();
      if (!opaque || !transparent) return renderer.domElement.toDataURL('image/png');
      const image = document.createElement('canvas');
      image.width = renderer.domElement.width;
      image.height = renderer.domElement.height;
      const context = image.getContext('2d', { alpha: false });
      if (!context) throw new Error('Unable to create the map snapshot.');
      context.fillStyle = new THREE.Color(backgroundColor ?? palette.background()).getStyle();
      context.fillRect(0, 0, image.width, image.height);
      context.drawImage(renderer.domElement, 0, 0);
      return image.toDataURL('image/png');
    },
    /** @param {import('./map-renderer-types.js').PaletteSeeds} seeds */
    setPalette(seeds) {
      builds.finishTransitions?.();
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
      if (builds.dispose) builds.dispose();
      else builds.clear();
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
