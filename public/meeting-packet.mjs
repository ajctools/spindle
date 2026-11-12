import {meetingClock} from './meeting-transcript.mjs';

const kinds = {decision: 'Decision', action: 'Action item', question: 'Open question'};

export function packetRows(text, lines) {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
  let value;
  try { value = JSON.parse(raw); }
  catch { throw Error('The model did not return a readable minutes draft. Try another chat model.'); }
  if (!Array.isArray(value?.items)) throw Error('The model did not return a list of minutes items. Try another chat model.');
  return value.items.slice(0, 50).flatMap(item => {
    if (!item || typeof item.kind !== 'string' || !Object.hasOwn(kinds, item.kind) || typeof item.text !== 'string' || !item.text.trim()) return [];
    const line = Number.isInteger(item.line) && item.line > 0 && item.line <= lines.length ? item.line - 1 : null;
    return [{kind: item.kind, text: item.text.trim().slice(0, 1600), line, reviewed: false}];
  });
}

export function packetMarkdown(title, rows, lines) {
  const literal = value => String(value).replace(/[\\`*_{}\[\]<>()!#|]/g, '\\$&').replace(/\s+/g, ' ').trim();
  const parts = [`# ${literal(title)}`, ''];
  for (const [kind, label] of Object.entries(kinds)) {
    const selected = rows.filter(row => row.kind === kind && row.text.trim());
    if (!selected.length) continue;
    parts.push(`## ${label}s`, '');
    for (const row of selected) {
      const source = row.line === null ? null : lines[row.line];
      const time = source ? ` · ${source.approximate ? 'around ' : ''}${meetingClock(source.at)}` : '';
      parts.push(`- **${row.reviewed ? 'Reviewed' : 'Unreviewed'}**${time} — ${literal(row.text)}`);
    }
    parts.push('');
  }
  return parts.join('\n');
}

export {kinds as packetKinds};
