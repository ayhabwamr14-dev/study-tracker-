// Statistics computed only from stored data.
import * as D from './dates.js';
export function compute(topics, reviews, today) {
  const tm = new Map(topics.map(t => [t.id, t]));
  const live = reviews.filter(r => tm.has(r.topicId));
  const paused = r => tm.get(r.topicId).paused;
  const pending = live.filter(r => r.status === 'pending' && !paused(r));
  const done = live.filter(r => r.status === 'completed');
  const rate = (a, b) => {
    const set = live.filter(r => r.due >= a && r.due <= b && !(r.status === 'pending' && paused(r)));
    const d = set.filter(r => r.status === 'completed').length;
    return { total: set.length, done: d, pct: set.length ? Math.round(d * 100 / set.length) : null };
  };
  const ws = D.weekStart(today);
  const perDay = [];
  for (let i = 13; i >= 0; i--) { const d = D.addDays(today, -i); perDay.push({ label: d.slice(8), v: done.filter(r => r.completedOn === d).length, d }); }
  const perWeek = [];
  for (let i = 7; i >= 0; i--) { const a = D.addDays(ws, -7 * i), b = D.addDays(a, 6);
    perWeek.push({ label: D.fmtShort(a), v: topics.filter(t => t.createdOn >= a && t.createdOn <= b).length }); }
  const days = new Set(done.map(r => r.completedOn));
  let streak = 0, d = days.has(today) ? today : D.addDays(today, -1);
  while (days.has(d)) { streak++; d = D.addDays(d, -1); }
  const bySubject = {};
  topics.forEach(t => { bySubject[t.subject] = (bySubject[t.subject] || 0) + 1; });
  const onTime = done.filter(r => r.completedOn <= r.due).length;
  return {
    totalTopics: topics.length, completed: done.length,
    dueToday: pending.filter(r => r.due === today).length,
    overdue: pending.filter(r => r.due < today).length,
    upcoming: pending.filter(r => r.due > today).length,
    daily: rate(today, today), weekly: rate(ws, D.addDays(ws, 6)), monthly: rate(D.monthStart(today), D.monthEnd(today)),
    perDay, perWeek, streak, bySubject,
    adherence: done.length ? Math.round(onTime * 100 / done.length) : null,
  };
}
