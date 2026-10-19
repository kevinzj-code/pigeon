/* holdout.mjs — §8's holdout, in the only form this build can honestly have.
 *
 * §7.5 asks for "10% holdout, stratified by slice and category, never used in
 * training or threshold tuning". There is no adapter and no training set here,
 * but the ROUTER is tuned, and tuning it on the same examples that built its
 * index is how you get a number that means nothing.
 *
 * So these are phrasings that appear in NO skill's examples[]. They are how
 * people actually ask — abbreviated, conversational, with the data inline.
 * If you add one of these to a skill's examples, delete it from here.
 *
 * ── the split, and why it exists ─────────────────────────────────────────────
 * There is one phrasing for every built skill. There was not always: the file
 * held 101 of them while the registry grew to 301, so recall was being measured
 * on the original third of the corpus while the other two thirds acted as
 * interference in that number and were never themselves tested. Every skill has
 * one now, and a skill added without one should be treated as untested.
 *
 * The set is split in two because §7.5 asks for a holdout "never used in
 * threshold tuning" and a single array cannot be both:
 *
 *   HOLDOUT_TUNE   — what sweep.mjs may optimise the router constants against.
 *   HOLDOUT_GRADE  — what gate.mjs grades. No tuning script may import it.
 *
 * Split by alternating within each category, so both halves cover the whole
 * registry rather than one of them inheriting all the date skills. Grading on
 * the set the constants were fitted to is how a router scores well on paper and
 * badly in a window. */

export const HOLDOUT_TUNE = [
  // conversion
  ['3 miles in metres', 'convertLength'],
  ['220 fahrenheit as celsius', 'convertTemperature'],
  ['750 MB in GiB', 'convertDataSize'],
  ['how many radians is 45 deg', 'convertAngle'],
  ['write 200 in base 7', 'convertBase'],
  ['turn CDXLIV into arabic digits', 'convertRomanNumeral'],
  ['how do you write 305 on a cheque', 'numberToWords'],

  // data
  ['read this csv into columns', 'parseCsv'],
  ['order the table by price descending', 'sortRows'],
  ['render those rows as a markdown table', 'toMarkdownTable'],
  ['tidy this json so it is readable', 'formatJson'],
  ['assemble a query string for page=2 and sort=asc', 'buildQueryString'],
  ['turn this nested object into dot paths', 'flattenJson'],
  ['totals per department from these rows', 'groupBy'],
  ['read this md table as data', 'parseMarkdownTable'],
  ['cross-tab sales by month and product', 'pivotRows'],
  ['put these json keys in order', 'sortObjectKeys'],
  ['expand these dotted keys back into objects', 'unflattenJson'],

  // dates
  ['how many days between 12 july 2026 and christmas', 'daysBetween'],
  ['how long until 25 december', 'countdownTo'],
  ['when is the next thursday', 'nextWeekday'],
  ['born 1985-03-12, how old are they now', 'ageFromDate'],
  ['9am in berlin is what time in tokyo on 2026-05-05', 'convertTimezone'],
  ['what date is in a fortnight', 'parseRelativeDate'],
  ['how much time has passed since 2026-08-20', 'timeAgo'],
  ['express 7500 seconds as hours and minutes', 'durationToText'],
  ['three working days on from 2026-11-02', 'addBusinessDays'],
  ['which numbered day of 2026 is 1 august', 'dayOfYear'],
  ['does 2100 have a leap day', 'isLeapYear'],
  ['epoch value for 2027-01-01 midnight', 'isoToUnix'],
  ['clock times right now in Paris Delhi and Chicago', 'listTimezoneOffsets'],
  ['turn 1700000000 into a readable date', 'unixToIso'],

  // decisions
  ['score these three options against my criteria', 'weightedDecisionMatrix'],
  ['average payout if I win 500 a fifth of the time', 'expectedValue'],

  // design
  ['resize 1600x900 to fit 400 wide', 'scaleDimensions'],
  ['colour on the other side of the wheel from #3366FF', 'complementaryColor'],
  ['give me hsl for #1E90FF', 'convertColor'],
  ['give me tints and shades of #556B2F', 'generatePalette'],
  ['halfway colour between #FF0000 and #FFFF00', 'mixColors'],
  ['2.25rem in px please', 'remToPx'],

  // developer
  ['which version wins, 3.0.0-rc.1 or 3.0.0', 'compareSemver'],
  ['make c++ safe to drop into a pattern', 'escapeRegex'],
  ['show me the payload of this bearer token', 'jwtDecode'],
  ['split 4.2.1+build9 into parts', 'parseSemver'],
  ['code point for the pound sign', 'unicodeLookup'],

  // encoding
  ['make this text safe for a query string', 'urlEncode'],
  ['un-base64 this blob', 'base64Decode'],
  ['these 1s and 0s spell what', 'binaryDecode'],
  ['move every letter on by 5', 'caesarShift'],
  ['unpack this compressed blob', 'decompressText'],
  ['random 12 char token please', 'generateRandomString'],
  ['sha512 digest of this phrase', 'hashText'],
  ['give me the hex bytes for this word', 'hexEncode'],
  ['put my name into dots and dashes', 'morseEncode'],

  // everyday
  ['dinner 132.40, 18% tip, 5 people', 'splitBill'],
  ['how many grams is a cup of caster sugar', 'convertCookingMeasure'],
  ['which pack size is better value', 'comparePrices'],
  ['whats my basket come to with postage', 'shippingTotal'],

  // files
  ['how big is 3400000 bytes in readable units', 'fileSizeHuman'],
  ['how many words and bytes in this', 'textFileStats'],

  // finance
  ['reduce 249 by 30%', 'applyDiscount'],
  ['add 20 percent vat onto 480', 'applyTax'],
  ['what does 2500 become after 8 years at 3.5', 'compoundInterest'],
  ['costs me 8, sells for 14, whats the margin', 'markupMargin'],
  ['how long till I have 3000 putting 120 aside monthly', 'savingsGoal'],

  // games
  ['do these two phrases use the same letters', 'checkAnagram'],
  ['ask the 8 ball if I should go', 'magicEightBall'],
  ['rearrange the letters of tarps', 'solveAnagram'],

  // generation
  ['throw a couple of dice for me, seed 9', 'rollDice'],
  ['pick a number from 1 to 20, seed 9', 'randomNumber'],
  ['turn my packing list into tick boxes', 'generateChecklist'],
  ['need three paragraphs of dummy copy', 'loremIpsum'],

  // geometry
  ['how much carpet for a 4.5 by 3.2 m room', 'areaOf'],
  ['great circle miles between these coordinates', 'haversineDistance'],
  ['ladder length if the wall is 8 and the base is 6', 'pythagorean'],

  // health
  ['body mass index at 1.8m and 82 kilos', 'bmiCalculate'],
  ['how long would a half marathon take at 6 min km', 'paceCalculate'],
  ['kilometre splits to break 45 minutes over 10k', 'splitTimes'],

  // learning
  ['score this test paper against the correct responses', 'gradeQuiz'],
  ['reorder my deck for revision', 'flashcardShuffle'],
  ['I am on 65 with 40% left, what do I need for a 70', 'gradeNeeded'],
  ['set revision dates starting today', 'spacedRepetitionSchedule'],

  // lists
  ['strip the repeats out of this list', 'dedupeList'],
  ['tally how many of each appear', 'countItems'],
  ['deal these 12 names into groups of four', 'chunkList'],
  ['squash this nested array flat', 'flattenList'],
  ['draw partners for these six, seed 3', 'pairUp'],
  ['jumble this playlist up, seed 4', 'shuffleList'],
  ['pair each name with its score', 'zipLists'],

  // math
  ['whats 340 divided by 8 plus 12', 'evaluateExpression'],
  ['price went 25 to 31, whats the increase', 'percentChange'],
  ['round 88.4567 to 3 dp', 'roundTo'],
  ['total these figures for me: 45 62 18 9', 'sum'],
  ['read 4.5k as a plain number', 'parseNumber'],
  ['write 45.5 as pounds sterling', 'formatCurrency'],
  ['share 750 between shares of 5 3 and 2', 'allocateProportionally'],
  ['give me fibonacci up to the 12th', 'fibonacci'],
  ['highest number dividing 84 and 126', 'gcd'],
  ['smallest number both 8 and 14 go into', 'lcm'],
  ['if 5 maps to 8, what maps to 40', 'ratioSolve'],

  // organising
  ['divide my 2800 salary into budget categories', 'budgetSplit'],
  ['what percentage of days did I manage it', 'habitCompletionRate'],
  ['fair rota for four flatmates and three chores', 'rotateAssignments'],
  ['lay my tasks out from 9am with 10 min gaps', 'timeBlockSchedule'],

  // reference
  ['what is the capital of Portugal', 'countryLookup'],
  ['which airport is CDG', 'airportCodeLookup'],
  ['tell me about magnesium', 'periodicTableLookup'],
  ['offset from utc in Auckland', 'timezoneLookup'],

  // statistics
  ['mean and spread of 12 19 22 8 31', 'describeNumbers'],
  ['do these two columns move together', 'correlation'],
  ['anything way off in this set', 'findOutliers'],
  ['best fit line for this scatter', 'linearRegression'],
  ['p95 of these latencies', 'percentile'],
  ['order these from best to worst', 'rankValues'],

  // text
  ['how many words in this sentence right here', 'countWords'],
  ['make "Annual Report 2026" a url slug', 'slugify'],
  ['swap every instance of teh for the', 'replaceText'],
  ['list the links in that message', 'extractUrls'],
  ['how many characters is this tweet', 'countCharacters'],
  ['how many lines does this file have', 'countLines'],
  ['break this sentence into individual words', 'tokenizeWords'],
  ['strip the filler words out of this query', 'removeStopWords'],
  ['how long would this take someone to read', 'readingTime'],
  ['strip the indentation off every line', 'trimLines'],
  ['put these lines in alphabetical order', 'sortLines'],
  ['join these lines into one comma separated line', 'joinLines'],
  ['what changed between the old and new version', 'diffText'],
  ['guess the language of this snippet', 'detectLanguage'],
  ['make these angle brackets safe for html', 'escapeHtml'],
  ['list every price mentioned here', 'extractCurrencyAmounts'],
  ['list the tags used in this tweet', 'extractHashtags'],
  ['grab the bullets from this', 'extractListItems'],
  ['split this into two word runs', 'extractNgrams'],
  ['what times are mentioned', 'extractTimes'],
  ['which of these entries are basically the same', 'findNearDuplicates'],
  ['anything rude in this message', 'flagProfanity'],
  ['does this read as happy or unhappy', 'lexiconSentiment'],
  ['stick numbers on each line', 'numberLines'],
  ['strip the smileys out', 'removeEmoji'],
  ['how much vocabulary do these share', 'similarityJaccard'],
  ['cut these words back to their roots', 'stemWords'],
  ['drop the formatting marks from this', 'stripMarkdown'],
  ['flatten the accents in this name', 'toAscii'],

  // validation
  ['is this address written correctly: jo@example', 'validateEmail'],
  ['this config is being rejected, what is malformed', 'validateJson'],
  ['tidy this number into international format', 'formatPhoneNumber'],
  ['is #GG0011 a real colour code', 'validateHexColor'],
  ['is 10.0.0.256 usable', 'validateIpAddress'],
  ['does this payload conform to my schema', 'validateJsonSchema'],
  ['is +44 7700 900 the right shape', 'validatePhoneNumber'],

  // writing
  ['build an APA reference from these details', 'formatCitation'],
  ['how long is each paragraph in my draft', 'paragraphStats'],
  ['capitalise this headline properly', 'checkTitleCase'],
  ['am I overusing any words here', 'findRepeatedWords'],
  ['render this md as html', 'markdownToHtml'],
  ['plural of cactus', 'pluralize'],
  ['any misspellings in this paragraph', 'spellCheck'],
  /* Added when these skills were built. Alternated with the grading half below,
     the same way the rest of the file is split. */
  ['put my bin collection dates on a calendar, first thursday, ten of them', 'expandRecurrence'],
  ['narrow my guesses: _o_se, has an r, no t', 'wordleFilter'],
  ['tell me about the Antikythera mechanism', 'webAnswer']];

/* Graded, never tuned against. gate.mjs is the only consumer. */
export const HOLDOUT_GRADE = [
  // conversion
  ['convert 12 stone to kilograms', 'convertMass'],
  ['how much is 6 tablespoons in millilitres', 'convertVolume'],
  ['a 210 minute film runs for how long', 'convertTime'],
  ['3000 sq ft in square metres', 'convertArea'],
  ['my car does 45 mpg, whats that in litres per 100', 'convertFuelEconomy'],
  ['how many m/s is 90 kph', 'convertSpeed'],

  // data
  ['keep rows where status is open', 'filterRows'],
  ['total the revenue column', 'columnMath'],
  ['write these rows back out as csv', 'toCsv'],
  ['keep just the name and email columns', 'selectColumns'],
  ['whats changed between these two configs', 'diffJson'],
  ['pull settings.theme out of this document', 'getPath'],
  ['turn this .env content into an object', 'parseKeyValue'],
  ['what params are in this link', 'parseQueryString'],
  ['update config.timeout to 30 in this json', 'setPath'],
  ['turn the columns of this table into rows', 'transposeTable'],

  // dates
  ['whats the gap between 2026-01-01 and 2026-06-30', 'daysBetween'],
  ['push 2026-03-01 forward by 45 days', 'addDuration'],
  ['is 2026-07-04 a saturday', 'dayOfWeek'],
  ['read 4 march 2027 as an iso date', 'parseDate'],
  ['working days from 2026-02-02 to 2026-02-27', 'businessDaysBetween'],
  ['what is the date and time right now', 'currentTime'],
  ['rewrite 2026-11-14 as DD/MM/YYYY', 'formatDate'],
  ['turn 2h 15m into seconds', 'parseDuration'],
  ['every date from 2026-03-01 up to 2026-03-07', 'dateRangeList'],
  ['how long is april 2027', 'daysInMonth'],
  ['is new years day 2027 a saturday or sunday', 'isWeekend'],
  ['which week number does 2026-06-15 fall in', 'isoWeek'],
  ['collapse these date ranges into as few as possible', 'mergeIntervals'],

  // decisions
  ['at what point does the annual plan pay off', 'breakEvenComparison'],
  ['help me weigh this up, 3 for and 2 against', 'prosConsScore'],

  // design
  ['simplify 2560 by 1440 to a ratio', 'aspectRatio'],
  ['will white text pass on #767676', 'contrastRatio'],
  ['shade #FFAA00 down 30 percent', 'darkenColor'],
  ['tint #223344 up by 15 percent', 'lightenColor'],
  ['what fraction of a rem is 12px', 'pxToRem'],

  // developer
  ['put 30 2 * * 1 into plain english', 'cronToText'],
  ['what is a 429 telling me', 'httpStatusLookup'],
  ['content type to serve a .svg with', 'mimeTypeLookup'],
  ['run this pattern over my sample and show hits', 'testRegex'],

  // encoding
  ['what does caf%C3%A9 decode to', 'urlDecode'],
  ['b64 this string for me', 'base64Encode'],
  ['show me the bits for the letter Z', 'binaryEncode'],
  ['squash this text down', 'compressText'],
  ['four random words as a password', 'generatePassphrase'],
  ['need a fresh guid', 'generateUuid'],
  ['these hex bytes say what', 'hexDecode'],
  ['what is -.-. --.- in letters', 'morseDecode'],
  ['apply the 13 letter rotation to this', 'rot13'],

  // everyday
  ['triple this recipe: 1 cup rice, 2 eggs', 'scaleRecipe'],
  ['what does that work out to per litre', 'unitPrice'],
  ['cost to drive 150 km if I use 9 litres per 100 and fuel is 1.80', 'fuelCostForTrip'],
  ['extra 15 off an already 30 off item', 'stackDiscounts'],

  // files
  ['whats a .webp file', 'fileExtensionInfo'],

  // finance
  ['change 400 usd to gbp at 0.79', 'convertCurrencyFixed'],
  ['monthly repayment on 12000 over 4 years at 6%', 'amortizeLoan'],
  ['22 an hour, whats that yearly', 'hourlyToSalary'],
  ['52000 a year works out at what per hour', 'salaryToHourly'],
  ['non-compounding interest on 800 at 6% for 18 months', 'simpleInterest'],

  // games
  ['does level read the same both ways', 'checkPalindrome'],
  ['tile value of the word zebra', 'scrabbleScore'],
  ['which words fit from these seven tiles', 'wordsFromLetters'],

  // generation
  ['heads or tails, seed 5', 'flipCoin'],
  ['print me a month view of december 2026', 'generateCalendarGrid'],
  ['carve 2pm to 5pm into four sessions', 'generateSchedule'],

  // geometry
  ['how far from (1,2) to (7,10)', 'distanceBetweenPoints'],
  ['how much fencing round a 12 by 9 plot', 'perimeterOf'],
  ['litres in a cylinder 30cm across and 50 tall', 'volumeOf'],

  // health
  ['my measured max is 172, split it into zones', 'heartRateZones'],
  ['what time should I turn in for a 5:45 alarm', 'sleepCycleTimes'],

  // learning
  ['did I get any of these lines wrong', 'checkArithmeticSteps'],
  ['grade point average from these modules', 'gpaCalculate'],
  ['plan out 420 pages before the end of the month', 'readingScheduleFromPages'],

  // lists
  ['put these items in natural order', 'sortList'],
  ['give me every number from 5 to 40 in fives', 'rangeList'],
  ['what is missing from the second list', 'differenceLists'],
  ['which entries appear on both lists', 'intersectLists'],
  ['draw a winner from these entrants, seed 9', 'pickRandom'],
  ['merge both lists without repeats', 'unionLists'],

  // math
  ['work out 12% of 6500', 'percentOf'],
  ['what proportion is 18 of 24, in percent', 'whatPercent'],
  ['divide 475 between 6 of us', 'splitEvenly'],
  ['multiply 7 by 9 by 3 together', 'product'],
  ['write 9876543 with commas in it', 'formatNumber'],
  ['what share of the total is each of 12 30 58', 'percentageDistribution'],
  ['multiply 1 through 8 together', 'factorial'],
  ['lowest terms for 45/60', 'fractionSimplify'],
  ['does 221 have any divisors', 'isPrime'],
  ['which primes multiply to make 990', 'primeFactors'],
  ['add the right suffix to 42', 'toOrdinal'],

  // organising
  ['overlap in working hours for these offices', 'findCommonMeetingHours'],
  ['sort my jobs by what matters most', 'prioritizeTasks'],
  ['longest run of consecutive days in this log', 'streakCount'],

  // reference
  ['what does SEK mean', 'currencyLookup'],
  ['what does the code sv stand for', 'languageCodeLookup'],
  ['where does +351 dial to', 'phoneRegionLookup'],
  ['which state has the abbreviation OR', 'usStateLookup'],

  // statistics
  ['average these marks where the exam counts triple', 'weightedAverage'],
  ['add these up as I go', 'cumulativeSum'],
  ['bucket these values into six ranges', 'histogramBins'],
  ['smooth this over a 5 point window', 'movingAverage'],
  ['give me the iqr of this sample', 'quartiles'],
  ['standardise this set', 'zScores'],

  // text
  ['which words repeat most in that paragraph', 'wordFrequency'],
  ['change my heading to title case', 'convertCase'],
  ['grab the email addresses from this signature', 'extractEmails'],
  ['what numbers appear in this invoice line', 'extractNumbers'],
  ['how many sentences in that paragraph', 'countSentences'],
  ['how often does the word error appear in the log', 'countOccurrences'],
  ['split that paragraph into separate sentences', 'tokenizeSentences'],
  ['what reading age is this passage written at', 'readingLevel'],
  ['tidy up the spacing in this pasted text', 'normalizeWhitespace'],
  ['get rid of repeated lines in this list', 'removeDuplicateLines'],
  ['shorten this to fit 100 characters', 'truncateText'],
  ['split that comma list onto separate lines', 'splitLines'],
  ['typical word size in this paragraph', 'averageWordLength'],
  ['am I saying the same phrase twice', 'detectRepetition'],
  ['lift the fenced snippets out of this doc', 'extractCodeBlocks'],
  ['which dates are mentioned in this note', 'extractDates'],
  ['pull out any ip addresses from these lines', 'extractIpAddresses'],
  ['which handles are tagged here', 'extractMentions'],
  ['any numbers to call in this signature', 'extractPhoneNumbers'],
  ['biggest word in this passage', 'findLongestWord'],
  ['scan this for anything personal', 'flagPii'],
  ['what stands out in this document', 'keywordsTfidf'],
  ['hide the private bits in this text', 'maskSensitive'],
  ['right justify this in 10 columns', 'padText'],
  ['write this backwards', 'reverseText'],
  ['how many edits between these two spellings', 'similarityLevenshtein'],
  ['just the readable text from this markup', 'stripHtml'],
  ['how many beats in the word incredible', 'syllableCount'],
  ['break these lines at 40 wide', 'wrapText'],

  // validation
  ['is https://example.com/x a proper link', 'validateUrl'],
  ['does 31 september exist', 'validateDate'],
  ['how good is hunter2 as a password', 'passwordStrength'],
  ['does this account number check out', 'validateIban'],
  ['does this book number check digit work', 'validateIsbn'],
  ['does this card number pass the checksum', 'validateLuhn'],
  ['is this string a proper uuid', 'validateUuid'],

  // writing
  ['give me the outline of this markdown doc', 'extractHeadings'],
  ['am I close to my 1500 word target', 'countWordTargets'],
  ['which sentences run on too long', 'findLongSentences'],
  ['index the headings in this doc', 'generateTableOfContents'],
  ['turn my indented notes into markdown', 'outlineToMarkdown'],
  ['singular form of criteria', 'singularize'],
  ['what shade of blue is #4682B4 nearest to', 'nearestNamedColor'],
  ['where does 2x squared minus 7x plus 3 cross zero', 'solveQuadratic'],
  ['find me some pages on the Voyager probes', 'webSearch']];

/* Everything, for consumers that grade nothing and tune nothing —
   plannerbench.mjs runs the model over the whole set. */
export const HOLDOUT = [...HOLDOUT_TUNE, ...HOLDOUT_GRADE];
