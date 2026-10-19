import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

/* Mean Earth radius. The planet is an oblate spheroid, so a single radius makes
   this an approximation — accurate to roughly 0.5%, which is metres over a city
   and a few kilometres across a hemisphere. Hence the "estimate" label. */
const EARTH_KM = 6371.0088;

export default {
  name: 'haversineDistance',
  description: 'Work out the great-circle distance between two points on Earth from their latitude and longitude.',
  category: 'geometry', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: ['estimate'],
  title: 'Distance from lat/long',
  replyTemplate: '{{km}} km ({{miles}} miles) as the crow flies, bearing {{bearing}} degrees.',
  inputSchema: {
    type: 'object', required: ['lat1', 'lon1', 'lat2', 'lon2'],
    properties: {
      lat1: { type: 'number', label: 'first latitude', minimum: -90, maximum: 90, prompt: 'What is the first latitude?' },
      lon1: { type: 'number', label: 'first longitude', minimum: -180, maximum: 180, prompt: 'What is the first longitude?' },
      lat2: { type: 'number', label: 'second latitude', minimum: -90, maximum: 90, prompt: 'What is the second latitude?' },
      lon2: { type: 'number', label: 'second longitude', minimum: -180, maximum: 180, prompt: 'What is the second longitude?' }
    }
  },
  outputSchema: { type: 'object', properties: { km: { type: 'number' }, miles: { type: 'number' }, nauticalMiles: { type: 'number' }, metres: { type: 'number' }, bearing: { type: 'number' }, compass: { type: 'string' } } },
  examples: [
    { text: 'distance from london to paris', input: { lat1: 51.5074, lon1: -0.1278, lat2: 48.8566, lon2: 2.3522 }, output: { km: 343.56, miles: 213.48, nauticalMiles: 185.51, metres: 343557, bearing: 148.1, compass: 'SSE' } },
    { text: 'how far is new york from london', input: { lat1: 40.7128, lon1: -74.006, lat2: 51.5074, lon2: -0.1278 }, output: { km: 5570.23, miles: 3461.18, nauticalMiles: 3007.68, metres: 5570230, bearing: 51.2, compass: 'NE' } },
    { text: 'distance between two nearby points', input: { lat1: 51.5, lon1: -0.1, lat2: 51.51, lon2: -0.1 }, output: { km: 1.11, miles: 0.69, nauticalMiles: 0.6, metres: 1112, bearing: 0, compass: 'N' } },
    { text: 'distance from sydney to tokyo', input: { lat1: -33.8688, lon1: 151.2093, lat2: 35.6762, lon2: 139.6503 }, output: { km: 7825.83, miles: 4862.74, nauticalMiles: 4225.61, metres: 7825829, bearing: 350, compass: 'N' } },
    { text: 'distance between the same point', input: { lat1: 51.5, lon1: -0.1, lat2: 51.5, lon2: -0.1 }, output: { km: 0, miles: 0, nauticalMiles: 0, metres: 0, bearing: 0, compass: 'N' } }
  ],
  errorCases: [
    { input: { lat1: 200, lon1: 0, lat2: 0, lon2: 0 }, code: 'INVALID_INPUT' },
    { input: { lat1: 0, lon1: 0, lat2: 0 }, code: 'MISSING_FIELD' },
    { input: { lat1: 0, lon1: 400, lat2: 0, lon2: 0 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const rad = (d) => (d * Math.PI) / 180;
    const { lat1, lon1, lat2, lon2 } = input;
    for (const [k, v, max] of [['lat1', lat1, 90], ['lat2', lat2, 90], ['lon1', lon1, 180], ['lon2', lon2, 180]]) {
      if (Math.abs(v) > max) return fail('INVALID_INPUT', `${k} has to be between -${max} and ${max}.`, k);
    }
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    const km = EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    /* Initial bearing — the direction you would set off in. It changes along a
       great circle, so this is the heading at the start, not throughout. */
    const y = Math.sin(dLon) * Math.cos(rad(lat2));
    const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
    const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

    return ok({
      km: round(km, 2), miles: round(km / 1.609344, 2), nauticalMiles: round(km / 1.852, 2),
      metres: Math.round(km * 1000),
      bearing: round(bearing, 1), compass: POINTS[Math.round(bearing / 22.5) % 16]
    }, computed());
  }
};
