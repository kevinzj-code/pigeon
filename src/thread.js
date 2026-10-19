/* thread.js — a conversation is a tree, and this is the shape of it.
 *
 * Editing a question or asking again adds a SIBLING rather than replacing what
 * was there. Nothing you said is destroyed by changing your mind: the old branch
 * stays, one ‹ › away, with everything that followed from it. Flat arrays are
 * what most chat apps store, and they are why editing a message in most chat
 * apps quietly deletes the rest of the conversation.
 *
 * What you see on screen is one path through the tree: start at `activeRootId`
 * and follow each turn's `activeChildId` down.
 *
 *   turn = { id, parentId, activeChildId, at, ...the turn itself }
 *   chat = { id, title, nodes: { [id]: turn }, activeRootId, … }
 *
 * No DOM here on purpose, so the test suite can exercise it — app.js cannot be
 * imported by the suite because it needs a document.
 */

export const chatNodes = (c) => (c.nodes = c.nodes || {});

/**
 * The visible conversation: one path from the root down.
 *
 * The `seen` guard is not paranoia. These trees are written to disk and could be
 * hand-edited or half-written; a cycle would spin here forever and hang the app
 * on load with no way back to fix it.
 */
export function pathOf (c) {
  const nodes = chatNodes(c);
  const out = [];
  const seen = new Set();
  let id = c.activeRootId;
  while (id && nodes[id] && !seen.has(id)) {
    seen.add(id);
    out.push(nodes[id]);
    id = nodes[id].activeChildId;
  }
  return out;
}

/**
 * Every version of this turn — the turns sharing its parent — oldest first.
 * Ordering by `at` keeps "1/2" meaning the first thing you asked and "2/2" the
 * second, which is the order a person remembers them in.
 */
/**
 * The question this conversation is waiting on an answer to, or null.
 *
 * It is the LAST turn on the path, and only if it still carries an `ask` — ask
 * anything else afterwards and the question is no longer the live one.
 *
 * This is derived rather than remembered on purpose. It used to be a separate
 * variable in the UI, which meant the bubble on screen came from the turn while
 * the behaviour came from the variable, and any navigation could set the two
 * disagreeing: walking versions, switching chat or lane, or simply relaunching
 * left a question standing that answering no longer did anything to. A value
 * read off the tree cannot drift from the tree, and it survives a relaunch
 * because turns are already saved.
 */
export function pendingAsk (c) {
  const path = pathOf(c);
  const last = path[path.length - 1];
  return last && last.ask ? last : null;
}

const byAt = (a, b) => (a.at || 0) - (b.at || 0);

/** Every turn's versions at once: parentId (null for a root) → its children,
 *  in the same order siblingsOf gives them. One pass over the nodes, so a
 *  paint that asks for every turn's siblings stops being turns × nodes. */
export function siblingIndex (c) {
  const index = new Map();
  for (const t of Object.values(chatNodes(c))) {
    const key = t.parentId ?? null;
    const list = index.get(key);
    if (list) list.push(t); else index.set(key, [t]);
  }
  for (const list of index.values()) list.sort(byAt);
  return index;
}

/** A turn's versions, oldest first. Pass `index` from siblingIndex to skip
 *  the scan; the caller owns keeping it current with the chat. */
export function siblingsOf (c, turn, index = null) {
  if (index) return index.get(turn.parentId ?? null) || [];
  return Object.values(chatNodes(c))
    .filter(t => (t.parentId ?? null) === (turn.parentId ?? null))
    .sort(byAt);
}

/** Attach a turn under `parentId` and make it the version on show. */
export function linkTurn (c, turn, parentId = null) {
  const nodes = chatNodes(c);
  turn.parentId = parentId ?? null;
  turn.activeChildId = null;
  nodes[turn.id] = turn;
  if (parentId && nodes[parentId]) nodes[parentId].activeChildId = turn.id;
  else c.activeRootId = turn.id;
  return turn;
}

/**
 * Move to the previous or next version of a turn. Returns the id switched to,
 * or null when there is nothing in that direction.
 *
 * The subtree under the version you land on comes back with it — its own answer,
 * and anything asked after it — because that is what it means for a branch to
 * still exist.
 */
export function switchTo (c, turnId, delta) {
  const nodes = chatNodes(c);
  const turn = nodes[turnId];
  if (!turn) return null;
  const sibs = siblingsOf(c, turn);
  const next = sibs[sibs.findIndex(t => t.id === turnId) + delta];
  if (!next) return null;
  if (turn.parentId && nodes[turn.parentId]) nodes[turn.parentId].activeChildId = next.id;
  else c.activeRootId = next.id;
  return next.id;
}

/**
 * Replace a turn in place, keeping its position in the tree.
 *
 * Used when an unanswered question is finally answered: to the reader it is
 * still that exchange, interrupted and then finished. Keeping the id keeps an
 * open plan panel open; keeping `activeChildId` is what stops the replacement
 * orphaning everything asked after it.
 */
export function replaceTurn (c, oldId, turn) {
  const nodes = chatNodes(c);
  const prev = nodes[oldId];
  if (!prev) return linkTurn(c, turn, null);
  turn.id = prev.id;
  turn.parentId = prev.parentId ?? null;
  turn.activeChildId = prev.activeChildId ?? null;
  turn.at = prev.at;
  nodes[turn.id] = turn;
  return turn;
}

/**
 * A chat saved before conversations could branch: a flat list, which is simply
 * one path with no siblings. Walk it, link each turn to the one before, and it
 * is a tree — which is why turns carried `id`, `parentId` and `at` from the
 * start, well before any of this existed.
 */
export function migrateChat (c, uid = () => Math.random().toString(36).slice(2, 10)) {
  if (!c || c.nodes || !Array.isArray(c.turns)) return c;
  const nodes = {};
  let prev = null;
  for (const t of c.turns) {
    t.id = t.id || uid();
    t.parentId = prev;
    t.activeChildId = null;
    t.at = t.at || c.createdAt || 0;
    if (prev && nodes[prev]) nodes[prev].activeChildId = t.id;
    nodes[t.id] = t;
    prev = t.id;
  }
  c.activeRootId = c.turns[0]?.id ?? null;
  c.nodes = nodes;
  delete c.turns;
  return c;
}
