// Backup and restore: JSON backup, JSON import (validated), CSV report.
import * as D from './dates.js';
export const APP = 'my-study-review-tracker';
export function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export const makeBackup = s => JSON.stringify({ app: APP, version: 1, exportedAt: new Date().toISOString(),
  topics: s.topics, reviews: s.reviews, subjects: s.subjects, settings: s.settings }, null, 1);
export function parseBackup(text) {
  let d; try { d = JSON.parse(text); } catch { throw new Error('This file is not a valid backup (not JSON).'); }
  if (d.app !== APP || !Array.isArray(d.topics) || !Array.isArray(d.reviews) || !Array.isArray(d.subjects))
    throw new Error('This file is not a backup from MY STUDY REVIEW TRACKER.');
  const ids = new Set(d.topics.map(t => t.id));
  if (d.topics.some(t => !t.id || !t.name || !D.isValid(t.initialDate)) ||
      d.reviews.some(r => !r.id || !ids.has(r.topicId) || !D.isValid(r.due)))
    throw new Error('The backup file is damaged or incomplete. Nothing was changed.');
  return d;
}
export function makeCSV(s) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`, tm = new Map(s.topics.map(t => [t.id, t]));
  const rows = [['Topic', 'Subject', 'Module', 'Initial study date', 'Review', 'Original due', 'Current due', 'Status', 'Completed on', 'Postponed', 'Topic paused']];
  s.reviews.slice().sort((a, b) => a.due.localeCompare(b.due)).forEach(r => { const t = tm.get(r.topicId); if (!t) return;
    rows.push([t.name, t.subject, t.module, t.initialDate, r.n, r.originalDue, r.due, r.status, r.completedOn || '', r.postponed ? 'yes' : 'no', t.paused ? 'yes' : 'no']); });
  return '\ufeff' + rows.map(r => r.map(q).join(',')).join('\r\n');
}
