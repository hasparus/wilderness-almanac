import { DIRECTIONS } from '../generation/hex.js';
import { ELEVATION_STEP } from '../generation/presentation.js';
import { visibleUnvisitedPoi } from './fog-of-war.js';

function fogCell(cell, states) {
  if (!states) return cell;
  const fogState = states.get(cell.key);
  if (fogState === 'undiscovered') {
    const { key, q, r, x, y, wx, wz, regionId, id, edgeSides } = cell;
    return {
      key,
      q,
      r,
      x,
      y,
      wx,
      wz,
      regionId,
      id,
      edgeSides,
      fogState,
      elevation: 1,
      terrain: 'undiscovered',
      water: null,
      pointOfLight: null,
      pointsOfInterest: [],
      crossing: null,
    };
  }
  return {
    ...cell,
    fogState,
    pointsOfInterest:
      fogState === 'unvisited'
        ? cell.pointsOfInterest.filter(visibleUnvisitedPoi)
        : cell.pointsOfInterest,
  };
}

export function createFogView(world, layout, states) {
  if (!states) return { world, layout };
  const cells = world.cells.map((cell) => fogCell(cell, states));
  const byKey = new Map(cells.map((cell) => [cell.key, cell]));
  const tiles = layout.map((tile) => {
    const cell = byKey.get(tile.key);
    if (cell.fogState === 'undiscovered')
      return {
        ...cell,
        type: 'Land',
        top: 0.34 + ELEVATION_STEP,
        tone: false,
        props: [],
        surface: null,
      };
    const visibleSides = DIRECTIONS.map(
      ([q, r]) => states.get(`${cell.q + q},${cell.r + r}`) !== 'undiscovered',
    );
    const result = {
      ...tile,
      ...cell,
      props: tile.props.filter(
        (prop) =>
          cell.fogState === 'visited' ||
          prop.kind !== 'poi' ||
          visibleUnvisitedPoi({ kind: prop.poiKind }),
      ),
    };
    for (const name of ['shared', 'openWaterShared', 'riverShared', 'shoreLinks'])
      if (tile[name]) result[name] = tile[name].map((value, i) => value && visibleSides[i]);
    if (tile.riverLandSides)
      result.riverLandSides = tile.riverLandSides.map((value, i) => value || !visibleSides[i]);
    return result;
  });
  return {
    world: {
      ...world,
      cells,
      settlements: world.settlements.filter((settlement) =>
        cells.some((cell) => cell.pointOfLight?.id === settlement.id),
      ),
      pointsOfInterest: cells.flatMap((cell) => cell.pointsOfInterest),
    },
    layout: tiles,
  };
}

// Reuse a projection while its inputs are unchanged. The session hands out the
// same visibility Map for identical classifications, so the renderer receives a
// stable layout reference and can restore the build it retained for it.
export function createFogViewer() {
  let last;
  return (world, layout, states) => {
    if (last?.world !== world || last.layout !== layout || last.states !== states)
      last = { world, layout, states, view: createFogView(world, layout, states) };
    return last.view;
  };
}
