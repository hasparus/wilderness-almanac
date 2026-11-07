import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { hexName } from '../src/application/hex-description.js';
import { palettes } from '../src/palette.js';
import { worldPosition } from '../src/generation/hex.js';
import { footerScene } from './footer-scene.mjs';

// Prepare the fixed scene in Node, keeping the world generator out of the embed.
export function heroScenePlugin() {
  const id = '\0virtual:hero-scene';
  const footerId = '\0virtual:footer-scene';
  return {
    name: 'wilderness-hero-scene',
    resolveId(source) {
      if (source === 'virtual:hero-scene') return id;
      if (source === 'virtual:footer-scene') return footerId;
    },
    load(source) {
      if (source === footerId) return `export default ${JSON.stringify(footerScene())};`;
      if (source !== id) return;
      const world = generateWorld('heliotest');
      const town = world.cells.find((cell) => cell.key === '0,0');
      const meadow = world.cells.find((cell) => cell.key === '-1,1');
      world.cells.find((cell) => cell.key === '1,-1').forestType = 'spruce';
      town.road ??= { exits: 0, banks: {} };
      town.road.exits |= 1 << 2;
      meadow.road = { exits: (1 << 5) | (1 << 2), banks: {} };
      // An off-map neighbour supplies the normal road port at the SW boundary.
      // It participates only in dressing, never in the seven visible hexes.
      const exit = {
        ...meadow,
        key: '-2,2',
        q: -2,
        r: 2,
        ...worldPosition({ q: -2, r: 2 }),
        road: { exits: 1 << 5, banks: {} },
      };
      const dressing = generateDressing({ ...world, cells: [...world.cells, exit] }, 0);
      const layout = prepareMap(world, dressing);
      return `export default ${JSON.stringify({
        layout,
        palette: palettes.thronefall,
        hexes: layout.map((cell) => ({
          key: cell.key,
          label: cell.key === '0,0' ? 'Town of Far-Nahar' : hexName(cell),
        })),
      })};`;
    },
  };
}
