import { ok, fail, computed } from '../src/contracts.js';
import { round, gcd } from '../src/lib/num.js';

export default {
  name: 'scaleDimensions',
  description: 'Resize a width and height to fit a target, keeping the same proportions.',
  category: 'design',
  tier: 'core',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{width}} × {{height}} — scaled {{scale}}× from {{originalWidth}} × {{originalHeight}} ({{ratio}}).',
  inputSchema: {
    type: 'object',
    required: ['width', 'height'],
    properties: {
      width: { type: 'number', label: 'width', exclusiveMinimum: 0, prompt: 'What is the current width?' },
      height: { type: 'number', label: 'height', exclusiveMinimum: 0, prompt: 'What is the current height?' },
      targetWidth: { type: 'number', label: 'target width', exclusiveMinimum: 0 },
      targetHeight: { type: 'number', label: 'target height', exclusiveMinimum: 0 },
      scale: { type: 'number', label: 'scale factor', exclusiveMinimum: 0 }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      width: { type: 'integer' }, height: { type: 'integer' }, scale: { type: 'number' },
      originalWidth: { type: 'number' }, originalHeight: { type: 'number' },
      ratio: { type: 'string' }, constrainedBy: { type: 'string' }
    }
  },
  examples: [
    { text: 'resize 1920x1080 to 800 wide', input: { width: 1920, height: 1080, targetWidth: 800 },
      output: { width: 800, height: 450, scale: 0.4167, originalWidth: 1920, originalHeight: 1080, ratio: '16:9', constrainedBy: 'width' } },
    { text: 'scale 4000x3000 to fit in 1000x1000', input: { width: 4000, height: 3000, targetWidth: 1000, targetHeight: 1000 },
      output: { width: 1000, height: 750, scale: 0.25, originalWidth: 4000, originalHeight: 3000, ratio: '4:3', constrainedBy: 'width' } },
    { text: 'halve these dimensions', input: { width: 1200, height: 800, scale: 0.5 },
      output: { width: 600, height: 400, scale: 0.5, originalWidth: 1200, originalHeight: 800, ratio: '3:2', constrainedBy: 'scale' } },
    { text: 'make this 600 tall keeping the ratio', input: { width: 1000, height: 400, targetHeight: 600 },
      output: { width: 1500, height: 600, scale: 1.5, originalWidth: 1000, originalHeight: 400, ratio: '5:2', constrainedBy: 'height' } },
    { text: 'fit a portrait image in a 500x500 box', input: { width: 600, height: 900, targetWidth: 500, targetHeight: 500 },
      output: { width: 333, height: 500, scale: 0.5556, originalWidth: 600, originalHeight: 900, ratio: '2:3', constrainedBy: 'height' } }
  ],
  errorCases: [
    { input: { width: 100, height: 100 }, code: 'INVALID_INPUT' },
    { input: { width: 0, height: 100, scale: 2 }, code: 'INVALID_INPUT' },
    { input: { height: 100, scale: 2 }, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const { width: w, height: h } = input;
    let scale, constrainedBy;

    if (input.scale !== undefined) {
      scale = input.scale; constrainedBy = 'scale';
    } else if (input.targetWidth !== undefined && input.targetHeight !== undefined) {
      /* FIT, not fill: the smaller of the two ratios, so the result is inside
         the box on both axes. Taking the larger would crop. */
      const sw = input.targetWidth / w;
      const sh = input.targetHeight / h;
      scale = Math.min(sw, sh);
      constrainedBy = sw <= sh ? 'width' : 'height';
    } else if (input.targetWidth !== undefined) {
      scale = input.targetWidth / w; constrainedBy = 'width';
    } else if (input.targetHeight !== undefined) {
      scale = input.targetHeight / h; constrainedBy = 'height';
    } else {
      return fail('INVALID_INPUT', 'Give me a target width, a target height, or a scale factor.', 'targetWidth');
    }

    const divisor = gcd(Math.round(w), Math.round(h)) || 1;
    return ok({
      width: Math.round(w * scale),
      height: Math.round(h * scale),
      scale: round(scale, 4),
      originalWidth: w, originalHeight: h,
      ratio: `${Math.round(w) / divisor}:${Math.round(h) / divisor}`,
      constrainedBy
    }, computed());
  }
};
