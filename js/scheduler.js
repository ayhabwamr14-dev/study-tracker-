// Review scheduling logic. Every due date is derived from the ORIGINAL study date only.
import { addDays, addMonths, diffDays } from './dates.js';
export const SCHEDULE = [
  { n: 1, d: 1 }, { n: 2, d: 3 }, { n: 3, d: 7 }, { n: 4, d: 14 },
  { n: 5, d: 21 }, { n: 6, m: 1 }, { n: 7, m: 2 }, { n: 8, m: 3 },
];
export const dueFor = (initial, s) => (s.m ? addMonths(initial, s.m) : addDays(initial, s.d));
export const buildReviews = topic => SCHEDULE.map(s => {
  const o = dueFor(topic.initialDate, s);
  return { id: `${topic.id}-${s.n}`, topicId: topic.id, n: s.n, originalDue: o, due: o,
    status: 'pending', completedOn: null, postponed: false, history: [] };
});
// Editing the study date recalculates originals; completed and manually moved reviews keep their own dates.
export function rebase(reviews, newInitial) {
  return reviews.map(r => {
    const o = dueFor(newInitial, SCHEDULE[r.n - 1]);
    const keepDue = r.status === 'completed' || r.postponed;
    return { ...r, originalDue: o, due: keepDue ? r.due : o };
  });
}
export function kind(r, today) {
  if (r.status === 'completed') return 'completed';
  const c = diffDays(r.due, today);
  return c < 0 ? 'overdue' : c === 0 ? 'today' : 'upcoming';
}
export const complete = (r, today) => ({ ...r, status: 'completed', completedOn: today,
  history: [...r.history, { type: 'completed', on: today }] });
export const undo = (r, today) => ({ ...r, status: 'pending', completedOn: null,
  history: [...r.history, { type: 'reopened', on: today }] });
export const move = (r, newDue, today) => ({ ...r, due: newDue, postponed: newDue !== r.originalDue,
  history: [...r.history, { type: 'moved', from: r.due, to: newDue, on: today }] });
