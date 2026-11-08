import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TOP_RADIUS } from '../generation/math.js';
import { worldPosition } from '../generation/hex.js';
import { DAYLIGHT, timeOfDay } from '../application/time-of-day.js';
import { addGlowTiming, glowTiming, glowPulse, installGlowPulse } from './feature-glow.js';
import {
  lighthouseSweep,
  BEAM_WIDTH,
  sweepTarget,
  createWaterLanding,
  updateWaterLanding,
  softenBeamEnd,
} from './lighthouse-beams.js';
export { lighthouseTarget } from './lighthouse-beams.js';

const COLORS = { warm: '#ffd269', mystic: '#9b79ff', dungeon: '#f65b49' };
const POINT_LIMIT = 4,
  BEAM_LIMIT = 2;
const GLOW_RADIUS = {
  village: 0.36,
  town: 0.4,
  city: 0.44,
  watchtower: 0.42,
  abbey: 0.48,
  stronghold: 0.52,
  warm: 0.38,
  mystic: 0.45,
  dungeon: 0.23,
};
const ENHANCED = new Set(['city', 'watchtower', 'abbey', 'stronghold', 'mystic', 'dungeon']);
const GLOW_SCALE = 1.5,
  GLOW_STRENGTH = 1.3;
const Y = new THREE.Vector3(0, 1, 0);
const point = (cell) => {
  const { wx, wz } = worldPosition(cell);
  return new THREE.Vector3(wx, 0, wz);
};

// Use the tile's actual top triangles: the texture clips the radius while the
// geometry clips the light to dry ground, including slopes and river banks.
function groundGlow(tiles, position, radius, includeBevel = false) {
  const clipped = [];
  for (const tile of tiles) {
    const centre = point(tile);
    const surface = tile.surface || tile.riverSurface || tile.roadSurface;
    const vertices = surface
      ? [...surface.vertices]
      : [
          [0, 0, 0],
          ...Array.from({ length: 6 }, (_, k) => [
            Math.sin((k * Math.PI) / 3) * TOP_RADIUS,
            0,
            Math.cos((k * Math.PI) / 3) * TOP_RADIUS,
          ]),
        ];
    const triangles = surface
      ? surface.triangles.filter(
          (_, i) =>
            surface !== tile.roadSurface ||
            surface.materialIndices[i] === 2 ||
            (includeBevel && surface.materialIndices[i] === 1),
        )
      : Array.from({ length: 6 }, (_, k) => [0, k + 1, ((k + 1) % 6) + 1]);
    const height = surface && surface === tile.roadSurface ? 0 : tile.top;
    const x = position.x - centre.x,
      z = position.z - centre.z;
    const bounds = [
      [0, x - radius, 1],
      [0, x + radius, -1],
      [2, z - radius, 1],
      [2, z + radius, -1],
    ];
    if (includeBevel && !surface && !tile.water) {
      const outer = vertices.length;
      for (let k = 0; k < 6; k++)
        vertices.push([Math.sin((k * Math.PI) / 3), -0.075, Math.cos((k * Math.PI) / 3)]);
      for (let k = 0; k < 6; k++) {
        const a = k + 1,
          b = ((k + 1) % 6) + 1,
          c = outer + k,
          d = outer + ((k + 1) % 6);
        triangles.push([a, c, b], [b, c, d]);
      }
    }
    for (const face of triangles) {
      let polygon = face.map((i) => vertices[i]);
      for (const [axis, limit, sign] of bounds) {
        const output = [];
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i],
            b = polygon[(i + 1) % polygon.length];
          const da = (a[axis] - limit) * sign,
            db = (b[axis] - limit) * sign;
          if (da >= 0) output.push(a);
          if (da >= 0 !== db >= 0) {
            const t = da / (da - db);
            output.push(a.map((value, k) => value + (b[k] - value) * t));
          }
        }
        polygon = output;
      }
      for (let i = 1; i < polygon.length - 1; i++)
        clipped.push(
          ...[polygon[0], polygon[i], polygon[i + 1]].map(([x, y, z]) => [
            centre.x + x,
            height + y,
            centre.z + z,
          ]),
        );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      clipped.flatMap(([x, y, z]) => [x, y + 0.012, z]),
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      clipped.flatMap(([x, , z]) => [
        0.5 + (x - position.x) / (2 * radius),
        0.5 + (z - position.z) / (2 * radius),
      ]),
      2,
    ),
  );
  geometry.setIndex(Array.from({ length: clipped.length }, (_, i) => i));
  geometry.computeVertexNormals();
  return geometry;
}

function glowTexture() {
  const size = 32,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] =
        x === 0 || y === 0 || x === size - 1 || y === size - 1
          ? 0
          : Math.round(Math.max(0, 1 - radius) ** 2 * 255);
    }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// Window glows/ground pools are batched. Only a fixed pool of real lights is
// evaluated by the surface shaders; none of these lights casts shadows.
export function createFeatureLighting(scene) {
  const group = new THREE.Group();
  const beamGroup = new THREE.Group();
  scene.add(group, beamGroup);
  const texture = glowTexture();
  const materials = new Map();
  const clock = { value: 0 };
  for (const [kind, color] of Object.entries(COLORS))
    for (const layer of ['window', 'ground']) {
      const material = new THREE.MeshBasicMaterial({
        color,
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      installGlowPulse(material, clock);
      materials.set(`${kind}:${layer}`, material);
    }
  const cone = new THREE.CylinderGeometry(0, BEAM_WIDTH, 1, 24, 8, true);
  cone.translate(0, -0.5, 0);
  const points = Array.from(
    { length: POINT_LIMIT },
    () => new THREE.PointLight(0xffffff, 0, 1.6, 2),
  );
  const beams = Array.from({ length: BEAM_LIMIT }, () => {
    const light = new THREE.SpotLight(COLORS.warm, 0, 12, Math.atan(BEAM_WIDTH), 0.8, 2);
    scene.add(light, light.target);
    return light;
  });
  scene.add(...points);
  let sources = [],
    lighthouses = [],
    mode = 'day';
  const aim = new THREE.Vector3(),
    direction = new THREE.Vector3(),
    focus = new THREE.Vector3();
  // A build is a record of glow batches, lighthouse nodes and their animation
  // state; show replaces whatever is shown and release disposes a record. The
  // renderer keeps and restores records (see map-builds.js).
  let shown = null;
  function show(record) {
    const previous = shown;
    if (previous) {
      for (const mesh of previous.glow) group.remove(mesh);
      for (const node of previous.beams) beamGroup.remove(node);
    }
    if (record) {
      for (const mesh of record.glow) group.add(mesh);
      for (const node of record.beams) beamGroup.add(node);
    }
    sources = record?.sources ?? [];
    lighthouses = record?.lighthouses ?? [];
    shown = record;
    return previous;
  }
  function release(record) {
    if (!record) return;
    for (const mesh of record.glow) mesh.geometry.dispose();
    for (const source of record.lighthouses) {
      source.landing.geometry.dispose();
      source.landing.material.dispose();
      source.mesh.material.dispose();
    }
  }
  const setSources = (entries, cells, options) => release(show(build(entries, cells, options)));
  function build(entries, cells, { artStyle = 'low-poly' } = {}) {
    const pixel = artStyle === 'pixelart';
    const built = { glow: [], beams: [], sources: [], lighthouses: [] };
    const batches = new Map();
    const byKey = new Map(cells.map((cell) => [cell.key, cell]));
    function add(key, geometry) {
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(geometry);
    }
    for (const source of entries) {
      if (source.tile.fogState && source.tile.fogState !== 'visited') continue;
      const position = new THREE.Vector3().fromArray(source.position).applyMatrix4(source.matrix);
      const kind = source.kind === 'lighthouse' ? 'warm' : source.kind;
      const feature =
        source.kind === 'lighthouse'
          ? 'warm'
          : (source.feature ?? (kind === 'warm' ? source.tile.pointOfLight?.type : null) ?? kind);
      const enhanced = pixel && (source.kind === 'lighthouse' || ENHANCED.has(feature));
      const radiusScale = enhanced ? GLOW_SCALE : 1;
      const record = {
        position,
        kind,
        radiusScale,
        strength: pixel && feature === 'city' ? 0.7 : enhanced ? GLOW_STRENGTH : 1,
        ...glowTiming(source, position),
      };
      built.sources.push(record);
      const window = new THREE.PlaneGeometry(...source.size.map((size) => size * radiusScale));
      window.translate(...source.position).applyMatrix4(source.matrix);
      add(`${kind}:window`, addGlowTiming(window, record));
      const targets = [source.tile];
      if (pixel && feature === 'city') {
        // Only adjacent visible dry surfaces at this level receive spill.
        for (let dr = -1; dr <= 1; dr++)
          for (let dq = -1; dq <= 1; dq++) {
            const next = byKey.get(`${source.tile.q + dq},${source.tile.r + dr}`);
            if (
              !next ||
              next.key === source.tile.key ||
              next.water ||
              next.terrain === 'open water' ||
              (next.fogState && next.fogState !== 'visited') ||
              Math.abs(next.top - source.tile.top) > 0.08
            )
              continue;
            targets.push(next);
          }
      }
      const halo = groundGlow(
        targets,
        position,
        (GLOW_RADIUS[feature] ?? GLOW_RADIUS[kind]) * radiusScale,
        pixel && feature === 'city',
      );
      add(
        `${kind}:ground`,
        addGlowTiming(halo, pixel && feature === 'city' ? { ...record, strength: 0.35 } : record),
      );
      if (source.kind === 'lighthouse') {
        const sweep = lighthouseSweep(position, cells, { artStyle });
        if (sweep) {
          const material = new THREE.MeshBasicMaterial({
            color: COLORS.warm,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
          });
          softenBeamEnd(material);
          const mesh = new THREE.Mesh(cone, material);
          mesh.name = 'lighthouse:shaft';
          const landing = createWaterLanding(position, cells, texture, COLORS.warm, { artStyle });
          const node = new THREE.Group();
          node.add(mesh, landing);
          built.beams.push(node);
          built.lighthouses.push({ ...record, sweep, mesh, landing, aim: new THREE.Vector3() });
        }
      }
    }
    for (const [key, geometries] of batches) {
      const geometry = mergeGeometries(geometries);
      geometries.forEach((item) => item.dispose());
      const mesh = new THREE.Mesh(geometry, materials.get(key));
      mesh.name = key;
      built.glow.push(mesh);
    }
    return built;
  }
  function update(time, camera) {
    const strength = DAYLIGHT[mode].glow;
    group.visible = strength > 0;
    beamGroup.visible = strength > 0;
    clock.value = time;
    for (const [key, material] of materials)
      material.opacity =
        strength * (key.endsWith('ground') ? (key.startsWith('dungeon') ? 0.35 : 0.55) : 1);
    camera.getWorldDirection(direction);
    focus
      .copy(camera.position)
      .addScaledVector(direction, -camera.position.y / Math.min(-0.01, direction.y));
    // Warm buildings use persistent windows/pools only. Assigning them a native
    // light here would make their facades brighten again when centred on screen.
    const nearest = strength
      ? sources
          .filter((source) => source.kind !== 'warm')
          .toSorted(
            (a, b) => a.position.distanceToSquared(focus) - b.position.distanceToSquared(focus),
          )
      : [];
    points.forEach((light, i) => {
      const source = nearest[i];
      light.visible = Boolean(source);
      light.intensity = source
        ? strength *
          source.strength *
          glowPulse(time, source) *
          (source.kind === 'dungeon' ? 0.055 : 0.18)
        : 0;
      if (source) {
        light.distance = 1.6 * source.radiusScale;
        light.color.set(COLORS[source.kind]);
        light.position.copy(source.position);
      }
    });
    if (strength > 0)
      for (const source of lighthouses) {
        const mesh = source.mesh;
        sweepTarget(source.sweep, 0.5 + Math.sin((time * Math.PI) / 20 + source.phase) * 0.5, aim);
        source.aim.copy(aim);
        const distance = source.position.distanceTo(aim);
        direction.copy(aim).sub(source.position);
        const pulse = glowPulse(time, source);
        mesh.material.opacity = strength * source.strength * pulse * 0.16;
        source.landing.material.opacity = strength * source.strength * pulse * 0.7;
        updateWaterLanding(source.landing, aim);
        mesh.position.copy(source.position);
        mesh.scale.set(distance * source.radiusScale, distance, distance * source.radiusScale);
        mesh.quaternion.setFromUnitVectors(Y, direction.normalize().negate());
      }
    const nearby = strength
      ? lighthouses.toSorted(
          (a, b) => a.position.distanceToSquared(focus) - b.position.distanceToSquared(focus),
        )
      : [];
    beams.forEach((light, i) => {
      const source = nearby[i];
      light.visible = Boolean(source);
      light.intensity = source ? strength * source.strength * glowPulse(time, source) * 4.4 : 0;
      if (source) {
        light.angle = Math.atan(BEAM_WIDTH * source.radiusScale);
        light.position.copy(source.position);
        light.target.position.copy(source.aim);
      }
    });
  }
  return {
    group,
    beamGroup,
    points,
    beams,
    build,
    show,
    release,
    setSources,
    setMode(value) {
      mode = timeOfDay(value);
    },
    update,
    dispose() {
      release(show(null));
      group.removeFromParent();
      beamGroup.removeFromParent();
      for (const light of points) light.removeFromParent();
      for (const light of beams) {
        light.removeFromParent();
        light.target.removeFromParent();
        light.shadow.dispose();
      }
      cone.dispose();
      texture.dispose();
      for (const material of materials.values()) material.dispose();
    },
  };
}
