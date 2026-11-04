import { cloneTemplate } from './templates.js';
import {
  characterCount,
  JOURNAL_LIMIT,
  journalHelp,
  JOURNAL_COMMANDS,
  MAJOR_ARCANA,
  mentionOptions,
  hexName,
  isAutomatedJournalEntry,
} from '../application/party-journal.js';
import { campaignWeek } from '../application/party-token.js';
import { periodEvent, timeIncrementLabels } from '../application/campaign-time.js';
import { copyText } from './map-link.js';

const PAGE_SIZE = 50;

// Span offsets refer to saved plain text. Kbd nodes are derived, never stored HTML.
function diceSpans(entry) {
  const spans = [];
  if (entry.kind === 'oracle') {
    const start = entry.text.lastIndexOf('Oracle:');
    const match = entry.text
      .slice(start)
      .match(/\(d6: \d+(?: [−+-] \d+)? = (-?\d+)(?: → (\d+))?\)$/);
    if (match)
      spans.push({
        type: 'die',
        start: start + 'Oracle: '.length,
        end: start + match.index + match[0].length,
        label: match[2] ?? match[1],
        suffix: entry.text.slice(start + 'Oracle: '.length, start + match.index).trimEnd(),
      });
  }
  if (entry.kind === 'roll') {
    let offset = 0;
    for (const line of entry.text.split('\n')) {
      const match = line.match(/^([^:]+): (.+) = -?\d+$/);
      if (match) {
        const terms = match[1].match(/[+-]?(?:\d*d\d+|\d+)/gi) ?? [];
        const dice = terms.flatMap((term) =>
          /d/i.test(term)
            ? Array.from(
                { length: Math.min(100, Number(term.replace(/^[+-]/, '').split(/d/i)[0]) || 1) },
                () => true,
              )
            : [false],
        );
        const base = offset + match[1].length + 2;
        [...match[2].matchAll(/\d+/g)].forEach((number, index) => {
          if (dice[index])
            spans.push({
              type: 'die',
              start: base + number.index,
              end: base + number.index + number[0].length,
            });
        });
      }
      offset += line.length + 1;
    }
  }
  return spans;
}

function appendAbstractCard(node, entry) {
  if (entry.kind !== 'abstract') return;
  const title = entry.text.trim().split('\n')[0].replace(/\.$/, '');
  const card = MAJOR_ARCANA.find((name) => title === `Abstract: ${name}`);
  if (!card) return;
  const frame = document.createElement('span');
  frame.className = 'hp-journal-card';
  const image = document.createElement('img');
  image.src = `/images/major-arcana/${card.toLowerCase().replaceAll(' ', '-')}.png`;
  frame.style.setProperty('--journal-card-image', `url("${image.getAttribute('src')}")`);
  image.alt = '';
  image.width = 94;
  image.height = 194;
  image.loading = 'lazy';
  image.addEventListener('error', () => frame.remove(), { once: true });
  frame.append(image);
  node.prepend(frame);
}

export function createPartyJournal(
  host,
  {
    onSubmit,
    onNextWeek,
    onMention,
    onEntryAction,
    onEdit,
    isBusy,
    getTimeIncrement = () => 'week',
  },
) {
  host.replaceChildren(cloneTemplate('party-journal-template'));
  const el = (name) => host.querySelector(`#hp-journal-${name}`);
  const section = host.querySelector('.hp-journal'),
    input = el('input'),
    log = el('log'),
    entriesHost = el('entries');
  const listeners = new AbortController();
  const listen = (target, type, callback) =>
    target.addEventListener(type, callback, { signal: listeners.signal });
  const drafts = new Map();
  let state,
    campaignId,
    journal,
    displayedIncrement,
    currentWeek,
    viewedWeek = 1,
    shown = PAGE_SIZE,
    helpWeek,
    frame;
  let editingEntry = false,
    editingId = null,
    beforeEdit = null,
    inactiveEntryId,
    inactivePointer;
  let mentions = [],
    previousText = '',
    options = [],
    active = 0,
    match;
  const pageEntries = () =>
    (state?.campaign.journal ?? []).filter((entry) => entry.week === viewedWeek);
  const future = () => viewedWeek > currentWeek;
  const time = () => timeIncrementLabels(getTimeIncrement());
  const helpText = () => journalHelp(getTimeIncrement());
  const draftKey = () => JSON.stringify([campaignId, viewedWeek]);
  const visibleCells = () =>
    state?.visibleLayout ?? state?.visibleWorld?.cells ?? state?.world.cells ?? [];
  const cellFor = (key) => visibleCells().find((cell) => cell.key === key);

  function error(text = '') {
    el('error').textContent = text;
    el('error').hidden = !text;
    input.setAttribute('aria-invalid', String(Boolean(text)));
  }
  function count() {
    const length = characterCount(input.value),
      disabled = future();
    el('count').textContent = `${length} / ${JOURNAL_LIMIT}`;
    input.disabled = disabled;
    input.placeholder = disabled
      ? `Start this ${time().unit} to write in the journal`
      : 'Write a note or type / for commands';
    el('add').disabled = disabled || length > JOURNAL_LIMIT || !input.value.trim();
    el('add').textContent = editingId === null ? 'Add to Journal' : 'Save changes';
    el('cancel-edit').hidden = editingId === null;
    for (const button of host.querySelectorAll('[data-journal-command]'))
      button.disabled = disabled || editingId !== null;
    input.setCustomValidity(length > JOURNAL_LIMIT ? 'Use up to 300 characters.' : '');
  }
  function closeSuggestions() {
    options = [];
    match = undefined;
    el('suggestions').hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function saveDraft() {
    if (campaignId) drafts.set(draftKey(), { text: input.value, mentions, editingId, beforeEdit });
  }
  function restoreDraft() {
    const draft = drafts.get(draftKey());
    input.value = previousText = draft?.text ?? '';
    mentions = draft?.mentions ?? [];
    editingId = draft?.editingId ?? null;
    beforeEdit = draft?.beforeEdit ?? null;
    closeSuggestions();
    error();
    count();
  }
  function showSuggestions() {
    if (!state || future() || input.selectionStart !== input.selectionEnd)
      return closeSuggestions();
    const before = input.value.slice(0, input.selectionStart);
    if (editingId === null && /^\/[a-z\d]*$/i.test(before)) {
      options = JOURNAL_COMMANDS.filter((option) =>
        option.label.startsWith(before.toLowerCase()),
      ).map((option) => ({ ...option, type: 'command' }));
      if (!options.length) return closeSuggestions();
      match = { start: 0, end: input.selectionStart };
      active = 0;
      renderSuggestions();
      return;
    }
    const found = before.match(/(?:^|\s)([@#$])([^@#$\n]*)$/);
    if (!found) return closeSuggestions();
    const start = before.length - found[1].length - found[2].length;
    if (mentions.some((ref) => start >= ref.start && start < ref.end)) return closeSuggestions();
    options = mentionOptions(
      found[1],
      found[2],
      state.campaign,
      { ...state.world, cells: visibleCells() },
      getTimeIncrement(),
    );
    if (!options.length) return closeSuggestions();
    match = { start, end: input.selectionStart };
    active = 0;
    renderSuggestions();
  }
  function renderSuggestions() {
    el('suggestions').replaceChildren(
      ...options.map((option, index) => {
        const node = document.createElement('div');
        node.id = `hp-journal-option-${index}`;
        node.setAttribute('role', 'option');
        node.setAttribute('aria-selected', String(index === active));
        node.textContent = `${option.label}${option.description ? ` · ${option.description}` : ''}${option.visited ? ' · visited' : ''}${index === active ? ' · Tab ↹' : ''}`;
        node.dataset.index = index;
        return node;
      }),
    );
    el('suggestions').hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', `hp-journal-option-${active}`);
    el('suggestions').children[active]?.scrollIntoView({ block: 'nearest' });
  }
  function accept(index = active) {
    const option = options[index];
    if (!option || !match) return;
    const { start, end } = match,
      label = option.insert ?? option.label;
    const value = input.value.slice(0, start) + label + ' ' + input.value.slice(end);
    if (characterCount(value) > JOURNAL_LIMIT) {
      error('This suggestion would exceed 300 characters.');
      return;
    }
    const change = label.length + 1 - (end - start);
    mentions = mentions
      .filter((ref) => ref.end <= start || ref.start >= end)
      .map((ref) =>
        ref.start >= end ? { ...ref, start: ref.start + change, end: ref.end + change } : ref,
      );
    if (option.type !== 'command')
      mentions.push({ type: option.type, key: option.key, start, end: start + label.length });
    mentions.sort((a, b) => a.start - b.start);
    input.value = previousText = value;
    input.focus();
    input.setSelectionRange(start + label.length + 1, start + label.length + 1);
    error();
    count();
    closeSuggestions();
  }
  listen(input, 'input', () => {
    const text = input.value;
    let start = 0,
      tail = 0;
    while (
      start < previousText.length &&
      start < text.length &&
      previousText[start] === text[start]
    )
      start++;
    while (
      tail < previousText.length - start &&
      tail < text.length - start &&
      previousText.at(-1 - tail) === text.at(-1 - tail)
    )
      tail++;
    const oldEnd = previousText.length - tail,
      delta = text.length - previousText.length;
    mentions = mentions
      .filter((ref) => ref.end <= start || ref.start >= oldEnd)
      .map((ref) =>
        ref.start >= oldEnd ? { ...ref, start: ref.start + delta, end: ref.end + delta } : ref,
      );
    previousText = text;
    error();
    count();
    showSuggestions();
  });
  listen(input, 'click', showSuggestions);
  listen(input, 'keydown', (event) => {
    if (event.isComposing) return;
    if (
      options.length &&
      ['Tab', 'Enter', 'ArrowDown', 'ArrowUp', 'Escape'].includes(event.key) &&
      !event.shiftKey
    ) {
      event.preventDefault();
      if (event.key === 'Escape') closeSuggestions();
      else if (event.key === 'Tab' || event.key === 'Enter') accept();
      else {
        active = (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        renderSuggestions();
      }
    } else if (event.key === 'Escape' && editingId !== null) {
      event.preventDefault();
      cancelEdit();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit(input.value, mentions, true);
    }
  });
  listen(input, 'blur', closeSuggestions);
  listen(el('suggestions'), 'pointerdown', (event) => {
    const option = event.target.closest('[data-index]');
    if (option) {
      event.preventDefault();
      accept(Number(option.dataset.index));
    }
  });

  function mentionLabel(entry, ref) {
    const original = entry.text.slice(ref.start, ref.end);
    if (ref.type === 'week') return `${time().label} ${ref.key}`;
    if (ref.type === 'hex') {
      // Normalize the original address-first format; newer labels remain historical snapshots.
      if (/^\$?Region #/.test(original)) {
        const cell = cellFor(ref.key);
        if (cell) return hexName(cell);
        return original.replace(/^\$/, '').split(' · ').at(-1);
      }
      return original.replace(/^\$/, '').split(' · Region #')[0];
    }
    return original;
  }
  function appendText(node, entry) {
    entry = periodEvent(entry, getTimeIncrement());
    let end = 0;
    const textEnd =
      entry.kind === 'move'
        ? (entry.mentions?.find((ref) => ref.type === 'hex')?.end ?? entry.text.length)
        : entry.text.length;
    const tokens = [...(entry.mentions ?? []), ...diceSpans(entry)].sort(
      (a, b) => a.start - b.start,
    );
    for (const ref of tokens) {
      if (ref.start < end) continue;
      node.append(document.createTextNode(entry.text.slice(end, ref.start)));
      if (ref.type === 'die') {
        const die = document.createElement('kbd');
        die.textContent = ref.label ?? entry.text.slice(ref.start, ref.end);
        node.append(die);
        if (ref.suffix) node.append(document.createTextNode(` ${ref.suffix}`));
      } else {
        const mention = document.createElement('button');
        mention.type = 'button';
        mention.className = 'hp-journal-mention';
        mention.textContent = mentionLabel(entry, ref);
        mention.dataset.mentionType = ref.type;
        mention.dataset.key = ref.key;
        node.append(mention);
      }
      end = ref.end;
      if (end >= textEnd) break;
    }
    node.append(document.createTextNode(entry.text.slice(end, textEnd).trimEnd()));
    if (!/[.!?…]$/.test(node.textContent.trimEnd())) node.append(document.createTextNode('.'));
  }
  function appendHelp(node) {
    for (const text of helpText().split('\n\n')) {
      const paragraph = document.createElement('p');
      let end = 0;
      for (const match of text.matchAll(/[@#$][a-z]+|\/(?:[a-z]+|\d[\w+-]*)/gi)) {
        paragraph.append(document.createTextNode(text.slice(end, match.index)));
        const token = document.createElement('span');
        token.className = 'hp-journal-help-symbol';
        token.textContent = match[0];
        paragraph.append(token);
        end = match.index + match[0].length;
      }
      paragraph.append(document.createTextNode(text.slice(end)));
      node.append(paragraph);
    }
  }
  function entryNode(entry, help = false) {
    const node = cloneTemplate('party-journal-entry-template').firstElementChild;
    node.classList.add(`hp-journal-${entry.kind}`);
    node.dataset.entryId = help ? 'help' : String(entry.id);
    if (node.dataset.entryId === inactiveEntryId) node.classList.add('is-action-complete');
    const text = node.querySelector('.hp-journal-entry-text');
    if (help) appendHelp(text);
    else {
      appendAbstractCard(node, entry);
      appendText(text, entry);
    }
    node.querySelector('[data-entry-action="regenerate"]').hidden = ![
      'oracle',
      'abstract',
      'roll',
    ].includes(entry.kind);
    node.querySelector('[data-entry-action="edit"]').hidden = entry.kind !== 'note';
    node.querySelector('[data-entry-action="delete"]').hidden = isAutomatedJournalEntry(entry);
    return node;
  }
  function paint(bottom = false, preserve = false) {
    if (!state) return;
    cancelAnimationFrame(frame);
    const previousHeight = log.scrollHeight,
      previousTop = log.scrollTop;
    const entries = pageEntries(),
      next = future();
    const { unit, label, plural } = time();
    el('week').textContent = `${label} ${viewedWeek}`;
    host.querySelector('.hp-journal-pagination').setAttribute('aria-label', `Journal ${plural}`);
    el('start').textContent = `Start new ${unit}`;
    for (const button of host.querySelectorAll('[data-week-page]')) {
      const direction = button.dataset.weekPage;
      button.setAttribute(
        'aria-label',
        `${direction[0].toUpperCase() + direction.slice(1)} ${unit}`,
      );
      const backwards = ['first', 'previous'].includes(button.dataset.weekPage);
      button.disabled = backwards ? viewedWeek === 1 : viewedWeek >= currentWeek + 1;
    }
    el('older').hidden = next || shown >= entries.length;
    el('new-week').hidden = !next;
    entriesHost.hidden = next;
    const nodes = next ? [] : entries.slice(-shown).map((entry) => entryNode(entry));
    if (!next && !entries.length) {
      const node = document.createElement('p');
      node.className = 'hp-journal-empty';
      node.textContent = 'Your party’s story begins here.';
      nodes.push(node);
    }
    if (!next && helpWeek === viewedWeek)
      nodes.push(entryNode({ kind: 'help', text: helpText(), mentions: [] }, true));
    entriesHost.replaceChildren(...nodes);
    count();
    frame = requestAnimationFrame(() => {
      if (bottom) log.scrollTop = log.scrollHeight;
      else if (preserve) log.scrollTop = previousTop + log.scrollHeight - previousHeight;
      else log.scrollTop = previousTop;
    });
  }
  function goToWeek(value) {
    if (!state || isBusy()) return;
    const week = Math.min(currentWeek + 1, Math.max(1, Number(value)));
    if (!Number.isSafeInteger(week)) return;
    saveDraft();
    viewedWeek = week;
    shown = PAGE_SIZE;
    restoreDraft();
    paint(true);
    el('announcement').textContent = `${time().label} ${viewedWeek}`;
  }
  for (const button of host.querySelectorAll('[data-week-page]'))
    listen(button, 'click', () => {
      goToWeek(
        { first: 1, previous: viewedWeek - 1, next: viewedWeek + 1, last: currentWeek + 1 }[
          button.dataset.weekPage
        ],
      );
    });
  function loadOlder() {
    if (shown < pageEntries().length) {
      shown += PAGE_SIZE;
      paint(false, true);
    }
  }
  listen(el('older'), 'click', loadOlder);
  listen(log, 'scroll', () => {
    if (!future() && log.scrollTop < 16) loadOlder();
  });

  function clearInactive() {
    inactiveEntryId = undefined;
    inactivePointer = undefined;
    for (const row of entriesHost.querySelectorAll('.is-action-complete'))
      row.classList.remove('is-action-complete');
  }
  function deactivate(id, event, focus = log) {
    inactiveEntryId = id;
    inactivePointer = { x: event.clientX, y: event.clientY };
    const row = [...entriesHost.querySelectorAll('.hp-journal-entry')].find(
      (row) => row.dataset.entryId === id,
    );
    row?.classList.add('is-action-complete');
    focus.focus({ preventScroll: true });
  }
  listen(entriesHost, 'pointermove', (event) => {
    if (
      inactivePointer &&
      Math.hypot(event.clientX - inactivePointer.x, event.clientY - inactivePointer.y) > 2
    )
      clearInactive();
  });
  listen(entriesHost, 'focusin', (event) => {
    if (event.target.closest('.hp-journal-entry')) clearInactive();
  });
  listen(entriesHost, 'pointerdown', (event) => {
    if (!event.target.closest('button'))
      event.target.closest('.hp-journal-entry')?.focus({ preventScroll: true });
  });
  function editableEntry(entry) {
    let text = '',
      end = 0;
    const refs = [];
    for (const ref of entry.mentions) {
      text += entry.text.slice(end, ref.start);
      const label = mentionLabel(entry, ref),
        start = text.length;
      text += label;
      refs.push({ ...ref, start, end: text.length });
      end = ref.end;
    }
    return { text: text + entry.text.slice(end), mentions: refs };
  }
  function cancelEdit() {
    input.value = previousText = beforeEdit?.text ?? '';
    mentions = beforeEdit?.mentions ?? [];
    editingId = null;
    beforeEdit = null;
    closeSuggestions();
    error();
    count();
    input.focus();
  }
  listen(el('cancel-edit'), 'click', cancelEdit);
  listen(entriesHost, 'click', async (event) => {
    const button = event.target.closest('button[data-entry-action]');
    if (button && !isBusy()) {
      const row = button.closest('.hp-journal-entry'),
        id = row.dataset.entryId;
      const entry =
        id === 'help'
          ? { text: helpText() }
          : state.campaign.journal?.find((entry) => entry.id === Number(id));
      if (!entry) return;
      const action = button.dataset.entryAction;
      if (action === 'copy') {
        const text =
          id === 'help' ? helpText() : row.querySelector('.hp-journal-entry-text').textContent;
        try {
          await copyText(text);
          error();
          el('announcement').textContent = 'Journal entry copied';
          deactivate(id, event);
        } catch {
          error('The entry could not be copied. Select its text and copy it manually.');
        }
        return;
      }
      if (action === 'edit') {
        if (editingId === null) beforeEdit = { text: input.value, mentions };
        const draft = editableEntry(entry);
        editingId = entry.id;
        input.value = previousText = draft.text;
        mentions = draft.mentions;
        closeSuggestions();
        error();
        count();
        deactivate(id, event, input);
        return;
      }
      editingEntry = true;
      let result;
      try {
        if (id === 'help') {
          helpWeek = undefined;
          paint();
          result = { ok: true };
        } else result = onEntryAction?.(action, Number(id));
      } finally {
        editingEntry = false;
      }
      if (!result?.ok) {
        error(result?.error ?? 'This entry could not be updated.');
        return;
      }
      error();
      el('announcement').textContent =
        action === 'delete' ? 'Journal entry deleted' : 'Journal entry rerolled';
      deactivate(id, event);
      return;
    }
    const mention = event.target.closest('button[data-mention-type]');
    if (mention && !isBusy()) {
      if (mention.dataset.mentionType === 'week') goToWeek(mention.dataset.key);
      else onMention(mention.dataset.mentionType, mention.dataset.key);
    }
  });
  function submit(text, refs = [], clear = false) {
    if (!state || future() || isBusy()) return;
    const edited = editingId !== null;
    editingEntry = edited;
    let outcome;
    try {
      outcome = edited ? onEdit?.(editingId, text, refs) : onSubmit(text, refs, viewedWeek);
    } finally {
      editingEntry = false;
    }
    if (!outcome?.ok) {
      error(outcome?.error ?? 'This entry could not be saved.');
      input.focus();
      return;
    }
    error();
    if (outcome.help) {
      helpWeek = viewedWeek;
      paint(true);
    } else if (outcome.clear) {
      helpWeek = undefined;
      clearInactive();
      paint();
    }
    if (edited) cancelEdit();
    else if (clear) {
      input.value = previousText = '';
      mentions = [];
      count();
      closeSuggestions();
    }
    if (!outcome.explore)
      el('announcement').textContent = outcome.help
        ? helpText()
        : outcome.clear
          ? 'Cleared rolls without notes and dismissed help'
          : edited
            ? 'Journal entry updated'
            : 'Added to Party Journal';
  }
  listen(el('form'), 'submit', (event) => {
    event.preventDefault();
    submit(input.value, mentions, true);
  });
  listen(el('start'), 'click', () => {
    if (isBusy() || viewedWeek !== currentWeek + 1) return;
    const result = onNextWeek();
    if (!result.ok) error(result.error);
    else el('announcement').textContent = `${time().label} ${campaignWeek(result.state.campaign)}`;
  });
  for (const button of host.querySelectorAll('[data-journal-command]'))
    listen(button, 'click', () => {
      if (future() || editingId !== null) return;
      const command = button.dataset.journalCommand;
      if (command === '/oracle' && input.value.trim()) {
        if (input.value.trim().startsWith('/oracle')) submit(input.value, mentions, true);
        else if (!input.value.trim().startsWith('/'))
          submit(
            `/oracle ${input.value}`,
            mentions.map((ref) => ({ ...ref, start: ref.start + 8, end: ref.end + 8 })),
            true,
          );
        else submit(command);
      } else submit(command);
    });
  const appearance = host.closest('#campaign-workspace')?.querySelector('.hp-map-options');
  const mobile = matchMedia('(max-width: 760px), (max-width: 1024px) and (max-height: 500px)');
  function alignInput() {
    if (!appearance || mobile.matches || !section.clientHeight) {
      section.style.removeProperty('--journal-input-height');
      return;
    }
    const style = getComputedStyle(section);
    const bottom = parseFloat(style.paddingBottom);
    const desired =
      host.getBoundingClientRect().bottom - bottom - appearance.getBoundingClientRect().top;
    // Preserve room for the log when the tools are resized or reordered.
    const available =
      section.clientHeight -
      bottom -
      host.querySelector('.hp-journal-actions').offsetHeight -
      2 * parseFloat(style.gap) -
      parseFloat(getComputedStyle(log).minHeight);
    const minimum = host.querySelector('.hp-journal-actions button').getBoundingClientRect().height;
    const height = `${Math.max(minimum, Math.min(available, desired))}px`;
    if (section.style.getPropertyValue('--journal-input-height') !== height)
      section.style.setProperty('--journal-input-height', height);
  }
  const resize = new ResizeObserver(() => {
    alignInput();
    if (log.clientHeight && log.scrollHeight - log.scrollTop - log.clientHeight < 80)
      log.scrollTop = log.scrollHeight;
  });
  resize.observe(log);
  resize.observe(host);
  if (appearance) resize.observe(appearance);
  listen(mobile, 'change', alignInput);
  return {
    update(next) {
      const changedCampaign = campaignId !== next.campaign.id,
        nextWeek = campaignWeek(next.campaign),
        nextIncrement = time().unit;
      if (changedCampaign) saveDraft();
      const changed =
        changedCampaign ||
        next.campaign.journal !== journal ||
        nextWeek !== currentWeek ||
        nextIncrement !== displayedIncrement;
      if (next.campaign.journal !== journal) helpWeek = undefined;
      state = next;
      campaignId = next.campaign.id;
      displayedIncrement = nextIncrement;
      if (changedCampaign) {
        viewedWeek = nextWeek;
        currentWeek = nextWeek;
        shown = PAGE_SIZE;
        clearInactive();
        restoreDraft();
      } else if (nextWeek !== currentWeek) {
        if (viewedWeek === currentWeek) viewedWeek = nextWeek;
        currentWeek = nextWeek;
      }
      journal = next.campaign.journal;
      section.hidden = next.partySelected === false;
      if (editingId !== null && !journal?.some((entry) => entry.id === editingId)) cancelEdit();
      if (changed) paint(!editingEntry);
      count();
      alignInput();
    },
    reveal() {
      paint(true);
    },
    showWeek(week) {
      goToWeek(week);
      log.scrollIntoView({ block: 'nearest' });
    },
    dispose() {
      listeners.abort();
      resize.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}
