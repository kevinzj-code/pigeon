import { ok, computed } from '../src/contracts.js';

/* The twenty answers printed on the real toy: ten affirmative, five
   non-committal, five negative. Kept complete and in that order so the odds
   match the object it is imitating. */
const ANSWERS = [
  'It is certain', 'It is decidedly so', 'Without a doubt', 'Yes definitely',
  'You may rely on it', 'As I see it, yes', 'Most likely', 'Outlook good',
  'Yes', 'Signs point to yes',
  'Reply hazy, try again', 'Ask again later', 'Better not tell you now',
  'Cannot predict now', 'Concentrate and ask again',
  "Don't count on it", 'My reply is no', 'My sources say no',
  'Outlook not so good', 'Very doubtful'
];

export default {
  name: 'magicEightBall',
  description: 'Give a magic eight ball answer to a yes or no question.',
  category: 'games', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null,
  /* The one label that exists for exactly this: the answer is a random draw
     from twenty printed phrases and knows nothing about the question. */
  labels: ['toy'],
  nondeterministic: true,
  replyTemplate: '{{answer|prose}} — a random draw from the {{optionCount}} answers printed on the toy, which knows nothing about your question.',
  inputSchema: {
    type: 'object',
    properties: { question: { type: 'string', label: 'question', maxLength: 500, description: 'the question you are asking' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      answer: { type: 'string' }, tone: { type: 'string' }, optionCount: { type: 'integer' }
    }
  },
  examples: [
    { text: 'magic eight ball, will it rain tomorrow', input: { question: 'will it rain tomorrow' }, output: { answer: '(random)', tone: '(random)', optionCount: 20 } },
    { text: 'ask the magic 8 ball', input: {}, output: { answer: '(random)', tone: '(random)', optionCount: 20 } },
    { text: 'should I take the job', input: { question: 'should I take the job' }, output: { answer: '(random)', tone: '(random)', optionCount: 20 } },
    { text: 'eight ball says', input: { question: 'is this a good idea' }, output: { answer: '(random)', tone: '(random)', optionCount: 20 } },
    { text: 'shake the magic eight ball for me', input: {}, output: { answer: '(random)', tone: '(random)', optionCount: 20 } }
  ],
  errorCases: [
    { input: { question: 'x'.repeat(600) }, code: 'INVALID_INPUT' },
    { input: { question: { a: 1 } }, code: 'INVALID_INPUT' },
    { input: { question: ['a', 'b'] }, code: 'INVALID_INPUT' }
  ],
  verify (value) {
    const at = ANSWERS.indexOf(value.answer);
    if (at === -1) return `"${value.answer}" is not one of the twenty printed answers`;
    const expected = at < 10 ? 'affirmative' : at < 15 ? 'non-committal' : 'negative';
    if (value.tone !== expected) return `"${value.answer}" is ${expected}, not ${value.tone}`;
    if (value.optionCount !== ANSWERS.length) return 'reported option count does not match the list';
    return true;
  },
  run () {
    /* Not seeded. A magic eight ball that gives the same answer every time is
       not a magic eight ball, and nothing downstream needs to replay it. */
    const at = Math.floor(Math.random() * ANSWERS.length);
    return ok({
      answer: ANSWERS[at],
      tone: at < 10 ? 'affirmative' : at < 15 ? 'non-committal' : 'negative',
      optionCount: ANSWERS.length
    }, computed());
  }
};
