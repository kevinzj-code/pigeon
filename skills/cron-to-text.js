import { ok, fail, computed } from '../src/contracts.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTH_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const FIELDS = [
  { key: 'minute', min: 0, max: 59 },
  { key: 'hour', min: 0, max: 23 },
  { key: 'dayOfMonth', min: 1, max: 31 },
  { key: 'month', min: 1, max: 12, names: MONTH_NAMES },
  { key: 'dayOfWeek', min: 0, max: 7, names: DAY_NAMES }
];

/* Parsed into a shape the describer can read without re-parsing: what kind of
   field it is, plus the numbers involved. */
function parseField (raw, spec) {
  const named = (t) => {
    const n = spec.names?.[String(t).toLowerCase().slice(0, 3)];
    return n === undefined ? t : String(n);
  };
  const num = (t) => {
    const v = Number(named(t));
    if (!Number.isInteger(v) || v < spec.min || v > spec.max) return null;
    return v;
  };

  const step = /^(.+)\/(\d+)$/.exec(raw);
  if (step) {
    const every = Number(step[2]);
    if (!every) return null;
    if (step[1] === '*') return { kind: 'step', every, from: spec.min, to: spec.max };
    const range = /^(\w+)-(\w+)$/.exec(step[1]);
    if (!range) return null;
    const a = num(range[1]); const b = num(range[2]);
    if (a === null || b === null || a > b) return null;
    return { kind: 'step', every, from: a, to: b };
  }
  if (raw === '*') return { kind: 'any' };
  const range = /^(\w+)-(\w+)$/.exec(raw);
  if (range) {
    const a = num(range[1]); const b = num(range[2]);
    if (a === null || b === null || a > b) return null;
    return { kind: 'range', from: a, to: b };
  }
  if (raw.includes(',')) {
    const values = raw.split(',').map(num);
    if (values.some((v) => v === null) || !values.length) return null;
    return { kind: 'list', values };
  }
  const v = num(raw);
  return v === null ? null : { kind: 'single', value: v };
}

const pad = (n) => String(n).padStart(2, '0');
const dayName = (n) => DAYS[n === 7 ? 0 : n];

function describeSet (f, name) {
  if (f.kind === 'single') return name ? name(f.value) : String(f.value);
  if (f.kind === 'range') return name ? `${name(f.from)} to ${name(f.to)}` : `${f.from} to ${f.to}`;
  if (f.kind === 'list') return f.values.map((v) => (name ? name(v) : String(v))).join(', ');
  return `every ${f.every}`;
}

export default {
  name: 'cronToText',
  description: 'Explain what a cron schedule expression means in plain English.',
  category: 'developer', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{text|prose}}',
  inputSchema: {
    type: 'object', required: ['expression'],
    properties: { expression: { type: 'string', label: 'cron expression', minLength: 1, prompt: 'Which cron expression should I explain?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' }, expression: { type: 'string' },
      minute: { type: 'string' }, hour: { type: 'string' }, dayOfMonth: { type: 'string' },
      month: { type: 'string' }, dayOfWeek: { type: 'string' }
    }
  },
  examples: [
    { text: 'what does this cron expression mean', input: { expression: '0 9 * * 1-5' }, output: { text: 'At 09:00, Monday to Friday', expression: '0 9 * * 1-5', minute: '0', hour: '9', dayOfMonth: '*', month: '*', dayOfWeek: '1-5' } },
    { text: 'explain this cron schedule', input: { expression: '*/15 * * * *' }, output: { text: 'Every 15 minutes', expression: '*/15 * * * *', minute: '*/15', hour: '*', dayOfMonth: '*', month: '*', dayOfWeek: '*' } },
    { text: 'when does this cron run', input: { expression: '0 0 1 * *' }, output: { text: 'At 00:00, on day 1 of the month', expression: '0 0 1 * *', minute: '0', hour: '0', dayOfMonth: '1', month: '*', dayOfWeek: '*' } },
    { text: 'translate this crontab line', input: { expression: '30 6 * * 0' }, output: { text: 'At 06:30, on Sunday', expression: '30 6 * * 0', minute: '30', hour: '6', dayOfMonth: '*', month: '*', dayOfWeek: '0' } },
    { text: 'what schedule is this cron', input: { expression: '0 */2 * * *' }, output: { text: 'Every 2 hours, on the hour', expression: '0 */2 * * *', minute: '0', hour: '*/2', dayOfMonth: '*', month: '*', dayOfWeek: '*' } }
  ],
  errorCases: [
    { input: { expression: '0 9 * *' }, code: 'INVALID_INPUT' },
    { input: { expression: '99 9 * * *' }, code: 'INVALID_INPUT' },
    { input: { expression: 'a b c d e' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const raw = String(input.expression).trim().split(/\s+/);
    if (raw.length !== 5) {
      return fail('INVALID_INPUT', `A cron expression has five fields — minute, hour, day of month, month, day of week — and this has ${raw.length}.`, 'expression');
    }

    const parsed = {};
    for (const [i, spec] of FIELDS.entries()) {
      const f = parseField(raw[i], spec);
      if (!f) {
        return fail('INVALID_INPUT', `"${raw[i]}" is not a valid ${spec.key.replace(/([A-Z])/g, ' $1').toLowerCase()} — it takes ${spec.min} to ${spec.max}, *, a list, a range, or a step like */5.`, 'expression');
      }
      parsed[spec.key] = f;
    }

    const { minute, hour, dayOfMonth, month, dayOfWeek } = parsed;

    /* Every field kind needs its own wording in both slots, or the fallback
       reads like machine output: an "any" minute described by the step branch
       produced "of hour every undefined". */
    const minutePhrase = { any: 'every minute', single: `minute ${minute.value}`, list: `minutes ${describeSet(minute)}`, range: `minutes ${describeSet(minute)}`, step: `every ${minute.every} minutes` }[minute.kind];
    const hourPhrase = { any: 'every hour', single: `${pad(hour.value)}:00`, list: `hours ${describeSet(hour)}`, range: `hours ${describeSet(hour)}`, step: `every ${hour.every} hours` }[hour.kind];

    let when;
    if (minute.kind === 'step' && hour.kind === 'any') when = `Every ${minute.every} minutes`;
    else if (minute.kind === 'step' && hour.kind === 'range') when = `Every ${minute.every} minutes, between ${pad(hour.from)}:00 and ${pad(hour.to)}:00`;
    else if (minute.kind === 'step' && hour.kind === 'single') when = `Every ${minute.every} minutes of the ${pad(hour.value)}:00 hour`;
    else if (minute.kind === 'any' && hour.kind === 'any') when = 'Every minute';
    else if (minute.kind === 'single' && hour.kind === 'single') when = `At ${pad(hour.value)}:${pad(minute.value)}`;
    else if (minute.kind === 'single' && hour.kind === 'step') {
      when = minute.value === 0 ? `Every ${hour.every} hours, on the hour` : `Every ${hour.every} hours, at ${minute.value} minutes past`;
    } else if (minute.kind === 'single' && hour.kind === 'any') {
      when = minute.value === 0 ? 'At the top of every hour' : `At ${minute.value} minutes past every hour`;
    } else if (minute.kind === 'any' && hour.kind === 'single') when = `Every minute of the ${pad(hour.value)}:00 hour`;
    else when = `At ${minutePhrase} past ${hourPhrase}`;

    const tail = [];
    if (dayOfMonth.kind !== 'any') tail.push(dayOfMonth.kind === 'single' ? `on day ${dayOfMonth.value} of the month` : `on days ${describeSet(dayOfMonth)} of the month`);
    if (dayOfWeek.kind !== 'any') tail.push(dayOfWeek.kind === 'range' ? describeSet(dayOfWeek, dayName) : `on ${describeSet(dayOfWeek, dayName)}`);
    if (month.kind !== 'any') tail.push(`in ${describeSet(month, (m) => MONTHS[m - 1])}`);

    let text = [when, ...tail].join(', ');
    /* cron's one genuine trap: when BOTH day-of-month and day-of-week are set,
       the job runs on either, not on both together. Reading it as "and" is how
       people end up with a job firing far more often than they meant. */
    if (dayOfMonth.kind !== 'any' && dayOfWeek.kind !== 'any') {
      text += ' (cron runs on either of those, not only when they coincide)';
    }

    return ok({
      text, expression: raw.join(' '),
      minute: raw[0], hour: raw[1], dayOfMonth: raw[2], month: raw[3], dayOfWeek: raw[4]
    }, computed());
  }
};
