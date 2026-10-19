import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'markupMargin',
  description: 'Convert between markup and margin, and work out a selling price from a cost.',
  category: 'finance', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Markup and margin',
  replyTemplate: 'Cost {{cost|comma}}, sell at {{price|comma}} — {{markup}}% markup is a {{margin}}% margin, {{profit|comma}} profit.',
  inputSchema: {
    type: 'object', required: ['cost'],
    properties: {
      cost: { type: 'number', label: 'cost', carry: true, exclusiveMinimum: 0, prompt: 'What does it cost you?' },
      markup: { type: 'number', label: 'markup %', minimum: 0, description: 'percentage added to the cost' },
      margin: { type: 'number', label: 'margin %', minimum: 0, maximum: 99.99, description: 'percentage of the selling price that is profit' },
      price: { type: 'number', label: 'selling price', exclusiveMinimum: 0, description: 'the selling price, if you already know it' }
    }
  },
  outputSchema: { type: 'object', properties: { price: { type: 'number' }, cost: { type: 'number' }, profit: { type: 'number' }, markup: { type: 'number' }, margin: { type: 'number' } } },
  examples: [
    { text: 'sell at 50% markup on a cost of 20', input: { cost: 20, markup: 50 }, output: { price: 30, cost: 20, profit: 10, markup: 50, margin: 33.33 } },
    { text: 'what price gives a 40% margin on cost 60', input: { cost: 60, margin: 40 }, output: { price: 100, cost: 60, profit: 40, markup: 66.67, margin: 40 } },
    { text: 'my cost is 12 and I sell at 20 — what is the margin', input: { cost: 12, price: 20 }, output: { price: 20, cost: 12, profit: 8, markup: 66.67, margin: 40 } },
    { text: 'double the cost of 15', input: { cost: 15, markup: 100 }, output: { price: 30, cost: 15, profit: 15, markup: 100, margin: 50 } },
    { text: 'price for a 25% margin on 75 cost', input: { cost: 75, margin: 25 }, output: { price: 100, cost: 75, profit: 25, markup: 33.33, margin: 25 } }
  ],
  errorCases: [
    { input: { cost: 20 }, code: 'INVALID_INPUT' },
    { input: { cost: 20, margin: 100 }, code: 'INVALID_INPUT' },
    { input: { markup: 50 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const given = ['markup', 'margin', 'price'].filter(k => input[k] !== undefined);
    if (given.length === 0) {
      return fail('INVALID_INPUT', 'Give me one of: a markup percentage, a margin percentage, or a selling price.', 'markup');
    }
    let price;
    if (input.price !== undefined) price = input.price;
    else if (input.markup !== undefined) price = input.cost * (1 + input.markup / 100);
    else {
      /* Margin is a share of the PRICE, markup a share of the COST — the
         confusion this skill exists to settle. A 50% margin is a 100% markup,
         and a "100% margin" is impossible, which is why margin is capped
         below 100 rather than merely validated as a percentage. */
      if (input.margin >= 100) return fail('INVALID_INPUT', 'A margin of 100% or more would mean the item costs nothing.', 'margin');
      price = input.cost / (1 - input.margin / 100);
    }
    if (price <= 0) return fail('INVALID_INPUT', 'That works out to a price of zero or less.', 'price');
    const profit = price - input.cost;
    return ok({
      price: round(price, 2), cost: input.cost, profit: round(profit, 2),
      markup: round(profit / input.cost * 100, 2),
      margin: round(profit / price * 100, 2)
    }, computed());
  }
};
