/* paths.js — dot-and-bracket paths into plain JSON values.
 *
 * One parser shared by getPath, setPath and unflattenJson, so the three of them
 * can never disagree about what `items[0].name` means. Accepts both `a.0.b` and
 * `a[0].b` for the same path, and `a["b.c"]` for a key that contains the
 * separator — without the quoted form there is no way to reach such a key at
 * all, and JSON keys are allowed to contain anything.
 */

export const isIndex = (p) => /^(0|[1-9]\d*)$/.test(p);

/* Returns an array of segments, or null if the path is malformed. Null rather
   than a throw because every caller wants to turn it into an INVALID_INPUT
   with its own wording. */
export function parsePath (path, separator = '.') {
  if (typeof path !== 'string' || !path.length) return null;
  if (separator === '[' || separator === ']') return null;
  const parts = [];
  let buf = '';
  let started = false;
  let i = 0;
  while (i < path.length) {
    const ch = path[i];

    if (ch === separator) {
      /* An empty segment is always a mistake: `a..b`, a leading `.`, or a
         trailing one. Silently dropping it would resolve two different paths
         to the same place. */
      if (!started) return null;
      parts.push(buf); buf = ''; started = false;
      i++;
      if (i === path.length) return null;
      continue;
    }

    if (ch === '[') {
      if (started) { parts.push(buf); buf = ''; started = false; }
      i++;
      let seg = '';
      const quote = path[i] === '"' || path[i] === "'" ? path[i] : null;
      if (quote) {
        i++;
        while (i < path.length && path[i] !== quote) {
          if (path[i] === '\\' && i + 1 < path.length) i++;
          seg += path[i]; i++;
        }
        if (path[i] !== quote) return null;
        i++;
        if (path[i] !== ']') return null;
      } else {
        while (i < path.length && path[i] !== ']') { seg += path[i]; i++; }
        if (path[i] !== ']') return null;
        if (!seg.length) return null;
      }
      i++;
      parts.push(seg);
      if (i < path.length) {
        if (path[i] === separator) { i++; if (i === path.length) return null; }
        else if (path[i] !== '[') return null;
      }
      continue;
    }

    if (ch === ']') return null;
    buf += ch; started = true; i++;
  }
  if (started) parts.push(buf);
  return parts.length ? parts : null;
}

/* Render segments back into a path string. Used in error messages, so it has
   to produce something that parsePath would accept again. */
export function formatPath (parts, separator = '.') {
  let out = '';
  for (const p of parts) {
    if (isIndex(p)) out += `[${p}]`;
    else if (p === '' || p.includes(separator) || p.includes('[') || p.includes(']')) {
      out += `["${p.replace(/(["\\])/g, '\\$1')}"]`;
    } else out += (out ? separator : '') + p;
  }
  return out;
}

/* Read. Reports WHERE it gave up, because "not found" on a six-segment path is
   not an answer anyone can act on. */
export function getIn (root, parts) {
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    const soFar = formatPath(parts.slice(0, i));
    if (cur === null || typeof cur !== 'object') {
      return { found: false, reason: 'not-a-container', at: soFar, key };
    }
    if (Array.isArray(cur)) {
      if (!isIndex(key)) return { found: false, reason: 'name-into-list', at: soFar, key };
      if (Number(key) >= cur.length) {
        return { found: false, reason: 'out-of-range', at: soFar, key, length: cur.length };
      }
      cur = cur[Number(key)];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, key)) {
        return { found: false, reason: 'missing-key', at: soFar, key, siblings: Object.keys(cur) };
      }
      cur = cur[key];
    }
  }
  return { found: true, value: cur };
}

const MAX_INDEX = 10000;

export class PathError extends Error {}

/* Write, without mutating the input. Only the containers along the path are
   copied; everything off the path is shared with the original, which keeps a
   deep set on a large document cheap.
   A missing container is created as a list or an object depending on whether
   the NEXT segment is an integer — `a.0` builds a list, `a.x` builds an object. */
export function setIn (root, parts, newValue) {
  const set = (node, depth) => {
    const key = parts[depth];
    const last = depth === parts.length - 1;
    const wantIndex = isIndex(key);

    let container;
    if (node === null || node === undefined) container = wantIndex ? [] : {};
    else if (Array.isArray(node)) {
      if (!wantIndex) {
        throw new PathError(`there is a list at ${formatPath(parts.slice(0, depth)) || 'the top level'}, and "${key}" is a name rather than a position`);
      }
      container = node.slice();
    } else if (typeof node === 'object') container = { ...node };
    else {
      throw new PathError(`${formatPath(parts.slice(0, depth))} already holds ${JSON.stringify(node)}, which cannot contain "${key}"`);
    }

    const asKey = Array.isArray(container) ? Number(key) : key;
    /* Index 5 of a 2-item list is filled up to 5; index 4,000,000,000 is not a
       list anyone meant, and filling it is a process that dies growing an
       array. The cap is generous for real data and names itself. */
    if (Array.isArray(container) && asKey > MAX_INDEX) {
      throw new PathError(`index ${key} is past ${MAX_INDEX.toLocaleString('en-GB')}, the most this will fill`);
    }
    const inner = last ? newValue : set(container[asKey], depth + 1);
    if (Array.isArray(container)) {
      /* Setting index 5 of a 2-item list has to fill 2, 3 and 4 with something.
         null rather than a hole, because JSON has no holes and a sparse array
         would serialise as nulls anyway — better to be honest about it here. */
      while (container.length < asKey) container.push(null);
      container[asKey] = inner;
    } else container[key] = inner;
    return container;
  };
  return set(root, 0);
}

/* Every leaf in a document, as path -> value. diffJson compares two of these;
   an interior node is not a leaf, so an object that gained a key shows up as
   added leaves rather than as one opaque "this branch changed". */
export function leafPaths (value, separator = '.') {
  const out = new Map();
  const walk = (v, parts) => {
    const isArray = Array.isArray(v);
    if (v === null || typeof v !== 'object') { out.set(formatPath(parts, separator), v); return; }
    const entries = isArray ? v.map((x, i) => [String(i), x]) : Object.entries(v);
    if (!entries.length) { out.set(formatPath(parts, separator), isArray ? [] : {}); return; }
    for (const [k, child] of entries) walk(child, [...parts, k]);
  };
  walk(value, []);
  out.delete('');
  return out;
}
