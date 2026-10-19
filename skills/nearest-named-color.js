import { ok, fail, computed } from '../src/contracts.js';
import { parseColor, toHex } from '../src/lib/color.js';
import { rankNamedColors } from '../src/lib/named-colors.js';

/* "What would you call this colour?" — answered with the CSS keyword nearest to
 * it, and with how close that actually is.
 *
 * The distance is reported rather than hidden, because "nearest" is not the same
 * as "the same". Every colour has a nearest name; only some have a name worth
 * using. A distance of 0 is an exact match, under about 10 is a colour most
 * people would accept as that name, and 40 is a different colour that simply
 * happened to be closest. Returning "purple" for a muddy brown without saying
 * how far off it is would be the sort of confident half-answer this project
 * exists to avoid.
 */
export default {
  name: 'nearestNamedColor',
  description: 'Find the closest CSS colour name to a colour — what you would call it in words.',
  category: 'design',
  tier: 'extended',
  unbuilt: false,
  needsNetwork: false,
  /* No dataAsOf: the CSS keywords are part of a specification, not a table that
     goes stale. They cannot change without a new version of CSS. */
  dataAsOf: null,
  labels: [],
  replyTemplate: '{{input}} is closest to {{name}} ({{hex}}){{exact|prose}}.',
  inputSchema: {
    type: 'object',
    required: ['color'],
    properties: {
      color: { type: 'string', label: 'colour', minLength: 3, prompt: 'Which colour?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      hex: { type: 'string' },
      input: { type: 'string' },
      distance: { type: 'number' },
      exactMatch: { type: 'boolean' },
      exact: { type: 'string' },
      alternatives: { type: 'array', items: { type: 'string' } }
    }
  },
  examples: [
    { text: "what colour name is closest to #556B2F", input: {"color":"#556B2F"},
      output: {"name":"darkolivegreen","hex":"#556B2F","input":"#556B2F","distance":0,"exactMatch":true,"exact":" exactly","alternatives":["olivedrab","seagreen"]} },
    { text: "closest css colour to #2C6E8C", input: {"color":"#2C6E8C"},
      output: {"name":"steelblue","hex":"#4682B4","input":"#2C6E8C","distance":14.69,"exactMatch":false,"exact":"","alternatives":["slategray","lightslategray"]} },
    { text: "what would you call rgb(255, 87, 51)", input: {"color":"rgb(255, 87, 51)"},
      output: {"name":"tomato","hex":"#FF6347","input":"#FF5733","distance":9.2,"exactMatch":false,"exact":"","alternatives":["orangered","coral"]} },
    { text: "name for #FFFFFF", input: {"color":"#FFFFFF"},
      output: {"name":"white","hex":"#FFFFFF","input":"#FFFFFF","distance":0,"exactMatch":true,"exact":" exactly","alternatives":["snow","whitesmoke"]} },
    { text: "nearest colour name to #123456", input: {"color":"#123456"},
      output: {"name":"darkslategray","hex":"#2F4F4F","input":"#123456","distance":26.13,"exactMatch":false,"exact":"","alternatives":["black","darkslateblue"]} },
    { text: "give me a name for this shade of pink", input: {"color":"#FFC0CB"},
      output: {"name":"pink","hex":"#FFC0CB","input":"#FFC0CB","distance":0,"exactMatch":true,"exact":" exactly","alternatives":["lightpink","thistle"]} }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { color: 'ff' }, code: 'INVALID_INPUT' },
    { input: { color: 'not a colour at all' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const rgb = parseColor(input.color);
    if (!rgb) return fail('INVALID_INPUT', `"${input.color}" isn't a colour I can read — try a hex code like #556B2F or rgb(85, 107, 47).`, 'color');

    const ranked = rankNamedColors(rgb.r, rgb.g, rgb.b);
    const best = ranked[0];
    const exactMatch = best.distance === 0;
    return ok({
      name: best.name,
      hex: best.hex,
      input: toHex(rgb.r, rgb.g, rgb.b),
      distance: best.distance,
      exactMatch,
      /* A |prose token, so the sentence reads naturally without the phrase
         being marked as a computed value — it is a wording, not a datum. */
      exact: exactMatch ? ' exactly' : '',
      alternatives: ranked.slice(1, 3).map(c => c.name)
    }, computed());
  }
};
