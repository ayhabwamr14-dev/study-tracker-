// UI layer: routing, rendering, event handling. Logic lives in the other modules.
import * as D from './dates.js';
import * as S from './scheduler.js';
import * as DB from './db.js';
import * as ST from './stats.js';
import * as N from './notify.js';
import * as B from './backup.js';

const VERSION = '1.0.0';
const DEFAULT_SUBJECTS = ['Histology', 'Anatomy', 'Physiology', 'Biochemistry', 'Pathology', 'Pharmacology', 'Other'];
const DEFAULT_SETTINGS = { notify: false, time: '08:00', lastNotified: '', lastBackup: '', testDate: '', seeded: true };
const st = { topics: [], reviews: [], subjects: [], settings: { ...DEFAULT_SETTINGS }, route: 'today',
  cal: null, f: { q: '', subject: '', module: '', range: 'all', day: '', tq: '', ts: '' }, ctx: null, sub: false, confirm: null, update: null };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const today = () => D.todayISO(st.settings.testDate || '');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const ICON = {
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  today: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  topics: '<path d="M4 5h16M4 12h16M4 19h10"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
};
const NAV = [['dashboard', 'Dashboard'], ['today', 'Today'], ['calendar', 'Calendar'], ['topics', 'Topics'], ['stats', 'Stats'], ['settings', 'Settings']];

// ---------- data helpers ----------
const tmap = () => new Map(st.topics.map(t => [t.id, t]));
const live = () => { const m = tmap(); return st.reviews.filter(r => m.has(r.topicId)).map(r => ({ r, t: m.get(r.topicId) })); };
const pending = () => live().filter(x => x.r.status === 'pending' && !x.t.paused).sort((a, b) => a.r.due.localeCompare(b.r.due) || a.t.name.localeCompare(b.t.name));
const byKind = k => pending().filter(x => S.kind(x.r, today()) === k);
const findR = id => st.reviews.find(r => r.id === id);
const findT = id => st.topics.find(t => t.id === id);
async function saveReview(nr) { st.reviews = st.reviews.map(r => (r.id === nr.id ? nr : r)); await DB.put('reviews', nr); }
const saveSettings = async patch => { st.settings = { ...st.settings, ...patch }; await DB.saveSettings(st.settings); };

// ---------- small UI helpers ----------
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600); }
function openModal(html, sub = false) { st.sub = sub; const m = $('#modal'); m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; }
function closeModal(force) {
  if (!force && st.sub && st.ctx) return refreshModal();
  $('#modal').hidden = true; $('#modal').innerHTML = ''; st.ctx = null; st.sub = false;
}
function refreshModal() { if (st.ctx?.type === 'day') openDay(st.ctx.arg); else if (st.ctx?.type === 'topic') openTopic(st.ctx.arg); else closeModal(true); }
const after = () => { render(); if (!$('#modal').hidden) refreshModal(); };
function confirmBox(title, msg, okLabel, fn, danger = true) {
  st.confirm = fn;
  openModal(`<h2>${esc(title)}</h2><p>${esc(msg)}</p><div class="acts"><button class="btn ghost" data-act="close">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-act="confirmOk">${esc(okLabel)}</button></div>`, true);
}

// ---------- review card ----------
function card(x, view = 'list') {
  const { r, t } = x, td = today(), k = S.kind(r, td);
  const late = D.diffDays(td, r.due);
  const label = k === 'today' ? 'Due: Today' : k === 'overdue' ? `Overdue by ${plural(late, 'day')}` : k === 'completed' ? `Completed ${D.fmtShort(r.completedOn)}` : `In ${plural(-late, 'day')}`;
  const acts = k === 'completed'
    ? `<button class="btn ghost sm" data-act="undo" data-id="${r.id}">Undo</button>`
    : `<button class="btn primary" data-act="done" data-id="${r.id}">MARK AS COMPLETED</button><button class="btn ghost" data-act="postpone" data-id="${r.id}">POSTPONE REVIEW</button>`;
  return `<article class="card rv ${k}"><h3>${esc(t.name)}</h3>
  <p class="meta">${esc(t.subject)}${t.module ? ' — ' + esc(t.module) : ''}</p>
  <p class="chips"><span class="chip">Review ${r.n}</span><span class="chip ${k}">${label}</span>${r.postponed ? '<span class="chip warn">Postponed</span>' : ''}</p>
  <p class="meta small">Original study date: ${D.fmtLong(t.initialDate)}<br>Due date: ${D.fmtLong(r.due)}${r.postponed ? ` (originally ${D.fmtLong(r.originalDue)})` : ''}</p>
  <div class="acts">${acts}</div></article>`;
}

// ---------- pages ----------
function pageDashboard() {
  const s = ST.compute(st.topics, st.reviews, today());
  const pct = s.daily.pct ?? 0, C = 226.2;
  const head = s.dueToday + s.overdue === 0 ? 'You are all caught up.' : `${plural(s.dueToday, 'review')} due today${s.overdue ? ` and ${s.overdue} overdue` : ''}.`;
  return `<section class="hero"><svg class="ring" viewBox="0 0 88 88"><circle cx="44" cy="44" r="36" fill="none" stroke="#2b4175" stroke-width="9"/><circle cx="44" cy="44" r="36" fill="none" stroke="#f4b6c8" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}" transform="rotate(-90 44 44)"/><text x="44" y="50" text-anchor="middle" fill="#fff" font-size="18" font-weight="800">${s.daily.pct === null ? '—' : pct + '%'}</text></svg>
  <div><h1>Dr. Aya abo amer</h1><p>${head}</p><p>Study streak: ${plural(s.streak, 'day')}</p></div></section>
  <div class="grid">
  <div class="stat"><b>${s.totalTopics}</b><span>Total Topics Studied</span></div>
  <div class="stat"><b>${s.completed}</b><span>Total Reviews Completed</span></div>
  <div class="stat pink"><b>${s.dueToday}</b><span>Reviews Due Today</span></div>
  <div class="stat bad"><b>${s.overdue}</b><span>Overdue Reviews</span></div>
  <div class="stat"><b>${s.upcoming}</b><span>Upcoming Reviews</span></div>
  <div class="stat"><b>${s.streak}</b><span>Study Streak (days)</span></div></div>
  <h2>Completion rate</h2>${rateBars(s)}
  <div class="acts" style="margin-top:14px"><a href="#today" style="text-decoration:none;flex:1"><button class="btn primary" style="width:100%">Open TODAY'S REVIEWS</button></a></div>`;
}
const rateBar = (label, r) => `<div class="row"><span>${label}</span><b>${r.pct === null ? 'no reviews due' : `${r.pct}% (${r.done}/${r.total})`}</b></div><div class="bar pk"><i style="width:${r.pct || 0}%"></i></div>`;
const rateBars = s => `<div class="card">${rateBar('Daily', s.daily)}<br>${rateBar('Weekly', s.weekly)}<br>${rateBar('Monthly', s.monthly)}</div>`;

function upcomingItems() {
  const f = st.f, td = today();
  let a = pending().filter(x => S.kind(x.r, td) === 'upcoming');
  if (f.q) a = a.filter(x => norm(x.t.name).includes(norm(f.q)));
  if (f.subject) a = a.filter(x => x.t.subject === f.subject);
  if (f.module) a = a.filter(x => x.t.module === f.module);
  if (f.range !== 'all') {
    const d = D.isValid(f.day) ? f.day : D.addDays(td, 1);
    if (f.range === 'day') a = a.filter(x => x.r.due === d);
    if (f.range === 'week') { const w = D.weekStart(d); a = a.filter(x => x.r.due >= w && x.r.due <= D.addDays(w, 6)); }
    if (f.range === 'month') a = a.filter(x => x.r.due.slice(0, 7) === d.slice(0, 7));
  }
  return a;
}
function upcomingHTML() {
  const a = upcomingItems(), td = today();
  if (!a.length) return '<p class="empty">No upcoming reviews match.</p>';
  let out = '', last = '';
  a.forEach(x => { if (x.r.due !== last) { last = x.r.due; const diff = D.diffDays(last, td); out += `<h3 style="margin:14px 0 6px">${diff === 1 ? 'Tomorrow — ' : ''}${D.fmtDay(last)}</h3>`; } out += card(x); });
  return out;
}
const moduleOptions = () => [...new Set(st.topics.map(t => t.module).filter(Boolean))].sort();
function pageToday() {
  const od = byKind('overdue'), tdy = byKind('today'), f = st.f;
  const sel = (arr, v) => arr.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('');
  return `<h2>OVERDUE REVIEWS <span class="chip overdue">${od.length}</span></h2>${od.length ? od.map(x => card(x)).join('') : '<p class="empty">No overdue reviews.</p>'}
  <h2>TODAY'S REVIEWS <span class="chip today">${tdy.length}</span></h2>${tdy.length ? tdy.map(x => card(x)).join('') : '<p class="empty">Nothing due today. Enjoy the free time or add a new topic.</p>'}
  <h2>UPCOMING REVIEWS</h2>
  <div class="filters"><input class="wide" type="search" placeholder="Search topic name" value="${esc(f.q)}" data-f="q">
  <select data-f="subject"><option value="">All subjects</option>${sel(st.subjects, f.subject)}</select>
  <select data-f="module"><option value="">All modules</option>${sel(moduleOptions(), f.module)}</select>
  <select data-f="range"><option value="all" ${f.range === 'all' ? 'selected' : ''}>All dates</option><option value="day" ${f.range === 'day' ? 'selected' : ''}>Specific day</option><option value="week" ${f.range === 'week' ? 'selected' : ''}>Whole week</option><option value="month" ${f.range === 'month' ? 'selected' : ''}>Whole month</option></select>
  <input type="date" data-f="day" value="${esc(D.isValid(f.day) ? f.day : D.addDays(today(), 1))}" aria-label="Date"></div>
  <div id="upList">${upcomingHTML()}</div>`;
}

function dayMap() {
  const map = {}, td = today(), add = (d, k) => { (map[d] ??= { init: 0, sched: 0, done: 0, over: 0 })[k]++; };
  st.topics.forEach(t => add(t.initialDate, 'init'));
  live().forEach(({ r, t }) => { if (r.status === 'completed') add(r.completedOn, 'done'); else if (!t.paused) add(r.due, r.due < td ? 'over' : 'sched'); });
  return map;
}
function pageCalendar() {
  const td = today(); if (!st.cal) st.cal = { y: +td.slice(0, 4), m: +td.slice(5, 7) };
  const { y, m } = st.cal, first = `${y}-${String(m).padStart(2, '0')}-01`, lead = (D.dow(first) + 1) % 7, map = dayMap();
  const cells = []; for (let i = 0; i < lead; i++) cells.push(D.addDays(first, i - lead));
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = D.addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(D.addDays(cells[cells.length - 1], 1));
  const head = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(d => `<div class="dh">${d}</div>`).join('');
  const body = cells.map(d => { const c = map[d] || {}, out = d.slice(0, 7) !== first.slice(0, 7);
    return `<button class="day ${out ? 'out' : ''} ${d === td ? 'now' : ''}" data-act="calDay" data-d="${d}"><em>${+d.slice(8)}</em><span class="pl">${c.init ? `<i class="k-init">${c.init}</i>` : ''}${c.sched ? `<i class="k-sched">${c.sched}</i>` : ''}${c.over ? `<i class="k-over">${c.over}</i>` : ''}${c.done ? `<i class="k-done">${c.done}</i>` : ''}</span></button>`; }).join('');
  return `<h2>REVIEW CALENDAR</h2><div class="cal-h"><button class="btn ghost sm" data-act="calPrev" aria-label="Previous month">‹ Prev</button><b>${D.MONTHS[m - 1]} ${y}</b><button class="btn ghost sm" data-act="calNext" aria-label="Next month">Next ›</button></div>
  <div class="cal">${head}${body}</div><div class="legend"><span><i class="k-init"></i>Initial Study</span><span><i class="k-sched"></i>Scheduled</span><span><i class="k-done"></i>Completed</span><span><i class="k-over"></i>Overdue</span></div>
  <button class="btn ghost sm" data-act="calToday">Go to today</button>`;
}
function openDay(d) {
  st.ctx = { type: 'day', arg: d };
  const td = today(), inits = st.topics.filter(t => t.initialDate === d);
  const rs = live().filter(({ r, t }) => (r.status === 'completed' ? r.completedOn === d : !t.paused && r.due === d));
  openModal(`<h2>${D.fmtLong(d)}${d === td ? ' (today)' : ''}</h2>
  ${inits.map(t => `<div class="card"><span class="chip">Initial Study</span><h3 style="margin-top:8px">${esc(t.name)}</h3><p class="meta">${esc(t.subject)}${t.module ? ' — ' + esc(t.module) : ''}</p><div class="acts"><button class="btn ghost sm" data-act="openTopic" data-id="${t.id}">Open topic</button></div></div>`).join('')}
  ${rs.map(x => card(x)).join('')}${!inits.length && !rs.length ? '<p class="empty">Nothing scheduled on this day.</p>' : ''}
  <div class="acts"><button class="btn primary" data-act="close">Close</button></div>`);
}

function topicsFiltered() {
  const f = st.f; let a = st.topics.slice().sort((x, y) => y.initialDate.localeCompare(x.initialDate) || x.name.localeCompare(y.name));
  if (f.tq) a = a.filter(t => norm(t.name + ' ' + t.module).includes(norm(f.tq)));
  if (f.ts) a = a.filter(t => t.subject === f.ts);
  return a;
}
function topicsHTML() {
  const a = topicsFiltered(), td = today();
  if (!st.topics.length) return '<p class="empty">No topics yet. Tap <b>+ ADD NEW TOPIC</b> after you study something new.</p>';
  if (!a.length) return '<p class="empty">No topics match.</p>';
  return a.map(t => { const rs = st.reviews.filter(r => r.topicId === t.id), done = rs.filter(r => r.status === 'completed').length;
    const nx = rs.filter(r => r.status === 'pending').sort((p, q) => p.due.localeCompare(q.due))[0];
    return `<article class="card"><h3>${esc(t.name)}</h3><p class="meta">${esc(t.subject)}${t.module ? ' — ' + esc(t.module) : ''} · studied ${D.fmtShort(t.initialDate)}</p>
    <p class="chips"><span class="chip completed">${done}/8 reviews done</span>${t.paused ? '<span class="chip warn">Paused</span>' : nx ? `<span class="chip ${S.kind(nx, td)}">Next: ${D.fmtShort(nx.due)}</span>` : '<span class="chip completed">Finished</span>'}</p>
    <div class="acts"><button class="btn ghost" data-act="openTopic" data-id="${t.id}">Open details</button></div></article>`; }).join('');
}
function pageTopics() {
  return `<h2>MY TOPICS</h2><div class="filters"><input type="search" placeholder="Search topics" value="${esc(st.f.tq)}" data-f="tq"><select data-f="ts"><option value="">All subjects</option>${st.subjects.map(s => `<option ${s === st.f.ts ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div><div id="tpList">${topicsHTML()}</div>`;
}

const chart = (arr, tint) => { const mx = Math.max(1, ...arr.map(a => a.v)); return `<div class="chart">${arr.map(a => `<div><b>${a.v || ''}</b><i style="height:${a.v * 100 / mx}%;${tint ? 'background:#e08aa8' : ''}"></i><span>${esc(a.label)}</span></div>`).join('')}</div>`; };
function pageStats() {
  const s = ST.compute(st.topics, st.reviews, today()), subs = Object.entries(s.bySubject).sort((a, b) => b[1] - a[1]);
  return `<h2>STATISTICS</h2><div class="grid"><div class="stat pink"><b>${s.streak}</b><span>STUDY STREAK (consecutive days)</span></div><div class="stat"><b>${s.adherence === null ? '—' : s.adherence + '%'}</b><span>Review plan adherence (done on or before due date)</span></div></div>
  <h2>Completion rate</h2>${rateBars(s)}
  <h2>Reviews completed per day (last 14 days)</h2><div class="card">${chart(s.perDay)}</div>
  <h2>Topics added per week (last 8 weeks)</h2><div class="card">${chart(s.perWeek, true)}</div>
  <h2>Topics by subject</h2><div class="card">${subs.length ? subs.map(([n, c]) => `<div class="row"><span>${esc(n)}</span><b>${c}</b></div><div class="bar"><i style="width:${c * 100 / s.totalTopics}%"></i></div>`).join('') : '<p class="meta">No topics yet.</p>'}</div>`;
}

function pageSettings() {
  const cfg = st.settings, perm = N.permission(), used = n => st.topics.some(t => t.subject === n);
  const permTxt = perm === 'granted' ? 'Notifications are allowed.' : perm === 'denied' ? 'Notifications are blocked. Allow them in Chrome site settings.' : perm === 'unsupported' ? 'This browser does not support notifications.' : 'Permission not requested yet.';
  return `<h2>SETTINGS</h2>
  <div class="card"><h3>Subjects</h3>${st.subjects.map(n => `<div class="row"><span>${esc(n)}</span><span><button class="btn ghost sm" data-act="renSubject" data-n="${esc(n)}">Rename</button> ${used(n) ? '' : `<button class="btn danger sm" data-act="delSubject" data-n="${esc(n)}">Delete</button>`}</span></div>`).join('')}
  <form data-form="subject" class="acts"><input name="n" placeholder="New subject" maxlength="60" style="flex:2 1 160px" required><button class="btn pink">Add subject</button></form><p class="err" id="serr"></p></div>
  <div class="card"><h3>Daily reminder</h3><p class="meta">${permTxt}</p>
  <label>Reminder time (Cairo time)</label><input type="time" id="rtime" value="${esc(cfg.time)}">
  <div class="acts"><button class="btn ${cfg.notify ? 'ghost' : 'primary'}" data-act="toggleNotify">${cfg.notify ? 'Turn reminders off' : 'Turn reminders on'}</button><button class="btn ghost" data-act="testNotify">Send test</button></div>
  <p class="meta small" style="margin-top:10px">Limit: browsers cannot guarantee a notification while the app is fully closed. The reminder appears when the app is open or running in the background after your chosen time, once per day. Opening the app each morning always shows your list.</p></div>
  <div class="card"><h3>Backup and restore</h3><p class="meta">Last backup: ${cfg.lastBackup ? D.fmtLong(cfg.lastBackup) : 'never'}</p>
  <div class="acts"><button class="btn primary" data-act="exportJSON">Export backup (JSON)</button><button class="btn ghost" data-act="importPick">Import backup</button><button class="btn ghost" data-act="exportCSV">Export report (CSV)</button></div>
  <input type="file" id="file" accept="application/json,.json" hidden></div>
  <div class="card"><h3>Testing date</h3><p class="meta small">Pretend today is another date to check how reviews appear. Leave empty for normal use.</p>
  <div class="acts"><input type="date" id="tdate" value="${esc(cfg.testDate)}" style="flex:2 1 160px"><button class="btn ghost" data-act="clearTest">Use real date</button></div></div>
  <div class="card"><h3>About</h3><p class="meta">MY STUDY REVIEW TRACKER v${VERSION}<br>Data is stored on this device (IndexedDB). Time zone: Africa/Cairo.<br>Today: ${D.fmtLong(today())}</p></div>`;
}

// ---------- topic form / detail ----------
function topicFields(t = {}) {
  const sub = t.subject || st.subjects[0] || '';
  return `<label>Topic Name</label><input name="name" value="${esc(t.name)}" maxlength="120" required>
  <label>Subject</label><select name="subject">${st.subjects.map(s => `<option ${s === sub ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
  <input name="newSubject" placeholder="…or type a new subject" maxlength="60" style="margin-top:6px">
  <label>Module (optional)</label><input name="module" value="${esc(t.module)}" maxlength="80" list="mods"><datalist id="mods">${moduleOptions().map(m => `<option value="${esc(m)}">`).join('')}</datalist>
  <label>Initial Study Date</label><input type="date" name="date" value="${esc(t.initialDate || today())}" required>
  <label>Notes (optional)</label><textarea name="notes" maxlength="2000">${esc(t.notes)}</textarea><p class="err" id="ferr"></p>`;
}
function openAdd() { st.ctx = null; openModal(`<h2>+ ADD NEW TOPIC</h2><form data-form="topic"><input type="hidden" name="id" value="">${topicFields()}<div class="acts"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn primary">SAVE</button></div></form>`); }
function openTopic(id) {
  const t = findT(id); if (!t) return closeModal(true);
  st.ctx = { type: 'topic', arg: id };
  const td = today(), rs = st.reviews.filter(r => r.topicId === id).sort((a, b) => a.n - b.n);
  const rows = rs.map(r => { const k = S.kind(r, td), lbl = k === 'completed' ? `Completed ${D.fmtShort(r.completedOn)}` : k === 'overdue' ? 'Overdue' : k === 'today' ? 'Pending (today)' : 'Upcoming';
    const act = k === 'completed' ? `<button class="btn ghost sm" data-act="undo" data-id="${r.id}">Undo</button>` : `<button class="btn primary sm" data-act="done" data-id="${r.id}">Done</button> <button class="btn ghost sm" data-act="resched" data-id="${r.id}">Move</button>`;
    return `<tr><td>Review ${r.n}</td><td>${D.fmtShort(r.due)}${r.postponed ? `<br><span class="meta small">orig. ${D.fmtShort(r.originalDue)}</span>` : ''}</td><td><span class="chip ${k}">${lbl}</span>${r.postponed ? ' <span class="chip warn">Postponed</span>' : ''}</td><td>${act}</td></tr>`; }).join('');
  openModal(`<h2>${esc(t.name)}</h2><p class="meta">Initial Study: ${D.fmtLong(t.initialDate)}${t.paused ? ' · <b>Paused</b>' : ''}</p>
  <div class="tw card" style="margin-top:10px"><table><tr><th>Review</th><th>Due</th><th>Status</th><th></th></tr>${rows}</table></div>
  <form data-form="topic"><input type="hidden" name="id" value="${t.id}">${topicFields(t)}<div class="acts"><button class="btn primary">Save changes</button></div></form>
  <div class="acts"><button class="btn ghost" data-act="pause" data-id="${t.id}">${t.paused ? 'Resume tracking' : 'Pause tracking'}</button><button class="btn danger" data-act="delTopic" data-id="${t.id}">Delete topic</button></div>
  <div class="acts"><button class="btn ghost" data-act="close">Close</button></div>`);
}
async function saveTopic(form) {
  const fd = new FormData(form), id = fd.get('id'), name = String(fd.get('name')).trim(), module = String(fd.get('module')).trim();
  const typed = String(fd.get('newSubject')).trim(); let subject = typed || fd.get('subject');
  const date = fd.get('date'), notes = String(fd.get('notes')).trim(), err = m => { $('#ferr').textContent = m; };
  if (!name) return err('Enter a topic name.');
  if (!subject) return err('Choose or type a subject.');
  if (!D.isValid(date)) return err('Choose a valid study date.');
  const ex = st.subjects.find(s => norm(s) === norm(subject)); if (ex) subject = ex;
  if (st.topics.some(t => t.id !== id && norm(t.name) === norm(name) && norm(t.subject) === norm(subject) && norm(t.module) === norm(module)))
    return err('This topic already exists with the same subject and module.');
  if (!ex) { st.subjects.push(subject); await DB.saveSubjects(st.subjects); }
  if (id) {
    const old = findT(id), t = { ...old, name, subject, module, initialDate: date, notes };
    st.topics = st.topics.map(x => (x.id === id ? t : x)); await DB.put('topics', t);
    if (old.initialDate !== date) { const rs = S.rebase(st.reviews.filter(r => r.topicId === id), date); st.reviews = st.reviews.map(r => rs.find(n => n.id === r.id) || r); await DB.put('reviews', rs); }
    toast('Changes saved');
  } else {
    const t = { id: uid(), name, subject, module, initialDate: date, notes, paused: false, createdOn: today() }, rs = S.buildReviews(t);
    st.topics.push(t); st.reviews.push(...rs); await DB.put('topics', t); await DB.put('reviews', rs);
    closeModal(true); toast('Topic added — 8 reviews scheduled'); return render();
  }
  after();
}

// ---------- postpone / reschedule ----------
function openMove(id, mode) {
  const r = findR(id), t = findT(r.topicId), td = today();
  openModal(`<h2>${mode === 'postpone' ? 'POSTPONE REVIEW' : 'Move review'}</h2><p class="meta">${esc(t.name)} — Review ${r.n}<br>Currently due ${D.fmtLong(r.due)}. Only this review changes.</p>
  <div class="opts">${mode === 'postpone' ? `<button class="btn ghost" data-act="mv" data-id="${id}" data-to="${D.addDays(td, 1)}">Tomorrow</button><button class="btn ghost" data-act="mv" data-id="${id}" data-to="${D.addDays(td, 2)}">After 2 Days</button><button class="btn ghost" data-act="mv" data-id="${id}" data-to="${D.addDays(td, 3)}">After 3 Days</button>` : ''}</div>
  <form data-form="move"><input type="hidden" name="id" value="${id}"><input type="hidden" name="mode" value="${mode}"><label>Choose Custom Date</label><input type="date" name="date" required><p class="err" id="ferr"></p><div class="acts"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn primary">Set date</button></div></form>`, true);
}
async function moveTo(id, date) { const r = findR(id); await saveReview(S.move(r, date, today())); closeModal(true); toast(`Review ${r.n} moved to ${D.fmtShort(date)}`); render(); if (st.ctx) refreshModal(); }

// ---------- render ----------
function updateBanner() {
  const b = $('#banner'); let html = '';
  if (st.update) html = 'A new version is ready. <button class="btn pink sm" data-act="applyUpdate">Update now</button>';
  else if (st.settings.testDate) html = `Testing date active: ${D.fmtLong(st.settings.testDate)}`;
  else if (st.topics.length && (!st.settings.lastBackup || D.diffDays(today(), st.settings.lastBackup) >= 14)) html = 'Time to back up your data. <a href="#settings" style="color:#14274e">Open Settings</a>';
  b.hidden = !html; b.innerHTML = html;
}
function render() {
  const route = (location.hash || '#today').slice(1), pages = { dashboard: pageDashboard, today: pageToday, calendar: pageCalendar, topics: pageTopics, stats: pageStats, settings: pageSettings };
  st.route = pages[route] ? route : 'today';
  $('#view').innerHTML = pages[st.route]();
  const od = byKind('overdue').length;
  $('#nav').innerHTML = NAV.map(([k, l]) => `<a href="#${k}" class="${k === st.route ? 'on' : ''}" ${k === st.route ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24">${ICON[k]}</svg>${l}${k === 'today' && od ? `<span class="bd">${od}</span>` : ''}</a>`).join('');
  updateBanner();
}

// ---------- actions ----------
const A = {
  addTopic: openAdd, close: () => closeModal(), openTopic: d => openTopic(d.id),
  confirmOk: async () => { const f = st.confirm; st.confirm = null; await f(); },
  done: async d => { await saveReview(S.complete(findR(d.id), today())); toast('Review completed'); after(); },
  undo: async d => { await saveReview(S.undo(findR(d.id), today())); toast('Review set back to pending'); after(); },
  postpone: d => openMove(d.id, 'postpone'), resched: d => openMove(d.id, 'move'), mv: d => moveTo(d.id, d.to),
  pause: async d => { const t = { ...findT(d.id), paused: !findT(d.id).paused }; st.topics = st.topics.map(x => (x.id === t.id ? t : x)); await DB.put('topics', t); toast(t.paused ? 'Tracking paused' : 'Tracking resumed'); after(); },
  delTopic: d => confirmBox('Delete this topic?', `"${findT(d.id).name}" and all its reviews will be permanently deleted.`, 'Delete', async () => {
    await DB.removeTopic(d.id); st.topics = st.topics.filter(t => t.id !== d.id); st.reviews = st.reviews.filter(r => r.topicId !== d.id); closeModal(true); toast('Topic deleted'); render(); }),
  calPrev: () => { st.cal.m--; if (st.cal.m < 1) { st.cal.m = 12; st.cal.y--; } render(); },
  calNext: () => { st.cal.m++; if (st.cal.m > 12) { st.cal.m = 1; st.cal.y++; } render(); },
  calToday: () => { st.cal = null; render(); }, calDay: d => openDay(d.d),
  exportJSON: async () => { B.download(`review-tracker-backup-${D.todayISO()}.json`, B.makeBackup(st), 'application/json'); await saveSettings({ lastBackup: D.todayISO() }); toast('Backup file created'); render(); },
  exportCSV: () => { B.download(`review-tracker-report-${D.todayISO()}.csv`, B.makeCSV(st), 'text/csv;charset=utf-8'); toast('CSV report created'); },
  importPick: () => $('#file').click(),
  toggleNotify: async () => {
    if (st.settings.notify) { await saveSettings({ notify: false }); return render(); }
    const p = await N.request(); if (p !== 'granted') { toast('Notifications were not allowed'); return render(); }
    await saveSettings({ notify: true }); toast('Daily reminder is on'); render(); checkReminder();
  },
  testNotify: async () => { if (N.permission() !== 'granted') { const p = await N.request(); if (p !== 'granted') return toast('Allow notifications first'); }
    N.show('MY STUDY REVIEW TRACKER', N.message(byKind('today').length, byKind('overdue').length)); },
  renSubject: d => openModal(`<h2>Rename subject</h2><form data-form="rename"><input type="hidden" name="old" value="${esc(d.n)}"><input name="n" value="${esc(d.n)}" maxlength="60" required><p class="err" id="ferr"></p><div class="acts"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn primary">Save</button></div></form>`, false),
  delSubject: async d => { st.subjects = st.subjects.filter(s => s !== d.n); await DB.saveSubjects(st.subjects); render(); },
  clearTest: async () => { await saveSettings({ testDate: '' }); toast('Using the real date'); render(); },
  applyUpdate: () => st.update?.postMessage('SKIP_WAITING'),
};
document.addEventListener('click', async e => {
  if (e.target.id === 'modal') return closeModal();
  const b = e.target.closest('[data-act]'); if (!b || !A[b.dataset.act]) return;
  try { await A[b.dataset.act](b.dataset); } catch (err) { console.error(err); toast('Something went wrong: ' + err.message); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
document.addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, kind = f.dataset.form, fd = new FormData(f), err = m => { const el = $('#ferr') || $('#serr'); if (el) el.textContent = m; };
  try {
    if (kind === 'topic') await saveTopic(f);
    else if (kind === 'move') {
      const date = fd.get('date'), r = findR(fd.get('id')), t = findT(r.topicId);
      if (!D.isValid(date)) return err('Choose a valid date.');
      if (fd.get('mode') === 'postpone' && date <= today()) return err('Choose a date after today.');
      if (date < t.initialDate) return err('The date cannot be before the study date.');
      if (date === r.due) return err('That is already the due date.');
      await moveTo(r.id, date);
    } else if (kind === 'subject') {
      const n = String(fd.get('n')).trim(); if (!n) return;
      if (st.subjects.some(s => norm(s) === norm(n))) return err('That subject already exists.');
      st.subjects.push(n); await DB.saveSubjects(st.subjects); toast('Subject added'); render();
    } else if (kind === 'rename') {
      const o = fd.get('old'), n = String(fd.get('n')).trim();
      if (!n) return err('Enter a name.');
      if (norm(n) !== norm(o) && st.subjects.some(s => norm(s) === norm(n))) return err('That subject already exists.');
      st.subjects = st.subjects.map(s => (s === o ? n : s)); await DB.saveSubjects(st.subjects);
      const ch = st.topics.filter(t => t.subject === o).map(t => ({ ...t, subject: n })); st.topics = st.topics.map(t => ch.find(c => c.id === t.id) || t); if (ch.length) await DB.put('topics', ch);
      closeModal(true); toast('Subject renamed'); render();
    }
  } catch (x) { console.error(x); toast('Could not save: ' + x.message); }
});
document.addEventListener('input', e => {
  const k = e.target.dataset?.f;
  if (k) { st.f[k] = e.target.value; if (k === 'q' || k === 'subject' || k === 'module' || k === 'range' || k === 'day') $('#upList').innerHTML = upcomingHTML(); else $('#tpList').innerHTML = topicsHTML(); }
});
document.addEventListener('change', async e => {
  if (e.target.id === 'rtime') { await saveSettings({ time: e.target.value || '08:00' }); toast('Reminder time saved'); }
  if (e.target.id === 'tdate') { await saveSettings({ testDate: D.isValid(e.target.value) ? e.target.value : '' }); toast('Testing date set'); render(); }
  if (e.target.id === 'file' && e.target.files[0]) {
    const file = e.target.files[0]; e.target.value = '';
    try {
      const d = B.parseBackup(await file.text());
      confirmBox('Replace current data?', `This backup has ${plural(d.topics.length, 'topic')} and ${plural(d.reviews.length, 'review')}. Importing will REPLACE everything currently saved on this device.`, 'Replace with backup', async () => {
        d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) }; await DB.replaceAll(d); await loadState(); closeModal(true); toast('Backup restored'); render(); }, true);
    } catch (err) { toast(err.message); }
  }
});

// ---------- reminders ----------
async function checkReminder() {
  const s = st.settings; if (!s.notify || N.permission() !== 'granted') return;
  const real = D.todayISO(); if (s.lastNotified === real || D.nowHHMM() < s.time) return;
  await saveSettings({ lastNotified: real });
  const due = byKind('today').length, od = byKind('overdue').length;
  if (due || od) N.show('MY STUDY REVIEW TRACKER', N.message(due, od));
}

// ---------- startup ----------
async function loadState() {
  const d = await DB.loadAll();
  st.topics = d.topics; st.reviews = d.reviews;
  if (!d.settings) { st.settings = { ...DEFAULT_SETTINGS }; st.subjects = DEFAULT_SUBJECTS.slice(); await DB.saveSettings(st.settings); await DB.saveSubjects(st.subjects); }
  else { st.settings = { ...DEFAULT_SETTINGS, ...d.settings }; st.subjects = d.subjects; }
}
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('service-worker.js');
    const offer = w => { if (navigator.serviceWorker.controller) { st.update = w; updateBanner(); } };
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); }); });
    let reloaded = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
    setInterval(() => reg.update().catch(() => {}), 3600e3);
  } catch (e) { console.warn('Service worker not registered', e); }
}
(async function init() {
  try { await loadState(); } catch (e) { $('#view').innerHTML = `<p class="empty">Could not open the local database: ${esc(e.message)}.<br>Private browsing may block storage.</p>`; return; }
  navigator.storage?.persist?.().catch(() => {});
  window.addEventListener('hashchange', () => { closeModal(true); render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); checkReminder(); } });
  render(); registerSW(); checkReminder(); setInterval(checkReminder, 60e3);
  window.__app = { st }; // for automated tests
})();
