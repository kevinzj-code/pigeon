import { ok, fail, computed } from '../src/contracts.js';
import { validate } from '../src/schema.js';

const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];

function schemaProblem (node, where) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return `${where} is not an object`;
  if (node.type !== undefined && !TYPES.includes(node.type)) {
    return `${where} asks for type "${node.type}", which is not one of ${TYPES.join(', ')}`;
  }
  if (node.required !== undefined && (!Array.isArray(node.required) || node.required.some((r) => typeof r !== 'string'))) {
    return `${where} has a "required" that is not a list of field names`;
  }
  if (node.enum !== undefined && (!Array.isArray(node.enum) || !node.enum.length)) return `${where} has an empty or malformed "enum"`;
  if (node.properties !== undefined) {
    if (node.properties === null || typeof node.properties !== 'object' || Array.isArray(node.properties)) return `${where} has a "properties" that is not an object`;
    for (const [key, sub] of Object.entries(node.properties)) {
      const deeper = schemaProblem(sub, `"${key}"`);
      if (deeper) return deeper;
    }
  }
  if (node.items !== undefined) return schemaProblem(node.items, `${where}'s items`);
  return null;
}

export default {
  name: 'validateJsonSchema',
  description: 'Check whether a JSON document matches a JSON Schema.',
  category: 'validation', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  title: 'Validate JSON schema',
  replyTemplate: '{{summary|prose}}\n{{lines|lines}}',
  inputSchema: {
    type: 'object', required: ['schema', 'data'],
    properties: {
      schema: { type: 'string', label: 'schema', minLength: 1, prompt: 'Which JSON Schema should I check against?' },
      data: { type: 'string', label: 'json', minLength: 1, prompt: 'Which JSON document should I check?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      valid: { type: 'boolean' }, errors: { type: 'array' },
      lines: { type: 'array', items: { type: 'string' } },
      errorCount: { type: 'integer' }, summary: { type: 'string' }, coerced: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'does this json match the schema', input: { schema: '{"type":"object","required":["name"],"properties":{"name":{"type":"string"}}}', data: '{"name":"Ana"}' }, output: { valid: true, errors: [], lines: [], errorCount: 0, summary: 'That document matches the schema.', coerced: false } },
    { text: 'validate this data against my schema', input: { schema: '{"type":"object","required":["name"],"properties":{"name":{"type":"string"}}}', data: '{}' }, output: { valid: false, errors: [{ field: 'name', code: 'MISSING_FIELD', message: '"name" is required' }], lines: ['name: "name" is required'], errorCount: 1, summary: 'That document does not match the schema — 1 problem.', coerced: false } },
    { text: 'check the age is in range', input: { schema: '{"type":"object","properties":{"age":{"type":"integer","minimum":0}}}', data: '{"age":-1}' }, output: { valid: false, errors: [{ field: 'age', code: 'INVALID_INPUT', message: 'must be at least 0' }], lines: ['age: must be at least 0'], errorCount: 1, summary: 'That document does not match the schema — 1 problem.', coerced: false } },
    { text: 'is this value one of the allowed options', input: { schema: '{"type":"object","properties":{"role":{"type":"string","enum":["admin","user"]}}}', data: '{"role":"root"}' }, output: { valid: false, errors: [{ field: 'role', code: 'INVALID_INPUT', message: 'must be one of: admin, user' }], lines: ['role: must be one of: admin, user'], errorCount: 1, summary: 'That document does not match the schema — 1 problem.', coerced: false } },
    { text: 'validate a numeric string against an integer field', input: { schema: '{"type":"object","properties":{"age":{"type":"integer"}}}', data: '{"age":"34"}' }, output: { valid: true, errors: [], lines: [], errorCount: 0, summary: 'That document matches the schema, after reading 1 value as the type the schema asked for.', coerced: true } }
  ],
  errorCases: [
    { input: { schema: '{not json}', data: '{}' }, code: 'INVALID_INPUT' },
    { input: { schema: '{"type":"object"}', data: '{oops}' }, code: 'INVALID_INPUT' },
    { input: { schema: '{"type":"banana"}', data: '{}' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    let schema; let data;
    try { schema = JSON.parse(input.schema); }
    catch (e) { return fail('INVALID_INPUT', `The schema isn't valid JSON — ${e.message.replace(/\s*\(line.*|\s*at position \d+/, '')}.`, 'schema'); }
    try { data = JSON.parse(input.data); }
    catch (e) { return fail('INVALID_INPUT', `The document isn't valid JSON — ${e.message.replace(/\s*\(line.*|\s*at position \d+/, '')}.`, 'data'); }

    /* The schema itself is checked before anything is validated against it. A
       typo in the schema would otherwise show up as the data being wrong, which
       sends you looking in the wrong file.
       Deliberately NOT lintSchema(): that enforces Pigeon's own rule that every
       required field carries an ASK_USER prompt, which is right for a skill's
       input schema and wrong for a user's schema, where it would reject
       perfectly good input. This checks only what the validator can act on. */
    const problem = schemaProblem(schema, 'the schema');
    if (problem) return fail('INVALID_INPUT', `That schema has a problem of its own: ${problem}.`, 'schema');

    const result = validate(schema, data);
    const errors = (result.errors || []).map((e) => ({ field: e.field, code: e.code, message: e.message }));
    /* This validator coerces narrowly — "34" against an integer field passes as
       34. Saying so matters: the document as written did not have the type the
       schema asked for, and a stricter validator elsewhere would reject it. */
    const coerced = result.ok && JSON.stringify(result.value) !== JSON.stringify(data);
    const changed = coerced ? Object.keys(data).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(result.value[k])).length : 0;

    return ok({
      valid: result.ok, errors,
      lines: errors.map((e) => `${e.field}: ${e.message}`),
      errorCount: errors.length,
      summary: result.ok
        ? (coerced ? `That document matches the schema, after reading ${changed} ${changed === 1 ? 'value' : 'values'} as the type the schema asked for.` : 'That document matches the schema.')
        : `That document does not match the schema — ${errors.length} ${errors.length === 1 ? 'problem' : 'problems'}.`,
      coerced
    }, computed());
  }
};
