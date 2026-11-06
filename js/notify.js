// Notifications. Browsers cannot reliably fire scheduled notifications while the app is closed,
// so reminders are shown when the app is opened/running after the chosen time (once per day).
export const supported = () => 'Notification' in window;
export const permission = () => (supported() ? Notification.permission : 'unsupported');
export const request = async () => (supported() ? Notification.requestPermission() : 'unsupported');
export async function show(title, body) {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) return reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'daily-review' });
  } catch (e) { /* fall through */ }
  new Notification(title, { body, icon: 'icons/icon-192.png' });
}
export function message(due, overdue) {
  let m = due ? `Good morning! You have ${due} topic${due > 1 ? 's' : ''} to review today.` : 'Good morning! No reviews are due today.';
  if (overdue) m += ` ${overdue} overdue review${overdue > 1 ? 's are' : ' is'} waiting too.`;
  return m;
}
