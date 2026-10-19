/* schema.js — the JSON Schema subset Pigeon actually uses, and nothing else.
 *
 * A full JSON Schema implementation is a dependency, a download, and a large
 * surface of keywords no skill in the registry uses. This validates the subset
 * the registry is written in and REFUSES to silently ignore a keyword outside
 * it — an unknown keyword is an author error that surfaces in `npm test`,
 * not a rule that quietly never ran.
 *
 * Supported: type, required, properties, additionalProperties(false),
 * items, enum, minimum, maximum, exclusiveMinimum, exclusiveMaximum,
 * minLength, maxLength, pattern, minItems, maxItems, default, prompt, description.
 *
 * §3.3: a required field carries a `prompt` string, which is what ASK_USER
 * says out loud. A required field WITHOUT one is an author error, because the
 * alternative is a model-written question, and §2.1 says the model doesn't get
 * to write those. */

import { ERROR_CODES } from './contracts.js';

const KNOWN = new Set([
  'type', 'required', 'properties', 'additionalProperties', 'items', 'enum',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems',
  'default', 'prompt', 'description', 'title', 'label', 'carry'
]);

/** Author-time check. Run by the test suite over every registry entry. */
export function lintSchema (schema, path = 'root') {
  const problems = [];
  if (!schema || typeof schema !== 'object') {
    problems.push(`${path}: schema must be an object`);
    return problems;
  }
  for (const k of Object.keys(schema)) {
    if (!KNOWN.has(k)) problems.push(`${path}: unsupported keyword "${k}"`);
  }
  if (schema.type === 'object' && schema.properties) {
    const req = new Set(schema.required || []);
    for (const [name, sub] of Object.entries(schema.properties)) {
      if (req.has(name) && typeof sub.prompt !== 'string') {
        problems.push(`${path}.${name}: required fields need a "prompt" string for ASK_USER (§3.3)`);
      }
      problems.push(...lintSchema(sub, `${path}.${name}`));
    }
    for (const name of req) {
      if (!schema.properties[name]) problems.push(`${path}: required lists "${name}" which has no property`);
    }
  }
  if (schema.items) problems.push(...lintSchema(schema.items, `${path}[]`));
  return problems;
}

const typeOf = (v) => Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;

/* A schema object is a static part of a skill's definition, re-validated
   against many times over the process's life — an array field's `pattern`
   would otherwise be recompiled once per element, every call. Keyed on the
   schema object itself, since that's what's stable, not the pattern string. */
const patternCache = new WeakMap();
function patternFor (schema) {
  let re = patternCache.get(schema);
  if (!re) {
    re = new RegExp(schema.pattern);
    patternCache.set(schema, re);
  }
  return re;
}

/* Deliberate, narrow coercion. The planner emits JSON produced by a language
   model; "2" where 2 was meant is the single most common shape error, and
   round-tripping it through the Extractor costs a model call to fix a thing
   JS can see. Coercion NEVER invents a value: it only re-types one that is
   already unambiguously present. Anything ambiguous fails and goes to the
   Extractor, which is the correct escalation. */
const enumKey = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '');
function enumMatch (values, v) {
  const k = enumKey(v);
  if (!k) return undefined;
  const hits = values.filter(e => typeof e === 'string' && enumKey(e) === k);
  return hits.length === 1 ? hits[0] : undefined;
}

function coerceValue (schema, v) {
  const t = schema.type;
  if (t === 'number' || t === 'integer') {
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v.trim().replace(/,/g, ''));
      if (Number.isFinite(n)) return n;
    }
  }
  if (t === 'string' && typeof v === 'number') return String(v);
  if (t === 'boolean' && (v === 'true' || v === 'false')) return v === 'true';
  if (t === 'array' && !Array.isArray(v) && v !== undefined && v !== null) return [v];
  return v;
}

/**
 * Validate `value` against `schema`.
 * @returns {{ok:boolean, value:any, errors:Array<{field,code,message,prompt}>}}
 *   `value` is the coerced/defaulted copy. `errors` carries MISSING_FIELD for
 *   an absent required field (with its prompt, so the caller can ASK_USER) and
 *   INVALID_INPUT for everything else.
 */
export function validate (schema, value, { coerce = true, path = '' } = {}) {
  const errors = [];
  const out = walk(schema, value, path, errors, coerce);
  return { ok: errors.length === 0, value: out, errors };
}

function walk (schema, value, path, errors, coerce) {
  const bad = (code, message, prompt = null) => {
    errors.push({ field: path || null, code, message, prompt });
  };

  if (value === undefined && schema.default !== undefined) {
    value = clone(schema.default);
  }
  if (coerce) value = coerceValue(schema, value);

  if (value === undefined || value === null) {
    /* Absence is only reported by the parent's `required` list — a property
       that is simply not required and not present is fine and returns
       undefined so it doesn't appear as an explicit null in the input. */
    return undefined;
  }

  if (schema.type) {
    const actual = typeOf(value);
    const wanted = schema.type;
    const typeOk = wanted === 'integer'
      ? actual === 'number' && Number.isInteger(value)
      : actual === wanted;
    if (!typeOk) {
      bad(ERROR_CODES.INVALID_INPUT, `must be ${wanted === 'integer' ? 'a whole number' : `a ${wanted}`}, got ${actual === 'number' && wanted === 'integer' ? 'a fraction' : actual}`);
      return value;
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    /* A planner writes "sha512" for SHA-512 and "tints" for tints; the person
       meant the enum value and the difference is case and punctuation. Match
       on letters and digits alone and hand back the canonical spelling, so a
       skill never fails on a value it plainly recognises. Ambiguity (two enum
       values that normalise the same) is left to fail as before. */
    const canon = coerce && typeof value === 'string' ? enumMatch(schema.enum, value) : undefined;
    if (canon === undefined) {
      bad(ERROR_CODES.INVALID_INPUT, `must be one of: ${schema.enum.join(', ')}`);
      return value;
    }
    value = canon;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) bad(ERROR_CODES.INVALID_INPUT, 'must be a finite number');
    if (schema.minimum !== undefined && value < schema.minimum) bad(ERROR_CODES.INVALID_INPUT, `must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) bad(ERROR_CODES.INVALID_INPUT, `must be at most ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) bad(ERROR_CODES.INVALID_INPUT, `must be greater than ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) bad(ERROR_CODES.INVALID_INPUT, `must be less than ${schema.exclusiveMaximum}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) bad(ERROR_CODES.INVALID_INPUT, `must be at least ${schema.minLength} character${schema.minLength === 1 ? '' : 's'}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) bad(ERROR_CODES.INVALID_INPUT, `must be at most ${schema.maxLength} character${schema.maxLength === 1 ? '' : 's'}`);
    if (schema.pattern && !patternFor(schema).test(value)) bad(ERROR_CODES.INVALID_INPUT, schema.description ? `must be ${schema.description}` : `must match ${schema.pattern}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) bad(ERROR_CODES.INVALID_INPUT, `needs at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) bad(ERROR_CODES.INVALID_INPUT, `takes at most ${schema.maxItems} item${schema.maxItems === 1 ? '' : 's'}`);
    if (schema.items) {
      return value.map((item, i) => walk(schema.items, item, `${path}[${i}]`, errors, coerce));
    }
    return value;
  }

  if (schema.type === 'object' || schema.properties) {
    const props = schema.properties || {};
    const out = {};
    for (const name of schema.required || []) {
      const present = value[name] !== undefined && value[name] !== null && value[name] !== '';
      if (!present && props[name] && props[name].default === undefined) {
        errors.push({
          field: name,
          code: ERROR_CODES.MISSING_FIELD,
          message: `"${name}" is required`,
          prompt: (props[name] && props[name].prompt) || null
        });
      }
    }
    for (const [name, sub] of Object.entries(props)) {
      const got = walk(sub, value[name], path ? `${path}.${name}` : name, errors, coerce);
      if (got !== undefined) out[name] = got;
    }
    if (schema.additionalProperties !== false) {
      for (const [k, v] of Object.entries(value)) {
        if (!(k in props)) out[k] = v;
      }
    }
    return out;
  }

  return value;
}

function clone (v) {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}
