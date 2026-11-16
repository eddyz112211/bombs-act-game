/* Bombs Act — original remake. Canvas 2D + Web Audio, no dependencies. */
(() => {
'use strict';

// ======================================================================
// Utilities
// ======================================================================
const $ = (s) => document.querySelector(s);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const easeOutBack = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
};
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ======================================================================
// Rules (Classic) — numbers from the brief
// ======================================================================
// The brief's step table (kept for reference; no longer drives play):
//   [2.5,78,9] [1.98,96,8.25] [1.56,115,7.5] [1.23,133,6.75] [1.0,151,6] [0.8,170,5.25] [0.6,188,4.5] [0.4,206,3.75] [0.2,225,3.5]
// It started slow and ended at ~11 bombs/s at 225 px/s, faster than anyone can drag. Pacing is now one smooth
// curve by score (see pace()): a quicker start, then speed levels off so bombs stay grabbable, and the
// pressure keeps creeping up through bomb count and fuse length instead.
const BASE_SPEED = 78;
const PACE = {
  rate0: 0.65, rateAdd: 1.0, rateK: 40, rateCreep: 0.0004, // bombs per second
  speed0: 88, speedAdd: 54, speedK: 55,                   // px/s ×scale, tops out near 142
  fuseMin: 4.6, fuseAdd: 4.0, fuseK: 90,                   // seconds, 8.6 → 4.6
};
function pace(score) {
  const P = PACE;
  return {
    rate: P.rate0 + P.rateAdd * (1 - Math.exp(-score / P.rateK)) + P.rateCreep * score,
    speed: P.speed0 + P.speedAdd * (1 - Math.exp(-score / P.speedK)),
    fuse: P.fuseMin + P.fuseAdd * Math.exp(-score / P.fuseK),
  };
}
const CYCLES = ['SSS', 'DSS', 'DSS', 'DSD', 'DSD', 'DDD', 'DDD', 'DTD', 'DTD'];
const CNT = { S: 1, D: 2, T: 3 };
function tierFor(score) {
  if (score < 40) return Math.floor(score / 10);
  if (score >= 1000) return 8;
  if (score >= 300) return 7;
  if (score >= 150) return 6;
  if (score >= 80) return 5;
  return 4;
}
const CAP = 16, CLEAR_EVERY = 20, CLEAR_DELAY = 0.42, FIRST_SPAWN = 0.35, WARN_FUSE = 3;
const FREEZE_DUR = 7, FREEZE_EXTRA = 4, THAW_WARN = 4, ICE_BURST_DUR = 10;
const CLOCK_DUR = 10, CLOCK_SCALE = 0.25;
const HOLE_DUR = 1.55;
const MAGNET_START = 5, MAGNET_SPEED = 8; // magnets are cards now: each use is 5s, never stacked
// ---- power cards (Classic + Daily) ----
// 12 tray slots, one per power. 11 powers exist; the last slot is kept free for a future one.
const SLOT_KINDS = ['white', 'clock', 'defuse', 'void', 'magnet', 'paint', 'fan', 'swap', 'shield', 'auto', 'double', 'rewind'];
const RARITY = { white: 0, clock: 0, defuse: 0, void: 1, magnet: 1, paint: 1, fan: 1, swap: 1, shield: 2, auto: 2, double: 2, rewind: 2 };
const TARGETED = new Set(['void', 'defuse', 'magnet', 'paint', 'swap']); // tap the card, then tap the board
const NEW_POWERS = new Set(['defuse', 'magnet', 'paint', 'fan', 'swap', 'shield', 'auto', 'double', 'rewind']);
// Power director (Classic + Daily): one power every 10–15 s of play instead of rolls on every wave.
// Commons from 8 points, uncommons from 20, rares from 40. Holding lots of cards slows the drops.
// (The gap was 10–15 s before the combo meter, gifts, missions and bosses started handing out cards too.)
const POWER_START = 8, POWER_GAP = [18, 26], POWER_RETRY = 2, POWER_HOARD = 0.12;
const POWER_UNLOCK = [8, 20, 40]; // score needed for common / uncommon / rare
const POWER_WEIGHTS = [['white', 3], ['clock', 3], ['defuse', 2], ['void', 2], ['magnet', 2], ['paint', 1.5], ['fan', 1.5], ['swap', 1.2], ['shield', 0.8], ['auto', 0.5], ['double', 0.8], ['rewind', 0.6]];
// how much faster than the color bombs each power moves (speed is capped, so these stay catchable)
const POWER_SPEED = { white: 1.5, clock: 1.2, defuse: 1.1, void: 1.6, magnet: 1.35, paint: 1.35, fan: 1.35, swap: 1.35, shield: 1.7, auto: 1.7, double: 1.7, rewind: 1.7 };
// ---- skill rewards ----
const METER_MAX = 24;                 // quick sorts (combo x2 or better) needed for a free card
const CLUTCH_FUSE = 0.6, CLUTCH_SLOW = 0.45, CLUTCH_SCALE = 0.35; // grab with this little fuse left = clutch save
const SORT_SCALE = [0, 2, 4, 7, 9, 12, 14, 16]; // semitones: the sort sound climbs with the combo
// ---- special color bombs (Classic/Daily/Race): [kind, score that unlocks it, weight] ----
const SPECIALS = [['gift', 10, 1], ['cham', 20, 2], ['heavy', 30, 2], ['twin', 40, 2]];
const SPECIAL_MAX = 3, CHAM_EVERY = 3, HEAVY_SPEED = 0.45, HEAVY_FUSE = 0.7, HEAVY_SIZE = 1.3, HEAVY_DRAG = 560;
const TWIN_SIZE = 1.15, TWIN_SPLIT_AT = 0.45, TWIN_CHILD = 0.74;
const specialChance = (score) => clamp(0.05 + score * 0.0012, 0, 0.2);
// ---- arena events: one starts after every pen clear ----
const EVENT_DUR = 15, EVENT_KINDS = ['rush', 'calm', 'wind', 'swap'];
const RUSH_RATE = 1.5, CALM_RATE = 0.6, CALM_SPEED = 0.6, WIND_SPEED = 50, SWAP_WARN = 3.5, SWAP_DUR = 5.5, SWAP_FLASH = 2;
const EVENT_NAME = { rush: 'RUSH! x2 POINTS', calm: 'CALM', wind: 'WIND!', swap: 'PEN SWAP!' };
// ---- boss bomb ----
const BOSS_EVERY = 100, BOSS_FUSE = 11, BOSS_SIZE = 1.9, BOSS_SPEED = 0.5, BOSS_POINTS = 5;
const bossHp = (n) => Math.min(6 + 2 * n, 12); // n = bosses already beaten this run
// four kinds of boss, dealt from a shuffled bag so each shows up before any repeats
const BOSS_TYPES = ['tap', 'split', 'color', 'thief'];
const SPLIT_HP = 4, MINI_HP = 2, MINI_SIZE = 1.05, MINI_SPEED = 0.85;   // splitter: 4 taps, then three minis of 2 taps each
const COLOR_HP = 4, COLOR_FUSE = 16;                                     // color boss: feed it 4 bombs of the color it shows
const THIEF_HP = 6, THIEF_SIZE = 1.5, THIEF_SPEED = 0.9, THIEF_EVERY = 2.2, THIEF_FUSE = 13; // thief: steals a sorted bomb every 2.2 s
// ---- rewind ----
const REWIND_SECS = 3, HIST_STEP = 0.2;
// ---- 1v1 race ----
const JUNK_EVERY = 3; // every 3rd sort sends one junk bomb to each rival
const MAX_STACK = 3, MAX_FLOOR_POWERS = 2, DEFUSE_COUNT = 8, PAINT_COUNT = 5, DOUBLE_DUR = 10, RARE_LIFE = 4;
const GRAB_LAG = 0.1; // seconds: a tap also counts where a bomb was this long ago (finger lag on fast bombs)
const RARE_SIZE = 1.18, POWER_SIZE = 0.66, BOOM_TIME = 1.02, THAW_BOOM_FUSE = 0.3;
const STEP = 1 / 60;
const SORT = ['red', 'blue', 'yellow', 'green'];
const isSort = (k) => k === 'red' || k === 'blue' || k === 'yellow' || k === 'green';
const KEY_BEST = 'bombs-act-best', KEY_MUTE = 'bombs-act-mute', KEY_NAME = 'bombs-act-name', KEY_BOARD = 'bombs-act-board';
const KEY_TUTORIAL = 'bombs-act-tutorial', KEY_SEEN = 'bombs-act-seen';
const COMBO_WINDOW = 2.0, DANGER_FUSE = 1.2;
const MODE_LABEL = { classic: 'Classic', daily: 'Daily Challenge', race: '1v1 Race' };
const bestKey = (m) => (m === 'classic' ? KEY_BEST : m === 'race' ? 'bombs-act-best-race' : 'bombs-act-best-daily-' + dailyKey());
const KEY_TOTAL = 'bombs-act-total', KEY_LOOKS = 'bombs-act-looks';
function dailyKey() { return new Date().toISOString().slice(0, 10); } // UTC date, same worldwide
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const vibrate = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* not allowed here */ } };
const IS_TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// ======================================================================
// Art palette
// ======================================================================
const INK = '#1d1033';
const PAL = {
  red:    { base: '#ff4f64', shade: '#c8264a', light: '#ffc2c8', iris: '#8c1236', name: 'RED' },
  blue:   { base: '#3d8bff', shade: '#2350c4', light: '#bfdcff', iris: '#10357f', name: 'BLUE' },
  yellow: { base: '#ffd338', shade: '#e3960f', light: '#fff1a8', iris: '#7a4b00', name: 'YELLOW' },
  green:  { base: '#36d57a', shade: '#169652', light: '#c0f5d4', iris: '#0b5530', name: 'GREEN' },
  white:  { base: '#dff4ff', shade: '#8ec0e6', light: '#ffffff', sym: '#1a6fbf', aura: '#5fd2ff' },
  clock:  { base: '#e0a63e', shade: '#a8681b', light: '#ffe7ad', sym: INK, aura: '#ffc35a' },
  void:   { base: '#5a2f93', shade: '#1e0b3f', light: '#b48cff', sym: '#efe4ff', aura: '#b48cff' },
  defuse: { base: '#cdd3de', shade: '#7b8496', light: '#ffffff', sym: '#ffffff', aura: '#9aa6be' },
  magnet: { base: '#ff6f91', shade: '#c23b62', light: '#ffd0dc', sym: '#ffffff', aura: '#ff7fa6' },
  paint:  { base: '#ff9ee6', shade: '#c4549f', light: '#ffe0f6', sym: '#ffffff', aura: '#ff6fdc' },
  fan:    { base: '#9fe8ff', shade: '#3f9fc8', light: '#e6faff', sym: '#ffffff', aura: '#5fd6ff' },
  shield: { base: '#ffe27a', shade: '#cf9516', light: '#fff6c8', sym: '#ffffff', aura: '#ffc93d' },
  auto:   { base: '#f4f0ff', shade: '#a996e8', light: '#ffffff', sym: '#ffffff', aura: '#c49bff' },
  double: { base: '#ffb347', shade: '#d16a12', light: '#ffe2b8', sym: '#ffffff', aura: '#ff9a1f' },
  swap:   { base: '#7de3c8', shade: '#2a9c86', light: '#dcfff5', sym: '#ffffff', aura: '#35d6b0' },
  rewind: { base: '#8f9bff', shade: '#4a4fc4', light: '#dfe3ff', sym: '#ffffff', aura: '#7c86ff' },
  boss:   { base: '#4a3f5c', shade: '#1d1033', light: '#8a7aa6', sym: '#ffffff', aura: '#ff3b5c' },
  junk:   { base: '#a9a3b5', shade: '#6c657a', light: '#e2deea', sym: '#ffffff', aura: '#8d86a0' },
  // arena events (HUD chips only)
  rush:   { aura: '#ff5a3c' }, calm: { aura: '#4fc9a0' }, wind: { aura: '#59b8ff' },
};
const RARITY_STYLE = [ // card face + border per rarity: common, uncommon, rare
  { face: '#fffaf2', edge: INK, label: 'COMMON' },
  { face: '#efe4ff', edge: '#6a3fc2', label: 'UNCOMMON' },
  { face: '#fff1a8', edge: '#d18a00', label: 'RARE' },
];
const FONT_FX = 'Bangers, Impact, sans-serif';
const FONT_UI = '"M PLUS Rounded 1c", system-ui, sans-serif';

// ======================================================================
// Canvas & layout (everything in CSS px; backing store scaled by DPR)
// ======================================================================
const cv = $('#game');
const ctx = cv.getContext('2d');
const bg = document.createElement('canvas');
const bgx = bg.getContext('2d');
let W = 0, H = 0, DPR = 1, SCALE = 1, R = 20, HUD = 56, MARGIN = 10, LW = 3;
let A = { x: 0, y: 0, w: 1, h: 1 };
let PENS = [];       // the four color pens, in SORT order
let BLOCKS = [];     // every pen floor bombs bounce off
let TRAY = null;     // power-card tray layout (Classic/Daily)
let METER = null;    // combo-meter bar between the board and the tray
let PANEL = null;    // missions / rivals panel, where the screen has room for one
let game = 'classic'; // classic | daily | race
let theme = 0;
// which color sits in which corner (top-left, top-right, bottom-left, bottom-right); pen swaps change it
let penColors = ['red', 'blue', 'yellow', 'green'];
const penOf = (c) => PENS.find((p) => p.color === c);
const penAt = (p) => PENS.find((q) => p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h) || null;

function mkPen(color, x, y, sx, sy, P) {
  const ix = sx > 0 ? x + P : x, iy = sy > 0 ? y + P : y; // inner corner (faces center)
  const ox = sx > 0 ? x : x + P, oy = sy > 0 ? y : y + P; // outer corner
  const gapW = 0.244 * P, gapH = 0.32 * P;
  const walls = [
    [ix, oy, ix, iy - sy * gapH],     // inner vertical fence (gap near inner corner)
    [ox, iy, ix - sx * gapW, iy],     // inner horizontal fence (gap near inner corner)
  ];
  // diagonal "foot" stepping into the arena from the horizontal fence tip, slope 0.726
  const fx = ix - sx * gapW, fl = 0.22 * P, n = Math.hypot(1, 0.726);
  const foot = [fx, iy, fx + (sx * fl) / n, iy + (sy * fl * 0.726) / n];
  return { color, x, y, w: P, h: P, sx, sy, ix, iy, ox, oy, walls, foot, cx: x + P / 2, cy: y + P / 2 };
}

function resize() {
  const oldA = A, oldPens = PENS, oldR = R;
  const rect = cv.getBoundingClientRect();
  W = Math.max(200, rect.width); H = Math.max(200, rect.height);
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  const mn = Math.min(W, H);
  SCALE = mn / 780;
  HUD = clamp(mn * 0.085, 46, 66);
  MARGIN = clamp(mn * 0.02, 6, 18);
  LW = clamp(mn * 0.0075, 2.2, 6);
  // compact, uniform board: a centered square with four identical pens, right under the HUD,
  // then the combo meter and the 12-slot power tray (one row when there is room, otherwise two rows of six)
  const gap = clamp(mn * 0.008, 3, 8), maxW = Math.min(W - 2 * MARGIN, 900);
  let rows = 1, cw = (maxW - gap * 11) / 12;
  if (cw < 46) { rows = 2; cw = (maxW - gap * 5) / 6; }
  cw = Math.min(cw, 66, (H * 0.2) / (1.22 * rows));
  const ch = cw * 1.22;
  const tray = { rows, cols: 12 / rows, cw, ch, gap, h: rows * ch + (rows - 1) * gap };
  const meterH = clamp(mn * 0.02, 9, 14);
  const availW = W - 2 * MARGIN, availH = H - HUD - MARGIN * 1.4 - (tray.h + MARGIN * 0.8 + meterH + MARGIN * 0.5);
  const side = Math.min(availW, availH);
  A = { x: (W - side) / 2, y: HUD + MARGIN * 0.4, w: side, h: side };
  const tw = tray.cols * tray.cw + (tray.cols - 1) * tray.gap;
  METER = { x: (W - tw) / 2, y: A.y + side + MARGIN * 0.6, w: tw, h: meterH };
  tray.x = (W - tw) / 2; tray.y = METER.y + meterH + MARGIN * 0.7; tray.w = tw;
  tray.slots = SLOT_KINDS.map((kind, i) => {
    const c = i % tray.cols, r = Math.floor(i / tray.cols);
    return { kind, i, x: tray.x + c * (tray.cw + tray.gap), y: tray.y + r * (tray.ch + tray.gap), w: tray.cw, h: tray.ch };
  });
  TRAY = tray;
  // missions / rivals panel: under the tray on tall screens, beside the board on wide ones
  PANEL = null;
  const below = H - (tray.y + tray.h) - MARGIN * 1.6, beside = A.x - MARGIN * 2;
  if (below >= 62) PANEL = { x: tray.x, y: tray.y + tray.h + MARGIN * 0.8, w: tw, h: Math.min(below, 120), wide: true };
  else if (beside >= 128) PANEL = { x: MARGIN, y: A.y, w: Math.min(beside, 230), h: Math.min(A.h, 300), wide: false };
  const P = side * 0.36;
  R = clamp(side * (side < 520 ? 0.056 : 0.048), 15, 34); // bigger on phones
  PENS = [
    mkPen(penColors[0], A.x, A.y, 1, 1, P),
    mkPen(penColors[1], A.x + A.w - P, A.y, -1, 1, P),
    mkPen(penColors[2], A.x, A.y + A.h - P, 1, -1, P),
    mkPen(penColors[3], A.x + A.w - P, A.y + A.h - P, -1, -1, P),
  ];
  BLOCKS = PENS;
  // keep bombs in place proportionally if a run is live
  if (S && oldPens.length) {
    for (const b of S.bombs) {
      if (b.state === 'sorted') {
        const op = b.pen, np = PENS[Math.max(0, oldPens.indexOf(b.pen))]; // same corner as before
        b.x = np.x + ((b.x - op.x) / op.w) * np.w; b.y = np.y + ((b.y - op.y) / op.h) * np.h; b.pen = np;
      } else {
        b.x = A.x + ((b.x - oldA.x) / oldA.w) * A.w; b.y = A.y + ((b.y - oldA.y) / oldA.h) * A.h;
      }
      b.r = R * b.mult; b.speed = b.state === 'sorted' ? sortedSpeed() : bombSpeed(b);
    }
    if (S.swapPick) S.swapPick = PENS[Math.max(0, oldPens.indexOf(S.swapPick))];
    if (S.event && S.event.kind === 'swap') { S.event.a = PENS[Math.max(0, oldPens.indexOf(S.event.a))]; S.event.b = PENS[Math.max(0, oldPens.indexOf(S.event.b))]; }
    for (const h of S.holes) { h.x = A.x + ((h.x - oldA.x) / oldA.w) * A.w; h.y = A.y + ((h.y - oldA.y) / oldA.h) * A.h; h.r = holeRadius(); }
  }
  if (decor.length) initDecor();
  if (oldR !== R || !petals.length) initPetals();
  buildBg();
}

// ======================================================================
// Audio — generated SFX + a 124 BPM chiptune loop
// ======================================================================
const Sound = (() => {
  let ac = null, master, musicBus, sfxBus, noiseBuf;
  let muted = store.get(KEY_MUTE) === '1';
  let musicOn = false, nextT = 0, stepI = 0, timer = null;
  const BPM = 124, S16 = 60 / BPM / 4;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
  const MEL = [
    { 0: 76, 3: 74, 6: 72, 8: 74, 10: 76, 12: 81, 14: 79 },
    { 0: 77, 3: 76, 6: 74, 8: 72, 10: 74, 12: 72, 14: 69 },
    { 0: 72, 3: 74, 6: 76, 8: 79, 10: 76, 12: 74, 14: 72 },
    { 0: 74, 3: 76, 6: 79, 8: 83, 10: 81, 12: 79, 14: 74 },
  ];

  function unlock() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ac = new AC(); } catch (e) { return; }
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.9;
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp); comp.connect(ac.destination);
      musicBus = ac.createGain(); musicBus.gain.value = 0.2; musicBus.connect(master);
      sfxBus = ac.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
  }
  function osc(at, f, dur, { type = 'square', v = 0.25, to = 0, out = sfxBus, a = 0.004 } = {}) {
    if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(v, at + a);
    g.gain.exponentialRampToValueAtTime(0.0001, at + a + dur);
    o.connect(g); g.connect(out); o.start(at); o.stop(at + a + dur + 0.05);
  }
  function noise(at, dur, { v = 0.3, f = 2000, type = 'lowpass', q = 0.8, to = 0, out = sfxBus } = {}) {
    if (!ac) return;
    const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; fl.type = type; fl.frequency.setValueAtTime(f, at); fl.Q.value = q;
    if (to) fl.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(v, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(fl); fl.connect(g); g.connect(out); s.start(at, Math.random() * 0.5); s.stop(at + dur + 0.05);
  }
  function play(name, arg) {
    if (!ac || muted) return;
    const t = ac.currentTime;
    switch (name) {
      case 'pick': osc(t, 520, 0.07, { v: 0.18, to: 880 }); break;
      case 'drop': osc(t, 400, 0.06, { v: 0.12, type: 'triangle', to: 260 }); break;
      case 'sort': { // arg = combo count: each quick sort in a row plays a step higher
        const k = Math.pow(2, SORT_SCALE[clamp((arg || 1) - 1, 0, SORT_SCALE.length - 1)] / 12) * 0.8;
        osc(t, 988 * k, 0.08, { v: 0.16 }); osc(t + 0.07, 1319 * k, 0.14, { v: 0.16 });
        if (arg >= 5) osc(t + 0.07, 1976 * k, 0.12, { v: 0.06, type: 'triangle' });
        break;
      }
      case 'clutch': [1175, 1568, 2349].forEach((f, i) => osc(t + i * 0.045, f, 0.16, { v: 0.16, type: 'triangle' })); noise(t, 0.2, { v: 0.12, f: 8000, type: 'highpass' }); break;
      case 'crack': noise(t, 0.12, { v: 0.4, f: 1800, type: 'bandpass', q: 1.5 }); osc(t, 220, 0.1, { v: 0.25, type: 'square', to: 110 }); break;
      case 'bossdown': noise(t, 0.6, { v: 0.5, f: 2400, to: 200 }); [392, 523, 659, 784, 1047].forEach((f, i) => osc(t + 0.1 + i * 0.07, f, 0.16, { v: 0.15 })); break;
      case 'boss': osc(t, 110, 0.5, { v: 0.35, type: 'sawtooth', to: 70 }); osc(t + 0.25, 98, 0.6, { v: 0.35, type: 'sawtooth', to: 55 }); break;
      case 'swap': osc(t, 500, 0.16, { v: 0.14, type: 'triangle', to: 1000 }); osc(t + 0.12, 1000, 0.16, { v: 0.14, type: 'triangle', to: 500 }); break;
      case 'rewind': osc(t, 1400, 0.5, { v: 0.16, type: 'sawtooth', to: 180 }); noise(t, 0.5, { v: 0.15, f: 600, type: 'bandpass', q: 3, to: 4000 }); break;
      case 'mission': [659, 784, 988, 1319, 1568].forEach((f, i) => osc(t + i * 0.06, f, 0.14, { v: 0.14, type: 'triangle' })); break;
      case 'junk': osc(t, 180, 0.2, { v: 0.2, type: 'square', to: 90 }); break;
      case 'event': [523, 784, 1047].forEach((f, i) => osc(t + i * 0.08, f, 0.14, { v: 0.14 })); break;
      case 'rare': [784, 988, 1175, 1568].forEach((f, i) => osc(t + i * 0.06, f, 0.12, { v: 0.15 })); break;
      case 'magnet': osc(t, 200, 0.25, { v: 0.12, type: 'sawtooth', to: 1200 }); break;
      case 'tick': osc(t, 2200, 0.025, { v: 0.09, type: 'square' }); break;
      case 'freeze': noise(t, 0.6, { v: 0.25, f: 9000, type: 'highpass', to: 3000 });
        [1568, 2093, 2637].forEach((f, i) => osc(t + i * 0.05, f, 0.3, { v: 0.08, type: 'triangle' })); break;
      case 'thaw': [1319, 1175, 988, 784].forEach((f, i) => osc(t + i * 0.09, f, 0.1, { v: 0.12, type: 'triangle' })); break;
      case 'clock': for (let i = 0; i < 4; i++) osc(t + i * 0.18, i % 2 ? 900 : 1300, 0.03, { v: 0.15 }); break;
      case 'hole': osc(t, 300, 1.2, { v: 0.2, type: 'sawtooth', to: 40 }); noise(t, 1.2, { v: 0.2, f: 1200, to: 100 }); break;
      case 'tier': [523, 659, 784, 1047].forEach((f, i) => osc(t + i * 0.07, f, 0.12, { v: 0.14 })); break;
      case 'clear': for (let i = 0; i < 8; i++) osc(t + i * 0.035, 1047 * Math.pow(2, i / 7), 0.09, { v: 0.08, type: 'triangle' }); break;
      case 'fizzle': noise(t, 0.35, { v: 0.2, f: 3000, to: 300 }); break;
      case 'ice': noise(t, 0.5, { v: 0.35, f: 6000, type: 'bandpass', q: 2, to: 1500 }); osc(t, 2637, 0.4, { v: 0.08, type: 'triangle' }); break;
      case 'boom':
        noise(t, 1.0, { v: 0.9, f: 2400, to: 80 });
        osc(t, 140, 0.8, { v: 0.6, type: 'sine', to: 30 });
        osc(t, 90, 0.5, { v: 0.3, type: 'square', to: 25 }); break;
      case 'ui': osc(t, 660, 0.05, { v: 0.12, type: 'triangle' }); break;
    }
  }
  let level = 0; // current tier: more layers join as the game speeds up (tempo stays 124 BPM)
  function playStep(i, t) {
    const bar = Math.floor(i / 16) % 4, s = i % 16, ch = PROG[bar];
    if (s % 4 === 0) osc(t, 150, 0.12, { type: 'sine', v: 0.8, to: 45, out: musicBus });
    if (level >= 6 && s % 4 === 2 && s !== 14) osc(t, 150, 0.1, { type: 'sine', v: 0.45, to: 45, out: musicBus });
    if ((s === 4 || s === 12) && level >= 1) noise(t, 0.12, { v: 0.35, f: 1800, type: 'bandpass', q: 0.7, out: musicBus });
    if (s % 2 === 1 || level >= 3) noise(t, 0.03, { v: s % 2 ? 0.15 : 0.08, f: 7000, type: 'highpass', out: musicBus });
    if (s % 2 === 0) osc(t, mtof(ch[0] - 24 + (s % 4 === 2 ? 12 : 0)), S16 * 1.6, { type: 'triangle', v: 0.55, out: musicBus });
    osc(t, mtof(ch[[0, 1, 2, 1][s % 4]] + 12), S16 * 0.8, { type: 'square', v: 0.06, out: musicBus });
    if (level >= 4) osc(t, mtof(ch[[2, 1, 0, 1][s % 4]] + 24), S16 * 0.6, { type: 'triangle', v: 0.05, out: musicBus });
    const m = MEL[bar][s];
    if (m && (level >= 2 || Math.floor(i / 64) % 2 === 1)) {
      osc(t, mtof(m), S16 * 1.7, { type: 'square', v: 0.11, out: musicBus });
      if (level >= 5) osc(t, mtof(m - 5), S16 * 1.7, { type: 'square', v: 0.05, out: musicBus });
      if (level >= 7) osc(t + S16, mtof(m + 12), S16 * 0.9, { type: 'triangle', v: 0.06, out: musicBus });
    }
  }
  function pump() {
    if (!ac || !musicOn) return;
    while (nextT < ac.currentTime + 0.15) { playStep(stepI, nextT); nextT += S16; stepI++; }
  }
  return {
    unlock, play,
    setLevel(l) { level = l; },
    get muted() { return muted; },
    setMuted(m) {
      muted = m; store.set(KEY_MUTE, m ? '1' : '0');
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ac.currentTime, 0.02);
    },
    startMusic() {
      if (!ac || musicOn) return;
      musicOn = true; nextT = ac.currentTime + 0.05; stepI = 0;
      timer = setInterval(pump, 25);
    },
    stopMusic() { musicOn = false; if (timer) clearInterval(timer); timer = null; },
  };
})();

// ======================================================================
// Local leaderboard (same rules as the brief; swap for a server later)
// ======================================================================
const Board = (() => {
  const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fag', 'dick', 'cock', 'pussy', 'asshole', 'whore', 'slut', 'rape', 'nazi', 'penis', 'vagina'];
  const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };
  const localKey = (mode) => (mode === 'classic' ? KEY_BOARD : KEY_BOARD + '-daily-' + dailyKey());
  const load = (mode) => { try { return JSON.parse(store.get(localKey(mode)) || '{}') || {}; } catch (e) { return {}; } };
  const save = (mode, m) => store.set(localKey(mode), JSON.stringify(m));
  const sorted = (rows) => rows.sort((a, b) => b.score - a.score || a.created_at - b.created_at);
  // one best row per name, case-insensitive
  const dedupe = (rows) => {
    const best = new Map();
    for (const r of rows) { const k = r.name.toLowerCase(); const o = best.get(k); if (!o || r.score > o.score || (r.score === o.score && r.created_at < o.created_at)) best.set(k, { ...r, key: k }); }
    return sorted([...best.values()]);
  };
  const inRange = (r, range) => {
    const now = new Date();
    if (range === 'today') return r.created_at >= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (range === 'week') return r.created_at >= now.getTime() - 7 * 86400000;
    return true;
  };

  // ---- online (artifact shared storage): one doc per player at scores/<their id> ----
  let db = null, uid = null, canWrite = false, ready = null;
  function connect() {
    if (ready) return ready;
    ready = (async () => {
      try {
        if (!window.claude || typeof window.claude.use !== 'function') return;
        const [d, u] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
        if (!d || !u) return;
        uid = await u.id();
        if (!uid) return;
        db = d;
        const cw = typeof u.can === 'function' ? await u.can('data.write') : null;
        canWrite = cw !== false;
      } catch (e) { db = null; }
    })();
    return ready;
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: 'timeout' }), ms))]);
  async function onlineRows(mode) {
    const snap = await withTimeout(db.collection('scores').get(), 10000);
    const today = dailyKey(), rows = [];
    for (const d of snap.docs) {
      const v = d.data() || {};
      if (mode === 'daily' && v.dailyDate !== today) continue;
      const score = v[mode], name = v[mode + 'Name'];
      if (typeof score !== 'number' || typeof name !== 'string') continue;
      rows.push({ id: d.id, name, score, created_at: Number(v[mode + 'At']) || 0 });
    }
    return rows;
  }
  function profane(n) {
    const s = n.toLowerCase().replace(/[013457@$]/g, (c) => LEET[c] || c).replace(/[^a-z]/g, '');
    return BAD.some((w) => s.includes(w));
  }
  function validate(raw) {
    const n = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!n) return { error: 'Enter a name first.' };
    if (n.length > 16) return { error: 'Max 16 characters.' };
    if (!/^[A-Za-z0-9 ._'-]+$/.test(n)) return { error: "Letters, numbers, spaces and . _ ' - only." };
    if (profane(n)) return { error: 'Please pick a different name.' };
    return { name: n };
  }
  const rankIn = (rows, key) => dedupe(rows).findIndex((r) => r.key === key) + 1;
  function localSubmit(mode, name, score) {
    const m = load(mode), key = name.toLowerCase();
    if (m[key] && m[key].score >= score) return { ok: false, rejected: true, rank: rankIn(Object.values(m), key), best: m[key].score, where: 'local' };
    m[key] = { key, name, score, created_at: Date.now() };
    save(mode, m);
    return { ok: true, rank: rankIn(Object.values(m), key), where: 'local' };
  }
  return {
    validate, connect,
    get status() { return db ? (canWrite ? 'online' : 'readonly') : 'local'; },
    async submit(mode, rawName, rawScore) {
      const v = validate(rawName);
      if (v.error) return { ok: false, error: v.error };
      const score = clamp(Math.floor(Number(rawScore) || 0), 0, 999999);
      const key = v.name.toLowerCase();
      await connect();
      if (db && canWrite) {
        try {
          const rows = await onlineRows(mode);
          const named = rows.filter((r) => r.name.toLowerCase() === key);
          const mine = rows.find((r) => r.id === uid);
          const nameBest = named.reduce((b, r) => Math.max(b, r.score), -1);
          if (nameBest >= score) return { ok: false, rejected: true, rank: rankIn(rows, key), best: nameBest, where: 'online' };
          if (mine && mine.score >= score) return { ok: false, rejected: true, rank: rankIn(rows, mine.name.toLowerCase()), best: mine.score, where: 'online' };
          const ref = db.collection('scores').doc(uid);
          const cur = await withTimeout(ref.get(), 10000);
          const body = { ...(cur.exists ? cur.data() : {}) };
          const now = Date.now();
          body[mode] = score; body[mode + 'Name'] = v.name; body[mode + 'At'] = now;
          if (mode === 'daily') body.dailyDate = dailyKey();
          await withTimeout(ref.set(body), 10000);
          const after = rows.filter((r) => r.id !== uid).concat([{ id: uid, name: v.name, score, created_at: now }]);
          return { ok: true, rank: rankIn(after, key), where: 'online' };
        } catch (e) {
          if (e && e.code === 'invalid_argument') canWrite = false;
          // fall through to this device
        }
      }
      return localSubmit(mode, v.name, score);
    },
    async top(mode, range) {
      await connect();
      let rows = null;
      if (db) { try { rows = await onlineRows(mode); } catch (e) { rows = null; } }
      if (!rows) rows = Object.values(load(mode));
      return dedupe(rows.filter((r) => mode === 'daily' || inRange(r, range))).slice(0, 100);
    },
  };
})();

// ======================================================================
// Game state
// ======================================================================
let mode = 'menu'; // menu | play | paused | booming | over
let S = null;
const readBest = (m) => parseInt(store.get(bestKey(m)) || '0', 10) || 0;
let best = readBest('classic');
let nextId = 1;
let rnd = Math.random; // gameplay spawn decisions; seeded per day in Daily Challenge
let seen = (() => { try { return JSON.parse(store.get(KEY_SEEN) || '{}') || {}; } catch (e) { return {}; } })();
let held = null, activePointer = null;
const fx = [];
const decor = [];
const petals = [];

// ---------- unlockable looks (cosmetic only; unlocked by lifetime bombs sorted) ----------
const Looks = (() => {
  const SKINS = [{ id: 'classic', name: 'Classic', need: 0 }, { id: 'cat', name: 'Cat Ears', need: 100 }, { id: 'shades', name: 'Shades', need: 300 }, { id: 'crown', name: 'Crown', need: 700 }];
  const TRAILS = [{ id: 'none', name: 'None', need: 0 }, { id: 'spark', name: 'Sparkles', need: 50 }, { id: 'hearts', name: 'Hearts', need: 200 }, { id: 'stars', name: 'Shooting Stars', need: 500 }];
  const ARENAS = [{ id: 'auto', name: 'Auto', need: 0 }, { id: 'day', name: 'Day', need: 0 }, { id: 'sunset', name: 'Sunset', need: 0 }, { id: 'night', name: 'Night', need: 0 }, { id: 'aurora', name: 'Aurora', need: 400 }, { id: 'candy', name: 'Candy', need: 900 }];
  const GROUPS = { skin: SKINS, trail: TRAILS, arena: ARENAS };
  let total = parseInt(store.get(KEY_TOTAL) || '0', 10) || 0;
  let pick = { skin: 'classic', trail: 'none', arena: 'auto' };
  try { Object.assign(pick, JSON.parse(store.get(KEY_LOOKS) || '{}') || {}); } catch (e) { /* keep defaults */ }
  const open = (group, id) => { const o = GROUPS[group].find((x) => x.id === id); return !!o && o.need <= total; };
  const cur = (group, dflt) => (open(group, pick[group]) ? pick[group] : dflt);
  return {
    GROUPS,
    get total() { return total; },
    get skin() { return cur('skin', 'classic'); },
    get trail() { return cur('trail', 'none'); },
    get arena() { return cur('arena', 'auto'); },
    open,
    set(group, id) { if (!open(group, id)) return false; pick[group] = id; store.set(KEY_LOOKS, JSON.stringify(pick)); return true; },
    // bank a finished run; returns the names of anything it unlocked
    add(n) {
      if (!(n > 0)) return [];
      const before = total; total += Math.floor(n); store.set(KEY_TOTAL, String(total));
      const got = [];
      for (const g of Object.keys(GROUPS)) for (const o of GROUPS[g]) if (o.need > before && o.need <= total) got.push(o.name);
      return got;
    },
  };
})();
const themeIndex = (name) => Math.max(0, THEMES.findIndex((t) => t.name === name));
const startTheme = () => (Looks.arena === 'auto' ? 0 : themeIndex(Looks.arena));
// Auto cycles through every arena you've unlocked; a fixed arena stays put
function nextTheme() {
  if (Looks.arena !== 'auto') return themeIndex(Looks.arena);
  const ok = THEMES.map((t, i) => i).filter((i) => Looks.open('arena', THEMES[i].name));
  return ok[(ok.indexOf(theme) + 1) % ok.length];
}

// ---------- run missions: three small goals per run, each pays out a card ----------
const MISSION_POOL = [
  { id: 'combo', n: [6, 8, 10], text: (n) => `Reach a x${n} combo`, get: () => S.bestCombo },
  { id: 'clutch', n: [2, 3], text: (n) => `Make ${n} clutch saves`, get: () => S.clutch },
  { id: 'streak', n: [4, 5], text: (n, c) => `Sort ${n} ${KIND_NAME[c].toLowerCase()} bombs in a row`, get: (m) => m.best },
  { id: 'cards', n: [3, 4], text: (n) => `Use ${n} power cards`, get: () => S.powers },
  { id: 'sorted', n: [30, 50], text: (n) => `Sort ${n} bombs`, get: () => S.sorted },
  { id: 'special', n: [3, 5], text: (n) => `Sort ${n} special bombs`, get: () => S.specials },
  { id: 'collect', n: [4, 6], text: (n) => `Collect ${n} power cards`, get: () => S.cardsGot },
];
function pickMissions() {
  const pool = MISSION_POOL.slice(), out = [];
  while (out.length < 3 && pool.length) {
    const def = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    const n = def.n[Math.floor(rnd() * def.n.length)], color = def.id === 'streak' ? SORT[Math.floor(rnd() * 4)] : null;
    out.push({ id: def.id, def, n, color, text: def.text(n, color), cur: 0, best: 0, done: false, doneT: 0 });
  }
  return out;
}
const missionProgress = (m) => Math.min(m.n, m.def.get(m));

function newRun() {
  S = {
    bombs: [], score: 0, tier: 0, born: 0, cycle: 0, bag: [],
    spawnT: waveGap(0, 0) - FIRST_SPAWN, powerT: 0,
    freezeT: 0, freezeSpawned: 0, thawWarned: false, clockT: 0,
    magnets: { red: 0, blue: 0, yellow: 0, green: 0 },
    holes: [], clearT: -1, time: 0, tickT: 0,
    boom: null, boomT: 0, banner: null, shake: 0, hint: 4,
    combo: 0, comboT: 0, bestCombo: 0, sorted: 0, powers: 0, tip: null,
    tutorial: store.get(KEY_TUTORIAL) !== '1', snapshot: null, cause: '',
    cards: {}, target: null, defuseLeft: 0, flies: [], shieldOn: false, doubleT: 0, paint: null, nope: null,
    meter: 0, meterPop: 0, clutch: 0, slowT: 0,           // combo meter, clutch saves
    specials: 0, cardsGot: 0, missions: [],               // mission counters
    event: null, eventBag: [], clears: 0,                 // arena events
    bossAt: BOSS_EVERY, bosses: 0, bossBag: [],           // boss bombs
    hist: [], histT: 0, swapPick: null, rewindFx: 0,      // Rewind history, Swap's first pen
    sent: 0, junkQueue: 0, junkT: 0, won: false, banked: false, unlocked: [], // race + looks
  };
  rnd = game === 'daily' ? seeded(hashStr('bombs-act-' + dailyKey())) : game === 'race' ? seeded(Race.seed) : Math.random;
  S.missions = pickMissions();
  best = readBest(game);
  fx.length = 0; held = null; activePointer = null;
  setTheme(startTheme());
  Sound.setLevel(0);
}

// seconds between waves: the wave pattern's average size over the target bomb rate, so throughput is smooth
function waveGap(score, tier) {
  const pat = CYCLES[tier];
  let n = 0; for (const ch of pat) n += CNT[ch];
  return (n / pat.length) / pace(score).rate;
}
const cruise = () => pace(S.score).speed * SCALE;
const sortedSpeed = () => BASE_SPEED * SCALE * 0.58;
const holeRadius = () => 0.5 * A.w * 1.15 * 0.9;
function kindSpeed(kind) {
  if (!S) return BASE_SPEED * SCALE * 0.5;
  const cur = cruise();
  if (isSort(kind) || kind === 'junk') return cur;
  if (kind === 'boss') return cur * BOSS_SPEED;
  return cur * (POWER_SPEED[kind] || 1.3);
}
// one bomb's speed right now: its kind, what's special about it, and the Calm event
function bombSpeed(b) {
  let v = kindSpeed(b.kind);
  if (b.kind === 'boss') v = cruise() * (b.btype === 'thief' ? THIEF_SPEED : b.btype === 'mini' ? MINI_SPEED : BOSS_SPEED);
  if (b.sp === 'heavy') v *= HEAVY_SPEED;
  if (S && S.event && S.event.kind === 'calm') v *= CALM_SPEED;
  return v;
}
// speeds follow the score smoothly, so refresh everything on the floor after each point
function refreshSpeeds() {
  for (const b of S.bombs) if (alive(b) && (b.state === 'floor' || b.state === 'held')) b.speed = bombSpeed(b);
}
function powerSize(kind) {
  if (kind === 'boss') return BOSS_SIZE;
  if (kind === 'junk') return 1;
  if (!NEW_POWERS.has(kind)) return POWER_SIZE;
  return [POWER_SIZE, 0.58, 0.5][RARITY[kind]];
}
// a collectible power, as opposed to a color bomb, the boss or a rival's junk
const isPower = (k) => !isSort(k) && k !== 'boss' && k !== 'junk';
const floorPowers = () => S.bombs.reduce((n, b) => n + (!b.dead && isPower(b.kind) && b.state === 'floor' ? 1 : 0), 0);
const alive = (b) => !b.dead;
const liveCount = () => S.bombs.reduce((n, b) => n + (!b.dead && (b.state === 'floor' || b.state === 'held') ? 1 : 0), 0);
function nextColor() {
  if (S.paint && S.paint.n > 0) { const c = S.paint.c; if (--S.paint.n <= 0) S.paint = null; return c; }
  if (!S.bag.length) {
    S.bag = SORT.slice();
    for (let i = S.bag.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [S.bag[i], S.bag[j]] = [S.bag[j], S.bag[i]]; }
  }
  return S.bag.pop();
}

// ---------- geometry ----------
function circRect(x, y, r, p) {
  const cx = clamp(x, p.x, p.x + p.w), cy = clamp(y, p.y, p.y + p.h);
  return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
}
function coverage(b, p) {
  let n = 0, hit = 0;
  for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
    const dx = i / 5, dy = j / 5;
    if (dx * dx + dy * dy > 1) continue;
    n++;
    const x = b.x + dx * b.r, y = b.y + dy * b.r;
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) hit++;
  }
  return hit / n;
}
function pushOutPen(b, p) {
  const cx = clamp(b.x, p.x, p.x + p.w), cy = clamp(b.y, p.y, p.y + p.h);
  const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
  if (d > 0.001) { b.x = cx + (dx / d) * b.r; b.y = cy + (dy / d) * b.r; return; }
  const nx = p.ix + p.sx * b.r, ny = p.iy + p.sy * b.r;
  if (Math.abs(nx - b.x) < Math.abs(ny - b.y)) b.x = nx; else b.y = ny;
}
function collideSeg(b, s) {
  const [x1, y1, x2, y2] = s, vx = x2 - x1, vy = y2 - y1;
  const t = clamp(((b.x - x1) * vx + (b.y - y1) * vy) / (vx * vx + vy * vy), 0, 1);
  const cx = x1 + vx * t, cy = y1 + vy * t, dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
  if (d >= b.r || d < 0.001) return;
  const nx = dx / d, ny = dy / d;
  b.x = cx + nx * b.r; b.y = cy + ny * b.r;
  const ux = Math.cos(b.ang), uy = Math.sin(b.ang), dot = ux * nx + uy * ny;
  if (dot < 0) b.ang = Math.atan2(uy - 2 * dot * ny, ux - 2 * dot * nx);
}
function steerToCenter(b) {
  b.ang = Math.atan2(A.y + A.h / 2 - b.y, A.x + A.w / 2 - b.x) + rand(-0.6, 0.6);
}
function keepOnFloor(b) {
  if (b.x < A.x + b.r) { b.x = A.x + b.r; b.ang = Math.PI - b.ang; }
  if (b.x > A.x + A.w - b.r) { b.x = A.x + A.w - b.r; b.ang = Math.PI - b.ang; }
  if (b.y < A.y + b.r) { b.y = A.y + b.r; b.ang = -b.ang; }
  if (b.y > A.y + A.h - b.r) { b.y = A.y + A.h - b.r; b.ang = -b.ang; }
  for (const p of BLOCKS) {
    if (circRect(b.x, b.y, b.r, p)) { pushOutPen(b, p); steerToCenter(b); }
    if (p.foot) collideSeg(b, p.foot);
  }
}

// ---------- spawning ----------
function spawnBomb(kind) {
  const mult = isSort(kind) ? 1 : powerSize(kind), r = R * mult;
  let x = A.x + A.w / 2, y = A.y + A.h / 2;
  for (let i = 0; i < 40; i++) {
    const tx = rand(A.x + r, A.x + A.w - r), ty = rand(A.y + r, A.y + A.h - r);
    if (BLOCKS.some((p) => circRect(tx, ty, r + R * 0.4, p))) continue;
    if (held && dist(tx, ty, held.x, held.y) < R * 3) continue;
    x = tx; y = ty; break;
  }
  let f = kind === 'boss' ? BOSS_FUSE : pace(S.score).fuse;
  const tierR = NEW_POWERS.has(kind) ? RARITY[kind] : 0;
  if (tierR === 1) f *= 0.8;                    // uncommon powers vanish a bit sooner
  else if (tierR === 2) f = Math.min(f, RARE_LIFE); // rare ones only stay a few seconds
  const b = {
    id: nextId++, kind, mult, r, x, y, ang: rand(0, TAU), turn: 0, speed: 0,
    fuse: f, fuseMax: f, rare: false, state: 'floor', iceT: 0, pop: 0, blink: rand(1, 4), seed: rand(0, 100),
    erratic: tierR === 2, dashT: rand(0.4, 0.9), kx: 0, ky: 0,
    sp: null, chamT: 0, hp: 0, hpMax: 0, hitT: 0, bornAt: S.time,
  };
  b.speed = bombSpeed(b);
  S.bombs.push(b);
  S.born++;
  if (S.freezeT > 0) S.freezeSpawned++;
  if (!isSort(kind) && !seen[kind]) showTip(kind);
  addFx({ type: 'ring', x, y, life: 0.35, s: r * 0.6, grow: r * 1.6, color: isSort(kind) ? PAL[kind].base : PAL[kind].aura, lw: r * 0.18 });
  return b;
}
function makeRare(b) {
  b.rare = true; b.mult = RARE_SIZE; b.r = R * RARE_SIZE;
  sparkBurst(b.x, b.y, '#fff3a0', 6, b.r);
  showTip('rare');
}
// ---------- special color bombs ----------
function makeSpecial(b, sp) {
  b.sp = sp;
  if (sp === 'heavy') { b.mult = HEAVY_SIZE; b.fuse *= HEAVY_FUSE; b.fuseMax = b.fuse; }
  else if (sp === 'twin') b.mult = TWIN_SIZE;
  else if (sp === 'cham') b.chamT = CHAM_EVERY;
  b.r = R * b.mult; b.speed = bombSpeed(b);
  showTip(sp);
  return b;
}
function maybeSpecial(b) {
  if (rnd() >= specialChance(S.score)) return;
  if (S.bombs.reduce((n, o) => n + (alive(o) && o.sp && o.state === 'floor' ? 1 : 0), 0) >= SPECIAL_MAX) return;
  const pool = SPECIALS.filter(([, need]) => S.score >= need);
  const total = pool.reduce((n, [, , w]) => n + w, 0);
  if (!total) return;
  let roll = rnd() * total;
  for (const [sp, , w] of pool) { roll -= w; if (roll < 0) { makeSpecial(b, sp); return; } }
}
// a Twin left too long splits into two small bombs of its color
function splitTwin(b) {
  b.dead = true;
  const fuse = Math.max(b.fuse + 1.5, 3.5);
  for (const d of [-1, 1]) {
    const c = spawnBomb(b.kind);
    c.mult = TWIN_CHILD; c.r = R * c.mult;
    c.x = b.x + d * b.r * 0.6; c.y = b.y; c.ang = d > 0 ? rand(-0.8, 0.8) : Math.PI + rand(-0.8, 0.8);
    c.fuse = fuse; c.fuseMax = Math.max(fuse, pace(S.score).fuse); c.pop = 0.4;
    keepOnFloor(c);
  }
  Sound.play('ice');
  addFx({ type: 'poof', x: b.x, y: b.y, life: 0.5, s: b.r });
  addFx({ type: 'text', x: b.x, y: b.y - b.r, vx: 0, vy: -40, life: 0.9, text: 'SPLIT!', color: PAL[b.kind].base, size: R * 1.05 });
}
// ---------- boss bomb: every BOSS_EVERY points, tap it apart before its fuse runs out ----------
//   tap:   the original. Tap it apart.
//   split: tap it apart and it breaks into three minis; beat all three.
//   color: taps do nothing. Drop a bomb of the color it shows onto it, four times.
//   thief: heads for your pens and steals a sorted bomb (-1 point) every couple of seconds.
//          Beat it to get the loot back. If its fuse runs out it escapes with the loot (no explosion).
function spawnBoss(type) {
  if (!type) {
    if (!S.bossBag.length) {
      S.bossBag = BOSS_TYPES.slice();
      for (let i = S.bossBag.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [S.bossBag[i], S.bossBag[j]] = [S.bossBag[j], S.bossBag[i]]; }
    }
    type = S.bossBag.pop();
  }
  const b = spawnBomb('boss');
  b.btype = type; b.loot = 0; b.want = null; b.stealT = THIEF_EVERY + 0.8;
  let text = 'BOSS BOMB!', sub = '';
  if (type === 'split') { b.hp = SPLIT_HP; text = 'SPLITTER BOSS!'; sub = 'it breaks in three'; }
  else if (type === 'color') { b.hp = COLOR_HP; b.fuse = b.fuseMax = COLOR_FUSE; pickWant(b); text = 'COLOR BOSS!'; sub = 'feed it its color'; }
  else if (type === 'thief') { b.hp = THIEF_HP; b.fuse = b.fuseMax = THIEF_FUSE; b.mult = THIEF_SIZE; text = 'THIEF BOSS!'; sub = 'guard your pens'; }
  else { b.hp = bossHp(S.bosses); sub = `tap it x${b.hp}`; }
  b.hpMax = b.hp; b.r = R * b.mult; b.speed = bombSpeed(b);
  S.banner = { t: 0, life: 1.6, text, sub };
  if (type !== 'tap') showTip('boss' + type);
  Sound.play('boss');
  S.shake = 0.4;
  return b;
}
// the color boss asks for a color that is on the board when it can, and never the same one twice in a row
function pickWant(b) {
  const live = new Set(S.bombs.filter((o) => alive(o) && isSort(o.kind) && (o.state === 'floor' || o.state === 'held')).map((o) => o.kind));
  let pool = SORT.filter((c) => c !== b.want && live.has(c));
  if (!pool.length) pool = SORT.filter((c) => c !== b.want);
  b.want = pool[Math.floor(rnd() * pool.length)];
}
function bossHitFx(b, x, y) {
  b.hitT = 0.18;
  Sound.play('crack'); vibrate(18);
  sparkBurst(x, y, '#ffe14d', 5, R);
  for (let i = 0; i < 4; i++) {
    const s = rand(0, TAU), v = rand(120, 300) * SCALE;
    addFx({ type: 'debris', x, y, vx: Math.cos(s) * v, vy: Math.sin(s) * v - 80 * SCALE, g: 700 * SCALE, drag: 1, life: 0.5, s: R * 0.14, rot: s, color: INK });
  }
}
function hitBoss(b, p) {
  if (b.btype === 'color') { // taps bounce off: it only cracks when fed its color
    Sound.play('drop'); b.hitT = 0.08;
    addFx({ type: 'text', x: b.x, y: b.y - b.r * 1.3, vx: 0, vy: -40, life: 0.8, text: `DROP ${PAL[b.want].name} ON IT!`, color: PAL[b.want].base, size: R * 0.95 });
    return;
  }
  b.hp--;
  // each tap knocks it back a little, away from the finger
  const a = Math.atan2(b.y - p.y, b.x - p.x) + rand(-0.4, 0.4);
  b.kx = Math.cos(a) * 160 * SCALE; b.ky = Math.sin(a) * 160 * SCALE;
  bossHitFx(b, p.x, p.y);
  if (b.hp > 0) { addFx({ type: 'text', x: b.x, y: b.y - b.r * 1.2, vx: 0, vy: -50, life: 0.5, text: String(b.hp), color: '#ffffff', size: R * 1.2 }); return; }
  if (b.btype === 'split') { splitBoss(b); return; }
  beatBoss(b);
}
function splitBoss(b) {
  b.dead = true;
  const fuse = Math.max(b.fuse + 3, 7);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + rand(-0.3, 0.3), c = spawnBomb('boss');
    c.btype = 'mini'; c.loot = 0; c.hp = c.hpMax = MINI_HP; c.mult = MINI_SIZE; c.r = R * c.mult;
    c.x = b.x + Math.cos(a) * b.r * 0.7; c.y = b.y + Math.sin(a) * b.r * 0.7; c.ang = a;
    c.kx = Math.cos(a) * 260 * SCALE; c.ky = Math.sin(a) * 260 * SCALE;
    c.fuse = c.fuseMax = fuse; c.pop = 0.4; c.speed = bombSpeed(c);
    keepOnFloor(c);
  }
  S.shake = 0.4; Sound.play('ice'); vibrate([20, 20, 20]);
  addFx({ type: 'poof', x: b.x, y: b.y, life: 0.6, s: b.r });
  addFx({ type: 'text', x: b.x, y: b.y - b.r, vx: 0, vy: -30, life: 1.2, text: 'IT SPLIT! x3', color: '#ffe14d', size: R * 1.4 });
}
function beatBoss(b) {
  b.dead = true;
  if (b.btype === 'mini') { // the splitter only counts once all three minis are down
    const left = S.bombs.filter((o) => alive(o) && o.kind === 'boss' && o.btype === 'mini').length;
    if (left > 0) {
      Sound.play('fizzle');
      addFx({ type: 'poof', x: b.x, y: b.y, life: 0.5, s: b.r });
      addFx({ type: 'text', x: b.x, y: b.y - b.r, vx: 0, vy: -40, life: 0.9, text: `${left} LEFT!`, color: '#ffffff', size: R * 1.1 });
      return;
    }
  }
  S.bosses++;
  S.shake = 0.5;
  Sound.play('bossdown'); vibrate([30, 30, 60]);
  explosionPop(b.x, b.y, b.r);
  const pts = BOSS_POINTS + (b.loot || 0); // a beaten thief hands back what it stole
  const label = b.btype === 'thief' ? (b.loot ? `THIEF CAUGHT! +${BOSS_POINTS} AND ${b.loot} BACK` : `THIEF CAUGHT! +${pts}`) : `BOSS DOWN! +${pts}`;
  addFx({ type: 'text', x: A.x + A.w / 2, y: clamp(b.y - b.r, A.y + R * 2, A.y + A.h - R * 2), vx: 0, vy: -30, life: 1.5, text: label, color: '#ffe14d', size: R * (label.length > 18 ? 1.05 : 1.5) });
  gainScore(pts);
  rewardCard(b.x, b.y);
}
// color boss: a color bomb dropped on it either cracks it (right color) or bounces off (wrong color)
function feedBoss(boss, b) {
  const a = Math.atan2(b.y - boss.y, b.x - boss.x);
  if (b.kind !== boss.want) {
    b.state = 'floor'; b.speed = bombSpeed(b); b.ang = a;
    b.x = boss.x + Math.cos(a) * (boss.r + b.r * 1.1); b.y = boss.y + Math.sin(a) * (boss.r + b.r * 1.1);
    b.kx = Math.cos(a) * 240 * SCALE; b.ky = Math.sin(a) * 240 * SCALE;
    keepOnFloor(b);
    Sound.play('drop');
    addFx({ type: 'text', x: boss.x, y: boss.y - boss.r * 1.3, vx: 0, vy: -40, life: 0.9, text: `IT WANTS ${PAL[boss.want].name}!`, color: PAL[boss.want].base, size: R * 1.0 });
    return;
  }
  b.dead = true;
  addPoint(boss.x, boss.y - boss.r * 0.6, b.kind);
  Sound.play('sort', S.combo);
  boss.hp--;
  bossHitFx(boss, boss.x + Math.cos(a) * boss.r * 0.6, boss.y + Math.sin(a) * boss.r * 0.6);
  if (boss.hp <= 0) { beatBoss(boss); return; }
  pickWant(boss);
  addFx({ type: 'ring', x: boss.x, y: boss.y, life: 0.45, s: boss.r, grow: boss.r * 0.8, color: PAL[boss.want].base, lw: boss.r * 0.18 });
  addFx({ type: 'text', x: boss.x, y: boss.y - boss.r * 1.3, vx: 0, vy: -40, life: 0.9, text: `NOW ${PAL[boss.want].name}!`, color: PAL[boss.want].base, size: R * 1.0 });
}
// thief: walk to the nearest pen that has bombs in it and take one every THIEF_EVERY seconds
function thiefTick(b, tdt) {
  b.stealT -= tdt;
  let pick = null, bd = Infinity;
  for (const o of S.bombs) {
    if (!alive(o) || o.state !== 'sorted') continue;
    const d = dist(b.x, b.y, o.x, o.y);
    if (d < bd) { bd = d; pick = o; }
  }
  if (!pick) return;
  const p = pick.pen;
  b.ang = Math.atan2(p.cy - b.y, p.cx - b.x) + Math.sin(S.time * 3 + b.seed) * 0.3; b.turn = 0;
  if (b.stealT > 0 || dist(b.x, b.y, p.cx, p.cy) > p.w * 0.78 + b.r) return;
  b.stealT = THIEF_EVERY;
  pick.dead = true; b.loot++;
  S.score = Math.max(0, S.score - 1);
  const a = Math.atan2(b.y - pick.y, b.x - pick.x), v = bd / 0.35;
  addFx({ type: 'star', x: pick.x, y: pick.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35, s: R * 0.6, color: PAL[pick.kind].base });
  addFx({ type: 'poof', x: pick.x, y: pick.y, life: 0.4, s: pick.r * 0.8 });
  addFx({ type: 'text', x: pick.x, y: pick.y - R, vx: 0, vy: -45, life: 0.9, text: 'STOLEN! -1', color: '#ff3b5c', size: R * 1.05 });
  Sound.play('junk'); vibrate(20);
  if (game === 'race') Race.report();
}
function thiefEscape(b) {
  b.dead = true;
  Sound.play('fizzle');
  addFx({ type: 'poof', x: b.x, y: b.y, life: 0.7, s: b.r * 1.2 });
  addFx({ type: 'text', x: A.x + A.w / 2, y: clamp(b.y - b.r, A.y + R * 2, A.y + A.h - R * 2), vx: 0, vy: -30, life: 1.5, text: b.loot ? `THE THIEF GOT AWAY WITH ${b.loot}!` : 'THE THIEF GOT AWAY!', color: '#ff7f9f', size: R * 1.05 });
}
// a harmless celebratory burst (no game over)
function explosionPop(x, y, r) {
  addFx({ type: 'ring', x, y, life: 0.6, s: r, grow: R * 9, color: '#fff6d8', lw: R * 0.4 });
  addFx({ type: 'poof', x, y, life: 0.7, s: r * 1.2 });
  sparkBurst(x, y, '#ffe14d', 16, r);
}
function room() {
  const cap = CAP - liveCount();
  return Math.max(0, cap); // spawns are paused outright while frozen (see step)
}
function spawnWave() {
  // first-ever run: one bomb at a time until the player has sorted once
  if (S.tutorial && S.bombs.some((b) => alive(b) && (b.state === 'floor' || b.state === 'held'))) return;
  const pat = CYCLES[S.tier], ch = pat[S.cycle % pat.length];
  S.cycle++;
  const n = Math.min(S.tutorial ? 1 : CNT[ch], room());
  const born = [];
  for (let i = 0; i < n; i++) born.push(spawnBomb(nextColor()));
  if (!born.length) return;
  if (S.tutorial) { S.tutorialBomb = born[0]; return; }
  for (const b of born) maybeSpecial(b); // powers come from the power director (powerTick), not waves
}
// ---------- power director ----------
const cardsHeld = () => Object.values(S.cards).reduce((n, v) => n + (v || 0), 0);
function nextPowerGap() {
  return (POWER_GAP[0] + rnd() * (POWER_GAP[1] - POWER_GAP[0])) * (1 + POWER_HOARD * cardsHeld());
}
function pickPower() {
  const onFloor = new Set(S.bombs.filter((b) => alive(b) && b.state === 'floor').map((b) => b.kind));
  const pool = POWER_WEIGHTS.filter(([k]) => S.score >= POWER_UNLOCK[RARITY[k]] && !onFloor.has(k) && (S.cards[k] || 0) < MAX_STACK);
  const total = pool.reduce((n, [, w]) => n + w, 0);
  if (!total) return null;
  let roll = rnd() * total;
  for (const [k, w] of pool) { roll -= w; if (roll < 0) return k; }
  return pool[pool.length - 1][0];
}
function powerTick(tdt) {
  if (S.tutorial || S.score < POWER_START) return;
  S.powerT -= tdt;
  if (S.powerT > 0) return;
  const kind = room() > 0 && floorPowers() < MAX_FLOOR_POWERS ? pickPower() : null;
  if (kind) { spawnBomb(kind); S.powerT = nextPowerGap(); } else S.powerT = POWER_RETRY;
}

// ---------- scoring ----------
// raw score gain: handles the pen clear, level-ups and speeds (no combo, no stats)
function gainScore(pts) {
  const before = S.score;
  S.score += pts;
  // a jump like 19 → 21 under Double Points still triggers the clear at 20
  if (Math.floor(S.score / CLEAR_EVERY) > Math.floor(before / CLEAR_EVERY) && S.clearT < 0) S.clearT = CLEAR_DELAY;
  const nt = tierFor(S.score);
  if (nt > S.tier) {
    S.tier = nt;
    S.banner = { t: 0, life: 1.3, text: 'FASTER!' };
    Sound.play('tier');
    Sound.setLevel(S.tier);
  }
  refreshSpeeds();
  if (game === 'race') Race.report();
}
const pointMul = () => (S.doubleT > 0 ? 2 : 1) * (S.event && S.event.kind === 'rush' ? 2 : 1);
function addPoint(x, y, color) {
  const pts = pointMul();
  S.sorted++;
  gainScore(pts);
  addFx({ type: 'text', x, y: y - R, vx: 0, vy: -60 * SCALE - 20, life: 0.8, text: '+' + pts, color: pts > 1 ? '#ffb347' : PAL[color].base, size: R * (pts > 1 ? 1.35 : 1.1) });
  // combos never change the points; quick sorts fill the combo meter, and a full meter pays out a card
  S.combo = S.comboT > 0 ? S.combo + 1 : 1;
  S.comboT = COMBO_WINDOW;
  S.bestCombo = Math.max(S.bestCombo, S.combo);
  if (S.combo >= 2) {
    S.comboPop = { n: S.combo, t: 0 };
    if (S.combo % 5 === 0) { Sound.play('rare'); sparkBurst(x, y, '#ffe14d', 8, R); }
    S.meter++; S.meterPop = 0.25;
    if (S.meter >= METER_MAX) {
      S.meter = 0;
      addFx({ type: 'text', x: A.x + A.w / 2, y: A.y + A.h - R * 2, vx: 0, vy: -40, life: 1.2, text: 'COMBO CARD!', color: '#ff7fc4', size: R * 1.3 });
      rewardCard(METER ? METER.x + METER.w / 2 : x, METER ? METER.y : y);
    }
  }
  // "same color in a row" missions
  for (const m of S.missions) if (m.id === 'streak' && !m.done) { m.cur = color === m.color ? m.cur + 1 : 0; m.best = Math.max(m.best, m.cur); }
  // race: every few sorts lobs a junk bomb at each rival
  if (game === 'race' && S.sorted % JUNK_EVERY === 0) {
    S.sent++; Race.report();
    addFx({ type: 'text', x, y: y - R * 2.2, vx: 0, vy: -70, life: 0.8, text: 'JUNK SENT!', color: '#c9c3d6', size: R * 0.85 });
  }
  vibrate(12);
}
// a "last moment" grab: slow-mo, a pop and a bonus point
function clutchSave(b) {
  S.clutch++; S.slowT = CLUTCH_SLOW;
  Sound.play('clutch'); vibrate([20, 20, 30]);
  addFx({ type: 'ring', x: b.x, y: b.y, life: 0.5, s: b.r, grow: R * 5, color: '#ffe14d', lw: R * 0.35 });
  addFx({ type: 'text', x: b.x, y: b.y - b.r * 2.4, vx: 0, vy: -45, life: 1.1, text: 'CLUTCH! +1', color: '#ffe14d', size: R * 1.35 });
  gainScore(1);
}
// ---------- cards as rewards (combo meter, gifts, missions, bosses) ----------
function giveCard(kind, x, y, label) {
  S.cards[kind] = Math.min(MAX_STACK, (S.cards[kind] || 0) + 1);
  S.cardsGot++;
  const slot = TRAY && TRAY.slots.find((s) => s.kind === kind);
  if (slot) S.flies.push({ kind, x0: x, y0: y, slot, t: 0 });
  Sound.play('rare');
  sparkBurst(x, y, PAL[kind].aura, RARITY[kind] === 2 ? 12 : 6, R);
  if (label) addFx({ type: 'text', x, y: y - R, vx: 0, vy: -50, life: 0.8, text: label, color: PAL[kind].aura, size: R * 0.9 });
  vibrate(15);
}
// a random card you've unlocked and still have room for; +2 points if every stack is full
function rewardCard(x, y) {
  const pool = POWER_WEIGHTS.filter(([k]) => S.score >= POWER_UNLOCK[RARITY[k]] - (RARITY[k] === 0 ? POWER_UNLOCK[0] : 0) && (S.cards[k] || 0) < MAX_STACK);
  const total = pool.reduce((n, [, w]) => n + w, 0);
  if (!total) { gainScore(2); addFx({ type: 'text', x, y: y - R, vx: 0, vy: -50, life: 0.8, text: '+2', color: '#ffb347', size: R * 1.1 }); return null; }
  let roll = rnd() * total, kind = pool[pool.length - 1][0];
  for (const [k, w] of pool) { roll -= w; if (roll < 0) { kind = k; break; } }
  giveCard(kind, x, y, `+${CARD_NAME[kind].toUpperCase()}`);
  return kind;
}
function showTip(key) {
  if (seen[key]) return;
  seen[key] = true; store.set(KEY_SEEN, JSON.stringify(seen));
  const text = {
    white: 'FREEZE: tap to collect. Its card freezes every bomb for 7s',
    clock: 'SLOW-MO: tap to collect. Its card slows everything for 10s',
    void: 'BLACK HOLE: collect it, then tap the card and a spot to swallow bombs',
    defuse: 'DEFUSE: collect it, then tap the card and up to 8 bombs to remove them',
    magnet: 'MAGNET: collect it, then tap the card and a bomb to pull its color home',
    paint: 'PAINT: collect it, then tap the card and a bomb. The next 5 bombs match it',
    fan: 'FAN: collect it. Its card blows every bomb toward the middle',
    shield: 'RARE! SHIELD: forgives your next mistake. Grab it fast!',
    auto: 'RARE! AUTO-SORT: sorts every bomb on the board. Grab it fast!',
    double: 'RARE! DOUBLE POINTS: 2 points per bomb for 10s. Grab it fast!',
    swap: 'SWAP: collect it, then tap the card and two pens to trade their places',
    rewind: 'RARE! REWIND: puts every bomb back where it was 3s ago. Grab it fast!',
    gift: 'GIFT BOMB (bow on top): sort it in its pen and it gives you a card',
    cham: 'CHAMELEON (rainbow ring): it changes color every 3s. Time your drop!',
    heavy: 'HEAVY BOMB: big and slow to drag, with a short fuse. Start it early',
    twin: 'TWIN BOMB (2 badge): worth 2 if sorted whole. Leave it and it splits in two',
    boss: 'BOSS BOMB: tap it again and again to crack it before its fuse runs out!',
    bosssplit: 'SPLITTER BOSS: tap it apart, then tap the three small ones too',
    bosscolor: 'COLOR BOSS: taps do nothing. Drag a bomb of the color it shows onto it',
    bossthief: 'THIEF BOSS: it steals sorted bombs (-1 each). Tap it out to get them back',
    junk: 'JUNK from your rival: drag it into ANY pen to throw it out',
    meter: 'Sort bombs quickly in a row to fill the combo bar. A full bar gives a free card',
  }[key];
  if (text) S.tip = { kind: PAL[key] && isPower(key) && PAL[key].sym ? key : null, text, t: 0, life: 4.5 };
}
function setTheme(t) { theme = t; buildBg(); }

// ---------- arena events: one starts after every pen clear ----------
function startEvent() {
  if (!S.eventBag.length) { // shuffled bag, so all four show up before any repeats
    S.eventBag = EVENT_KINDS.slice();
    for (let i = S.eventBag.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [S.eventBag[i], S.eventBag[j]] = [S.eventBag[j], S.eventBag[i]]; }
  }
  const kind = S.eventBag.pop();
  const ev = { kind, t: kind === 'swap' ? SWAP_DUR : EVENT_DUR, max: kind === 'swap' ? SWAP_DUR : EVENT_DUR };
  if (kind === 'wind') ev.dir = Math.floor(rnd() * 4) * (Math.PI / 2); // right, down, left or up
  if (kind === 'swap') {
    const i = Math.floor(rnd() * 4); let j = Math.floor(rnd() * 3); if (j >= i) j++;
    ev.a = PENS[i]; ev.b = PENS[j]; ev.done = false;
  }
  S.event = ev;
  S.banner = { t: 0, life: 1.4, text: EVENT_NAME[kind], sub: kind === 'calm' ? 'take a breath' : kind === 'swap' ? 'watch the pens' : kind === 'wind' ? 'hold on' : 'more bombs' };
  Sound.play('event');
  refreshSpeeds();
}
function endEvent() { S.event = null; refreshSpeeds(); }
function eventTick(dt) {
  const ev = S.event; if (!ev) return;
  ev.t -= dt;
  if (ev.kind === 'swap' && !ev.done && ev.max - ev.t >= SWAP_WARN) { ev.done = true; swapPens(ev.a, ev.b); }
  if (ev.t <= 0) endEvent();
}
const eventRate = () => (S.event ? (S.event.kind === 'rush' ? RUSH_RATE : S.event.kind === 'calm' ? CALM_RATE : 1) : 1);
// two pens trade places: their colors swap corners, and the bombs already sorted go with them
function swapPens(a, b) {
  if (!a || !b || a === b) return;
  const ca = a.color, cb = b.color;
  a.color = cb; b.color = ca;
  penColors[PENS.indexOf(a)] = cb; penColors[PENS.indexOf(b)] = ca;
  for (const o of S.bombs) {
    if (!alive(o) || o.state !== 'sorted') continue;
    if (o.pen === a) { o.x += b.x - a.x; o.y += b.y - a.y; o.pen = b; }
    else if (o.pen === b) { o.x += a.x - b.x; o.y += a.y - b.y; o.pen = a; }
  }
  buildBg();
  Sound.play('swap'); vibrate(25);
  S.penFlash = { pens: [a, b], t: SWAP_FLASH }; // both pens keep shouting their new color for a moment
  for (const p of [a, b]) {
    addFx({ type: 'ring', x: p.cx, y: p.cy, life: 0.6, s: p.w * 0.2, grow: p.w * 0.6, color: PAL[p.color].base, lw: LW * 3 });
    sparkBurst(p.cx, p.cy, PAL[p.color].base, 10, R);
  }
}
function startMagnet(c) {
  S.magnets[c] = MAGNET_START; // using another magnet on the same color restarts it, it doesn't add time
  const p = penOf(c);
  addFx({ type: 'text', x: p.cx, y: p.cy, vx: 0, vy: -30, life: 1.1, text: 'MAGNET!', color: PAL[c].base, size: R * 1.05 });
  Sound.play('magnet');
}
function sortBomb(b, p, viaMagnet) {
  b.state = 'sorted'; b.pen = p; b.iceT = 0;
  const m = b.r + LW;
  b.x = clamp(b.x, p.x + m, p.x + p.w - m); b.y = clamp(b.y, p.y + m, p.y + p.h - m);
  b.ang = rand(0, TAU); b.speed = sortedSpeed();
  addPoint(b.x, b.y, b.kind);
  sparkBurst(b.x, b.y, PAL[b.kind].base, viaMagnet ? 5 : 9, b.r);
  addFx({ type: 'ring', x: b.x, y: b.y, life: 0.4, s: b.r, grow: b.r * 2.2, color: '#ffffff', lw: b.r * 0.2 });
  if (b.rare) { Sound.play('rare'); startMagnet(b.kind); } else Sound.play('sort', S.combo);
  if (!viaMagnet) { trailBurst(b.x, b.y, b.r); if (!S.tutorial && b.fuse < CLUTCH_FUSE) clutchSave(b); }
  if (b.sp) {
    S.specials++;
    if (b.sp === 'gift') rewardCard(b.x, b.y);
    else if (b.sp === 'twin') { // sorted whole: worth both halves
      gainScore(pointMul());
      addFx({ type: 'text', x: b.x, y: b.y - b.r * 2.2, vx: 0, vy: -45, life: 0.9, text: 'TWIN! +' + pointMul(), color: '#ffe14d', size: R * 1.05 });
    }
  }
  if (S.tutorial) {
    S.tutorial = false; S.tutorialBomb = null; store.set(KEY_TUTORIAL, '1');
    addFx({ type: 'text', x: A.x + A.w / 2, y: A.y + A.h / 2, vx: 0, vy: -25, life: 1.4, text: 'NICE! KEEP GOING!', color: '#ffe14d', size: R * 1.3 });
  }
}
function clearPens() {
  let any = false;
  for (const b of S.bombs) {
    if (!alive(b) || b.state !== 'sorted') continue;
    any = true; b.dead = true;
    addFx({ type: 'poof', x: b.x, y: b.y, life: 0.5, s: b.r });
    sparkBurst(b.x, b.y, PAL[b.kind].base, 3, b.r);
  }
  if (any) {
    Sound.play('clear');
    addFx({ type: 'text', x: A.x + A.w / 2, y: A.y + A.h / 2, vx: 0, vy: -20, life: 1.0, text: 'PENS CLEAR!', color: '#ff7fc4', size: R * 1.5 });
  }
  setTheme(nextTheme()); // day → sunset → night → (any unlocked arenas) → day
  S.clears++;
  if (!S.tutorial) startEvent();
}

// ---------- power-ups ----------
// the effect of every power; (x, y) is where it goes off, target is a bomb or a color
function applyPower(kind, x, y, target) {
  S.powers++;
  vibrate(20);
  const say = (text, color, size = 1.2) => addFx({ type: 'text', x, y, vx: 0, vy: -40, life: 1.1, text, color, size: R * size });
  const floorSort = () => S.bombs.filter((b) => alive(b) && isSort(b.kind) && (b.state === 'floor' || b.state === 'held'));
  if (kind === 'white') {
    S.freezeT = FREEZE_DUR; S.freezeSpawned = 0; S.thawWarned = false;
    Sound.play('freeze');
    addFx({ type: 'ring', x, y, life: 0.6, s: R, grow: Math.max(W, H), color: '#bff0ff', lw: R * 0.5 });
    say('FREEZE!', '#8fe3ff');
  } else if (kind === 'clock') {
    S.clockT = CLOCK_DUR;
    Sound.play('clock');
    addFx({ type: 'ring', x, y, life: 0.7, s: R, grow: Math.max(W, H), color: '#ffc35a', lw: R * 0.4 });
    say('SLOW-MO!', '#ffc35a');
  } else if (kind === 'void') {
    S.holes.push({ x, y, t: HOLE_DUR, max: HOLE_DUR, r: holeRadius() });
    Sound.play('hole');
    addFx({ type: 'text', x, y: y - R, vx: 0, vy: -40, life: 1, text: 'BLACK HOLE!', color: '#b48cff', size: R * 1.1 });
  } else if (kind === 'defuse') {
    // one card = DEFUSE_COUNT removals, one tap each; this first tap uses the first one
    S.defuseLeft = DEFUSE_COUNT;
    defuseBomb(target);
  } else if (kind === 'magnet') {
    startMagnet(target);
  } else if (kind === 'paint') {
    S.paint = { c: target, n: PAINT_COUNT };
    Sound.play('rare');
    say(`PAINT ${PAL[target].name} x${PAINT_COUNT}!`, PAL[target].base, 1.1);
  } else if (kind === 'fan') {
    const cx = A.x + A.w / 2, cy = A.y + A.h / 2;
    for (const b of S.bombs) {
      if (!alive(b) || b.state !== 'floor') continue;
      b.kx = (cx - b.x) * 2.4; b.ky = (cy - b.y) * 2.4; // ends up ~60% of the way to the middle
    }
    Sound.play('magnet');
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU, rr = Math.min(A.w, A.h) * 0.48;
      addFx({ type: 'spark', x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, vx: -Math.cos(a) * 320 * SCALE, vy: -Math.sin(a) * 320 * SCALE, drag: 2.5, life: 0.5, s: R * 0.25, color: '#ffffff' });
    }
    say('WHOOSH!', PAL.fan.aura);
  } else if (kind === 'shield') {
    S.shieldOn = true;
    Sound.play('rare');
    say('SHIELD ON!', PAL.shield.aura);
  } else if (kind === 'auto') {
    Sound.play('clear');
    for (const b of floorSort()) {
      if (held === b) { held = null; activePointer = null; }
      const p = penOf(b.kind), m = b.r + LW;
      b.x = rand(p.x + m, p.x + p.w - m); b.y = rand(p.y + m, p.y + p.h - m);
      sortBomb(b, p, true);
    }
    say('AUTO-SORT!', '#ff9fd6', 1.3);
  } else if (kind === 'double') {
    S.doubleT = DOUBLE_DUR;
    Sound.play('tier');
    say('DOUBLE POINTS!', PAL.double.aura, 1.3);
  } else if (kind === 'swap') {
    swapPens(target[0], target[1]);
  } else if (kind === 'rewind') {
    rewind();
    say('REWIND!', PAL.rewind.aura, 1.4);
  }
}
// ---------- Rewind: a short history of where every bomb was ----------
function recordHistory(dt) {
  S.histT -= dt;
  if (S.histT > 0) return;
  S.histT = HIST_STEP;
  const snap = { t: S.time, at: new Map() };
  for (const b of S.bombs) if (alive(b) && (b.state === 'floor' || b.state === 'held')) snap.at.set(b.id, { x: b.x, y: b.y, fuse: b.fuse, ang: b.ang });
  S.hist.push(snap);
  while (S.hist.length && S.time - S.hist[0].t > REWIND_SECS + HIST_STEP) S.hist.shift();
}
function rewind() {
  const snap = S.hist[0];
  Sound.play('rewind'); S.rewindFx = 0.5; S.shake = 0.25;
  if (!snap) return;
  for (const b of S.bombs) {
    if (!alive(b) || b.state !== 'floor') continue;
    const old = snap.at.get(b.id);
    if (old) {
      addFx({ type: 'ring', x: b.x, y: b.y, life: 0.35, s: b.r, grow: -b.r * 0.6, color: PAL.rewind.aura, lw: b.r * 0.15 });
      b.x = old.x; b.y = old.y; b.ang = old.ang; b.fuse = Math.max(b.fuse, old.fuse); b.kx = 0; b.ky = 0;
      keepOnFloor(b);
    } else if (isSort(b.kind) || b.kind === 'junk') {
      // it didn't exist 3 seconds ago: it's gone (no points)
      b.dead = true;
      addFx({ type: 'poof', x: b.x, y: b.y, life: 0.4, s: b.r, color: PAL.rewind.light });
    }
  }
  S.hist.length = 0; S.histT = 0;
}

// ---------- power cards ----------
function collect(b) {
  b.dead = true;
  giveCard(b.kind, b.x, b.y, RARITY[b.kind] === 2 ? 'GOT IT!' : '+CARD');
}
function nope(slot, text) {
  S.nope = { slot, t: 0, text };
  Sound.play('drop');
}
// removes one bomb (no point) and keeps Defuse aimed while removals are left
function defuseBomb(b) {
  if (held === b) { held = null; activePointer = null; }
  b.dead = true;
  S.defuseLeft = Math.max(0, S.defuseLeft - 1);
  Sound.play('fizzle');
  addFx({ type: 'poof', x: b.x, y: b.y, life: 0.6, s: b.r * 1.2 });
  sparkBurst(b.x, b.y, '#ffffff', 6, b.r);
  addFx({ type: 'text', x: b.x, y: b.y - R, vx: 0, vy: -40, life: 0.9, text: S.defuseLeft ? `DEFUSED! ${S.defuseLeft} left` : 'DEFUSED!', color: '#e6ecf7', size: R * 0.9 });
  S.target = S.defuseLeft > 0 ? 'defuse' : null;
}
function endDefuse() { S.defuseLeft = 0; if (S.target === 'defuse') S.target = null; }
function useCard(slot) {
  const kind = slot.kind;
  // tapping Defuse while removals are left ends it early (the rest are lost)
  if (kind === 'defuse' && S.defuseLeft > 0) { endDefuse(); Sound.play('ui'); return; }
  if (!kind || !S.cards[kind]) { nope(slot, kind ? 'None yet' : 'Coming soon'); return; }
  if (TARGETED.has(kind)) {
    // another aimed card has to wait until Defuse is finished or stopped
    if (S.defuseLeft > 0) { nope(slot, `Defuse: ${S.defuseLeft} left`); return; }
    S.target = S.target === kind ? null : kind; S.swapPick = null; Sound.play('ui'); return;
  }
  if (kind === 'rewind' && !S.hist.length) { nope(slot, 'Nothing to rewind'); return; }
  if (kind === 'shield' && S.shieldOn) { nope(slot, 'Already on'); return; }
  if (S.defuseLeft <= 0) S.target = null; // instant cards keep an ongoing Defuse aimed
  S.cards[kind]--;
  applyPower(kind, A.x + A.w / 2, A.y + A.h / 2, null);
}
// distance from a tap to a bomb's edge; a moving bomb also counts where it was GRAB_LAG seconds ago,
// so a tap that lands just behind a fast bomb still grabs it
function grabDist(p, b) {
  const now = dist(p.x, p.y, b.x, b.y) - b.r;
  const moving = S.freezeT <= 0 && b.iceT <= 0 && !b.magnet;
  if (!moving) return now;
  const k = GRAB_LAG * (S.clockT > 0 ? CLOCK_SCALE : 1) * b.speed;
  const px = b.x - Math.cos(b.ang) * k, py = b.y - Math.sin(b.ang) * k;
  return Math.min(now, dist(p.x, p.y, px, py) - b.r);
}
function pickSortAt(p, slop) {
  let bestB = null, bd = Infinity;
  for (const b of S.bombs) {
    if (!alive(b) || b.state !== 'floor' || !isSort(b.kind)) continue;
    const d = grabDist(p, b);
    if (d < slop && d < bd) { bd = d; bestB = b; }
  }
  return bestB;
}
const inArena = (p) => p.x >= A.x && p.x <= A.x + A.w && p.y >= A.y && p.y <= A.y + A.h;
// second tap of a targeted card; returns true when the power went off
function applyTarget(p, slop) {
  const kind = S.target;
  let target = null;
  if (kind === 'swap') { // two taps: the first pen, then the pen to trade with
    const pen = penAt(p);
    if (!pen) return false;
    if (!S.swapPick) { S.swapPick = pen; Sound.play('ui'); return true; }
    if (S.swapPick === pen) { S.swapPick = null; Sound.play('ui'); return true; }
    const first = S.swapPick;
    S.swapPick = null; S.target = null; S.cards.swap--;
    applyPower('swap', p.x, p.y, [first, pen]);
    return true;
  }
  if (kind === 'void') {
    if (!inArena(p)) return false;
  } else {
    const b = pickSortAt(p, slop);
    if (kind === 'defuse' && S.defuseLeft > 0) { // a removal from a card already in use
      if (!b) return false;
      defuseBomb(b);
      return true;
    }
    if (kind === 'defuse') target = b;
    else target = b ? b.kind : (PENS.find((q) => p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h) || {}).color || null;
    if (!target) return false;
  }
  S.target = null;
  S.cards[kind]--;
  applyPower(kind, p.x, p.y, target);
  return true;
}
function trayHit(p) {
  if (!TRAY || !S) return null;
  return TRAY.slots.find((s) => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) || null;
}
function iceBurst(b) {
  b.dead = true;
  const rad = Math.max(R * 7.5, Math.min(W, H) * 0.3);
  for (const o of S.bombs) {
    if (o === b || !alive(o) || o.state !== 'floor') continue;
    if (dist(o.x, o.y, b.x, b.y) <= rad) o.iceT = ICE_BURST_DUR;
  }
  Sound.play('ice');
  addFx({ type: 'ring', x: b.x, y: b.y, life: 0.55, s: b.r, grow: rad, color: '#bff0ff', lw: R * 0.35 });
  for (let i = 0; i < 14; i++) {
    const a = rand(0, TAU), v = rand(150, 420) * SCALE;
    addFx({ type: 'shard', x: b.x, y: b.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 2, life: rand(0.4, 0.7), s: R * rand(0.2, 0.4), rot: a });
  }
  addFx({ type: 'text', x: b.x, y: b.y, vx: 0, vy: -40, life: 1, text: 'ICE BURST!', color: '#8fe3ff', size: R * 1.1 });
}
function fizzle(b) {
  b.dead = true;
  Sound.play('fizzle');
  addFx({ type: 'poof', x: b.x, y: b.y, life: 0.5, s: b.r });
}
function onThaw() {
  for (const b of S.bombs) {
    if (!alive(b) || b.state !== 'floor') continue;
    if (b.iceT <= 0) addFx({ type: 'poof', x: b.x, y: b.y, life: 0.3, s: b.r * 0.6, color: '#d8f6ff' });
    if (isSort(b.kind) && b.iceT <= 0 && b.fuse <= THAW_BOOM_FUSE) { boom(b, 'thaw'); if (mode !== 'play') return; }
  }
}
const KIND_NAME = {
  red: 'Red', blue: 'Blue', yellow: 'Yellow', green: 'Green', white: 'Freeze', clock: 'Clock', void: 'Black Hole',
  defuse: 'Defuse', magnet: 'Magnet', paint: 'Paint', fan: 'Fan', shield: 'Shield', auto: 'Auto-Sort', double: 'Double',
  swap: 'Swap', rewind: 'Rewind', boss: 'Boss', junk: 'Junk',
};
const CARD_NAME = { ...KIND_NAME, clock: 'Slow-mo', double: 'x2 Points' };
function causeText(b, why, pen) {
  if (b.kind === 'boss') return 'The boss bomb went off';
  const n = b.sp === 'cham' ? 'Chameleon' : KIND_NAME[b.kind];
  if (why === 'wrong') return `${n} bomb dropped in the ${KIND_NAME[pen]} pen`;
  if (why === 'thaw') return `${n} bomb thawed out with no fuse left`;
  return `${n} bomb's fuse ran out`;
}
function captureSnapshot() {
  try {
    const w = 360, h = Math.round((w * H) / W);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(cv, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.75);
  } catch (e) { return null; }
}

// ---------- explosions & game over ----------
function boom(b, why = 'fuse', pen = null) {
  if (mode !== 'play') return;
  if (S.shieldOn) {
    // the Shield eats this one mistake: the bomb pops harmlessly (no point)
    S.shieldOn = false;
    b.dead = true;
    if (held === b) { held = null; activePointer = null; }
    S.shake = 0.35;
    Sound.play('ice');
    addFx({ type: 'ring', x: b.x, y: b.y, life: 0.5, s: b.r, grow: R * 4, color: PAL.shield.aura, lw: R * 0.35 });
    addFx({ type: 'poof', x: b.x, y: b.y, life: 0.6, s: b.r * 1.3 });
    addFx({ type: 'text', x: b.x, y: b.y - R, vx: 0, vy: -40, life: 1.2, text: 'SHIELD SAVED YOU!', color: PAL.shield.aura, size: R * 1.05 });
    vibrate(40);
    return;
  }
  S.snapshot = captureSnapshot(); // the last frame before the blast
  S.cause = causeText(b, why, pen);
  vibrate([60, 40, 140]);
  mode = 'booming';
  b.dead = true;
  if (held && held !== b) { held.state = 'floor'; }
  held = null; activePointer = null;
  S.boom = { x: b.x, y: b.y, t: 0, kind: b.kind };
  S.boomT = BOOM_TIME; S.shake = 1;
  Sound.stopMusic(); Sound.play('boom');
  explosionFx(b.x, b.y);
  if (game === 'race') Race.report();
}
// add this run's sorted bombs to the lifetime total that unlocks looks (once per run)
function bankRun() {
  if (!S || S.banked) return;
  S.banked = true;
  S.unlocked = Looks.add(S.sorted);
}
// race: every rival is out and you're still standing
function winRace() {
  if (mode !== 'play' || !S) return;
  if (held) { held.state = 'floor'; held = null; activePointer = null; }
  S.won = true; S.cause = 'Your rival blew up first!';
  S.snapshot = captureSnapshot();
  Sound.stopMusic(); Sound.play('bossdown');
  gameOver();
}
function fillMissionList(ul) {
  ul.innerHTML = '';
  for (const m of S.missions) {
    const li = document.createElement('li');
    li.className = m.done ? 'done' : '';
    li.textContent = `${m.done ? '✓' : '○'} ${m.text}${m.done ? '' : ` (${missionProgress(m)}/${m.n})`}`;
    ul.appendChild(li);
  }
  ul.classList.toggle('hidden', !S.missions.length);
}
function gameOver() {
  mode = 'over';
  bankRun();
  const race = game === 'race';
  const isBest = S.score > best;
  if (isBest) { best = S.score; store.set(bestKey(game), String(best)); }
  $('#overTitle').textContent = S.won ? 'YOU WIN!' : 'KA-BOOM!';
  $('#overMode').textContent = MODE_LABEL[game] + (game === 'daily' ? ' · ' + dailyKey() : '');
  $('#overScore').textContent = S.score;
  $('#overBest').textContent = best;
  $('#newBest').classList.toggle('hidden', !isBest || race);
  $('#overCause').textContent = S.cause;
  $('#overCause').classList.toggle('win', !!S.won);
  $('#statSorted').textContent = S.sorted;
  $('#statCombo').textContent = S.bestCombo;
  $('#statLevel').textContent = S.tier + 1;
  $('#statPowers').textContent = S.powers;
  $('#statClutch').textContent = S.clutch;
  $('#statMissions').textContent = S.missions.filter((m) => m.done).length + '/' + S.missions.length;
  $('#statBosses').textContent = S.bosses;
  $('#statCards').textContent = S.cardsGot;
  fillMissionList($('#overMissions'));
  const un = $('#overUnlock');
  un.textContent = S.unlocked.length ? 'Unlocked: ' + S.unlocked.join(', ') + '! See Looks on the menu.' : '';
  un.classList.toggle('hidden', !S.unlocked.length);
  $('#raceResult').textContent = race ? Race.resultText() : '';
  $('#raceResult').classList.toggle('hidden', !race);
  $('#submitForm').classList.toggle('hidden', race);
  $('#submitMsg').classList.toggle('hidden', race);
  $('#btnAgain').textContent = race ? 'Back to the race room' : 'Play again';
  $('#btnOverBoard').classList.toggle('hidden', race);
  const img = $('#overShot');
  if (S.snapshot) { img.src = S.snapshot; img.hidden = false; } else img.hidden = true;
  $('#nameInput').value = store.get(KEY_NAME) || '';
  $('#submitMsg').textContent = ''; $('#submitMsg').className = 'msg';
  $('#btnSubmit').disabled = false;
  show('#over');
}

// ======================================================================
// Simulation step (fixed 60 Hz)
// ======================================================================
function step(dt) {
  updateFx(dt);
  updatePetals(dt);
  if (mode === 'menu') { updateDecor(dt); return; }
  if (!S) return;
  if (mode === 'booming') {
    S.boom.t += dt; S.boomT -= dt; S.shake = Math.max(0, S.shake - dt * 1.1);
    if (S.boomT <= 0) gameOver();
    return;
  }
  if (mode !== 'play') return;

  S.time += dt;
  if (S.banner) { S.banner.t += dt; if (S.banner.t > S.banner.life) S.banner = null; }
  if (S.hint > 0) S.hint -= dt;
  if (S.comboT > 0) S.comboT -= dt;
  if (S.comboPop) { S.comboPop.t += dt; if (S.comboPop.t > 0.9) S.comboPop = null; }
  if (S.tip) { S.tip.t += dt; if (S.tip.t > S.tip.life) S.tip = null; }

  // timers that run in real time
  if (S.clockT > 0) S.clockT = Math.max(0, S.clockT - dt);
  if (S.doubleT > 0) S.doubleT = Math.max(0, S.doubleT - dt);
  if (S.nope) { S.nope.t += dt; if (S.nope.t > 0.9) S.nope = null; }
  for (const f of S.flies) f.t += dt;
  S.flies = S.flies.filter((f) => f.t < 0.55);
  if (S.target && !S.cards[S.target] && !(S.target === 'defuse' && S.defuseLeft > 0)) S.target = null;
  if (S.freezeT > 0) {
    S.freezeT -= dt;
    if (!S.thawWarned && S.freezeT <= THAW_WARN) { S.thawWarned = true; Sound.play('thaw'); }
    if (S.freezeT <= 0) { S.freezeT = 0; onThaw(); if (mode !== 'play') return; }
  }
  const frozen = S.freezeT > 0;
  // Slow-mo card, plus the short slow-motion beat after a clutch save
  if (S.slowT > 0) S.slowT = Math.max(0, S.slowT - dt);
  const clockK = (S.clockT > 0 ? CLOCK_SCALE : 1) * (S.slowT > 0 ? CLUTCH_SCALE : 1);
  const tdt = dt * clockK; // bomb motion, fuses, spawn & hole timers
  if (S.meterPop > 0) S.meterPop = Math.max(0, S.meterPop - dt);
  if (S.rewindFx > 0) S.rewindFx = Math.max(0, S.rewindFx - dt);
  if (S.penFlash) { S.penFlash.t -= dt; if (S.penFlash.t <= 0) S.penFlash = null; }
  if (S.target !== 'swap') S.swapPick = null;
  if (!frozen) { eventTick(tdt); recordHistory(tdt); }
  // missions
  for (const m of S.missions) {
    if (m.done) { if (m.doneT > 0) m.doneT -= dt; continue; }
    if (m.def.get(m) < m.n) continue;
    m.done = true; m.doneT = 2.5;
    Sound.play('mission');
    addFx({ type: 'text', x: A.x + A.w / 2, y: A.y + A.h * 0.3, vx: 0, vy: -25, life: 1.6, text: 'MISSION DONE!', color: '#7dffb0', size: R * 1.5 });
    rewardCard(A.x + A.w / 2, A.y + A.h * 0.3);
  }
  // a heavy bomb lags behind the finger
  if (held && held.sp === 'heavy' && held.tx !== undefined) {
    const dx = held.tx - held.x, dy = held.ty - held.y, d = Math.hypot(dx, dy), max = HEAVY_DRAG * SCALE * dt;
    if (d <= max) { held.x = held.tx; held.y = held.ty; } else { held.x += (dx / d) * max; held.y += (dy / d) * max; }
  }
  // drag trail (a cosmetic look)
  if (held && Looks.trail !== 'none') { S.trailT = (S.trailT || 0) - dt; if (S.trailT <= 0) { S.trailT = 0.045; trailPuff(held.x, held.y + held.r * 0.2, held.r); } }
  if (game === 'race') Race.tick(dt);
  if (mode !== 'play') return;

  for (const c of SORT) if (S.magnets[c] > 0) S.magnets[c] = Math.max(0, S.magnets[c] - dt * clockK * (frozen ? 0.5 : 1));

  const gap = waveGap(S.score, S.tier) / eventRate();
  if (!frozen) S.spawnT += tdt; // Freeze stops all spawns (the brief allowed 4 extra at half speed)
  if (S.spawnT >= gap) { S.spawnT = Math.min(S.spawnT - gap, gap); spawnWave(); }
  if (!frozen) powerTick(tdt);
  // boss bomb every BOSS_EVERY points (one at a time)
  if (!frozen && S.score >= S.bossAt && !S.bombs.some((b) => alive(b) && b.kind === 'boss')) {
    S.bossAt = (Math.floor(S.score / BOSS_EVERY) + 1) * BOSS_EVERY;
    spawnBoss();
  }
  // junk bombs lobbed over by race rivals arrive one at a time
  if (S.junkQueue > 0 && !frozen) {
    S.junkT -= tdt;
    if (S.junkT <= 0 && room() > 0) {
      S.junkQueue--; S.junkT = 0.5;
      const j = spawnBomb('junk');
      addFx({ type: 'text', x: j.x, y: j.y - R * 1.6, vx: 0, vy: -40, life: 0.9, text: 'JUNK!', color: '#c9c3d6', size: R * 0.95 });
      Sound.play('junk');
    }
  }

  if (S.clearT >= 0) { S.clearT -= dt; if (S.clearT < 0) { S.clearT = -1; clearPens(); } }

  for (const h of S.holes) {
    h.t -= tdt;
    for (const b of S.bombs) {
      if (!alive(b) || b.state !== 'floor' || !isSort(b.kind)) continue;
      const d = dist(b.x, b.y, h.x, h.y);
      if (d <= h.r + 0.15 * b.r) {
        b.state = 'sucked';
        b.suck = { hx: h.x, hy: h.y, t: 0, dur: rand(0.9, 1.18), a0: Math.atan2(b.y - h.y, b.x - h.x), d0: d, e: 0 };
      }
    }
  }
  S.holes = S.holes.filter((h) => h.t > 0);

  let minFuse = Infinity;
  for (const b of S.bombs) {
    if (!alive(b)) continue;
    updateBomb(b, dt, tdt, frozen, clockK);
    if (mode !== 'play') return;
    if (alive(b) && b.state === 'floor' && !isPower(b.kind) && !frozen && b.iceT <= 0) minFuse = Math.min(minFuse, b.fuse);
  }
  S.bombs = S.bombs.filter(alive);

  if (minFuse < WARN_FUSE) {
    S.tickT -= dt;
    if (S.tickT <= 0) { Sound.play('tick'); S.tickT = 0.16 + 0.5 * (minFuse / WARN_FUSE); }
  } else S.tickT = 0;
}

function updateBomb(b, dt, tdt, frozen, clockK) {
  if (b.pop < 1) b.pop = Math.min(1, b.pop + dt * 5);
  b.blink -= dt; if (b.blink < -0.13) b.blink = rand(2, 5);
  if (b.state === 'held') return;

  if (b.state === 'sucked') {
    const s = b.suck;
    s.t += tdt;
    const e = Math.min(1, s.t / s.dur), ee = e * e;
    const a = s.a0 + ee * 9;
    b.x = s.hx + Math.cos(a) * s.d0 * (1 - ee);
    b.y = s.hy + Math.sin(a) * s.d0 * (1 - ee);
    b.x = clamp(b.x, A.x + b.r * 0.5, A.x + A.w - b.r * 0.5);
    b.y = clamp(b.y, A.y + b.r * 0.5, A.y + A.h - b.r * 0.5);
    s.e = ee;
    if (e >= 1) { b.dead = true; addPoint(s.hx, s.hy, b.kind); sparkBurst(s.hx, s.hy, '#b48cff', 3, R); Sound.play('sort'); }
    return;
  }

  if (b.state === 'sorted') {
    if (frozen) return;
    const p = b.pen, m = b.r + LW;
    b.turn = clamp(b.turn + rand(-1, 1) * 6 * tdt, -1.5, 1.5);
    b.ang += b.turn * tdt;
    b.x += Math.cos(b.ang) * b.speed * tdt; b.y += Math.sin(b.ang) * b.speed * tdt;
    if (b.x < p.x + m) { b.x = p.x + m; b.ang = Math.PI - b.ang; }
    if (b.x > p.x + p.w - m) { b.x = p.x + p.w - m; b.ang = Math.PI - b.ang; }
    if (b.y < p.y + m) { b.y = p.y + m; b.ang = -b.ang; }
    if (b.y > p.y + p.h - m) { b.y = p.y + p.h - m; b.ang = -b.ang; }
    return;
  }

  // ---- floor ----
  if (b.iceT > 0) {
    b.iceT -= dt;
    if (b.iceT <= 0) {
      b.iceT = 0;
      addFx({ type: 'poof', x: b.x, y: b.y, life: 0.3, s: b.r * 0.6, color: '#d8f6ff' });
      if (!frozen && isSort(b.kind) && b.fuse <= THAW_BOOM_FUSE) { boom(b, 'thaw'); return; }
    }
  }
  if (b.kx || b.ky) { // Fan push, fades out quickly
    b.x += b.kx * dt; b.y += b.ky * dt;
    const k = Math.exp(-4 * dt); b.kx *= k; b.ky *= k;
    if (Math.hypot(b.kx, b.ky) < 5) { b.kx = 0; b.ky = 0; }
    keepOnFloor(b);
  }
  const iced = frozen || b.iceT > 0;
  if (b.hitT > 0) b.hitT -= dt;
  if (!iced && b.sp === 'cham') { // a chameleon switches to another color every few seconds
    b.chamT -= tdt;
    if (b.chamT <= 0) {
      const others = SORT.filter((c) => c !== b.kind);
      b.kind = others[Math.floor(Math.random() * others.length)]; b.chamT = CHAM_EVERY;
      addFx({ type: 'ring', x: b.x, y: b.y, life: 0.35, s: b.r, grow: b.r * 1.2, color: PAL[b.kind].base, lw: b.r * 0.25 });
    }
  }
  if (!iced && b.sp === 'twin' && b.fuse < b.fuseMax * TWIN_SPLIT_AT) { splitTwin(b); return; }
  if (!iced && b.btype === 'thief') thiefTick(b, tdt);
  if (b.erratic && !iced) { // rare powers dart around
    b.dashT -= tdt;
    if (b.dashT <= 0) { b.dashT = rand(0.45, 1.0); b.ang += rand(-2.4, 2.4); }
  }
  b.magnet = isSort(b.kind) && S.magnets[b.kind] > 0;
  if (b.magnet) {
    const p = penOf(b.kind);
    const sp = MAGNET_SPEED * cruise() * clockK * (iced ? 0.5 : 1) * dt;
    const dx = p.cx - b.x, dy = p.cy - b.y, d = Math.hypot(dx, dy);
    b.ang = Math.atan2(dy, dx);
    if (d <= sp) { b.x = p.cx; b.y = p.cy; } else { b.x += (dx / d) * sp; b.y += (dy / d) * sp; }
    const m = b.r * 0.5;
    if (b.x > p.x + m && b.x < p.x + p.w - m && b.y > p.y + m && b.y < p.y + p.h - m) { sortBomb(b, p, true); return; }
  } else if (!iced) {
    b.turn = clamp(b.turn + rand(-1, 1) * 6 * tdt, -1.4, 1.4);
    b.ang += b.turn * tdt;
    b.x += Math.cos(b.ang) * b.speed * tdt;
    b.y += Math.sin(b.ang) * b.speed * tdt;
    if (S.event && S.event.kind === 'wind') { // the Wind event pushes everything one way
      b.x += Math.cos(S.event.dir) * WIND_SPEED * SCALE * tdt; b.y += Math.sin(S.event.dir) * WIND_SPEED * SCALE * tdt;
    }
    keepOnFloor(b);
  }
  if (!iced && b !== S.tutorialBomb) {
    b.fuse -= tdt;
    if (isSort(b.kind) && b.fuse < WARN_FUSE && Math.random() < dt * 14) {
      const tip = fuseTip(b);
      addFx({ type: 'spark', x: tip.x, y: tip.y, vx: rand(-60, 60) * SCALE, vy: rand(-90, -20) * SCALE, g: 300 * SCALE, life: 0.35, s: b.r * 0.22, color: '#ffb02e' });
    }
  }
  if (b.fuse <= 0) {
    if (b.btype === 'thief') thiefEscape(b); // the thief runs off with the loot instead of exploding
    else if (isSort(b.kind) || b.kind === 'boss' || b.kind === 'junk') boom(b);
    else if (b.kind === 'white') iceBurst(b);
    else fizzle(b);
  }
}
function fuseTip(b) {
  const f = 0.2 + 0.8 * clamp(b.fuse / b.fuseMax, 0, 1);
  return { x: b.x + b.r * 0.42 * f, y: b.y - b.r * 1.2 - b.r * 0.62 * f };
}

// ======================================================================
// Input
// ======================================================================
function evPos(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function hudButtons() {
  const s = HUD * 0.72, y = (HUD - s) / 2;
  return [
    { id: 'pause', x: W - MARGIN - s, y, s },
    { id: 'mute', x: W - MARGIN - s * 2 - s * 0.25, y, s },
  ];
}
function hudHit(p) {
  if (mode !== 'play') return false;
  for (const b of hudButtons()) {
    if (p.x >= b.x && p.x <= b.x + b.s && p.y >= b.y && p.y <= b.y + b.s) {
      if (b.id === 'pause') pauseGame(); else toggleMute();
      return true;
    }
  }
  return false;
}
function pickAt(p, slop) {
  let bestB = null, bd = Infinity;
  for (const b of S.bombs) {
    if (!alive(b) || b.state !== 'floor') continue;
    const d = grabDist(p, b);
    if (d < slop && d < bd) { bd = d; bestB = b; }
  }
  return bestB;
}
function moveHeld(p) {
  if (!held) return;
  const x = clamp(p.x, A.x + held.r * 0.5, A.x + A.w - held.r * 0.5);
  const y = clamp(p.y - held.offY, A.y + held.r * 0.5, A.y + A.h - held.r * 0.5);
  if (held.sp === 'heavy') { held.tx = x; held.ty = y; return; } // step() drags it there at its own pace
  held.x = x; held.y = y;
}
function dropHeld() {
  const b = held; held = null;
  if (!b || b.dead || mode !== 'play') return;
  // dropped onto a color boss?
  const cb = S.bombs.find((o) => alive(o) && o.kind === 'boss' && o.btype === 'color' && o.state === 'floor' && dist(b.x, b.y, o.x, o.y) < o.r + b.r * 0.5);
  if (cb) { feedBoss(cb, b); return; }
  for (const p of BLOCKS) {
    if (coverage(b, p) >= 0.5) {
      if (b.kind === 'junk') { // a rival's junk goes in any pen: no point, no penalty
        b.dead = true;
        Sound.play('fizzle');
        addFx({ type: 'poof', x: b.x, y: b.y, life: 0.5, s: b.r });
        addFx({ type: 'text', x: b.x, y: b.y - R, vx: 0, vy: -45, life: 0.7, text: 'TOSSED!', color: '#c9c3d6', size: R * 0.9 });
        return;
      }
      if (p.color === b.kind) sortBomb(b, p, false);
      else boom(b, 'wrong', p.color);
      return;
    }
  }
  b.state = 'floor'; b.speed = bombSpeed(b); b.ang = rand(0, TAU);
  keepOnFloor(b);
  Sound.play('drop');
}
// the boss under a tap, if any (it takes taps even while a card is being aimed)
function bossAt(p, slop) {
  for (const b of S.bombs) if (alive(b) && b.kind === 'boss' && b.state === 'floor' && dist(p.x, p.y, b.x, b.y) - b.r < slop) return b;
  return null;
}
cv.addEventListener('pointerdown', (e) => {
  Sound.unlock();
  const p = evPos(e);
  if (hudHit(p)) return;
  if (mode !== 'play' || activePointer !== null) return;
  const touch = e.pointerType !== 'mouse';
  const slot = trayHit(p);
  if (slot) { useCard(slot); e.preventDefault(); return; }
  const boss = bossAt(p, touch ? 14 : 6);
  // a color boss can't be tapped apart, so a bomb lying over it can still be picked up
  const overBoss = boss && boss.btype === 'color' && !S.target ? pickSortAt(p, touch ? 18 : 8) : null;
  if (boss && !overBoss) { hitBoss(boss, p); e.preventDefault(); return; }
  if (S.target) {
    if (!applyTarget(p, touch ? 18 : 8)) {
      const s = TRAY.slots.find((q) => q.kind === S.target);
      if (S.defuseLeft > 0) nope(s, `${S.defuseLeft} left: tap a bomb`); // a missed tap never wastes removals
      else if (!inArena(p)) S.target = null; // tapping outside the board cancels
      else nope(s, S.target === 'void' ? 'Tap the board' : S.target === 'swap' ? 'Tap a pen' : 'Tap a bomb');
    }
    e.preventDefault();
    return;
  }
  const b = overBoss || pickAt(p, touch ? 18 : 8);
  if (!b) return;
  if (b.kind === 'boss') { hitBoss(b, p); e.preventDefault(); return; } // a near miss still counts as a tap on it
  if (isPower(b.kind)) { collect(b); e.preventDefault(); return; }
  if (!isSort(b.kind) && b.kind !== 'junk') return; // only color bombs and junk can be dragged
  activePointer = e.pointerId;
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  held = b; b.state = 'held'; b.offY = touch ? 1.35 * b.r : 0;
  b.tx = undefined; b.ty = undefined;
  moveHeld(p);
  Sound.play('pick');
  e.preventDefault();
});
cv.addEventListener('pointermove', (e) => {
  const p = evPos(e);
  if (e.pointerId === activePointer) { moveHeld(p); return; }
  if (e.pointerType === 'mouse' && mode === 'play' && S) {
    const overBtn = hudButtons().some((b) => p.x >= b.x && p.x <= b.x + b.s && p.y >= b.y && p.y <= b.y + b.s) || !!trayHit(p);
    const b = !overBtn && pickAt(p, 8);
    cv.style.cursor = overBtn ? 'pointer' : S.target && inArena(p) ? 'crosshair' : b ? (isSort(b.kind) || b.kind === 'junk' ? 'grab' : 'pointer') : 'default';
  }
});
function endPointer(e) {
  if (e.pointerId !== activePointer) return;
  activePointer = null;
  dropHeld();
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape' && mode === 'play' && S && S.target) { if (S.defuseLeft > 0) endDefuse(); else S.target = null; return; }
  // keyboard shortcuts for the cards: 1–9, 0, - (in slot order)
  const ki = '1234567890-='.indexOf(e.key);
  if (ki >= 0 && mode === 'play' && TRAY && S && !held) { useCard(TRAY.slots[ki]); return; }
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { if (mode === 'play') pauseGame(); else if (mode === 'paused') resumeGame(); }
  if (e.key === 'm' || e.key === 'M') toggleMute();
});
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'play' && game !== 'race') pauseGame(); });
window.addEventListener('resize', resize);

// ======================================================================
// Effects
// ======================================================================
function addFx(o) { o.t = 0; o.seed = o.seed ?? Math.random() * 1000; fx.push(o); return o; }
function sparkBurst(x, y, color, n, r) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), v = rand(80, 260) * Math.max(0.6, SCALE);
    addFx({ type: 'star', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3, life: rand(0.45, 0.8), s: r * rand(0.25, 0.5), color: i % 3 ? color : '#ffffff' });
  }
}
// ---- looks: trails left while dragging, and a matching burst on a sort ----
function trailPuff(x, y, r) {
  const tr = Looks.trail;
  if (tr === 'spark') addFx({ type: 'spark', x: x + rand(-r, r) * 0.5, y: y + rand(-r, r) * 0.5, vx: rand(-20, 20), vy: rand(10, 50), life: 0.45, s: r * rand(0.22, 0.4), color: Math.random() < 0.5 ? '#ffffff' : '#ffe14d' });
  else if (tr === 'hearts') addFx({ type: 'heart', x: x + rand(-r, r) * 0.5, y, vx: rand(-15, 15), vy: rand(-50, -20), life: 0.6, s: r * rand(0.22, 0.36), color: Math.random() < 0.5 ? '#ff5fa2' : '#ff9ac4' });
  else if (tr === 'stars') addFx({ type: 'star', x: x + rand(-r, r) * 0.4, y: y + rand(-r, r) * 0.4, vx: rand(-30, 30), vy: rand(-30, 30), drag: 2, life: 0.5, s: r * rand(0.25, 0.42), color: ['#ffe14d', '#7de3ff', '#ff9fd6'][Math.floor(Math.random() * 3)] });
}
function trailBurst(x, y, r) {
  if (Looks.trail === 'none') return;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU, v = rand(120, 220) * Math.max(0.6, SCALE);
    const o = { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3, life: 0.6, s: r * 0.34 };
    if (Looks.trail === 'hearts') addFx({ ...o, type: 'heart', color: i % 2 ? '#ff5fa2' : '#ff9ac4' });
    else if (Looks.trail === 'stars') addFx({ ...o, type: 'star', color: ['#ffe14d', '#7de3ff', '#ff9fd6'][i % 3] });
    else addFx({ ...o, type: 'spark', color: i % 2 ? '#ffffff' : '#ffe14d' });
  }
}
function heartPath(g, x, y, s) {
  g.beginPath(); g.moveTo(x, y + s * 0.9);
  g.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.7, y - s * 1.1, x, y - s * 0.35);
  g.bezierCurveTo(x + s * 0.7, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
  g.closePath();
}
function explosionFx(x, y) {
  addFx({ type: 'burst', x, y, life: 0.95, s: R });
  addFx({ type: 'ring', x, y, life: 0.55, s: R, grow: R * 16, color: '#fff6d8', lw: R * 0.45 });
  addFx({ type: 'lines', x, y, life: 0.6 });
  for (let i = 0; i < 22; i++) {
    const a = rand(0, TAU), v = rand(220, 620) * Math.max(0.6, SCALE);
    addFx({ type: 'debris', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120 * SCALE, g: 900 * SCALE, drag: 0.8, life: rand(0.6, 1.0), s: R * rand(0.12, 0.26), rot: rand(0, TAU), color: i % 3 ? INK : '#ff9a2e' });
  }
  for (let i = 0; i < 10; i++) {
    const a = rand(0, TAU), v = rand(40, 140) * Math.max(0.6, SCALE);
    addFx({ type: 'smoke', x: x + Math.cos(a) * R, y: y + Math.sin(a) * R, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, drag: 1.5, life: rand(0.7, 1.0), s: R * rand(0.8, 1.4) });
  }
  addFx({ type: 'boomtext', x, y: y - R * 2.2, life: BOOM_TIME });
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    if (f.vx !== undefined) {
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (f.g) f.vy += f.g * dt;
      if (f.drag) { const k = Math.max(0, 1 - f.drag * dt); f.vx *= k; f.vy *= k; }
    }
    if (f.t >= f.life) fx.splice(i, 1);
  }
}
function star4(g, x, y, s, rot = 0) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = rot + (i * Math.PI) / 4, rr = i % 2 ? s * 0.28 : s;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}
function spiky(g, x, y, r, spikes, jag, seed) {
  const rn = seeded(seed);
  g.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * TAU, rr = i % 2 ? r * (1 - jag) * (0.85 + rn() * 0.3) : r * (0.85 + rn() * 0.3);
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}
function drawFx(g) {
  for (const f of fx) {
    const p = f.t / f.life;
    g.save();
    switch (f.type) {
      case 'star': case 'spark': {
        g.globalAlpha = 1 - p;
        const s = f.s * (p < 0.2 ? p / 0.2 : 1 - (p - 0.2) * 0.8);
        star4(g, f.x, f.y, s, f.seed + p * 3);
        g.fillStyle = f.color; g.fill();
        if (f.type === 'star') { g.lineWidth = Math.max(1, s * 0.15); g.strokeStyle = INK; g.stroke(); }
        break;
      }
      case 'heart': {
        g.globalAlpha = 1 - p;
        heartPath(g, f.x, f.y, f.s * (p < 0.2 ? p / 0.2 : 1));
        g.fillStyle = f.color; g.fill(); g.lineWidth = Math.max(1, f.s * 0.18); g.strokeStyle = INK; g.stroke();
        break;
      }
      case 'ring': {
        g.globalAlpha = (1 - p) * 0.9;
        g.beginPath(); g.arc(f.x, f.y, Math.max(0.5, f.s + f.grow * easeOut(p)), 0, TAU);
        g.lineWidth = Math.max(1, f.lw * (1 - p)); g.strokeStyle = f.color; g.stroke();
        break;
      }
      case 'text': {
        const k = p < 0.15 ? easeOutBack(p / 0.15) : 1;
        g.globalAlpha = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
        outlineText(g, f.text, f.x, f.y, f.size * k, f.color, { rot: -0.08 });
        break;
      }
      case 'poof': {
        g.globalAlpha = 1 - p;
        g.fillStyle = f.color || '#ffffff'; g.strokeStyle = INK; g.lineWidth = Math.max(1, f.s * 0.08);
        for (let i = 0; i < 5; i++) {
          const a = f.seed + i * 1.256, d = f.s * (0.3 + p * 1.3);
          g.beginPath(); g.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, f.s * 0.45 * (1 - p * 0.6), 0, TAU);
          g.fill(); g.stroke();
        }
        break;
      }
      case 'shard': {
        g.globalAlpha = 1 - p;
        g.translate(f.x, f.y); g.rotate(f.rot + p * 6);
        g.beginPath(); g.moveTo(0, -f.s); g.lineTo(f.s * 0.4, f.s * 0.6); g.lineTo(-f.s * 0.4, f.s * 0.6); g.closePath();
        g.fillStyle = '#d8f6ff'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#2c86cc'; g.stroke();
        break;
      }
      case 'debris': {
        g.globalAlpha = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
        g.translate(f.x, f.y); g.rotate(f.rot + p * 10);
        g.fillStyle = f.color; g.fillRect(-f.s, -f.s * 0.6, f.s * 2, f.s * 1.2);
        break;
      }
      case 'smoke': {
        g.globalAlpha = 0.85 * (1 - p);
        const s = f.s * (0.6 + p * 0.9);
        g.beginPath(); g.arc(f.x, f.y, s, 0, TAU);
        g.fillStyle = '#7d6a8f'; g.fill();
        g.beginPath(); g.arc(f.x - s * 0.25, f.y - s * 0.25, s * 0.7, 0, TAU);
        g.fillStyle = '#a896b8'; g.fill();
        break;
      }
      case 'burst': {
        const e = easeOut(Math.min(1, p * 1.6));
        const r = f.s * (1.2 + 5.2 * e);
        g.globalAlpha = p > 0.6 ? 1 - (p - 0.6) / 0.4 : 1;
        spiky(g, f.x, f.y, r * 1.15, 13, 0.38, f.seed); g.fillStyle = '#ff5a1f'; g.fill(); g.lineWidth = LW * 1.4; g.strokeStyle = INK; g.stroke();
        spiky(g, f.x, f.y, r * 0.85, 11, 0.3, f.seed + 7); g.fillStyle = '#ffb22e'; g.fill();
        spiky(g, f.x, f.y, r * 0.55 * (1 - p * 0.7), 9, 0.25, f.seed + 13); g.fillStyle = '#fff4c2'; g.fill();
        break;
      }
      case 'lines': {
        g.globalAlpha = 0.7 * (1 - p);
        speedLines(g, f.x, f.y, R * (2.5 + p * 4), Math.hypot(W, H), 46, f.seed, INK);
        break;
      }
      case 'boomtext': {
        const k = p < 0.12 ? easeOutBack(p / 0.12) : 1 + (p - 0.12) * 0.15;
        outlineText(g, 'BOOM!', f.x, f.y, R * 2.6 * k, '#ffe14d', { rot: -0.12, lw: R * 0.5 });
        break;
      }
    }
    g.restore();
  }
}
function speedLines(g, cx, cy, r0, r1, n, seed, color) {
  const rn = seeded(Math.floor(seed));
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rn() * 0.12, w = 0.006 + rn() * 0.018, start = r0 * (1 + rn() * 0.8);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * start, cy + Math.sin(a) * start);
    g.lineTo(cx + Math.cos(a - w) * r1, cy + Math.sin(a - w) * r1);
    g.lineTo(cx + Math.cos(a + w) * r1, cy + Math.sin(a + w) * r1);
    g.closePath(); g.fill();
  }
}
function outlineText(g, txt, x, y, size, fill, { rot = 0, lw = null, font = FONT_FX, align = 'center', base = 'middle', stroke = INK } = {}) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  g.font = `${Math.max(1, size)}px ${font}`;
  g.textAlign = align; g.textBaseline = base; g.lineJoin = 'round';
  g.lineWidth = lw ?? size * 0.2; g.strokeStyle = stroke; g.strokeText(txt, 0, 0);
  g.fillStyle = fill; g.fillText(txt, 0, 0);
  g.restore();
}

// ======================================================================
// Petals & menu decor
// ======================================================================
function newPetal(anywhere) {
  return {
    x: rand(-40, W), y: anywhere ? rand(0, H) : rand(-60, -10),
    vx: rand(12, 40), vy: rand(22, 50), rot: rand(0, TAU), vr: rand(-2, 2), s: rand(4, 8) * clamp(SCALE * 1.4, 0.7, 1.4), ph: rand(0, TAU),
  };
}
function initPetals() { petals.length = 0; for (let i = 0; i < 20; i++) petals.push(newPetal(true)); }
function updatePetals(dt) {
  for (const p of petals) {
    p.ph += dt * 2;
    p.x += (p.vx + Math.sin(p.ph) * 20) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    if (p.y > H + 20 || p.x > W + 20) Object.assign(p, newPetal(false));
  }
}
function drawPetals(g) {
  g.save();
  for (const p of petals) {
    g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, 0.45 + 0.4 * Math.abs(Math.sin(p.ph)));
    g.beginPath();
    g.moveTo(0, -p.s); g.quadraticCurveTo(p.s, -p.s * 0.2, 0, p.s); g.quadraticCurveTo(-p.s, -p.s * 0.2, 0, -p.s);
    g.globalAlpha = 0.75; g.fillStyle = '#ffb3d1'; g.fill();
    g.globalAlpha = 0.9; g.lineWidth = 1; g.strokeStyle = '#ff7fb0'; g.stroke();
    g.restore();
  }
  g.restore();
}
function initDecor() {
  decor.length = 0;
  const kinds = ['red', 'blue', 'yellow', 'green', 'red', 'blue', 'yellow', 'green', 'white', 'clock', 'void'];
  kinds.forEach((k, i) => {
    const mult = isSort(k) ? 1 : POWER_SIZE, r = R * mult * 1.3;
    decor.push({ id: i, kind: k, mult, r, x: rand(r, W - r), y: rand(r, H - r), ang: rand(0, TAU), turn: 0, speed: rand(30, 60), fuse: 1, fuseMax: 1, rare: i === 2, state: 'floor', iceT: 0, pop: 1, blink: rand(1, 4), seed: rand(0, 100) });
  });
}
function updateDecor(dt) {
  for (const b of decor) {
    b.blink -= dt; if (b.blink < -0.13) b.blink = rand(2, 5);
    b.turn = clamp(b.turn + rand(-1, 1) * 4 * dt, -1, 1); b.ang += b.turn * dt;
    b.x += Math.cos(b.ang) * b.speed * dt; b.y += Math.sin(b.ang) * b.speed * dt;
    if (b.x < b.r || b.x > W - b.r) { b.x = clamp(b.x, b.r, W - b.r); b.ang = Math.PI - b.ang; }
    if (b.y < b.r || b.y > H - b.r) { b.y = clamp(b.y, b.r, H - b.r); b.ang = -b.ang; }
  }
}

// ======================================================================
// Background (cached): anime sky + sunlit plaza arena + pens
// ======================================================================
function rrect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
const THEMES = [
  { name: 'day', sky: ['#5cc6ff', '#a7b4ff', '#ffbfe0'], floor: ['#fff3de', '#ffe4f0'], tile: 'rgba(255,170,140,0.12)', rays: 0.18, cloud: ['#c9d6ff', '#ffffff'], magic: 'rgba(255,140,170,0.35)', shaft: 0.35, stars: false },
  { name: 'sunset', sky: ['#ff9a6b', '#ff7fa8', '#7b5cc4'], floor: ['#ffe9d3', '#ffd9e0'], tile: 'rgba(255,130,90,0.13)', rays: 0.22, cloud: ['#e89ab0', '#ffd9c4'], magic: 'rgba(235,105,95,0.35)', shaft: 0.3, stars: false },
  { name: 'night', sky: ['#141a4a', '#3a2a78', '#7a4aa8'], floor: ['#ece7ff', '#ddd7fb'], tile: 'rgba(110,90,200,0.12)', rays: 0, cloud: ['#3d3684', '#5a4fa6'], magic: 'rgba(120,100,230,0.38)', shaft: 0.18, stars: true },
  // unlockable arenas (see Looks)
  { name: 'aurora', sky: ['#08243f', '#0f6a6e', '#6fe0b0'], floor: ['#e6fff5', '#d6f1ff'], tile: 'rgba(40,170,150,0.13)', rays: 0, cloud: ['#12506e', '#2a8f9a'], magic: 'rgba(40,190,160,0.4)', shaft: 0.22, stars: true },
  { name: 'candy', sky: ['#ff9fd6', '#ffc3a0', '#fff3b0'], floor: ['#fff0f8', '#fff6d8'], tile: 'rgba(255,110,190,0.13)', rays: 0.26, cloud: ['#ffb8e0', '#ffffff'], magic: 'rgba(255,100,180,0.38)', shaft: 0.36, stars: false },
];
function cloud(g, x, y, s) {
  const th = THEMES[theme];
  const blobs = [[0, 0, 1], [-0.9, 0.25, 0.7], [0.95, 0.2, 0.75], [-0.4, -0.45, 0.65], [0.45, -0.5, 0.7], [1.6, 0.4, 0.45], [-1.6, 0.45, 0.45]];
  g.fillStyle = th.cloud[0];
  for (const [bx, by, br] of blobs) { g.beginPath(); g.arc(x + bx * s, y + by * s + s * 0.18, br * s, 0, TAU); g.fill(); }
  g.fillStyle = th.cloud[1];
  for (const [bx, by, br] of blobs) { g.beginPath(); g.arc(x + bx * s, y + by * s, br * s * 0.94, 0, TAU); g.fill(); }
}
function buildBg() {
  bg.width = cv.width; bg.height = cv.height;
  const g = bgx, th = THEMES[theme];
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  // sky
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, th.sky[0]); sky.addColorStop(0.5, th.sky[1]); sky.addColorStop(1, th.sky[2]);
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  document.body.style.background = th.sky[0];
  if (th.stars) {
    const rs = seeded(21);
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 90; i++) { g.globalAlpha = 0.4 + rs() * 0.6; star4(g, rs() * W, rs() * H, 1 + rs() * 2.5, 0); g.fill(); }
    g.globalAlpha = 1;
    // crescent moon
    const mx = W * 0.86, my = H * 0.12, mr = Math.max(18, Math.min(W, H) * 0.06);
    g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fillStyle = '#fff4c2'; g.fill();
    g.beginPath(); g.arc(mx + mr * 0.45, my - mr * 0.2, mr * 0.85, 0, TAU); g.fillStyle = th.sky[0]; g.fill();
  }
  // sun rays from top-right
  g.save(); g.globalAlpha = th.rays; g.fillStyle = '#ffffff';
  const sx = W * 0.85, sy = -H * 0.1;
  for (let i = 0; i < 12; i++) {
    const a = Math.PI * 0.5 + (i / 12) * Math.PI * 0.75, w = 0.05;
    g.beginPath(); g.moveTo(sx, sy);
    g.lineTo(sx + Math.cos(a - w) * W * 2, sy + Math.sin(a - w) * W * 2);
    g.lineTo(sx + Math.cos(a + w) * W * 2, sy + Math.sin(a + w) * W * 2); g.fill();
  }
  g.restore();
  const rn = seeded(7);
  for (let i = 0; i < 8; i++) cloud(g, rn() * W, rn() * H, (20 + rn() * 40) * Math.max(0.6, SCALE * 1.4));
  drawArena(g);
  for (const p of PENS) drawPen(g, p);
}
function drawArena(g) {
  const { x, y, w, h } = A, rad = Math.min(14, Math.min(w, h) * 0.03), th = THEMES[theme];
  g.save();
  g.fillStyle = 'rgba(29,16,51,0.35)'; rrect(g, x + LW * 2, y + LW * 2.5, w, h, rad); g.fill();
  rrect(g, x, y, w, h, rad); g.save(); g.clip();
  const fl = g.createLinearGradient(x, y, x + w * 0.3, y + h);
  fl.addColorStop(0, th.floor[0]); fl.addColorStop(1, th.floor[1]);
  g.fillStyle = fl; g.fillRect(x, y, w, h);
  // tiles
  const ts = Math.max(26, Math.min(w, h) / 11);
  g.fillStyle = th.tile;
  for (let i = 0; i * ts < w; i++) for (let j = 0; j * ts < h; j++) if ((i + j) % 2 === 0) g.fillRect(x + i * ts, y + j * ts, ts, ts);
  // light shafts
  g.globalAlpha = th.shaft; g.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) {
    const ox = x + w * (0.1 + i * 0.27);
    g.beginPath(); g.moveTo(ox, y); g.lineTo(ox + w * 0.08, y); g.lineTo(ox - w * 0.12, y + h); g.lineTo(ox - w * 0.22, y + h); g.fill();
  }
  g.globalAlpha = 1;
  // magic circle
  const cx = x + w / 2, cy = y + h / 2, mr = Math.min(w, h) * 0.23;
  g.strokeStyle = th.magic; g.lineWidth = LW;
  g.beginPath(); g.arc(cx, cy, mr, 0, TAU); g.stroke();
  g.lineWidth = LW * 0.6; g.beginPath(); g.arc(cx, cy, mr * 0.82, 0, TAU); g.stroke();
  g.beginPath(); g.arc(cx, cy, mr * 0.4, 0, TAU); g.stroke();
  g.beginPath();
  for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i * TAU * 2) / 6; g.lineTo(cx + Math.cos(a) * mr * 0.82, cy + Math.sin(a) * mr * 0.82); }
  g.closePath(); g.stroke();
  g.beginPath();
  for (let i = 0; i < 6; i++) { const a = Math.PI / 2 + (i * TAU * 2) / 6; g.lineTo(cx + Math.cos(a) * mr * 0.82, cy + Math.sin(a) * mr * 0.82); }
  g.closePath(); g.stroke();
  g.fillStyle = th.magic;
  for (let i = 0; i < 12; i++) { const a = (i * TAU) / 12; star4(g, cx + Math.cos(a) * mr * 0.91, cy + Math.sin(a) * mr * 0.91, LW * 1.6, a); g.fill(); }
  // halftone vignette
  g.fillStyle = 'rgba(160,110,200,0.10)';
  const ds = ts / 2.2;
  for (let i = 0; i * ds < w; i++) for (let j = 0; j * ds < h; j++) {
    const px = x + i * ds, py = y + j * ds;
    const e = Math.max(Math.abs(px - cx) / (w / 2), Math.abs(py - cy) / (h / 2));
    const rr = ds * 0.35 * clamp((e - 0.7) / 0.3, 0, 1);
    if (rr > 0.3) { g.beginPath(); g.arc(px, py, rr, 0, TAU); g.fill(); }
  }
  g.restore();
  rrect(g, x, y, w, h, rad); g.lineWidth = LW * 1.6; g.strokeStyle = INK; g.stroke();
  rrect(g, x + LW * 1.2, y + LW * 1.2, w - LW * 2.4, h - LW * 2.4, Math.max(2, rad - LW)); g.lineWidth = LW * 0.5; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.stroke();
  g.restore();
}
function fence(g, s, pal, wMul = 1) {
  const [x1, y1, x2, y2] = s;
  g.lineCap = 'round';
  g.strokeStyle = INK; g.lineWidth = LW * 2.6 * wMul; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.strokeStyle = pal.base; g.lineWidth = LW * 1.5 * wMul; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.strokeStyle = pal.light; g.lineWidth = LW * 0.45 * wMul; g.beginPath(); g.moveTo(x1 - LW * 0.3, y1 - LW * 0.3); g.lineTo(x2 - LW * 0.3, y2 - LW * 0.3); g.stroke();
}
function post(g, x, y, pal) {
  const r = LW * 1.7;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = pal.shade; g.fill();
  g.beginPath(); g.arc(x - r * 0.2, y - r * 0.2, r * 0.75, 0, TAU); g.fillStyle = pal.base; g.fill();
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.lineWidth = LW * 0.8; g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, TAU); g.fillStyle = '#fff'; g.fill();
}
function drawPen(g, p) {
  const pal = PAL[p.color];
  g.save();
  g.beginPath(); g.rect(p.x, p.y, p.w, p.h); g.save(); g.clip();
  g.globalAlpha = 0.8; g.fillStyle = pal.light; g.fillRect(p.x, p.y, p.w, p.h);
  g.globalAlpha = 0.22; g.strokeStyle = pal.base; g.lineWidth = p.w * 0.045;
  for (let k = -p.h; k < p.w + p.h; k += p.w * 0.12) { g.beginPath(); g.moveTo(p.x + k, p.y); g.lineTo(p.x + k - p.h, p.y + p.h); g.stroke(); }
  g.globalAlpha = 1; g.fillStyle = hexA(pal.base, 0.32);
  const st = p.w / 14;
  for (let i = 0; i <= 14; i++) for (let j = 0; j <= 14; j++) {
    const x = p.x + i * st, y = p.y + j * st, d = Math.hypot(x - p.ix, y - p.iy) / (p.w * 1.1);
    const rr = st * 0.34 * (1 - d);
    if (rr > 0.4) { g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill(); }
  }
  drawSymbol(g, p.color, p.cx, p.cy, p.w * 0.2, 'rgba(255,255,255,0.5)', hexA(pal.shade, 0.25), LW);
  g.restore();
  // fences: outer edges (lighter), inner fences, foot
  fence(g, [p.ox, p.oy, p.ix, p.oy], pal, 0.7);
  fence(g, [p.ox, p.oy, p.ox, p.iy], pal, 0.7);
  for (const s of p.walls) fence(g, s, pal);
  fence(g, p.foot, pal, 0.9);
  for (const s of [...p.walls, p.foot]) { post(g, s[0], s[1], pal); post(g, s[2], s[3], pal); }
  // label badge with colorblind symbol
  const br = Math.max(12, p.w * 0.09);
  const bx = p.ox + p.sx * (br + LW * 3), by = p.oy + p.sy * (br + LW * 3);
  g.beginPath(); g.arc(bx + LW, by + LW, br, 0, TAU); g.fillStyle = INK; g.fill();
  g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fillStyle = pal.base; g.fill(); g.lineWidth = LW; g.strokeStyle = INK; g.stroke();
  drawSymbol(g, p.color, bx, by, br * 0.55, '#ffffff', INK, LW * 0.9);
  const tx = bx + p.sx * (br + LW * 2);
  outlineText(g, pal.name, tx, by, br * 0.95, '#ffffff', { align: p.sx > 0 ? 'left' : 'right', lw: LW * 1.6 });
  g.restore();
}

// ======================================================================
// Symbols (colorblind marks)
// ======================================================================
// icons for the newer powers (outlined like the color symbols, so they read at any size)
function drawPowerSymbol(g, kind, x, y, s, fill, stroke, lw) {
  g.save(); g.translate(x, y); g.lineJoin = 'round'; g.lineCap = 'round';
  const out = (w) => { if (stroke) { g.lineWidth = w + lw * 2; g.strokeStyle = stroke; g.stroke(); } g.lineWidth = w; g.strokeStyle = fill; g.stroke(); };
  const solid = () => { if (stroke) { g.lineWidth = lw * 2; g.strokeStyle = stroke; g.stroke(); } g.fillStyle = fill; g.fill(); };
  if (kind === 'defuse') { // scissors
    g.beginPath(); g.moveTo(-s * 0.3, s * 0.35); g.lineTo(s * 0.45, -s * 0.85); g.moveTo(s * 0.3, s * 0.35); g.lineTo(-s * 0.45, -s * 0.85); out(s * 0.2);
    for (const d of [-1, 1]) { g.beginPath(); g.arc(d * s * 0.38, s * 0.58, s * 0.26, 0, TAU); out(s * 0.17); }
  } else if (kind === 'magnet') { // horseshoe with white tips
    g.beginPath(); g.moveTo(-s * 0.55, -s * 0.7); g.lineTo(-s * 0.55, 0); g.arc(0, 0, s * 0.55, Math.PI, 0, true); g.lineTo(s * 0.55, -s * 0.7);
    if (stroke) { g.lineWidth = s * 0.38 + lw * 2; g.strokeStyle = stroke; g.lineCap = 'butt'; g.stroke(); }
    g.lineWidth = s * 0.38; g.strokeStyle = '#ff3b5c'; g.lineCap = 'butt'; g.stroke();
    g.beginPath(); g.moveTo(-s * 0.55, -s * 0.7); g.lineTo(-s * 0.55, -s * 0.38); g.moveTo(s * 0.55, -s * 0.7); g.lineTo(s * 0.55, -s * 0.38);
    g.strokeStyle = '#ffffff'; g.stroke();
  } else if (kind === 'paint') { // drop with a rainbow stripe
    g.beginPath(); g.moveTo(0, -s); g.bezierCurveTo(s * 0.95, -s * 0.05, s * 0.8, s * 0.9, 0, s * 0.9); g.bezierCurveTo(-s * 0.8, s * 0.9, -s * 0.95, -s * 0.05, 0, -s); g.closePath();
    solid();
    g.save(); g.clip();
    ['#ff4f64', '#ffd338', '#36d57a', '#3d8bff'].forEach((c, i) => { g.fillStyle = c; g.fillRect(-s, s * (0.05 + i * 0.2), s * 2, s * 0.2); });
    g.restore();
    g.beginPath(); g.moveTo(0, -s); g.bezierCurveTo(s * 0.95, -s * 0.05, s * 0.8, s * 0.9, 0, s * 0.9); g.bezierCurveTo(-s * 0.8, s * 0.9, -s * 0.95, -s * 0.05, 0, -s);
    if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
  } else if (kind === 'fan') { // pinwheel
    for (let i = 0; i < 4; i++) {
      g.save(); g.rotate((i * TAU) / 4);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(s * 0.15, -s * 0.95, s * 0.75, -s * 0.7); g.quadraticCurveTo(s * 0.45, -s * 0.2, 0, 0); g.closePath();
      solid(); g.restore();
    }
    g.beginPath(); g.arc(0, 0, s * 0.16, 0, TAU); g.fillStyle = stroke || INK; g.fill();
  } else if (kind === 'shield') {
    g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.8, -s * 0.66); g.lineTo(s * 0.74, s * 0.1); g.quadraticCurveTo(s * 0.5, s * 0.7, 0, s); g.quadraticCurveTo(-s * 0.5, s * 0.7, -s * 0.74, s * 0.1); g.lineTo(-s * 0.8, -s * 0.66); g.closePath();
    solid();
    g.beginPath(); g.moveTo(-s * 0.3, -s * 0.05); g.lineTo(-s * 0.05, s * 0.25); g.lineTo(s * 0.35, -s * 0.3);
    g.lineWidth = s * 0.16; g.strokeStyle = stroke || '#cf9516'; g.stroke();
  } else if (kind === 'auto') { // the four color symbols
    const q = s * 0.46;
    [['red', -1, -1], ['blue', 1, -1], ['yellow', -1, 1], ['green', 1, 1]].forEach(([c, dx, dy]) => drawSymbol(g, c, dx * q, dy * q, s * 0.4, PAL[c].base, stroke || INK, lw * 0.7));
  } else if (kind === 'double') {
    outlineText(g, 'x2', 0, s * 0.08, s * 1.45, fill, { lw: stroke ? Math.max(2, s * 0.32) : 0.01, stroke: stroke || fill });
  } else if (kind === 'swap') { // two arrows pointing opposite ways
    for (const d of [-1, 1]) {
      const y0 = d * s * 0.42;
      g.beginPath(); g.moveTo(-d * s * 0.8, y0); g.lineTo(d * s * 0.45, y0); out(s * 0.22);
      g.beginPath(); g.moveTo(d * s * 0.9, y0); g.lineTo(d * s * 0.3, y0 - s * 0.42); g.lineTo(d * s * 0.3, y0 + s * 0.42); g.closePath(); solid();
    }
  } else if (kind === 'rewind') { // double triangle pointing left
    for (const o of [0, 1]) {
      const x0 = -s * 0.85 + o * s * 0.85;
      g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + s * 0.85, -s * 0.7); g.lineTo(x0 + s * 0.85, s * 0.7); g.closePath(); solid();
    }
  } else if (kind === 'rush') { // double chevron
    for (const o of [-0.45, 0.25]) { g.beginPath(); g.moveTo(-s * 0.7, s * (o + 0.45)); g.lineTo(0, s * (o - 0.15)); g.lineTo(s * 0.7, s * (o + 0.45)); out(s * 0.26); }
  } else if (kind === 'calm') { // crescent
    g.beginPath(); g.arc(0, 0, s * 0.85, Math.PI * 0.35, Math.PI * 1.65); g.quadraticCurveTo(-s * 0.1, 0, s * 0.39, s * 0.76); g.closePath(); solid();
  } else if (kind === 'wind') { // three gusts
    for (const [yy, len] of [[-0.5, 0.75], [0, 1], [0.5, 0.6]]) { g.beginPath(); g.moveTo(-s * 0.9, s * yy); g.quadraticCurveTo(0, s * (yy - 0.3), s * (len - 0.2), s * yy); out(s * 0.2); }
  }
  g.restore();
}
const EVENT_SYMS = new Set(['rush', 'calm', 'wind']);

function drawSymbol(g, kind, x, y, s, fill, stroke, lw) {
  if (NEW_POWERS.has(kind) || EVENT_SYMS.has(kind)) { drawPowerSymbol(g, kind, x, y, s, fill, stroke, lw); return; }
  g.save(); g.translate(x, y); g.lineJoin = 'round'; g.lineCap = 'round';
  if (isSort(kind)) {
    g.beginPath();
    if (kind === 'red') {
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? s * 0.45 : s; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath();
    } else if (kind === 'blue') { const q = s * 0.75; g.rect(-q, -q, 2 * q, 2 * q); }
    else if (kind === 'yellow') { g.moveTo(0, -s); g.lineTo(s * 0.95, s * 0.7); g.lineTo(-s * 0.95, s * 0.7); g.closePath(); }
    else { g.moveTo(0, -s); g.lineTo(s * 0.78, 0); g.lineTo(0, s); g.lineTo(-s * 0.78, 0); g.closePath(); }
    if (stroke) { g.lineWidth = lw * 2; g.strokeStyle = stroke; g.stroke(); }
    g.fillStyle = fill; g.fill();
  } else {
    const path = () => {
      g.beginPath();
      if (kind === 'white') {
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3 - Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
          g.moveTo(0, 0); g.lineTo(c * s, sn * s);
          const bx = c * s * 0.55, by = sn * s * 0.55;
          for (const d of [-1, 1]) { const a2 = a + d * 0.75; g.moveTo(bx, by); g.lineTo(bx + Math.cos(a2) * s * 0.34, by + Math.sin(a2) * s * 0.34); }
        }
      } else if (kind === 'clock') {
        g.arc(0, 0, s, 0, TAU);
        g.moveTo(0, 0); g.lineTo(0, -s * 0.66);
        g.moveTo(0, 0); g.lineTo(s * 0.5, 0);
      } else if (kind === 'void') {
        g.arc(0, 0, s, -Math.PI * 0.3, Math.PI * 1.25);
      }
    };
    const w = s * 0.2;
    if (stroke) { path(); g.lineWidth = w + lw * 2; g.strokeStyle = stroke; g.stroke(); }
    path(); g.lineWidth = w; g.strokeStyle = fill; g.stroke();
    if (kind === 'void') {
      g.beginPath(); g.arc(0, 0, s * 0.4, 0, TAU);
      if (stroke) { g.lineWidth = lw * 2; g.strokeStyle = stroke; g.stroke(); }
      g.fillStyle = fill; g.fill();
    }
  }
  g.restore();
}

// ======================================================================
// Chibi bomb characters
// ======================================================================
function ellipse(g, x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); }

function drawBomb(g, b, t, decorMode) {
  const pal = PAL[b.kind], sort = isSort(b.kind);
  let r = b.r * (b.pop < 1 ? Math.max(0.01, easeOutBack(b.pop)) : 1);
  if (b.state === 'sucked') r *= 1 - 0.85 * b.suck.e;
  if (r < 0.6) return;
  const isHeld = b.state === 'held', sorted = b.state === 'sorted';
  const iced = !decorMode && b.state === 'floor' && (S.freezeT > 0 || b.iceT > 0);
  const fused = sort || b.kind === 'boss' || b.kind === 'junk'; // these blow up when the fuse runs out
  const warn = !decorMode && fused && b.state === 'floor' && b.fuse < WARN_FUSE && !iced;
  const skin = sort ? Looks.skin : 'classic';
  const heat = warn ? 1 - clamp(b.fuse / WARN_FUSE, 0, 1) : 0;
  const lw = Math.max(1.4, r * 0.1);

  g.save();
  // ground shadow
  g.fillStyle = 'rgba(40,20,70,0.22)';
  ellipse(g, b.x + r * 0.12, b.y + r * (isHeld ? 1.5 : 0.95), r * (isHeld ? 0.7 : 0.85), r * 0.28); g.fill();

  g.translate(b.x, b.y - (isHeld ? r * 0.2 : 0));
  if (warn) g.translate(Math.sin(t * 55 + b.seed) * heat * r * 0.08, Math.cos(t * 47 + b.seed) * heat * r * 0.05);
  if (iced) g.translate(Math.sin(t * 40 + b.seed) * r * 0.02, 0);
  if (b.state === 'sucked') g.rotate(b.suck.e * 12);
  let sq = iced ? 0 : Math.sin(t * 9 + b.seed) * 0.035;
  if (isHeld) sq = Math.sin(t * 16) * 0.05;
  const hs = isHeld ? 1.12 : 1;
  g.scale((1 + sq) * hs, (1 - sq) * hs);

  // rare powers flicker so they're harder to track
  if (b.erratic && b.state === 'floor' && !decorMode) g.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(t * 9 + b.seed));
  // auras
  if (b.rare || b.erratic) {
    g.save(); g.rotate(t * 0.8);
    g.fillStyle = 'rgba(255,225,90,0.55)';
    for (let i = 0; i < 10; i++) { g.rotate(TAU / 10); g.beginPath(); g.moveTo(-r * 0.12, -r * 0.9); g.lineTo(0, -r * 1.55); g.lineTo(r * 0.12, -r * 0.9); g.fill(); }
    g.restore();
  }
  if (b.sp === 'cham' && !sorted) {
    // chameleon: a spinning four-color ring, plus an arc counting down to the next color change
    g.save(); g.rotate(t * 2.2 + b.seed); g.lineWidth = Math.max(2, r * 0.16); g.lineCap = 'butt';
    SORT.forEach((c, i) => { g.beginPath(); g.arc(0, 0, r * 1.3, (i * TAU) / 4 + 0.12, ((i + 1) * TAU) / 4 - 0.12); g.strokeStyle = PAL[c].base; g.stroke(); });
    g.restore();
    g.beginPath(); g.arc(0, 0, r * 1.52, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(b.chamT / CHAM_EVERY, 0, 1));
    g.lineWidth = Math.max(1.5, r * 0.09); g.strokeStyle = '#ffffff'; g.stroke();
  }
  if (skin === 'cat') { // cat ears, tucked behind the body
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(s * r * 0.28, -r * 0.82); g.lineTo(s * r * 0.86, -r * 1.3); g.lineTo(s * r * 0.98, -r * 0.3); g.closePath();
      g.fillStyle = pal.shade; g.fill(); g.lineWidth = lw; g.lineJoin = 'round'; g.strokeStyle = INK; g.stroke();
      g.beginPath(); g.moveTo(s * r * 0.5, -r * 0.8); g.lineTo(s * r * 0.8, -r * 1.08); g.lineTo(s * r * 0.86, -r * 0.55); g.closePath();
      g.fillStyle = '#ffb3d1'; g.fill();
    }
  }
  if (!sort && b.kind !== 'junk') {
    const pu = 0.5 + 0.5 * Math.sin(t * 6 + b.seed);
    g.beginPath(); g.arc(0, 0, r * (1.35 + pu * 0.25), 0, TAU);
    g.fillStyle = hexA(pal.aura, 0.18 + pu * 0.12); g.fill();
    g.save(); g.rotate(t * 1.5); g.setLineDash([r * 0.3, r * 0.22]);
    g.beginPath(); g.arc(0, 0, r * 1.45, 0, TAU); g.lineWidth = Math.max(1.2, r * 0.1); g.strokeStyle = pal.aura; g.stroke();
    g.restore();
  }
  if (heat > 0) {
    g.beginPath(); g.arc(0, 0, r * (1.15 + 0.12 * Math.sin(t * 25)), 0, TAU);
    g.fillStyle = `rgba(255,70,30,${0.15 + heat * 0.3})`; g.fill();
  }

  // fuse
  const f = 0.2 + 0.8 * clamp(b.fuse / b.fuseMax, 0, 1);
  g.lineCap = 'round';
  g.fillStyle = '#5b4c70';
  rrect(g, -r * 0.24, -r * 1.22, r * 0.48, r * 0.3, r * 0.08); g.fill(); g.lineWidth = lw * 0.8; g.strokeStyle = INK; g.stroke();
  const fx0 = 0, fy0 = -r * 1.22, fx1 = r * 0.42 * f, fy1 = -r * 1.2 - r * 0.62 * f;
  g.beginPath(); g.moveTo(fx0, fy0); g.quadraticCurveTo(-r * 0.15 * f, fy0 - r * 0.45 * f, fx1, fy1);
  g.lineWidth = lw * 1.9; g.strokeStyle = INK; g.stroke();
  g.lineWidth = lw * 0.9; g.strokeStyle = '#d9b98a'; g.stroke();
  if (sorted) {
    // snuffed fuse: a little curl of smoke, never explodes
    g.globalAlpha = 0.55; g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(fx1 + Math.sin(t * 2 + b.seed) * r * 0.08, fy1 - r * 0.22, r * 0.1, 0, TAU); g.fill();
    g.globalAlpha = 1;
  } else if (!iced) {
    const fl = 0.8 + 0.4 * Math.sin(t * 40 + b.seed);
    const ss = r * (0.26 + heat * 0.2) * fl;
    g.beginPath(); g.arc(fx1, fy1, ss * 1.2, 0, TAU); g.fillStyle = heat > 0 ? 'rgba(255,90,30,0.5)' : 'rgba(255,190,60,0.45)'; g.fill();
    star4(g, fx1, fy1, ss * 1.3, t * 8); g.fillStyle = '#ffe14d'; g.fill();
    star4(g, fx1, fy1, ss * 0.7, -t * 6); g.fillStyle = '#ffffff'; g.fill();
  }

  // body (cel shaded)
  g.beginPath(); g.arc(0, 0, r, 0, TAU);
  if (b.kind === 'void') {
    const vg = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    vg.addColorStop(0, '#7b4fc0'); vg.addColorStop(1, pal.shade); g.fillStyle = vg;
  } else g.fillStyle = pal.shade;
  g.fill();
  g.save(); g.clip();
  if (b.kind !== 'void') { g.beginPath(); g.arc(-r * 0.16, -r * 0.18, r * 0.95, 0, TAU); g.fillStyle = pal.base; g.fill(); }
  g.globalAlpha = 0.75; g.strokeStyle = pal.light; g.lineWidth = r * 0.1;
  g.beginPath(); g.arc(0, 0, r * 0.88, Math.PI * 0.1, Math.PI * 0.45); g.stroke();
  if (heat > 0) { g.globalAlpha = heat * 0.3 * (0.6 + 0.4 * Math.sin(t * 22)); g.fillStyle = '#ff2a00'; g.fillRect(-r, -r, r * 2, r * 2); }
  g.restore();
  // gloss
  g.fillStyle = 'rgba(255,255,255,0.92)';
  ellipse(g, -r * 0.5, -r * 0.48, r * 0.22, r * 0.11, -0.75); g.fill();
  g.beginPath(); g.arc(-r * 0.7, -r * 0.18, r * 0.06, 0, TAU); g.fill();
  g.beginPath(); g.arc(0, 0, r, 0, TAU); g.lineWidth = lw; g.strokeStyle = INK; g.stroke();

  if (sort) {
    drawFace(g, r, b, t, { isHeld, sorted, warn, iced, heat, magnet: b.magnet && b.state === 'floor' });
    if (skin === 'shades') drawShades(g, r);
    else if (skin === 'crown' && !b.rare) drawCrown(g, r, t);
    if (b.sp) drawSpecialMark(g, r, b, t, lw);
  } else if (b.kind === 'boss') drawBossFace(g, r, b, t, heat);
  else if (b.kind === 'junk') drawJunkFace(g, r, b, t);
  else drawPowerFace(g, r, b, t);

  if (b.rare) drawCrown(g, r, t);

  if (iced) {
    g.save();
    rrect(g, -r * 1.22, -r * 1.25, r * 2.44, r * 2.44, r * 0.35);
    g.fillStyle = 'rgba(200,240,255,0.5)'; g.fill();
    g.lineWidth = Math.max(1.2, r * 0.08); g.strokeStyle = '#ffffff'; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1, r * 0.07);
    g.beginPath(); g.moveTo(-r * 0.9, -r * 0.5); g.lineTo(-r * 0.5, -r * 0.95); g.moveTo(-r * 0.9, -r * 0.1); g.lineTo(-r * 0.1, -r * 0.95); g.stroke();
    if (b.iceT > 0 && S.freezeT <= 0) {
      g.beginPath(); g.arc(0, 0, r * 1.45, -Math.PI / 2, -Math.PI / 2 + TAU * (b.iceT / ICE_BURST_DUR));
      g.lineWidth = Math.max(1.5, r * 0.1); g.strokeStyle = '#2c86cc'; g.stroke();
    }
    g.restore();
  }
  g.restore();
}

function drawFace(g, r, b, t, st) {
  const pal = PAL[b.kind], lw = Math.max(1.2, r * 0.075);
  const ey = r * 0.1, ex = r * 0.36;
  g.lineCap = 'round'; g.lineJoin = 'round';
  // blush
  const blushA = b.kind === 'green' ? 0.75 : 0.5;
  g.fillStyle = `rgba(255,110,150,${blushA})`;
  ellipse(g, -r * 0.6, r * 0.42, r * 0.17, r * 0.09); g.fill();
  ellipse(g, r * 0.6, r * 0.42, r * 0.17, r * 0.09); g.fill();
  if (b.kind === 'green' || st.sorted) {
    g.strokeStyle = 'rgba(220,60,110,0.7)'; g.lineWidth = Math.max(1, r * 0.035);
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      const bx = sx * r * 0.6 + (i - 1) * r * 0.08;
      g.beginPath(); g.moveTo(bx + r * 0.03, r * 0.37); g.lineTo(bx - r * 0.03, r * 0.47); g.stroke();
    }
  }
  // symbol on the forehead
  drawSymbol(g, b.kind, r * 0.1, -r * 0.55, r * 0.21, '#ffffff', INK, Math.max(1, r * 0.05));

  const blinking = b.blink < 0 && !st.warn && !st.isHeld;
  g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = lw;
  if (st.sorted) {
    for (const s of [-1, 1]) { g.beginPath(); g.arc(s * ex, ey + r * 0.08, r * 0.14, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
  } else if (st.iced) {
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(s * ex - s * r * 0.12, ey - r * 0.1); g.lineTo(s * ex + s * r * 0.06, ey); g.lineTo(s * ex - s * r * 0.12, ey + r * 0.1); g.stroke();
    }
  } else if (blinking) {
    for (const s of [-1, 1]) { g.beginPath(); g.arc(s * ex, ey - r * 0.04, r * 0.15, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); }
  } else {
    const ew = r * 0.21, eh = r * (b.kind === 'blue' && !st.warn && !st.isHeld ? 0.24 : 0.29);
    for (const s of [-1, 1]) {
      const x = s * ex;
      ellipse(g, x, ey, ew, eh); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = lw; g.strokeStyle = INK; g.stroke();
      g.save(); ellipse(g, x, ey, ew, eh); g.clip();
      const look = st.warn ? Math.sin(t * 30 + b.seed) * r * 0.04 : Math.cos(b.ang || 0) * r * 0.04;
      const ir = st.warn ? 0.6 : 1;
      ellipse(g, x + look, ey + r * 0.03, ew * 0.82 * ir, eh * 0.85 * ir); g.fillStyle = pal.iris; g.fill();
      g.beginPath(); g.rect(x - ew, ey + r * 0.06, ew * 2, eh); g.save(); g.clip();
      ellipse(g, x + look, ey + r * 0.03, ew * 0.82 * ir, eh * 0.85 * ir); g.fillStyle = pal.base; g.fill(); g.restore();
      ellipse(g, x + look, ey + r * 0.04, ew * 0.38 * ir, eh * 0.42 * ir); g.fillStyle = INK; g.fill();
      g.fillStyle = '#ffffff';
      if (st.isHeld || st.magnet) { star4(g, x + look - ew * 0.25, ey - eh * 0.3, ew * 0.55, 0); g.fill(); }
      else { g.beginPath(); g.arc(x + look - ew * 0.3, ey - eh * 0.35, ew * 0.32, 0, TAU); g.fill(); }
      g.beginPath(); g.arc(x + look + ew * 0.3, ey + eh * 0.35, ew * 0.14, 0, TAU); g.fill();
      g.restore();
      // upper lash line
      g.lineWidth = lw * 1.5; g.strokeStyle = INK;
      g.beginPath(); g.ellipse(x, ey, ew * 1.04, eh * 1.02, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.lineWidth = lw * 0.9;
      g.beginPath(); g.moveTo(x + s * ew * 0.95, ey - eh * 0.55); g.lineTo(x + s * ew * 1.3, ey - eh * 0.8); g.stroke();
    }
  }
  // brows
  g.lineWidth = lw * 1.1; g.strokeStyle = INK;
  if (st.warn) {
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * r * 0.18, ey - r * 0.42); g.lineTo(s * r * 0.5, ey - r * 0.33); g.stroke(); }
  } else if (b.kind === 'red' && !st.sorted && !st.iced) {
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * r * 0.18, ey - r * 0.3); g.lineTo(s * r * 0.52, ey - r * 0.42); g.stroke(); }
  }
  // mouth
  const my = r * 0.5;
  g.lineWidth = lw; g.strokeStyle = INK;
  if (st.sorted) {
    g.beginPath(); g.arc(0, my - r * 0.06, r * 0.15, 0, Math.PI); g.closePath(); g.fillStyle = '#7a1830'; g.fill(); g.stroke();
    ellipse(g, 0, my + r * 0.04, r * 0.07, r * 0.035); g.fillStyle = '#ff7f9f'; g.fill();
  } else if (st.iced) {
    g.beginPath();
    for (let i = 0; i <= 4; i++) g.lineTo(-r * 0.14 + i * r * 0.07, my + (i % 2 ? -r * 0.03 : r * 0.03));
    g.stroke();
  } else if (st.warn) {
    g.beginPath(); g.moveTo(-r * 0.13, my + r * 0.05);
    g.quadraticCurveTo(-r * 0.06, my - r * 0.06, 0, my + r * 0.02); g.quadraticCurveTo(r * 0.06, my - r * 0.06, r * 0.13, my + r * 0.05);
    g.lineTo(r * 0.09, my + r * 0.13); g.lineTo(-r * 0.09, my + r * 0.13); g.closePath();
    g.fillStyle = '#7a1830'; g.fill(); g.stroke();
    // sweat drop
    const sy = -r * 0.25 + ((t * 0.8 + b.seed) % 1) * r * 0.25;
    g.beginPath(); g.moveTo(r * 0.78, sy - r * 0.18);
    g.quadraticCurveTo(r * 0.9, sy, r * 0.78, sy + r * 0.05); g.quadraticCurveTo(r * 0.66, sy, r * 0.78, sy - r * 0.18);
    g.fillStyle = '#9fe0ff'; g.fill(); g.lineWidth = Math.max(1, lw * 0.7); g.stroke();
  } else if (st.isHeld || st.magnet) {
    ellipse(g, 0, my, r * 0.08, r * 0.1); g.fillStyle = '#7a1830'; g.fill(); g.stroke();
  } else if (b.kind === 'red') {
    g.beginPath(); g.arc(0, my - r * 0.08, r * 0.14, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
    g.beginPath(); g.moveTo(r * 0.04, my + r * 0.04); g.lineTo(r * 0.08, my + r * 0.11); g.lineTo(r * 0.11, my + r * 0.03); g.fillStyle = '#fff'; g.fill(); g.lineWidth = lw * 0.6; g.stroke();
  } else if (b.kind === 'blue') {
    g.beginPath(); g.arc(0, my - r * 0.05, r * 0.08, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
  } else if (b.kind === 'yellow') {
    g.beginPath(); g.arc(0, my - r * 0.07, r * 0.16, 0, Math.PI); g.closePath(); g.fillStyle = '#7a1830'; g.fill(); g.stroke();
  } else {
    g.beginPath(); g.moveTo(-r * 0.1, my);
    g.quadraticCurveTo(-r * 0.05, my + r * 0.06, 0, my); g.quadraticCurveTo(r * 0.05, my + r * 0.06, r * 0.1, my); g.stroke();
  }
}

function drawPowerFace(g, r, b, t) {
  const pal = PAL[b.kind];
  if (b.kind === 'clock') {
    g.beginPath(); g.arc(0, 0, r * 0.74, 0, TAU); g.fillStyle = '#fff6df'; g.fill();
    g.lineWidth = Math.max(1, r * 0.06); g.strokeStyle = INK; g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12;
      g.beginPath(); g.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62); g.lineTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7); g.stroke();
    }
    drawSymbol(g, 'clock', 0, 0, r * 0.52, INK, null, 0);
  } else if (b.kind === 'white') {
    drawSymbol(g, 'white', 0, 0, r * 0.66, pal.sym, '#ffffff', Math.max(1, r * 0.06));
  } else if (NEW_POWERS.has(b.kind)) {
    drawSymbol(g, b.kind, 0, -r * 0.04, r * 0.6, pal.sym, INK, Math.max(1, r * 0.06));
  } else {
    g.save(); g.rotate(-t * 3);
    g.strokeStyle = 'rgba(180,140,255,0.5)'; g.lineWidth = Math.max(1, r * 0.06);
    for (let i = 0; i < 3; i++) { g.rotate(TAU / 3); g.beginPath(); g.arc(r * 0.3, 0, r * 0.45, Math.PI * 0.6, Math.PI * 1.3); g.stroke(); }
    g.restore();
    drawSymbol(g, 'void', 0, 0, r * 0.55, pal.sym, INK, Math.max(1, r * 0.05));
  }
  // tiny anime eyes peeking under the symbol
  g.fillStyle = b.kind === 'void' ? '#ffffff' : INK;
  const by = r * 0.62;
  ellipse(g, -r * 0.24, by, r * 0.07, r * 0.1); g.fill();
  ellipse(g, r * 0.24, by, r * 0.07, r * 0.1); g.fill();
  // "TAP" bubble
  const bob = Math.sin(t * 5 + b.seed) * r * 0.15;
  const word = NEW_POWERS.has(b.kind) && RARITY[b.kind] === 2 ? 'RARE!' : 'TAP';
  if (b.state !== 'held') outlineText(g, word, 0, -r * 2.05 + bob, Math.max(10, r * 0.75), pal.aura, { lw: Math.max(2, r * 0.18), rot: 0 });
}

// ---- looks: sunglasses skin ----
function drawShades(g, r) {
  const ey = r * 0.1, ex = r * 0.36, w = r * 0.3, h = r * 0.24;
  g.save(); g.lineJoin = 'round';
  g.lineWidth = Math.max(1.5, r * 0.09); g.strokeStyle = INK;
  g.beginPath(); g.moveTo(-ex + w, ey - h * 0.4); g.lineTo(ex - w, ey - h * 0.4); g.stroke();
  g.beginPath(); g.moveTo(-ex - w, ey - h * 0.5); g.lineTo(-r * 0.92, ey - h * 0.9); g.moveTo(ex + w, ey - h * 0.5); g.lineTo(r * 0.92, ey - h * 0.9); g.stroke();
  for (const s of [-1, 1]) {
    rrect(g, s * ex - w, ey - h, w * 2, h * 2, h * 0.7); g.fillStyle = INK; g.fill();
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.beginPath(); g.moveTo(s * ex - w * 0.6, ey - h * 0.55); g.lineTo(s * ex - w * 0.1, ey - h * 0.55); g.lineTo(s * ex - w * 0.55, ey + h * 0.3); g.closePath(); g.fill();
  }
  g.restore();
}
// ---- marks that tell the special color bombs apart (shapes, not just color) ----
function drawSpecialMark(g, r, b, t, lw) {
  g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
  if (b.sp === 'gift') { // a bow on top
    g.translate(r * 0.55, -r * 0.82); g.rotate(0.35 + Math.sin(t * 3 + b.seed) * 0.06);
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(s * r * 0.5, -r * 0.5, s * r * 0.62, -r * 0.05); g.quadraticCurveTo(s * r * 0.5, r * 0.32, 0, 0); g.closePath();
      g.fillStyle = '#ff5fa2'; g.fill(); g.lineWidth = lw; g.strokeStyle = INK; g.stroke();
    }
    g.beginPath(); g.arc(0, 0, r * 0.16, 0, TAU); g.fillStyle = '#ffe14d'; g.fill(); g.lineWidth = lw; g.stroke();
    g.fillStyle = '#ffffff'; star4(g, -r * 1.5, r * 0.5, r * 0.18 * (0.6 + 0.4 * Math.sin(t * 7 + b.seed)), t); g.fill();
  } else if (b.sp === 'heavy') { // iron band with rivets, and a weight tag
    g.beginPath(); g.arc(0, 0, r * 0.93, Math.PI * 0.12, Math.PI * 0.88); g.lineWidth = r * 0.2; g.strokeStyle = '#5b5568'; g.lineCap = 'butt'; g.stroke();
    g.fillStyle = '#d9d4e4';
    for (const a of [0.2, 0.4, 0.6, 0.8]) { g.beginPath(); g.arc(Math.cos(Math.PI * a) * r * 0.93, Math.sin(Math.PI * a) * r * 0.93, r * 0.055, 0, TAU); g.fill(); }
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.lineWidth = lw * 1.9; g.strokeStyle = INK; g.stroke();
    outlineText(g, 'HEAVY', 0, r * 1.38, Math.max(8, r * 0.36), '#ffffff', { lw: Math.max(2, r * 0.12) });
  } else if (b.sp === 'twin' && b.state !== 'sorted') { // "2" badge and a seam where it will split
    g.setLineDash([r * 0.12, r * 0.12]); g.lineWidth = Math.max(1, r * 0.05); g.strokeStyle = 'rgba(29,16,51,0.55)';
    g.beginPath(); g.moveTo(0, -r * 0.98); g.lineTo(0, -r * 0.72); g.moveTo(0, r * 0.72); g.lineTo(0, r * 0.98); g.stroke(); g.setLineDash([]);
    const bx = r * 0.82, by = -r * 0.72, br = r * 0.34;
    g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fillStyle = '#ffe14d'; g.fill(); g.lineWidth = lw; g.strokeStyle = INK; g.stroke();
    outlineText(g, '2', bx, by + br * 0.08, br * 1.5, INK, { lw: 0.01, stroke: 'rgba(0,0,0,0)' });
    // the split is close: the badge shakes
    const k = clamp(b.fuse / b.fuseMax, 0, 1);
    if (k < TWIN_SPLIT_AT + 0.15) { g.globalAlpha = 0.6 + 0.4 * Math.sin(t * 20); outlineText(g, 'SPLIT!', 0, -r * 1.9, Math.max(9, r * 0.5), '#ffe14d', { lw: Math.max(2, r * 0.14) }); }
  }
  g.restore();
}
function drawBossFace(g, r, b, t, heat) {
  const lw = Math.max(1.5, r * 0.06);
  g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
  // cracks spread as it takes hits
  const dmg = b.hpMax ? 1 - b.hp / b.hpMax : 0, rn = seeded(Math.floor(b.seed * 97) + 5);
  g.strokeStyle = '#ffb347'; g.lineWidth = Math.max(1.5, r * 0.045);
  for (let i = 0; i < Math.round(dmg * 9); i++) {
    let a = rn() * TAU, d = r * (0.25 + rn() * 0.2);
    g.beginPath(); g.moveTo(Math.cos(a) * d, Math.sin(a) * d);
    for (let k = 0; k < 3; k++) { a += (rn() - 0.5) * 1.2; d += r * 0.2; g.lineTo(Math.cos(a) * Math.min(d, r * 0.95), Math.sin(a) * Math.min(d, r * 0.95)); }
    g.stroke();
  }
  // what kind of boss it is, told by shape as well as color
  if (b.btype === 'split') { // three seams where it will come apart
    g.setLineDash([r * 0.1, r * 0.09]); g.lineWidth = Math.max(1.5, r * 0.05); g.strokeStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i * TAU) / 3; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2 - r * 0.25); g.lineTo(Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97); g.stroke(); }
    g.setLineDash([]);
  } else if (b.btype === 'color' && b.want) { // a band in the color it wants, and that color's symbol on its forehead
    const pal = PAL[b.want], pu = 0.5 + 0.5 * Math.sin(t * 7);
    g.beginPath(); g.arc(0, 0, r * 0.88, 0, TAU); g.lineWidth = r * (0.16 + pu * 0.04); g.strokeStyle = pal.base; g.stroke();
    g.beginPath(); g.arc(0, -r * 0.5, r * 0.27, 0, TAU); g.fillStyle = pal.base; g.fill(); g.lineWidth = lw; g.strokeStyle = INK; g.stroke();
    drawSymbol(g, b.want, 0, -r * 0.5, r * 0.15, '#ffffff', INK, Math.max(1, r * 0.03));
  } else if (b.btype === 'thief') { // bandit mask
    g.beginPath(); g.moveTo(-r * 0.97, -r * 0.2); g.quadraticCurveTo(0, -r * 0.42, r * 0.97, -r * 0.2); g.lineTo(r * 0.93, r * 0.3); g.quadraticCurveTo(0, r * 0.2, -r * 0.93, r * 0.3); g.closePath();
    g.fillStyle = '#0d0618'; g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1, r * 0.03); g.setLineDash([r * 0.08, r * 0.08]); g.stroke(); g.setLineDash([]);
  }
  // angry eyes
  for (const s of [-1, 1]) {
    g.beginPath(); g.moveTo(s * r * 0.14, r * 0.02); g.lineTo(s * r * 0.6, -r * 0.2); g.lineTo(s * r * 0.58, r * 0.22); g.lineTo(s * r * 0.18, r * 0.22); g.closePath();
    g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = lw; g.strokeStyle = INK; g.stroke();
    g.beginPath(); g.arc(s * r * 0.38 + Math.cos(b.ang || 0) * r * 0.03, r * 0.12, r * 0.08, 0, TAU); g.fillStyle = '#ff3b5c'; g.fill();
    g.beginPath(); g.moveTo(s * r * 0.1, -r * 0.14); g.lineTo(s * r * 0.66, -r * 0.4); g.lineWidth = lw * 1.8; g.strokeStyle = '#ff3b5c'; g.stroke();
  }
  // jagged grin
  g.beginPath(); g.moveTo(-r * 0.42, r * 0.52);
  for (let i = 1; i <= 6; i++) g.lineTo(-r * 0.42 + (i * r * 0.84) / 6, r * (i % 2 ? 0.66 : 0.52));
  g.lineWidth = lw * 1.3; g.strokeStyle = '#ffffff'; g.stroke();
  // hit flash
  if (b.hitT > 0) { g.globalAlpha = clamp(b.hitT / 0.18, 0, 1) * 0.7; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fillStyle = '#ffffff'; g.fill(); g.globalAlpha = 1; }
  // hit points around the rim
  for (let i = 0; i < b.hpMax; i++) {
    const a = -Math.PI / 2 + ((i + 0.5) / b.hpMax - 0.5) * Math.PI * 1.5 + Math.PI;
    g.beginPath(); g.arc(Math.cos(a) * r * 1.22, Math.sin(a) * r * 1.22, Math.max(2.5, r * 0.085), 0, TAU);
    g.fillStyle = i < b.hp ? '#ff3b5c' : 'rgba(29,16,51,0.35)'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = INK; g.stroke();
  }
  // fuse countdown ring
  g.beginPath(); g.arc(0, 0, r * 1.06, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(b.fuse / b.fuseMax, 0, 1));
  g.lineWidth = Math.max(2, r * 0.07); g.strokeStyle = heat > 0 ? '#ff3b3b' : '#ffe14d'; g.stroke();
  // the thief's sack shows what it has taken
  if (b.btype === 'thief') {
    const sx = r * 0.86, sy = r * 0.72, sr = r * 0.36;
    g.beginPath(); g.arc(sx, sy, sr, 0, TAU); g.fillStyle = '#c8964a'; g.fill(); g.lineWidth = lw; g.strokeStyle = INK; g.stroke();
    g.beginPath(); g.moveTo(sx - sr * 0.45, sy - sr * 0.85); g.lineTo(sx, sy - sr * 1.35); g.lineTo(sx + sr * 0.45, sy - sr * 0.85); g.closePath(); g.fill(); g.stroke();
    outlineText(g, String(b.loot || 0), sx, sy + sr * 0.1, sr * 1.3, '#ffffff', { lw: Math.max(2, sr * 0.3) });
  }
  const bob = Math.sin(t * 6 + b.seed) * r * 0.08;
  const fs = Math.max(12, r * (b.btype === 'mini' ? 0.6 : 0.42));
  if (b.btype === 'color' && b.want) outlineText(g, `FEED ME ${PAL[b.want].name} x${b.hp}`, 0, -r * 1.75 + bob, fs, PAL[b.want].base, { lw: Math.max(3, r * 0.1) });
  else outlineText(g, `TAP x${b.hp}`, 0, -r * 1.75 + bob, fs, '#ffffff', { lw: Math.max(3, r * 0.1) });
  g.restore();
}
function drawJunkFace(g, r, b, t) {
  const lw = Math.max(1.2, r * 0.08);
  g.save(); g.lineCap = 'round'; g.strokeStyle = INK; g.lineWidth = lw;
  for (const s of [-1, 1]) { // X eyes
    const x = s * r * 0.36, y = r * 0.05, d = r * 0.13;
    g.beginPath(); g.moveTo(x - d, y - d); g.lineTo(x + d, y + d); g.moveTo(x + d, y - d); g.lineTo(x - d, y + d); g.stroke();
  }
  g.beginPath(); g.moveTo(-r * 0.2, r * 0.5); g.lineTo(r * 0.2, r * 0.45); g.stroke();
  // a patch and a dent, so it reads as scrap
  g.fillStyle = '#8d86a0'; g.beginPath(); g.rect(-r * 0.75, -r * 0.55, r * 0.34, r * 0.3); g.fill(); g.lineWidth = lw * 0.7; g.stroke();
  if (b.state !== 'held') outlineText(g, 'ANY PEN', 0, -r * 1.95 + Math.sin(t * 5 + b.seed) * r * 0.1, Math.max(9, r * 0.5), '#e2deea', { lw: Math.max(2, r * 0.14) });
  g.restore();
}

function drawCrown(g, r, t) {
  g.save();
  g.translate(-r * 0.62, -r * 0.82); g.rotate(-0.45 + Math.sin(t * 3) * 0.05);
  const w = r * 0.62, h = r * 0.42;
  g.beginPath();
  g.moveTo(-w / 2, h / 2); g.lineTo(-w / 2, -h * 0.2); g.lineTo(-w / 4, h * 0.1); g.lineTo(0, -h / 2);
  g.lineTo(w / 4, h * 0.1); g.lineTo(w / 2, -h * 0.2); g.lineTo(w / 2, h / 2); g.closePath();
  g.fillStyle = '#ffd338'; g.fill(); g.lineWidth = Math.max(1.2, r * 0.07); g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.arc(0, h * 0.18, r * 0.06, 0, TAU); g.fillStyle = '#ff4f64'; g.fill();
  g.restore();
  g.fillStyle = '#ffffff';
  star4(g, r * 0.9, -r * 0.6, r * 0.22 * (0.6 + 0.4 * Math.sin(t * 7)), t); g.fill();
  star4(g, -r * 0.95, r * 0.55, r * 0.16 * (0.6 + 0.4 * Math.cos(t * 6)), -t); g.fill();
}

// ======================================================================
// Render
// ======================================================================
function drawPenOverlays(g, t) {
  let hover = null;
  if (held) for (const p of BLOCKS) if (coverage(held, p) >= 0.5) hover = p;
  for (const p of BLOCKS) {
    const m = S.magnets[p.color] || 0;
    if (m > 0) {
      const pu = 0.5 + 0.5 * Math.sin(t * 10);
      g.save();
      g.fillStyle = hexA(PAL[p.color].base, 0.15 + pu * 0.15); g.fillRect(p.x, p.y, p.w, p.h);
      g.strokeStyle = '#ffffff'; g.lineWidth = LW * (1 + pu); g.setLineDash([LW * 3, LW * 2]); g.lineDashOffset = -t * 40;
      g.strokeRect(p.x + LW * 2, p.y + LW * 2, p.w - LW * 4, p.h - LW * 4);
      g.restore();
    }
    if (p === hover) {
      g.save();
      g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(p.x, p.y, p.w, p.h);
      g.strokeStyle = '#ffffff'; g.lineWidth = LW * 1.4; g.strokeRect(p.x + LW * 2, p.y + LW * 2, p.w - LW * 4, p.h - LW * 4);
      g.restore();
    }
  }
  // Pen Swap event: before the swap, each pen shows the color it is about to become
  const ev = S.event;
  if (ev && ev.kind === 'swap' && !ev.done && ev.a && ev.b) {
    const k = clamp((ev.max - ev.t) / SWAP_WARN, 0, 1), left = Math.max(0, SWAP_WARN - (ev.max - ev.t));
    drawSwapArrow(g, ev.a, ev.b, t);
    drawSwapPreview(g, ev.a, ev.b.color, k, left, t);
    drawSwapPreview(g, ev.b, ev.a.color, k, left, t);
  }
  // just after a swap (event or card): each pen flashes its new color
  if (S.penFlash) for (const p of S.penFlash.pens) drawSwapDone(g, p, S.penFlash.t / SWAP_FLASH, t);
}
// pen p will become color c: that color fills the pen from the bottom as the countdown runs,
// with its colorblind symbol, its name and the seconds left
function drawSwapPreview(g, p, c, k, left, t) {
  const pal = PAL[c], pu = 0.5 + 0.5 * Math.sin(t * 12);
  g.save();
  g.beginPath(); g.rect(p.x, p.y, p.w, p.h); g.clip();
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(p.x, p.y, p.w, p.h);
  // rising fill in the incoming color, with diagonal stripes so it never reads as the pen's own color
  const fh = p.h * (0.15 + 0.85 * k);
  g.fillStyle = hexA(pal.base, 0.55); g.fillRect(p.x, p.y + p.h - fh, p.w, fh);
  g.strokeStyle = hexA(pal.light, 0.7); g.lineWidth = p.w * 0.05;
  for (let s = -p.h; s < p.w + p.h; s += p.w * 0.16) { g.beginPath(); g.moveTo(p.x + s + ((t * 30) % (p.w * 0.16)), p.y + p.h); g.lineTo(p.x + s - fh + ((t * 30) % (p.w * 0.16)), p.y + p.h - fh); g.stroke(); }
  g.restore();
  g.save();
  g.lineWidth = LW * (2.2 + pu * 1.6); g.strokeStyle = pal.base; g.setLineDash([LW * 4, LW * 2.5]); g.lineDashOffset = -t * 50;
  g.strokeRect(p.x + LW * 2, p.y + LW * 2, p.w - LW * 4, p.h - LW * 4); g.setLineDash([]);
  // badge: the incoming color and its symbol
  const br = p.w * 0.17, bx = p.cx, by = p.cy - p.h * 0.1;
  g.beginPath(); g.arc(bx + LW, by + LW, br, 0, TAU); g.fillStyle = INK; g.fill();
  g.beginPath(); g.arc(bx, by, br * (1 + pu * 0.06), 0, TAU); g.fillStyle = pal.base; g.fill(); g.lineWidth = LW; g.strokeStyle = INK; g.stroke();
  drawSymbol(g, c, bx, by, br * 0.55, '#ffffff', INK, LW * 0.9);
  outlineText(g, 'BECOMES', p.cx, by + br + p.h * 0.08, p.w * 0.09, '#ffffff', { lw: LW * 1.4 });
  outlineText(g, pal.name, p.cx, by + br + p.h * 0.2, p.w * 0.15, pal.base, { lw: LW * 1.8 });
  // countdown chip in the corner nearest the middle of the board
  const cx = p.ix + (p.sx > 0 ? -p.w * 0.13 : p.w * 0.13), cy = p.iy + (p.sy > 0 ? -p.h * 0.13 : p.h * 0.13);
  g.beginPath(); g.arc(cx, cy, p.w * 0.085, 0, TAU); g.fillStyle = INK; g.fill();
  outlineText(g, String(Math.ceil(left)), cx, cy + 1, p.w * 0.12, '#ffe14d', { lw: LW });
  g.restore();
}
// a bold double-headed arrow between the two pens that are about to trade
function drawSwapArrow(g, a, b, t) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
  const inset = a.w * 0.46, x1 = a.cx + ux * inset, y1 = a.cy + uy * inset, x2 = b.cx - ux * inset, y2 = b.cy - uy * inset;
  const bend = d * 0.12, mx = (x1 + x2) / 2 - uy * bend, my = (y1 + y2) / 2 + ux * bend;
  g.save(); g.lineCap = 'round';
  for (const [w, c] of [[LW * 4.2, INK], [LW * 2.4, '#ffffff']]) {
    g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(mx, my, x2, y2); g.lineWidth = w; g.strokeStyle = c;
    g.setLineDash(c === INK ? [] : [LW * 4, LW * 3]); g.lineDashOffset = -t * 60; g.stroke();
  }
  g.setLineDash([]);
  const head = (x, y, fx, fy) => {
    const ang = Math.atan2(y - fy, x - fx), hs = R * 0.75;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.cos(ang - 0.5) * hs, y - Math.sin(ang - 0.5) * hs); g.lineTo(x - Math.cos(ang + 0.5) * hs, y - Math.sin(ang + 0.5) * hs); g.closePath();
    g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = LW; g.strokeStyle = INK; g.stroke();
  };
  head(x2, y2, mx, my); head(x1, y1, mx, my);
  g.restore();
}
// right after a swap: a pulsing border in the pen's new color and "NOW <COLOR>"
function drawSwapDone(g, p, k, t) {
  const pal = PAL[p.color], pu = 0.5 + 0.5 * Math.sin(t * 14);
  g.save();
  g.globalAlpha = Math.min(1, k * 2.5);
  g.fillStyle = hexA(pal.base, 0.25 + pu * 0.15); g.fillRect(p.x, p.y, p.w, p.h);
  g.lineWidth = LW * (2.5 + pu * 2); g.strokeStyle = pal.base; g.strokeRect(p.x + LW * 2, p.y + LW * 2, p.w - LW * 4, p.h - LW * 4);
  const br = p.w * 0.15, by = p.cy - p.h * 0.08;
  g.beginPath(); g.arc(p.cx, by, br, 0, TAU); g.fillStyle = pal.base; g.fill(); g.lineWidth = LW; g.strokeStyle = INK; g.stroke();
  drawSymbol(g, p.color, p.cx, by, br * 0.55, '#ffffff', INK, LW * 0.9);
  outlineText(g, 'NOW ' + pal.name, p.cx, by + br + p.h * 0.13, p.w * 0.14, pal.base, { lw: LW * 1.8 });
  g.restore();
}
function drawHoles(g, t) {
  for (const h of S.holes) {
    const open = Math.min(1, (h.max - h.t) / 0.15, h.t / 0.2);
    g.save();
    g.translate(h.x, h.y);
    // pull radius
    g.save(); g.rotate(-t * 0.6); g.setLineDash([R * 0.5, R * 0.4]);
    g.beginPath(); g.arc(0, 0, h.r * (0.9 + 0.1 * open), 0, TAU);
    g.lineWidth = LW; g.strokeStyle = `rgba(150,100,255,${0.35 * open})`; g.stroke(); g.restore();
    const vr = R * 2 * open;
    const vg = g.createRadialGradient(0, 0, 0, 0, 0, vr * 1.4);
    vg.addColorStop(0, '#05010d'); vg.addColorStop(0.55, '#2a0f55'); vg.addColorStop(1, 'rgba(120,70,220,0)');
    g.fillStyle = vg; g.beginPath(); g.arc(0, 0, vr * 1.4, 0, TAU); g.fill();
    g.rotate(t * 7);
    for (let i = 0; i < 6; i++) {
      g.rotate(TAU / 6);
      g.beginPath(); g.arc(vr * 0.45, 0, vr * 0.7, Math.PI * 0.55, Math.PI * 1.25);
      g.lineWidth = Math.max(1.5, R * 0.14); g.strokeStyle = i % 2 ? '#c9a6ff' : '#6ef0ff'; g.stroke();
    }
    g.beginPath(); g.arc(0, 0, vr * 0.45, 0, TAU); g.fillStyle = '#000'; g.fill();
    g.lineWidth = LW; g.strokeStyle = '#e8d8ff'; g.stroke();
    g.restore();
  }
}
function drawMagnetTrails(g, t) {
  for (const b of S.bombs) {
    if (!alive(b) || b.state !== 'floor' || !b.magnet) continue;
    const ux = Math.cos(b.ang), uy = Math.sin(b.ang), nx = -uy, ny = ux;
    g.save(); g.lineCap = 'round';
    for (let i = -2; i <= 2; i++) {
      const o = i * b.r * 0.4, len = b.r * (2.2 + ((i + 5 + t * 9) % 2));
      g.strokeStyle = i % 2 ? '#ffffff' : PAL[b.kind].base; g.lineWidth = Math.max(1.5, b.r * 0.14); g.globalAlpha = 0.8;
      g.beginPath(); g.moveTo(b.x - ux * b.r + nx * o, b.y - uy * b.r + ny * o); g.lineTo(b.x - ux * (b.r + len) + nx * o, b.y - uy * (b.r + len) + ny * o); g.stroke();
    }
    g.restore();
  }
}
function drawEventOverlays(g, t) {
  const ev = S.event;
  if (ev && ev.kind === 'wind') { // streaks blowing across the board
    g.save(); g.beginPath(); g.rect(A.x, A.y, A.w, A.h); g.clip();
    const ux = Math.cos(ev.dir), uy = Math.sin(ev.dir), rn = seeded(11);
    g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 16; i++) {
      const along = ((rn() + t * (0.35 + rn() * 0.4)) % 1.2) - 0.1, across = rn(), len = A.w * (0.06 + rn() * 0.1);
      const sx = ux !== 0 ? A.x + (ux > 0 ? along : 1 - along) * A.w : A.x + across * A.w;
      const sy = uy !== 0 ? A.y + (uy > 0 ? along : 1 - along) * A.h : A.y + across * A.h;
      g.lineWidth = LW * (0.5 + rn() * 0.7);
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx - ux * len, sy - uy * len); g.stroke();
    }
    g.restore();
  } else if (ev && ev.kind === 'calm') {
    g.save(); g.fillStyle = 'rgba(120,235,190,0.13)'; g.fillRect(A.x, A.y, A.w, A.h); g.restore();
  } else if (ev && ev.kind === 'rush') {
    g.save();
    g.fillStyle = `rgba(255,90,60,${0.07 + 0.05 * Math.sin(t * 9)})`; g.fillRect(A.x, A.y, A.w, A.h);
    g.globalAlpha = 0.16; speedLines(g, A.x + A.w / 2, A.y + A.h / 2, A.w * 0.42, A.w * 0.75, 28, Math.floor(t * 14), '#ff5a3c');
    g.restore();
  }
  if (S.rewindFx > 0) { // scanlines sweeping back
    g.save(); g.globalAlpha = S.rewindFx / 0.5 * 0.5; g.fillStyle = PAL.rewind.aura;
    for (let y = A.y + ((t * 300) % 12); y < A.y + A.h; y += 12) g.fillRect(A.x, y, A.w, 3);
    g.restore();
  }
  if (S.slowT > 0) { g.save(); g.fillStyle = 'rgba(255,225,80,0.14)'; g.fillRect(A.x, A.y, A.w, A.h); g.restore(); }
}
function drawFieldOverlays(g, t) {
  drawEventOverlays(g, t);
  if (S.freezeT > 0) {
    g.save();
    g.fillStyle = 'rgba(150,215,255,0.16)'; g.fillRect(A.x, A.y, A.w, A.h);
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    vg.addColorStop(0, 'rgba(220,245,255,0)'); vg.addColorStop(1, 'rgba(220,245,255,0.75)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    const rn = seeded(3);
    for (let i = 0; i < 14; i++) {
      const x = rn() * W, y = ((rn() * H + t * (20 + rn() * 30)) % (H + 40)) - 20;
      drawSymbol(g, 'white', x, y, R * (0.25 + rn() * 0.3), 'rgba(255,255,255,0.85)', null, 0);
    }
    g.restore();
  }
  if (S.clockT > 0) {
    g.save();
    g.fillStyle = 'rgba(255,190,110,0.12)'; g.fillRect(A.x, A.y, A.w, A.h);
    const cx = A.x + A.w / 2, cy = A.y + A.h / 2, cr = Math.min(A.w, A.h) * 0.2;
    g.globalAlpha = 0.18; g.strokeStyle = '#a8681b'; g.lineCap = 'round';
    g.lineWidth = LW * 2.5; g.beginPath(); g.arc(cx, cy, cr, 0, TAU); g.stroke();
    const a1 = t * 0.6, a2 = t * 0.05;
    g.lineWidth = LW * 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a1) * cr * 0.85, cy + Math.sin(a1) * cr * 0.85); g.stroke();
    g.lineWidth = LW * 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a2) * cr * 0.55, cy + Math.sin(a2) * cr * 0.55); g.stroke();
    g.restore();
  }
}
function drawBanner(g) {
  const bn = S.banner; if (!bn) return;
  const p = bn.t / bn.life;
  g.save();
  g.globalAlpha = p > 0.75 ? 1 - (p - 0.75) / 0.25 : 1;
  g.globalAlpha *= 0.55;
  speedLines(g, W / 2, H / 2, Math.min(W, H) * 0.42, Math.hypot(W, H), 60, Math.floor(bn.t * 20), '#ffffff');
  g.globalAlpha = p > 0.75 ? 1 - (p - 0.75) / 0.25 : 1;
  const k = p < 0.15 ? easeOutBack(p / 0.15) : 1;
  const x = W / 2 + (p > 0.75 ? (p - 0.75) * W * 2 : 0);
  // slash band
  g.translate(x, H / 2); g.rotate(-0.12);
  g.fillStyle = INK; g.fillRect(-W, -R * 1.3 * k, W * 2, R * 2.6 * k);
  g.fillStyle = '#ff7fc4'; g.fillRect(-W, -R * 1.05 * k, W * 2, R * 2.1 * k);
  outlineText(g, bn.text, 0, R * 0.1, R * 2.4 * k, '#ffffff', { lw: R * 0.45 });
  outlineText(g, bn.sub ? bn.sub.toUpperCase() : `LV ${S.tier + 1}`, R * 4.2, -R * 1.4, R * 0.9 * k, '#ffe14d', { lw: R * 0.25, rot: 0.1 });
  g.restore();
}
function drawImpact(g) {
  if (mode !== 'booming' || !S.boom) return;
  const t = S.boom.t;
  if (t < 0.06) { g.fillStyle = 'rgba(255,248,230,0.85)'; g.fillRect(0, 0, W, H); }
  else if (t < 0.17) {
    g.fillStyle = 'rgba(29,16,51,0.88)'; g.fillRect(0, 0, W, H);
    speedLines(g, S.boom.x, S.boom.y, R * 1.5, Math.hypot(W, H), 40, 11, '#ffffff');
    g.beginPath(); g.arc(S.boom.x, S.boom.y, R * 2.2, 0, TAU); g.fillStyle = '#ffffff'; g.fill();
  }
}
function hudChip(g, x, y, kind, secs, label) {
  const h = HUD * 0.5, w = h * 2.3;
  g.save();
  rrect(g, x, y, w, h, h / 2); g.fillStyle = INK; g.fill();
  rrect(g, x + 2, y + 2, w - 4, h - 4, h / 2 - 2);
  g.fillStyle = isSort(kind) ? PAL[kind].base : PAL[kind].aura; g.fill();
  drawSymbol(g, kind, x + h / 2, y + h / 2, h * 0.28, '#ffffff', INK, 1.2);
  outlineText(g, label ?? Math.ceil(secs) + 's', x + h * 0.95, y + h / 2 + 1, h * 0.62, '#ffffff', { align: 'left', lw: 3 });
  g.restore();
  return w;
}
function drawHUD(g, t) {
  const cy = HUD / 2;
  const x0 = MARGIN + 4;
  g.save();
  g.font = `800 ${Math.round(HUD * 0.2)}px ${FONT_UI}`; g.textBaseline = 'middle'; g.textAlign = 'left';
  outlineText(g, 'SCORE', x0, HUD * 0.24, HUD * 0.22, '#ffffff', { align: 'left', lw: 3 });
  outlineText(g, String(S.score), x0, HUD * 0.63, HUD * 0.56, '#ffe14d', { align: 'left', lw: HUD * 0.1 });
  g.font = `${HUD * 0.56}px ${FONT_FX}`;
  const sw = Math.max(g.measureText(String(S.score)).width, HUD * 0.9);
  const x1 = x0 + sw + HUD * 0.35;
  outlineText(g, `BEST ${Math.max(best, S.score)}`, x1, HUD * 0.3, HUD * 0.3, '#ffffff', { align: 'left', lw: 3 });
  const tag = game === 'daily' ? 'DAILY · ' : game === 'race' ? 'RACE · ' : '';
  outlineText(g, `${tag}LV ${S.tier + 1}`, x1, HUD * 0.68, HUD * 0.3, '#ff9fd6', { align: 'left', lw: 3 });
  // clear progress pips
  const toClear = S.score % CLEAR_EVERY;
  g.font = `${HUD * 0.3}px ${FONT_FX}`;
  const px = x1 + Math.max(g.measureText(`BEST ${Math.max(best, S.score)}`).width, HUD) + HUD * 0.3;
  const btns = hudButtons();
  const avail = btns[1].x - px - 8;
  // active effects chips
  const chips = [];
  if (S.event) chips.push([S.event.kind, S.event.t, S.event.kind === 'swap' ? 'SWAP' : undefined]);
  if (S.freezeT > 0) chips.push(['white', S.freezeT]);
  if (S.clockT > 0) chips.push(['clock', S.clockT]);
  if (S.doubleT > 0) chips.push(['double', S.doubleT]);
  if (S.shieldOn) chips.push(['shield', 0, 'ON']);
  if (S.paint) chips.push([S.paint.c, 0, 'x' + S.paint.n]);
  for (const c of SORT) if (S.magnets[c] > 0) chips.push([c, S.magnets[c]]);
  const chipW = HUD * 0.5 * 2.3 + 6;
  const barW = Math.min(HUD * 2.2, Math.max(0, avail));
  if (barW > HUD) {
    const by = cy - HUD * 0.09;
    rrect(g, px, by, barW, HUD * 0.18, HUD * 0.09); g.fillStyle = INK; g.fill();
    if (toClear > 0) { rrect(g, px + 2, by + 2, Math.max(HUD * 0.14, (barW - 4) * (toClear / CLEAR_EVERY)), HUD * 0.18 - 4, HUD * 0.07); g.fillStyle = '#ff7fc4'; g.fill(); }
    outlineText(g, 'CLEAR', px + barW / 2, by - HUD * 0.14, HUD * 0.2, '#ffffff', { lw: 2.5 });
  }
  let cxp = px + (barW > HUD ? barW + HUD * 0.25 : 0);
  const inHud = chips.length * chipW <= btns[1].x - cxp - 6;
  if (inHud) {
    for (const [k, s, l] of chips) { hudChip(g, cxp, cy - HUD * 0.25, k, s, l); cxp += chipW; }
  } else if (chips.length) {
    const p = PENS[0];
    let x = A.x + A.w / 2 - (chips.length * chipW) / 2, y = p.y + p.h + LW * 3;
    for (const [k, s, l] of chips) { hudChip(g, x, y, k, s, l); x += chipW; }
  }
  // buttons
  for (const b of btns) {
    rrect(g, b.x + 2, b.y + 3, b.s, b.s, b.s * 0.3); g.fillStyle = INK; g.fill();
    rrect(g, b.x, b.y, b.s, b.s, b.s * 0.3); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = INK; g.stroke();
    const cx = b.x + b.s / 2, cyb = b.y + b.s / 2, s = b.s * 0.22;
    g.fillStyle = INK; g.strokeStyle = INK; g.lineWidth = Math.max(2, b.s * 0.08); g.lineCap = 'round';
    if (b.id === 'pause') {
      g.fillRect(cx - s * 0.9, cyb - s, s * 0.6, s * 2); g.fillRect(cx + s * 0.3, cyb - s, s * 0.6, s * 2);
    } else {
      g.beginPath(); g.moveTo(cx - s * 1.3, cyb - s * 0.45); g.lineTo(cx - s * 0.6, cyb - s * 0.45); g.lineTo(cx + s * 0.1, cyb - s * 1.1);
      g.lineTo(cx + s * 0.1, cyb + s * 1.1); g.lineTo(cx - s * 0.6, cyb + s * 0.45); g.lineTo(cx - s * 1.3, cyb + s * 0.45); g.closePath(); g.fill();
      if (Sound.muted) {
        g.beginPath(); g.moveTo(cx + s * 0.5, cyb - s * 0.5); g.lineTo(cx + s * 1.3, cyb + s * 0.5); g.moveTo(cx + s * 1.3, cyb - s * 0.5); g.lineTo(cx + s * 0.5, cyb + s * 0.5); g.stroke();
      } else {
        g.beginPath(); g.arc(cx + s * 0.2, cyb, s * 0.6, -0.9, 0.9); g.stroke();
        g.beginPath(); g.arc(cx + s * 0.2, cyb, s * 1.1, -0.9, 0.9); g.stroke();
      }
    }
  }
  g.restore();
}
function drawTutorial(g, t) {
  const b = S.tutorialBomb;
  if (!S.tutorial || !b || b.dead || (b.state !== 'floor' && b.state !== 'held')) return;
  const p = penOf(b.kind);
  g.save();
  // pulse the target pen
  const pu = 0.5 + 0.5 * Math.sin(t * 6);
  g.strokeStyle = '#ffffff'; g.lineWidth = LW * (1.5 + pu); g.setLineDash([LW * 3, LW * 2]); g.lineDashOffset = -t * 30;
  g.strokeRect(p.x + LW * 2, p.y + LW * 2, p.w - LW * 4, p.h - LW * 4);
  // dashed arrow from the bomb to its pen
  const sx = b.x, sy = b.y, ex = p.cx, ey = p.cy;
  const mx = (sx + ex) / 2 + (ey - sy) * 0.2, my = (sy + ey) / 2 - (ex - sx) * 0.2;
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(mx, my, ex, ey);
  g.lineWidth = LW * 3.2; g.strokeStyle = INK; g.setLineDash([LW * 4, LW * 3]); g.lineDashOffset = -t * 40; g.stroke();
  g.lineWidth = LW * 1.8; g.strokeStyle = '#ffe14d'; g.stroke();
  g.setLineDash([]);
  const a = Math.atan2(ey - my, ex - mx), hs = R * 0.8;
  g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - Math.cos(a - 0.5) * hs, ey - Math.sin(a - 0.5) * hs); g.lineTo(ex - Math.cos(a + 0.5) * hs, ey - Math.sin(a + 0.5) * hs); g.closePath();
  g.fillStyle = '#ffe14d'; g.fill(); g.lineWidth = LW; g.strokeStyle = INK; g.stroke();
  if (b.state === 'floor') outlineText(g, 'DRAG ME!', b.x, b.y - b.r * 2.6 + Math.sin(t * 5) * 3, clamp(R * 0.9, 14, 26), '#ffffff', { lw: 5 });
  outlineText(g, `Drop it in the ${KIND_NAME[b.kind].toUpperCase()} pen`, A.x + A.w / 2, A.y + A.h / 2 + R * 3, clamp(R * 0.75, 13, 22), '#ffe14d', { lw: 5 });
  g.restore();
}
function drawDanger(g, t) {
  if (mode !== 'play' || S.freezeT > 0) return;
  let worst = 0;
  for (const b of S.bombs) {
    if (!alive(b) || b.state !== 'floor' || isPower(b.kind) || b.iceT > 0 || b === S.tutorialBomb) continue;
    if (b.fuse >= DANGER_FUSE) continue;
    const k = 1 - b.fuse / DANGER_FUSE;
    worst = Math.max(worst, k);
    const ph = (t * 3) % 1;
    g.save();
    g.beginPath(); g.arc(b.x, b.y, b.r * (1.3 + ph * 1.4), 0, TAU);
    g.lineWidth = Math.max(2, b.r * 0.2 * (1 - ph)); g.strokeStyle = `rgba(255,40,40,${0.9 * (1 - ph)})`; g.stroke();
    outlineText(g, '!', b.x + b.r * 1.05, b.y - b.r * 1.05, b.r * 1.1, '#ff3b3b', { lw: Math.max(3, b.r * 0.25) });
    g.restore();
  }
  if (worst > 0) {
    const a = (0.18 + 0.3 * worst) * (0.6 + 0.4 * Math.sin(t * 18));
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.55);
    vg.addColorStop(0, 'rgba(255,30,30,0)'); vg.addColorStop(1, `rgba(255,30,30,${a})`);
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }
}
function drawCombo(g) {
  const c = S.comboPop; if (!c) return;
  const p = c.t / 0.9, k = p < 0.2 ? easeOutBack(p / 0.2) : 1;
  g.save();
  g.globalAlpha = p > 0.6 ? 1 - (p - 0.6) / 0.4 : 1;
  const size = clamp(R * (1.2 + Math.min(c.n, 10) * 0.08), 18, 56) * k;
  outlineText(g, `COMBO x${c.n}`, A.x + A.w / 2, A.y + A.h / 2 - R * 2.2 - p * R, size, c.n >= 5 ? '#ffe14d' : '#ff7fc4', { lw: size * 0.22, rot: -0.06 });
  g.restore();
}
function drawTip(g) {
  const tp = S.tip; if (!tp) return;
  const p = tp.t / tp.life;
  g.save();
  g.globalAlpha = p < 0.08 ? p / 0.08 : p > 0.85 ? 1 - (p - 0.85) / 0.15 : 1;
  let fs = clamp(R * 0.62, 12, 18);
  g.font = `800 ${fs}px ${FONT_UI}`;
  const iconW = tp.kind ? fs * 2 : 0, maxW = A.w - 24;
  let tw = g.measureText(tp.text).width;
  if (tw + iconW + 28 > maxW) { fs *= (maxW - iconW - 28) / tw; g.font = `800 ${fs}px ${FONT_UI}`; tw = g.measureText(tp.text).width; }
  const w = tw + iconW + 28, h = fs * 2.3;
  const x = A.x + (A.w - w) / 2, y = A.y + A.h * 0.5 + R * 4.2;
  rrect(g, x + 3, y + 4, w, h, h / 2); g.fillStyle = INK; g.fill();
  rrect(g, x, y, w, h, h / 2); g.fillStyle = '#fffaf2'; g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
  if (tp.kind) drawSymbol(g, tp.kind, x + 14 + fs * 0.7, y + h / 2, fs * 0.6, PAL[tp.kind].sym, tp.kind === 'clock' ? null : INK, 1.5);
  g.fillStyle = INK; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(tp.text, x + 14 + iconW, y + h / 2 + 1);
  g.restore();
}
function drawHint(g, t) {
  if (!S || mode !== 'play' || S.tutorial || S.hint <= 0 || S.score > 0) return;
  g.save();
  g.globalAlpha = Math.min(1, S.hint);
  outlineText(g, 'Drag bombs to the matching pen!', A.x + A.w / 2, A.y + A.h / 2 + Math.sin(t * 3) * 4, clamp(R * 0.95, 14, 28), '#ffffff', { lw: 5 });
  g.restore();
}

// ---------- power-card tray ----------
function drawPowerIcon(g, kind, x, y, r) {
  const pal = PAL[kind];
  g.save();
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = pal.shade; g.fill();
  g.save(); g.clip();
  g.beginPath(); g.arc(x - r * 0.16, y - r * 0.18, r * 0.95, 0, TAU); g.fillStyle = kind === 'void' ? '#5a2f93' : pal.base; g.fill();
  g.restore();
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.lineWidth = Math.max(1.5, r * 0.1); g.strokeStyle = INK; g.stroke();
  const lw = Math.max(1, r * 0.06);
  if (kind === 'clock') drawSymbol(g, 'clock', x, y, r * 0.58, INK, null, 0);
  else if (kind === 'white') drawSymbol(g, 'white', x, y, r * 0.68, pal.sym, '#ffffff', lw);
  else if (kind === 'void') drawSymbol(g, 'void', x, y, r * 0.58, pal.sym, INK, lw);
  else drawSymbol(g, kind, x, y, r * 0.62, pal.sym, INK, lw);
  g.restore();
}
const ACTIVE_T = { defuse: () => S.defuseLeft / DEFUSE_COUNT, white: () => S.freezeT / FREEZE_DUR, clock: () => S.clockT / CLOCK_DUR, double: () => S.doubleT / DOUBLE_DUR, shield: () => (S.shieldOn ? 1 : 0) };
function drawTray(g, t) {
  if (!TRAY || !S) return;
  const T = TRAY, rad = T.cw * 0.16;
  for (const s of T.slots) {
    const n = s.kind ? S.cards[s.kind] || 0 : 0;
    const sel = s.kind && S.target === s.kind;
    const lift = sel ? -T.ch * 0.08 : 0;
    const x = s.x, y = s.y + lift, w = s.w, h = s.h;
    g.save();
    if (!s.kind) {
      // the free 12th slot
      g.setLineDash([4, 4]); rrect(g, x + 1, y + 1, w - 2, h - 2, rad);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(29,16,51,0.45)'; g.stroke();
      g.setLineDash([]);
      outlineText(g, '?', x + w / 2, y + h * 0.45, h * 0.42, 'rgba(255,255,255,0.85)', { lw: 3 });
      if (w > 40) outlineText(g, 'SOON', x + w / 2, y + h * 0.82, Math.max(9, h * 0.15), 'rgba(255,255,255,0.85)', { lw: 2.5 });
      g.restore(); continue;
    }
    const st = RARITY_STYLE[RARITY[s.kind]];
    // card body
    rrect(g, x + 2, y + 3, w, h, rad); g.fillStyle = INK; g.globalAlpha = n ? 1 : 0.35; g.fill();
    rrect(g, x, y, w, h, rad); g.fillStyle = st.face; g.fill();
    g.lineWidth = RARITY[s.kind] ? 3 : 2.5; g.strokeStyle = st.edge; g.stroke();
    if (RARITY[s.kind] === 2 && n) { // rare shimmer
      g.save(); rrect(g, x, y, w, h, rad); g.clip();
      const sx = x - w + ((t * 0.6) % 1.6) * w * 2;
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.moveTo(sx, y); g.lineTo(sx + w * 0.25, y); g.lineTo(sx - w * 0.15, y + h); g.lineTo(sx - w * 0.4, y + h); g.fill();
      g.restore();
    }
    // active effect: fill bar from the bottom
    const act = ACTIVE_T[s.kind] ? clamp(ACTIVE_T[s.kind](), 0, 1) : 0;
    if (act > 0) {
      g.save(); rrect(g, x, y, w, h, rad); g.clip();
      g.fillStyle = hexA(PAL[s.kind].aura, 0.35); g.fillRect(x, y + h * (1 - act), w, h * act);
      g.restore();
    }
    g.globalAlpha = n ? 1 : 0.32;
    const showName = w >= 44;
    drawPowerIcon(g, s.kind, x + w / 2, y + h * (showName ? 0.42 : 0.5), w * 0.3);
    if (showName) {
      g.font = `800 ${Math.max(8, Math.min(12, w * 0.17))}px ${FONT_UI}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = INK; g.fillText(CARD_NAME[s.kind].toUpperCase(), x + w / 2, y + h * 0.84, w - 4);
    }
    g.globalAlpha = 1;
    // stack count
    if (n >= 1) {
      const br = Math.max(8, w * 0.17), bx = x + w - br * 0.55, by = y + br * 0.45;
      g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fillStyle = n > 1 ? '#ff4f8b' : '#ffffff'; g.fill();
      g.lineWidth = 2; g.strokeStyle = INK; g.stroke();
      outlineText(g, n > 1 ? 'x' + n : '1', bx, by + 1, br * (n > 1 ? 1.05 : 1.2), n > 1 ? '#ffffff' : INK, { lw: n > 1 ? 2.5 : 0.01, stroke: n > 1 ? INK : '#ffffff' });
    }
    // keyboard hint on desktop
    if (!IS_TOUCH && w >= 44) outlineText(g, '1234567890-='[s.i], x + w * 0.16, y + h * 0.13, Math.max(9, w * 0.15), 'rgba(29,16,51,0.45)', { lw: 0.01, stroke: 'rgba(0,0,0,0)' });
    if (sel) {
      const pu = 0.5 + 0.5 * Math.sin(t * 10);
      rrect(g, x - 3, y - 3, w + 6, h + 6, rad + 3); g.lineWidth = 3 + pu * 2; g.strokeStyle = '#ffffff'; g.stroke();
    }
    g.restore();
  }
  // "can't do that" bubble
  if (S.nope && S.nope.slot) {
    const s = T.slots[S.nope.slot.i] || S.nope.slot, p = S.nope.t / 0.9; // look up by index: a resize rebuilds the tray
    g.save(); g.globalAlpha = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
    outlineText(g, S.nope.text, s.x + s.w / 2, s.y - 10 - p * 10, clamp(R * 0.6, 12, 18), '#ffffff', { lw: 4 });
    g.restore();
  }
  // collected powers flying into their slot
  for (const f of S.flies) {
    const k = easeOut(Math.min(1, f.t / 0.55)), s = T.slots[f.slot.i] || f.slot;
    const tx = s.x + s.w / 2, ty = s.y + s.h * 0.42;
    const x = f.x0 + (tx - f.x0) * k, y = f.y0 + (ty - f.y0) * k - Math.sin(k * Math.PI) * R * 2;
    drawPowerIcon(g, f.kind, x, y, R * (0.75 - 0.25 * k));
  }
}
const TARGET_TEXT = {
  swap: () => (S.swapPick ? 'Now tap the pen to trade with' : 'Tap two pens to swap their places'),
  void: 'Tap where to open the Black Hole',
  defuse: () => (S.defuseLeft > 0 ? `Defuse: ${S.defuseLeft} left, tap bombs one by one` : `Tap bombs to defuse them (${DEFUSE_COUNT} per card)`),
  magnet: 'Tap a bomb or pen: that color gets pulled home',
  paint: 'Tap a bomb: the next 5 bombs come in its color',
};
function drawTargeting(g, t) {
  if (!S.target || mode !== 'play') return;
  g.save();
  g.fillStyle = 'rgba(29,16,51,0.12)'; g.fillRect(A.x, A.y, A.w, A.h);
  if (S.target === 'swap') {
    const pu = 0.5 + 0.5 * Math.sin(t * 8);
    for (const p of PENS) {
      const on = p === S.swapPick;
      g.setLineDash(on ? [] : [LW * 3, LW * 2]); g.lineDashOffset = -t * 30;
      g.lineWidth = LW * (on ? 2.6 : 1.4 + pu); g.strokeStyle = on ? PAL.swap.aura : '#ffffff';
      g.strokeRect(p.x + LW * 2, p.y + LW * 2, p.w - LW * 4, p.h - LW * 4);
      if (on) { g.fillStyle = hexA(PAL.swap.aura, 0.25); g.fillRect(p.x, p.y, p.w, p.h); }
    }
    g.setLineDash([]);
  } else if (S.target !== 'void') {
    const pu = 0.5 + 0.5 * Math.sin(t * 8);
    for (const b of S.bombs) {
      if (!alive(b) || b.state !== 'floor' || !isSort(b.kind)) continue;
      g.beginPath(); g.arc(b.x, b.y, b.r * (1.35 + pu * 0.15), 0, TAU);
      g.setLineDash([b.r * 0.35, b.r * 0.25]); g.lineDashOffset = -t * 30;
      g.lineWidth = Math.max(2, b.r * 0.12); g.strokeStyle = '#ffffff'; g.stroke();
    }
    g.setLineDash([]);
  }
  const fs = clamp(R * 0.7, 13, 22);
  const tt = TARGET_TEXT[S.target];
  outlineText(g, typeof tt === 'function' ? tt() : tt, A.x + A.w / 2, A.y + fs * 1.1, fs, '#ffffff', { lw: 5 });
  outlineText(g, S.defuseLeft > 0 ? 'tap the card to stop (the rest are lost)' : 'tap the card again to cancel', A.x + A.w / 2, A.y + fs * 2.2, fs * 0.65, '#ffe14d', { lw: 4 });
  g.restore();
}

// ---------- combo meter (between the board and the tray) ----------
function drawMeter(g, t) {
  if (!METER || !S) return;
  const m = METER, n = METER_MAX, gap = 2;
  const fs = Math.max(9, m.h * 1.05);
  g.save();
  g.font = `${fs}px ${FONT_FX}`;
  const labelW = g.measureText('COMBO CARD').width + 8;
  outlineText(g, 'COMBO CARD', m.x, m.y + m.h / 2 + 0.5, fs, S.meterPop > 0 ? '#ffe14d' : '#ffffff', { align: 'left', lw: 3 });
  const bw = m.w - labelW, sw = (bw - gap * (n - 1)) / n, x0 = m.x + labelW;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * (sw + gap), on = i < S.meter, last = on && i === S.meter - 1 && S.meterPop > 0;
    const grow = last ? S.meterPop * m.h * 1.6 : 0;
    rrect(g, x, m.y - grow / 2, sw, m.h + grow, Math.min(3, sw / 2)); g.fillStyle = INK; g.fill();
    if (on) { rrect(g, x + 1.5, m.y + 1.5 - grow / 2, sw - 3, m.h - 3 + grow, Math.min(2, sw / 3)); g.fillStyle = last ? '#ffe14d' : '#ff7fc4'; g.fill(); }
  }
  g.restore();
}
// ---------- missions / race rivals panel ----------
function drawPanel(g, t) {
  if (!PANEL || !S) return;
  const P = PANEL, rows = [];
  if (game === 'race') for (const r of Race.rivals()) rows.push({ rival: r });
  for (const m of S.missions) rows.push({ m });
  if (!rows.length) return;
  const titleH = 16, pad = 8;
  const rowH = clamp((P.h - titleH - pad) / rows.length, 13, 22), fs = clamp(rowH * 0.64, 9.5, 13);
  const h = titleH + rows.length * rowH + pad;
  g.save();
  rrect(g, P.x + 2, P.y + 3, P.w, h, 10); g.fillStyle = INK; g.fill();
  rrect(g, P.x, P.y, P.w, h, 10); g.fillStyle = 'rgba(255,250,242,0.93)'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = INK; g.stroke();
  g.textBaseline = 'middle';
  g.font = `800 ${Math.max(9, fs * 0.82)}px ${FONT_UI}`; g.fillStyle = 'rgba(29,16,51,0.6)'; g.textAlign = 'left';
  g.fillText(game === 'race' ? 'RACE · MISSIONS' : 'MISSIONS · each gives a card', P.x + pad, P.y + titleH / 2 + 2, P.w - pad * 2);
  let y = P.y + titleH;
  for (const row of rows) {
    const cy = y + rowH / 2;
    g.font = `800 ${fs}px ${FONT_UI}`;
    if (row.rival) {
      const r = row.rival;
      g.fillStyle = r.alive ? '#c8264a' : 'rgba(29,16,51,0.45)'; g.textAlign = 'left';
      g.fillText(`VS ${r.name}${r.alive ? '' : ' (out)'}`, P.x + pad, cy, P.w - pad * 2 - fs * 3);
      g.textAlign = 'right'; g.fillText(String(r.score), P.x + P.w - pad, cy);
    } else {
      const m = row.m, prog = `${missionProgress(m)}/${m.n}`;
      if (m.done && m.doneT > 0) { g.fillStyle = `rgba(54,213,122,${0.35 * Math.min(1, m.doneT)})`; g.fillRect(P.x + 3, y, P.w - 6, rowH); }
      // check box
      const bs = fs * 0.95, bx = P.x + pad, by = cy - bs / 2;
      rrect(g, bx, by, bs, bs, 3); g.fillStyle = m.done ? '#36d57a' : '#ffffff'; g.fill(); g.lineWidth = 1.8; g.strokeStyle = INK; g.stroke();
      if (m.done) { g.beginPath(); g.moveTo(bx + bs * 0.2, by + bs * 0.55); g.lineTo(bx + bs * 0.42, by + bs * 0.78); g.lineTo(bx + bs * 0.82, by + bs * 0.24); g.lineWidth = 2; g.strokeStyle = '#ffffff'; g.stroke(); }
      g.textAlign = 'right'; g.fillStyle = m.done ? '#169652' : 'rgba(29,16,51,0.7)';
      const pw = m.done ? 0 : g.measureText(prog).width + 6;
      if (!m.done) g.fillText(prog, P.x + P.w - pad, cy + 0.5);
      g.textAlign = 'left'; g.fillStyle = m.done ? 'rgba(29,16,51,0.5)' : INK;
      g.fillText(m.text, bx + bs + 6, cy + 0.5, P.w - pad * 2 - bs - 6 - pw);
    }
    y += rowH;
  }
  g.restore();
}

const ORDER = { sorted: 0, floor: 1, sucked: 2, held: 3 };
function render(t) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  let sx = 0, sy = 0;
  if (S && S.shake > 0) { const k = S.shake * S.shake * R * 0.7; sx = rand(-k, k); sy = rand(-k, k); }
  ctx.save(); ctx.translate(sx, sy);
  ctx.drawImage(bg, 0, 0, W, H);
  if (mode === 'menu' || !S) {
    drawPetals(ctx);
    for (const b of decor) drawBomb(ctx, b, t, true);
    drawFx(ctx);
    ctx.restore();
    return;
  }
  drawPenOverlays(ctx, t);
  drawPetals(ctx);
  drawHoles(ctx, t);
  drawMagnetTrails(ctx, t);
  const list = S.bombs.filter(alive).sort((a, b) => ORDER[a.state] - ORDER[b.state]);
  for (const b of list) drawBomb(ctx, b, t, false);
  drawFieldOverlays(ctx, t);
  drawDanger(ctx, t);
  drawTutorial(ctx, t);
  drawTargeting(ctx, t);
  drawShieldBubble(ctx, t);
  drawFx(ctx);
  ctx.restore();
  drawCombo(ctx);
  drawTip(ctx);
  drawHint(ctx, t);
  drawBanner(ctx);
  drawImpact(ctx);
  drawHUD(ctx, t);
  drawPanel(ctx, t);
  drawMeter(ctx, t);
  drawTray(ctx, t);
}
function drawShieldBubble(g, t) {
  if (!S.shieldOn) return;
  const pu = 0.5 + 0.5 * Math.sin(t * 4);
  g.save();
  rrect(g, A.x - LW * 2, A.y - LW * 2, A.w + LW * 4, A.h + LW * 4, 18);
  g.lineWidth = LW * (1.6 + pu); g.strokeStyle = hexA(PAL.shield.aura, 0.55 + pu * 0.35); g.stroke();
  g.restore();
}

// ======================================================================
// Screens / DOM
// ======================================================================
const overlays = ['#menu', '#how', '#pause', '#over', '#board', '#looks', '#race'];
function show(id) { for (const o of overlays) $(o).classList.toggle('hidden', o !== id); }
function hideAll() { for (const o of overlays) $(o).classList.add('hidden'); }
let boardReturn = '#menu', boardRange = 'all', boardMode = 'classic', lastRankName = '';

function startRun(m) {
  if (m) game = m;
  Sound.unlock();
  bankRun(); // a run abandoned with Restart still counts toward unlocks
  S = null; held = null; activePointer = null;
  penColors = SORT.slice(); // undo any pen swaps
  resize(); // the board shape depends on the mode
  newRun();
  mode = 'play';
  hideAll();
  cv.style.cursor = 'default';
  Sound.startMusic();
}
let raceMenuOpen = false;
function pauseGame() {
  if (mode !== 'play') return;
  const race = game === 'race';
  $('#pauseTitle').textContent = race ? 'Race menu' : 'Paused';
  $('#btnResume').textContent = race ? 'Keep playing' : 'Resume';
  $('#btnRestart').classList.toggle('hidden', race);
  $('#btnHome').textContent = race ? 'Forfeit the race' : 'Home';
  $('#pauseNote').textContent = race ? 'The race keeps running while this is open!' : '';
  fillMissionList($('#pauseMissions'));
  if (race) { // a live race can't be paused: this is just a menu over the running game
    if (raceMenuOpen) { raceMenuOpen = false; hideAll(); return; }
    raceMenuOpen = true; show('#pause'); return;
  }
  if (held) { held.state = 'floor'; held.speed = bombSpeed(held); keepOnFloor(held); held = null; activePointer = null; }
  mode = 'paused'; Sound.stopMusic(); show('#pause');
}
function resumeGame() {
  if (raceMenuOpen) { raceMenuOpen = false; hideAll(); return; }
  if (mode !== 'paused') return;
  mode = 'play'; hideAll(); Sound.startMusic();
}
function goHome() {
  bankRun();
  raceMenuOpen = false;
  if (game === 'race') Race.leave();
  mode = 'menu'; S = null; fx.length = 0; Sound.stopMusic();
  try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (e) { /* ignore */ }
  game = 'classic'; penColors = SORT.slice(); resize(); setTheme(startTheme());
  best = readBest('classic');
  $('#menuBest').textContent = best; show('#menu');
}

// ---------- Looks screen ----------
function renderLooks() {
  $('#looksTotal').textContent = `Bombs sorted so far: ${Looks.total}`;
  const titles = { skin: 'optsSkin', trail: 'optsTrail', arena: 'optsArena' };
  for (const group of Object.keys(titles)) {
    const box = $('#' + titles[group]); box.innerHTML = '';
    for (const o of Looks.GROUPS[group]) {
      const btn = document.createElement('button');
      const open = Looks.open(group, o.id), on = Looks[group] === o.id;
      btn.className = 'opt' + (on ? ' on' : '') + (open ? '' : ' locked');
      btn.disabled = !open;
      btn.textContent = open ? o.name : `${o.name} · sort ${o.need}`;
      if (!open) btn.title = `Sort ${o.need} bombs in total to unlock`;
      btn.addEventListener('click', () => {
        Sound.unlock(); Sound.play('ui');
        Looks.set(group, o.id);
        if (group === 'arena') setTheme(startTheme());
        renderLooks();
      });
      box.appendChild(btn);
    }
  }
  drawLooksPreview();
}
function drawLooksPreview() {
  const c = $('#looksPreview'), g = c.getContext('2d'), t = performance.now() / 1000;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
  g.setTransform(2, 0, 0, 2, 0, 0); // drawn at 2x for sharp edges
  const th = THEMES[theme];
  const fl = g.createLinearGradient(0, 0, 60, 90); fl.addColorStop(0, th.floor[0]); fl.addColorStop(1, th.floor[1]);
  rrect(g, 2, 2, 236, 86, 12); g.fillStyle = fl; g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
  SORT.forEach((k, i) => drawBomb(g, { kind: k, r: 21, x: 36 + i * 56, y: 54, state: 'floor', pop: 1, fuse: 1, fuseMax: 1, blink: 1, seed: i * 7, ang: 0, iceT: 0, mult: 1 }, t, true));
  const tr = Looks.trail; // a taste of the trail next to the last bomb
  if (tr !== 'none') for (let i = 0; i < 3; i++) {
    const x = 214 + i * 7, y = 26 + i * 16, s = 5 - i;
    if (tr === 'hearts') { heartPath(g, x, y, s); g.fillStyle = '#ff5fa2'; g.fill(); g.lineWidth = 1; g.strokeStyle = INK; g.stroke(); }
    else { star4(g, x, y, s * 1.3, i); g.fillStyle = tr === 'stars' ? ['#ffe14d', '#7de3ff', '#ff9fd6'][i] : '#ffe14d'; g.fill(); g.lineWidth = 1; g.strokeStyle = INK; g.stroke(); }
  }
}

// ---------- 1v1 race: a live room where each player's sorts lob junk bombs at the others ----------
// Everything travels as presence (who is ready, the start signal, scores, junk sent), so any signed-in
// viewer the page is shared with can race; nothing here is trusted beyond drawing it.
const Race = (() => {
  let lobby = null, rm = null, unPeers = null;
  let code = '', peers = [], round = 0, seed = 1, absorbUntil = 0;
  let me = { name: 'Player', ready: false, start: null, playing: false, score: 0, alive: true, sent: 0 };
  let seenSent = {}, rivalIds = [], cdTimer = null, note = '';
  const pres = (p) => p.presence || {};
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const cleanName = (s) => String(s || '').replace(/[^A-Za-z0-9 ._'-]/g, '').trim().slice(0, 16) || 'Player';
  const others = () => peers.filter((p) => !p.sameTab && p.kind !== 'agent');
  const inRound = (p) => num(pres(p).round) === round;
  function push() {
    if (!rm) return;
    rm.presence({ name: me.name, ready: me.ready, round, start: me.start, playing: me.playing, score: me.score, alive: me.alive, sent: me.sent }).catch(() => {});
  }
  async function getLobby() {
    if (lobby) return lobby;
    if (!window.claude || typeof window.claude.use !== 'function') return null;
    try { lobby = await window.claude.use('room'); } catch (e) { lobby = null; }
    return lobby;
  }
  async function join(rawCode, rawName) {
    const c = String(rawCode || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    if (!c) { note = 'Type a room code first, or create a room.'; render(); return; }
    note = 'Connecting…'; render();
    const L = await getLobby();
    if (!L) { note = 'Live races are not available in this view. Open the shared link while signed in to Claude, and make sure the page is shared with your rival.'; render(); return; }
    try { rm = await L.join('race-' + c); } catch (e) {
      rm = null; note = e && e.code === 'not_permitted' ? 'This view is not allowed to join race rooms.' : 'Could not reach the race room. Try again in a moment.'; render(); return;
    }
    code = c; round = 0; peers = []; note = '';
    me = { name: cleanName(rawName), ready: false, start: null, playing: false, score: 0, alive: true, sent: 0 };
    store.set(KEY_NAME, me.name);
    absorbUntil = performance.now() + 2500; // rounds already under way when we walked in are not ours to start
    unPeers = rm.onPeers((ch) => { peers = ch.peers; onPeers(); }, () => { rm = null; note = 'Lost the race room.'; render(); });
    push(); render();
    setTimeout(render, 2600);
  }
  function leave() {
    if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
    if (unPeers) { try { unPeers(); } catch (e) { /* ignore */ } unPeers = null; }
    if (rm) { try { rm.leave().catch(() => {}); } catch (e) { /* ignore */ } rm = null; }
    peers = []; code = ''; me.ready = false; me.playing = false; me.start = null;
  }
  function onPeers() {
    if (!rm) return;
    const starts = peers.map((p) => pres(p).start).filter((s) => s && typeof s === 'object' && num(s.n) > 0);
    const newest = starts.reduce((a, s) => (!a || num(s.n) > num(a.n) ? s : a), null);
    if (performance.now() < absorbUntil) { if (newest) round = Math.max(round, num(newest.n)); render(); return; }
    if (!me.playing && !cdTimer) {
      if (newest && num(newest.n) > round) { beginCountdown(num(newest.n), num(newest.seed) || 1); return; }
      // everyone is ready: the peer with the smallest label calls the start
      const all = peers.filter((p) => p.kind !== 'agent');
      const ready = all.length >= 2 && all.every((p) => pres(p).ready === true && pres(p).playing !== true);
      if (ready && me.ready) {
        const first = all.map((p) => p.peer).sort()[0], mine = all.find((p) => p.sameTab);
        if (mine && mine.peer === first) {
          const n = all.reduce((m, p) => Math.max(m, num(pres(p).round)), round) + 1;
          me.start = { n, seed: 1 + Math.floor(Math.random() * 2147483000) };
          beginCountdown(n, me.start.seed); // publishes the start along with "playing"
          return;
        }
      }
    }
    render();
  }
  function beginCountdown(n, sd) {
    if (cdTimer || me.playing) return; // one countdown per round, however many times the room reports in
    round = n; seed = sd;
    me.ready = false; me.playing = true; me.alive = true; me.score = 0; me.sent = 0;
    seenSent = {}; rivalIds = [];
    let left = 3;
    const timer = setInterval(() => {
      left--;
      if (left > 0) { note = `Starting in ${left}…`; render(); Sound.play('tick'); return; }
      clearInterval(timer); if (cdTimer === timer) cdTimer = null;
      note = ''; render();
      if (!rm || !me.playing) return; // left the room during the countdown
      rivalIds = others().filter(inRound).map((p) => p.peer);
      startRun('race');
    }, 1000);
    cdTimer = timer;
    push();
    note = `Starting in ${left}…`; render(); Sound.play('tick');
  }
  // called from the game: publish my score / junk / still-alive
  function report() {
    if (!rm || !S) return;
    me.score = S.score; me.sent = S.sent;
    me.alive = !(mode === 'booming' || (mode === 'over' && !S.won));
    push();
  }
  // called every step of a race: take in junk, and notice when every rival is out
  function tick() {
    if (!S || mode !== 'play') return;
    const here = others().filter(inRound);
    for (const p of here) {
      const sent = num(pres(p).sent), had = seenSent[p.peer] || 0;
      if (sent > had) { S.junkQueue += Math.min(sent - had, 6); seenSent[p.peer] = sent; }
    }
    if (rivalIds.length && S.time > 1.5) {
      // a rival is out once they blow up, go back to the room, or leave it
      const stillIn = rivalIds.some((id) => { const p = here.find((q) => q.peer === id); return p && pres(p).alive !== false && pres(p).playing === true; });
      if (!stillIn) winRace();
    }
  }
  function rivals() {
    return others().filter(inRound).filter((p) => rivalIds.includes(p.peer)).map((p) => ({ name: cleanName(pres(p).name), score: num(pres(p).score), alive: pres(p).alive !== false }));
  }
  function resultText() {
    const rs = rivals();
    if (!rs.length) return S && S.won ? 'Your rival left the race.' : 'No rival was in this round.';
    return rs.map((r) => `${r.name}: ${r.score}${r.alive ? ' (still going)' : ''}`).join(' · ');
  }
  function backToLobby() {
    bankRun();
    raceMenuOpen = false;
    me.playing = false; me.ready = false; me.start = null;
    mode = 'menu'; S = null; fx.length = 0; Sound.stopMusic();
    game = 'classic'; penColors = SORT.slice(); resize(); setTheme(startTheme());
    push();
    show('#race'); render();
  }
  function forfeit() { me.alive = false; push(); backToLobby(); }
  function render() {
    const inRoom = !!rm;
    $('#raceJoin').classList.toggle('hidden', inRoom);
    $('#raceRoom').classList.toggle('hidden', !inRoom);
    $('#raceNote').textContent = note;
    if (!inRoom) return;
    $('#raceCode').textContent = code.toUpperCase();
    const ul = $('#racePlayers'); ul.innerHTML = '';
    const all = peers.filter((p) => p.kind !== 'agent');
    for (const p of all) {
      const li = document.createElement('li'), v = pres(p);
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = cleanName(v.name) + (p.sameTab ? ' (you)' : '');
      const st = document.createElement('span'); st.className = 'st';
      st.textContent = v.playing === true && !p.sameTab ? `racing · ${num(v.score)}` : v.ready === true ? 'READY' : 'not ready';
      if (v.ready === true) st.classList.add('ok');
      li.append(nm, st); ul.appendChild(li);
    }
    const waiting = performance.now() < absorbUntil;
    const busy = others().some((p) => pres(p).playing === true);
    const btn = $('#btnRaceReady');
    btn.disabled = waiting || !!cdTimer || busy;
    btn.textContent = me.ready ? 'Not ready' : "I'm ready";
    btn.classList.toggle('green', !me.ready);
    $('#raceStatus').textContent = cdTimer ? '' : waiting ? 'Joining the room…' : busy ? 'A race is running. You can join the next one.' : all.length < 2 ? 'Waiting for a rival. Share the room code with them.' : 'The race starts when everyone is ready.';
  }
  function open() {
    $('#raceName').value = store.get(KEY_NAME) || '';
    note = ''; show('#race'); render();
  }
  return {
    get seed() { return seed; },
    open, join, leave, report, tick, rivals, resultText, backToLobby, forfeit, render,
    create(name) { const abc = 'abcdefghjkmnpqrstuvwxyz'; let c = ''; for (let i = 0; i < 4; i++) c += abc[Math.floor(Math.random() * abc.length)]; return join(c, name); },
    toggleReady() { if (!rm) return; me.ready = !me.ready; push(); onPeers(); },
    exitRoom() { leave(); note = ''; render(); },
  };
})();
function toggleMute() {
  Sound.unlock(); Sound.setMuted(!Sound.muted);
  $('#btnMuteMenu').textContent = Sound.muted ? 'Sound: off' : 'Sound: on';
}
async function openBoard(from, m) {
  boardReturn = from; boardMode = m || 'classic'; show('#board');
  await renderBoard();
}
let boardReq = 0;
async function renderBoard() {
  for (const b of document.querySelectorAll('#ranges .tab')) b.classList.toggle('on', b.dataset.range === boardRange);
  for (const b of document.querySelectorAll('#modes .tab')) b.classList.toggle('on', b.dataset.mode === boardMode);
  $('#ranges').classList.toggle('hidden', boardMode === 'daily');
  const ol = $('#boardList');
  ol.innerHTML = '<li class="empty">Loading scores…</li>';
  const req = ++boardReq;
  const rows = await Board.top(boardMode, boardRange);
  if (req !== boardReq) return; // a newer tab click won
  const st = Board.status;
  $('#boardNote').textContent = boardMode === 'daily'
    ? `Today's seed (${dailyKey()} UTC) · ` + (st === 'local' ? 'saved on this device' : 'everyone with this link')
    : st === 'local' ? 'Scores are saved on this device.' : st === 'readonly' ? 'Global board · you can view but not submit here.' : 'Global board · everyone with this link.';
  ol.innerHTML = '';
  if (!rows.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No scores yet. Be the first!'; ol.appendChild(li); return; }
  rows.forEach((r, i) => {
    const li = document.createElement('li');
    if (r.key === lastRankName) li.className = 'me';
    const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = i + 1;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.name;
    const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = r.score;
    li.append(rk, nm, sc); ol.appendChild(li);
  });
}
const click = (id, fn) => $(id).addEventListener('click', () => { Sound.unlock(); Sound.play('ui'); fn(); });
click('#btnClassic', () => startRun('classic'));
click('#btnDaily', () => startRun('daily'));
click('#btnBoard', () => openBoard('#menu', 'classic'));
click('#btnHow', () => show('#how'));
click('#btnHowOk', () => show('#menu'));
click('#btnMuteMenu', () => { Sound.setMuted(!Sound.muted); $('#btnMuteMenu').textContent = Sound.muted ? 'Sound: off' : 'Sound: on'; });
click('#btnResume', resumeGame);
click('#btnRestart', () => startRun());
click('#btnHome', () => (game === 'race' && S ? Race.forfeit() : goHome()));
click('#btnAgain', () => (game === 'race' ? Race.backToLobby() : startRun()));
click('#btnLooks', () => { show('#looks'); renderLooks(); });
click('#btnLooksBack', () => show('#menu'));
click('#btnRace', () => Race.open());
click('#btnRaceBack', () => { Race.leave(); show('#menu'); });
click('#btnRaceCreate', () => Race.create($('#raceName').value));
click('#btnRaceJoin', () => Race.join($('#raceCodeIn').value, $('#raceName').value));
click('#btnRaceReady', () => Race.toggleReady());
click('#btnRaceLeave', () => Race.exitRoom());
click('#btnOverBoard', () => openBoard('#over', game));
click('#btnOverHome', goHome);
click('#btnBoardBack', () => show(boardReturn));
for (const b of document.querySelectorAll('#ranges .tab')) b.addEventListener('click', () => { boardRange = b.dataset.range; renderBoard(); });
for (const b of document.querySelectorAll('#modes .tab')) b.addEventListener('click', () => { boardMode = b.dataset.mode; renderBoard(); });
$('#submitForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#submitMsg'), btn = $('#btnSubmit');
  btn.disabled = true; msg.textContent = 'Saving…'; msg.className = 'msg';
  const res = await Board.submit(game, $('#nameInput').value, S ? S.score : 0);
  btn.disabled = false;
  if (res.error) { msg.textContent = res.error; msg.className = 'msg err'; return; }
  const v = Board.validate($('#nameInput').value);
  store.set(KEY_NAME, v.name); lastRankName = v.name.toLowerCase();
  const where = res.where === 'online' ? 'on the global board' : 'on this device';
  const span = game === 'daily' ? 'today' : 'all-time';
  if (res.ok) { msg.textContent = `Saved ${where}! You're #${res.rank} ${span}.`; msg.className = 'msg ok'; btn.disabled = true; }
  else { msg.textContent = `Your best (${res.best}) stays. Rank #${res.rank} ${span}.`; msg.className = 'msg err'; }
});

// symbol legend icons
for (const c of document.querySelectorAll('canvas[data-sym]')) {
  c.width = 60; c.height = 60;
  const g = c.getContext('2d'), k = c.dataset.sym;
  if (isSort(k)) {
    g.beginPath(); g.arc(30, 30, 26, 0, TAU); g.fillStyle = PAL[k].base; g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
    drawSymbol(g, k, 30, 31, 14, '#ffffff', INK, 2.5);
  } else drawPowerIcon(g, k, 30, 30, 26);
}

// ======================================================================
// Boot
// ======================================================================
$('#menuBest').textContent = best;
$('#btnMuteMenu').textContent = Sound.muted ? 'Sound: off' : 'Sound: on';
resize();
initDecor();
Board.connect(); // light up the global board when the viewer offers shared storage
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => buildBg());
let last = performance.now(), acc = 0;
function frame(now) {
  let d = (now - last) / 1000; last = now;
  if (d > 0.25) d = 0.25;
  acc += d;
  while (acc >= STEP) { if (!window.__bombsHold) step(STEP); acc -= STEP; }
  render(now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// small debug hook for testing in a console
window.__bombs = { get state() { return S; }, get mode() { return mode; }, get pens() { return PENS; }, get tray() { return TRAY; }, tierFor, pace, waveGap, spawn: (k) => S && spawnBomb(k),
  special: (b, sp) => makeSpecial(b, sp), boss: (type) => spawnBoss(type), event: (k) => { S.eventBag = [k]; startEvent(); }, Looks, Race,
  advance(sec) { for (let i = 0; i < Math.round(sec / STEP); i++) step(STEP); render(performance.now() / 1000); } };
})();
