import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

const pad = (n) => String(n).padStart(2, '0');
const asClock = (totalSeconds) => {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};

export default {
  name: 'paceCalculate',
  description: 'Convert between running pace, speed and finish time over a distance.',
  category: 'health', tier: 'standard',
  title: 'Running pace',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['formula-only'],
  replyTemplate: '{{paceText|prose}} per km over {{distanceKm}} km is a finish time of {{timeText|prose}}, at {{kph}} km/h.',
  inputSchema: {
    type: 'object', required: ['distanceKm'],
    properties: {
      distanceKm: { type: 'number', label: 'distance (km)', exclusiveMinimum: 0, prompt: 'How far, in kilometres?' },
      paceSecondsPerKm: { type: 'number', label: 'pace (seconds per km)', exclusiveMinimum: 0, description: 'seconds per kilometre' },
      timeSeconds: { type: 'number', label: 'finish time (seconds)', exclusiveMinimum: 0, description: 'total finish time in seconds' }
    }
  },
  outputSchema: { type: 'object', properties: { paceText: { type: 'string' }, paceSecondsPerKm: { type: 'number' }, timeText: { type: 'string' }, timeSeconds: { type: 'number' }, kph: { type: 'number' }, mph: { type: 'number' }, milePaceText: { type: 'string' }, distanceKm: { type: 'number' } } },
  examples: [
    { text: 'finish time for a 10k at 5:30 per km', input: { distanceKm: 10, paceSecondsPerKm: 330 }, output: { paceText: '5:30', paceSecondsPerKm: 330, timeText: '55:00', timeSeconds: 3300, kph: 10.91, mph: 6.78, milePaceText: '8:51', distanceKm: 10 } },
    { text: 'what pace is a 3 hour marathon', input: { distanceKm: 42.195, timeSeconds: 10800 }, output: { paceText: '4:16', paceSecondsPerKm: 255.95, timeText: '3:00:00', timeSeconds: 10800, kph: 14.07, mph: 8.74, milePaceText: '6:52', distanceKm: 42.195 } },
    { text: 'pace for a 5k in 25 minutes', input: { distanceKm: 5, timeSeconds: 1500 }, output: { paceText: '5:00', paceSecondsPerKm: 300, timeText: '25:00', timeSeconds: 1500, kph: 12, mph: 7.46, milePaceText: '8:03', distanceKm: 5 } },
    { text: 'half marathon at 6 minutes per km', input: { distanceKm: 21.0975, paceSecondsPerKm: 360 }, output: { paceText: '6:00', paceSecondsPerKm: 360, timeText: '2:06:35', timeSeconds: 7595.1, kph: 10, mph: 6.21, milePaceText: '9:39', distanceKm: 21.0975 } },
    { text: 'finish time for a parkrun at 4:45 per km', input: { distanceKm: 5, paceSecondsPerKm: 285 }, output: { paceText: '4:45', paceSecondsPerKm: 285, timeText: '23:45', timeSeconds: 1425, kph: 12.63, mph: 7.85, milePaceText: '7:39', distanceKm: 5 } }
  ],
  errorCases: [
    { input: { distanceKm: 10 }, code: 'INVALID_INPUT' },
    { input: { distanceKm: 10, paceSecondsPerKm: 300, timeSeconds: 3000 }, code: 'INVALID_INPUT' },
    { input: { paceSecondsPerKm: 300 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const hasPace = input.paceSecondsPerKm !== undefined;
    const hasTime = input.timeSeconds !== undefined;
    /* Exactly one of pace or time — with both, the two could disagree and there
       would be no honest way to choose which the user meant. */
    if (hasPace === hasTime) {
      return fail('INVALID_INPUT', 'Give me either a pace or a finish time, not both and not neither.', hasPace ? 'timeSeconds' : 'paceSecondsPerKm');
    }
    const paceSecondsPerKm = hasPace ? input.paceSecondsPerKm : input.timeSeconds / input.distanceKm;
    const timeSeconds = hasTime ? input.timeSeconds : paceSecondsPerKm * input.distanceKm;
    const kph = 3600 / paceSecondsPerKm;
    return ok({
      paceText: asClock(paceSecondsPerKm), paceSecondsPerKm: round(paceSecondsPerKm, 2),
      timeText: asClock(timeSeconds), timeSeconds: round(timeSeconds, 2),
      kph: round(kph, 2), mph: round(kph / 1.609344, 2),
      milePaceText: asClock(paceSecondsPerKm * 1.609344),
      distanceKm: input.distanceKm
    }, computed());
  }
};
