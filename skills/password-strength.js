import { ok, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

/* A short list of the passwords that turn up at the top of every breach corpus.
   Not a dictionary — the point is to catch the handful that are guessed first,
   not to pretend this is a real cracking simulation. */
const COMMON = new Set(`password passw0rd password1 123456 12345678 123456789 qwerty qwerty123
abc123 letmein monkey dragon 111111 iloveyou admin welcome login master sunshine
princess football baseball shadow superman trustno1 000000 654321 batman`.trim().split(/\s+/));

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

export default {
  name: 'passwordStrength',
  description: 'Estimate how much entropy a password has and flag predictable patterns.',
  category: 'validation', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null,
  /* §27's rule, applied here: the number is a model of guessing effort, not a
     measurement of it, so it carries the estimate badge AND says so in words. */
  labels: ['estimate'],
  replyTemplate: 'About {{entropyBits}} bits from {{length}} characters over an alphabet of {{alphabetSize}}. {{caveat|prose}}',
  inputSchema: {
    type: 'object', required: ['password'],
    properties: { password: { type: 'string', label: 'password', minLength: 1, maxLength: 256, prompt: 'Which password should I measure?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      entropyBits: { type: 'number' }, length: { type: 'integer' }, alphabetSize: { type: 'integer' },
      classes: { type: 'array', items: { type: 'string' } }, flags: { type: 'array', items: { type: 'string' } },
      caveat: { type: 'string' }
    }
  },
  examples: [
    { text: 'how strong is the password password', input: { password: 'password' }, output: { entropyBits: 37.6, length: 8, alphabetSize: 26, classes: ['lowercase'], flags: ['common'], caveat: 'That figure assumes the characters were picked at random. This one shows a predictable pattern — it is one of the most common passwords there is — so a real guess would land far sooner.' } },
    { text: 'check this password strength', input: { password: 'Tr0ub4dor&3' }, output: { entropyBits: 72.3, length: 11, alphabetSize: 95, classes: ['lowercase', 'uppercase', 'digits', 'symbols'], flags: [], caveat: 'That figure assumes the characters were picked at random — if any of it came from a word or a date, the real number is lower.' } },
    { text: 'is 123456 a strong password', input: { password: '123456' }, output: { entropyBits: 19.9, length: 6, alphabetSize: 10, classes: ['digits'], flags: ['common', 'sequential', 'digits-only'], caveat: 'That figure assumes the characters were picked at random. This one shows predictable patterns — it is one of the most common passwords there is, it contains a run of sequential characters, and it is digits only — so a real guess would land far sooner.' } },
    { text: 'rate my passphrase', input: { password: 'correct-horse-battery-staple' }, output: { entropyBits: 164.7, length: 28, alphabetSize: 59, classes: ['lowercase', 'symbols'], flags: [], caveat: 'That figure assumes the characters were picked at random — if any of it came from a word or a date, the real number is lower.' } },
    { text: 'how good is aaaaaaaa', input: { password: 'aaaaaaaa' }, output: { entropyBits: 37.6, length: 8, alphabetSize: 26, classes: ['lowercase'], flags: ['repeated'], caveat: 'That figure assumes the characters were picked at random. This one shows a predictable pattern — it is the same character repeated — so a real guess would land far sooner.' } }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { password: '' }, code: 'MISSING_FIELD' },
    { input: { password: 'x'.repeat(300) }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const p = String(input.password);
    const classes = [];
    let alphabetSize = 0;
    if (/[a-z]/.test(p)) { classes.push('lowercase'); alphabetSize += 26; }
    if (/[A-Z]/.test(p)) { classes.push('uppercase'); alphabetSize += 26; }
    if (/\d/.test(p)) { classes.push('digits'); alphabetSize += 10; }
    if (/[^a-zA-Z0-9]/.test(p)) { classes.push('symbols'); alphabetSize += 33; }

    const lower = p.toLowerCase();
    /* Each flag carries its own finished clause. An earlier version built the
       clauses by guessing which labels needed "is" in front of them and
       produced "it digits only" — grammar is not something to infer from a
       prefix when the writer can simply state it. */
    const flags = [];
    const clauses = [];
    const flag = (label, clause) => { flags.push(label); clauses.push(clause); };

    if (COMMON.has(lower)) flag('common', 'it is one of the most common passwords there is');
    if (/(.)\1{2,}/.test(p)) {
      if (/^(.)\1*$/.test(p)) flag('repeated', 'it is the same character repeated');
      else flag('repeated', 'it repeats a character three or more times');
    }
    const runs = SEQUENCES.some((s) => {
      for (let i = 0; i + 3 <= lower.length; i++) {
        const chunk = lower.slice(i, i + 3);
        if (s.includes(chunk) || [...s].reverse().join('').includes(chunk)) return true;
      }
      return false;
    });
    if (runs) flag('sequential', 'it contains a run of sequential characters');
    if (/^\d+$/.test(p)) flag('digits-only', 'it is digits only');
    if (/(19|20)\d{2}/.test(p)) flag('year', 'it contains something shaped like a year');

    /* The naive figure is reported as-is and then qualified, rather than being
       quietly discounted. A number adjusted by an unexplained fudge factor is
       harder to reason about than a stated assumption. */
    const list = clauses.length > 1
      ? `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`
      : clauses[0] ?? '';
    const caveat = clauses.length
      ? `That figure assumes the characters were picked at random. This one shows ${clauses.length > 1 ? 'predictable patterns' : 'a predictable pattern'} — ${list} — so a real guess would land far sooner.`
      : 'That figure assumes the characters were picked at random — if any of it came from a word or a date, the real number is lower.';

    return ok({
      entropyBits: round(Math.log2(alphabetSize) * p.length, 1),
      length: p.length, alphabetSize, classes, flags, caveat
    }, computed());
  }
};
