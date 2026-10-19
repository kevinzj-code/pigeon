import { ok, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'salaryToHourly',
  description: "Divide an annual salary down to what a single hour is worth.",
  category: 'finance', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{annual|comma}} a year is {{hourly}} an hour — {{monthly|comma}} a month across {{hours}} hours a week.',
  inputSchema: {
    type: 'object', required: ['annual'],
    properties: {
      annual: { type: 'number', label: 'annual salary', carry: true, exclusiveMinimum: 0, prompt: 'What is the annual salary?' },
      hoursPerWeek: { type: 'number', label: 'hours per week', exclusiveMinimum: 0, maximum: 168, default: 37.5 },
      weeksPerYear: { type: 'number', label: 'weeks per year', exclusiveMinimum: 0, maximum: 53, default: 52 }
    }
  },
  outputSchema: { type: 'object', properties: { hourly: { type: 'number' }, daily: { type: 'number' }, weekly: { type: 'number' }, monthly: { type: 'number' }, annual: { type: 'number' }, hours: { type: 'number' }, totalHours: { type: 'number' } } },
  examples: [
    { text: 'what is 48750 a year per hour', input: { annual: 48750 }, output: { hourly: 25, daily: 187.5, weekly: 937.5, monthly: 4062.5, annual: 48750, hours: 37.5, totalHours: 1950 } },
    { text: 'hourly rate for a 60000 salary at 40 hours', input: { annual: 60000, hoursPerWeek: 40 }, output: { hourly: 28.85, daily: 230.77, weekly: 1153.85, monthly: 5000, annual: 60000, hours: 40, totalHours: 2080 } },
    { text: '35000 a year as an hourly rate', input: { annual: 35000 }, output: { hourly: 17.95, daily: 134.62, weekly: 673.08, monthly: 2916.67, annual: 35000, hours: 37.5, totalHours: 1950 } },
    { text: 'hourly for 100000 over 48 weeks', input: { annual: 100000, hoursPerWeek: 37.5, weeksPerYear: 48 }, output: { hourly: 55.56, daily: 416.67, weekly: 2083.33, monthly: 8333.33, annual: 100000, hours: 37.5, totalHours: 1800 } },
    { text: 'what does 26000 work out to hourly at 30 hours', input: { annual: 26000, hoursPerWeek: 30 }, output: { hourly: 16.67, daily: 100, weekly: 500, monthly: 2166.67, annual: 26000, hours: 30, totalHours: 1560 } }
  ],
  errorCases: [
    { input: { annual: 0 }, code: 'INVALID_INPUT' },
    { input: { annual: 30000, weeksPerYear: 60 }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const totalHours = input.hoursPerWeek * input.weeksPerYear;
    const hourly = input.annual / totalHours;
    /* Gross, like its inverse. Nothing here knows about tax. */
    return ok({
      hourly: round(hourly, 2), daily: round(hourly * input.hoursPerWeek / 5, 2),
      weekly: round(input.annual / input.weeksPerYear, 2),
      monthly: round(input.annual / 12, 2),
      annual: input.annual, hours: input.hoursPerWeek, totalHours: round(totalHours, 2)
    }, computed());
  }
};
