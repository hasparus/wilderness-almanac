import * as THREE from 'three';
import { resolveRiverSurface } from '../generation/river-surface-cache.js';
import { worldPosition } from '../generation/hex.js';

export const BEAM_LENGTH = 2 * Math.sqrt(3);
export const LANDING_RADIUS = 0.42;
export const BEAM_WIDTH = 0.1;
const MAX_SWEEP = Math.PI / 3;
const isWater = (cell) =>
  cell &&
  cell.fogState !== 'undiscovered' &&
  (cell.terrain === 'open water' || cell.water === 'ocean' || cell.water === 'lake');

function waterField(cells) {
  const byKey = new Map(cells.map((cell) => [cell.key, cell]));
  return (x, z) => {
    const q = x / Math.sqrt(3) - z / 3,
      r = (2 * z) / 3,
      s = -q - r;
    let rq = Math.round(q),
      rr = Math.round(r),
      rs = Math.round(s);
    const dq = Math.abs(rq - q),
      dr = Math.abs(rr - r),
      ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    return byKey.get(`${rq},${rr}`);
  };
}

// Leave clearance around the round landing and shaft, including between samples.
function trace(position, angle, cellAt, scale) {
  const length = BEAM_LENGTH * scale;
  const steps = Math.round(48 * scale);
  const dx = Math.cos(angle),
    dz = Math.sin(angle);
  let target = null,
    enteredWater = false,
    clearWater = false;
  for (let step = 0; step <= steps; step++) {
    const distance = (length * step) / steps;
    const x = position.x + dx * distance,
      z = position.z + dz * distance;
    const cell = cellAt(x, z);
    if (!cell || cell.fogState === 'undiscovered' || (enteredWater && !isWater(cell))) break;
    const width = distance * BEAM_WIDTH * scale + 0.04;
    const edges = [-1, 1].map((side) => cellAt(x - dz * width * side, z + dx * width * side));
    if (
      edges.some(
        (edge) => !edge || edge.fogState === 'undiscovered' || (clearWater && !isWater(edge)),
      )
    )
      break;
    if (!isWater(cell)) continue;
    enteredWater = true;
    clearWater ||= edges.every(isWater);
    const roundLanding = Array.from({ length: 12 }, (_, k) => {
      const a = (k * Math.PI) / 6,
        radius = LANDING_RADIUS * scale + 0.05;
      return cellAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
    }).every(isWater);
    if (roundLanding) target = new THREE.Vector3(x, cell.top + 0.025, z);
  }
  return target;
}

// Precompute a continuous visible-water arc; animation performs no map searches.
export function lighthouseSweep(position, cells, { artStyle = 'low-poly' } = {}) {
  const scale = artStyle === 'pixelart' ? 1.5 : 1;
  const water = cells.filter(isWater).map((cell) => {
    const { wx, wz } = worldPosition(cell);
    return new THREE.Vector3(wx, 0, wz);
  });
  const nearest = water.toSorted(
    (a, b) => a.distanceToSquared(position) - b.distanceToSquared(position),
  )[0];
  if (!nearest) return null;
  const dx = nearest.x - position.x,
    dz = nearest.z - position.z;
  if (Math.hypot(dx, dz) > BEAM_LENGTH * scale || Math.hypot(dx, dz) < 1e-6) return null;
  const bearing = Math.atan2(dz, dx),
    cellAt = waterField(cells);
  const samples = Array.from({ length: 61 }, (_, k) =>
    trace(position, bearing - MAX_SWEEP + (2 * MAX_SWEEP * k) / 60, cellAt, scale),
  );
  const arcs = [];
  let arc = [];
  for (let i = 0; i <= samples.length; i++) {
    if (samples[i]) arc.push({ target: samples[i], index: i });
    else if (arc.length) {
      arcs.push(arc);
      arc = [];
    }
  }
  const selected =
    arcs.find((part) => part.some(({ index }) => index === 30)) ??
    arcs.toSorted((a, b) => b.length - a.length)[0];
  if (!selected) return null;
  // A conservative neighbouring radius smooths coastline changes without
  // interpolating the beam end through a hidden tile or a small island.
  return selected.map(({ target }, i) => {
    const distance = Math.min(
      ...selected
        .slice(Math.max(0, i - 1), i + 2)
        .map((entry) => Math.hypot(entry.target.x - position.x, entry.target.z - position.z)),
    );
    const direction = target.clone().sub(position).setY(0).normalize();
    return new THREE.Vector3(
      position.x + direction.x * distance,
      target.y,
      position.z + direction.z * distance,
    );
  });
}

export function sweepTarget(sweep, progress, target = new THREE.Vector3()) {
  const index = Math.max(0, Math.min(1, progress)) * (sweep.length - 1);
  const lo = Math.floor(index),
    hi = Math.min(sweep.length - 1, lo + 1);
  return target.copy(sweep[lo]).lerp(sweep[hi], index - lo);
}

export function lighthouseTarget(position, cells, options) {
  const sweep = lighthouseSweep(position, cells, options);
  return sweep ? sweepTarget(sweep, 0.5) : null;
}

// The footprint only contains visible water triangles, never a flat disc over
// land/fog. Its moving radial UVs give the shaft a soft round landing on water.
export function createWaterLanding(
  position,
  cells,
  texture,
  color,
  { artStyle = 'low-poly' } = {},
) {
  const scale = artStyle === 'pixelart' ? 1.5 : 1;
  const vertices = [];
  for (const cell of cells.filter(isWater)) {
    const { wx, wz } = worldPosition(cell);
    if (Math.hypot(wx - position.x, wz - position.z) > (BEAM_LENGTH + LANDING_RADIUS) * scale + 1)
      continue;
    const water = resolveRiverSurface(cell.riverSurface)?.water;
    if (water) {
      for (const face of water.triangles)
        for (const index of face) {
          const [x, , z] = water.vertices[index];
          vertices.push(wx + x, cell.top + 0.018, wz + z);
        }
    } else
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3,
          b = ((k + 1) * Math.PI) / 3;
        vertices.push(
          wx,
          cell.top + 0.018,
          wz,
          wx + Math.sin(a),
          cell.top + 0.018,
          wz + Math.cos(a),
          wx + Math.sin(b),
          cell.top + 0.018,
          wz + Math.cos(b),
        );
      }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(new Float32Array((vertices.length / 3) * 2), 2).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  const material = new THREE.MeshBasicMaterial({
    color,
    map: texture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'lighthouse:landing';
  mesh.userData.landingRadius = LANDING_RADIUS * scale;
  return mesh;
}

export function updateWaterLanding(mesh, target) {
  const { position, uv } = mesh.geometry.attributes;
  const radius = mesh.userData.landingRadius ?? LANDING_RADIUS;
  for (let i = 0; i < position.count; i++)
    uv.setXY(
      i,
      0.5 + (position.getX(i) - target.x) / (2 * radius),
      0.5 + (position.getZ(i) - target.z) / (2 * radius),
    );
  uv.needsUpdate = true;
}

export function softenBeamEnd(material) {
  material.customProgramCacheKey = () => 'lighthouse-soft-shaft-v1';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vBeamProgress;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBeamProgress = -position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBeamProgress;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(0.72, 1.0, vBeamProgress);',
      );
  };
}
