import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'prioritizeTasks',
  description: 'Rank tasks by importance, urgency and how much effort they take.',
  category: 'organising', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} tasks ranked by (importance + urgency) divided by effort — your numbers, my arithmetic:\n{{lines|lines}}',
  inputSchema: {
    type: 'object', required: ['tasks'],
    properties: { tasks: { type: 'array', label: 'tasks', minItems: 1, maxItems: 200, prompt: 'What are the tasks, with their importance, urgency and effort?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      ranked: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, formula: { type: 'string' }
    }
  },
  examples: [
    { text: 'prioritise these tasks', input: { tasks: [{ task: 'file taxes', importance: 5, urgency: 5, effort: 3 }, { task: 'tidy desk', importance: 1, urgency: 2, effort: 1 }, { task: 'write report', importance: 4, urgency: 3, effort: 2 }, { task: 'reply to email', importance: 2, urgency: 5, effort: 1 }] }, output: { ranked: [{ rank: 1, task: 'reply to email', score: 7, importance: 2, urgency: 5, effort: 1 }, { rank: 2, task: 'write report', score: 3.5, importance: 4, urgency: 3, effort: 2 }, { rank: 3, task: 'file taxes', score: 3.33, importance: 5, urgency: 5, effort: 3 }, { rank: 4, task: 'tidy desk', score: 3, importance: 1, urgency: 2, effort: 1 }], lines: ['1. reply to email (7)', '2. write report (3.5)', '3. file taxes (3.33)', '4. tidy desk (3)'], count: 4, formula: '(importance + urgency) / effort' } },
    { text: 'what should I do first', input: { tasks: [{ task: 'call bank', importance: 4, urgency: 4, effort: 1 }, { task: 'plan holiday', importance: 3, urgency: 1, effort: 4 }] }, output: { ranked: [{ rank: 1, task: 'call bank', score: 8, importance: 4, urgency: 4, effort: 1 }, { rank: 2, task: 'plan holiday', score: 1, importance: 3, urgency: 1, effort: 4 }], lines: ['1. call bank (8)', '2. plan holiday (1)'], count: 2, formula: '(importance + urgency) / effort' } },
    { text: 'rank my to do list', input: { tasks: [{ task: 'water plants', importance: 2, urgency: 3, effort: 1 }] }, output: { ranked: [{ rank: 1, task: 'water plants', score: 5, importance: 2, urgency: 3, effort: 1 }], lines: ['1. water plants (5)'], count: 1, formula: '(importance + urgency) / effort' } },
    { text: 'order these jobs by priority', input: { tasks: [{ task: 'fix leak', importance: 5, urgency: 5, effort: 2 }, { task: 'sort photos', importance: 1, urgency: 1, effort: 5 }] }, output: { ranked: [{ rank: 1, task: 'fix leak', score: 5, importance: 5, urgency: 5, effort: 2 }, { rank: 2, task: 'sort photos', score: 0.4, importance: 1, urgency: 1, effort: 5 }], lines: ['1. fix leak (5)', '2. sort photos (0.4)'], count: 2, formula: '(importance + urgency) / effort' } },
    { text: 'prioritise two equally scored tasks', input: { tasks: [{ task: 'alpha', importance: 3, urgency: 3, effort: 2 }, { task: 'beta', importance: 3, urgency: 3, effort: 2 }] }, output: { ranked: [{ rank: 1, task: 'alpha', score: 3, importance: 3, urgency: 3, effort: 2 }, { rank: 2, task: 'beta', score: 3, importance: 3, urgency: 3, effort: 2 }], lines: ['1. alpha (3)', '2. beta (3)'], count: 2, formula: '(importance + urgency) / effort' } }
  ],
  errorCases: [
    { input: { tasks: [{ task: 'x', importance: 5, urgency: 5, effort: 0 }] }, code: 'INVALID_INPUT' },
    { input: { tasks: [{ importance: 5, urgency: 5, effort: 1 }] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const rows = [];
    for (const [i, t] of input.tasks.entries()) {
      const task = String(t?.task ?? '').trim();
      const importance = Number(t?.importance ?? 3);
      const urgency = Number(t?.urgency ?? 3);
      const effort = Number(t?.effort ?? 1);
      if (!task) return fail('INVALID_INPUT', `Task ${i + 1} has no name.`, 'tasks');
      for (const [label, v] of [['importance', importance], ['urgency', urgency], ['effort', effort]]) {
        if (!Number.isFinite(v) || v <= 0) return fail('INVALID_INPUT', `Task ${i + 1} has ${label} of ${t?.[label]}, which has to be a number above zero.`, 'tasks');
      }
      rows.push({ task, score: round((importance + urgency) / effort, 2), importance, urgency, effort });
    }

    /* Ties keep the order they were given in. The ranking is arithmetic on the
       user's own numbers, and inventing a tiebreak would be the skill quietly
       having an opinion about which task matters more. */
    const ranked = rows
      .map((r, i) => ({ ...r, at: i }))
      .sort((a, b) => b.score - a.score || a.at - b.at)
      .map(({ at, ...r }, i) => ({ rank: i + 1, ...r }));

    return ok({
      ranked, lines: ranked.map((r) => `${r.rank}. ${r.task} (${r.score})`),
      count: ranked.length, formula: '(importance + urgency) / effort'
    }, computed());
  }
};
