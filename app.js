'use strict';
const L = window.MomentumLib;
const D = window.MomentumData;

// ---------- Rules ----------
const PTS = { feed: 5, cello: 20, breakfast: 10, studyPass: 20, studyPerfect: 40, passMark: 75 };
const YT = { ptsPerMin: 2, dailyMax: 60, shortcut: 'Momentum Unlock' };
const WORKOUT_MAX_MIN = 75;
const STRINGS = [
  { n: 'A', f: 220.0 }, { n: 'D', f: 146.83 }, { n: 'G', f: 98.0 }, { n: 'C', f: 65.41 },
];
const IN_TUNE_CENTS = 7;
const HOLD_MS = 1500;

// ---------- Small helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => keyOf(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const daysUntil = k => Math.round((parseKey(k) - parseKey(todayKey())) / 86400000);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor(s / 60) % 60; return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60); };
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = k => parseKey(k).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- Saved state ----------
const KEY = 'momentum.v1';
function defaults() {
  return {
    v: 1, points: 0, ledger: [], days: {},
    cello: { active: null },
    workout: { next: 0, levels: {}, weights: {}, days: [1, 3, 5, 6], active: null },
    tests: [],
    rewards: [
      { id: 'movie', emoji: '🎬', name: 'Movie trip', cost: 500 },
      { id: 'game', emoji: '🎮', name: 'New game', cost: 1000 },
    ],
    redeemed: [],
    yt: { until: 0, shortcutReady: false },
    food: { meal: 'oats', sel: {} },
    profile: { name: '', pet: '' },
  };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) {
      const d = defaults();
      return { ...d, ...s, workout: { ...d.workout, ...s.workout }, yt: { ...d.yt, ...s.yt }, food: { ...d.food, ...s.food }, cello: { ...d.cello, ...s.cello }, profile: { ...d.profile, ...s.profile } };
    }
  } catch (e) { /* fall through */ }
  return defaults();
}
let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save. Is storage full?'); } }
function day(k = todayKey()) { return (S.days[k] ||= {}); }

function award(amt, why) {
  if (!amt) return;
  S.points += amt;
  S.ledger.unshift({ t: Date.now(), amt, why });
  S.ledger.length = Math.min(S.ledger.length, 400);
  save();
  toast(`${amt > 0 ? '+' : ''}${amt} pts · ${why}`, amt > 0);
}
function spend(amt, why) {
  if (S.points < amt) return false;
  award(-amt, why);
  return true;
}

// Streak = consecutive days the check passed, counting today only once it's done.
function streak(pred) {
  let d = new Date();
  if (!pred(S.days[keyOf(d)] || {})) d = addDays(d, -1);
  let n = 0;
  while (pred(S.days[keyOf(d)] || {})) { n++; d = addDays(d, -1); }
  return n;
}
const STREAKS = {
  cello: () => streak(x => !!x.celloPts),
  feed: () => streak(x => !!x.feed),
  spray: () => streak(x => !!x.spray),
  breakfast: () => streak(x => !!x.breakfast),
  study: () => streak(x => (x.studyBest || 0) >= PTS.passMark),
};
// Names live only on this phone, never in the app's code.
const who = () => S.profile.name ? ', ' + esc(S.profile.name) : '';
const pet = () => esc(S.profile.pet || 'your pet');
const Pet = () => esc(S.profile.pet || 'Your pet');
const flame = n => n > 0 ? `<span class="streak" title="streak">🔥 ${n}</span>` : '';

// ---------- Photos (IndexedDB) ----------
const Photos = (() => {
  let dbp;
  const db = () => (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('momentum', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const urls = new Map();
  return {
    async put(blob) {
      const id = uid();
      const d = await db();
      await new Promise((res, rej) => {
        const tx = d.transaction('photos', 'readwrite');
        tx.objectStore('photos').put(blob, id);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      return id;
    },
    async get(id) {
      const d = await db();
      return new Promise(res => {
        const r = d.transaction('photos').objectStore('photos').get(id);
        r.onsuccess = () => res(r.result || null); r.onerror = () => res(null);
      });
    },
    async del(id) {
      const d = await db();
      d.transaction('photos', 'readwrite').objectStore('photos').delete(id);
    },
    async url(id) {
      if (urls.has(id)) return urls.get(id);
      const b = await this.get(id);
      if (!b) return null;
      const u = URL.createObjectURL(b);
      urls.set(id, u);
      return u;
    },
  };
})();
function hydratePhotos(root = document) {
  root.querySelectorAll('img[data-photo]:not([src])').forEach(async img => {
    const u = await Photos.url(img.dataset.photo).catch(() => null);
    if (u) img.src = u; else img.classList.add('missing');
  });
}
function pickPhoto(cameraOnly) {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    if (cameraOnly) inp.setAttribute('capture', 'environment');
    inp.onchange = () => res(inp.files[0] || null);
    inp.addEventListener('cancel', () => res(null));
    inp.click();
  });
}
async function shrink(file, max, quality = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
  } finally { URL.revokeObjectURL(url); }
}
async function snapAndSave(max, cameraOnly) {
  const f = await pickPhoto(cameraOnly);
  if (!f) return null;
  const blob = await shrink(f, max);
  return Photos.put(blob);
}

// ---------- Time-of-day theme ----------
function period(h = new Date().getHours()) {
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'day';
  return 'evening';
}
function applyTheme() {
  const p = period();
  if (document.documentElement.dataset.period !== p) {
    document.documentElement.dataset.period = p;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    $('meta[name="theme-color"]')?.setAttribute('content', bg);
  }
}
const GREETING = { morning: 'Good morning', day: 'Good afternoon', evening: 'Good evening' };

// ---------- UI shell ----------
let tab = (location.hash || '#today').slice(1);
const TABS = [
  ['today', 'Today', '☀️'], ['food', 'Food', '🍳'], ['cello', 'Cello', '🎻'],
  ['study', 'Study', '📚'], ['gym', 'Gym', '🏋️'], ['points', 'Points', '🪙'],
];
if (!TABS.some(t => t[0] === tab)) tab = 'today';

function toast(msg, good) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (good ? ' good' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = 'toast'; }, 2600);
}
function openSheet(html) {
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  hydratePhotos($('#sheet'));
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet-body').innerHTML = ''; }

function render() {
  applyTheme();
  if (tab !== 'cello') Tuner.stop();
  $('#tabs').innerHTML = TABS.map(([id, label, icon]) =>
    `<button class="tab${id === tab ? ' on' : ''}" data-a="tab" data-tab="${id}" aria-label="${label}"><span class="ti">${icon}</span><span>${label}</span></button>`).join('');
  $('#pts').textContent = S.points.toLocaleString();
  $('#main').innerHTML = VIEWS[tab]();
  hydratePhotos();
  if (tab === 'cello' && cello.tuning) Tuner.paint();
}
function go(t) { tab = t; history.replaceState(null, '', '#' + t); render(); window.scrollTo(0, 0); }

// ---------- TODAY ----------
function workoutDayToday() { return S.workout.days.includes(new Date().getDay()); }
function weekWorkouts() {
  const now = new Date();
  const monday = addDays(now, -((now.getDay() + 6) % 7));
  let n = 0;
  for (let i = 0; i < 7; i++) n += (S.days[keyOf(addDays(monday, i))]?.workouts || []).length ? 1 : 0;
  return n;
}
function studyTests() { return S.tests.filter(t => t.date && daysUntil(t.date) >= 1 && daysUntil(t.date) <= 3); }

function task({ a, done, late, title, sub, pts, extra = '' }) {
  return `<button class="task${done ? ' done' : ''}${late && !done ? ' late' : ''}" data-a="${a}" ${extra}>
    <span class="tick" aria-hidden="true"></span>
    <span class="tmain"><b>${title}</b><small>${sub}</small></span>
    ${pts ? `<span class="tpts">${pts}</span>` : ''}
  </button>`;
}

const VIEWS = {};
VIEWS.today = () => {
  const d = day(), h = new Date().getHours();
  const p = period();
  const tests = studyTests();
  const left = [!d.feed, !d.spray, !d.celloPts, !d.breakfast, (d.snacks || []).length < 2,
    workoutDayToday() && !(d.workouts || []).length, ...tests.map(() => (d.studyBest || 0) < PTS.passMark)].filter(Boolean).length;
  const ytLeft = S.yt.until - Date.now();
  return `
  <header class="hero">
    <p class="eyebrow">${new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    <h1>${GREETING[p]}${who()}</h1>
    <p class="lede">${left ? `${plural(left, 'thing')} left today.` : 'Everything done today. Nice work.'}${ytLeft > 0 ? ` YouTube unlocked for ${fmtClock(ytLeft)}.` : ''}</p>
  </header>

  <section class="group">
    <h2>${Pet()} 🦎</h2>
    ${task({ a: 'feed', done: d.feed, late: h >= 10, title: `Feed ${pet()}`, sub: d.feed ? `Fed at ${fmtTime(d.feed)} ${flame(STREAKS.feed())}` : `Every morning, by 10am ${flame(STREAKS.feed())}`, pts: `+${PTS.feed}` })}
    ${task({ a: 'spray', done: d.spray, late: h >= 18, title: `Spray ${pet()}`, sub: d.spray ? `Sprayed at ${fmtTime(d.spray)} ${flame(STREAKS.spray())}` : `Once a day, by 6pm ${flame(STREAKS.spray())}` })}
  </section>

  <section class="group">
    <h2>Practice</h2>
    ${task({ a: 'goto', extra: 'data-tab="cello"', done: d.celloPts, title: 'Cello', sub: d.celloPts ? `${d.celloMin || 0} min today ${flame(STREAKS.cello())}` : `Tune all 4 strings to start ${flame(STREAKS.cello())}`, pts: `+${PTS.cello}` })}
    ${tests.map(t => task({ a: 'openTest', extra: `data-id="${t.id}"`, done: (d.studyBest || 0) >= PTS.passMark, title: `Study: ${esc(t.subject)}`, sub: `Test ${daysUntil(t.date) === 1 ? 'tomorrow' : `in ${daysUntil(t.date)} days`}${d.studyBest != null ? ` · best ${d.studyBest}%` : ''}`, pts: '+20/40' })).join('')}
  </section>

  <section class="group">
    <h2>Food</h2>
    ${task({ a: 'goto', extra: 'data-tab="food"', done: d.breakfast, title: 'Breakfast', sub: d.breakfast ? `${esc(d.breakfast.meal)} ${flame(STREAKS.breakfast())}` : `Pick one and snap a photo ${flame(STREAKS.breakfast())}`, pts: `+${PTS.breakfast}` })}
    ${task({ a: 'goto', extra: 'data-tab="food"', done: (d.snacks || []).length >= 2, title: 'Snacks', sub: `${(d.snacks || []).length} of 2 today` })}
  </section>

  <section class="group">
    <h2>Training</h2>
    ${task({ a: 'goto', extra: 'data-tab="gym"', done: (d.workouts || []).length, title: (d.workouts || []).length ? `Workout done: ${D.WORKOUTS.find(x => x.id === d.workouts.at(-1).wid).name}` : workoutDayToday() ? `Workout: ${D.WORKOUTS[S.workout.next].name}` : 'Rest day', sub: `${weekWorkouts()} of ${S.workout.days.length} this week${workoutDayToday() ? '' : ' · you can still train'}`, pts: '+1/min' })}
  </section>`;
};

// ---------- FOOD ----------
function mealSel(meal) { return S.food.sel[meal.id] || (S.food.sel[meal.id] = meal.groups.map(() => 0)); }
function mealName(meal) { return `${meal.name}: ` + meal.groups.map((g, i) => g.options[mealSel(meal)[i]]).filter(o => o !== 'Nothing extra' && o !== 'No sauce').join(', '); }
let openSwap = -1;

VIEWS.food = () => {
  const d = day();
  const meal = D.MEALS.find(m => m.id === S.food.meal) || D.MEALS[0];
  const sel = mealSel(meal);
  const snacks = d.snacks || [];
  const diary = [];
  for (let i = 0; i < 14; i++) {
    const k = keyOf(addDays(new Date(), -i)), x = S.days[k];
    if (!x) continue;
    if (x.breakfast?.photo) diary.push({ k, photo: x.breakfast.photo, label: 'Breakfast' });
    (x.snacks || []).forEach(s => s.photo && diary.push({ k, photo: s.photo, label: s.name }));
  }
  return `
  <header class="hero">
    <p class="eyebrow">Food</p>
    <h1>Fuel up</h1>
    <p class="lede">You're growing and training, so eat plenty. Breakfast and 2 snacks a day.</p>
  </header>

  <section class="group">
    <h2>Breakfast <span class="h-pts">+${PTS.breakfast}</span></h2>
    ${d.breakfast ? `
      <div class="card eaten">
        ${d.breakfast.photo ? `<img class="proof" data-photo="${d.breakfast.photo}" alt="Breakfast photo">` : ''}
        <div><b>Done ✅</b><p>${esc(d.breakfast.meal)}</p><small>${fmtTime(d.breakfast.t)} ${flame(STREAKS.breakfast())}</small></div>
      </div>` : `
      <div class="chips" role="tablist">
        ${D.MEALS.map(m => `<button class="chip${m.id === meal.id ? ' on' : ''}" data-a="meal" data-id="${m.id}">${m.emoji} ${m.name}</button>`).join('')}
      </div>
      <div class="card meal">
        ${meal.groups.map((g, i) => `
          <div class="mrow">
            <span class="mlabel">${g.label}</span>
            <span class="mval">${esc(g.options[sel[i]])}</span>
            <button class="swap" data-a="swap" data-i="${i}">${openSwap === i ? 'Close' : 'Swap'}</button>
          </div>
          ${openSwap === i ? `<div class="opts">${g.options.map((o, j) => `<button class="opt${j === sel[i] ? ' on' : ''}" data-a="pick" data-i="${i}" data-j="${j}">${esc(o)}</button>`).join('')}</div>` : ''}
        `).join('')}
        <button class="btn primary" data-a="ateBreakfast">📸 I ate this. Take photo</button>
      </div>`}
  </section>

  <section class="group">
    <h2>Snacks <span class="h-sub">${snacks.length} of 2</span></h2>
    ${snacks.length ? `<div class="snacklog">${snacks.map(s => `<figure>${s.photo ? `<img data-photo="${s.photo}" alt="">` : ''}<figcaption>${esc(s.name)}<br><small>${fmtTime(s.t)}</small></figcaption></figure>`).join('')}</div>` : ''}
    <p class="hint">Tap a snack when you eat it, then snap a photo.</p>
    <div class="snackgrid">
      ${D.SNACKS.map(([e, n]) => `<button class="snack" data-a="snack" data-name="${esc(n)}"><span>${e}</span>${esc(n)}</button>`).join('')}
    </div>
    <form class="inline" data-form="customSnack">
      <input id="customSnack" name="name" placeholder="Something else…" maxlength="40" autocomplete="off">
      <button class="btn">Add</button>
    </form>
  </section>

  ${diary.length ? `<section class="group">
    <h2>Food diary</h2>
    <div class="diary">${diary.slice(0, 24).map(x => `<figure><img data-photo="${x.photo}" alt=""><figcaption>${fmtDay(x.k)} · ${esc(x.label)}</figcaption></figure>`).join('')}</div>
  </section>` : ''}`;
};

// ---------- CELLO ----------
const cello = { tuning: false, done: [false, false, false, false], cur: 0, err: '' };

const Tuner = {
  ctx: null, stream: null, an: null, buf: null, raf: 0, smooth: null, holdStart: 0, lastHeard: 0, lastCents: null, held: 0,
  async start() {
    // Create the audio context inside the tap, or iPhone keeps it muted.
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx.resume();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      this.stop();
      cello.tuning = false;
      cello.err = 'Momentum needs the microphone to hear your strings. On iPhone: Settings → Safari → Microphone → Allow, then try again.';
      render();
      return;
    }
    if (!cello.tuning) return this.stop();
    await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = 4096;
    src.connect(this.an);
    this.buf = new Float32Array(this.an.fftSize);
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch (e) { /* optional */ }
    this.loop();
  },
  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close().catch(() => {});
    this.wake?.release?.().catch?.(() => {});
    this.stream = this.ctx = this.an = this.wake = null;
  },
  loop() {
    this.raf = requestAnimationFrame(() => this.loop());
    if (!this.an) return;
    const s = STRINGS[cello.cur];
    this.an.getFloatTimeDomainData(this.buf);
    const r = L.detectPitch(this.buf, this.ctx.sampleRate, s.f * 0.75, s.f * 1.33);
    const now = performance.now();
    if (r && r.clarity > 0.8) {
      const c = L.cents(r.freq, s.f);
      this.smooth = this.smooth == null || now - this.lastHeard > 400 ? c : this.smooth * 0.75 + c * 0.25;
      this.lastHeard = now;
      if (Math.abs(this.smooth) <= IN_TUNE_CENTS) {
        if (!this.holdStart) this.holdStart = now;
      } else this.holdStart = 0;
    } else if (now - this.lastHeard > 300) {
      this.smooth = null;
      this.holdStart = 0;
    }
    this.held = this.holdStart ? (now - this.holdStart) / HOLD_MS : 0;
    if (this.held >= 1) {
      cello.done[cello.cur] = true;
      this.holdStart = 0; this.smooth = null; this.held = 0;
      if (navigator.vibrate) navigator.vibrate(60);
      const next = cello.done.findIndex(x => !x);
      if (next < 0) { finishTuning(); return; }
      cello.cur = next;
      render();
      return;
    }
    this.paint();
  },
  paint() {
    const needle = $('#needle'), read = $('#reading'), ring = $('#hold');
    if (!needle) return;
    const c = this.smooth;
    const box = $('#gauge');
    if (c == null) {
      needle.style.setProperty('--x', '0');
      box.dataset.state = 'idle';
      read.innerHTML = `Play your open <b>${STRINGS[cello.cur].n}</b> string`;
    } else {
      const clamped = Math.max(-50, Math.min(50, c));
      needle.style.setProperty('--x', String(clamped / 50));
      const a = Math.abs(c);
      box.dataset.state = a <= IN_TUNE_CENTS ? 'good' : a <= 20 ? 'close' : 'far';
      const dir = a <= IN_TUNE_CENTS ? 'In tune. Hold it…' : c < 0 ? 'Too low. Tune up ⬆' : 'Too high. Tune down ⬇';
      read.innerHTML = `<b>${c > 0 ? '+' : ''}${Math.round(c)}</b> cents · ${dir}`;
    }
    ring.style.setProperty('--p', String(this.held));
  },
};

function finishTuning() {
  Tuner.stop();
  cello.tuning = false;
  const d = day();
  if (!d.celloPts) {
    d.celloPts = true;
    award(PTS.cello, 'Cello practice');
  }
  S.cello.active = { start: Date.now() };
  save();
  render();
}

VIEWS.cello = () => {
  const d = day();
  const act = S.cello.active;
  const st = STREAKS.cello();
  const sessions = Object.values(S.days).filter(x => x.celloPts).length;
  const head = `
  <header class="hero">
    <p class="eyebrow">Cello</p>
    <h1>${act ? 'Practising' : d.celloPts ? 'Practised today' : 'Time to play'}</h1>
    <p class="lede">${st ? `🔥 ${plural(st, 'day')} in a row. ` : ''}${plural(sessions, 'day')} practised in total.</p>
  </header>`;

  if (act) {
    return head + `
    <section class="group center">
      <div class="bigclock" id="celloClock">${fmtClock(Date.now() - act.start)}</div>
      <p class="hint">Keep playing. Tap Done when you finish.</p>
      <button class="btn primary wide" data-a="celloDone">Done practising</button>
    </section>`;
  }
  if (cello.tuning) {
    const s = STRINGS[cello.cur];
    return head + `
    <section class="group center">
      <div class="strings">
        ${STRINGS.map((x, i) => `<button class="str${i === cello.cur ? ' cur' : ''}${cello.done[i] ? ' ok' : ''}" data-a="pickString" data-i="${i}">${x.n}${cello.done[i] ? ' ✓' : ''}</button>`).join('')}
      </div>
      <div class="gauge" id="gauge" data-state="idle">
        <div class="scale"><span>−50</span><span>−25</span><span>0</span><span>+25</span><span>+50</span></div>
        <div class="track"><div class="zone"></div><div class="needle" id="needle"></div></div>
        <div class="note"><span class="hold" id="hold"></span><b>${s.n}</b><small>${s.f.toFixed(1)} Hz</small></div>
        <p class="reading" id="reading">Play your open <b>${s.n}</b> string</p>
      </div>
      <p class="hint">Hold each string in the green for ${HOLD_MS / 1000} seconds. ${cello.done.filter(Boolean).length} of 4 done.</p>
      <button class="btn ghost" data-a="cancelTune">Cancel</button>
    </section>`;
  }
  return head + `
  <section class="group center">
    ${cello.err ? `<p class="warn">${esc(cello.err)}</p>` : ''}
    ${d.celloPts
      ? `<p class="done-note">✅ ${d.celloMin || 0} min logged today. +${PTS.cello} earned.</p>
         <button class="btn wide" data-a="celloAgain">Start another session</button>`
      : `<p class="lede">Tune each string, A, D, G and C. Once all four are in tune your session counts (+${PTS.cello}) and the timer starts.</p>
         <button class="btn primary wide" data-a="startTune">🎻 Start practice</button>`}
  </section>
  ${celloLog()}`;
};
function celloLog() {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const k = keyOf(addDays(new Date(), -i)), x = S.days[k];
    rows.push(`<div class="dot${x?.celloPts ? ' on' : ''}" title="${fmtDay(k)}"><span>${parseKey(k).toLocaleDateString([], { weekday: 'narrow' })}</span>${x?.celloMin ? `<small>${x.celloMin}m</small>` : ''}</div>`);
  }
  return `<section class="group"><h2>Last 10 days</h2><div class="dots">${rows.reverse().join('')}</div></section>`;
}

// ---------- STUDY ----------
let quiz = null; // { testId, items, i, results: [], answered: bool, retry: bool }
let ocrState = null; // { testId, progress }

VIEWS.study = () => {
  if (quiz) return quizView();
  const open = S.tests.find(t => t.id === studyOpen);
  if (open) return testView(open);
  const upcoming = S.tests.slice().sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const d = day();
  return `
  <header class="hero">
    <p class="eyebrow">Study</p>
    <h1>Tests</h1>
    <p class="lede">Add a test and photos of your study sheet. For the 3 days before it, Momentum quizzes you. ${PTS.passMark}%+ earns ${PTS.studyPass}, 100% earns ${PTS.studyPerfect}.${d.studyBest != null ? ` Today's best: ${d.studyBest}%.` : ''}</p>
  </header>
  <section class="group">
    ${upcoming.length ? upcoming.map(t => {
      const n = t.date ? daysUntil(t.date) : null;
      const when = n == null ? 'No date' : n < 0 ? 'Done' : n === 0 ? 'Today!' : n === 1 ? 'Tomorrow' : `In ${n} days`;
      return `<button class="task${n != null && n >= 1 && n <= 3 ? ' soon' : ''}" data-a="openTest" data-id="${t.id}">
        <span class="badge">${when}</span>
        <span class="tmain"><b>${esc(t.subject)}</b><small>${t.date ? fmtDay(t.date) : 'Practice anytime'} · ${plural((t.sheets || []).length, 'sheet')}</small></span>
        <span class="chev">›</span></button>`;
    }).join('') : `<p class="empty">No tests yet. Add your next one below.</p>`}
  </section>
  <section class="group">
    <h2>Add a test</h2>
    <form class="stack" data-form="addTest">
      <label>Subject<input id="testSubject" name="subject" required maxlength="40" placeholder="e.g. Science: cells"></label>
      <label>Test date<input id="testDate" name="date" type="date"></label>
      <button class="btn primary">Add test</button>
    </form>
  </section>`;
};
let studyOpen = null;

function testView(t) {
  const words = (t.text || '').trim().split(/\s+/).filter(Boolean).length;
  return `
  <header class="hero">
    <button class="back" data-a="closeTest">‹ Tests</button>
    <p class="eyebrow">${t.date ? fmtDay(t.date) : 'No date'}</p>
    <h1>${esc(t.subject)}</h1>
  </header>
  <section class="group">
    <h2>Study sheets</h2>
    <div class="sheets">
      ${(t.sheets || []).map(id => `<img data-photo="${id}" alt="Study sheet">`).join('')}
      <button class="addsheet" data-a="addSheet" data-id="${t.id}" ${ocrState ? 'disabled' : ''}>＋<small>Add photo</small></button>
    </div>
    ${ocrState && ocrState.testId === t.id ? `<p class="hint" id="ocrMsg">Reading your sheet… ${Math.round(ocrState.progress * 100)}%</p>` : ''}
  </section>
  <section class="group">
    <h2>Sheet text</h2>
    <p class="hint">This is what the quiz is made from. Fix any words the camera misread. Lines like <b>Term: meaning</b> make the best questions.</p>
    <textarea id="sheetText" data-id="${t.id}" rows="9" placeholder="Take a photo of your sheet, or type your notes here.">${esc(t.text || '')}</textarea>
    <button class="btn primary wide" data-a="startQuiz" data-id="${t.id}" ${words < 12 ? 'disabled' : ''}>Quiz me</button>
    ${words < 12 ? '<p class="hint">Add a sheet or some notes to make a quiz.</p>' : ''}
  </section>
  <section class="group">
    <button class="btn ghost danger" data-a="delTest" data-id="${t.id}" data-confirm="Tap again to delete">Delete test</button>
  </section>`;
}

function quizView() {
  const q = quiz.items[quiz.i];
  if (!q) return quizResults();
  const res = quiz.results[quiz.i];
  return `
  <header class="hero">
    <button class="back" data-a="quitQuiz">‹ Quit</button>
    <p class="eyebrow">Question ${quiz.i + 1} of ${quiz.items.length}${quiz.retry ? ' · Retry' : ''}</p>
    <div class="progress"><span style="width:${(quiz.i / quiz.items.length) * 100}%"></span></div>
  </header>
  <section class="group">
    <p class="qprompt">${esc(q.prompt)}</p>
    <blockquote class="qquote">${esc(q.quote)}</blockquote>
    ${q.type === 'mc' ? `<div class="answers">${q.options.map(o => {
      let cls = '';
      if (res) cls = o === q.answer ? ' right' : o === res.given ? ' wrong' : ' dim';
      return `<button class="ans${cls}" data-a="answer" data-v="${esc(o)}" ${res ? 'disabled' : ''}>${esc(o)}</button>`;
    }).join('')}</div>` : `
      <form class="inline" data-form="typed">
        <input id="typedAnswer" name="a" autocomplete="off" autocapitalize="off" placeholder="Type your answer" ${res ? 'disabled' : ''} value="${res ? esc(res.given) : ''}">
        ${res ? '' : '<button class="btn primary">Check</button>'}
      </form>`}
    ${res ? `<p class="feedback ${res.ok ? 'ok' : 'bad'}">${res.ok ? 'Correct!' : `Answer: <b>${esc(q.answer)}</b>`}</p>
      <button class="btn primary wide" data-a="nextQ">${quiz.i + 1 < quiz.items.length ? 'Next' : 'See score'}</button>` : ''}
  </section>`;
}

function quizResults() {
  const right = quiz.results.filter(r => r.ok).length;
  const pct = Math.round((right / quiz.items.length) * 100);
  const wrong = quiz.items.filter((q, i) => !quiz.results[i].ok);
  return `
  <header class="hero">
    <p class="eyebrow">${quiz.retry ? 'Retry finished' : 'Quiz finished'}</p>
    <h1>${pct}%</h1>
    <p class="lede">${right} of ${quiz.items.length} right. ${quiz.earned ? `+${quiz.earned} pts earned.` : quiz.retry ? 'Retries are for practice, no points.' : pct >= PTS.passMark ? 'No extra points: you already earned these today.' : `Get ${PTS.passMark}% to earn points.`}</p>
  </header>
  ${wrong.length ? `<section class="group"><h2>Check these</h2>${wrong.map(q => `<div class="card review"><p>${esc(q.source)}</p><small>Answer: <b>${esc(q.answer)}</b></small></div>`).join('')}</section>` : ''}
  <section class="group stack">
    ${wrong.length ? '<button class="btn primary wide" data-a="retryWrong">Retry the wrong ones</button>' : ''}
    <button class="btn wide" data-a="newQuiz">New quiz</button>
    <button class="btn ghost wide" data-a="quitQuiz">Back to test</button>
  </section>`;
}

function finishQuiz() {
  if (quiz.retry || quiz.scored) return;
  quiz.scored = true;
  const right = quiz.results.filter(r => r.ok).length;
  const pct = Math.round((right / quiz.items.length) * 100);
  const d = day();
  const prevPts = d.studyPts || 0;
  const earnedNow = pct >= 100 ? PTS.studyPerfect : pct >= PTS.passMark ? PTS.studyPass : 0;
  d.studyBest = Math.max(d.studyBest || 0, pct);
  // Only the best quiz of the day counts, so you can top up from 20 to 40.
  if (earnedNow > prevPts) {
    d.studyPts = earnedNow;
    quiz.earned = earnedNow - prevPts;
    award(quiz.earned, `Study quiz ${pct}%`);
  } else save();
}

let ocrLib = null;
function loadTesseract() {
  return ocrLib ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    s.onload = () => res(window.Tesseract);
    s.onerror = () => { ocrLib = null; rej(new Error('offline')); };
    document.head.appendChild(s);
  });
}

// ---------- GYM ----------
function wLevel(w) { return S.workout.levels[w.id] ?? 1; }
function target(item, level) {
  let name = D.EX[item.ex].name, from = 0;
  if (item.variants) for (const [lv, n] of item.variants) if (level >= lv) { name = n; from = lv; }
  const steps = level - from;
  switch (item.kind) {
    case 'weight': {
      const kg = S.workout.weights[item.ex];
      return { name, text: `${item.sets} × ${item.reps}`, kg, sets: item.sets };
    }
    case 'reps': {
      const sets = item.sets + (level >= 5 ? 1 : 0);
      return { name, text: `${sets} × ${item.reps + (item.step || 1) * steps}${item.unit ? ' ' + item.unit : ''}`, sets };
    }
    case 'hold': return { name, text: `${item.sets} × ${item.secs + item.step * level} s${item.unit ? ' ' + item.unit : ''}`, sets: item.sets };
    case 'time': return { name, text: `${item.mins} min`, sets: 1 };
    case 'rounds': {
      const r = item.rounds + Math.floor(level / item.every);
      return { name, text: `${r} rounds · ${item.work}`, sets: r };
    }
  }
}
const DAYNAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

VIEWS.gym = () => {
  const act = S.workout.active;
  const w = act ? D.WORKOUTS.find(x => x.id === act.wid) : D.WORKOUTS[S.workout.next];
  const lv = wLevel(w);
  const d = day();
  const doneToday = d.workouts || [];
  return `
  <header class="hero">
    <p class="eyebrow">${act ? 'Workout in progress' : doneToday.length ? 'Done today ✅' : workoutDayToday() ? 'Workout day' : 'Rest day'}</p>
    <h1>${esc(w.name)}</h1>
    <p class="lede">${esc(w.sub)} · ${lv ? `Level ${lv}` : "Starter level"}${act ? '' : ` · ${weekWorkouts()} of ${S.workout.days.length} this week`}</p>
  </header>
  ${act ? `<section class="group center">
    <div class="bigclock" id="gymClock">${fmtClock(Date.now() - act.start)}</div>
    <div class="row">
      <button class="btn" data-a="rest" data-s="60">Rest 60s</button>
      <button class="btn" data-a="rest" data-s="90">Rest 90s</button>
    </div>
    <p class="hint" id="restMsg"></p>
  </section>` : `<div class="chips">${D.WORKOUTS.map((x, i) => `<button class="chip${x.id === w.id ? ' on' : ''}" data-a="pickWorkout" data-i="${i}">${esc(x.name)}</button>`).join('')}</div>`}
  <section class="group">
    <h2>Exercises <span class="h-sub">tap one for how-to</span></h2>
    ${w.items.map((it, i) => {
      const t = target(it, lv);
      return `<div class="ex">
        <button class="exinfo" data-a="howto" data-ex="${it.ex}" data-name="${esc(t.name)}">
          <b>${esc(t.name)}</b><small>${t.text}${it.kind === 'weight' ? (t.kg ? ` · ${t.kg} kg` : ' · log your weight') : ''}</small>
        </button>
        ${act ? `<div class="sets">${Array.from({ length: t.sets }, (_, s) => `<button class="set${act.done[i + '-' + s] ? ' on' : ''}" data-a="set" data-k="${i}-${s}" aria-label="Set ${s + 1}">${s + 1}</button>`).join('')}</div>
          ${it.kind === 'weight' ? `<label class="kg">kg <input type="number" inputmode="decimal" step="0.5" min="0" id="kg-${it.ex}" data-kg="${it.ex}" value="${t.kg ?? ''}"></label>` : ''}` : ''}
      </div>`;
    }).join('')}
  </section>
  <section class="group">
    ${act ? `<button class="btn primary wide" data-a="finishWorkout">Finish workout</button>
      <button class="btn ghost wide" data-a="cancelWorkout" data-confirm="Tap again to cancel">Cancel workout</button>`
      : `<button class="btn primary wide" data-a="startWorkout" data-id="${w.id}">Start ${esc(w.name)}</button>
         <p class="hint">Earn 1 point per minute (up to ${WORKOUT_MAX_MIN}). After, rate it and the next one adjusts.</p>`}
  </section>
  ${act ? '' : `<section class="group">
    <h2>Workout days</h2>
    <div class="chips days">${[1, 2, 3, 4, 5, 6, 0].map(n => `<button class="chip${S.workout.days.includes(n) ? ' on' : ''}" data-a="toggleDay" data-n="${n}">${DAYNAMES[n]}</button>`).join('')}</div>
    <p class="hint">Gym safety: good form beats heavy weight. Never go for a max, and have an adult check your deadlift form.</p>
  </section>`}`;
};

function howto(exId, title) {
  const e = D.EX[exId];
  openSheet(`
    <h2>${esc(title || e.name)}</h2>
    <p class="works">${esc(e.works)}</p>
    <h3>How to do it</h3>
    <ol>${e.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
    <h3>Tips</h3>
    <ul>${e.tips.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    <h3>Watch out for</h3>
    <ul class="bad">${e.mistakes.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    ${e.safety ? `<p class="warn">${esc(e.safety)}</p>` : ''}
    <button class="btn wide" data-a="closeSheet">Got it</button>`);
}

// ---------- POINTS ----------
VIEWS.points = () => {
  const d = day();
  const used = d.ytMin || 0;
  const ytLeft = S.yt.until - Date.now();
  const earnedToday = S.ledger.filter(x => x.amt > 0 && keyOf(new Date(x.t)) === todayKey()).reduce((a, x) => a + x.amt, 0);
  const appUrl = location.href.split('#')[0];
  return `
  <header class="hero">
    <p class="eyebrow">Your points</p>
    <h1 class="bignum">🪙 ${S.points.toLocaleString()}</h1>
    <p class="lede">+${earnedToday} earned today.</p>
  </header>

  <section class="group">
    <h2>YouTube time</h2>
    <div class="card yt">
      ${ytLeft > 0 ? `<p class="unlocked">🔓 Unlocked: <b id="ytClock">${fmtClock(ytLeft)}</b> left</p>` : `<p>🔒 Locked. ${YT.ptsPerMin} points = 1 minute.</p>`}
      <div class="meter"><span style="width:${Math.min(100, (used / YT.dailyMax) * 100)}%"></span></div>
      <small>${used} of ${YT.dailyMax} min used today</small>
      <div class="buy">
        ${[5, 10, 15, 30].map(m => {
          const cost = m * YT.ptsPerMin;
          const ok = S.points >= cost && used + m <= YT.dailyMax;
          return `<button class="btn${ok ? '' : ' off'}" data-a="buyYT" data-m="${m}" ${ok ? '' : 'disabled'}>${m} min<small>${cost} pts</small></button>`;
        }).join('')}
      </div>
    </div>
    <details class="guide">
      <summary>${S.yt.shortcutReady ? '✅ iPhone shortcut set up' : 'Set up the YouTube lock (5 min)'}</summary>
      <p>This uses the iPhone <b>Shortcuts</b> app. If you open YouTube without unlocked time, it sends you back to your home screen to earn some.</p>
      <h3>1. Make the "${YT.shortcut}" shortcut</h3>
      <ol>
        <li>Open <b>Shortcuts</b>, tap <b>＋</b>, and name it exactly <b>${YT.shortcut}</b>.</li>
        <li>Add <b>Get Numbers from Input</b> (input: <i>Shortcut Input</i>).</li>
        <li>Add <b>Adjust Date</b>: <i>Add</i> <i>Numbers</i> <i>minutes</i> to <i>Current Date</i>.</li>
        <li>Add <b>Format Date</b>: <i>Adjusted Date</i>, format <i>ISO 8601</i>.</li>
        <li>Add <b>Save File</b>: save <i>Formatted Date</i> to the <i>Shortcuts</i> folder. Turn off <i>Ask Where to Save</i>, set the subpath to <b>momentum-unlock.txt</b>, and turn <b>Overwrite If File Exists</b> on.</li>
        <li>Add <b>Start Timer</b> for <i>Numbers</i> minutes.</li>
        <li>Add <b>Open App</b>: <i>YouTube</i>.</li>
      </ol>
      <h3>2. Make the automation</h3>
      <ol>
        <li>In Shortcuts, tap <b>Automation</b> → <b>＋</b> → <b>App</b>.</li>
        <li>Choose <b>YouTube</b>, tick <b>Is Opened</b>, pick <b>Run Immediately</b>, then <b>New Blank Automation</b>.</li>
        <li>Add <b>Get File</b> from <i>Shortcuts</i>, path <b>momentum-unlock.txt</b>, and turn off <i>Error If Not Found</i>.</li>
        <li>Add <b>Get Dates from Input</b> (input: <i>File</i>).</li>
        <li>Add <b>If</b>: <i>Dates</i> <b>is before</b> <i>Current Date</i>.</li>
        <li>Inside the If, add <b>Show Notification</b>: "🔒 Earn YouTube time in Momentum", then <b>Go to Home Screen</b>.</li>
        <li>Add a second <b>If</b>: <i>File</i> <b>does not have any value</b>, with the same two actions inside.</li>
      </ol>
      <h3>3. Stop videos when time's up</h3>
      <p>Open the <b>Clock</b> app → Timers → <b>When Timer Ends</b> → <b>Stop Playing</b>.</p>
      <p class="hint">Want it locked for real? Ask a parent to also add a Screen Time limit for YouTube with their passcode.</p>
      <label class="check"><input type="checkbox" id="ytReady" data-a="ytReady" ${S.yt.shortcutReady ? 'checked' : ''}> I've set up the shortcut (Momentum will run it when you buy time)</label>
      <p class="hint">Momentum's address: <span class="mono">${esc(appUrl)}</span></p>
    </details>
  </section>

  <section class="group">
    <h2>Big rewards</h2>
    ${S.rewards.map(r => {
      const pct = Math.min(100, (S.points / r.cost) * 100);
      return `<div class="card reward">
        <div class="rtop"><span class="remoji">${esc(r.emoji || '🎁')}</span><b>${esc(r.name)}</b><span class="rcost">${r.cost.toLocaleString()}</span></div>
        <div class="meter"><span style="width:${pct}%"></span></div>
        <div class="rbot">
          <small>${S.points >= r.cost ? 'You can get this!' : `${(r.cost - S.points).toLocaleString()} to go`}</small>
          <span>
            <button class="link" data-a="delReward" data-id="${r.id}" data-confirm="Remove?">Remove</button>
            <button class="btn small${S.points >= r.cost ? ' primary' : ' off'}" data-a="redeem" data-id="${r.id}" ${S.points >= r.cost ? '' : 'disabled'} data-confirm="Tap again to spend ${r.cost}">Redeem</button>
          </span>
        </div>
      </div>`;
    }).join('')}
    <form class="inline" data-form="addReward">
      <input id="rewardName" name="name" placeholder="New reward" maxlength="40" required autocomplete="off">
      <input id="rewardCost" name="cost" type="number" inputmode="numeric" min="10" step="10" placeholder="Points" required class="short">
      <button class="btn">Add</button>
    </form>
    ${S.redeemed.length ? `<p class="hint">Redeemed: ${S.redeemed.slice(0, 5).map(r => `${esc(r.name)} (${fmtDay(keyOf(new Date(r.t)))})`).join(', ')}</p>` : ''}
  </section>

  <section class="group">
    <h2>How to earn</h2>
    <div class="earn">
      <span>🦗 Feed ${pet()}</span><b>+${PTS.feed}</b>
      <span>🎻 Cello session</span><b>+${PTS.cello}</b>
      <span>🍳 Healthy breakfast</span><b>+${PTS.breakfast}</b>
      <span>🏋️ Workout</span><b>+1 / min</b>
      <span>📚 Quiz ${PTS.passMark}%+</span><b>+${PTS.studyPass}</b>
      <span>📚 Quiz 100%</span><b>+${PTS.studyPerfect}</b>
    </div>
  </section>

  <section class="group">
    <h2>History</h2>
    <div class="ledger">${S.ledger.slice(0, 30).map(x => `<div><span>${esc(x.why)}<small>${fmtDay(keyOf(new Date(x.t)))} ${fmtTime(x.t)}</small></span><b class="${x.amt > 0 ? 'plus' : 'minus'}">${x.amt > 0 ? '+' : ''}${x.amt}</b></div>`).join('') || '<p class="empty">Nothing yet. Feed ${pet()} to get your first 5!</p>'}</div>
  </section>

  <section class="group">
    <h2>Backup</h2>
    <p class="hint">Your data lives on this phone. Copy a backup now and then and paste it into Notes.</p>
    <div class="row">
      <button class="btn" data-a="exportData">Copy backup</button>
      <button class="btn" data-a="importOpen">Restore backup</button>
      <button class="btn" data-a="profileOpen">Change names</button>
    </div>
  </section>`;
};

// ---------- Actions ----------
const A = {
  tab: el => go(el.dataset.tab),
  goto: el => go(el.dataset.tab),
  closeSheet,

  feed() {
    const d = day();
    if (d.feed) { delete d.feed; award(-PTS.feed, `Undo: fed ${S.profile.pet || 'pet'}`); }
    else { d.feed = Date.now(); award(PTS.feed, `Fed ${S.profile.pet || 'pet'}`); }
    render();
  },
  spray() {
    const d = day();
    if (d.spray) delete d.spray; else { d.spray = Date.now(); toast(`${S.profile.pet || 'Your pet'} is nice and misty 💦`, true); }
    save(); render();
  },

  // Food
  meal(el) { S.food.meal = el.dataset.id; openSwap = -1; save(); render(); },
  swap(el) { const i = +el.dataset.i; openSwap = openSwap === i ? -1 : i; render(); },
  pick(el) {
    const meal = D.MEALS.find(m => m.id === S.food.meal);
    mealSel(meal)[+el.dataset.i] = +el.dataset.j;
    openSwap = -1; save(); render();
  },
  async ateBreakfast() {
    const meal = D.MEALS.find(m => m.id === S.food.meal) || D.MEALS[0];
    const photo = await snapAndSave(900, true);
    if (!photo) return toast('Take a photo of your breakfast to tick it off.');
    const d = day();
    if (d.breakfast) return;
    d.breakfast = { t: Date.now(), meal: mealName(meal), photo };
    award(PTS.breakfast, 'Healthy breakfast');
    render();
  },
  async snack(el) { await logSnack(el.dataset.name); },

  // Cello
  startTune() {
    cello.tuning = true; cello.done = [false, false, false, false]; cello.cur = 0; cello.err = '';
    render();
    Tuner.start();
  },
  pickString(el) { cello.cur = +el.dataset.i; Tuner.smooth = null; Tuner.holdStart = 0; render(); },
  cancelTune() { Tuner.stop(); cello.tuning = false; render(); },
  celloAgain() { S.cello.active = { start: Date.now() }; save(); render(); },
  celloDone() {
    const min = Math.max(1, Math.round((Date.now() - S.cello.active.start) / 60000));
    const d = day();
    d.celloMin = (d.celloMin || 0) + min;
    S.cello.active = null;
    save();
    toast(`${min} min of cello logged 🎻`, true);
    render();
  },

  // Study
  openTest(el) { studyOpen = el.dataset.id; quiz = null; if (tab !== 'study') go('study'); else render(); },
  closeTest() { saveSheetText(); studyOpen = null; render(); },
  async addSheet(el) {
    const t = S.tests.find(x => x.id === el.dataset.id);
    saveSheetText();
    const f = await pickPhoto(false);
    if (!f) return;
    const blob = await shrink(f, 1800, 0.85);
    const id = await Photos.put(blob);
    (t.sheets ||= []).push(id);
    save();
    ocrState = { testId: t.id, progress: 0 };
    render();
    try {
      const T = await loadTesseract();
      const r = await T.recognize(blob, 'eng', {
        logger: m => {
          if (m.status === 'recognizing text' && ocrState) {
            ocrState.progress = m.progress;
            const msg = $('#ocrMsg');
            if (msg) msg.textContent = `Reading your sheet… ${Math.round(m.progress * 100)}%`;
          }
        },
      });
      const text = r.data.text.replace(/\n{3,}/g, '\n\n').trim();
      t.text = ((t.text || '').trim() + '\n\n' + text).trim();
      save();
      toast('Sheet read. Check the text for mistakes.', true);
    } catch (e) {
      toast('Could not read the sheet. Are you online? You can type notes instead.');
    }
    ocrState = null;
    render();
  },
  delTest(el) {
    const t = S.tests.find(x => x.id === el.dataset.id);
    (t.sheets || []).forEach(id => Photos.del(id));
    S.tests = S.tests.filter(x => x !== t);
    studyOpen = null; save(); render();
  },
  startQuiz(el) {
    saveSheetText();
    const t = S.tests.find(x => x.id === el.dataset.id);
    const items = L.makeQuiz(t.text, { count: 8 });
    if (items.length < 4) return toast('Not enough to quiz on yet. Add more notes or a clearer photo.');
    quiz = { testId: t.id, items, i: 0, results: [], retry: false };
    render();
  },
  answer(el) {
    const q = quiz.items[quiz.i];
    quiz.results[quiz.i] = { given: el.dataset.v, ok: el.dataset.v === q.answer };
    render();
  },
  nextQ() {
    quiz.i++;
    if (quiz.i >= quiz.items.length) finishQuiz();
    render();
  },
  retryWrong() {
    const items = quiz.items.filter((q, i) => !quiz.results[i].ok);
    quiz = { testId: quiz.testId, items, i: 0, results: [], retry: true };
    render();
  },
  newQuiz() { A.startQuiz({ dataset: { id: quiz.testId } }); },
  quitQuiz() { studyOpen = quiz?.testId || studyOpen; quiz = null; render(); },

  // Gym
  pickWorkout(el) { S.workout.next = +el.dataset.i; save(); render(); },
  startWorkout(el) { S.workout.active = { wid: el.dataset.id, start: Date.now(), done: {} }; save(); render(); },
  set(el) {
    const k = el.dataset.k, done = S.workout.active.done;
    if (done[k]) delete done[k]; else done[k] = 1;
    save();
    el.classList.toggle('on', !!done[k]);
  },
  rest(el) {
    const secs = +el.dataset.s;
    clearInterval(A._rest);
    const end = Date.now() + secs * 1000;
    const tick = () => {
      const msg = $('#restMsg');
      const left = end - Date.now();
      if (!msg) return clearInterval(A._rest);
      if (left <= 0) { msg.textContent = 'Rest over. Next set!'; if (navigator.vibrate) navigator.vibrate([100, 60, 100]); clearInterval(A._rest); return; }
      msg.textContent = `Rest: ${fmtClock(left)}`;
    };
    tick();
    A._rest = setInterval(tick, 250);
  },
  finishWorkout() {
    openSheet(`<h2>How was it?</h2>
      <p class="hint">Your next workouts adjust to your answer.</p>
      <div class="stack">
        <button class="btn wide" data-a="rate" data-r="easy">😴 Too easy</button>
        <button class="btn wide primary" data-a="rate" data-r="right">👍 Just right</button>
        <button class="btn wide" data-a="rate" data-r="hard">😵 Too hard</button>
      </div>`);
  },
  rate(el) {
    const r = el.dataset.r, act = S.workout.active;
    const w = D.WORKOUTS.find(x => x.id === act.wid);
    const min = Math.min(WORKOUT_MAX_MIN, Math.max(1, Math.round((Date.now() - act.start) / 60000)));
    const d = day();
    const already = (d.workouts || []).reduce((a, x) => a + x.pts, 0);
    const pts = Math.max(0, Math.min(min, WORKOUT_MAX_MIN - already));
    (d.workouts ||= []).push({ wid: w.id, min, rating: r, pts });
    const delta = r === 'easy' ? 1 : r === 'hard' ? -1 : 0;
    S.workout.levels[w.id] = Math.max(0, Math.min(10, wLevel(w) + delta));
    let note = '';
    if (delta) for (const it of w.items) {
      if (it.kind !== 'weight' || !S.workout.weights[it.ex]) continue;
      S.workout.weights[it.ex] = Math.max(0, S.workout.weights[it.ex] + delta * it.inc);
      note = delta > 0 ? ' Weights go up next time.' : ' Weights go down next time.';
    }
    S.workout.active = null;
    S.workout.next = (D.WORKOUTS.indexOf(w) + 1) % D.WORKOUTS.length;
    closeSheet();
    if (pts) award(pts, `${w.name} (${min} min)`); else save();
    toast(`${w.name} done!${note}`, true);
    render();
  },
  cancelWorkout() { S.workout.active = null; save(); render(); },
  toggleDay(el) {
    const n = +el.dataset.n, days = S.workout.days;
    S.workout.days = days.includes(n) ? days.filter(x => x !== n) : [...days, n];
    save(); render();
  },
  howto(el) { howto(el.dataset.ex, el.dataset.name); },

  // Points
  buyYT(el) {
    const m = +el.dataset.m, d = day();
    if ((d.ytMin || 0) + m > YT.dailyMax) return toast(`Daily max is ${YT.dailyMax} minutes.`);
    if (!spend(m * YT.ptsPerMin, `YouTube ${m} min`)) return toast('Not enough points yet.');
    d.ytMin = (d.ytMin || 0) + m;
    S.yt.until = Math.max(Date.now(), S.yt.until) + m * 60000;
    save();
    render();
    if (S.yt.shortcutReady) {
      const total = Math.ceil((S.yt.until - Date.now()) / 60000);
      location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(YT.shortcut)}&input=text&text=${total}`;
    }
  },
  ytReady(el) { S.yt.shortcutReady = el.checked; save(); },
  redeem(el) {
    const r = S.rewards.find(x => x.id === el.dataset.id);
    if (!spend(r.cost, `Reward: ${r.name}`)) return;
    S.redeemed.unshift({ t: Date.now(), name: r.name, cost: r.cost });
    save();
    openSheet(`<div class="center"><p class="remoji big">${esc(r.emoji || '🎁')}</p><h2>${esc(r.name)} unlocked!</h2><p>Show this screen to a parent to cash it in.</p><p class="hint">${new Date().toLocaleString()}</p><button class="btn primary wide" data-a="closeSheet">Done</button></div>`);
    render();
  },
  delReward(el) { S.rewards = S.rewards.filter(x => x.id !== el.dataset.id); save(); render(); },
  async exportData() {
    const text = JSON.stringify(S);
    try { await navigator.clipboard.writeText(text); toast('Backup copied. Paste it into Notes.', true); }
    catch (e) { openSheet(`<h2>Backup</h2><p class="hint">Select all and copy.</p><textarea rows="8" readonly>${esc(text)}</textarea><button class="btn wide" data-a="closeSheet">Close</button>`); }
  },
  profileOpen() {
    openSheet(`<h2>${S.profile.name ? 'Change names' : 'Welcome to Momentum'}</h2>
      <p class="hint">These stay on this phone only.</p>
      <form class="stack" data-form="profile">
        <label>Your first name<input id="profileName" name="name" maxlength="20" autocomplete="off" value="${esc(S.profile.name)}"></label>
        <label>Your pet's name<input id="profilePet" name="pet" maxlength="20" autocomplete="off" value="${esc(S.profile.pet)}"></label>
        <button class="btn primary">Save</button>
      </form>`);
  },
  importOpen() {
    openSheet(`<h2>Restore backup</h2><p class="hint">Paste a backup. This replaces everything on this phone.</p>
      <textarea id="importText" rows="8"></textarea>
      <button class="btn primary wide" data-a="importDo">Restore</button>`);
  },
  importDo() {
    try {
      const s = JSON.parse($('#importText').value);
      if (!s || s.v !== 1) throw 0;
      localStorage.setItem(KEY, JSON.stringify(s));
      S = load();
      closeSheet(); render(); toast('Backup restored.', true);
    } catch (e) { toast('That doesn\'t look like a Momentum backup.'); }
  },
};

async function logSnack(name) {
  const photo = await snapAndSave(900, true);
  if (!photo) return toast('Snap a photo of your snack to log it.');
  (day().snacks ||= []).push({ t: Date.now(), name, photo });
  save();
  toast(`${name} logged 📸`, true);
  render();
}
function saveSheetText() {
  const ta = $('#sheetText');
  if (!ta) return;
  const t = S.tests.find(x => x.id === ta.dataset.id);
  if (t && t.text !== ta.value) { t.text = ta.value; save(); }
}

const FORMS = {
  profile(f) {
    S.profile = { name: f.name.value.trim(), pet: f.pet.value.trim(), set: true };
    save(); closeSheet(); render();
  },
  customSnack(f) { const n = f.name.value.trim(); if (n) logSnack(n); },
  addTest(f) {
    const t = { id: uid(), subject: f.subject.value.trim(), date: f.date.value || '', sheets: [], text: '' };
    if (!t.subject) return;
    S.tests.push(t); save();
    studyOpen = t.id; render();
  },
  typed(f) {
    const q = quiz.items[quiz.i];
    const given = f.a.value.trim();
    if (!given) return;
    quiz.results[quiz.i] = { given, ok: L.checkTyped(given, q.answer) };
    render();
  },
  addReward(f) {
    const name = f.name.value.trim(), cost = Math.round(+f.cost.value);
    if (!name || !(cost > 0)) return;
    const emoji = (name.match(/\p{Extended_Pictographic}/u) || ['🎁'])[0];
    S.rewards.push({ id: uid(), emoji, name: name.replace(/\p{Extended_Pictographic}/gu, '').trim() || name, cost });
    save(); render();
  },
};

// Two-tap confirm for anything destructive or that spends big points.
document.addEventListener('click', e => {
  if (e.target.id === 'sheet') return closeSheet();
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  if (el.dataset.confirm && !el.dataset.armed) {
    el.dataset.armed = '1';
    const old = el.textContent;
    el.textContent = el.dataset.confirm;
    setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.textContent = old; } }, 3000);
    return;
  }
  const fn = A[el.dataset.a];
  if (fn) fn(el, e);
});
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  FORMS[f.dataset.form]?.(f);
});
document.addEventListener('change', e => {
  const k = e.target.dataset?.kg;
  if (k) {
    const v = parseFloat(e.target.value);
    if (isFinite(v) && v >= 0) S.workout.weights[k] = v; else delete S.workout.weights[k];
    save();
  }
});
document.addEventListener('input', e => { if (e.target.id === 'sheetText') { clearTimeout(saveSheetText._t); saveSheetText._t = setTimeout(saveSheetText, 600); } });

// Live clocks without re-rendering the whole page.
setInterval(() => {
  const c = $('#celloClock'); if (c && S.cello.active) c.textContent = fmtClock(Date.now() - S.cello.active.start);
  const g = $('#gymClock'); if (g && S.workout.active) g.textContent = fmtClock(Date.now() - S.workout.active.start);
  const y = $('#ytClock'); if (y) { const left = S.yt.until - Date.now(); if (left > 0) y.textContent = fmtClock(left); else render(); }
  if (period() !== document.documentElement.dataset.period) render();
}, 1000);
// New day while the app sits open: redraw so the checklist resets.
let lastDay = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && todayKey() !== lastDay) { lastDay = todayKey(); render(); }
});

navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
render();
if (!S.profile.set) A.profileOpen();
