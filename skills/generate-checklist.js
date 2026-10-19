import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'generateChecklist',
  description: 'Turn your own list into tick boxes — a markdown checklist.',
  category: 'generation', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{count}} {{count|plural:item:items}}:\n{{markdown}}',
  inputSchema: {
    type: 'object', required: ['items'],
    properties: {
      items: { type: 'array', label: 'items', minItems: 1, maxItems: 200, items: { type: 'string' }, prompt: 'Which items should go on the checklist?' },
      title: { type: 'string', label: 'heading', description: 'a heading above the list' },
      numbered: { type: 'boolean', label: 'numbered', default: false }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      markdown: { type: 'string' }, lines: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' }, title: { type: 'string' }
    }
  },
  examples: [
    { text: 'make a checklist from these items', input: { items: ['passport', 'charger'] }, output: { markdown: '- [ ] passport\n- [ ] charger', lines: ['- [ ] passport', '- [ ] charger'], count: 2, title: null } },
    { text: 'checklist with a heading', input: { items: ['tent', 'stove'], title: 'Camping' }, output: { markdown: '## Camping\n\n- [ ] tent\n- [ ] stove', lines: ['- [ ] tent', '- [ ] stove'], count: 2, title: 'Camping' } },
    { text: 'make a numbered checklist', input: { items: ['wash', 'rinse', 'dry'], numbered: true }, output: { markdown: '1. [ ] wash\n2. [ ] rinse\n3. [ ] dry', lines: ['1. [ ] wash', '2. [ ] rinse', '3. [ ] dry'], count: 3, title: null } },
    { text: 'turn one task into a checklist', input: { items: ['call the dentist'] }, output: { markdown: '- [ ] call the dentist', lines: ['- [ ] call the dentist'], count: 1, title: null } },
    { text: 'checklist ignoring blank entries', input: { items: ['  milk  ', '', 'bread'] }, output: { markdown: '- [ ] milk\n- [ ] bread', lines: ['- [ ] milk', '- [ ] bread'], count: 2, title: null } }
  ],
  errorCases: [
    { input: { items: [] }, code: 'INVALID_INPUT' },
    { input: { items: ['   ', ''] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    /* Blank entries are dropped rather than rendered as empty boxes — a list
       pasted from somewhere else usually carries a few, and an empty checkbox
       is a task nobody can complete. */
    const items = input.items.map((i) => String(i).trim()).filter(Boolean);
    if (!items.length) return fail('INVALID_INPUT', 'Every one of those items is blank, so there is nothing to put on a checklist.', 'items');

    const lines = items.map((item, i) => (input.numbered ? `${i + 1}. [ ] ${item}` : `- [ ] ${item}`));
    const title = input.title ? String(input.title).trim() : null;
    return ok({
      markdown: title ? `## ${title}\n\n${lines.join('\n')}` : lines.join('\n'),
      lines, count: items.length, title
    }, computed());
  }
};
