/* lexicons.js - the small word lists behind detectLanguage, lexiconSentiment
 * and flagProfanity.
 *
 * All three are lexicon skills in the sense the registry means: they match
 * words against a list and report what matched. None of them understands the
 * text. A sentiment score here is a count of words that usually carry a
 * sentiment, which is not the same thing as how the writer felt, and the skills
 * say so in their replies rather than leaving it implied.
 */

/* The commonest function words in each language. Function words are the right
   signal for this: they are short, extremely frequent, and mostly distinct
   between languages, so a few dozen of them identify a language from a sentence
   or two. Content words would not - half the nouns in English are French. */
export const LANGUAGE_STOPWORDS = {
  English: 'the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me'.split(' '),
  French: 'le de un etre et a il avoir ne je son que se qui ce dans en du elle au de ce le pour pas que vous par sur faire plus dire me on mon lui nous comme mais pouvoir avec tout'.split(' '),
  German: 'der die und in den von zu das mit sich des auf fur ist im dem nicht ein eine als auch es an werden aus er hat dass sie nach wird bei einer um am sind noch wie einem uber einen so zum haben'.split(' '),
  Spanish: 'de la que el en y a los se del las un por con no una su para es al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde'.split(' '),
  Italian: 'di che e il la un a per non in una sono mi si ho ma ha le si da come piu io questo lo ci qui hai se me tu perche cosa sei voglio niente bene devo'.split(' '),
  Portuguese: 'de a o que e do da em um para com nao uma os no se na por mais as dos como mas ao ele das a seu sua ou quando muito nos ja eu tambem so pelo pela'.split(' '),
  Dutch: 'de en van ik te dat die in een hij het niet zijn is was op aan met als voor had er maar om hem dan zou of wat mijn men dit zo door over ze zich bij ook tot je mij'.split(' ')
};

/* Characters that only appear in some of these languages. Used as a tiebreak,
   not as proof - English borrows "cafe" and "naive" with their accents intact. */
export const LANGUAGE_HINTS = {
  German: /[ßäöü]/i,
  Spanish: /[ñ¿¡]/i,
  French: /[çœèê]/i,
  Portuguese: /[ãõ]/i,
  Italian: /[àòù]/i
};

/* A short sentiment lexicon. Deliberately short: a long list invites the belief
   that the score means more than it does. Weights are -3 to +3. */
export const SENTIMENT = {
  excellent: 3, wonderful: 3, brilliant: 3, superb: 3, outstanding: 3, perfect: 3, love: 3, amazing: 3,
  great: 2, good: 2, happy: 2, pleased: 2, enjoy: 2, enjoyed: 2, glad: 2, better: 2, best: 3,
  nice: 1, fine: 1, useful: 1, helpful: 2, clear: 1, easy: 1, works: 1, worked: 1, thanks: 1, thank: 1,
  ok: 1, okay: 1, fast: 1, quick: 1, smooth: 1, recommend: 2, improved: 2, improvement: 1,
  bad: -2, poor: -2, awful: -3, terrible: -3, horrible: -3, hate: -3, worst: -3, useless: -3,
  broken: -2, broke: -2, fails: -2, failed: -2, fail: -2, bug: -1, bugs: -1, slow: -1, confusing: -2,
  difficult: -1, hard: -1, annoying: -2, frustrating: -2, frustrated: -2, disappointing: -2,
  disappointed: -2, wrong: -1, error: -1, errors: -1, crash: -2, crashes: -2, crashed: -2,
  unhappy: -2, angry: -2, worse: -2, problem: -1, problems: -1, issue: -1, issues: -1
};

export const NEGATIONS = new Set(['not', 'no', 'never', 'none', 'cannot', "can't", "won't", "didn't", "doesn't", "isn't", "wasn't", 'without', 'hardly', 'barely']);
export const INTENSIFIERS = { very: 1.5, really: 1.5, extremely: 2, incredibly: 2, so: 1.3, quite: 1.2, slightly: 0.5, somewhat: 0.6, a: 1 };

/* Mild by design. This exists so a skill can flag text for review, not so it
   can be a filter, and a long list of slurs in a source file is a liability
   rather than a feature. */
export const PROFANITY = 'damn damned bloody hell crap crappy bugger arse arsehole bastard bollocks git prat wanker piss pissed shit shitty fuck fucking fucked cunt twat dick dickhead prick tosser'.split(' ');
