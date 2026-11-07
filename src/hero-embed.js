import scene from 'virtual:hero-scene';
import { initializeMapEmbed } from './map-embed.js';

initializeMapEmbed(scene, {
  namespace: 'twa-hero',
  initialSelection: '1,0',
  description: 'Heliotest in Pixelart. Click a hex to read its name.',
});
