import { websitePathWorld } from '../src/generation/website-path-world.js';
import { generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { hexName } from '../src/application/hex-description.js';
import { palettes } from '../src/palette.js';

export function footerScene() {
  const world = websitePathWorld();
  const layout = prepareMap(world, generateDressing(world, 0));
  return {
    layout,
    palette: palettes.thronefall,
    hexes: layout.map((cell) => ({
      key: cell.key,
      label:
        cell.pointOfLight?.id === 'shore-village'
          ? 'Village of Saltwick'
          : cell.pointOfLight?.id === 'walled-city'
            ? 'Walled city of Alderwatch'
            : hexName(cell),
    })),
  };
}
