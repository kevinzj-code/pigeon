/* no-skill-set.mjs — §7.4 source 3: "Hand-written no-skill and distractor
 * sets. These cannot be synthesized well; they need a human deciding 'this
 * should not call anything.'"
 *
 * These are the messages Pigeon must DECLINE to route — writing, summarising,
 * translating, explaining, brainstorming, emotional support. §1 is explicit
 * that those are the majority of what people ask AI to do and that Pigeon does
 * not pretend a function covers them. This list is the executable form of that
 * paragraph.
 *
 * Several are adversarial on purpose: they contain words that appear all over
 * the registry ("day", "birthday", "convert", "how many") in sentences where
 * no skill is wanted. Those are the ones that actually set the threshold.
 *
 * The second block was added when the registry went from 100 skills to 301.
 * More skills means more vocabulary in the index, which means more ordinary
 * English that now collides with something — "my streak of bad luck", "the
 * colour palette in that film", "he is in his prime". Every one of those borrows
 * a word from a skill added in that batch, which is exactly where a widened
 * registry starts answering questions nobody asked. */

export const NO_SKILL_MESSAGES = [
  'write me a poem about the sea',
  'summarise this email for me',
  'i had a really rough day today',
  'explain how a diesel engine works',
  'what should i name my cat',
  'translate good morning into portuguese',
  'brainstorm ideas for a birthday party',
  'help me word this apology to my landlord',
  'why do cats knead blankets',
  'what do you think of this opening paragraph',
  'give me a metaphor for burnout',
  'i keep procrastinating and i do not know why',
  'rewrite this so it sounds less formal',
  'tell me about the fall of constantinople',
  'is it worth learning rust in 2026',
  'my code throws a null pointer, any ideas',
  'what is the difference between affect and effect',
  'suggest a name for a bakery',
  'describe the smell of rain on hot pavement',
  'convert me into a morning person',
  'how many people does it take to change a lightbulb',
  'what a day it has been',
  'talk me through a breathing exercise',
  'draft a thank you note to my team',
  'what are some good podcasts about history',

  // ── added when the registry grew from 100 skills to 301 ──────────────────
  'my streak of bad luck finally ended',
  'the colour palette in that film was gorgeous',
  'i need to compress my schedule this week',
  'hash browns or fried, which is better',
  'she has a real gift for languages',
  'the sentiment in the room was tense',
  'shuffle along, nothing to see here',
  'i want to pick up the pace at work',
  'that regex course was a waste of money',
  'my rota at work is a nightmare',
  'she got a first in her degree',
  'he is in his prime right now',
  'the whole project is an anagram of chaos',
  'i keep a list of things i am grateful for',
  'the morse code scene in that film was inaccurate',
  'my bank keeps sending me letters about nothing',
  'is a table of contents even necessary these days',
  'i cannot spell to save my life',
  'the timezone difference is killing our team',
  'what a difference a year makes',
  'my password manager keeps logging me out',
  'that airport was chaos yesterday',
  'chemistry was never my strong subject',
  'the interest rate news is depressing',
  'i should really schedule more downtime',

  // ── added 2026-09-08: the second fifty, so a leak count can be read ─────
  // Same shape as the first fifty: a skill's own vocabulary used in an
  // ordinary sense (split, average, outlier, sort, scale, convert, discount,
  // tip, tax, interest, root, factor, ratio, calendar, streak, dice, outline,
  // headings, hash, translation, perimeter, binary, url, json…) plus writing,
  // opinion, advice and general knowledge. Fifty messages move ±2 by chance;
  // a hundred is the smallest set on which a two-leak change means something.
  'we need to split up before this gets worse',
  'my average day starts with coffee and regret',
  'he is a real outlier in that family',
  'she has her priorities sorted',
  'that film does not scale well to a small screen',
  'i am trying to convert my brother to jazz',
  'the discount store on the corner closed down',
  'the tip of the iceberg, honestly',
  'tax season always makes me anxious',
  'our interest in the project has faded',
  'the root of the problem is trust',
  'she factored in the weather and cancelled',
  'the ratio of talk to action here is grim',
  'the whole summer vanished before i noticed',
  'my calendar is a wall of blue',
  'the countdown to the holidays has begun in my head',
  'keep the streak alive, whatever it takes',
  'it was a coin toss who would get the job',
  'the dice were loaded from the start',
  'that outline she gave in the meeting was thin',
  'the headings in that report told the whole story',
  'lorem ipsum is what my brain feels like today',
  'this password policy is driving everyone mad',
  'the pattern here is obvious, he never listens',
  'the table by the window is always taken',
  'the markup on those drinks is criminal',
  'wrap it up, we are out of time',
  'that speech was a word salad',
  'the two sisters could not be more different',
  'he made a hash of the presentation',
  'his joke did not survive the retelling',
  'quadratic is a word i have not heard since school',
  'we walked the perimeter of the park twice',
  'the business days drag when the boss is around',
  'binary thinking is what got us into this',
  'my morse code is rusty',
  'the url is broken and nobody cares',
  'she is a first-rate mechanic',
  'why is json so much nicer than xml',
  'compose a haiku about a broken umbrella',
  'what happened at the battle of hastings',
  'give me feedback on my cover letter',
  'settle this: pineapple on pizza, yes or no',
  'sketch me an itinerary for three days in kyoto',
  'what is the plot of the odyssey in a nutshell',
  'cheer me up, it has been a long week',
  'recommend a novel for a long flight',
  'explain the offside rule like i am five',
  'how do i tell my flatmate the kitchen is a mess',
  'what makes sourdough rise'
];
