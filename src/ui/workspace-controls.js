import { PARTY_KEYS, partyDestinations } from '../application/party-navigation.js';

// Own workspace view controls and shortcuts without owning campaign or renderer state.
export function createWorkspaceControls(
  root,
  { getState, getRenderer, getLayout, isBusy, onPartyMove, notify, refreshPreview },
) {
  const document = root.ownerDocument;
  const element = (id) => root.querySelector(`#hp-${id}`);
  const listeners = new AbortController();
  const listen = (target, type, handler) =>
    target.addEventListener(type, handler, { signal: listeners.signal });
  const mobileLayout = document.defaultView.matchMedia(
    '(max-width: 760px), (max-width: 1024px) and (max-height: 500px)',
  );
  let expanded = false;
  let keyboardNavigation = false;

  function syncSelectionWidth() {
    if (root.hidden || expanded) return;
    const width =
      element('time-of-day').getBoundingClientRect().right -
      element('selection').getBoundingClientRect().left;
    if (width > 0) root.style.setProperty('--map-selection-width', `${width}px`);
  }
  // Follow map resizing, fonts and the changing Time label without duplicating bar dimensions.
  const appearanceSize = new ResizeObserver(syncSelectionWidth);
  appearanceSize.observe(root.querySelector('.hp-map-panel'));
  appearanceSize.observe(element('time-of-day'));

  function setExpanded(enabled) {
    expanded = enabled;
    root.classList.toggle('hp-map-expanded', enabled);
    document.body.classList.toggle('hp-map-expanded', enabled);
    const button = element('expand-map');
    button.setAttribute('aria-label', enabled ? 'Exit expanded map' : 'Expand map to viewport');
    button.setAttribute('aria-pressed', String(enabled));
    button.dataset.tooltip = enabled ? 'Exit expanded map' : 'Expand map';
    if (!enabled) {
      syncSelectionWidth();
      refreshPreview();
    }
  }

  function syncPartyKeys() {
    getRenderer()?.setPartyKeys(Boolean(getState()?.partySelected && keyboardNavigation));
  }

  function syncMobileLayout() {
    const viewControls = element('view-controls');
    const selection = element('selection');
    if (mobileLayout.matches) {
      root.querySelector('.hp-map-stage').append(viewControls);
      root.querySelector('.hp-mobile-map-controls').prepend(selection);
    } else {
      root.querySelector('.hp-tools').prepend(viewControls);
      root.querySelector('.hp-status').prepend(selection);
    }
    if (!mobileLayout.matches) setExpanded(false);
    syncSelectionWidth();
  }

  listen(element('expand-map'), 'click', () => setExpanded(!expanded));
  listen(element('in'), 'click', () => getRenderer()?.zoom(1.2));
  listen(element('out'), 'click', () => getRenderer()?.zoom(1 / 1.2));
  listen(mobileLayout, 'change', syncMobileLayout);
  listen(document, 'pointerdown', () => {
    if (document.documentElement.dataset.mapInput !== 'pointer')
      document.documentElement.dataset.mapInput = 'pointer';
    keyboardNavigation = false;
    if (!root.hidden) getRenderer()?.setPartyKeys(false);
  });
  listen(document, 'keydown', (event) => {
    const renderer = getRenderer();
    if (
      !['+', '=', '-', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key) &&
      document.documentElement.dataset.mapInput !== 'keyboard'
    )
      document.documentElement.dataset.mapInput = 'keyboard';
    if (event.key === 'Tab' && !root.hidden && !document.querySelector('dialog[open]')) {
      keyboardNavigation = true;
      syncPartyKeys();
    }
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      setExpanded(false);
    }
    if (
      root.hidden ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      document.querySelector('dialog[open]') ||
      event.target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .hp-journal-log',
      )
    )
      return;
    if (event.key === 'Tab' || Object.hasOwn(PARTY_KEYS, event.key.toLowerCase())) {
      keyboardNavigation = true;
      syncPartyKeys();
    }
    const shortcut = event.key.toLowerCase();
    if (getState()?.partySelected && Object.hasOwn(PARTY_KEYS, shortcut)) {
      event.preventDefault();
      if (event.repeat || isBusy() || renderer?.isInteracting()) return;
      const target = partyDestinations(getState().campaign.partyToken.key, getLayout()).find(
        (entry) => entry.shortcut === shortcut,
      );
      if (target) onPartyMove(target.key);
      else notify('Map edge: no adjacent hex in that direction.');
      return;
    }
    const pan = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    }[event.key];
    if (pan) {
      event.preventDefault();
      if (!event.repeat && !isBusy()) renderer?.pan(...pan);
      return;
    }
    const factor = event.key === '+' || event.key === '=' ? 1.2 : event.key === '-' ? 1 / 1.2 : 0;
    if (factor) {
      event.preventDefault();
      if (!isBusy()) renderer?.zoom(factor);
    }
  });

  syncMobileLayout();
  return {
    isMobile: () => mobileLayout.matches,
    setExpanded,
    syncPartyKeys,
    syncFog(enabled) {
      element('fog').setAttribute('aria-checked', String(enabled));
      element('fog').dataset.tooltip = enabled ? 'Turn fog of war off' : 'Turn fog of war on';
      root.dataset.fogOfWar = String(enabled);
    },
    dispose() {
      setExpanded(false);
      appearanceSize.disconnect();
      root.style.removeProperty('--map-selection-width');
      listeners.abort();
    },
  };
}
