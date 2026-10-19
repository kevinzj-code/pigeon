import { ok, fail, computed } from '../src/contracts.js';
import { round } from '../src/lib/num.js';

/* The common US four-point scale. Institutions differ - some give A+ a 4.3,
   some do not use minus grades at all - so the scale is stated in the output
   rather than presented as the only one there is. */
const POINTS = {
  'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7,
  'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0
};

export default {
  name: 'gpaCalculate',
  description: 'Work out a grade point average from letter grades and credit hours.',
  category: 'learning', tier: 'standard',
  title: 'GPA',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: 'GPA {{gpa}} across {{credits}} credits — {{points}} grade points on a {{scale}} scale.',
  inputSchema: {
    type: 'object', required: ['courses'],
    properties: {
      courses: { type: 'array', label: 'courses', minItems: 1, maxItems: 100, prompt: 'What are the grades and credit hours?' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      gpa: { type: 'number' }, credits: { type: 'number' }, points: { type: 'number' },
      scale: { type: 'number' }, lines: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' }
    }
  },
  examples: [
    { text: 'work out my gpa', input: { courses: [{ grade: 'A', credits: 3 }, { grade: 'B+', credits: 4 }, { grade: 'C', credits: 3 }] }, output: { gpa: 3.12, credits: 10, points: 31.2, scale: 4, lines: ['A x 3 credits = 12', 'B+ x 4 credits = 13.2', 'C x 3 credits = 6'], count: 3 } },
    { text: 'calculate gpa for two A grades', input: { courses: [{ grade: 'A', credits: 4 }, { grade: 'A', credits: 4 }] }, output: { gpa: 4, credits: 8, points: 32, scale: 4, lines: ['A x 4 credits = 16', 'A x 4 credits = 16'], count: 2 } },
    { text: 'what is my grade point average this term', input: { courses: [{ grade: 'B', credits: 3 }, { grade: 'B-', credits: 3 }, { grade: 'C+', credits: 4 }] }, output: { gpa: 2.63, credits: 10, points: 26.3, scale: 4, lines: ['B x 3 credits = 9', 'B- x 3 credits = 8.1', 'C+ x 4 credits = 9.2'], count: 3 } },
    { text: 'gpa including a failed course', input: { courses: [{ grade: 'A-', credits: 3 }, { grade: 'B', credits: 3 }, { grade: 'F', credits: 3 }] }, output: { gpa: 2.23, credits: 9, points: 20.1, scale: 4, lines: ['A- x 3 credits = 11.1', 'B x 3 credits = 9', 'F x 3 credits = 0'], count: 3 } },
    { text: 'gpa for a single course', input: { courses: [{ grade: 'B+', credits: 3 }] }, output: { gpa: 3.3, credits: 3, points: 9.9, scale: 4, lines: ['B+ x 3 credits = 9.9'], count: 1 } }
  ],
  errorCases: [
    { input: { courses: [{ grade: 'Z', credits: 3 }] }, code: 'INVALID_INPUT' },
    { input: { courses: [{ grade: 'A', credits: 0 }] }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    let points = 0;
    let credits = 0;
    const lines = [];
    for (const [i, c] of input.courses.entries()) {
      const grade = String(c?.grade ?? '').trim().toUpperCase();
      const weight = Number(c?.credits);
      if (!(grade in POINTS)) return fail('INVALID_INPUT', `Course ${i + 1} has grade "${c?.grade}", which is not on the scale — use A to F, with + and - if you have them.`, 'courses');
      if (!Number.isFinite(weight) || weight <= 0) return fail('INVALID_INPUT', `Course ${i + 1} has no usable credit hours.`, 'courses');
      const earned = POINTS[grade] * weight;
      points += earned;
      credits += weight;
      lines.push(`${grade} x ${weight} credits = ${round(earned, 4)}`);
    }
    return ok({
      gpa: round(points / credits, 2), credits: round(credits, 4),
      points: round(points, 4), scale: 4, lines, count: input.courses.length
    }, computed());
  }
};
