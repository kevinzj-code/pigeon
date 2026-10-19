import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

export default {
  name: 'gradeNeeded',
  description: 'Work out what score the remaining work needs to reach a target grade.',
  category: 'learning', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{summary|prose}}',
  inputSchema: {
    type: 'object', required: ['current', 'completed', 'target'],
    properties: {
      current: { type: 'number', label: 'score so far %', minimum: 0, maximum: 100, prompt: 'What is the score so far, as a percentage?' },
      completed: { type: 'number', label: 'course done %', minimum: 0.01, maximum: 99.99, prompt: 'What percentage of the course does that cover?' },
      target: { type: 'number', label: 'target grade %', minimum: 0, maximum: 100, prompt: 'What overall percentage are you aiming for?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      needed: { type: 'number' }, remainingWeight: { type: 'number' }, achievable: { type: 'boolean' },
      alreadyAchieved: { type: 'boolean' }, summary: { type: 'string' }
    }
  },
  examples: [
    { text: 'what do I need on the final to get 80 percent', input: { current: 78, completed: 70, target: 80 }, output: { needed: 84.67, remainingWeight: 30, achievable: true, alreadyAchieved: false, summary: 'You need 84.67% on the remaining 30% of the course to finish on 80%.' } },
    { text: 'what score do I need for a 90 average', input: { current: 85, completed: 50, target: 90 }, output: { needed: 95, remainingWeight: 50, achievable: true, alreadyAchieved: false, summary: 'You need 95% on the remaining 50% of the course to finish on 90%.' } },
    { text: 'can I still pass with 70 percent', input: { current: 60, completed: 80, target: 70 }, output: { needed: 110, remainingWeight: 20, achievable: false, alreadyAchieved: false, summary: 'Reaching 70% would need 110% on the remaining 20% of the course, so it is out of reach — full marks from here gives 68%.' } },
    { text: 'do I still need to revise for the last test', input: { current: 92, completed: 90, target: 90 }, output: { needed: 72, remainingWeight: 10, achievable: true, alreadyAchieved: false, summary: 'You need 72% on the remaining 10% of the course to finish on 90%.' } },
    { text: 'what do I need to score to keep a 60 average', input: { current: 100, completed: 60, target: 60 }, output: { needed: 0, remainingWeight: 40, achievable: true, alreadyAchieved: true, summary: 'You have already passed 60% — even a zero on the remaining 40% leaves you on 60%.' } },
    { text: 'sitting at 72 with 30% of the marks still to come, what gets me to 75', input: { current: 72, completed: 70, target: 75 },
      output: { needed: 82, remainingWeight: 30, achievable: true, alreadyAchieved: false, summary: 'You need 82% on the remaining 30% of the course to finish on 75%.' } },
    { text: 'I\'m on 78 so far; what mark do I need on the remaining 25% to end on 80', input: { current: 78, completed: 75, target: 80 },
      output: { needed: 86, remainingWeight: 25, achievable: true, alreadyAchieved: false, summary: 'You need 86% on the remaining 25% of the course to finish on 80%.' } }
  ],
  errorCases: [
    { input: { current: 78, completed: 100, target: 80 }, code: 'INVALID_INPUT' },
    { input: { current: 78, completed: 70 }, code: 'MISSING_FIELD' },
    { input: { current: 78, completed: 0, target: 80 }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const done = input.completed / 100;
    const remainingWeight = round(100 - input.completed, 4);
    const needed = round((input.target - done * input.current) / (1 - done), 2);

    /* Both ends are worth stating plainly. Above 100 the target cannot be
       reached at all, and saying what full marks WOULD give is more use than
       "you need 110%". At or below zero it is already secured. */
    const best = round(done * input.current + (1 - done) * 100, 2);
    const alreadyAchieved = needed <= 0;
    const achievable = needed <= 100;

    const summary = !achievable
      ? `Reaching ${input.target}% would need ${needed}% on the remaining ${remainingWeight}% of the course, so it is out of reach — full marks from here gives ${best}%.`
      : alreadyAchieved
        ? `You have already passed ${input.target}% — even a zero on the remaining ${remainingWeight}% leaves you on ${round(done * input.current, 2)}%.`
        : `You need ${needed}% on the remaining ${remainingWeight}% of the course to finish on ${input.target}%.`;

    return ok({ needed: alreadyAchieved ? 0 : needed, remainingWeight, achievable, alreadyAchieved, summary }, computed());
  }
};
