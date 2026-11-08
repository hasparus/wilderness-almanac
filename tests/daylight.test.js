import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  DAYLIGHT,
  TIMES_OF_DAY,
  timeOfDay,
  nextTimeOfDay,
} from '../src/application/time-of-day.js';
import { createDaylight, applyNightColor } from '../src/rendering/daylight.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';
import { createAmbientLoop } from '../src/rendering/ambient-motion.js';

test('day retains the standard rig; dawn rises in the east and dusk has the longest shadows', () => {
  assert.deepEqual(TIMES_OF_DAY, ['dawn', 'day', 'dusk', 'night']);
  assert.equal(timeOfDay('invalid'), 'day');
  assert.deepEqual(TIMES_OF_DAY.map(nextTimeOfDay), ['day', 'dusk', 'night', 'dawn']);
  const scene = new THREE.Scene(),
    rig = createDaylight(scene);
  assert.deepEqual(rig.sun.position.toArray(), [-15, 30, -18]);
  assert.equal(rig.ambient.intensity, 1.8);
  assert.equal(rig.sun.intensity, 2.6);
  const east = new THREE.Vector3(Math.sqrt(3) / 2, 0, -0.5);
  const altitude = ({ position: [x, y, z] }) => y / Math.hypot(x, z);
  assert.ok(altitude(DAYLIGHT.dusk) < altitude(DAYLIGHT.dawn));
  assert.ok(altitude(DAYLIGHT.dawn) < altitude(DAYLIGHT.day));
  rig.setMode('dawn');
  assert.ok(rig.sun.position.dot(east) > 0);
  assert.ok(rig.patch.intensity > 0);
  assert.ok(rig.ambient.intensity > DAYLIGHT.day.ambient);
  rig.setMode('dusk');
  assert.ok(rig.sun.position.dot(east) < 0);
  assert.equal(rig.patch.intensity, 0);
  rig.setMode('night');
  assert.equal(rig.sun.castShadow, false);
  rig.setMode('day');
  assert.equal(rig.sun.castShadow, true);
  assert.equal(rig.sun.shadow.camera.far, 90);
  rig.dispose();
  assert.equal(scene.children.length, 0);
});

test('night colour changes are reversible across cached tints, fog and palette changes', () => {
  const registry = createMapMaterials(),
    reference = createMapMaterials();
  const tint = registry.propMaterial('wall', 2 / 3);
  const fog = registry.fogMaterial(tint, 'unvisited');
  const original = tint.color.clone();
  const background = registry.background();
  for (let i = 0; i < 5; i++) {
    registry.setTimeOfDay('night');
    assert.ok(tint.color.b > tint.color.r);
    assert.ok(registry.background().getHSL({}).l < background.getHSL({}).l);
    registry.setTimeOfDay('day');
    assert.deepEqual(tint.color, original);
    assert.equal(fog.color.r, fog.color.g);
    assert.equal(fog.color.g, fog.color.b);
  }
  // Desaturation reduces the palette's colour differences before the navy cast;
  // the cast itself deliberately adds saturation to otherwise neutral plaster.
  for (const color of ['#ff0000', '#00ff00', '#0000ff']) {
    const channels = applyNightColor(new THREE.Color(color), 'night').toArray();
    assert.ok(
      (Math.max(...channels) - Math.min(...channels)) / channels.reduce((a, b) => a + b) < 1,
    );
  }
  const palette = ['#322333', '#2a6775', '#ed8965'];
  registry.setTimeOfDay('night');
  registry.setPalette(palette);
  reference.setPalette(palette);
  assert.notDeepEqual(registry.materials.ground.color, reference.materials.ground.color);
  registry.setTimeOfDay('day');
  for (const [role, material] of Object.entries(reference.materials))
    assert.deepEqual(registry.materials[role].color, material.color);
  assert.deepEqual(tint.color, reference.propMaterial('wall', 2 / 3).color);
  registry.dispose();
  reference.dispose();
});

test('the shared animation clock freezes for Movement off, reduced motion and hidden documents', (t) => {
  const oldWindow = globalThis.window,
    oldDocument = globalThis.document;
  const reduced = Object.assign(new EventTarget(), { matches: false });
  globalThis.window = { matchMedia: () => reduced };
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  t.after(() => {
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
  });
  let frame;
  const renderer = {
    domElement: { dataset: {} },
    setAnimationLoop: (callback) => {
      frame = callback;
    },
  };
  const clock = { value: 0 };
  const loop = createAmbientLoop({ renderer, ambientTime: clock, motion: true, draw() {} });
  frame(0);
  frame(100);
  assert.equal(clock.value, 0.1);
  loop.setMotion(false);
  assert.equal(frame, null);
  loop.setMotion(true);
  frame(5000);
  assert.equal(clock.value, 0.1, 'resuming does not jump the lighthouse/pulse animation');
  reduced.matches = true;
  reduced.dispatchEvent(new Event('change'));
  assert.equal(frame, null);
  reduced.matches = false;
  reduced.dispatchEvent(new Event('change'));
  globalThis.document.hidden = true;
  globalThis.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(frame, null);
  loop.dispose();
});

test('only Day strengthens wind by 20 percent and shortens gusts, including tinted, fog and shadow shaders', () => {
  const registry = createMapMaterials();
  const materials = [
    registry.materials.leaf,
    registry.materials.reeds,
    registry.propMaterial('leaf', 2 / 3, 1),
    registry.fogMaterial(registry.materials.leaf, 'unvisited'),
    registry.treeDepth,
  ];
  const shaders = materials.map((material) => {
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>' };
    material.onBeforeCompile(shader);
    assert.match(shader.vertexShader, /uniform float windStrength/);
    assert.match(shader.vertexShader, /swayWeight \* windStrength/);
    assert.equal(shader.uniforms.ambientTime, registry.ambientTime);
    return shader;
  });
  for (const mode of ['day', 'dawn', 'dusk', 'night', 'day']) {
    registry.setTimeOfDay(mode);
    for (const shader of shaders) {
      assert.equal(shader.uniforms.windStrength, shaders[0].uniforms.windStrength);
      assert.equal(shader.uniforms.windGustPeriod, shaders[0].uniforms.windGustPeriod);
      assert.equal(shader.uniforms.windStrength.value, mode === 'day' ? 1.2 : 1);
      assert.equal(shader.uniforms.windGustPeriod.value, mode === 'day' ? 18 : 24);
    }
  }
  registry.dispose();
});
