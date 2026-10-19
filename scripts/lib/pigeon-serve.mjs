/* pigeon-serve.mjs — benches ask Patch's Pigeons through the engine.
 *
 * `pigeon-serve` (src-tauri/pigeon-engine/src/bin) holds the engine behind
 * one loopback endpoint. This is the `complete` a bench hands the planner and
 * the router in its place: it sends the Pigeon a request names
 * (`{ id, input, values }`, D84) and ignores the messages and grammar, which
 * is what the app does with the switch on. A request that names no Pigeon is
 * an error, so a bench cannot quietly measure something else. Node-only.
 */
export function pigeonServer ({ base = 'http://127.0.0.1:8150', planner = null } = {}) {
  const complete = async ({ pigeon: asked = null, maxTokens = null }) => {
    if (!asked) throw new Error('this ask names no Pigeon, and the engine asks only Pigeons');
    /* `planner`: one Pigeon stands in for all four prompted planners (a
       trained planner learnt the runway and the carry from its rows). */
    const pigeon = planner && String(asked.id).startsWith('patch-planner') ? { ...asked, id: planner } : asked;
    const t0 = Date.now();
    const res = await fetch(`${base}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...pigeon, ...(maxTokens ? { max_tokens: maxTokens } : {}) })
    });
    const out = await res.json();
    if (out.error) throw new Error(typeof out.error === 'string' ? out.error : JSON.stringify(out.error));
    return { text: String(out.text ?? '').trim(), ms: Date.now() - t0, tokens: out.tokens ?? 0, promptTokens: out.prompt_tokens ?? 0,
             confidence: typeof out.confidence === 'number' ? out.confidence : null };
  };
  complete.base = base;
  complete.transport = 'pigeon-serve';
  complete.health = async () => { try { return (await fetch(`${base}/health`)).ok; } catch { return false; } };
  complete.model = async () => 'Patch\'s Pigeons (engine)';
  return complete;
}
