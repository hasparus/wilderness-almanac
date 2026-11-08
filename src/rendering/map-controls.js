import * as THREE from 'three';
import { geometryFrom } from './geometry.js';
import { surfaceHeight } from '../generation/math.js';
import { fitPreviewCamera } from './preview-framing.js';
import { createMapPicker } from './map-picking.js';

export function createMapControls({
  host,
  renderer,
  scene,
  map,
  cells,
  materials,
  draw,
  requestHover = draw,
  onSelect,
  onHover,
  party,
  touchMultiSelect = false,
  navigation = true,
  picker = () => createMapPicker([map]),
}) {
  const listeners = new AbortController();
  const listen = (target, event, handler, options = {}) =>
    target.addEventListener(event, handler, { ...options, signal: listeners.signal });
  const camera = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 180);
  camera.position.set(24, 30, 37);
  camera.lookAt(0, 0.3, 0);
  function ringGeometry(cell) {
    const points = [],
      surface = cell.surface || cell.riverSurface,
      mountain = !!surface,
      n = cell.riverSurface ? 28 : mountain ? 8 : 1;
    const corners =
      cell.riverCorners ||
      cell.corners ||
      Array.from({ length: 6 }, (_, k) => [
        Math.sin((k * Math.PI) / 3),
        Math.cos((k * Math.PI) / 3),
      ]);
    function point(k, t, factor) {
      const a = corners[k],
        b = corners[(k + 1) % 6],
        x = (a[0] + (b[0] - a[0]) * t) * factor,
        z = (a[1] + (b[1] - a[1]) * t) * factor;
      return [x, cell.top + (mountain ? Math.max(0, surfaceHeight(surface, x, z)) : 0) + 0.018, z];
    }
    for (let k = 0; k < 6; k++)
      for (let j = 0; j < n; j++) {
        const a = point(k, j / n, mountain ? 0.966 : 0.932),
          b = point(k, j / n, mountain ? 0.996 : 0.977),
          c = point(k, (j + 1) / n, mountain ? 0.996 : 0.977),
          d = point(k, (j + 1) / n, mountain ? 0.966 : 0.932);
        points.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    return geometryFrom(points);
  }
  const activeRing = new THREE.Mesh(new THREE.BufferGeometry(), materials.line),
    hoverRing = new THREE.Mesh(new THREE.BufferGeometry(), materials.hover);
  scene.add(activeRing, hoverRing);
  hoverRing.visible = false;
  function setRing(ring, cell) {
    ring.geometry.dispose();
    ring.geometry = ringGeometry(cell);
    ring.position.set(cell.g.position.x, 0, cell.g.position.z);
  }
  let selected = null,
    selectionKeys = null,
    hovered = null,
    zoom = 1,
    fitContent = false;
  function showSelection() {
    if (selectionKeys === null) {
      const cell = cells.find((cell) => cell.key === selected);
      activeRing.visible = Boolean(cell);
      if (cell) setRing(activeRing, cell);
      return;
    }
    const points = [];
    const keys = new Set(selectionKeys);
    for (const cell of cells.filter((cell) => keys.has(cell.key))) {
      const geometry = ringGeometry(cell);
      const positions = geometry.attributes.position;
      for (let index = 0; index < positions.count; index++)
        points.push(
          positions.getX(index) + cell.g.position.x,
          positions.getY(index),
          positions.getZ(index) + cell.g.position.z,
        );
      geometry.dispose();
    }
    activeRing.geometry.dispose();
    activeRing.geometry = geometryFrom(points);
    activeRing.position.set(0, 0, 0);
    activeRing.visible = points.length > 0;
  }
  function choose(key, { notify = true, additive = false, fromMap = false } = {}) {
    cancelTap();
    cancelHover();
    lastTap = null;
    const cell = cells.find((cell) => cell.key === key);
    if (!cell) return;
    selected = key;
    hoverRing.visible = false;
    if (selectionKeys === null) showSelection();
    if (notify) onSelect(key, { additive, ...(fromMap ? { fromMap } : {}) });
    draw();
  }
  activeRing.visible = false;
  let frameInsets = { left: 0, right: 0 };
  function setFrameInsets({ left = 0, right = 0 } = {}) {
    frameInsets = {
      left: Number.isFinite(left) ? Math.max(0, left) : 0,
      right: Number.isFinite(right) ? Math.max(0, right) : 0,
    };
    resize();
  }
  function resize() {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const contentWidth = Math.max(1, w - frameInsets.left - frameInsets.right);
    if (fitContent && fitPreviewCamera(camera, map, contentWidth / h)) {
      // Extend the frustum for shadows without changing the fitted map scale.
      const unitsPerPixel = (camera.right - camera.left) / contentWidth;
      camera.left -= frameInsets.left * unitsPerPixel;
      camera.right += frameInsets.right * unitsPerPixel;
      camera.updateProjectionMatrix();
      zoom = 1;
      draw();
      return;
    }
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    let width = 5,
      height = 4;
    for (const cell of cells) {
      const ridgeHeight = cell.surface ? Math.max(...cell.surface.vertices.map((v) => v[1])) : 0;
      const point = new THREE.Vector3(cell.g.position.x, cell.top + ridgeHeight, cell.g.position.z);
      width = Math.max(width, Math.abs(point.dot(right)) + 1.5);
      height = Math.max(height, Math.abs(point.dot(up)) + 1.5);
    }
    const vertical = Math.max(height, width / (w / h)) * 1.06;
    camera.left = (-vertical * w) / h;
    camera.right = (vertical * w) / h;
    camera.top = vertical;
    camera.bottom = -vertical;
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    draw();
  }
  function changeZoom(factor) {
    if (!navigation) return false;
    zoom = Math.min(12, Math.max(0.7, zoom * factor));
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    draw();
  }
  function pan(horizontal, vertical) {
    if (!navigation) return false;
    cancelHover();
    if (pointers.size || partyPointer !== null) return false;
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    right.y = up.y = 0;
    right.normalize();
    up.normalize();
    // Jump two centre-to-centre hex spacings on the ground, independent of zoom.
    const step = 2 * Math.sqrt(3);
    camera.position.addScaledVector(right, horizontal * step).addScaledVector(up, vertical * step);
    camera.updateMatrixWorld();
    hovered = null;
    onHover(null);
    hoverRing.visible = false;
    draw();
    return true;
  }
  function focus(key, { hexesWide } = {}) {
    if (!navigation) return false;
    cancelHover();
    const cell = cells.find((cell) => cell.key === key);
    if (!cell) return false;
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const target = new THREE.Vector3(cell.g.position.x, cell.top, cell.g.position.z);
    const delta = target.sub(camera.position);
    camera.position.addScaledVector(right, delta.dot(right)).addScaledVector(up, delta.dot(up));
    // Find party frames a fixed horizontal span; Inspector pins retain a closer view.
    zoom = Math.min(
      12,
      Math.max(
        0.7,
        hexesWide
          ? (camera.right - camera.left) / (hexesWide * 2)
          : Math.max(zoom, (camera.top - camera.bottom) / 6),
      ),
    );
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    draw();
    return true;
  }
  const raycaster = new THREE.Raycaster(),
    mouse = new THREE.Vector2();
  let pick = picker();
  function hit(x, y) {
    const rect = host.getBoundingClientRect();
    mouse.set(((x - rect.left) / rect.width) * 2 - 1, (-(y - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(mouse, camera);
    const intersection = pick(raycaster);
    if (!intersection) return null;
    const ranges = intersection.object.userData.faceRanges;
    if (!ranges) return intersection.object.userData.key;
    let low = 0,
      high = ranges.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (intersection.faceIndex < ranges[mid].end) high = mid;
      else low = mid + 1;
    }
    return ranges[low].key;
  }
  let pendingHover;
  function cancelHover() {
    pendingHover = undefined;
  }
  function updateHover() {
    if (!pendingHover) return;
    const { x, y } = pendingHover;
    pendingHover = undefined;
    const key = hit(x, y);
    if (key === hovered) return;
    hovered = key;
    onHover(key);
    hoverRing.visible = !!key && !(selectionKeys ?? [selected]).includes(key);
    if (hoverRing.visible)
      setRing(
        hoverRing,
        cells.find((cell) => cell.key === key),
      );
    return true;
  }
  const pointers = new Map();
  let partyPointer = null;
  let longPressTimer,
    longPressed = false,
    gestureMoved = false;
  function cancelLongPress() {
    clearTimeout(longPressTimer);
    longPressTimer = undefined;
  }
  let last = null,
    start = null,
    lastTap = null,
    slideZoom = false,
    slideTapSelected = false,
    pinched = false,
    pinchDistance = 0,
    tapTimer,
    tapAction,
    interactionRevision = 0;
  function cancelTap() {
    clearTimeout(tapTimer);
    tapTimer = tapAction = undefined;
  }
  function flushTap() {
    const action = tapAction;
    cancelTap();
    action?.();
  }
  listen(host, 'pointerdown', (e) => {
    if (!navigation) return;
    if (e.button !== 0) return;
    cancelHover();
    cancelLongPress();
    const secondTap =
      e.pointerType === 'touch' &&
      pointers.size === 0 &&
      partyPointer === null &&
      lastTap &&
      e.timeStamp - lastTap.time <= 300 &&
      Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24;
    const secondTapSelected = secondTap && lastTap.selected;
    const revision = interactionRevision;
    if (secondTap) cancelTap();
    else flushTap();
    if (revision !== interactionRevision || listeners.signal.aborted) return;
    lastTap = null;
    if (partyPointer !== null) {
      party.cancel();
      partyPointer = null;
      return;
    }
    if (!secondTap && pointers.size === 0 && party?.start(e, camera)) {
      partyPointer = e.pointerId;
      start = { x: e.clientX, y: e.clientY, time: e.timeStamp };
      gestureMoved = false;
      host.setPointerCapture(e.pointerId);
      return;
    }
    host.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      last = { x: e.clientX, y: e.clientY };
      start = { ...last, time: e.timeStamp };
      slideZoom = Boolean(secondTap);
      slideTapSelected = Boolean(secondTapSelected);
      pinched = false;
      longPressed = false;
      gestureMoved = false;
      const key =
        touchMultiSelect && e.pointerType === 'touch' && !slideZoom
          ? hit(e.clientX, e.clientY)
          : null;
      const keys = selectionKeys ?? (selected ? [selected] : []);
      if (key && keys.length && !keys.includes(key)) {
        longPressTimer = setTimeout(() => {
          longPressed = true;
          choose(key, { additive: true, fromMap: true });
        }, 550);
      }
    } else {
      pinched = true;
      slideZoom = false;
      const [a, b] = [...pointers.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    }
    hoverRing.visible = false;
    hovered = null;
    onHover(null);
  });
  listen(host, 'pointermove', (e) => {
    if (!navigation) return;
    if (partyPointer === e.pointerId) {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 3) gestureMoved = true;
      party.move(e, camera);
      return;
    }
    if (pointers.has(e.pointerId)) {
      if (longPressed) return;
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 6) {
        gestureMoved = true;
        cancelLongPress();
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance > 0) changeZoom(d / pinchDistance);
        pinchDistance = d;
        return;
      }
      if (last) {
        const dx = e.clientX - last.x,
          dy = e.clientY - last.y;
        if (slideZoom) {
          if (gestureMoved) {
            last = { x: e.clientX, y: e.clientY };
            changeZoom(Math.exp(dy * 0.01));
          }
          return;
        }
        const scale = (camera.right - camera.left) / (host.clientWidth * zoom);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        camera.position.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
        last = { x: e.clientX, y: e.clientY };
        draw();
      }
      return;
    }
    if (e.pointerType === 'mouse' && !pointers.size && partyPointer === null) {
      pendingHover = { x: e.clientX, y: e.clientY };
      requestHover();
    }
  });
  function release(e) {
    if (!navigation) return;
    cancelLongPress();
    if (partyPointer === e.pointerId) {
      partyPointer = null;
      if (
        e.pointerType === 'touch' &&
        !gestureMoved &&
        start &&
        e.timeStamp - start.time <= 300 &&
        Math.hypot(e.clientX - start.x, e.clientY - start.y) < 3
      )
        lastTap = { x: e.clientX, y: e.clientY, time: e.timeStamp };
      start = null;
      party.end(e, hit);
      return;
    }
    const wasLast = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (
      wasLast &&
      !pinched &&
      !longPressed &&
      !gestureMoved &&
      start &&
      Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6
    ) {
      const key = hit(e.clientX, e.clientY);
      const additive = e.ctrlKey || e.metaKey;
      if (e.pointerType === 'touch' && !slideZoom && e.timeStamp - start.time <= 300) {
        const tap = { x: e.clientX, y: e.clientY, time: e.timeStamp };
        if (selectionKeys === null && !additive) {
          // Single selection can happen now; the second press only controls zoom.
          const revision = interactionRevision;
          if (key) choose(key, { additive, fromMap: true });
          if (revision === interactionRevision && !listeners.signal.aborted)
            lastTap = { ...tap, selected: true };
        } else {
          // Wait only for toggles and party destinations, which zoom must not trigger.
          lastTap = tap;
          tapAction = () => {
            if (key) choose(key, { additive, fromMap: true });
          };
          tapTimer = setTimeout(flushTap, 300);
        }
      } else if (key && !slideTapSelected) choose(key, { additive, fromMap: true });
    }
    last = null;
    start = null;
    slideZoom = false;
    slideTapSelected = false;
    if (pointers.size === 1) last = [...pointers.values()][0];
  }
  listen(host, 'pointerup', release);
  listen(host, 'pointercancel', (e) => {
    cancelLongPress();
    cancelTap();
    lastTap = null;
    slideZoom = false;
    slideTapSelected = false;
    if (partyPointer === e.pointerId) {
      partyPointer = null;
      start = null;
      party.cancel();
      return;
    }
    pointers.delete(e.pointerId);
    last = null;
    start = null;
  });
  listen(host, 'contextmenu', (event) => {
    if (longPressTimer !== undefined || longPressed) event.preventDefault();
  });
  listen(host, 'pointerleave', () => {
    cancelHover();
    hovered = null;
    onHover(null);
    hoverRing.visible = false;
    draw();
  });
  if (navigation)
    listen(
      host,
      'wheel',
      (e) => {
        e.preventDefault();
        // Firefox and some mouse drivers report lines/pages rather than pixels.
        const mode = e.deltaMode;
        const unit = mode === 1 ? 16 : mode === 2 ? host.clientHeight : 1;
        changeZoom(Math.exp(-e.deltaY * unit * 0.001));
      },
      { passive: false },
    );
  if (!navigation) {
    let press = null;
    listen(host, 'pointerdown', (event) => {
      if (event.button !== 0) return;
      if (press && press.id !== event.pointerId) {
        press.moved = true;
        return;
      }
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    });
    listen(host, 'pointermove', (event) => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8)
        press.moved = true;
    });
    listen(host, 'pointercancel', () => {
      press = null;
    });
    listen(host, 'click', (event) => {
      const moved = press?.moved;
      press = null;
      if (event.button !== 0 || moved) return;
      const key = hit(event.clientX, event.clientY);
      if (key) choose(key, { fromMap: true });
    });
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  return {
    camera,
    updateHover,
    setFrameInsets,
    isInteracting: () => pointers.size > 0 || partyPointer !== null,
    refresh({ resetView = false, fitContent: fit = false, preserveFraming = false } = {}) {
      cancelHover();
      map.updateWorldMatrix(true, true);
      pick = picker();
      fitContent = fit;
      hovered = null;
      onHover(null);
      hoverRing.visible = false;
      if (resetView) {
        zoom = 1;
        camera.position.set(24, 30, 37);
        camera.lookAt(0, 0.3, 0);
      }
      if (selected && cells.some((cell) => cell.key === selected))
        choose(selected, { notify: false });
      if (selectionKeys !== null) showSelection();
      if (preserveFraming) draw();
      else resize();
    },
    cancelInteraction() {
      cancelHover();
      interactionRevision++;
      cancelLongPress();
      cancelTap();
      for (const id of [...pointers.keys(), partyPointer])
        if (id !== null && host.hasPointerCapture?.(id)) host.releasePointerCapture(id);
      pointers.clear();
      partyPointer = null;
      last = start = null;
      lastTap = null;
      slideZoom = false;
      slideTapSelected = false;
      pinched = longPressed = gestureMoved = false;
      party?.cancel();
    },
    select: choose,
    focus,
    setSelection(keys) {
      selectionKeys = keys === null ? null : [...keys];
      showSelection();
      draw();
    },
    zoom: changeZoom,
    pan,
    dispose() {
      cancelHover();
      pick = () => null;
      cancelLongPress();
      cancelTap();
      listeners.abort();
      observer.disconnect();
      for (const ring of [activeRing, hoverRing]) {
        ring.geometry.dispose();
        ring.removeFromParent();
      }
    },
  };
}
