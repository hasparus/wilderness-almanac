// Pure geometry data adapter. No DOM or Three.js objects enter the world model.
import { DIRECTIONS, directionTo } from './hex.js';
import { randomFor } from './seed.js';
import { riverSurface } from './river-surfaces.js';
import { deferRiverSurface } from './river-surface-cache.js';
import { prepareMountainRanges } from './mountain-surfaces.js';

const APOTHEM = Math.sqrt(3) / 2;
export const ELEVATION_STEP = 0.22;
const corners = () =>
  Array.from({ length: 6 }, (_, k) => [Math.sin((k * Math.PI) / 3), Math.cos((k * Math.PI) / 3)]);
const pointOn = (curve, t) => {
  const u = 1 - t;
  return [0, 1].map(
    (axis) => u * u * curve[0][axis] + 2 * u * t * curve[1][axis] + t * t * curve[2][axis],
  );
};

export function prepareRiverGeometry(world) {
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const allChannels = [],
    allIslands = [],
    allBarriers = [],
    curves = new Map(),
    mouths = new Map();
  const random = randomFor(world.seed, 'river-geometry');
  const phase = random() * Math.PI * 2;
  for (const cell of world.cells.filter((cell) => cell.water === 'river')) {
    for (let side = 0; side < 6; side++) {
      const [q, r] = DIRECTIONS[side];
      if (byKey.get(`${cell.q + q},${cell.r + r}`)?.water) continue;
      const k = (7 - side) % 6;
      const c = corners();
      allBarriers.push([c[k], c[(k + 1) % 6]].map(([x, z]) => [x + cell.wx, z + cell.wz]));
    }
    const outlet = byKey.get(cell.downstream);
    const exit = outlet ? directionTo(cell, outlet) : -1;
    const port = (side, length = APOTHEM) => [
      cell.wx + Math.cos((side * Math.PI) / 3) * length,
      cell.wz + Math.sin((side * Math.PI) / 3) * length,
    ];
    const end = outlet ? port(exit) : [cell.wx + (cell.upstream.length ? 0 : 0.42), cell.wz];
    const widthAtEnd =
      outlet?.water === 'river' ? (cell.riverWidth + outlet.riverWidth) / 2 : cell.riverWidth;
    if (outlet && outlet.water !== 'river') {
      if (!mouths.has(outlet.key)) mouths.set(outlet.key, []);
      mouths.get(outlet.key).push({
        x: end[0],
        z: end[1],
        nx: Math.cos((exit * Math.PI) / 3),
        nz: Math.sin((exit * Math.PI) / 3),
        width: widthAtEnd,
      });
    }
    const entries = cell.upstream.length ? cell.upstream.map((key) => byKey.get(key)) : [null];
    for (const upstream of entries) {
      const start = upstream
        ? port(directionTo(cell, upstream))
        : [cell.wx - (outlet ? 0 : 0.42), cell.wz];
      const startWidth = upstream
        ? (upstream.riverWidth + cell.riverWidth) / 2
        : cell.riverWidth * 0.85;
      const curve = [start, [cell.wx, cell.wz], end];
      if (!curves.has(cell.key)) curves.set(cell.key, curve);
      const bend = (randomFor(world.seed, `meander:${cell.key}`)() - 0.5) * 0.2;
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
      const at = (t) => {
        const point = pointOn(curve, t);
        // Zero offset and derivative at both ports preserve smooth shared joins.
        const offset = Math.sin(Math.PI * t) ** 2 * bend;
        return [
          point[0] - ((end[1] - start[1]) / length) * offset,
          point[1] + ((end[0] - start[0]) / length) * offset,
        ];
      };
      for (let step = 0; step < 16; step++) {
        const t = step / 16,
          u = (step + 1) / 16;
        const width = (v) =>
          (1 - v) ** 2 * startWidth + 2 * (1 - v) * v * cell.riverWidth + v * v * widthAtEnd;
        allChannels.push([at(t), at(u), width(t), width(u)]);
      }
      // Small shaped river isles use the same bank field as the surrounding river.
      if (entries.length === 1 && cell.riverWidth > 0.185 && random() < 0.15) {
        const radius = cell.riverWidth * (0.23 + random() * 0.09);
        allIslands.push([at(0.41), at(0.59), radius, radius * 0.8]);
      }
    }
  }
  return { byKey, allChannels, allIslands, allBarriers, mouths, phase, curves };
}

export function riverFieldFor(cell, fields) {
  const near = (segment) =>
    Math.min(...segment.slice(0, 2).map(([x, z]) => Math.hypot(x - cell.wx, z - cell.wz))) < 2.5;
  return {
    phase: fields.phase,
    roughness: 0.28,
    bankHeight: 0.14,
    channel: fields.allChannels.filter(near),
    islands: fields.allIslands.filter(near),
    bankBarriers: fields.allBarriers.filter(near),
    landEdges: [],
  };
}

export function prepareMap(world, dressing, { cellKeys, deferRiverSurfaces = false } = {}) {
  const fields = prepareRiverGeometry(world);
  const { byKey, mouths } = fields;
  const dressByKey = new Map(dressing.cells.map((cell) => [cell.key, cell]));
  const mountains = prepareMountainRanges(world, dressing);
  const cells = cellKeys ? world.cells.filter((cell) => cellKeys.includes(cell.key)) : world.cells;
  return cells.map((cell) => {
    const river = cell.water === 'river';
    const openWater = cell.water === 'ocean' || cell.water === 'lake';
    const data = {
      ...cell,
      type: river ? 'Water' : openWater ? 'Open water' : 'Land',
      top: cell.water ? 0.2 : 0.34 + Math.min(cell.elevation, 3) * ELEVATION_STEP,
      tone: ['light forest', 'farmlands'].includes(cell.terrain),
      props: dressByKey.get(cell.key)?.props ?? [],
      ...(cell.road
        ? {
            roads: dressByKey.get(cell.key)?.roads ?? [],
            roadStones: dressByKey.get(cell.key)?.roadStones ?? [],
            roadSurface: dressByKey.get(cell.key)?.roadSurface ?? null,
          }
        : {}),
      ...(dressByKey.get(cell.key)?.forest ? { forest: dressByKey.get(cell.key).forest } : {}),
      surface: null,
      ...mountains.get(cell.key),
    };
    const mouthList = mouths.get(cell.key);
    if (river || mouthList) {
      data.bankBevel = true;
      data.clipWater = true;
      const touching = DIRECTIONS.map(([q, r]) => byKey.get(`${cell.q + q},${cell.r + r}`));
      data.riverShared = touching.map((next) => !!next?.water);
      data.riverLandSides = touching.map((next) => !!next && !next.water);
      data.riverCorners = corners();
      // A local subset of one global field keeps boundary samples identical while
      // avoiding a scan of every river segment for every mesh vertex.
      data.river = riverFieldFor(cell, fields);
      if (mouthList) {
        data.river.mouths = mouthList;
        data.mouthSurface = true;
        data.river.islands = [];
      }
      data.hasIsland = data.river.islands.some(
        (segment) => Math.hypot(segment[0][0] - cell.wx, segment[0][1] - cell.wz) < 0.8,
      );
      data.riverSurface = deferRiverSurfaces ? deferRiverSurface(data) : riverSurface(data);
    }
    if (cell.water) data.waterDepth = waterDepthSurface(cell, byKey);
    if (openWater) {
      data.openWaterShared = DIRECTIONS.map(
        ([q, r]) => !!byKey.get(`${cell.q + q},${cell.r + r}`)?.water,
      );
    }
    return data;
  });
}

// Presentation-only depth. Retain full-world shoreline context in cropped and
// recentered previews; this never enters the generated world or saved dressing.
function waterDepthSurface(cell, byKey) {
  const nearby = [];
  for (let dr = -3; dr <= 3; dr++)
    for (let dq = -3; dq <= 3; dq++) {
      const land = byKey.get(`${cell.q + dq},${cell.r + dr}`);
      if (land && !land.water) nearby.push(land);
    }
  const vertices = [[0, 0], ...corners()].map(([x, z]) => {
    let distance = 4;
    for (const land of nearby)
      distance = Math.min(distance, Math.hypot(cell.wx + x - land.wx, cell.wz + z - land.wz));
    const depth = Math.max(0, Math.min(1, (distance - 0.8) / 3.2));
    return [x, depth, z];
  });
  return {
    vertices,
    triangles: Array.from({ length: 6 }, (_, k) => [0, k + 1, ((k + 1) % 6) + 1]),
  };
}
