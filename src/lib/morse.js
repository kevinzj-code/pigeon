/* morse.js — the International Morse table, and its inverse.
 *
 * Kept apart from the two skills that use it so encode and decode cannot drift
 * out of step: the reverse map is DERIVED, never typed twice.
 *
 * Word gaps are written as a forward slash rather than the formal seven spaces.
 * Runs of spaces do not survive being pasted into a chat window, and a message
 * whose word breaks silently vanish is worse than one that departs from the
 * printed convention.
 */

export const MORSE = {
  'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.', 'G': '--.',
  'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..', 'M': '--', 'N': '-.',
  'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.', 'S': '...', 'T': '-', 'U': '..-',
  'V': '...-', 'W': '.--', 'X': '-..-', 'Y': '-.--', 'Z': '--..', '0': '-----',
  '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....',
  '7': '--...', '8': '---..', '9': '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..',
  '\'': '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...',
  ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
  '"': '.-..-.', '$': '...-..-', '@': '.--.-.'
};

export const FROM_MORSE = Object.fromEntries(
  Object.entries(MORSE).map(([character, code]) => [code, character])
);
