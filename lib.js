// Pure helpers (no DOM): pitch detection and quiz building.
// Loaded by the app as a script, and by Node for tests.
(function (root) {
  'use strict';

  // ---------- Pitch detection ----------
  // Normalised autocorrelation (NSDF) searched only between minF and maxF.
  // Keeping the window under one octave around the target string stops
  // the cello's strong overtones from being mistaken for the note.
  function detectPitch(buf, sampleRate, minF, maxF) {
    const N = buf.length;
    let rms = 0;
    for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / N);
    if (rms < 0.008) return null;

    const minT = Math.max(2, Math.floor(sampleRate / maxF));
    const maxT = Math.min(Math.floor(N / 2), Math.ceil(sampleRate / minF));
    const W = N - maxT - 1;
    const vals = new Float32Array(maxT + 2);
    let best = -1, bestT = -1;
    for (let t = minT - 1; t <= maxT + 1; t++) {
      let acf = 0, m = 0;
      for (let i = 0; i < W; i++) {
        const a = buf[i], b = buf[i + t];
        acf += a * b;
        m += a * a + b * b;
      }
      const v = m > 0 ? (2 * acf) / m : 0;
      vals[t] = v;
      if (t >= minT && t <= maxT && v > best) { best = v; bestT = t; }
    }
    // A peak on the edge of the window means the real note is outside it.
    if (bestT <= minT || bestT >= maxT || best < 0.5) return null;
    const a = vals[bestT - 1], b = vals[bestT], c = vals[bestT + 1];
    const d = a - 2 * b + c;
    const shift = d ? (0.5 * (a - c)) / d : 0;
    return { freq: sampleRate / (bestT + shift), clarity: best, rms };
  }

  const cents = (freq, target) => 1200 * Math.log2(freq / target);

  // ---------- Quiz building ----------
  const STOP = new Set(('the a an and or but of to in on at for with by from as is are was were be been being ' +
    'this that these those it its into than then there their they them he she his her we you your our not no yes ' +
    'can could should would will may might must do does did done has have had which who whom whose what when where ' +
    'why how all any each some such more most other also only very so if about over under between during after ' +
    'before up down out off again once both few own same too just like make made many much used uses use called ' +
    'because while within without where every first second third one two three four five').split(' '));

  function sentencesOf(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/([.!?])\s+/g, '$1\n')
      .split(/\n+/)
      .map(s => s.replace(/[•·▪●◦•]/g, ' ').replace(/^\s*(?:\d+[.)]|[-*])\s+/, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  // "Term: definition", "Term - definition", "Term = definition"
  function definitionsOf(lines) {
    const out = [];
    for (const line of lines) {
      const m = line.match(/^(.{2,40}?)\s*(?::|\s[-–—]\s|=)\s*(.{8,})$/);
      if (!m) continue;
      const term = m[1].trim(), def = m[2].trim().replace(/[.]$/, '');
      if (term.split(' ').length > 5) continue;
      out.push({ term, def });
    }
    return out;
  }

  const isNum = w => /^\d/.test(w);

  function tokensOf(sentence) {
    return sentence.match(/\d[\d.,]*%?|[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*[A-Za-zÀ-ÿ]/g) || [];
  }

  function scoreWord(w, idx) {
    const lower = w.toLowerCase();
    if (isNum(w)) return 5;
    if (STOP.has(lower) || w.length < 4) return 0;
    let s = 1;
    if (idx > 0 && /^[A-Z]/.test(w)) s += 3;
    if (w.length >= 8) s += 2; else if (w.length >= 6) s += 1;
    return s;
  }

  function pickKeyword(sentence, rand) {
    const toks = tokensOf(sentence);
    let best = null, bestScore = 0;
    toks.forEach((w, i) => {
      const s = scoreWord(w, i) + rand() * 0.5;
      if (s > bestScore && scoreWord(w, i) > 0) { best = w; bestScore = s; }
    });
    return best;
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function fakeNumbers(answer, rand) {
    const n = parseFloat(answer.replace(/,/g, ''));
    const suffix = answer.endsWith('%') ? '%' : '';
    if (!isFinite(n)) return [];
    const out = new Set();
    const tries = [n + 1, n - 1, n * 2, Math.round(n / 2), n + 10, n - 10, n + 5, Math.round(n * 1.5), n + 100, n - 100];
    for (const t of shuffle(tries, rand)) {
      if (t !== n && t >= 0) out.add(String(Number.isInteger(n) ? Math.round(t) : +t.toFixed(2)) + suffix);
      if (out.size >= 3) break;
    }
    return [...out];
  }

  function distractorsFor(answer, pool, rand) {
    const lower = answer.toLowerCase();
    const same = pool.filter(w => w.toLowerCase() !== lower && isNum(w) === isNum(answer));
    const uniq = [...new Map(same.map(w => [w.toLowerCase(), w])).values()];
    // Prefer words of a similar length so the answer doesn't stand out.
    uniq.sort((a, b) => Math.abs(a.length - answer.length) - Math.abs(b.length - answer.length) + (rand() - 0.5) * 3);
    let picks = uniq.slice(0, 3);
    if (picks.length < 3 && isNum(answer)) picks = picks.concat(fakeNumbers(answer, rand)).slice(0, 3);
    return picks;
  }

  function blankOut(sentence, word) {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return sentence.replace(new RegExp('(^|[^A-Za-zÀ-ÿ0-9])' + esc + '(?![A-Za-zÀ-ÿ0-9])'), '$1_____');
  }

  function makeQuiz(text, opts) {
    const count = (opts && opts.count) || 8;
    const rand = (opts && opts.rand) || Math.random;
    const lines = sentencesOf(text);
    const defs = definitionsOf(lines);
    const defLines = new Set(defs.map(d => d.term + '|' + d.def));
    const questions = [];

    // Term/definition questions
    const terms = defs.map(d => d.term);
    for (const d of defs) {
      const others = shuffle(terms.filter(t => t.toLowerCase() !== d.term.toLowerCase()), rand).slice(0, 3);
      if (others.length >= 2) {
        questions.push({ type: 'mc', prompt: 'Which term matches this?', quote: d.def, answer: d.term, options: shuffle([d.term, ...others], rand), source: d.term + ': ' + d.def });
      } else {
        questions.push({ type: 'type', prompt: 'What is the term for this?', quote: d.def, answer: d.term, source: d.term + ': ' + d.def });
      }
    }

    // Fill-in-the-blank questions from ordinary sentences
    const plain = lines.filter(l => {
      const m = l.match(/^(.{2,40}?)\s*(?::|\s[-–—]\s|=)\s*(.{8,})$/);
      if (m && defLines.has(m[1].trim() + '|' + m[2].trim().replace(/[.]$/, ''))) return false;
      return l.split(' ').length >= 5 && l.length >= 25;
    });
    const pool = [];
    for (const l of lines) tokensOf(l).forEach((w, i) => { if (scoreWord(w, i) >= 2) pool.push(w); });
    for (const s of plain) {
      const kw = pickKeyword(s, rand);
      if (!kw) continue;
      const blanked = blankOut(s, kw);
      if (blanked === s) continue;
      const shown = new Set(tokensOf(blanked).map(w => w.toLowerCase()));
      const ds = distractorsFor(kw, pool.filter(w => !shown.has(w.toLowerCase())), rand);
      if (ds.length >= 3) {
        questions.push({ type: 'mc', prompt: 'Fill in the blank', quote: blanked, answer: kw, options: shuffle([kw, ...ds], rand), source: s });
      } else {
        questions.push({ type: 'type', prompt: 'Fill in the blank', quote: blanked, answer: kw, source: s });
      }
    }

    let picked = shuffle(questions, rand).slice(0, count);
    // Make sure about a quarter of the quiz is typed answers, not just guessing.
    const wantTyped = Math.max(1, Math.round(picked.length / 4));
    let typed = picked.filter(q => q.type === 'type').length;
    for (const q of picked) {
      if (typed >= wantTyped) break;
      if (q.type === 'mc' && !isNum(q.answer) && q.answer.length >= 4) {
        q.type = 'type';
        delete q.options;
        if (q.prompt === 'Which term matches this?') q.prompt = 'What is the term for this?';
        typed++;
      }
    }
    return picked;
  }

  function levenshtein(a, b) {
    const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return dp[b.length];
  }

  // Accept small typos: 1 letter off for 5+ letters, 2 for 10+.
  function checkTyped(input, answer) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9à-ÿ]/g, '');
    const a = norm(input), b = norm(answer);
    if (!a) return false;
    if (a === b) return true;
    const allowed = b.length >= 10 ? 2 : b.length >= 5 ? 1 : 0;
    return levenshtein(a, b) <= allowed;
  }

  const lib = { detectPitch, cents, makeQuiz, checkTyped, sentencesOf, definitionsOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = lib;
  else root.MomentumLib = lib;
})(this);
