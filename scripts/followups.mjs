#!/usr/bin/env node
/* followups.mjs — does a Reply carry the right figure, and only when it should?
 *
 * E2 lets a Reply to a worked-out answer hand that answer to the planner, which
 * may then write "$prev.s1.total" instead of a number. That is only worth
 * shipping if two things hold, and this measures both:
 *
 *   CARRIES   "split that 3 ways" after a £97.18 answer runs the right skill with
 *             97.18 in the right field, read from the earlier answer.
 *   CONTROLS  "split 60 between 3" after the same answer uses 60 — a message
 *             that states its own numbers never reaches into the earlier one.
 *
 * The bar the user set (2026-09-14): at least 90% of carries correct, and zero
 * "$prev" refs on the controls. The main holdout is a separate run
 * (bench:planner); without a Reply the prompt is unchanged, so it must not move.
 *
 * Each earlier answer is the skill's own first example, run as a hand-written
 * plan, so a miss here is always the follow-up and never the first question.
 *
 * Usage: node scripts/followups.mjs [--base http://127.0.0.1:8099] [--misses file]
 */

import entries from '../skills/index.js';
import { buildRegistry } from '../src/registry.js';
import { LexicalRouter } from '../src/router.js';
import { jsExtractor } from '../src/extractor.js';
import { llamaServer } from '../src/llm.js';
import { llmPlanner } from '../src/planner.js';
import { runTurn } from '../src/turn.js';
import { plannerOptions } from './prompt-variants.mjs';
import { writeFile } from 'node:fs/promises';
import './lib/apikey.mjs'; // the model servers' key → PIGEON_API_KEY

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

const registry = buildRegistry(entries);
const complete = llamaServer({ base: opt('--base', 'http://127.0.0.1:8099') });
if (!(await complete.health())) { console.error(`\n  No llama-server on ${complete.base}. Start one first (npm run models).\n`); process.exit(1); }
/* Built the way the app builds it (src/stack.js): runway 'auto'. The first run
   of this bench left that out and so measured a planner the window never uses. */
const planner = llmPlanner({ complete, registry, fewShot: true, runway: 'auto', ...plannerOptions(null) });
const extractor = jsExtractor(registry);
const ctx = { now: '2026-09-01T09:00:00Z', timezone: 'UTC', locale: 'en-GB', units: 'metric', webEnabled: false, confirmBeforeNetwork: true };

/* [earlier skill, follow-up, skill it should run, field that should carry, output field it carries from] */
const CARRIES = [
  ['percentOf', 'add 20% vat to that', 'applyTax', 'amount', 'result'],
  ['percentOf', 'split that 3 ways', 'splitEvenly', 'amount', 'result'],
  ['percentOf', 'round that to 1 decimal place', 'roundTo', 'value', 'result'],
  ['percentOf', 'take 10% off it', 'applyDiscount', 'price', 'result'],
  ['splitBill', 'take 10% off the total', 'applyDiscount', 'price', 'total'],
  ['splitBill', 'what is 20% of that total', 'percentOf', 'value', 'total'],
  ['splitBill', 'add 5% vat to the total', 'applyTax', 'amount', 'total'],
  ['convertLength', 'round that to 1 decimal place', 'roundTo', 'value', 'result'],
  ['convertLength', 'what is 10% of that', 'percentOf', 'value', 'result'],
  ['applyTax', 'split that between 4', 'splitEvenly', 'amount', 'gross'],
  ['applyTax', '25% off that', 'applyDiscount', 'price', 'gross'],
  ['applyTax', 'what is 15% of the gross', 'percentOf', 'value', 'gross'],
  ['compoundInterest', 'take 20% off that total', 'applyDiscount', 'price', 'total'],
  ['compoundInterest', 'split the total between 2', 'splitEvenly', 'amount', 'total'],
  ['compoundInterest', 'round that total to 0 decimal places', 'roundTo', 'value', 'total'],
  ['hourlyToSalary', 'what is 30% of that annual figure', 'percentOf', 'value', 'annual'],
  ['hourlyToSalary', 'split the annual salary over 12', 'splitEvenly', 'amount', 'annual'],
  ['hourlyToSalary', 'take 20% tax off the annual', 'applyDiscount', 'price', 'annual'],
  ['salaryToHourly', 'round that hourly rate to 1 decimal place', 'roundTo', 'value', 'hourly'],
  ['salaryToHourly', 'what is 10% of the hourly rate', 'percentOf', 'value', 'hourly'],
  ['amortizeLoan', 'split that monthly payment between 2 of us', 'splitEvenly', 'amount', 'monthlyPayment'],
  ['amortizeLoan', 'round the monthly payment to 0 decimal places', 'roundTo', 'value', 'monthlyPayment'],
  ['amortizeLoan', 'what is 10% of the total interest', 'percentOf', 'value', 'totalInterest'],
  ['applyDiscount', 'add 20% vat to that', 'applyTax', 'amount', 'result'],
  ['applyDiscount', 'split that 3 ways', 'splitEvenly', 'amount', 'result'],
  ['applyDiscount', 'what is 5% of it', 'percentOf', 'value', 'result'],
  ['convertTemperature', 'round that to 1 decimal place', 'roundTo', 'value', 'result'],
  ['unitPrice', 'what is 10% of that unit price', 'percentOf', 'value', 'unitPrice'],
  ['unitPrice', 'round the unit price to 1 decimal place', 'roundTo', 'value', 'unitPrice'],
  ['stackDiscounts', 'add 20% vat to that', 'applyTax', 'amount', 'finalPrice'],
  ['stackDiscounts', 'split the final price 4 ways', 'splitEvenly', 'amount', 'finalPrice'],
  ['markupMargin', 'add 20% vat to that price', 'applyTax', 'amount', 'price'],
  ['markupMargin', 'what is 15% off that price', 'applyDiscount', 'price', 'price'],
  ['fuelCostForTrip', 'split that between 3 people', 'splitEvenly', 'amount', 'cost'],
  ['fuelCostForTrip', 'add 10% to the cost', 'applyTax', 'amount', 'cost'],
  ['whatPercent', 'round that to 1 decimal place', 'roundTo', 'value', 'percent'],
  ['percentChange', 'round that to 0 decimal places', 'roundTo', 'value', 'percent'],
  ['simpleInterest', 'add 20% tax to the interest', 'applyTax', 'amount', 'interest'],
  ['simpleInterest', 'split the total between 4', 'splitEvenly', 'amount', 'total'],
  ['bmiCalculate', 'round that to 0 decimal places', 'roundTo', 'value', 'bmi'],
  ['evaluateExpression', 'what is 15% of that', 'percentOf', 'value', 'result'],
  ['evaluateExpression', 'split that 4 ways', 'splitEvenly', 'amount', 'result'],
  ['evaluateExpression', 'add 20% vat to it', 'applyTax', 'amount', 'result'],
  ['convertCurrencyFixed', 'split that between 4', 'splitEvenly', 'amount', 'result'],
  ['convertCurrencyFixed', 'take 10% off that', 'applyDiscount', 'price', 'result'],
  ['convertSpeed', 'round that to 1 decimal place', 'roundTo', 'value', 'result'],
  ['convertMass', 'round that to 2 decimal places', 'roundTo', 'value', 'result'],
  ['convertVolume', 'round that to 0 decimal places', 'roundTo', 'value', 'result'],
  ['ratioSolve', 'what is 20% of that', 'percentOf', 'value', 'answer'],
  ['savingsGoal', 'what is 10% of the final balance', 'percentOf', 'value', 'finalBalance'],
  ['splitEvenly', 'add 20% vat to the base share', 'applyTax', 'amount', 'base'],
  ['percentOf', 'what is that as a percentage of 120', 'whatPercent', 'part', 'result'],
  ['applyTax', 'round the gross to 0 decimal places', 'roundTo', 'value', 'gross'],
  ['convertLength', 'split that distance 4 ways', 'splitEvenly', 'amount', 'result'],
  ['compoundInterest', 'what is 25% of the interest', 'percentOf', 'value', 'interest'],
  ['hourlyToSalary', 'round the monthly figure to 0 decimal places', 'roundTo', 'value', 'monthly'],
  ['splitBill', 'round the tip to 0 decimal places', 'roundTo', 'value', 'tip'],
  ['applyDiscount', 'round the saving to 0 decimal places', 'roundTo', 'value', 'saving'],
  ['unitPrice', 'split the price 3 ways', 'splitEvenly', 'amount', 'price'],
  ['fuelCostForTrip', 'round the fuel used to 1 decimal place', 'roundTo', 'value', 'fuelUsed']
];

/* The same earlier answers, followed by messages that carry their own numbers. */
const CONTROLS = [
  ['percentOf', 'what is 15% of 80'], ['percentOf', 'add 20% vat to 45'], ['splitBill', 'split 60 between 3'],
  ['splitBill', 'take 25% off 120'], ['convertLength', 'how many km is 5 miles'], ['convertLength', 'round 3.14159 to 2 decimal places'],
  ['applyTax', 'what is 12 out of 48 as a percentage'], ['applyTax', 'split 200 4 ways'], ['compoundInterest', 'what does 500 grow to at 3% for 5 years'],
  ['compoundInterest', 'take 10% off 90'], ['hourlyToSalary', 'what is 30 an hour as a salary'], ['hourlyToSalary', 'what is 20% of 1500'],
  ['salaryToHourly', 'what is 52000 a year per hour'], ['salaryToHourly', 'add 5% vat to 300'], ['amortizeLoan', 'split 900 between 2'],
  ['amortizeLoan', 'round 1234.567 to 1 decimal place'], ['applyDiscount', 'add 20% vat to 75'], ['applyDiscount', 'what is 40% of 250'],
  ['convertTemperature', 'convert 30 celsius to fahrenheit'], ['convertTemperature', 'round 98.765 to 0 decimal places'],
  ['unitPrice', 'what is the price per kg of 2.5 kg for 7.50'], ['unitPrice', 'what is 10% of 64'], ['stackDiscounts', 'stack 10% and 5% off 200'],
  ['stackDiscounts', 'add 20% vat to 19.99'], ['markupMargin', 'sell at 40% markup on a cost of 30'], ['markupMargin', 'split 45 3 ways'],
  ['fuelCostForTrip', 'split 84 between 4 people'], ['fuelCostForTrip', 'what is 15% of 60'], ['whatPercent', '18 out of 24 as a percentage'],
  ['whatPercent', 'round 66.6667 to 1 decimal place'], ['percentChange', 'my rent went from 900 to 990, what percent increase is that'],
  ['percentChange', 'take 30% off 150'], ['simpleInterest', 'simple interest on 2000 at 4% for 2 years'], ['simpleInterest', 'split 500 5 ways'],
  ['bmiCalculate', 'bmi for 80kg and 180cm'], ['bmiCalculate', 'round 24.691 to 1 decimal place'], ['evaluateExpression', 'what is 15% of 360'],
  ['evaluateExpression', "what's (12 * 7) / 3"], ['convertCurrencyFixed', 'convert 50 GBP to EUR at 1.17'], ['convertCurrencyFixed', 'split 150 between 4'],
  ['convertSpeed', '60 mph in km/h'], ['convertSpeed', 'round 96.5606 to 1 decimal place'], ['convertMass', 'what is 90 kg in stone'],
  ['convertVolume', '3 cups in ml'], ['ratioSolve', 'what is 20% of 45'], ['savingsGoal', 'what is 10% of 8000'],
  ['splitEvenly', 'add 20% vat to 33.34'], ['percentOf', 'split 99 3 ways'], ['applyTax', 'round 300.456 to 0 decimal places'],
  ['convertLength', 'what is 10% of 42']
];

const earlierCache = new Map();
async function earlier (skillName) {
  if (earlierCache.has(skillName)) return earlierCache.get(skillName);
  const skill = registry.skill(skillName);
  const ex = skill && (skill.examples || [])[0];
  if (!ex) throw new Error(`${skillName} has no example to start from`);
  const turn = await runTurn(ex.text, { registry, router: new LexicalRouter(registry), ctx: { ...ctx }, extractor, plan: { steps: [{ id: 's1', skill: skillName, input: ex.input }] } });
  turn.message = ex.text;
  if (!turn.results.length || !turn.results[0].ok) throw new Error(`${skillName}'s example did not run: ${JSON.stringify(turn.results[0] && turn.results[0].error)}`);
  earlierCache.set(skillName, turn);
  return turn;
}

/* THE PRACTICE SET. Repairs (src/carry.js) are fitted here and only here: no
   phrasing is shared with CARRIES or CONTROLS above, which stay the graded set
   the bar is read from. */
const TUNE_CARRIES = [
  ['percentOf', 'now take 15% off that figure', 'applyDiscount', 'price', 'result'],
  ['percentOf', 'divide it between 5 people', 'splitEvenly', 'amount', 'result'],
  ['percentOf', 'round it to 2 decimal places', 'roundTo', 'value', 'result'],
  ['splitBill', 'what would 10% of the total be', 'percentOf', 'value', 'total'],
  ['splitBill', 'knock 5% off the total', 'applyDiscount', 'price', 'total'],
  ['splitBill', 'round the total to 1 decimal place', 'roundTo', 'value', 'total'],
  ['applyTax', 'what is 10% of that gross amount', 'percentOf', 'value', 'gross'],
  ['applyTax', 'share the gross between 3 of us', 'splitEvenly', 'amount', 'gross'],
  ['applyTax', 'round the tax to 0 decimal places', 'roundTo', 'value', 'tax'],
  ['applyDiscount', 'what is 12% of that price', 'percentOf', 'value', 'result'],
  ['applyDiscount', 'round the result to 1 decimal place', 'roundTo', 'value', 'result'],
  ['applyDiscount', 'add 15% tax on top of that', 'applyTax', 'amount', 'result'],
  ['compoundInterest', 'what is 5% of the interest', 'percentOf', 'value', 'interest'],
  ['compoundInterest', 'add 20% tax to the interest', 'applyTax', 'amount', 'interest'],
  ['hourlyToSalary', 'take 25% off the annual figure', 'applyDiscount', 'price', 'annual'],
  ['hourlyToSalary', 'round the weekly amount to 0 decimal places', 'roundTo', 'value', 'weekly'],
  ['evaluateExpression', 'take 30% off it', 'applyDiscount', 'price', 'result'],
  ['evaluateExpression', 'round it to 1 decimal place', 'roundTo', 'value', 'result'],
  ['unitPrice', 'add 20% vat to the unit price', 'applyTax', 'amount', 'unitPrice'],
  ['amortizeLoan', 'add 10% to the monthly payment', 'applyTax', 'amount', 'monthlyPayment'],
  ['amortizeLoan', 'split the total paid between 2', 'splitEvenly', 'amount', 'totalPaid'],
  ['stackDiscounts', 'what is 10% of the final price', 'percentOf', 'value', 'finalPrice'],
  ['markupMargin', 'split that price between 2', 'splitEvenly', 'amount', 'price'],
  ['fuelCostForTrip', 'round the cost to 0 decimal places', 'roundTo', 'value', 'cost'],
  ['simpleInterest', 'what is 50% of the interest', 'percentOf', 'value', 'interest'],
  ['salaryToHourly', 'add 10% to the hourly rate', 'applyTax', 'amount', 'hourly'],
  ['convertLength', 'divide that into 3 equal parts', 'splitEvenly', 'amount', 'result'],
  ['convertTemperature', 'what is 10% of that', 'percentOf', 'value', 'result'],
  ['whatPercent', 'round the percent to 0 decimal places', 'roundTo', 'value', 'percent'],
  ['savingsGoal', 'split the total deposited between 2', 'splitEvenly', 'amount', 'totalDeposited']
];
const TUNE_CONTROLS = [
  ['percentOf', 'what is 7% of 350'], ['percentOf', 'take 12% off 89.99'], ['splitBill', 'split 45.60 between 2'],
  ['splitBill', 'round 12.345 to 2 decimal places'], ['applyTax', 'add 17.5% vat to 120'], ['applyTax', 'what is 25% of 64'],
  ['applyDiscount', 'split 1000 5 ways'], ['applyDiscount', 'how many miles is 10 km'], ['compoundInterest', 'what is 8% of 2500'],
  ['hourlyToSalary', 'what is 18 an hour as a salary'], ['evaluateExpression', 'what is 3% of 900'], ['unitPrice', 'take 40% off 55'],
  ['amortizeLoan', 'round 987.654 to 2 decimal places'], ['stackDiscounts', 'add 5% vat to 60'], ['markupMargin', 'what is 45% of 300'],
  ['fuelCostForTrip', 'split 72 between 3'], ['simpleInterest', 'take 15% off 400'], ['salaryToHourly', 'what is 60000 a year per hour'],
  ['convertLength', 'convert 12 miles to km'], ['convertTemperature', 'convert 100 fahrenheit to celsius'], ['whatPercent', '30 out of 120 as a percentage'],
  ['savingsGoal', 'split 3000 between 4'], ['splitBill', 'what is 10% of 250'], ['applyTax', 'round 88.888 to 1 decimal place'],
  ['percentOf', 'add 20% vat to 99']
];

/* THE FRESH GRADED SET, written 2026-09-16 before any run of it. CARRIES and
   CONTROLS above were graded once after round 2 and their misses were read, so
   they can no longer decide anything. This set decides round 3. Its controls
   include the shape that leaked: a figure named AND given ("take 10% off the
   price of 250"). */
const FRESH_CARRIES = [
  ['percentOf', 'knock 20% off that', 'applyDiscount', 'price', 'result'],
  ['percentOf', 'what is 25% of it', 'percentOf', 'value', 'result'],
  ['percentOf', 'share that equally between 6', 'splitEvenly', 'amount', 'result'],
  ['percentOf', 'round that to 0 decimal places', 'roundTo', 'value', 'result'],
  ['splitBill', 'add 10% vat to that total', 'applyTax', 'amount', 'total'],
  ['splitBill', 'what is 15% of the total', 'percentOf', 'value', 'total'],
  ['splitBill', 'round the total to 0 decimal places', 'roundTo', 'value', 'total'],
  ['splitBill', 'divide the total between 5', 'splitEvenly', 'amount', 'total'],
  ['convertLength', 'what is 20% of that distance', 'percentOf', 'value', 'result'],
  ['convertLength', 'split it into 2 equal parts', 'splitEvenly', 'amount', 'result'],
  ['applyTax', 'what is 10% of that gross figure', 'percentOf', 'value', 'gross'],
  ['applyTax', 'split the gross 5 ways', 'splitEvenly', 'amount', 'gross'],
  ['applyTax', 'take 5% off that', 'applyDiscount', 'price', 'gross'],
  ['applyTax', 'round the tax to 1 decimal place', 'roundTo', 'value', 'tax'],
  ['compoundInterest', 'what is 10% of that total', 'percentOf', 'value', 'total'],
  ['compoundInterest', 'take 15% off the total', 'applyDiscount', 'price', 'total'],
  ['compoundInterest', 'round the interest to 0 decimal places', 'roundTo', 'value', 'interest'],
  ['hourlyToSalary', 'what is 20% of the annual', 'percentOf', 'value', 'annual'],
  ['hourlyToSalary', 'split the annual figure between 4', 'splitEvenly', 'amount', 'annual'],
  ['hourlyToSalary', 'round the weekly figure to 0 decimal places', 'roundTo', 'value', 'weekly'],
  ['salaryToHourly', 'what is 15% of that hourly rate', 'percentOf', 'value', 'hourly'],
  ['salaryToHourly', 'round the hourly rate to 0 decimal places', 'roundTo', 'value', 'hourly'],
  ['amortizeLoan', 'what is 5% of the monthly payment', 'percentOf', 'value', 'monthlyPayment'],
  ['amortizeLoan', 'round the total interest to 0 decimal places', 'roundTo', 'value', 'totalInterest'],
  ['amortizeLoan', 'split the monthly payment 3 ways', 'splitEvenly', 'amount', 'monthlyPayment'],
  ['applyDiscount', 'what is 30% of that', 'percentOf', 'value', 'result'],
  ['applyDiscount', 'add 10% tax to it', 'applyTax', 'amount', 'result'],
  ['applyDiscount', 'round that to 0 decimal places', 'roundTo', 'value', 'result'],
  ['applyDiscount', 'what is 50% of the saving', 'percentOf', 'value', 'saving'],
  ['convertTemperature', 'what is 10% of it', 'percentOf', 'value', 'result'],
  ['unitPrice', 'what is 50% of the unit price', 'percentOf', 'value', 'unitPrice'],
  ['unitPrice', 'take 10% off the unit price', 'applyDiscount', 'price', 'unitPrice'],
  ['stackDiscounts', 'round the final price to 0 decimal places', 'roundTo', 'value', 'finalPrice'],
  ['stackDiscounts', 'what is 10% of that', 'percentOf', 'value', 'finalPrice'],
  ['stackDiscounts', 'split the saved amount between 2', 'splitEvenly', 'amount', 'saved'],
  ['markupMargin', 'what is 20% of the profit', 'percentOf', 'value', 'profit'],
  ['markupMargin', 'round that price to 0 decimal places', 'roundTo', 'value', 'price'],
  ['fuelCostForTrip', 'what is 25% of that cost', 'percentOf', 'value', 'cost'],
  ['fuelCostForTrip', 'take 10% off the cost', 'applyDiscount', 'price', 'cost'],
  ['whatPercent', 'round the percent to 1 decimal place', 'roundTo', 'value', 'percent'],
  ['percentChange', 'round the difference to 0 decimal places', 'roundTo', 'value', 'difference'],
  ['percentChange', 'what is 50% of the difference', 'percentOf', 'value', 'difference'],
  ['simpleInterest', 'take 10% off the total', 'applyDiscount', 'price', 'total'],
  ['simpleInterest', 'round the interest to 1 decimal place', 'roundTo', 'value', 'interest'],
  ['bmiCalculate', 'round it to 1 decimal place', 'roundTo', 'value', 'bmi'],
  ['evaluateExpression', 'take 25% off that', 'applyDiscount', 'price', 'result'],
  ['evaluateExpression', 'round it to 0 decimal places', 'roundTo', 'value', 'result'],
  ['evaluateExpression', 'split it between 3', 'splitEvenly', 'amount', 'result'],
  ['convertCurrencyFixed', 'add 20% vat to that', 'applyTax', 'amount', 'result'],
  ['convertCurrencyFixed', 'round that to 0 decimal places', 'roundTo', 'value', 'result'],
  ['convertSpeed', 'what is 10% of that', 'percentOf', 'value', 'result'],
  ['convertMass', 'split that into 2 equal parts', 'splitEvenly', 'amount', 'result'],
  ['convertVolume', 'what is 20% of it', 'percentOf', 'value', 'result'],
  ['savingsGoal', 'round the final balance to 0 decimal places', 'roundTo', 'value', 'finalBalance'],
  ['savingsGoal', 'split the final balance between 2', 'splitEvenly', 'amount', 'finalBalance'],
  ['splitEvenly', 'what is 10% of the base', 'percentOf', 'value', 'base'],
  ['percentOf', 'add 5% vat to it', 'applyTax', 'amount', 'result'],
  ['applyTax', 'what is 20% of the net', 'percentOf', 'value', 'net'],
  ['compoundInterest', 'split the interest between 4', 'splitEvenly', 'amount', 'interest'],
  ['hourlyToSalary', 'take 20% off the monthly figure', 'applyDiscount', 'price', 'monthly']
];
const FRESH_CONTROL_TEXTS = [
  'what is 30% of 150', 'take 15% off 64', 'split 120 between 4', 'round 7.777 to 1 decimal place', 'add 20% vat to 35',
  'how many km is 8 miles', 'what is 24 out of 96 as a percentage', 'convert 25 celsius to fahrenheit',
  'what is the price per litre of 2 litres for 3.40', 'what does 1500 grow to at 3% for 4 years',
  'simple interest on 800 at 5% for 3 years', 'what is 15 an hour as a salary', 'what is 40000 a year per hour',
  'monthly payment on a 150000 mortgage at 4 percent over 25 years', 'stack 20% and 5% off 80',
  'sell at 30% markup on a cost of 50', 'fuel cost for a 300km trip at 6 litres per 100km and 1.70 a litre',
  'bmi for 65kg and 170cm', "what's (9 * 8) / 4", 'convert 200 EUR to USD at 1.09', '90 km/h in mph',
  'what is 60 kg in stone', '4 cups in ml', 'my salary went from 30000 to 33000, what percent increase is that',
  'round the total of 45.678 to 1 decimal place', 'take 10% off the price of 250', 'what is 20% of the interest of 400',
  'split the bill of 90 between 3', 'add 5% vat to the cost of 120', 'what is 12% of the salary of 42000',
  'round 2.71828 to 3 decimal places', 'what is 8% of 75', 'split 250 5 ways', 'add 15% vat to 400', 'take 35% off 200',
  '5 miles in metres', '50 out of 200 as a percentage', 'what is 1% of 999', 'split 17.50 between 2',
  'round 19.95 to 0 decimal places', 'what is 18% of 45', 'take 5% off 1000', 'add 12.5% to 80',
  'how many grams is 3 cups of flour', 'what is 60 fahrenheit in celsius', 'what does 5000 grow to at 2% for 3 years',
  'split 99.99 3 ways', 'what is 45% of 900', 'round 123.456 to 2 decimal places', 'what is the unit price of 6 eggs for 2.40'
];
/* Each control follows one of the earlier answers, in turn. */
const FRESH_FROM = ['percentOf', 'splitBill', 'applyTax', 'compoundInterest', 'applyDiscount', 'amortizeLoan', 'unitPrice', 'simpleInterest', 'hourlyToSalary', 'convertLength'];
const FRESH_CONTROLS = FRESH_CONTROL_TEXTS.map((text, i) => [FRESH_FROM[i % FRESH_FROM.length], text]);

/* ROUND 4'S GRADED SET, written 2026-09-16 before any run of it and before the
   operation repair (carry.js rule 0) was measured on anything. FRESH above was
   graded in round 3 and its misses were read, so it can no longer decide
   anything. About a quarter of these say their operation in words the repair
   does not read ("less 10%", "to the nearest whole number", "per head"), so the
   planner is still what is measured there. */
const FRESH2_CARRIES = [
  ['percentOf', 'take 30% off that', 'applyDiscount', 'price', 'result'],
  ['percentOf', 'what is 50% of that', 'percentOf', 'value', 'result'],
  ['percentOf', 'split it between 4 people', 'splitEvenly', 'amount', 'result'],
  ['percentOf', 'add 15% vat onto that', 'applyTax', 'amount', 'result'],
  ['percentOf', 'less 10%', 'applyDiscount', 'price', 'result'],
  ['splitBill', 'take 5% off the total', 'applyDiscount', 'price', 'total'],
  ['splitBill', 'what is 12% of the total', 'percentOf', 'value', 'total'],
  ['splitBill', 'share the total between 6 of us', 'splitEvenly', 'amount', 'total'],
  ['splitBill', 'round that total to the nearest whole number', 'roundTo', 'value', 'total'],
  ['splitBill', 'plus 20% vat on the total', 'applyTax', 'amount', 'total'],
  ['convertLength', 'round it to 0 decimal places', 'roundTo', 'value', 'result'],
  ['convertLength', 'what is 25% of that', 'percentOf', 'value', 'result'],
  ['convertLength', 'divide that between 3', 'splitEvenly', 'amount', 'result'],
  ['applyTax', 'split the gross between 2', 'splitEvenly', 'amount', 'gross'],
  ['applyTax', 'what is 40% of the gross', 'percentOf', 'value', 'gross'],
  ['applyTax', 'round the gross off to 1 dp', 'roundTo', 'value', 'gross'],
  ['applyTax', 'knock 15% off the gross', 'applyDiscount', 'price', 'gross'],
  ['compoundInterest', 'split the total 3 ways', 'splitEvenly', 'amount', 'total'],
  ['compoundInterest', 'what is 30% of the interest', 'percentOf', 'value', 'interest'],
  ['compoundInterest', 'round the total to 1 decimal place', 'roundTo', 'value', 'total'],
  ['compoundInterest', 'minus 25% from the total', 'applyDiscount', 'price', 'total'],
  ['applyDiscount', 'split that between 2', 'splitEvenly', 'amount', 'result'],
  ['applyDiscount', 'add 5% tax to that', 'applyTax', 'amount', 'result'],
  ['applyDiscount', 'what is 15% of the result', 'percentOf', 'value', 'result'],
  ['applyDiscount', 'round the saving off to the nearest whole number', 'roundTo', 'value', 'saving'],
  ['amortizeLoan', 'take 10% off the monthly payment', 'applyDiscount', 'price', 'monthlyPayment'],
  ['amortizeLoan', 'split the total interest between 2', 'splitEvenly', 'amount', 'totalInterest'],
  ['amortizeLoan', 'what is 20% of the total paid', 'percentOf', 'value', 'totalPaid'],
  ['amortizeLoan', 'round the monthly payment to the nearest whole number', 'roundTo', 'value', 'monthlyPayment'],
  ['unitPrice', 'add 20% vat to that unit price', 'applyTax', 'amount', 'unitPrice'],
  ['unitPrice', 'round the unit price to 2 decimal places', 'roundTo', 'value', 'unitPrice'],
  ['simpleInterest', 'how much is the total each if 4 of us share it', 'splitEvenly', 'amount', 'total'],
  ['simpleInterest', 'what is 10% of the interest', 'percentOf', 'value', 'interest'],
  ['simpleInterest', 'take 20% tax off the interest', 'applyDiscount', 'price', 'interest'],
  ['hourlyToSalary', 'split the monthly figure between 2', 'splitEvenly', 'amount', 'monthly'],
  ['hourlyToSalary', 'what is 40% of the annual salary', 'percentOf', 'value', 'annual'],
  ['hourlyToSalary', 'round that monthly amount to 2 dp', 'roundTo', 'value', 'monthly'],
  ['salaryToHourly', 'take 20% off the hourly rate', 'applyDiscount', 'price', 'hourly'],
  ['salaryToHourly', 'split the hourly rate between 2', 'splitEvenly', 'amount', 'hourly'],
  ['convertTemperature', 'round it to the nearest whole number', 'roundTo', 'value', 'result'],
  ['stackDiscounts', 'take another 5% off the final price', 'applyDiscount', 'price', 'finalPrice'],
  ['stackDiscounts', 'add 20% vat to the final price', 'applyTax', 'amount', 'finalPrice'],
  ['markupMargin', 'split the profit between 3', 'splitEvenly', 'amount', 'profit'],
  ['markupMargin', 'add 10% vat to that price', 'applyTax', 'amount', 'price'],
  ['fuelCostForTrip', 'what is that per head for 4 of us', 'splitEvenly', 'amount', 'cost'],
  ['fuelCostForTrip', 'round that cost to 0 decimal places', 'roundTo', 'value', 'cost'],
  ['whatPercent', 'what is 50% of that percentage', 'percentOf', 'value', 'percent'],
  ['percentChange', 'split the difference between 2', 'splitEvenly', 'amount', 'difference'],
  ['simpleInterest', 'round the total to 0 decimal places', 'roundTo', 'value', 'total'],
  ['bmiCalculate', 'round the bmi to a whole number', 'roundTo', 'value', 'bmi'],
  ['evaluateExpression', 'what is 10% of that', 'percentOf', 'value', 'result'],
  ['evaluateExpression', 'put 20% vat on that', 'applyTax', 'amount', 'result'],
  ['convertCurrencyFixed', 'split that between 3 people', 'splitEvenly', 'amount', 'result'],
  ['convertCurrencyFixed', 'take 5% off it', 'applyDiscount', 'price', 'result'],
  ['convertSpeed', 'round it to 1 decimal place', 'roundTo', 'value', 'result'],
  ['convertMass', 'what is 20% of that', 'percentOf', 'value', 'result'],
  ['convertVolume', 'split it into 4 equal parts', 'splitEvenly', 'amount', 'result'],
  ['savingsGoal', 'what is a tenth of the final balance', 'percentOf', 'value', 'finalBalance'],
  ['splitEvenly', 'add 20% vat to the base', 'applyTax', 'amount', 'base'],
  ['percentOf', 'with 20% vat on top of that', 'applyTax', 'amount', 'result']
];
const FRESH2_CONTROL_TEXTS = [
  'what is 35% of 220', 'take 20% off 49.99', 'split 84 between 6', 'round 4.5678 to 2 decimal places', 'add 20% vat to 150',
  'how many km is 13.1 miles', 'what is 15 out of 60 as a percentage', 'convert 18 celsius to fahrenheit', 'what is 5% of 12000',
  'what does 2000 grow to at 4% for 10 years', 'simple interest on 1200 at 3% for 4 years', 'what is 22 an hour as a salary',
  'what is 35000 a year per hour', 'monthly payment on a 200000 loan at 5 percent over 30 years', 'stack 15% and 10% off 120',
  'sell at 25% markup on a cost of 80', 'take 25% off the price of 60', 'split the cost of 75 between 5', 'what is 10% of the total of 330',
  'round the figure 12.3456 to 1 decimal place', 'add 10% tax to the amount of 90', 'split 1000 between 8 people', 'what is 2% of 5500',
  'take 50% off 38', 'round 0.12345 to 3 decimal places', 'add 5% to 260', 'how many pounds is 5 kg', 'what is 33% of 99',
  'split 64.40 4 ways', 'what is 7 out of 35 as a percentage', 'take 12.5% off 400', 'round 99.5 to 0 decimal places',
  'add 20% vat to the price of 24', 'what is 15% of the bill of 68', 'share 90 equally between 3', 'convert 10 km to miles',
  'what is 70 fahrenheit in celsius', 'divide 144 into 12 equal parts', 'what is 60% of 45', 'take 8% off 250',
  'my bill went from 50 to 65, what percent increase is that', 'bmi for 72kg and 175cm', "what's (15 * 4) / 6",
  'convert 100 GBP to USD at 1.27', 'what is 100 km/h in mph', 'split 33 between 3', 'add 17.5% vat to 40',
  'what is 0.5% of 20000', 'round 1.005 to 2 decimal places', 'take 30% off the total of 180'
];
const FRESH2_CONTROLS = FRESH2_CONTROL_TEXTS.map((text, i) => [FRESH_FROM[i % FRESH_FROM.length], text]);

/* ROUND 5'S GRADED SET, written 2026-09-16 before any run of it and after
   FRESH2's misses were read (so FRESH2 no longer decides anything). 13 of the
   60 say their operation in words rule 0 does not read ("discount by", "reduce
   by", "spread over", "mark down"), so the planner is measured too. */
const FRESH3_CARRIES = [
  ['percentOf', 'chop 15% off that', 'applyDiscount', 'price', 'result'],
  ['percentOf', 'what is 60% of that figure', 'percentOf', 'value', 'result'],
  ['percentOf', 'split that 2 ways', 'splitEvenly', 'amount', 'result'],
  ['percentOf', 'round it to 1 dp', 'roundTo', 'value', 'result'],
  ['percentOf', 'increase it by 5% for tax', 'applyTax', 'amount', 'result'],
  ['splitBill', 'discount the total by 20%', 'applyDiscount', 'price', 'total'],
  ['splitBill', 'what is 8% of the total', 'percentOf', 'value', 'total'],
  ['splitBill', 'how much is the total each for 3 of us', 'splitEvenly', 'amount', 'total'],
  ['splitBill', 'round the total up to a whole number', 'roundTo', 'value', 'total'],
  ['splitBill', 'put 10% vat onto the total', 'applyTax', 'amount', 'total'],
  ['convertLength', 'give me that to 1 decimal place', 'roundTo', 'value', 'result'],
  ['convertLength', 'what is 75% of that', 'percentOf', 'value', 'result'],
  ['convertLength', 'cut that distance into quarters', 'splitEvenly', 'amount', 'result'],
  ['applyTax', 'share the gross between 7', 'splitEvenly', 'amount', 'gross'],
  ['applyTax', 'what is 5% of that gross', 'percentOf', 'value', 'gross'],
  ['applyTax', 'round the net to 1 decimal place', 'roundTo', 'value', 'net'],
  ['applyTax', 'mark the gross down by 30%', 'applyDiscount', 'price', 'gross'],
  ['compoundInterest', 'what does the total come to per year over 5 years', 'splitEvenly', 'amount', 'total'],
  ['compoundInterest', 'what is a quarter of the interest', 'percentOf', 'value', 'interest'],
  ['compoundInterest', 'round the total to 2 dp', 'roundTo', 'value', 'total'],
  ['compoundInterest', 'take 40% tax off the interest', 'applyDiscount', 'price', 'interest'],
  ['applyDiscount', 'share that between 5 people', 'splitEvenly', 'amount', 'result'],
  ['applyDiscount', 'add 8% sales tax to that', 'applyTax', 'amount', 'result'],
  ['applyDiscount', 'what is 25% of the price after the discount', 'percentOf', 'value', 'result'],
  ['applyDiscount', 'round the result to the nearest whole number', 'roundTo', 'value', 'result'],
  ['amortizeLoan', 'knock 5% off the monthly payment', 'applyDiscount', 'price', 'monthlyPayment'],
  ['amortizeLoan', 'split the monthly payment 2 ways', 'splitEvenly', 'amount', 'monthlyPayment'],
  ['amortizeLoan', 'what is 15% of the total interest', 'percentOf', 'value', 'totalInterest'],
  ['amortizeLoan', 'round the total paid to 0 dp', 'roundTo', 'value', 'totalPaid'],
  ['unitPrice', 'what is 30% of that unit price', 'percentOf', 'value', 'unitPrice'],
  ['unitPrice', 'knock 25% off the unit price', 'applyDiscount', 'price', 'unitPrice'],
  ['simpleInterest', 'split the interest between 3', 'splitEvenly', 'amount', 'interest'],
  ['simpleInterest', 'what is 40% of the total', 'percentOf', 'value', 'total'],
  ['simpleInterest', 'add 20% vat to the interest', 'applyTax', 'amount', 'interest'],
  ['hourlyToSalary', 'spread the annual figure over 12 months', 'splitEvenly', 'amount', 'annual'],
  ['hourlyToSalary', 'what is 10% of the weekly figure', 'percentOf', 'value', 'weekly'],
  ['hourlyToSalary', 'round the annual figure to the nearest whole number', 'roundTo', 'value', 'annual'],
  ['salaryToHourly', 'what is 20% of the hourly rate', 'percentOf', 'value', 'hourly'],
  ['salaryToHourly', 'add 12% on top of the hourly rate', 'applyTax', 'amount', 'hourly'],
  ['convertTemperature', 'what is half of that', 'percentOf', 'value', 'result'],
  ['stackDiscounts', 'round the final price to 1 dp', 'roundTo', 'value', 'finalPrice'],
  ['stackDiscounts', 'three of us are paying the final price, how much each', 'splitEvenly', 'amount', 'finalPrice'],
  ['markupMargin', 'what is 10% of the profit', 'percentOf', 'value', 'profit'],
  ['markupMargin', 'take 15% off that price', 'applyDiscount', 'price', 'price'],
  ['fuelCostForTrip', 'add 10% to that cost for tolls', 'applyTax', 'amount', 'cost'],
  ['fuelCostForTrip', 'how much each if 2 of us go halves on that', 'splitEvenly', 'amount', 'cost'],
  ['whatPercent', 'tidy that percentage up to no decimals', 'roundTo', 'value', 'percent'],
  ['percentChange', 'what is 10% of the difference', 'percentOf', 'value', 'difference'],
  ['savingsGoal', 'take 20% tax off the final balance', 'applyDiscount', 'price', 'finalBalance'],
  ['bmiCalculate', 'round the bmi to 0 dp', 'roundTo', 'value', 'bmi'],
  ['evaluateExpression', 'split that into 5 equal parts', 'splitEvenly', 'amount', 'result'],
  ['evaluateExpression', 'give me one fifth of that', 'percentOf', 'value', 'result'],
  ['convertCurrencyFixed', 'work out 15 percent of it', 'percentOf', 'value', 'result'],
  ['convertCurrencyFixed', 'round it to a whole number', 'roundTo', 'value', 'result'],
  ['convertSpeed', 'what is 50% of it', 'percentOf', 'value', 'result'],
  ['convertMass', 'round that to 2 dp', 'roundTo', 'value', 'result'],
  ['convertVolume', 'reduce that by 10%', 'applyDiscount', 'price', 'result'],
  ['savingsGoal', 'split the final balance 4 ways', 'splitEvenly', 'amount', 'finalBalance'],
  ['splitEvenly', 'round the base to 1 dp', 'roundTo', 'value', 'base'],
  ['percentOf', 'deduct 10% from that', 'applyDiscount', 'price', 'result']
];
const FRESH3_CONTROL_TEXTS = [
  'what is 45% of 180', 'take 15% off 72', 'split 96 between 8', 'round 6.4321 to 1 dp', 'add 20% vat to 64',
  'how many km is 26.2 miles', 'what is 9 out of 45 as a percentage', 'convert 22 celsius to fahrenheit', 'what is 3% of 7000',
  'what does 3000 grow to at 5% for 6 years', 'simple interest on 1500 at 6% for 2 years', 'what is 17 an hour as a salary',
  'what is 48000 a year per hour', 'monthly payment on a 90000 loan at 3.5 percent over 15 years', 'stack 25% and 10% off 60',
  'sell at 50% markup on a cost of 12', 'take 20% off the price of 45', 'split the bill of 150 between 6', 'what is a quarter of 360',
  'round the figure 3.3333 to a whole number', 'put 20% vat on 55', 'share 70 between 7 of us', 'less 10% of 480',
  'round 2.499 to the nearest whole number', 'what is half of 97', 'with 5% tax on 210', 'how many ounces is 2 kg',
  'what is a tenth of 5600', 'split 120.60 3 ways', 'what is 30 out of 40 as a percentage', 'minus 15% from 340',
  'round 7.5 to 0 dp', 'add 20% vat to the price of 18', 'what is 20% of the bill of 85', 'divide 81 by 9',
  'convert 5 km to miles', 'what is 90 fahrenheit in celsius', 'split 500 into 4 equal parts', 'what is 80% of 35',
  'take 3% off 1200', 'my rent went from 700 to 770, what percent increase is that', 'bmi for 90kg and 185cm',
  "what's (7 * 6) + 8", 'convert 60 EUR to GBP at 0.86', 'what is 50 mph in km/h', 'split 21 between 7',
  'add 12% to 300', 'what is 0.25% of 80000', 'round 5.555 to 2 dp', 'take 60% off the total of 40'
];
const FRESH3_CONTROLS = FRESH3_CONTROL_TEXTS.map((text, i) => [FRESH_FROM[i % FRESH_FROM.length], text]);

const SET = opt('--set', 'fresh3');
const SETS = { tune: [TUNE_CARRIES, TUNE_CONTROLS], grade: [CARRIES, CONTROLS], fresh: [FRESH_CARRIES, FRESH_CONTROLS], fresh2: [FRESH2_CARRIES, FRESH2_CONTROLS], fresh3: [FRESH3_CARRIES, FRESH3_CONTROLS] };
if (!SETS[SET]) { console.error(`\n  --set is ${Object.keys(SETS).join(', ')}, not ${SET}\n`); process.exit(1); }
const [RUN_CARRIES, RUN_CONTROLS] = SETS[SET];

const follow = async (first, text) => runTurn(text, {
  registry, router: new LexicalRouter(registry), ctx: { ...ctx }, planner, extractor, prev: first, carry: first
});
const close = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9;

/* Answers that are the same answer. splitBill with no tip divides its bill
   between its people exactly as splitEvenly divides its amount into parts, so
   "split the total between 2" is right either way. Added 2026-09-16 after the
   practice set showed it, before the graded set was run again, and applied to
   both sets alike. */
const SAME_ANSWER = { splitEvenly: [{ skill: 'splitBill', field: 'bill' }] };
const answered = (results, want, field, expect) => {
  const ways = [{ skill: want, field }, ...(SAME_ANSWER[want] || [])];
  return ways.some(w => (results || []).some(x => x.skill === w.skill && x.ok && close(x.input[w.field], expect)));
};

const misses = [];
let carried = 0;
for (const [from, text, want, field, outField] of RUN_CARRIES) {
  const first = await earlier(from);
  const expect = first.results[0].value[outField];
  const t = await follow(first, text);
  const ok = answered(t.results, want, field, expect) && (t.resolvedPrev || []).length > 0;
  if (ok) carried++;
  else misses.push({ kind: 'carry', from, text, want, field, expect, got: (t.results || []).map(x => ({ skill: x.skill, ok: x.ok, input: x.input, error: x.error && x.error.code })), plan: t.plan, mode: t.mode, ask: t.ask && t.ask.field, resolvedPrev: t.resolvedPrev || [] });
  process.stdout.write(ok ? '.' : 'x');
}
process.stdout.write('\n');

let leaked = 0;
for (const [from, text] of RUN_CONTROLS) {
  const first = await earlier(from);
  const t = await follow(first, text);
  const reached = JSON.stringify(t.plan || {}).includes('$prev');
  if (reached) { leaked++; misses.push({ kind: 'control', from, text, plan: t.plan }); }
  process.stdout.write(reached ? 'x' : '.');
}
process.stdout.write('\n');

const rate = carried / RUN_CARRIES.length;
console.log(`\n  model: ${await complete.model()}`);
console.log(`  set: ${SET}`);
console.log(`  carries   ${carried} / ${RUN_CARRIES.length}  (${(rate * 100).toFixed(1)}%)   bar ≥ 90%   ${rate >= 0.9 ? 'PASS' : 'FAIL'}`);
console.log(`  controls  ${leaked} / ${RUN_CONTROLS.length} reached into the earlier answer   bar = 0   ${leaked === 0 ? 'PASS' : 'FAIL'}`);
const missesPath = opt('--misses', null);
if (missesPath) { await writeFile(missesPath, JSON.stringify(misses, null, 2)); console.log(`  misses written to ${missesPath}`); }
process.exit(rate >= 0.9 && leaked === 0 ? 0 : 1);
