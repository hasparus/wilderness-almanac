import { createTopology } from '../map-data.js';
import { normalizeSeed, randomFor } from './seed.js';
import { generateGeography } from './geography.js';
import { generateHydrology } from './hydrology.js';
import { generateElevation } from './elevation.js';
import { generateTerrainTypes, generateFarmlands } from './terrain-types.js';
import { generateMapName } from './map-names.js';
import { generatePropDressing } from './props.js';
import { prepareMountainRanges } from './mountain-surfaces.js';
import { generateSettlements } from './settlement-placement.js';
import { generatePointsOfInterest } from './points-of-interest.js';
import { worldPreferences } from './world-preferences.js';
import { generateRoads } from './roads.js';
import { generateRoadDressing, roadHeight } from './road-geometry.js';
import { sandboxWorld } from './sandbox-world.js';

export const GENERATOR_VERSION = 10;
export const SUPPORTED_GENERATOR_VERSIONS = [GENERATOR_VERSION];

/**
 * @param {string | number} seed
 * @param {{preferences?: Partial<Record<'water' | 'elevation' | 'forests' | 'settlements', number>>, generatorVersion?: number}} [options]
 */
export function generateWorld(seed, { preferences, generatorVersion = GENERATOR_VERSION } = {}) {
  if (!SUPPORTED_GENERATOR_VERSIONS.includes(generatorVersion))
    throw new Error('This campaign uses an unsupported map generator version.');
  const settings = worldPreferences(preferences);
  const world = {
    schemaVersion: 1,
    generatorVersion,
    preferences: settings,
    seed: normalizeSeed(seed),
    ...createTopology(),
    scale: { hexSpacingKm: 18 },
    stages: {
      geography: true,
      hydrology: true,
      elevation: true,
      mountains: true,
      terrain: true,
      pointsOfLight: true,
      pointsOfInterest: true,
      props: true,
    },
  };
  Object.assign(world, generateMapName(world.seed));
  if (world.seed === 'heliotest') return sandboxWorld(world);
  generateGeography(world);
  generateHydrology(world);
  generateElevation(world);
  generateTerrainTypes(world);
  generateSettlements(world);
  generateFarmlands(world);
  generatePointsOfInterest(world);
  generateRoads(world);
  return world;
}

// Cosmetic state is deliberately outside the world. Replaying a variant is also
// deterministic; creating/regenerating a map advances only this dressing stream.
export function generateDressing(
  world,
  variant = 0,
  {
    fixedCells = {},
    revisions = {},
    cropStyles = {},
    mountainLocks = {},
    canopySalt = '',
    roadLocks = fixedCells,
  } = {},
) {
  cropStyles = {
    ...Object.fromEntries(
      world.cells.filter((cell) => cell.cropStyle).map((cell) => [cell.key, cell.cropStyle]),
    ),
    ...cropStyles,
  };
  const dressing = {
    seed: world.seed,
    variant,
    enabled: world.stages.props,
    mountains:
      world.stages.props && world.stages.mountains
        ? world.elevation.ranges.map((range) => {
            const ridgeRandom = randomFor(world.seed, `mountains:${range.id}:${variant}`);
            return {
              rangeId: range.id,
              phase: ridgeRandom() * Math.PI * 2,
              angle: ridgeRandom() * Math.PI,
              heightScale: 0.6,
              profile: mountainLocks[range.id]?.profile ?? (mountainLocks[range.id] ? 0 : 1),
              ...mountainLocks[range.id],
            };
          })
        : [],
    cells: [],
    ...(Object.keys(revisions).length ? { revisions } : {}),
  };
  const roads = generateRoadDressing(world, variant, { fixedCells: roadLocks, revisions });
  dressing.cells = world.stages.props
    ? generatePropDressing(world, variant, prepareMountainRanges(world, dressing), {
        fixedCells,
        revisions,
        cropStyles,
        canopySalt,
        roads,
      })
    : world.cells.map((cell) => ({ key: cell.key, placementSeed: 0, props: [] }));
  for (const cell of dressing.cells)
    if (roads.has(cell.key)) {
      const detail = roads.get(cell.key);
      Object.assign(cell, detail);
      if (detail.roadSurface) {
        const origin = world.cells.find((entry) => entry.key === cell.key);
        for (const prop of cell.props)
          if (prop.kind !== 'poi' && !prop.foundationHeights)
            prop.y = roadHeight(origin, prop.x, prop.z, detail.roadSurface);
      }
    }
  return dressing;
}
