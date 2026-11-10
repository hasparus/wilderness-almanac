import * as THREE from 'three';
import { DAYLIGHT, timeOfDay } from '../application/time-of-day.js';
import { applyNightTint, NIGHT_TINT } from '../night-color.js';

// A single shadow map, plus a soft, shadowless eastern fill at dawn.
export function createDaylight(scene, { shadows = true, sunPatch = true } = {}) {
  const ambient = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  const patch = sunPatch ? new THREE.SpotLight('#ffe0e8', 0, 0, 0.65, 1, 0) : null;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.0002;
  sun.shadow.radius = 3;
  scene.add(ambient, sun);
  if (patch) {
    patch.position.set(23, 22, -13);
    patch.target.position.set(14, 0, -8);
    scene.add(patch, patch.target);
  }
  function setMode(value) {
    const mode = timeOfDay(value),
      profile = DAYLIGHT[mode];
    ambient.color.set(profile.sky);
    ambient.groundColor.set(profile.ground);
    ambient.intensity = profile.ambient;
    sun.color.set(profile.sun);
    sun.intensity = profile.intensity;
    sun.position.fromArray(profile.position);
    sun.castShadow = shadows && mode !== 'night';
    const extent = profile.shadowExtent;
    Object.assign(sun.shadow.camera, {
      left: -extent,
      right: extent,
      top: extent,
      bottom: -extent,
      near: 1,
      far: profile.shadowFar,
    });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
    if (patch) {
      patch.visible = mode === 'dawn';
      patch.intensity = patch.visible ? 0.9 : 0;
    }
    return mode;
  }
  setMode('day');
  return {
    ambient,
    sun,
    patch,
    setMode,
    dispose() {
      ambient.removeFromParent();
      sun.removeFromParent();
      patch?.removeFromParent();
      patch?.target.removeFromParent();
      sun.shadow.dispose();
      patch?.shadow.dispose();
    },
  };
}

const navy = new THREE.Color(NIGHT_TINT);
export function applyNightColor(color, mode) {
  if (mode === 'night') applyNightTint(color, navy);
  return color;
}
