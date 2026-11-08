import { computeFogOfWar } from './fog-of-war.js';
import { generateWorld } from '../generation/world.js';
import {
  campaignWorld,
  campaignDressing,
  updateHex,
  updateHexes,
  lockHex,
} from '../generation/campaign-world.js';
import { validateHexEdits, variantsFor } from '../generation/hex-edits.js';
import { replaceCampaignMap } from './campaigns.js';
import { TIMES_OF_DAY } from './time-of-day.js';
import { MAP_ART_STYLES } from './map-art-style.js';
import { timeIncrementLabels } from './campaign-time.js';
import { settlementJoin, joinSettlements } from '../generation/settlement-edits.js';
import { hexAddress } from '../generation/hex.js';
import {
  appendJournal,
  journalCommand,
  journalEntryCommand,
  isAutomatedJournalEntry,
  isClearableJournalRoll,
  moveEvent,
  partyName,
  validateJournal,
} from './party-journal.js';
import {
  initialPartyToken,
  partyMetadata,
  PARTY_STYLES,
  PARTY_COLOR_NAMES,
  validatePartyToken,
} from './party-token.js';

// Own campaign transitions and history independently of DOM, rendering and storage.
// The persistence adapter reports failures; a failed write keeps the live edits.
export function createCampaignSession({ persist }) {
  let state;
  let history = [];
  let selected = '0,0';
  let multiEdit = false;
  let selectedKeys = new Set();
  let partySelected = false;
  let fogCache;
  let saveRevision = 0;
  function visibility() {
    if (!state?.campaign.fogOfWar) return null;
    const signature = state.world.cells
      .map((cell) => (state.campaign.hexEdits?.cells[cell.key]?.visited ? '1' : '0'))
      .join('');
    if (fogCache?.world !== state.world || fogCache.signature !== signature)
      fogCache = {
        world: state.world,
        signature,
        states: computeFogOfWar(state.world, state.campaign.hexEdits),
      };
    return fogCache.states;
  }
  const fogError = () => ({ ok: false, error: 'Turn off fog of war to edit the map.' });
  const snapshot = () =>
    state && {
      ...state,
      visibility: visibility(),
      selected,
      multiEdit,
      selectedKeys: [...selectedKeys],
      partySelected,
      join: multiEdit ? settlementJoin(state.world, selectedKeys) : null,
      canUndo: history.length > 0 && (!state.campaign.fogOfWar || history.at(-1).fogSafe),
      undoLabel: history.at(-1)?.action,
      undoReason: !history.length
        ? 'Nothing to undo'
        : state.campaign.fogOfWar && !history.at(-1).fogSafe
          ? 'Turn fog of war off to undo'
          : '',
    };
  function save() {
    if (!state) return { campaignSaved: true, preferencesSaved: true, saved: true };
    let result;
    try {
      result = persist(state.campaign);
    } catch (error) {
      result = { campaignSaved: false, preferencesSaved: false, error: error.message };
    }
    const revision = ++saveRevision;
    const finish = (result) => {
      const persistence = {
        ...result,
        pending: false,
        saved: result.campaignSaved && result.preferencesSaved,
      };
      if (revision === saveRevision) state = { ...state, persistence };
      return persistence;
    };
    if (result?.then) {
      state = { ...state, persistence: { pending: true, saved: false } };
      return Promise.resolve(result).then(finish, (error) =>
        finish({ campaignSaved: false, preferencesSaved: false, error: error.message }),
      );
    }
    return finish(result);
  }
  const result = (scope, notification) => ({ ok: true, scope, notification, state: snapshot() });
  function remember(fogSafe, action, journalEventId) {
    history.push({
      variant: state.campaign.variant,
      hexEdits: state.campaign.hexEdits,
      partyKey: state.campaign.partyToken.key,
      fogSafe,
      action,
      journalEventId,
    });
    if (history.length > 20) history.shift();
  }
  function transition(
    next,
    {
      scope = 'world',
      notification,
      relock = [],
      rerollKey,
      validateKeys = [selected],
      fogSafe = false,
      action = 'map change',
      journalEvent,
    } = {},
  ) {
    try {
      if (state.campaign.fogOfWar && !fogSafe) return fogError();
      if (journalEvent) next = appendJournal(next, journalEvent);
      const world = scope === 'tracking' ? state.world : campaignWorld(next, state.baseWorld);
      if (scope !== 'tracking')
        for (const key of validateKeys) {
          const request = next.hexEdits?.cells[key]?.crossing;
          if (request && world.cells.find((cell) => cell.key === key)?.crossing?.kind !== request)
            throw new Error(
              `${hexAddress(world.cells.find((cell) => cell.key === key))}: A crossing needs two usable banks. Try another river hex.`,
            );
        }
      const dressing =
        scope === 'tracking'
          ? state.dressing
          : campaignDressing(next, world, {
              fixedCells: rerollKey
                ? Object.fromEntries(
                    state.dressing.cells
                      .filter((cell) => cell.key !== rerollKey)
                      .map((cell) => [cell.key, cell]),
                  )
                : undefined,
              rerollKey,
              mountainBase: rerollKey ? state.dressing.mountains : [],
            });
      if (rerollKey) {
        const edit = next.hexEdits.cells[rerollKey];
        edit.dressing = structuredClone(dressing.cells.find((cell) => cell.key === rerollKey));
        const range = world.cells.find((cell) => cell.key === rerollKey)?.mountainRangeId;
        if (range)
          edit.dressing.mountain = dressing.mountains.find((shape) => shape.rangeId === range);
        edit.dressingVariant = next.variant;
        next.hexEdits.cells[rerollKey] = validateHexEdits({
          version: next.hexEdits.version,
          cells: { [rerollKey]: edit },
        }).cells[rerollKey];
      }
      for (const key of relock) next = lockHex(next, key, world, dressing);
      remember(fogSafe, action, journalEvent ? next.journal.at(-1).id : undefined);
      state = { ...state, campaign: next, world, dressing };
      save();
      return result(scope, notification);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
  function open(
    campaign,
    baseWorld = generateWorld(campaign.seed, {
      preferences: campaign.preferences,
      generatorVersion: campaign.generatorVersion,
    }),
  ) {
    const world = campaignWorld(campaign, baseWorld);
    const dressing = campaignDressing(campaign, world);
    let record = {
      ...campaign,
      colors: campaign.colors.slice(),
      nameEdited: campaign.nameEdited ?? campaign.name !== world.name,
      partyToken: campaign.partyToken ?? initialPartyToken(world),
    };
    if (!campaign.partyToken) record = updateHex(record, record.partyToken.key, { visited: true });
    state = { campaign: record, baseWorld, world, dressing };
    history = [];
    multiEdit = false;
    selectedKeys = new Set();
    partySelected = false;
    selected = record.partyToken.key;
    save();
    return result('open');
  }
  return {
    snapshot,
    save,
    open,
    setTimeOfDay(value) {
      if (!TIMES_OF_DAY.includes(value)) return { ok: false, error: 'Choose a valid time of day.' };
      state = { ...state, campaign: { ...state.campaign, timeOfDay: value } };
      save();
      return result('lighting');
    },
    appearance({ colors, paletteName, timeOfDay, artStyle }) {
      if (
        !Array.isArray(colors) ||
        colors.length !== 3 ||
        colors.some((value) => !/^#[\da-f]{6}$/i.test(value)) ||
        !TIMES_OF_DAY.includes(timeOfDay) ||
        !MAP_ART_STYLES.includes(artStyle)
      )
        return { ok: false, error: 'Choose valid campaign appearance settings.' };
      state = {
        ...state,
        campaign: { ...state.campaign, colors: colors.slice(), paletteName, timeOfDay, artStyle },
      };
      save();
      return result('appearance', 'Campaign appearance saved');
    },
    fogOfWar(enabled) {
      state = { ...state, campaign: { ...state.campaign, fogOfWar: Boolean(enabled) } };
      save();
      return result('view');
    },
    selectParty() {
      partySelected = true;
      multiEdit = false;
      selectedKeys = new Set();
    },
    partyDetails(patch) {
      try {
        const partyToken = validatePartyToken({ ...state.campaign.partyToken, ...patch });
        let campaign = { ...state.campaign, partyToken };
        if (partyName(campaign) !== partyName(state.campaign)) {
          const oldName = partyName(state.campaign),
            name = partyName(campaign);
          campaign = appendJournal(campaign, {
            kind: 'rename',
            text: `${oldName} changed name to ${name}.`,
            mentions: [
              { type: 'party', key: 'party', start: 0, end: oldName.length },
              {
                type: 'party',
                key: 'party',
                start: oldName.length + 17,
                end: oldName.length + 17 + name.length,
              },
            ],
          });
        }
        state = { ...state, campaign };
        save();
        const notification =
          patch.name !== undefined
            ? `Party renamed to “${partyToken.name}”`
            : patch.color !== undefined
              ? `Token colour: ${PARTY_COLOR_NAMES[partyToken.color]}`
              : patch.style !== undefined
                ? `Token shape: ${partyToken.style[0].toUpperCase() + partyToken.style.slice(1)}`
                : 'Party details saved';
        return result('tracking', notification);
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    moveParty(key) {
      if (!state.world.cells.some((cell) => cell.key === key)) return { ok: false };
      const next = updateHex(
        { ...state.campaign, partyToken: { ...state.campaign.partyToken, key } },
        key,
        { visited: true },
      );
      if (key === state.campaign.partyToken.key && state.campaign.hexEdits?.cells[key]?.visited)
        return result('tracking');
      return transition(next, {
        scope: 'tracking',
        fogSafe: true,
        action: 'party move',
        journalEvent:
          key !== state.campaign.partyToken.key
            ? moveEvent(
                next,
                state.world.cells.find((cell) => cell.key === key),
                state.dressing.cells.find((cell) => cell.key === key),
              )
            : undefined,
        notification: `${next.partyToken.name ?? 'Adventurers'} moved to ${hexAddress(state.world.cells.find((cell) => cell.key === key))}`,
      });
    },
    nextWeek(increment = 'week') {
      try {
        const weeks = (state.campaign.partyToken.weeks ?? 1) + 1;
        const partyToken = validatePartyToken({ ...state.campaign.partyToken, weeks });
        const name = partyName(state.campaign);
        const campaign = appendJournal(
          { ...state.campaign, partyToken },
          {
            kind: 'week',
            text: `${name} lived another week.`,
            mentions: [{ type: 'party', key: 'party', start: 0, end: name.length }],
          },
        );
        state = { ...state, campaign };
        save();
        return result('journal', `${timeIncrementLabels(increment).label} ${weeks}`);
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    addJournal(text, mentions = [], random, { week } = {}) {
      try {
        const entry = journalCommand(text, mentions, random);
        if (entry.help || entry.explore) return { ...result('journal'), ...entry };
        if (entry.clear) {
          const entries = state.campaign.journal ?? [];
          const journal = entries.filter((entry) => !isClearableJournalRoll(entry));
          const removed = entries.length - journal.length;
          if (removed) {
            state = {
              ...state,
              campaign: {
                ...state.campaign,
                journal,
                journalSequence: Math.max(state.campaign.journalSequence ?? 0, entries.at(-1).id),
              },
            };
            save();
          }
          return { ...result('journal', 'Cleared rolls without notes'), clear: true, removed };
        }
        state = { ...state, campaign: appendJournal(state.campaign, entry, { week }) };
        save();
        return result('journal', 'Added to Party Journal');
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    editJournal(id, text, mentions = []) {
      try {
        const entries = state.campaign.journal ?? [];
        const entry = entries.find((entry) => entry.id === id);
        if (!entry || entry.kind !== 'note')
          throw new Error('Only manual journal entries can be edited.');
        const edited = validateJournal([{ ...entry, text, mentions }])[0];
        state = {
          ...state,
          campaign: {
            ...state.campaign,
            journal: entries.map((entry) => (entry.id === id ? edited : entry)),
          },
        };
        save();
        return result('journal', 'Journal entry updated');
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    regenerateJournal(id, random) {
      try {
        const entries = state.campaign.journal ?? [];
        const entry = entries.find((entry) => entry.id === id);
        if (!entry) throw new Error('This journal entry no longer exists.');
        const command = journalEntryCommand(entry);
        if (!command) throw new Error('Only dice, oracle and abstract entries can be regenerated.');
        const replacement = validateJournal([
          { ...entry, ...journalCommand(command.text, command.mentions, random) },
        ])[0];
        state = {
          ...state,
          campaign: {
            ...state.campaign,
            journal: entries.map((current) => (current.id === id ? replacement : current)),
          },
        };
        save();
        return result('journal', 'Journal entry regenerated');
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    deleteJournal(id) {
      const entries = state.campaign.journal ?? [];
      const entry = entries.find((entry) => entry.id === id);
      if (!entry) return { ok: false, error: 'This journal entry no longer exists.' };
      if (isAutomatedJournalEntry(entry))
        return { ok: false, error: 'Automatic journal entries cannot be deleted.' };
      state = {
        ...state,
        campaign: {
          ...state.campaign,
          journalSequence: Math.max(state.campaign.journalSequence ?? 0, entries.at(-1).id),
          journal: entries.filter((entry) => entry.id !== id),
        },
      };
      save();
      return result('journal', 'Journal entry deleted');
    },
    partyStyle(style) {
      if (!PARTY_STYLES.includes(style)) return { ok: false };
      state = {
        ...state,
        campaign: { ...state.campaign, partyToken: { ...state.campaign.partyToken, style } },
      };
      save();
      return result('tracking', `Token shape: ${style[0].toUpperCase() + style.slice(1)}`);
    },
    select(key) {
      if (!state?.world.cells.some((cell) => cell.key === key)) return false;
      selected = key;
      partySelected = false;
      if (multiEdit) {
        if (selectedKeys.has(key)) selectedKeys.delete(key);
        else selectedKeys.add(key);
      }
      return true;
    },
    setMultiEdit(enabled) {
      partySelected = false;
      multiEdit = Boolean(enabled);
      selectedKeys = new Set(multiEdit ? [selected] : []);
    },
    selectAll() {
      if (multiEdit) selectedKeys = new Set(state.world.cells.map((cell) => cell.key));
    },
    selectVisited() {
      const keys = partyMetadata(state.world, state.campaign).visitedKeys;
      if (!keys.length) return false;
      partySelected = false;
      multiEdit = true;
      selectedKeys = new Set(keys);
      selected = keys[0];
      return true;
    },
    clearSelection() {
      selectedKeys = new Set();
    },
    replace(seed, { confirmed = false } = {}) {
      if (!confirmed && Object.keys(state.campaign.hexEdits?.cells ?? {}).length)
        return { ok: false, requiresConfirmation: true };
      const base = generateWorld(seed, { preferences: state.campaign.preferences });
      const next = replaceCampaignMap(state.campaign, base, state.world.name);
      open(next, base);
      return result('open', 'New map created');
    },
    palette(colors, paletteName) {
      state = { ...state, campaign: { ...state.campaign, colors: colors.slice(), paletteName } };
      save();
      return result('palette', 'Palette changed');
    },
    icon() {
      if (state.campaign.fogOfWar) return fogError();
      state = { ...state, campaign: { ...state.campaign, iconKey: selected } };
      save();
      return result('icon', 'Campaign icon updated');
    },
    apply(patch) {
      try {
        const relock = state.campaign.hexEdits?.cells[selected]?.lock ? [selected] : [];
        return transition(updateHex(state.campaign, selected, patch), {
          relock,
          action: 'hex update',
          notification: relock.length ? 'Hex updated and dressing relocked' : 'Hex updated',
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    applyBatch(patch) {
      try {
        if (!multiEdit || !selectedKeys.size) throw new Error('Select at least one hex to edit.');
        if (!Object.keys(patch).length) throw new Error('Choose at least one field to change.');
        const patches = {};
        // Topology order makes the result independent of click order.
        const cells = state.world.cells.filter((cell) => selectedKeys.has(cell.key));
        const relock = [];
        for (const cell of cells) {
          const edit = { ...patch };
          const terrain = edit.terrain ?? cell.terrain;
          const water = ['river', 'open water'].includes(terrain);
          if (edit.terrain !== undefined) {
            if (water) {
              edit.elevation = 0;
              edit.settlement = null;
            }
            if (terrain === 'open water') edit.poi = null;
            if (terrain !== 'river') edit.crossing = null;
            if (terrain === 'mountains') edit.elevation = 4;
          } else if (edit.elevation !== undefined && (water || terrain === 'mountains')) {
            throw new Error(
              `${hexAddress(cell)}: Water and mountains have fixed elevation. Choose another terrain first.`,
            );
          }
          if (patch.settlement && water)
            throw new Error(
              `${hexAddress(cell)}: Water cannot contain settlements. Choose land terrain first.`,
            );
          if (patch.poi && terrain === 'open water')
            throw new Error(
              `${hexAddress(cell)}: Open water cannot contain points of interest. Choose land terrain first.`,
            );
          if (patch.crossing && terrain !== 'river')
            throw new Error(
              `${hexAddress(cell)}: Crossings can only be placed on rivers. Select a river hex.`,
            );
          const currentPoi = cell.pointsOfInterest[0];
          if (
            edit.poi &&
            typeof edit.poi.variant === 'number' &&
            currentPoi?.kind === edit.poi.kind &&
            variantsFor(edit.poi.kind).includes(edit.poi.variant)
          )
            delete edit.poi;
          if (
            state.campaign.hexEdits?.cells[cell.key]?.lock &&
            ['terrain', 'elevation', 'settlement', 'poi', 'crossing', 'cropStyle'].some((field) =>
              Object.hasOwn(edit, field),
            )
          )
            relock.push(cell.key);
          patches[cell.key] = edit;
        }
        const trackingOnly = Object.keys(patch).every((field) => field === 'visited');
        return transition(updateHexes(state.campaign, patches, state.baseWorld), {
          scope: trackingOnly ? 'tracking' : 'world',
          fogSafe: trackingOnly,
          relock,
          validateKeys: cells.map((cell) => cell.key),
          notification: `${cells.length} ${cells.length === 1 ? 'hex' : 'hexes'} updated`,
          action: `update to ${cells.length} ${cells.length === 1 ? 'hex' : 'hexes'}`,
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    joinSelection() {
      try {
        if (!multiEdit) throw new Error('Turn on multiselect to join settlements.');
        const next = joinSettlements(state.campaign, state.world, selectedKeys, state.baseWorld);
        const relock = [...selectedKeys].filter((key) => state.campaign.hexEdits?.cells[key]?.lock);
        return transition(next, {
          relock,
          validateKeys: [...selectedKeys],
          notification: `${settlementJoin(state.world, selectedKeys)?.type === 'city' ? 'City' : 'Town'} joined across ${selectedKeys.size} hexes`,
          action: 'settlement join',
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    visit() {
      const visited = !state.campaign.hexEdits?.cells[selected]?.visited;
      return transition(updateHex(state.campaign, selected, { visited }), {
        scope: 'tracking',
        fogSafe: true,
        action: visited ? 'mark hex visited' : 'mark hex not visited',
        notification: visited ? 'Hex marked visited' : 'Hex marked not visited',
      });
    },
    lock() {
      const locked = Boolean(state.campaign.hexEdits?.cells[selected]?.lock);
      const next = locked
        ? updateHex(state.campaign, selected, {})
        : lockHex(state.campaign, selected, state.world, state.dressing);
      if (locked) {
        const edit = next.hexEdits.cells[selected];
        edit.dressing = structuredClone(edit.lock);
        edit.dressingVariant = next.variant;
        delete edit.lock;
      }
      return transition(next, {
        scope: 'tracking',
        action: locked ? 'unlock appearance' : 'lock appearance',
        notification: locked ? 'Dressing unlocked' : 'Dressing locked',
      });
    },
    regenerateHex() {
      if (state.campaign.hexEdits?.cells[selected]?.lock)
        return { ok: false, error: 'Unlock dressing to regenerate this hex.' };
      const revision = (state.campaign.hexEdits?.cells[selected]?.revision ?? 0) + 1;
      return transition(updateHex(state.campaign, selected, { revision, cropStyle: null }), {
        rerollKey: selected,
        notification: 'Hex dressing regenerated',
        action: 'hex appearance regeneration',
      });
    },
    regenerate() {
      const patches = Object.fromEntries(
        Object.entries(state.campaign.hexEdits?.cells ?? {})
          .filter(([, edit]) => edit.cropStyle && !edit.lock)
          .map(([key]) => [key, { cropStyle: null }]),
      );
      const next = { ...state.campaign, variant: state.campaign.variant + 1 };
      return transition(
        Object.keys(patches).length ? updateHexes(next, patches, state.baseWorld) : next,
        { notification: 'Map appearance regenerated', action: 'map appearance regeneration' },
      );
    },
    reset() {
      const visited = state.campaign.hexEdits?.cells[selected]?.visited;
      const next = updateHexes(state.campaign, { [selected]: null }, state.baseWorld);
      if (visited !== undefined) next.hexEdits.cells[selected] = { visited };
      return transition(next, {
        notification: 'Hex reset to generated; visited status kept',
        action: 'hex reset',
      });
    },
    resetSelected({ confirmed = false } = {}) {
      if (!multiEdit || !selectedKeys.size)
        return { ok: false, error: 'Select at least one hex to reset.' };
      if (!confirmed) return { ok: false, requiresConfirmation: true };
      try {
        let next = updateHexes(
          state.campaign,
          Object.fromEntries([...selectedKeys].map((key) => [key, null])),
          state.baseWorld,
        );
        if (!Object.keys(next.hexEdits.cells).length) {
          const { hexEdits: _edits, ...record } = next;
          next = record;
        }
        return transition(next, {
          validateKeys: [],
          notification: `${selectedKeys.size} ${selectedKeys.size === 1 ? 'hex' : 'hexes'} reset`,
          action: `reset of ${selectedKeys.size} ${selectedKeys.size === 1 ? 'hex' : 'hexes'}`,
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    undo() {
      if (!history.length) return { ok: false };
      if (state.campaign.fogOfWar && !history.at(-1).fogSafe) return fogError();
      const { partyKey, fogSafe, action, journalEventId, ...previous } = history.at(-1);
      const campaign = {
        ...state.campaign,
        ...previous,
        partyToken: { ...state.campaign.partyToken, key: partyKey },
        ...(journalEventId !== undefined
          ? {
              journal: (state.campaign.journal ?? []).filter(
                (entry) => entry.id !== journalEventId,
              ),
            }
          : {}),
      };
      const world = fogSafe ? state.world : campaignWorld(campaign, state.baseWorld);
      const dressing = fogSafe ? state.dressing : campaignDressing(campaign, world);
      history.pop();
      state = { ...state, campaign, world, dressing };
      save();
      return result(fogSafe ? 'tracking' : 'world', `Undid ${action}`);
    },
  };
}
