import { ok, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'hourlyToSalary',
  description: "Turn an hourly wage into the yearly salary it adds up to.",
  category: 'finance', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{hourly|comma}} an hour is {{annual|comma}} a year — {{monthly|comma}} a month, {{weekly|comma}} a week, over {{weeks}} paid weeks.',
  inputSchema: {
    type: 'object', required: ['hourly'],
    properties: {
      hourly: { type: 'number', label: 'hourly rate', carry: true, exclusiveMinimum: 0, prompt: 'What is the hourly rate?' },
      hoursPerWeek: { type: 'number', label: 'hours per week', exclusiveMinimum: 0, maximum: 168, default: 37.5 },
      weeksPerYear: { type: 'number', label: 'weeks per year', exclusiveMinimum: 0, maximum: 53, default: 52 }
    }
  },
  outputSchema: { type: 'object', properties: { annual: { type: 'number' }, monthly: { type: 'number' }, weekly: { type: 'number' }, daily: { type: 'number' }, hourly: { type: 'number' }, hours: { type: 'number' }, weeks: { type: 'number' } } },
  examples: [
    { text: 'what is 25 an hour as a salary', input: { hourly: 25 }, output: { annual: 48750, monthly: 4062.5, weekly: 937.5, daily: 187.5, hourly: 25, hours: 37.5, weeks: 52 } },
    { text: 'annual salary for 18.50 an hour at 40 hours', input: { hourly: 18.5, hoursPerWeek: 40 }, output: { annual: 38480, monthly: 3206.67, weekly: 740, daily: 148, hourly: 18.5, hours: 40, weeks: 52 } },
    { text: '15 an hour over 48 working weeks', input: { hourly: 15, hoursPerWeek: 37.5, weeksPerYear: 48 }, output: { annual: 27000, monthly: 2250, weekly: 562.5, daily: 112.5, hourly: 15, hours: 37.5, weeks: 48 } },
    { text: 'salary for 60 an hour at 20 hours a week', input: { hourly: 60, hoursPerWeek: 20 }, output: { annual: 62400, monthly: 5200, weekly: 1200, daily: 240, hourly: 60, hours: 20, weeks: 52 } },
    { text: 'what does 12.21 an hour come to a year', input: { hourly: 12.21, hoursPerWeek: 40 }, output: { annual: 25396.8, monthly: 2116.4, weekly: 488.4, daily: 97.68, hourly: 12.21, hours: 40, weeks: 52 } }
  ],
  errorCases: [
    { input: { hourly: 0 }, code: 'INVALID_INPUT' },
    { input: { hourly: 20, hoursPerWeek: 200 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    /* Gross, and only gross. Tax, national insurance, pension and everything
       else vary by country, band and year — §9's "rates always supplied, never
       assumed" applies, and there is no rate here to supply. */
    const weekly = input.hourly * input.hoursPerWeek;
    const annual = weekly * input.weeksPerYear;
    return ok({
      annual: round(annual, 2), monthly: round(annual / 12, 2),
      weekly: round(weekly, 2), daily: round(weekly / 5, 2),
      hourly: input.hourly, hours: input.hoursPerWeek, weeks: input.weeksPerYear
    }, computed());
  }
};
