import { ok, fail, computed } from '../src/contracts.js';

/* §27: formula-only, no targets, no advice. This divides a number you supply
 * into percentage bands and names them the way training literature does. It
 * does not tell anyone what to train at, and it does NOT estimate a maximum
 * heart rate — `220 minus age` is a rule of thumb with a standard deviation of
 * around 10-12 beats, which makes every zone derived from it wrong by an
 * unknown amount. So the maximum is a required input: if you have not measured
 * it, this skill asks rather than inventing one. */
const ZONES = [
  [50, 60, 'Zone 1', 'very light'],
  [60, 70, 'Zone 2', 'light'],
  [70, 80, 'Zone 3', 'moderate'],
  [80, 90, 'Zone 4', 'hard'],
  [90, 100, 'Zone 5', 'maximum']
];

export default {
  name: 'heartRateZones',
  description: 'Split a maximum heart rate you supply into the standard five training zones.',
  category: 'health', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['formula-only'],
  replyTemplate: 'From a maximum of {{maxHeartRate}}: {{summary|prose}}.{{note|prose}}',
  inputSchema: {
    type: 'object', required: ['maxHeartRate'],
    properties: {
      maxHeartRate: { type: 'integer', label: 'max heart rate (bpm)', minimum: 60, maximum: 250, prompt: 'What is the maximum heart rate, in beats per minute? (a measured figure — I will not estimate one from age)' },
      restingHeartRate: { type: 'integer', label: 'resting heart rate (bpm)', minimum: 20, maximum: 150, description: 'if given, zones are worked out by heart rate reserve instead' }
    }
  },
  outputSchema: { type: 'object', properties: { zones: { type: 'array' }, summary: { type: 'string' }, maxHeartRate: { type: 'integer' }, method: { type: 'string' }, note: { type: 'string' } } },
  examples: [
    { text: 'heart rate zones for a max of 190', input: { maxHeartRate: 190 }, output: { zones: [{ zone: 'Zone 1', effort: 'very light', low: 95, high: 114 }, { zone: 'Zone 2', effort: 'light', low: 114, high: 133 }, { zone: 'Zone 3', effort: 'moderate', low: 133, high: 152 }, { zone: 'Zone 4', effort: 'hard', low: 152, high: 171 }, { zone: 'Zone 5', effort: 'maximum', low: 171, high: 190 }], summary: 'Zone 1 95-114, Zone 2 114-133, Zone 3 133-152, Zone 4 152-171, Zone 5 171-190', maxHeartRate: 190, method: 'percentage of maximum', note: ' These are percentage bands of the figure you gave, not a training plan.' } },
    { text: 'training zones from a measured max of 180', input: { maxHeartRate: 180 }, output: { zones: [{ zone: 'Zone 1', effort: 'very light', low: 90, high: 108 }, { zone: 'Zone 2', effort: 'light', low: 108, high: 126 }, { zone: 'Zone 3', effort: 'moderate', low: 126, high: 144 }, { zone: 'Zone 4', effort: 'hard', low: 144, high: 162 }, { zone: 'Zone 5', effort: 'maximum', low: 162, high: 180 }], summary: 'Zone 1 90-108, Zone 2 108-126, Zone 3 126-144, Zone 4 144-162, Zone 5 162-180', maxHeartRate: 180, method: 'percentage of maximum', note: ' These are percentage bands of the figure you gave, not a training plan.' } },
    { text: 'zones using heart rate reserve with resting 50', input: { maxHeartRate: 190, restingHeartRate: 50 }, output: { zones: [{ zone: 'Zone 1', effort: 'very light', low: 120, high: 134 }, { zone: 'Zone 2', effort: 'light', low: 134, high: 148 }, { zone: 'Zone 3', effort: 'moderate', low: 148, high: 162 }, { zone: 'Zone 4', effort: 'hard', low: 162, high: 176 }, { zone: 'Zone 5', effort: 'maximum', low: 176, high: 190 }], summary: 'Zone 1 120-134, Zone 2 134-148, Zone 3 148-162, Zone 4 162-176, Zone 5 176-190', maxHeartRate: 190, method: 'heart rate reserve (Karvonen)', note: ' These are percentage bands of the figures you gave, not a training plan.' } },
    { text: 'zones for a max of 200', input: { maxHeartRate: 200 }, output: { zones: [{ zone: 'Zone 1', effort: 'very light', low: 100, high: 120 }, { zone: 'Zone 2', effort: 'light', low: 120, high: 140 }, { zone: 'Zone 3', effort: 'moderate', low: 140, high: 160 }, { zone: 'Zone 4', effort: 'hard', low: 160, high: 180 }, { zone: 'Zone 5', effort: 'maximum', low: 180, high: 200 }], summary: 'Zone 1 100-120, Zone 2 120-140, Zone 3 140-160, Zone 4 160-180, Zone 5 180-200', maxHeartRate: 200, method: 'percentage of maximum', note: ' These are percentage bands of the figure you gave, not a training plan.' } },
    { text: 'zones for a max of 165', input: { maxHeartRate: 165 }, output: { zones: [{ zone: 'Zone 1', effort: 'very light', low: 83, high: 99 }, { zone: 'Zone 2', effort: 'light', low: 99, high: 116 }, { zone: 'Zone 3', effort: 'moderate', low: 116, high: 132 }, { zone: 'Zone 4', effort: 'hard', low: 132, high: 149 }, { zone: 'Zone 5', effort: 'maximum', low: 149, high: 165 }], summary: 'Zone 1 83-99, Zone 2 99-116, Zone 3 116-132, Zone 4 132-149, Zone 5 149-165', maxHeartRate: 165, method: 'percentage of maximum', note: ' These are percentage bands of the figure you gave, not a training plan.' } }
  ],
  errorCases: [
    { input: { maxHeartRate: 300 }, code: 'INVALID_INPUT' },
    { input: { maxHeartRate: 190, restingHeartRate: 200 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const { maxHeartRate: max, restingHeartRate: rest } = input;
    if (rest !== undefined && rest >= max) {
      return fail('INVALID_INPUT', 'The resting rate has to be below the maximum.', 'restingHeartRate');
    }
    /* Karvonen when a resting rate is given: zones as a percentage of the
       RESERVE (max minus resting) added back to resting, which shifts every
       band upward. Two methods that give different numbers from the same max,
       so the one used is reported. */
    /* Multiply BEFORE dividing. (70 / 100) * 165 is 115.49999999999999 in
       binary floating point and rounds to 115; (70 * 165) / 100 is exactly
       115.5 and rounds to 116. Same arithmetic, one of them off by a beat. */
    const at = (pct) => (rest === undefined
      ? Math.round((pct * max) / 100)
      : Math.round(rest + (pct * (max - rest)) / 100));

    const zones = ZONES.map(([lo, hi, zone, effort]) => ({ zone, effort, low: at(lo), high: at(hi) }));
    return ok({
      zones,
      summary: zones.map(z => `${z.zone} ${z.low}-${z.high}`).join(', '),
      maxHeartRate: max,
      method: rest === undefined ? 'percentage of maximum' : 'heart rate reserve (Karvonen)',
      note: rest === undefined
        ? ' These are percentage bands of the figure you gave, not a training plan.'
        : ' These are percentage bands of the figures you gave, not a training plan.'
    }, computed());
  }
};
