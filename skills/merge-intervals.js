import { ok, fail, computed } from '../src/contracts.js';

const pair = (v) => {
  if (Array.isArray(v) && v.length === 2) return { start: v[0], end: v[1] };
  if (v && typeof v === 'object' && 'start' in v && 'end' in v) return { start: v.start, end: v.end };
  return null;
};

export default {
  name: 'mergeIntervals',
  description: 'Merge overlapping or touching ranges into the fewest that cover the same ground.',
  category: 'dates', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} of {{originalCount}} {{originalCount|plural:range:ranges}} remain after merging: {{lines|list}}.',
  inputSchema: {
    type: 'object', required: ['intervals'],
    properties: {
      intervals: { type: 'array', label: 'ranges', minItems: 1, maxItems: 1000, prompt: 'Which ranges should I merge?' },
      touchingCounts: { type: 'boolean', label: 'join touching ranges', default: true, description: 'treat ranges that end exactly where the next begins as joined' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      merged: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, originalCount: { type: 'integer' }, removed: { type: 'integer' }
    }
  },
  examples: [
    { text: 'merge these overlapping ranges', input: { intervals: [[1, 3], [2, 6], [8, 10], [15, 18]] }, output: { merged: [{ start: 1, end: 6 }, { start: 8, end: 10 }, { start: 15, end: 18 }], lines: ['1 to 6', '8 to 10', '15 to 18'], count: 3, originalCount: 4, removed: 1 } },
    { text: 'combine ranges that touch', input: { intervals: [[1, 4], [4, 5]] }, output: { merged: [{ start: 1, end: 5 }], lines: ['1 to 5'], count: 1, originalCount: 2, removed: 1 } },
    { text: 'merge a range fully inside another', input: { intervals: [[1, 10], [2, 3]] }, output: { merged: [{ start: 1, end: 10 }], lines: ['1 to 10'], count: 1, originalCount: 2, removed: 1 } },
    { text: 'merge ranges given out of order', input: { intervals: [[5, 6], [1, 2]] }, output: { merged: [{ start: 1, end: 2 }, { start: 5, end: 6 }], lines: ['1 to 2', '5 to 6'], count: 2, originalCount: 2, removed: 0 } },
    { text: 'merge these date ranges', input: { intervals: [{ start: '2026-01-01', end: '2026-03-31' }, { start: '2026-03-01', end: '2026-06-30' }] }, output: { merged: [{ start: '2026-01-01', end: '2026-06-30' }], lines: ['2026-01-01 to 2026-06-30'], count: 1, originalCount: 2, removed: 1 } }
  ],
  errorCases: [
    { input: { intervals: [[5, 1]] }, code: 'INVALID_INPUT' },
    { input: { intervals: [[1]] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const rows = [];
    for (const [i, raw] of input.intervals.entries()) {
      const p = pair(raw);
      if (!p) return fail('INVALID_INPUT', `Range ${i + 1} is not a pair of values — give each one as [start, end] or {start, end}.`, 'intervals');
      if (p.start > p.end) return fail('INVALID_INPUT', `Range ${i + 1} ends before it starts.`, 'intervals');
      rows.push(p);
    }

    /* Sorted by start, then swept once. Numbers and ISO date strings both
       compare correctly with < because ISO dates sort lexicographically in
       date order - which is the entire reason that format exists. */
    rows.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const merged = [];
    for (const row of rows) {
      const last = merged[merged.length - 1];
      const joins = last && (input.touchingCounts === false ? row.start < last.end : row.start <= last.end);
      if (joins) { if (row.end > last.end) last.end = row.end; }
      else merged.push({ ...row });
    }

    return ok({
      merged, lines: merged.map((m) => `${m.start} to ${m.end}`),
      count: merged.length, originalCount: rows.length, removed: rows.length - merged.length
    }, computed());
  }
};
