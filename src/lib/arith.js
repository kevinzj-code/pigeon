/* arith.js — an arithmetic evaluator that is not eval().
 *
 * §3.3 says skills are pure and there is no `eval`. That is not a style
 * preference: `run` executes inside the harness, and an evaluator that reaches
 * the JS runtime turns "do this sum" into "run this program". So this is a
 * hand-written recursive-descent parser over a closed grammar. It knows about
 * numbers, seven operators, parentheses and a fixed function table, and there
 * is no production in the grammar that can name anything else.
 *
 * Grammar:
 *   expr    := term (('+' | '-') term)*
 *   term    := power (('*' | '/' | '%mod') power)*
 *   power   := unary ('^' power)?          // right-associative
 *   unary   := ('-' | '+')? postfix
 *   postfix := primary '%'?                // trailing % = "percent of 1"
 *   primary := NUMBER | '(' expr ')' | FUNC '(' args ')' | CONST
 */

const FUNCS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor,
  ceil: Math.ceil, min: Math.min, max: Math.max, ln: Math.log,
  log: Math.log10, exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  pow: Math.pow
};
const CONSTS = { pi: Math.PI, e: Math.E };

export function evaluate (src) {
  const tokens = lex(src);
  if (!tokens.length) throw new Error('Give me an expression to work out.');
  const p = { tokens, i: 0 };
  const v = parseExpr(p);
  if (p.i < tokens.length) throw new Error(`I got stuck at "${tokens[p.i].text}".`);
  if (!Number.isFinite(v)) throw new Error('That does not come out to a finite number.');
  return v;
}

function lex (src) {
  const s = String(src ?? '')
    .replace(/[×✕✖]/g, '*').replace(/[÷]/g, '/').replace(/[−–—]/g, '-')
    .replace(/,(?=\d{3}\b)/g, '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(s.slice(i));
      if (!m) throw new Error(`"${s.slice(i, i + 6)}" is not a number I can read.`);
      out.push({ type: 'num', value: Number(m[0]), text: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      const m = /^[a-zA-Z]+/.exec(s.slice(i));
      const name = m[0].toLowerCase();
      if (!(name in FUNCS) && !(name in CONSTS)) {
        throw new Error(`I only do plain arithmetic — I don't know "${m[0]}".`);
      }
      out.push({ type: name in FUNCS ? 'func' : 'const', value: name, text: m[0] });
      i += m[0].length;
      continue;
    }
    if ('+-*/^()%,'.includes(c)) { out.push({ type: 'op', value: c, text: c }); i++; continue; }
    throw new Error(`I only do plain arithmetic — "${c}" isn't part of that.`);
  }
  return out;
}

const peek = (p) => p.tokens[p.i];
const eat = (p, value) => {
  const t = peek(p);
  if (t && t.type === 'op' && t.value === value) { p.i++; return true; }
  return false;
};

function parseExpr (p) {
  let left = parseTerm(p);
  for (;;) {
    if (eat(p, '+')) left += parseTerm(p);
    else if (eat(p, '-')) left -= parseTerm(p);
    else return left;
  }
}

function parseTerm (p) {
  let left = parsePower(p);
  for (;;) {
    if (eat(p, '*')) left *= parsePower(p);
    else if (eat(p, '/')) {
      const r = parsePower(p);
      if (r === 0) throw new Error('That divides by zero.');
      left /= r;
    } else return left;
  }
}

function parsePower (p) {
  const base = parseUnary(p);
  if (eat(p, '^')) return Math.pow(base, parsePower(p));
  return base;
}

function parseUnary (p) {
  if (eat(p, '-')) return -parseUnary(p);
  if (eat(p, '+')) return parseUnary(p);
  return parsePostfix(p);
}

function parsePostfix (p) {
  let v = parsePrimary(p);
  /* "50%" is 0.5 and "200 * 15%" is 30 — the reading everyone expects from a
     calculator, and the one the shipped Airoplane calculator skill already
     uses. It is a postfix operator, not a modulo. */
  while (peek(p) && peek(p).type === 'op' && peek(p).value === '%') { p.i++; v /= 100; }
  return v;
}

function parsePrimary (p) {
  const t = peek(p);
  if (!t) throw new Error('The expression stops early — something is missing after it.');
  if (t.type === 'num') { p.i++; return t.value; }
  if (t.type === 'const') { p.i++; return CONSTS[t.value]; }
  if (t.type === 'func') {
    p.i++;
    if (!eat(p, '(')) throw new Error(`"${t.text}" needs brackets, like ${t.text}(9).`);
    const args = [parseExpr(p)];
    while (eat(p, ',')) args.push(parseExpr(p));
    if (!eat(p, ')')) throw new Error('A closing bracket is missing.');
    const r = FUNCS[t.value](...args);
    if (Number.isNaN(r)) throw new Error(`${t.text}() doesn't have an answer for that.`);
    return r;
  }
  if (eat(p, '(')) {
    const v = parseExpr(p);
    if (!eat(p, ')')) throw new Error('A closing bracket is missing.');
    return v;
  }
  throw new Error(`I got stuck at "${t.text}".`);
}
