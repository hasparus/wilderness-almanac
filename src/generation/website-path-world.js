import { createTopology } from '../map-data.js';
import { DIRECTIONS, directionTo, keyOf } from './hex.js';
import { generateWorld } from './world.js';
import { randomFor } from './seed.js';
import { roadKey } from './roads.js';

// An embed-only scene; ordinary campaign seeds and generator replay stay unchanged.
export function websitePathWorld() {
  const world = generateWorld('heliotest');
  const definitions = [
    [-4, 3, 'open water', 0],
    [-3, 3, 'meadow', 0],
    [-3, 2, 'farmlands', 0],
    [-2, 1, 'meadow', 1],
    [-2, 2, 'meadow', 1],
    [-1, 1, 'farmlands', 1],
    [-1, 0, 'meadow', 1],
    [0, 0, 'light forest', 2],
    [0, -1, 'light forest', 2, { kind: 'abbey', variant: 0 }],
    [1, -1, 'dense forest', 2],
    [1, -2, 'dense forest', 3, { kind: 'watchtower', variant: 'watchtower' }],
    [2, -3, 'mountains', 4],
    [3, -3, 'mountains', 4],
    [3, -4, 'mountains', 4],
  ];
  const topology = createTopology({ radius: 4, sites: [[0, 0]] });
  const keys = new Set(definitions.map(([q, r]) => keyOf(q, r)));
  topology.cells = topology.cells.filter((cell) => keys.has(cell.key));
  topology.regions[0].hexIds = topology.cells.map((cell) => cell.id);
  Object.assign(world, topology, {
    seed: 'the-last-safe-road',
    name: 'Beyond the last safe road',
    geography: { coastEdges: [2], islands: [], archipelagos: [], waterFraction: 1 / keys.size },
    hydrology: { lakes: [], sources: [], riverKeys: [], meanderBends: [] },
    elevation: {
      ranges: [{ id: 'footer-range', hexKeys: ['2,-3', '3,-3', '3,-4'] }],
      features: [],
    },
    terrain: { openLandMinimum: 0, counts: {} },
    settlements: [
      { id: 'shore-village', type: 'village', regionId: 1, anchorKey: '-3,3', hexKeys: ['-3,3'] },
      {
        id: 'walled-city',
        type: 'city',
        regionId: 1,
        anchorKey: '-2,1',
        hexKeys: ['-2,1', '-2,2'],
      },
    ],
    crossings: [],
    roads: { budget: 0, dryLand: keys.size - 1, links: [], edges: [] },
  });
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  for (const [q, r, terrain, elevation, poi] of definitions) {
    const cell = byKey.get(keyOf(q, r));
    Object.assign(cell, { terrain, elevation });
    cell.edgeSides = DIRECTIONS.flatMap(([dq, dr], side) =>
      byKey.has(keyOf(q + dq, r + dr)) ? [] : [side],
    );
    if (terrain === 'open water') cell.water = 'ocean';
    if (terrain.includes('forest')) {
      cell.forestType = terrain === 'dense forest' ? 'spruce' : 'ash';
      cell.treeVariant = 0;
    }
    if (terrain === 'mountains') cell.mountainRangeId = 'footer-range';
    const settlement = world.settlements.find((entry) => entry.hexKeys.includes(cell.key));
    if (settlement)
      cell.pointOfLight = {
        id: settlement.id,
        type: settlement.type,
        size: settlement.hexKeys.length,
        centre: cell.key === settlement.anchorKey,
      };
    if (poi)
      cell.pointsOfInterest = [
        {
          ...poi,
          id: `footer-poi:${cell.key}`,
          key: cell.key,
          regionId: 1,
          detailSeed: Math.floor(randomFor(world.seed, `poi:${cell.key}`)() * 4294967296),
          temperature: poi.kind === 'abbey' ? 1 : 0,
        },
      ];
    world.terrain.counts[terrain] = (world.terrain.counts[terrain] ?? 0) + 1;
  }
  const road = ['-3,3', '-3,2', '-2,1', '-1,1', '-1,0', '0,0', '0,-1'];
  for (let index = 1; index < road.length; index++) {
    const from = byKey.get(road[index - 1]);
    const to = byKey.get(road[index]);
    const side = directionTo(from, to);
    from.road ??= { exits: 0, banks: {} };
    to.road ??= { exits: 0, banks: {} };
    from.road.exits |= 1 << side;
    to.road.exits |= 1 << ((side + 3) % 6);
    world.roads.edges.push(roadKey(from.key, to.key));
  }
  world.roads.edges.sort();
  world.pointsOfInterest = world.cells.flatMap((cell) => cell.pointsOfInterest);
  return world;
}
