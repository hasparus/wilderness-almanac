import { hexAddress } from '../generation/hex.js';
import { hexName } from './hex-description.js';
import { timeIncrementLabels } from './campaign-time.js';
export { hexName } from './hex-description.js';

export const JOURNAL_LIMIT = 300;
const MAX_JOURNAL_ENTRIES = 20000;
export const JOURNAL_COMMANDS = [
  { label: '/help', description: 'Show commands and mentions' },
  { label: '/clear', description: 'Clear rolls without notes and dismiss help' },
  { label: '/abstract', description: 'Draw a Major Arcana' },
  { label: '/explore', description: 'Explore hex (coming later)' },
  { label: '/oracle', description: 'Roll an oracle; optional modifier and question' },
  ...[4, 6, 8, 10, 12, 20].map((sides) => ({
    label: `/d${sides}`,
    description: `Roll a d${sides}; combine dice with + and −`,
  })),
];
export const ORACLE_ANSWERS = ['No, and…', 'No', 'No, but…', 'Yes, but…', 'Yes', 'Yes, and…'];
export const MAJOR_ARCANA = [
  'The Fool',
  'The Magician',
  'The High Priestess',
  'The Empress',
  'The Emperor',
  'The Hierophant',
  'The Lovers',
  'The Chariot',
  'Strength',
  'The Hermit',
  'Wheel of Fortune',
  'Justice',
  'The Hanged Man',
  'Death',
  'Temperance',
  'The Devil',
  'The Tower',
  'The Star',
  'The Moon',
  'The Sun',
  'Judgement',
  'The World',
];
const JOURNAL_HELP = [
  'Write a note (300 characters). Mention @party, #week or $hex; search hexes by name or coordinates. Use ↑/↓ and Tab to accept a suggestion.',
  '/help shows these commands until the next journal entry. /clear removes dice, abstract and oracle rolls without a note or question throughout this party’s journal, and dismisses help.',
  '/abstract draws a Major Arcana card. /explore is coming later.',
  '/oracle [modifier] [question] rolls a d6 oracle, with the modified total limited to 1–6. Add a question to keep that roll when clearing.',
  'Roll dice: /2d6+1 4d6 1d20. Use + and - to combine d4, d6, d8, d10, d12 and d20. Spaces separate rolls.',
].join('\n\n');
export const journalHelp = (increment) =>
  JOURNAL_HELP.replace('#week', `#${timeIncrementLabels(increment).unit}`);
export const isAutomatedJournalEntry = (entry) => ['move', 'rename', 'week'].includes(entry.kind);

// Imported/older results may carry trailing notes without command metadata. Only clear
// complete, recognizable result text so those notes and oracle questions survive.
export function isClearableJournalRoll(entry) {
  const text = entry.text.trim().replace(/\.$/, '');
  if (entry.kind === 'abstract') return MAJOR_ARCANA.some((card) => text === `Abstract: ${card}`);
  if (entry.kind === 'oracle') {
    const match = text.match(/^Oracle: (.+) \(d6: [1-6](?: [−+] \d+)? = -?\d+(?: → [1-6])?\)$/);
    return Boolean(match && ORACLE_ANSWERS.includes(match[1]));
  }
  return (
    entry.kind === 'roll' &&
    text.split('\n').every((line) => /^[^:\n]+: -?\d+(?: [−+] \d+)* = -?\d+\.?$/.test(line))
  );
}
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const characterCount = (text) => [...segmenter.segment(text)].length;
const validKey = (key) => {
  if (typeof key !== 'string' || !/^-?\d{1,2},-?\d{1,2}$/.test(key)) return false;
  const [q, r] = key.split(',').map(Number);
  return `${q},${r}` === key && Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 12;
};
const weekNumber = (value) => Number.isSafeInteger(value) && value >= 1 && value <= 1000000;
const invalid = () => {
  throw new Error('The campaign contains an invalid party journal.');
};

function validateMentions(mentions, text) {
  if (!Array.isArray(mentions) || mentions.length > 100) return invalid();
  let end = 0;
  return mentions.map((mention) => {
    if (
      !mention ||
      !Number.isSafeInteger(mention.start) ||
      !Number.isSafeInteger(mention.end) ||
      mention.start < end ||
      mention.end <= mention.start ||
      mention.end > text.length ||
      !['party', 'hex', 'week'].includes(mention.type) ||
      (mention.type === 'hex' && !validKey(mention.key)) ||
      (mention.type === 'party' && mention.key !== 'party') ||
      (mention.type === 'week' &&
        (!weekNumber(Number(mention.key)) || String(Number(mention.key)) !== String(mention.key)))
    )
      return invalid();
    end = mention.end;
    return { start: mention.start, end, type: mention.type, key: String(mention.key) };
  });
}

export function validateJournal(value) {
  if (!Array.isArray(value) || value.length > MAX_JOURNAL_ENTRIES) return invalid();
  let id = 0;
  return value.map((entry) => {
    if (
      !entry ||
      !Number.isSafeInteger(entry.id) ||
      entry.id <= id ||
      !weekNumber(entry.week) ||
      !['note', 'move', 'rename', 'week', 'oracle', 'abstract', 'roll'].includes(entry.kind) ||
      typeof entry.text !== 'string' ||
      !entry.text.trim() ||
      entry.text.length > 10000 ||
      (entry.kind === 'note' && characterCount(entry.text) > JOURNAL_LIMIT)
    )
      return invalid();
    id = entry.id;
    const week = entry.week;
    let command;
    if (entry.command !== undefined) {
      const regenerated = journalCommand(entry.command, entry.commandMentions ?? [], () => 0);
      if (!['oracle', 'abstract', 'roll'].includes(entry.kind) || regenerated.kind !== entry.kind)
        return invalid();
      command = { command: entry.command, commandMentions: regenerated.commandMentions };
    }
    return {
      id,
      week,
      kind: entry.kind,
      text: entry.text,
      mentions: validateMentions(entry.mentions ?? [], entry.text),
      ...command,
    };
  });
}

export function appendJournal(campaign, entry, { week = campaign.partyToken?.weeks ?? 1 } = {}) {
  if (!weekNumber(week) || week > (campaign.partyToken?.weeks ?? 1))
    throw new Error('Start this journal period before adding entries.');
  const journal = campaign.journal ?? [];
  if (journal.length >= MAX_JOURNAL_ENTRIES)
    throw new Error(
      'This journal has reached its 20,000 entry limit. Export a backup before starting another campaign.',
    );
  return {
    ...campaign,
    journal: [
      ...journal,
      ...validateJournal([
        {
          ...entry,
          id: Math.max(campaign.journalSequence ?? 0, journal.at(-1)?.id ?? 0) + 1,
          week,
        },
      ]),
    ],
    journalSequence: Math.max(campaign.journalSequence ?? 0, journal.at(-1)?.id ?? 0) + 1,
  };
}

export const partyName = (campaign) => campaign.partyToken?.name ?? 'Adventurers';
export function moveEvent(campaign, cell, dressed) {
  const name = partyName(campaign),
    label = hexName({ ...cell, forest: dressed?.forest, props: dressed?.props });
  return {
    kind: 'move',
    text: `${name} travelled to ${label}.`,
    mentions: [
      { type: 'party', key: 'party', start: 0, end: name.length },
      {
        type: 'hex',
        key: cell.key,
        start: name.length + 14,
        end: name.length + 14 + label.length,
      },
    ],
  };
}

// Parse a deliberately small grammar; user strings never enter eval/Function.
export function rollDice(source, random = Math.random) {
  const expressions = source.trim().split(/\s+/);
  if (!source.trim() || source.length > JOURNAL_LIMIT || expressions.length > 20)
    throw new Error('Use up to 20 dice expressions separated by spaces.');
  let diceCount = 0;
  const parsed = expressions.map((expression) => {
    const terms = expression.match(/[+-]?(?:\d*d\d+|\d+)/gi) ?? [];
    if (
      terms.join('').toLowerCase() !== expression.toLowerCase() ||
      !terms.some((term) => /d/i.test(term))
    )
      throw new Error('Use dice expressions such as /2d6+1 4d6 1d20.');
    return terms.map((term) => {
      const sign = term.startsWith('-') ? -1 : 1;
      const [count, sides] = term.replace(/^[+-]/, '').toLowerCase().split('d').map(Number);
      if (sides !== undefined) {
        const quantity = term.replace(/^[+-]/, '').startsWith('d') ? 1 : count;
        diceCount += quantity;
        if (
          ![4, 6, 8, 10, 12, 20].includes(sides) ||
          quantity < 1 ||
          !Number.isSafeInteger(quantity) ||
          diceCount > 100
        )
          throw new Error('Use d4, d6, d8, d10, d12 or d20, with at most 100 dice per entry.');
        return { sign, count: quantity, sides };
      }
      if (!Number.isSafeInteger(count) || count > 1000000)
        throw new Error('Use modifiers between -1,000,000 and 1,000,000.');
      return { sign, value: count };
    });
  });
  return parsed.map((terms, index) => {
    const values = terms.flatMap((term) =>
      term.sides
        ? Array.from(
            { length: term.count },
            () => term.sign * (1 + Math.floor(random() * term.sides)),
          )
        : [term.sign * term.value],
    );
    const calculation = values
      .map((value, i) => (i === 0 ? String(value) : `${value < 0 ? '−' : '+'} ${Math.abs(value)}`))
      .join(' ');
    return {
      expression: expressions[index],
      values,
      total: values.reduce((a, b) => a + b, 0),
      calculation,
    };
  });
}

export function journalCommand(source, mentions = [], random = Math.random) {
  if (typeof source !== 'string' || source.length > 6000 || characterCount(source) > JOURNAL_LIMIT)
    throw new Error('Journal entries can contain up to 300 characters.');
  if (!source.trim()) throw new Error('Write a journal entry first.');
  const refs = validateMentions(mentions, source);
  const input = source.trim();
  if (input === '/help') return { help: true };
  if (input === '/clear') return { clear: true };
  if (input === '/explore') return { explore: true };
  if (input === '/abstract')
    return {
      kind: 'abstract',
      text: `Abstract: ${MAJOR_ARCANA[Math.floor(random() * MAJOR_ARCANA.length)]}`,
      mentions: [],
      command: source,
      commandMentions: refs,
    };
  if (/^\/oracle(?:\s|$)/.test(input)) {
    let question = input.slice(7).trim(),
      modifier = 0;
    const match = question.match(/^([+-]\d+)(?:\s|$)/);
    if (match) {
      modifier = Number(match[1]);
      question = question.slice(match[0].length).trim();
    }
    if (!Number.isSafeInteger(modifier) || Math.abs(modifier) > 1000000)
      throw new Error('Use an oracle modifier between -1,000,000 and 1,000,000.');
    const die = 1 + Math.floor(random() * 6),
      total = Math.max(1, Math.min(6, die + modifier));
    const prefix = question ? `${question}\n` : '';
    const questionStart = question ? source.indexOf(question) : source.length;
    return {
      kind: 'oracle',
      text: `${prefix}Oracle: ${ORACLE_ANSWERS[total - 1]} (d6: ${die}${modifier ? ` ${modifier < 0 ? '−' : '+'} ${Math.abs(modifier)}` : ''} = ${die + modifier}${die + modifier !== total ? ` → ${total}` : ''})`,
      mentions: refs
        .filter((ref) => ref.start >= questionStart && ref.end <= questionStart + question.length)
        .map((ref) => ({ ...ref, start: ref.start - questionStart, end: ref.end - questionStart })),
      command: source,
      commandMentions: refs,
    };
  }
  if (input.startsWith('/'))
    return {
      kind: 'roll',
      text: rollDice(input.slice(1), random)
        .map((roll) => `${roll.expression}: ${roll.calculation} = ${roll.total}`)
        .join('\n'),
      mentions: [],
      command: source,
      commandMentions: refs,
    };
  return { kind: 'note', text: source, mentions: refs };
}

// Older entries retain enough printed roll data to recover their command.
export function journalEntryCommand(entry) {
  if (!['oracle', 'abstract', 'roll'].includes(entry.kind)) return null;
  if (entry.command !== undefined)
    return { text: entry.command, mentions: entry.commandMentions ?? [] };
  if (entry.kind === 'abstract') return { text: '/abstract', mentions: [] };
  if (entry.kind === 'roll')
    return {
      text: `/${entry.text
        .split('\n')
        .map((line) => line.split(':')[0])
        .join(' ')}`,
      mentions: [],
    };
  const split = entry.text.lastIndexOf('\nOracle:');
  const question = split >= 0 ? entry.text.slice(0, split) : '';
  const roll = entry.text.slice(split >= 0 ? split + 1 : 0).match(/\(d6: \d(?: ([−+-]) (\d+))? =/);
  if (!roll) return null;
  const modifier = roll[2] ? `${roll[1] === '−' ? '-' : roll[1]}${roll[2]} ` : '';
  const prefix = `/oracle ${modifier}`;
  return {
    text: `${prefix}${question}`.trimEnd(),
    mentions: (entry.mentions ?? [])
      .filter((ref) => ref.end <= question.length)
      .map((ref) => ({ ...ref, start: ref.start + prefix.length, end: ref.end + prefix.length })),
  };
}

export function mentionOptions(marker, query, campaign, world, increment = 'week') {
  const needle = query.toLocaleLowerCase().trim();
  if (marker === '@') {
    const label = `@${partyName(campaign)}`;
    return ['party', label].some((text) => text.toLocaleLowerCase().includes(needle))
      ? [{ type: 'party', key: 'party', label }]
      : [];
  }
  if (marker === '#') {
    const current = campaign.partyToken?.weeks ?? 1;
    const number = needle.replace(/^(?:week|day|session)s?\s*/i, '');
    const numbers = number ? [Number(number)] : [current];
    return numbers
      .filter((week) => weekNumber(week) && week <= current)
      .map((week) => ({
        type: 'week',
        key: String(week),
        label: `${timeIncrementLabels(increment).label} ${week}`,
      }));
  }
  if (marker !== '$') return [];
  return world.cells
    .filter((cell) => cell.fogState !== 'undiscovered')
    .map((cell) => ({
      type: 'hex',
      key: cell.key,
      label: `${hexName(cell)} · ${hexAddress(cell)}`,
      insert: hexName(cell),
      visited: Boolean(campaign.hexEdits?.cells[cell.key]?.visited),
      search:
        `${cell.key} ${cell.x},${cell.y} ${cell.regionId}/${cell.x},${cell.y} ${hexAddress(cell)} ${hexName(cell)} ${cell.forest?.name ?? ''} ${cell.terrain}`.toLocaleLowerCase(),
    }))
    .filter((option) => option.search.includes(needle.replace(/,\s+/g, ',')))
    .sort((a, b) => Number(b.visited) - Number(a.visited) || a.label.localeCompare(b.label))
    .slice(0, 8);
}
