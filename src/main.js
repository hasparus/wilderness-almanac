import { generateWorld, GENERATOR_VERSION } from './generation/world.js';
import { prepareMap } from './generation/presentation.js';
import { palettes, paletteNames, DEFAULT_PALETTE } from './palette.js';
import { campaignUITheme } from './ui/campaign-theme.js';
import { createUITheme } from './ui/theme.js';
import { readUIPreferences, saveUIPreferences } from './ui/ui-preferences.js';
import { createBrowserStore } from './persistence/browser-store.js';
import { readMapLink, describeHex, shortCoordinates } from './ui/map-link.js';
import { createMapConsole } from './ui/map-console.js';
import { createSaveStatus } from './ui/save-status.js';
import { createCampaign, campaignIconCandidates } from './application/campaigns.js';
import { createFogViewer } from './application/fog-view.js';
import { createCampaignSession } from './application/campaign-session.js';
import { timeOfDay, nextTimeOfDay } from './application/time-of-day.js';
import { timeIncrementLabels } from './application/campaign-time.js';
import { createCampaignMenu } from './ui/campaign-menu.js';
import { createPaletteLibrary } from './application/palette-library.js';
import { createPaletteManager } from './ui/palette-manager.js';
import { createSettings } from './ui/settings.js';
import { createCampaignHistory } from './ui/campaign-history.js';
import { createCampaignCreator } from './ui/campaign-creator.js';
import { createPanels } from './ui/panels.js';
import { createHexInspector } from './ui/hex-inspector.js';
import { createPartyInspector } from './ui/party-inspector.js';
import { createPartyJournal } from './ui/party-journal.js';
import { createBatchInspector } from './ui/batch-inspector.js';
import { createMapAction } from './ui/map-action.js';
import { loadThumbnails, saveThumbnails } from './ui/thumbnail-cache.js';
import { afterPaint, createViewNavigation } from './ui/view-navigation.js';
import { createCampaignLoadingShell } from './ui/campaign-loading-shell.js';
import { createControlTooltips } from './ui/control-help.js';
import { createWorkspaceControls } from './ui/workspace-controls.js';
import { createMapSelection, PARTY_SELECTION } from './ui/map-selection.js';
import { hexAddress } from './generation/hex.js';

const root = document.getElementById('campaign-workspace');
const navigation = createViewNavigation(document.getElementById('campaign-menu'), root);
const loadingShell = createCampaignLoadingShell(root);
if (document.documentElement.hasAttribute('data-campaign-entry')) {
  document.getElementById('campaign-menu').hidden = true;
  root.hidden = false;
  root.inert = true;
  loadingShell.show('Opening campaign…');
  document.documentElement.removeAttribute('data-campaign-entry');
}
const element = (id) => root.querySelector(`#hp-${id}`);
const mapAction = createMapAction(root, (text) => {
  element('announcement').textContent = text;
});
let storage;
try {
  storage = window.localStorage;
} catch {
  /* Restricted browser storage. */
}
const browserStore = await createBrowserStore({
  storageManager: navigator.storage,
});
const saved = { ...browserStore.preferences, ...readUIPreferences(storage) };
saveUIPreferences(storage, saved);
const linked = readMapLink(window.location.href);
const freshSeed = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(2)), (part) =>
    part.toString(16).padStart(8, '0'),
  ).join('-');
const initialColors = linked.colors ?? saved.colors ?? palettes[DEFAULT_PALETTE].slice();
const paletteLibrary = createPaletteLibrary(saved);
const savedPalettes = paletteLibrary.custom;
let layout;
let displayView;
let presentedStyle;
const fogViewer = createFogViewer();
let inspector;
let batchInspector;
let partyInspector;
let partyJournal;
const activeInspector = () =>
  session.snapshot()?.partySelected
    ? partyInspector
    : session.snapshot()?.multiEdit
      ? batchInspector
      : inspector;
let cellsByKey = new Map();
let renderer;
let mapView;
let mapViewLoading;
let disposed = false;
let iconCacheRevision = 0;
let iconCacheTimer;
let partyButtonSignature = '';
const session = createCampaignSession({ persist: persistCampaign });
const initialVariant =
  linked.variant ?? (linked.seed && linked.seed !== saved.seed ? 0 : (saved.variant ?? 0));
let defaultMovement = saved.motion ?? true;
let movement = defaultMovement;
let defaultJournalFirst = saved.journalFirst ?? false;
const campaignSettings = Object.assign(Object.create(null), saved.campaignSettings);
let defaultTimeOfDay = saved.defaultTimeOfDay ?? 'dawn';
let defaultMapArtStyle = saved.defaultMapArtStyle ?? 'low-poly';
let defaultTimeIncrement = saved.timeIncrement ?? 'week';
let campaignTimeIncrement = defaultTimeIncrement;
let campaignHistory;
const selection = element('selection');
const preset = element('preset');
const message = element('message');
const saveStatus = createSaveStatus(({ campaigns, preferences, message }) => {
  document.getElementById('campaign-save-warning').hidden = !campaigns && !preferences;
  document.getElementById('campaign-save-message').textContent = message;
  element('save-warning').hidden = !campaigns && !preferences;
  element('save-message').textContent = message;
  element('download-unsaved').hidden = !campaigns;
});
const listeners = new AbortController();
const listen = (target, type, handler) =>
  target.addEventListener(type, handler, { signal: listeners.signal });
const panels = createPanels(root, saved, () => {
  persistPreferences();
  inspector?.refreshPreview();
  partyInspector?.refreshPreview();
});
const mapConsole = createMapConsole({
  write(text, kind) {
    message.textContent = kind === 'summary' ? text.replace(' · ', '\n· ') : text;
    message.title = text;
    message.dataset.kind = kind;
    const notice = element('mobile-notice');
    notice.textContent = text;
    notice.dataset.kind = kind;
    notice.hidden = !['action', 'error'].includes(kind) || !text;
  },
  announce(text) {
    element('announcement').textContent = text;
  },
});
const controlTooltips = createControlTooltips();
const workspaceControls = createWorkspaceControls(root, {
  getState: session.snapshot,
  getRenderer: () => renderer,
  getLayout: () => displayView.layout,
  isBusy: () => root.hasAttribute('data-loading') || mapAction.isBusy(),
  onPartyMove: (key) => handleAction(session.moveParty(key)),
  notify: (text) => mapConsole.notify(text),
  refreshPreview() {
    inspector?.refreshPreview();
    partyInspector?.refreshPreview();
  },
});
const mapSelection = createMapSelection(root, {
  session,
  getRenderer: () => renderer,
  getInspectors: () => ({ hex: inspector, batch: batchInspector, party: partyInspector }),
  isBusy: () => root.hasAttribute('data-loading') || mapAction.isBusy(),
  isMobile: workspaceControls.isMobile,
  syncSelection,
  onPartySelected() {
    panels.openParty();
    partyJournal?.reveal();
  },
  updateInspector,
  onAction: handleAction,
  onHover: (key) => mapConsole.hover(shortCoordinates(cellsByKey.get(key))),
  notify: (text) => mapConsole.notify(text),
});

let campaignMenu;
let campaignCreator;
let preferencesRevision = 0;
let preferencesFailed = false;
function persistPreferences() {
  // Noncritical UI defaults and panel preferences stay in localStorage.
  return saveUIPreferences(storage, {
    ...panels.preferences(),
    motion: defaultMovement,
    journalFirst: defaultJournalFirst,
    defaultTimeOfDay,
    defaultMapArtStyle,
    timeIncrement: defaultTimeIncrement,
    campaignSettings,
  });
}

async function persistPalettes() {
  const revision = ++preferencesRevision;
  const success = await browserStore.save({ palettes: paletteLibrary.preferences() });
  if (revision === preferencesRevision) {
    preferencesFailed = !success;
    saveStatus.update('preferences', success);
  }
  return success;
}

async function persistCampaign(campaign) {
  campaignHistory?.update(campaign);
  persistPreferences();
  const revision = ++preferencesRevision;
  const campaignSaved = await campaignMenu.update(campaign, paletteLibrary.preferences());
  if (revision === preferencesRevision) {
    preferencesFailed = !campaignSaved;
    saveStatus.update('preferences', campaignSaved);
  }
  return { campaignSaved, preferencesSaved: campaignSaved };
}

async function retrySaving() {
  const uiSaved = persistPreferences();
  const revision = ++preferencesRevision;
  const success = await campaignMenu.save(
    paletteLibrary.preferences(),
    session.snapshot()?.campaign.id,
  );
  if (revision === preferencesRevision) {
    preferencesFailed = !success || !uiSaved;
    saveStatus.update('preferences', success && uiSaved);
  }
}
listen(document.getElementById('retry-campaign-save'), 'click', retrySaving);
listen(element('retry-save'), 'click', retrySaving);
const downloadUnsaved = () => campaignMenu.downloadRecovery(paletteLibrary.preferences());
listen(document.getElementById('download-unsaved-library'), 'click', downloadUnsaved);
listen(element('download-unsaved-data'), 'click', downloadUnsaved);
listen(window, 'beforeunload', (event) => {
  if (
    browserStore.status().pending ||
    browserStore.status().unsaved ||
    preferencesFailed ||
    (browserStore.status().reason && session.snapshot())
  ) {
    event.preventDefault();
    event.returnValue = '';
  }
});

async function loadMapView() {
  mapViewLoading ??= import('./ui/map-view.js').catch((error) => {
    mapViewLoading = undefined;
    throw error;
  });
  mapView = await mapViewLoading;
  return mapView;
}

async function openCampaign(campaign, { fromHistory = false } = {}) {
  renderer?.cancelInteraction();
  try {
    const opened = await navigation.show(
      'forward',
      () => {
        loadingShell.show(campaign.name);
        clearTimeout(iconCacheTimer);
        iconCacheRevision++;
        renderer?.setMotion(false);
        const local = campaignSettings[campaign.id] ?? {};
        movement = local.motion ?? defaultMovement;
        campaignTimeIncrement = local.timeIncrement ?? defaultTimeIncrement;
        panels.setMultiEdit(false);
        panels.setInspectorMode('hex');
        panels.enterCampaign(campaign.id, {
          journalFirst: local.journalFirst ?? defaultJournalFirst,
        });
      },
      async () => {
        await loadMapView();
        if (disposed) return false;
        const keepView = Boolean(renderer && session.snapshot()?.campaign.id === campaign.id);
        session.open(campaign);
        presentCampaign({ resetView: !keepView });
        loadingShell.finish();
        if (!fromHistory) campaignHistory?.enter(session.snapshot().campaign);
      },
    );
    if (opened) {
      inspector.refreshPreview();
    }
    return opened;
  } catch (error) {
    renderer?.setMotion(false);
    document.title = 'The Wilderness Almanac';
    throw error;
  } finally {
    loadingShell.finish();
  }
}

function presentCampaign({ resetView = false } = {}) {
  const { campaign, world } = session.snapshot();
  inspector.reset();
  batchInspector.reset();
  root.hidden = false;
  if (!renderer)
    renderer = mapView.createCampaignMapRenderer(element('scene'), {
      motion: movement,
      touchMultiSelect: true,
      onPartyMove: mapSelection.moveParty,
      onPartySelect: mapSelection.selectParty,
      onSelect: mapSelection.selectHex,
      onHover(key) {
        mapConsole.hover(shortCoordinates(cellsByKey.get(key)));
      },
    });
  if (!renderer) throw new Error('This map needs WebGL support. Try again or use another browser.');
  renderer?.setMotion(movement);
  syncTimeOfDay();
  applyPalette();
  renderWorld({ resetView });
  renderer?.focus(campaign.partyToken.key, { hexesWide: 9 / 1.2 });
  root.querySelector('.hp-title').textContent = campaign.name;
  document.title = `${campaign.name} · Wilderness Almanac`;
  root.dataset.mapName = world.name;
  root.dataset.seed = campaign.seed;
  root.dataset.hexCount = String(world.cells.length);
  mapConsole.reset(`${world.cells.length} hexes · ${world.regions.length} regions`);
  scheduleCampaignIcons();
}

function scheduleCampaignIcons() {
  const revision = ++iconCacheRevision;
  clearTimeout(iconCacheTimer);
  // Let the map and page transition paint before preparing still previews.
  iconCacheTimer = setTimeout(() => void cacheCampaignIcons(revision), 300);
}

async function cacheCampaignIcons(revision) {
  const { campaign, world } = session.snapshot();
  const tiles = layout;
  const current = () => !disposed && revision === iconCacheRevision;
  try {
    const previous = await loadThumbnails(campaign);
    const cached = new Map(previous.map((entry) => [entry.key, entry]));
    const keys = [
      ...new Set([...campaignIconCandidates(world).map((cell) => cell.key), campaign.iconKey]),
    ];
    const images = new Map();
    const entries = () => keys.map((key) => images.get(key)).filter(Boolean);
    // Publish the chosen tile first; a cancelled gallery job still leaves a cover.
    for (const key of new Set([campaign.iconKey, ...keys])) {
      if (!current()) return;
      let entry = cached.get(key);
      if (!entry) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!current()) return;
        const image = mapView.tilePreview(
          tiles?.find((tile) => tile.key === key),
          campaign.colors,
          { artStyle: campaign.artStyle },
        );
        if (image) entry = { key, image };
      }
      if (!entry && key === campaign.iconKey) return;
      if (entry) images.set(key, entry);
      if (key === campaign.iconKey && !cached.has(key)) {
        await saveThumbnails(campaign, entries());
        if (current()) campaignMenu.refreshThumbnail(campaign);
      }
    }
    const gallery = entries();
    if (!current()) return;
    if (
      gallery.length !== previous.length ||
      gallery.some((entry, index) => entry !== previous[index])
    )
      await saveThumbnails(campaign, gallery);
    if (current()) campaignMenu.refreshThumbnail(campaign);
  } catch {
    /* Optional thumbnails never interfere with the current campaign. */
  }
}

function handleAction(result) {
  if (!result.ok) {
    if (result.error) {
      activeInspector().error(result.error);
      mapConsole.error(result.error);
    }
    return false;
  }
  if (result.scope === 'journal') {
    partyJournal?.update({
      ...session.snapshot(),
      visibleWorld: displayView.world,
      visibleLayout: displayView.layout,
    });
    if (session.snapshot().partySelected) updateInspector();
  } else if (result.scope === 'appearance') {
    syncTimeOfDay();
    applyPalette();
    refreshPresentation();
    syncSelection();
    updateInspector();
  } else if (result.scope === 'lighting') syncTimeOfDay();
  else if (result.scope === 'world') renderWorld();
  else {
    if (result.scope === 'palette') applyPalette();
    refreshPresentation();
    syncSelection();
    updateInspector();
  }
  syncParty();
  if (['world', 'palette', 'icon', 'appearance'].includes(result.scope)) scheduleCampaignIcons();
  if (result.notification) mapConsole.notify(result.notification);
  return true;
}

function refreshPresentation({ resetView = false } = {}) {
  const { world, campaign, visibility } = session.snapshot();
  workspaceControls.syncFog(Boolean(campaign.fogOfWar));
  const view = fogViewer(world, layout, visibility);
  const artStyle = campaign.artStyle ?? 'low-poly';
  if (view === displayView && artStyle === presentedStyle) return;
  displayView = view;
  presentedStyle = artStyle;
  cellsByKey = new Map(displayView.world.cells.map((cell) => [cell.key, cell]));
  const partyOption = document.createElement('option');
  partyOption.value = PARTY_SELECTION;
  partyOption.textContent = campaign.partyToken.name ?? 'Adventurers';
  selection.replaceChildren(
    partyOption,
    ...displayView.layout.map((cell) => {
      const option = document.createElement('option');
      option.value = cell.key;
      option.textContent = describeHex(cell);
      if (cell.fogState !== 'undiscovered') {
        option.dataset.elevation = String(cell.elevation);
        option.dataset.terrain = cell.terrain;
        option.dataset.settlement = cell.pointOfLight?.type ?? '';
        option.dataset.poi =
          cell.pointsOfInterest.map((poi) => poi.kind).join(',') || cell.crossing?.kind || '';
      }
      return option;
    }),
  );
  renderer?.setMap(displayView.layout, {
    source: layout,
    resetView,
    preserveFraming: !resetView,
    artStyle,
  });
  renderer?.select(session.snapshot().selected, { notify: false });
  syncParty();
}

function renderWorld({ resetView = false } = {}) {
  const { world, dressing, campaign } = session.snapshot();
  layout = prepareMap(world, dressing);
  refreshPresentation({ resetView });
  syncSelection();
  root.dataset.variant = String(campaign.variant);
  updateInspector();
}

function updatePaletteOptions() {
  preset.replaceChildren(
    ...paletteLibrary.all().map((palette) => {
      const option = document.createElement('option');
      option.value = palette.id;
      option.textContent = palette.name;
      return option;
    }),
  );
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.hidden = true;
  custom.textContent = 'Current campaign colours';
  preset.append(custom);
}

function applyWorkspaceTheme() {
  const colors = session.snapshot()?.campaign.colors ?? initialColors;
  const { panel, ...roles } = campaignUITheme(colors, document.documentElement.dataset.theme);
  for (const [role, value] of Object.entries(roles)) root.style.setProperty(`--hp-${role}`, value);
  root.style.setProperty('--hp-panel-bg', panel);
  renderer?.setBackground(document.documentElement.dataset.theme === 'light' ? roles.bg : null);
  campaignCreator?.refreshTheme();
}

function applyPalette() {
  const colors = session.snapshot()?.campaign.colors ?? initialColors;
  renderer?.setPalette(colors);
  syncParty();
  applyWorkspaceTheme();
  selectPalette(colors);
}

function syncParty() {
  const campaign = session.snapshot()?.campaign;
  if (campaign?.partyToken) {
    renderer?.setParty(campaign.partyToken, campaign.colors);
    const option = selection.querySelector(`option[value="${PARTY_SELECTION}"]`);
    if (option) option.textContent = campaign.partyToken.name ?? 'Adventurers';
    const color = campaign.partyToken.color ?? mapView.partyColor(campaign.colors);
    const signature = JSON.stringify([
      campaign.partyToken.style,
      color,
      campaign.colors,
      campaign.artStyle,
    ]);
    if (signature !== partyButtonSignature) {
      const src = mapView.partyPreview(
        campaign.partyToken,
        campaign.colors,
        color,
        campaign.artStyle,
      );
      if (src) {
        const image = element('find-party-preview');
        image.src = src;
        image.hidden = false;
        element('find-party').querySelector('svg').setAttribute('hidden', '');
        partyButtonSignature = signature;
      }
    }
  }
}

function paletteId(colors, name) {
  const matches = paletteLibrary
    .all()
    .filter((palette) =>
      palette.colors.every((color, index) => color.toLowerCase() === colors[index].toLowerCase()),
    );
  return (matches.find((palette) => palette.name === name) ?? matches[0])?.id ?? 'custom';
}
function selectPalette(colors) {
  preset.value = paletteId(colors, session.snapshot()?.campaign.paletteName);
}

function paletteLabel(candidate) {
  const same = (other) =>
    other.every((color, index) => color.toLowerCase() === candidate[index].toLowerCase());
  const builtin = Object.keys(palettes).find((key) => same(palettes[key]));
  return builtin
    ? paletteNames[builtin]
    : (savedPalettes.find((palette) => same(palette.colors))?.name ?? 'Custom');
}

function syncTimeOfDay() {
  const value = timeOfDay(session.snapshot()?.campaign.timeOfDay);
  const label = value[0].toUpperCase() + value.slice(1);
  const next = nextTimeOfDay(value);
  element('time-of-day-label').textContent = `Time: ${label}`;
  element('time-of-day').dataset.tooltip =
    `Change time to ${next[0].toUpperCase() + next.slice(1)}`;
  element('time-of-day')
    .querySelector('use')
    .setAttribute(
      'href',
      `/icons/pixelarticons.svg#${value === 'dawn' || value === 'day' ? 'sun' : 'moon'}`,
    );
  renderer?.setTimeOfDay(value);
  root.dataset.timeOfDay = value;
}
listen(element('time-of-day'), 'click', () => {
  handleAction(session.setTimeOfDay(nextTimeOfDay(session.snapshot().campaign.timeOfDay)));
});
listen(element('fog'), 'click', () => {
  if (mapAction.isBusy()) return;
  const enabled = !session.snapshot().campaign.fogOfWar;
  const change = () => {
    inspector.reset();
    batchInspector.reset();
    return handleAction(session.fogOfWar(enabled));
  };
  if (activeInspector().beforeLeave(change)) change();
});
function syncSelection() {
  const state = session.snapshot();
  if (!state) return;
  renderer?.setSelection(state.partySelected ? [] : state.multiEdit ? state.selectedKeys : null);
  renderer?.setPartySelected(state.partySelected);
  root.dataset.multiEdit = String(state.multiEdit);
  root.dataset.selectionCount = String(
    state.partySelected ? 0 : state.multiEdit ? state.selectedKeys.length : 1,
  );
  root.dataset.selected = state.partySelected ? '' : state.selected;
  selection.value = state.partySelected ? PARTY_SELECTION : state.selected;
  selection.setAttribute(
    'aria-label',
    state.multiEdit ? 'Add or remove a hex' : 'Select hex or party',
  );
  workspaceControls.syncPartyKeys();
  singleInspectorHost.hidden = state.partySelected || state.multiEdit;
  batchInspectorHost.hidden = state.partySelected || !state.multiEdit;
  partyInspectorHost.hidden = !state.partySelected;
  panels.setMultiEdit(state.multiEdit);
  panels.setInspectorMode(state.partySelected ? 'party' : 'hex');
  partyJournal?.update({
    ...state,
    visibleWorld: displayView.world,
    visibleLayout: displayView.layout,
  });
}
function toggleMultiEdit() {
  const change = () => {
    session.setMultiEdit(!session.snapshot().multiEdit);
    inspector.reset();
    batchInspector.reset();
    syncSelection();
    updateInspector();
    mapConsole.notify(session.snapshot().multiEdit ? 'Multiselect on' : 'Multiselect off');
    const focus = root.querySelector(
      session.snapshot().multiEdit ? '#hp-batch-count' : '#hp-hex-edit',
    );
    if (panels.inspectorVisible()) focus?.focus({ preventScroll: true });
  };
  if (!mapAction.isBusy() && activeInspector().beforeLeave(change)) change();
}
async function showMenu() {
  await navigation.show('back', () => {
    renderer?.cancelInteraction();
    workspaceControls.setExpanded(false);
    session.save();
    renderer?.setMotion(false);
    document.title = 'The Wilderness Almanac';
    campaignMenu.show();
  });
}
listen(element('back-menu'), 'click', () => {
  if (!mapAction.isBusy()) campaignHistory.back();
});
listen(element('download-unsaved'), 'click', () =>
  campaignMenu.download(session.snapshot().campaign),
);
listen(preset, 'change', () => {
  const palette = paletteLibrary.get(preset.value);
  if (palette) handleAction(session.palette(palette.colors, palette.name));
});

function updateInspector() {
  const state = session.snapshot();
  if (!state) return;
  const { dressing, selected, campaign, canUndo } = state;
  if (state.partySelected) {
    partyInspector?.update({ ...state, visibleWorld: displayView.world });
    return;
  }
  if (state.multiEdit) {
    const keys = new Set(state.selectedKeys);
    batchInspector?.update({
      cells: displayView.world.cells.filter((cell) => keys.has(cell.key)),
      fogOfWar: Boolean(campaign.fogOfWar),
      edits: campaign.hexEdits?.cells,
      dressing: displayView.layout,
      join: campaign.fogOfWar ? null : state.join,
      canUndo,
      undoLabel: state.undoLabel,
      undoReason: state.undoReason,
    });
    return;
  }
  const colors = campaign.colors;
  const cell = cellsByKey.get(selected);
  if (!cell || !dressing || !layout) return;
  const edit = campaign.hexEdits?.cells[selected];
  inspector?.update({
    world: displayView.world,
    cell,
    dressed: displayView.layout.find((entry) => entry.key === selected),
    tile: displayView.layout.find((entry) => entry.key === selected),
    fogOfWar: Boolean(campaign.fogOfWar),
    colors,
    artStyle: campaign.artStyle ?? 'low-poly',
    visited: edit?.visited ?? false,
    cropStyle: edit?.cropStyle,
    locked: Boolean(edit?.lock),
    canUndo,
    undoLabel: state.undoLabel,
    undoReason: state.undoReason,
    isIcon: campaign.iconKey === selected,
  });
}

const singleInspectorHost = document.createElement('div');
const batchInspectorHost = document.createElement('div');
const partyInspectorHost = document.createElement('div');
const partyJournalHost = document.createElement('div');
partyInspectorHost.className = 'hp-party-metadata';
partyJournalHost.className = 'hp-party-journal';
panels.party.append(partyInspectorHost, partyJournalHost);
partyJournal = createPartyJournal(partyJournalHost, {
  getTimeIncrement: () => campaignTimeIncrement,
  isBusy: mapAction.isBusy,
  onSubmit(text, mentions, week) {
    const result = session.addJournal(text, mentions, undefined, { week });
    if (result.ok) handleAction(result);
    return result;
  },
  onEdit(id, text, mentions) {
    const result = session.editJournal(id, text, mentions);
    if (result.ok) handleAction(result);
    return result;
  },
  onNextWeek() {
    const result = session.nextWeek(campaignTimeIncrement);
    if (result.ok) handleAction(result);
    return result;
  },
  onEntryAction(action, id) {
    const result = action === 'delete' ? session.deleteJournal(id) : session.regenerateJournal(id);
    if (result.ok) handleAction(result);
    return result;
  },
  onMention(type, key) {
    if (type === 'party') mapSelection.selectParty();
    else if (cellsByKey.has(key)) {
      renderer.select(key);
      const state = session.snapshot();
      if (!state.partySelected && !state.multiEdit && state.selected === key) renderer.focus(key);
    }
  },
});
partyInspectorHost.hidden = true;
batchInspectorHost.hidden = true;
panels.inspector.append(singleInspectorHost, batchInspectorHost);
partyInspector = createPartyInspector(partyInspectorHost, {
  getTimeIncrement: () => campaignTimeIncrement,
  nameHost: panels.partyHeader,
  onShowWeek: (week) => partyJournal.showWeek(week),
  onChange: (patch) => handleAction(session.partyDetails(patch)),
  onNavigate(key) {
    if (mapAction.isBusy()) return;
    renderer.select(key);
    const state = session.snapshot();
    if (!state.partySelected && !state.multiEdit && state.selected === key) {
      renderer.focus(key);
      mapConsole.notify(`Showing ${hexAddress(cellsByKey.get(key))}`);
    }
  },
  onSelectVisited: (button) =>
    mapAction.run(
      button,
      () => {
        if (!session.selectVisited()) return;
        inspector.reset();
        batchInspector.reset();
        renderer.select(session.snapshot().selected, { notify: false });
        syncSelection();
        updateInspector();
        mapConsole.notify(`${session.snapshot().selectedKeys.length} visited hexes selected`);
      },
      'Selecting…',
    ),
  preview: (party, colors, color) =>
    mapView?.partyPreview(party, colors, color, session.snapshot()?.campaign.artStyle) ?? '',
  colorFor: (colors) => mapView.partyColor(colors),
  visible: panels.partyVisible,
});
inspector = createHexInspector(singleInspectorHost, {
  visible: panels.inspectorVisible,
  preview: (tile, colors) =>
    mapView?.tilePreview(tile, colors, {
      artStyle: session.snapshot()?.campaign.artStyle,
    }) ?? '',
  onApply: (patch, button) => mapAction.run(button, () => handleAction(session.apply(patch))),
  onVisit: (event) =>
    mapAction.run(event.currentTarget, () => handleAction(session.visit()), 'Updating visit…'),
  onLock: () => handleAction(session.lock()),
  onRegenerate: (event) =>
    mapAction.run(
      event.currentTarget,
      () => handleAction(session.regenerateHex()),
      'Regenerating…',
    ),
  onReset: (event) =>
    mapAction.run(event.currentTarget, () => handleAction(session.reset()), 'Resetting…'),
  onUndo: (event) =>
    mapAction.run(event.currentTarget, () => handleAction(session.undo()), 'Undoing…'),
  onSetIcon: () => handleAction(session.icon()),
  onMultiEdit: toggleMultiEdit,
  onNotify: (text) => mapConsole.notify(text),
});
batchInspector = createBatchInspector(batchInspectorHost, {
  onNotify: (text) => mapConsole.notify(text),
  onApply: (patch, button) => mapAction.run(button, () => handleAction(session.applyBatch(patch))),
  onJoin: (button) =>
    mapAction.run(button, () => handleAction(session.joinSelection()), 'Joining…'),
  onResetSelected: (button) =>
    mapAction.run(
      button,
      () => handleAction(session.resetSelected({ confirmed: true })),
      'Resetting…',
    ),
  onUndo: (button) => mapAction.run(button, () => handleAction(session.undo()), 'Undoing…'),
  onSelectAll: (button) =>
    mapAction.run(
      button,
      () => {
        session.selectAll();
        syncSelection();
        updateInspector();
        mapConsole.notify(`${session.snapshot().selectedKeys.length} hexes selected`);
      },
      'Selecting…',
    ),
  onTurnOff: toggleMultiEdit,
  onClear: (button) =>
    mapAction.run(
      button,
      () => {
        session.clearSelection();
        syncSelection();
        updateInspector();
        mapConsole.notify('Selection cleared');
      },
      'Clearing…',
    ),
});

updatePaletteOptions();
const uiTheme = createUITheme({ storage, onChange: applyWorkspaceTheme });
applyPalette();
campaignMenu = createCampaignMenu({
  store: browserStore,
  getTimeIncrement: (campaign) =>
    campaignSettings[campaign.id]?.timeIncrement ?? defaultTimeIncrement,
  defaultPalette: () => {
    const palette = paletteLibrary.default();
    return { colors: palette.colors, paletteName: palette.name };
  },
  onEnter: openCampaign,
  onNewCampaign: () => campaignCreator.open(),
  saveStatus,
});
campaignCreator = createCampaignCreator({
  library: paletteLibrary,
  loadMapView,
  freshSeed,
  defaultTimeOfDay: () => defaultTimeOfDay,
  defaultMapArtStyle: () => defaultMapArtStyle,
  backgroundFor: (colors) =>
    uiTheme.current() === 'light' ? campaignUITheme(colors, 'light').bg : null,
  async onCreate(campaign) {
    await campaignMenu.add(campaign);
    return campaignMenu.enter(campaign);
  },
});
const paletteManager = createPaletteManager({
  library: paletteLibrary,
  onChoose(id) {
    const picker = document.getElementById('settings-palette');
    if (!picker.querySelector(`option[value="${id}"]`)) {
      const palette = paletteLibrary.get(id);
      const option = document.createElement('option');
      option.value = id;
      option.textContent = palette.name;
      picker.append(option);
    }
    picker.value = id;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  },
  onChange() {
    updatePaletteOptions();
    selectPalette(session.snapshot()?.campaign.colors ?? initialColors);
    return persistPalettes();
  },
});
const settings = createSettings({
  library: paletteLibrary,
  canRegenerate: () => !session.snapshot()?.campaign.fogOfWar,
  read: () => ({
    defaultTimeOfDay,
    defaultMapArtStyle,
    motion: defaultMovement,
    journalFirst: defaultJournalFirst,
    timeIncrement: defaultTimeIncrement,
    theme: uiTheme.preference(),
  }),
  readCampaign() {
    const campaign = session.snapshot().campaign;
    return {
      id: campaign.id,
      defaultPalette: paletteId(campaign.colors, campaign.paletteName),
      defaultTimeOfDay: timeOfDay(campaign.timeOfDay),
      defaultMapArtStyle: campaign.artStyle ?? 'low-poly',
      motion: movement,
      journalFirst: panels.journalFirst(),
      timeIncrement: campaignTimeIncrement,
      theme: uiTheme.current(),
    };
  },
  async onCampaignSave(values, id) {
    const campaign = session.snapshot().campaign;
    if (root.hidden || campaign.id !== id)
      throw new Error('Reopen this campaign’s appearance settings.');
    const palette = paletteLibrary.get(values.defaultPalette);
    const appearance = {
      colors: palette?.colors ?? campaign.colors,
      paletteName: palette?.name ?? campaign.paletteName,
      timeOfDay: values.defaultTimeOfDay,
      artStyle: values.defaultMapArtStyle,
    };
    const changed =
      JSON.stringify([
        appearance.colors,
        appearance.paletteName,
        appearance.timeOfDay,
        appearance.artStyle,
      ]) !==
      JSON.stringify([
        campaign.colors,
        campaign.paletteName,
        campaign.timeOfDay,
        campaign.artStyle ?? 'low-poly',
      ]);
    const result = changed ? session.appearance(appearance) : undefined;
    if (result && !result.ok) throw new Error(result.error);
    if (
      values.motion !== movement ||
      values.journalFirst !== panels.journalFirst() ||
      values.timeIncrement !== campaignTimeIncrement
    )
      campaignSettings[id] = {
        motion: values.motion,
        journalFirst: values.journalFirst,
        timeIncrement: values.timeIncrement,
      };
    movement = values.motion;
    campaignTimeIncrement = values.timeIncrement;
    panels.setJournalFirst(values.journalFirst);
    uiTheme.choose(values.theme);
    renderer?.setMotion(movement);
    if (result) handleAction(result);
    else {
      syncSelection();
      updateInspector();
      mapConsole.notify('Appearance saved');
    }
    const uiSaved = persistPreferences();
    const stored = changed ? await session.save() : { saved: true };
    if (!uiSaved || !stored.saved)
      throw new Error(
        'These settings are active but could not be saved. Keep this page open and retry.',
      );
  },
  onRegenerate(button) {
    return mapAction.run(button, () => handleAction(session.regenerate()), 'Regenerating…');
  },
  async onSave(values, imported) {
    paletteLibrary.setDefault(values.defaultPalette);
    defaultTimeOfDay = values.defaultTimeOfDay;
    defaultMapArtStyle = values.defaultMapArtStyle;
    defaultTimeIncrement = timeIncrementLabels(values.timeIncrement).unit;
    defaultMovement = values.motion;
    defaultJournalFirst = values.journalFirst;
    uiTheme.choose(values.theme);
    renderer?.setMotion(false);
    const uiSaved = persistPreferences();
    const revision = ++preferencesRevision;
    const saved = imported
      ? await campaignMenu.add(imported, paletteLibrary.preferences())
      : await campaignMenu.save(paletteLibrary.preferences());
    if (revision === preferencesRevision) {
      preferencesFailed = !saved || !uiSaved;
      saveStatus.update('preferences', saved && uiSaved);
    }
    campaignMenu.render();
    const message = document.getElementById('campaign-message');
    message.dataset.kind = saved && uiSaved ? 'status' : 'error';
    message.textContent =
      !saved || !uiSaved
        ? 'Some settings could not be saved in this browser. Keep this page open and retry saving.'
        : imported
          ? `Settings saved. Imported “${imported.name}”.`
          : 'Settings saved.';
  },
});
listen(element('appearance-settings'), 'click', () => {
  const open = () => settings.openCampaign();
  if (!mapAction.isBusy() && activeInspector().beforeLeave(open)) open();
});
const accountButton = document.getElementById('open-account');
accountButton.hidden = import.meta.env.VITE_API_ENABLED !== 'true';
let accountPanel;
let accountLoading;
listen(accountButton, 'click', async () => {
  accountButton.disabled = true;
  try {
    accountLoading ??= import('./ui/account-sync.js');
    const { createAccountPanel } = await accountLoading;
    if (disposed) return;
    accountPanel ??= createAccountPanel({ store: browserStore, library: campaignMenu });
    // Disabling a button during lazy loading removes browser focus. Restore it
    // before openDialog captures the invoker for its close/focus contract.
    accountButton.disabled = false;
    accountButton.focus({ preventScroll: true });
    await accountPanel.open();
  } catch {
    accountLoading = undefined;
    document.getElementById('campaign-message').textContent =
      'Account sync could not open. Your local campaigns are still available.';
  } finally {
    accountButton.disabled = false;
  }
});
const replayState = {
  artStyle: linked.artStyle,
  seed: linked.seed,
  generatorVersion: linked.generatorVersion ?? GENERATOR_VERSION,
  preferences: linked.preferences,
  variant: initialVariant,
  colors: initialColors,
};
const matchesLink = (campaign) =>
  !linked.seed ||
  campaignMenu.findReplay({ ...replayState, campaignId: campaign.id })?.id === campaign.id;
campaignHistory = createCampaignHistory({
  hasCampaign: (id) =>
    browserStore.campaigns.some((campaign) => campaign.id === id && matchesLink(campaign)),
  async onNavigate(id, retry) {
    if (mapAction.isBusy() || document.querySelector('dialog[open]')) return false;
    if (!root.hidden && !activeInspector().beforeLeave(retry)) return false;
    if (id === null) {
      await showMenu();
      return true;
    }
    const campaign = campaignMenu.snapshotCampaigns().find((campaign) => campaign.id === id);
    if (!campaign) return false;
    try {
      return root.hidden
        ? await campaignMenu.enter(campaign, undefined, { fromHistory: true })
        : await openCampaign(campaign, { fromHistory: true });
    } catch (error) {
      document.getElementById('campaign-message').textContent =
        `Could not open the map. ${error.message}`;
      return false;
    }
  },
});
/** Restore the library when startup does not resolve to a campaign. @returns {void} */
function showInitialMenu() {
  loadingShell.finish();
  root.hidden = true;
  root.inert = false;
  campaignMenu.show();
  document.title = 'The Wilderness Almanac';
}
/** @param {ReturnType<typeof createCampaign>} campaign @returns {Promise<void>} */
async function openInitialCampaign(campaign) {
  try {
    await openCampaign(campaign);
  } catch (error) {
    showInitialMenu();
    const message = document.getElementById('campaign-message');
    message.textContent = `Could not open the map. ${error.message}`;
    message.dataset.kind = 'error';
  }
}
const routedCampaign = campaignMenu
  .snapshotCampaigns()
  .find((campaign) => campaign.id === campaignHistory.initialCampaignId);
if (linked.error) {
  showInitialMenu();
  const message = document.getElementById('campaign-message');
  message.textContent = linked.error;
  message.dataset.kind = 'error';
} else if (routedCampaign && matchesLink(routedCampaign)) {
  void openInitialCampaign(routedCampaign);
} else if (linked.seed) {
  const state = {
    ...replayState,
    campaignId: campaignHistory.initialCampaignId ?? saved.campaignId,
  };
  let campaign = campaignMenu.findReplay(state);
  if (!campaign) {
    await afterPaint();
    campaign = createCampaign(
      generateWorld(linked.seed, {
        generatorVersion: linked.generatorVersion ?? GENERATOR_VERSION,
        preferences: linked.preferences,
      }),
      initialColors,
      paletteLabel(initialColors),
      initialVariant,
      defaultTimeOfDay,
      linked.artStyle ?? 'low-poly',
    );
    await campaignMenu.add(campaign);
  }
  void openInitialCampaign(campaign);
} else showInitialMenu();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    disposed = true;
    clearTimeout(iconCacheTimer);
    iconCacheRevision++;
    navigation.dispose();
    campaignHistory.dispose();
    workspaceControls.dispose();
    mapSelection.dispose();
    listeners.abort();
    mapAction.dispose();
    mapConsole.dispose();
    controlTooltips.dispose();
    uiTheme.dispose();
    renderer?.dispose();
    campaignMenu.dispose();
    browserStore.close();
    campaignCreator.dispose();
    paletteManager.dispose();
    settings.dispose();
    accountPanel?.dispose();
    inspector.dispose();
    partyInspector.dispose();
    partyJournal.dispose();
    batchInspector.dispose();
    panels.dispose();
    mapView?.disposeTilePreview();
  });
