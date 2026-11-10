import type { Spike } from './types.js';

declare global {
  interface Window {
    spike: Spike;
    captureSpike?: (name: string) => Promise<void>;
  }
}
