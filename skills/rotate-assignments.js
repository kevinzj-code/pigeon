import { ok, fail, computed } from '../src/contracts.js';

export default {
  name: 'rotateAssignments',
  description: 'Build a rota that shares tasks evenly between people over several rounds.',
  category: 'organising', tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{rounds}} {{rounds|plural:round:rounds}} of {{taskCount}} {{taskCount|plural:task:tasks}} across {{personCount}} people:\n{{lines|lines}}',
  inputSchema: {
    type: 'object', required: ['people', 'tasks'],
    properties: {
      people: { type: 'array', label: 'people', minItems: 1, maxItems: 100, items: { type: 'string' }, prompt: 'Who is on the rota?' },
      tasks: { type: 'array', label: 'tasks', minItems: 1, maxItems: 100, items: { type: 'string' }, prompt: 'Which tasks are being shared?' },
      rounds: { type: 'integer', label: 'rounds', minimum: 1, maximum: 100, default: 4 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      rota: { type: 'array' }, lines: { type: 'array', items: { type: 'string' } },
      rounds: { type: 'integer' }, taskCount: { type: 'integer' }, personCount: { type: 'integer' },
      repeatsAfter: { type: 'integer' }
    }
  },
  examples: [
    { text: 'make a rota for these chores', input: { people: ['Ana', 'Bo', 'Cy'], tasks: ['dishes', 'bins', 'hoover'], rounds: 3 }, output: { rota: [{ round: 1, assignments: [{ task: 'dishes', person: 'Ana' }, { task: 'bins', person: 'Bo' }, { task: 'hoover', person: 'Cy' }] }, { round: 2, assignments: [{ task: 'dishes', person: 'Bo' }, { task: 'bins', person: 'Cy' }, { task: 'hoover', person: 'Ana' }] }, { round: 3, assignments: [{ task: 'dishes', person: 'Cy' }, { task: 'bins', person: 'Ana' }, { task: 'hoover', person: 'Bo' }] }], lines: ['Round 1: dishes Ana, bins Bo, hoover Cy', 'Round 2: dishes Bo, bins Cy, hoover Ana', 'Round 3: dishes Cy, bins Ana, hoover Bo'], rounds: 3, taskCount: 3, personCount: 3, repeatsAfter: 3 } },
    { text: 'rotate two jobs between two people', input: { people: ['Sam', 'Kit'], tasks: ['cook', 'clean'], rounds: 2 }, output: { rota: [{ round: 1, assignments: [{ task: 'cook', person: 'Sam' }, { task: 'clean', person: 'Kit' }] }, { round: 2, assignments: [{ task: 'cook', person: 'Kit' }, { task: 'clean', person: 'Sam' }] }], lines: ['Round 1: cook Sam, clean Kit', 'Round 2: cook Kit, clean Sam'], rounds: 2, taskCount: 2, personCount: 2, repeatsAfter: 2 } },
    { text: 'share one task between three people', input: { people: ['Ana', 'Bo', 'Cy'], tasks: ['lock up'], rounds: 4 }, output: { rota: [{ round: 1, assignments: [{ task: 'lock up', person: 'Ana' }] }, { round: 2, assignments: [{ task: 'lock up', person: 'Bo' }] }, { round: 3, assignments: [{ task: 'lock up', person: 'Cy' }] }, { round: 4, assignments: [{ task: 'lock up', person: 'Ana' }] }], lines: ['Round 1: lock up Ana', 'Round 2: lock up Bo', 'Round 3: lock up Cy', 'Round 4: lock up Ana'], rounds: 4, taskCount: 1, personCount: 3, repeatsAfter: 3 } },
    { text: 'rota with more tasks than people', input: { people: ['Ana', 'Bo'], tasks: ['a', 'b', 'c'], rounds: 2 }, output: { rota: [{ round: 1, assignments: [{ task: 'a', person: 'Ana' }, { task: 'b', person: 'Bo' }, { task: 'c', person: 'Ana' }] }, { round: 2, assignments: [{ task: 'a', person: 'Bo' }, { task: 'b', person: 'Ana' }, { task: 'c', person: 'Bo' }] }], lines: ['Round 1: a Ana, b Bo, c Ana', 'Round 2: a Bo, b Ana, c Bo'], rounds: 2, taskCount: 3, personCount: 2, repeatsAfter: 2 } },
    { text: 'weekly rota for four weeks', input: { people: ['Ana', 'Bo'], tasks: ['bins'] }, output: { rota: [{ round: 1, assignments: [{ task: 'bins', person: 'Ana' }] }, { round: 2, assignments: [{ task: 'bins', person: 'Bo' }] }, { round: 3, assignments: [{ task: 'bins', person: 'Ana' }] }, { round: 4, assignments: [{ task: 'bins', person: 'Bo' }] }], lines: ['Round 1: bins Ana', 'Round 2: bins Bo', 'Round 3: bins Ana', 'Round 4: bins Bo'], rounds: 4, taskCount: 1, personCount: 2, repeatsAfter: 2 } }
  ],
  errorCases: [
    { input: { people: [], tasks: ['a'] }, code: 'INVALID_INPUT' },
    { input: { people: ['Ana'], tasks: [] }, code: 'INVALID_INPUT' },
    { input: { people: ['Ana'] }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const people = input.people.map((p) => String(p).trim()).filter(Boolean);
    const tasks = input.tasks.map((t) => String(t).trim()).filter(Boolean);
    if (!people.length) return fail('INVALID_INPUT', 'There is nobody on the rota.', 'people');
    if (!tasks.length) return fail('INVALID_INPUT', 'There are no tasks to share out.', 'tasks');

    /* Task i in round r goes to person (i + r) mod n. Every person moves along
       by one each round, so with as many people as tasks nobody repeats a task
       until the whole cycle has run - which is the property that makes a rota
       feel fair rather than merely random. */
    const rota = [];
    for (let r = 0; r < input.rounds; r++) {
      rota.push({
        round: r + 1,
        assignments: tasks.map((task, i) => ({ task, person: people[(i + r) % people.length] }))
      });
    }

    return ok({
      rota,
      lines: rota.map((round) => `Round ${round.round}: ${round.assignments.map((a) => `${a.task} ${a.person}`).join(', ')}`),
      rounds: input.rounds, taskCount: tasks.length, personCount: people.length,
      repeatsAfter: people.length
    }, computed());
  }
};
