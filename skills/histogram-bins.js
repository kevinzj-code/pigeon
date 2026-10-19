import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'histogramBins',
  description: 'Bucket numbers into a number of equal-width ranges and count how many fall in each.',
  category: 'statistics', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{bins}} bins across {{min}} to {{max}}: {{labels|list}}. The fullest holds {{peak}}.',
  inputSchema: {
    type: 'object', required: ['values'],
    properties: {
      values: { type: 'array', label: 'numbers', items: { type: 'number' }, minItems: 2, prompt: 'Which numbers?' },
      bins: { type: 'integer', label: 'number of bins', minimum: 2, maximum: 50, default: 5 }
    }
  },
  outputSchema: { type: 'object', properties: { counts: { type: 'array', items: { type: 'integer' } }, labels: { type: 'array', items: { type: 'string' } }, edges: { type: 'array', items: { type: 'number' } }, bins: { type: 'integer' }, min: { type: 'number' }, max: { type: 'number' }, width: { type: 'number' }, peak: { type: 'integer' } } },
  examples: [
    { text: 'bin these numbers into 5 groups', input: { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, output: { counts: [2, 2, 2, 2, 2], labels: ['1–2.8: 2', '2.8–4.6: 2', '4.6–6.4: 2', '6.4–8.2: 2', '8.2–10: 2'], edges: [1, 2.8, 4.6, 6.4, 8.2, 10], bins: 5, min: 1, max: 10, width: 1.8, peak: 2 } },
    { text: 'histogram of these scores in 4 bins', input: { values: [10, 20, 20, 30, 40, 40, 40], bins: 4 }, output: { counts: [1, 2, 1, 3], labels: ['10–17.5: 1', '17.5–25: 2', '25–32.5: 1', '32.5–40: 3'], edges: [10, 17.5, 25, 32.5, 40], bins: 4, min: 10, max: 40, width: 7.5, peak: 3 } },
    { text: 'distribution of these ages in 3 bins', input: { values: [22, 25, 31, 35, 44, 51], bins: 3 }, output: { counts: [3, 1, 2], labels: ['22–31.67: 3', '31.67–41.33: 1', '41.33–51: 2'], edges: [22, 31.6667, 41.3333, 51], bins: 3, min: 22, max: 51, width: 9.6667, peak: 3 } },
    { text: 'bin values that are all the same', input: { values: [5, 5, 5, 5], bins: 2 }, output: { counts: [4, 0], labels: ['5–5: 4', '5–5: 0'], edges: [5, 5, 5], bins: 2, min: 5, max: 5, width: 0, peak: 4 } },
    { text: 'histogram with two bins', input: { values: [1, 2, 8, 9], bins: 2 }, output: { counts: [2, 2], labels: ['1–5: 2', '5–9: 2'], edges: [1, 5, 9], bins: 2, min: 1, max: 9, width: 4, peak: 2 } },
    { text: 'sort these readings into four equal-width bands', input: { values: [1, 3, 5, 7, 9, 11, 13, 15], bins: 4 },
      output: { counts: [2, 2, 2, 2], labels: ['1–4.5: 2', '4.5–8: 2', '8–11.5: 2', '11.5–15: 2'], edges: [1, 4.5, 8, 11.5, 15], bins: 4, min: 1, max: 15, width: 3.5, peak: 2 } },
    { text: 'sort these numbers into 3 equal-width buckets', input: { values: [2, 4, 6, 8, 10, 12], bins: 3 },
      output: { counts: [2, 2, 2], labels: ['2–5.33: 2', '5.33–8.67: 2', '8.67–12: 2'], edges: [2, 5.3333, 8.6667, 12], bins: 3, min: 2, max: 12, width: 3.3333, peak: 2 } }
  ],
  errorCases: [
    { input: { values: [1] }, code: 'INVALID_INPUT' },
    { input: { values: [1, 2], bins: 1 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    if (input.values.length < 2) return fail('INVALID_INPUT', 'I need at least two numbers to bin.', 'values');
    const min = Math.min(...input.values);
    const max = Math.max(...input.values);
    const width = (max - min) / input.bins;

    const counts = new Array(input.bins).fill(0);
    for (const v of input.values) {
      /* Bins are half-open [lo, hi) so a value never lands in two — except the
         maximum, which belongs in the last bin rather than falling off the end. */
      const idx = width === 0 ? 0 : Math.min(input.bins - 1, Math.floor((v - min) / width));
      counts[idx] += 1;
    }
    const edges = Array.from({ length: input.bins + 1 }, (_, i) => round(min + i * width, 4));
    const short = (n) => round(n, 2);
    return ok({
      counts,
      labels: counts.map((c, i) => `${short(edges[i])}–${short(edges[i + 1])}: ${c}`),
      edges, bins: input.bins, min, max, width: round(width, 4),
      peak: Math.max(...counts)
    }, computed());
  }
};
