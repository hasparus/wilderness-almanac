import scene from 'virtual:footer-scene';
import { initializeMapEmbed } from './map-embed.js';

initializeMapEmbed(scene, {
  namespace: 'twa-footer',
  description:
    'A path from a coastal village to the mountains in Pixelart. Click a hex to select it.',
});
