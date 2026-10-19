/* diagnostics.js — what Copy diagnostics puts on the clipboard.
 *
 * One click in a chat's "Details for developers", and an issue can reach a
 * developer as a paste: the build and this Mac, this chat's turns with what
 * Patch planned and ran, the last hour of the log, and the warnings on the
 * Pigeons in use. Nothing is sent; it goes to the clipboard and nowhere else,
 * and the first line says so. Built here from plain data so a test reads
 * exactly what a person would paste.
 */

import { cut } from './log.js';

export const COPY_LABEL = 'Copy diagnostics';
export const COPY_NOTE = 'copies this chat and the last hour of the log; nothing is sent';
export const LOG_MINUTES = 60;

const stamp = (ms) => (ms ? new Date(ms).toISOString() : 'unknown time');

/** One turn: when, which lane, the message's first 80 characters, the
 *  receipt line, the plan and each skill run. */
export function turnLines (t, i, receipt = '') {
  const out = [`${i + 1}. ${stamp(t.at)} · lane ${t.lane || 'A'}${t.mode ? ` · ${t.mode}` : ''}${t.ms != null ? ` · ${t.ms} ms` : ''}`];
  out.push(`   message: ${JSON.stringify(cut(t.message || '') || '')}`);
  out.push(`   receipt: ${receipt || '(none)'}`);
  if (t.routing) out.push(`   router: ${t.routing.category ?? 'none'}${typeof t.routing.confidence === 'number' ? ` at ${t.routing.confidence.toFixed(3)}` : ''}, shortlist ${(t.routing.forPlanner || []).length}`);
  if (t.asked && t.asked.asks === false) out.push('   asks check: NO, the plan was dropped');
  if (t.plan) out.push(`   plan: ${JSON.stringify(t.plan)}`);
  for (const r of t.results || []) {
    out.push(`   skill ${r.skill}: ${r.ok ? 'ok' : `failed ${(r.error && r.error.code) || ''} ${cut((r.error && r.error.message) || '')}`.trim()}${r.ms != null ? ` (${r.ms} ms)` : ''}`);
  }
  if (t.ask) out.push(`   asked for: ${t.ask.field || '?'} of ${t.ask.skill || '?'}`);
  if (t.interrupted || t.error) out.push(`   error: ${cut(typeof t.error === 'string' ? t.error : (t.error && t.error.message) || 'interrupted')}`);
  return out;
}

/**
 * The whole paste. `header` is Rust's (app, Patch, engine, Mac, models,
 * memory); `lines` the log's last hour; `turns` this chat's, oldest first,
 * each with its `receipt`; `warnings` as { pigeon, code, text }.
 */
export function diagnosticsText ({ header = '', lines = [], turns = [], warnings = [], chat = '', pigeon = '', now = Date.now() } = {}) {
  const out = [
    `Pigeon diagnostics, copied ${stamp(now)}. It holds this Mac and build, this chat's turns (each message cut to its first 80 characters) with their plans and skills, the last ${LOG_MINUTES} minutes of Pigeon's log, and any open warnings. Nothing was sent anywhere: this text is only on your clipboard.`,
    '',
    '== This Mac and build ==',
    header.trim() || '(not available)',
    '',
    `== This chat${chat ? `: ${JSON.stringify(cut(chat))}` : ''}${pigeon ? ` with ${pigeon}` : ''} (${turns.length} turn${turns.length === 1 ? '' : 's'}) ==`
  ];
  if (!turns.length) out.push('(no turns yet)');
  turns.forEach((t, i) => out.push(...turnLines(t.turn, i, t.receipt)));
  out.push('', `== Log, last ${LOG_MINUTES} minutes (${lines.length} line${lines.length === 1 ? '' : 's'}) ==`);
  out.push(...(lines.length ? lines : ['(nothing logged in the last hour)']));
  out.push('', '== Open warnings ==');
  out.push(...(warnings.length ? warnings.map(w => `${w.pigeon}: ${w.code} — ${w.text}`) : ['none']));
  return `${out.join('\n')}\n`;
}
