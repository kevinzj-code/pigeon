/* _blocked.js — skills the index lists that CANNOT be Pigeon skills.
 *
 * §21 of the skill index is titled "Client-side files & images (browser/Tauri
 * APIs only)", and three of its entries need a canvas to do their job. §3.3
 * says skills are pure: no storage, no DOM, no side effects. Those two rules
 * are in direct conflict, and the conflict is not resolvable by trying harder.
 *
 * So these are registered `unbuilt: true` with a `blockedBy` reason, which is a
 * different claim from the Extended stubs next door. An Extended stub means
 * "not written yet". These mean "not writable as a skill" — the work would have
 * to happen in the action layer §3.3 describes, with its own confirmation UI,
 * not behind a router that can select it silently.
 *
 * They are here rather than absent so the Skills screen can say so. Leaving
 * them out entirely would look like an oversight; leaving them in as ordinary
 * stubs would suggest they are coming.
 */

const blocked = (name, description, blockedBy) => ({
  name,
  description,
  category: 'files',
  tier: 'standard',
  unbuilt: true,
  blockedBy,
  needsNetwork: false,
  dataAsOf: null,
  labels: []
});

export default [
  blocked('imageDimensions', 'Read the width, height and aspect ratio of an image.',
    'needs to decode an image, which requires a canvas or an image element — §3.3 says skills touch no DOM'),
  blocked('imageResize', 'Resize an image, keeping its proportions.',
    'needs a canvas to re-encode pixels, and returns a blob — a side effect §3.3 excludes'),
  blocked('imageToBase64', 'Turn an image file into a data URL.',
    'needs to read a File, which is I/O rather than computation over a supplied value')
];
