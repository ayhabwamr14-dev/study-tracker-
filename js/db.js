// IndexedDB layer. Schema version stays at 1; app updates never touch stored data.
const NAME = 'study-review-tracker', VERSION = 1;
let dbp;
export const open = () => dbp || (dbp = new Promise((res, rej) => {
  const q = indexedDB.open(NAME, VERSION);
  q.onupgradeneeded = () => {
    const db = q.result;
    if (!db.objectStoreNames.contains('topics')) db.createObjectStore('topics', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('reviews')) db.createObjectStore('reviews', { keyPath: 'id' }).createIndex('topicId', 'topicId');
    if (!db.objectStoreNames.contains('subjects')) db.createObjectStore('subjects', { keyPath: 'name' });
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
  };
  q.onsuccess = () => res(q.result);
  q.onerror = () => rej(q.error);
}));
const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (stores, mode, fn) => {
  const db = await open(), t = db.transaction(stores, mode);
  const out = fn(t);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  return out;
};
export const getAll = async store => { const db = await open(); return wrap(db.transaction(store).objectStore(store).getAll()); };
export const put = (store, items) => tx([store], 'readwrite', t => [].concat(items).forEach(i => t.objectStore(store).put(i)));
export const remove = (store, key) => tx([store], 'readwrite', t => t.objectStore(store).delete(key));
export const removeTopic = id => tx(['topics', 'reviews'], 'readwrite', t => {
  t.objectStore('topics').delete(id);
  const c = t.objectStore('reviews').index('topicId').openKeyCursor(IDBKeyRange.only(id));
  c.onsuccess = () => { const cur = c.result; if (cur) { t.objectStore('reviews').delete(cur.primaryKey); cur.continue(); } };
});
export async function loadAll() {
  const [topics, reviews, subjects, meta] = await Promise.all(['topics', 'reviews', 'subjects', 'meta'].map(getAll));
  const settings = (meta.find(m => m.key === 'settings') || {}).value || null;
  return { topics, reviews, subjects: subjects.sort((a, b) => (a.i ?? 0) - (b.i ?? 0)).map(s => s.name), settings };
}
export const saveSettings = v => put('meta', { key: 'settings', value: v });
export const saveSubjects = async names => tx(['subjects'], 'readwrite', t => {
  const s = t.objectStore('subjects'); s.clear(); names.forEach((name, i) => s.put({ name, i }));
});
// Atomic replace (used by restore): all-or-nothing.
export const replaceAll = d => tx(['topics', 'reviews', 'subjects', 'meta'], 'readwrite', t => {
  ['topics', 'reviews', 'subjects'].forEach(s => t.objectStore(s).clear());
  d.topics.forEach(x => t.objectStore('topics').put(x));
  d.reviews.forEach(x => t.objectStore('reviews').put(x));
  d.subjects.forEach((name, i) => t.objectStore('subjects').put({ name, i }));
  t.objectStore('meta').put({ key: 'settings', value: d.settings });
});
