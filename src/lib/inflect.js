/* inflect.js — English singular/plural, rules plus the words that ignore them.
 *
 * English pluralisation is regular for most words and wildly irregular for the
 * ones people use most, so this is a lookup table with a rule engine behind it
 * rather than the other way round. Both directions share one table, so
 * pluralize and singularize can never disagree about "person".
 */

import { isWord } from './words.js';

export const IRREGULAR = {
  child: 'children', person: 'people', man: 'men', woman: 'women', foot: 'feet',
  tooth: 'teeth', goose: 'geese', mouse: 'mice', louse: 'lice', ox: 'oxen',
  die: 'dice', penny: 'pence', criterion: 'criteria', phenomenon: 'phenomena',
  datum: 'data', medium: 'media', bacterium: 'bacteria', curriculum: 'curricula',
  analysis: 'analyses', thesis: 'theses', crisis: 'crises', basis: 'bases',
  diagnosis: 'diagnoses', hypothesis: 'hypotheses', parenthesis: 'parentheses',
  index: 'indices', appendix: 'appendices', matrix: 'matrices', vertex: 'vertices',
  cactus: 'cacti', focus: 'foci', fungus: 'fungi', nucleus: 'nuclei',
  syllabus: 'syllabi', radius: 'radii', alumnus: 'alumni', stimulus: 'stimuli'
};

/* Same in both numbers. Adding an s to any of these produces a different word
   or no word at all. */
export const UNCHANGING = new Set(`sheep deer fish species series aircraft salmon trout swine
bison moose offspring shrimp news means headquarters premises information equipment
furniture luggage advice music evidence software knowledge`.trim().split(/\s+/));

/* -f and -fe words that keep the f: the -ves rule is the majority, these are
   the exceptions to it. */
const KEEPS_F = new Set('roof roofs chief chiefs belief beliefs chef chefs cliff cliffs proof proofs brief briefs safe safes'.split(' '));
/* -o words taking a bare -s. The -oes rule covers potato, tomato, hero, echo. */
const O_TAKES_S = new Set('photo piano halo memo logo solo kilo zero taco burrito auto studio radio video portfolio'.split(' '));

const matchCase = (source, result) => {
  if (source === source.toUpperCase() && source.length > 1) return result.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return result[0].toUpperCase() + result.slice(1);
  return result;
};

export function pluralize (word) {
  const w = String(word).trim();
  const lower = w.toLowerCase();
  if (!lower) return { result: w, rule: 'empty' };
  if (UNCHANGING.has(lower)) return { result: w, rule: 'unchanging' };
  if (IRREGULAR[lower]) return { result: matchCase(w, IRREGULAR[lower]), rule: 'irregular' };
  if (Object.values(IRREGULAR).includes(lower)) return { result: w, rule: 'already plural' };

  /* quiz -> quizzes, fez -> fezzes. A single z after a vowel doubles before
     -es; a double z (buzz) or an s/x/ch/sh does not. */
  if (/[aeiou]z$/.test(lower)) return { result: matchCase(w, `${lower}zes`), rule: 'single -z doubles before -es' };
  if (/(s|x|z|ch|sh)$/.test(lower)) return { result: matchCase(w, `${lower}es`), rule: '-s/-x/-z/-ch/-sh takes -es' };
  if (/[^aeiou]y$/.test(lower)) return { result: matchCase(w, `${lower.slice(0, -1)}ies`), rule: 'consonant + -y becomes -ies' };
  if (/fe$/.test(lower) && !KEEPS_F.has(lower)) return { result: matchCase(w, `${lower.slice(0, -2)}ves`), rule: '-fe becomes -ves' };
  if (/f$/.test(lower) && !KEEPS_F.has(lower)) return { result: matchCase(w, `${lower.slice(0, -1)}ves`), rule: '-f becomes -ves' };
  if (/[^aeiou]o$/.test(lower) && !O_TAKES_S.has(lower)) return { result: matchCase(w, `${lower}es`), rule: 'consonant + -o takes -es' };
  return { result: matchCase(w, `${lower}s`), rule: 'add -s' };
}

export function singularize (word) {
  const w = String(word).trim();
  const lower = w.toLowerCase();
  if (!lower) return { result: w, rule: 'empty' };
  if (UNCHANGING.has(lower)) return { result: w, rule: 'unchanging' };

  const back = Object.entries(IRREGULAR).find(([, plural]) => plural === lower);
  if (back) return { result: matchCase(w, back[0]), rule: 'irregular' };
  if (IRREGULAR[lower]) return { result: w, rule: 'already singular' };
  if (!/s$/.test(lower)) return { result: w, rule: 'already singular' };

  if (/ies$/.test(lower) && lower.length > 4) return { result: matchCase(w, `${lower.slice(0, -3)}y`), rule: '-ies becomes -y' };
  if (/ves$/.test(lower)) {
    const stem = lower.slice(0, -3);
    /* knives -> knife, leaves -> leaf. Every -fe word has a stem ending in i
       (kni-, li-, wi-); the -f words end in anything else (lea-, wol-, thie-).
       An earlier version also treated -ea as -fe and turned leaves into leafe. */
    return { result: matchCase(w, /i$/.test(stem) ? `${stem}fe` : `${stem}f`), rule: '-ves becomes -f or -fe' };
  }
  /* quizzes -> quiz (the z was doubled), buzzes -> buzz (it was already double).
     Spelling cannot tell them apart, so the dictionary does. */
  if (/zzes$/.test(lower)) {
    const undoubled = lower.slice(0, -3);
    const kept = lower.slice(0, -2);
    if (isWord(undoubled) && !isWord(kept)) return { result: matchCase(w, undoubled), rule: 'doubled -z undoubles' };
    return { result: matchCase(w, kept), rule: '-es removed' };
  }
  if (/(sses|shes|ches|xes|zes)$/.test(lower)) return { result: matchCase(w, lower.slice(0, -2)), rule: '-es removed' };
  if (/oes$/.test(lower)) return { result: matchCase(w, lower.slice(0, -2)), rule: '-oes becomes -o' };
  if (/ss$/.test(lower)) return { result: w, rule: 'already singular' };

  /* "buses" and "houses" end the same way and singularise differently: one drops
     -es, the other drops -s. No spelling rule separates them, so the dictionary
     decides — whichever candidate is a real word wins, and if both or neither
     are, the commoner rule (drop -s) applies. */
  if (/es$/.test(lower)) {
    const dropEs = lower.slice(0, -2);
    const dropS = lower.slice(0, -1);
    const esIsWord = isWord(dropEs);
    const sIsWord = isWord(dropS);
    if (esIsWord && !sIsWord) return { result: matchCase(w, dropEs), rule: '-es removed' };
  }
  return { result: matchCase(w, lower.slice(0, -1)), rule: 'drop -s' };
}
