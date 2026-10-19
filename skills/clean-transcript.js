import { ok, computed } from '../src/contracts.js';
import { mechanicalClean, isTranscript } from '../src/captions.js';

/* Only the half that can be proved.
 *
 * A machine-made transcript is damaged in two ways, and just one of them can
 * be repaired without guessing: the timestamps, the cue numbers, the speaker
 * label stamped on every cue, the sentence the caption chunker cut in half,
 * the stutter, the filler. All of it deletion or reassembly. That is this
 * skill, and its provenance is honestly `computed`.
 *
 * The other half — where a sentence really ends, where a paragraph turns, a
 * name the transcriber split into "pail. Wave com" — is judgement, and the
 * verified lane has no provenance word for a model's judgement. It is offered
 * separately, audited, with the raw reading kept, exactly as the OCR tidy is.
 * Putting it in here would be the one thing this lane promises not to do.
 *
 * So the reply says what was removed. A person who can see 22 stutters and 18
 * fillers go can check the claim; a person handed clean text cannot.
 */
export default {
  name: 'cleanTranscript',
  description: 'Strip the timestamps, cue numbers and repeated speaker labels out of an auto-generated transcript, rejoin the sentences its captions cut in half, and drop the stutters and filler words.',
  category: 'text',
  tier: 'standard',
  unbuilt: false, needsNetwork: false, dataAsOf: null, labels: [],
  replyTemplate: '{{result}}',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', label: 'transcript', prompt: 'Paste the transcript and I will tidy it.' },
      removeFillers: { type: 'boolean', label: 'remove filler words', default: true, description: 'drop "you know" and "kind of" where they are clearly filler' },
      removeStutters: { type: 'boolean', label: 'remove stutters', default: true, description: 'drop a repeated word the speaker restarted on' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'string' },
      format: { type: 'string' },
      speakers: { type: 'array' },
      cues: { type: 'integer' },
      fillersRemoved: { type: 'integer' },
      stuttersRemoved: { type: 'integer' },
      sentencesRejoined: { type: 'integer' }
    }
  },
  examples: [
    {
      "text": "strip the timestamps out of this transcript",
      "input": {
        "text": "[0:00:00 --> 0:00:05] Today we look at the tariffs and how they\n\n[0:00:05 --> 0:00:10] impact the industry. Let us jump in."
      },
      "output": {
        "result": "Today we look at the tariffs and how they impact the industry. Let us jump in.",
        "format": "bracketed",
        "speakers": [],
        "cues": 2,
        "fillersRemoved": 0,
        "stuttersRemoved": 0,
        "sentencesRejoined": 1
      }
    },
    {
      "text": "clean up this auto generated transcript",
      "input": {
        "text": "WEBVTT\n\n1\n00:00:02.440 --> 00:00:22.199\nAna Ruiz: So the the plan is simple. we ship on Friday\n\n2\n00:00:22.550 --> 00:00:42.309\nand then, you know, we watch the logs. um that is it"
      },
      "output": {
        "result": "So the plan is simple. we ship on Friday and then, we watch the logs. that is it",
        "format": "webvtt",
        "speakers": [
          "Ana Ruiz"
        ],
        "cues": 2,
        "fillersRemoved": 2,
        "stuttersRemoved": 1,
        "sentencesRejoined": 1
      }
    },
    {
      "text": "tidy this srt subtitle file into readable text",
      "input": {
        "text": "1\n00:00:01,000 --> 00:00:04,000\nwe need to talk about the\n\n2\n00:00:04,000 --> 00:00:07,000\nbudget before Friday."
      },
      "output": {
        "result": "we need to talk about the budget before Friday.",
        "format": "srt",
        "speakers": [],
        "cues": 2,
        "fillersRemoved": 0,
        "stuttersRemoved": 0,
        "sentencesRejoined": 1
      }
    },
    {
      "text": "remove the filler words from this transcript",
      "input": {
        "text": "[0:00:00 --> 0:00:04] um so basically we, you know, shipped it"
      },
      "output": {
        "result": "so basically we, shipped it",
        "format": "bracketed",
        "speakers": [],
        "cues": 1,
        "fillersRemoved": 2,
        "stuttersRemoved": 0,
        "sentencesRejoined": 0
      }
    },
    {
      "text": "take the repeated speaker names out of this recording transcript",
      "input": {
        "text": "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nJo Patel: The first thing is the budget.\n\n2\n00:00:04.000 --> 00:00:08.000\nJo Patel: The second thing is the timeline."
      },
      "output": {
        "result": "The first thing is the budget. The second thing is the timeline.",
        "format": "webvtt",
        "speakers": [
          "Jo Patel"
        ],
        "cues": 2,
        "fillersRemoved": 0,
        "stuttersRemoved": 0,
        "sentencesRejoined": 0
      }
    }
  ],
  errorCases: [
    { input: {}, code: 'MISSING_FIELD' },
    { input: { text: ['a'] }, code: 'INVALID_INPUT' },
    { input: { text: 'a', removeFillers: 'yes' }, code: 'INVALID_INPUT' }
  ],
  run (input) {
    const r = mechanicalClean(input.text, {
      usually: input.removeFillers !== false,
      stutters: input.removeStutters !== false
    });
    return ok({
      result: r.text,
      format: r.format,
      speakers: r.speakers,
      cues: r.stats.cues,
      fillersRemoved: r.stats.fillersRemoved,
      stuttersRemoved: r.stats.stuttersRemoved,
      sentencesRejoined: r.stats.midSentenceJoins
    }, computed());
  }
};
