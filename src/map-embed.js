import { TIMES_OF_DAY } from './application/time-of-day.js';

export function initializeMapEmbed(scene, { namespace, initialSelection = null, description }) {
  const host = document.querySelector('[data-embed-map]');
  const select = document.querySelector('[data-embed-select]');
  const output = document.querySelector('[data-embed-selection]');
  const labels = new Map(scene.hexes.map((hex) => [hex.key, hex.label]));
  const listeners = new AbortController();
  let renderer;
  let ready = false;
  const initialTime = new URL(location.href).searchParams.get('time');
  let lighting = TIMES_OF_DAY.includes(initialTime) ? initialTime : 'dawn';
  let selectedKey = null;
  let parentOrigin = null;
  const parameters = new URL(location.href).searchParams;
  let background = /^#[a-f\d]{6}$/i.test(parameters.get('background') ?? '')
    ? parameters.get('background')
    : '#f1e8db';
  const frameInsets = {
    left: Math.max(0, Number(parameters.get('left')) || 0),
    right: Math.max(0, Number(parameters.get('right')) || 0),
  };
  document.documentElement.style.setProperty('--hero-background', background);

  try {
    if (window.parent !== window)
      parentOrigin = new URL(document.referrer || new URL(location.href).searchParams.get('parent'))
        .origin;
  } catch {
    // No valid parent origin: keep the embed usable without cross-window messages.
  }

  function notify(type, values = {}) {
    if (parentOrigin)
      window.parent.postMessage({ type: `${namespace}:${type}`, ...values }, parentOrigin);
  }

  function announceSelection(key) {
    const label = labels.get(key);
    if (!label) return;
    selectedKey = key;
    select.value = key;
    output.textContent = label;
    notify('selection', { key, label });
  }

  for (const hex of scene.hexes) {
    const option = document.createElement('option');
    option.value = hex.key;
    option.textContent = hex.label;
    select.append(option);
  }
  select.selectedIndex = -1;
  select.addEventListener('change', () => renderer?.select(select.value), {
    signal: listeners.signal,
  });

  window.addEventListener(
    'message',
    (event) => {
      if (event.source !== window.parent || event.origin !== parentOrigin || !ready) return;
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      if (message.type === `${namespace}:time` && TIMES_OF_DAY.includes(message.value)) {
        lighting = renderer.setTimeOfDay(message.value);
        notify('time', { value: lighting });
      } else if (message.type === `${namespace}:appearance`) {
        if (/^#[a-f\d]{6}$/i.test(message.background ?? '')) {
          background = message.background;
          document.documentElement.style.setProperty('--hero-background', background);
          renderer.setBackground(background);
        }
        if (Number.isFinite(message.left) && Number.isFinite(message.right))
          renderer.setFrameInsets({ left: message.left, right: message.right });
      } else if (
        message.type === `${namespace}:visibility` &&
        typeof message.visible === 'boolean'
      ) {
        renderer.setMotion(message.visible);
      } else if (message.type === `${namespace}:hello`) {
        notify('ready', { timeOfDay: lighting, selectedKey, hexes: scene.hexes });
      }
    },
    { signal: listeners.signal },
  );

  async function initialize() {
    try {
      const { createMapRenderer } = await import('./ui/map-view.js');
      if (listeners.signal.aborted) return;
      renderer = createMapRenderer(host, {
        motion: true,
        background,
        navigation: false,
        artStyle: 'pixelart',
        embedded: true,
        onSelect: announceSelection,
      });
      if (!renderer) throw new Error('WebGL is unavailable.');
      const canvas = host.querySelector('canvas');
      canvas.tabIndex = -1;
      canvas.setAttribute('aria-label', description);
      canvas.addEventListener('webglcontextlost', () => notify('error'), {
        signal: listeners.signal,
      });
      renderer.setPalette(scene.palette);
      renderer.setTimeOfDay(lighting);
      renderer.setMap(scene.layout, { resetView: true, fitContent: true, artStyle: 'pixelart' });
      renderer.setFrameInsets(frameInsets);
      if (initialSelection) renderer.select(initialSelection);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (listeners.signal.aborted) return;
          ready = true;
          document.body.dataset.ready = 'true';
          notify('ready', { timeOfDay: lighting, selectedKey, hexes: scene.hexes });
        }),
      );
    } catch (error) {
      renderer?.dispose();
      renderer = null;
      document.body.dataset.ready = 'error';
      output.textContent = 'Live map unavailable.';
      notify('error');
      console.warn('Website map could not start.', error);
    }
  }

  window.addEventListener(
    'pagehide',
    (event) => {
      if (event.persisted) return;
      listeners.abort();
      renderer?.dispose();
      renderer = null;
    },
    { signal: listeners.signal },
  );

  void initialize();
}
