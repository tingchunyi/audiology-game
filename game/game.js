// 我熱愛值班 · 一般民眾版範本
//
// A night on call in a 3D ward, 17:00 to 08:00: the phone rings, some calls are small and some
// are not, and each patient is a short script of choices at the bedside (public-cases.js).
// Everything clinical a player sees is data in public-cases.js; this file only plays it.
//
// three.js is vendored under game/vendor/ so the page needs nothing from another site.
import * as THREE from './vendor/three/three.module.js';
import { RoundedBoxGeometry } from './vendor/three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from './vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from './vendor/three/addons/utils/BufferGeometryUtils.js';
import { PHONE_CALLS, AFTER_PHONE, PUBLIC_CASES, CPR } from './public-cases.js';
import { CHATTER } from './chatter.js';

// game.css hangs off this class; set it here too so a host page that owns <body> still gets it
document.body.classList.add('game-page');

const $ = id => document.getElementById(id);
const FONT_UI = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
const FONT_NUM = '"JetBrains Mono", Consolas, monospace';
// the floor, east (+x) to west and north (-z) to south: three audiology rooms | corridor | seven
// support rooms. The rooms are not one repeated width any more; each has its own x0 and x1 (see SOUTH
// and ROOMS in the floor section).
const XE = 12, XW = -12, XCW = XW;
const ZCN = -4.0, ZCS = 1.0, ZFC = 3.6, ZF = 9.0, ZB = ZCN;
const X0 = XW, X1 = XE;
const YAW = THREE.MathUtils.degToRad(35), PITCH = THREE.MathUtils.degToRad(40);

// What the game is called, and the line that says what it was made from. A game made from this
// template keeps CREDIT on its start card and its summary (see README.md, 授權).
const GAME = { title: '社畜體驗營．聽力師的一天', edition: '', site: location.host };
const CREDIT = { text: '以《我熱愛值班》範本製作', url: 'https://drcharming.net/' };

try {
  await boot();
} catch (err) {
  console.error(err);
  $('loading').textContent = '這台裝置無法顯示 3D 畫面（需要 WebGL）';
  $('loading').classList.add('err');
}

async function boot() {
  await Promise.race([
    Promise.all([
      document.fonts.load(`900 64px ${FONT_UI}`, '護理站值班室緊急出口病房便當安全梯往聽力室檢查中病患等候區茶水間辦公室討論室人工電子耳調頻室廁所樓梯電話飲水機點心耐心'),
      document.fonts.load(`700 48px ${FONT_NUM}`, '0123456789SpOHRNIBP'),
    ]),
    new Promise(r => setTimeout(r, 3000)),
  ]);

  const frame = $('frame'), canvas = $('view');
  const rng = seed => { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
  // This floor is one area, 聽力中心. A ring comes from one of four stations: the audiology rooms
  // 01 to 03, or 候診 (the waiting area, where the small calls ring). wb() turns any bed id from
  // public-cases.js (the template's '03C') into one of the audiology rooms until the cases are
  // rewritten for this floor.
  const WARD = '聽力中心';
  const AREA = ['01', '02', '03', '候診'];
  // public-cases.js names a bed as room number + letter ('01A'); the two digits pick the station.
  // 04 is the waiting area. BL() is how a station is called on screen.
  const wb = n => { const k = String(n), m = k.match(/^(\d\d)/); return AREA.includes(k) ? k : m && m[1] === '04' ? '候診' : m && AREA.includes(m[1]) ? m[1] : AREA[0]; };
  const BL = k => (/^\d+$/.test(k) ? `${k}室` : k === '候診' ? '候診區' : k);
  // there are only choices to make, nothing to type, so the clock runs twice as fast as PACE says
  const PUBLIC_PACE = 2;
  // bed counts in words: 「四床都穩住了」
  const CN = ['零', '一', '兩', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  // energy under this and the doctor cannot run; at 0 they drop and the night is over
  const TIRED = 20;
  // the two shifts, picked on the start card: 普通班 rings four to six patients, 大爛班 six to
  // eight and spends the bar twice as fast (it fills as slowly on both). A small bed bank caps both.
  const SHIFT_NAME = { normal: '普通的一天', hard: '吃到鳳梨的一天' }, SPEND = { normal: 1, hard: 2 };
  // index.html?debug: a handle for scripted playtests (window.__ward) and ] to skip half an hour
  const DEBUG = new URLSearchParams(location.search).has('debug');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a1019');
  const world = new THREE.Group();
  scene.add(world);

  // ---------- helpers ----------
  const cache = new Map();
  const M = (color, rough = 0.8, metal = 0, flat = false) => {
    const k = `${color}|${rough}|${metal}|${flat}`;
    if (!cache.has(k)) cache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: flat }));
    return cache.get(k);
  };
  const F = (color, rough = 0.75) => M(color, rough, 0, true);
  const glow = (color, intensity) => new THREE.MeshStandardMaterial({ color: '#160606', emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
  const basic = opts => new THREE.MeshBasicMaterial(opts);
  const solids = [];
  const solid = (x0, z0, x1, z1) => solids.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);

  function box(p, w, h, d, mat, x, y, z, r = 0.03) {
    const rr = Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002);
    const geo = rr > 0.004 ? new RoundedBoxGeometry(w, h, d, 1, rr) : new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); p.add(m); return m;
  }
  function cyl(p, rt, rb, h, mat, x, y, z, seg = 16) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); p.add(m); return m;
  }
  function sph(p, r, mat, x, y, z, ws = 20, hs = 14) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), mat); m.position.set(x, y, z); p.add(m); return m;
  }
  function plane(p, w, h, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); p.add(m); return m;
  }
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }

  // ---------- textures ----------
  const floorTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#dfe4e6'; g.fillRect(0, 0, w, h);
    const r = rng(4);
    for (let i = 0; i < 1300; i++) { g.globalAlpha = 0.12 + r() * 0.2; g.fillStyle = ['#cdd3d6', '#f1f4f5', '#bcc4c8'][i % 3]; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
    g.globalAlpha = 1; g.fillStyle = 'rgba(80,95,105,.16)';
    g.fillRect(0, 0, w, 2); g.fillRect(0, h / 2 - 1, w, 2); g.fillRect(0, 0, 2, h); g.fillRect(w / 2 - 1, 0, 2, h);
  }, true);
  // the corridor is one polished sheet, no tile seams
  const hallTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e4e8e3'; g.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let i = 0; i < 900; i++) { g.globalAlpha = 0.08 + r() * 0.14; g.fillStyle = ['#d2d8d2', '#f4f6f3'][i % 2]; g.fillRect(r() * w, r() * h, 2.2, 1); }
  }, true);
  // on-call room floor: beige speckled tiles
  const tileTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e6dcc8'; g.fillRect(0, 0, w, h);
    const r = rng(6);
    for (let i = 0; i < 1600; i++) { g.globalAlpha = 0.15 + r() * 0.25; g.fillStyle = ['#cdbfa6', '#f3ecdd', '#b9a98c'][i % 3]; g.fillRect(r() * w, r() * h, 1.6, 1.6); }
    g.globalAlpha = 1; g.fillStyle = 'rgba(110,95,75,.28)';
    for (let i = 0; i <= w; i += w / 4) { g.fillRect(i - 1, 0, 2, h); g.fillRect(0, i - 1, w, 2); }
  }, true);
  const stripeTex = (base, line, step) => canvasTex(64, 64, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); g.fillStyle = line; for (let x = 0; x < w; x += step) g.fillRect(x, 0, step / 3, h); }, true);
  // stripes that run along a bed: they change across v, the bed's width
  const rowTex = (base, line, n) => canvasTex(128, 128, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); g.fillStyle = line; for (let i = 0; i < n; i++) g.fillRect(0, (i + 0.3) * h / n, w, h / n * 0.42); });
  const gownTex = stripeTex('#d9ebe7', '#9cc4be', 8);
  const blanketTex = rowTex('#f2f5f7', '#7fa7c9', 9);
  const pillowTex = rowTex('#eef2f5', '#9db7cc', 6);
  const spreadTex = rowTex('#f4f6f3', '#2f9a6c', 4);
  const paperTex = stripeTex('#e3e8ec', '#d3dbe1', 12); paperTex.repeat.set(8, 2);
  const letterTex = {};
  ['A', 'B', 'C'].forEach(L => {
    letterTex[L] = canvasTex(128, 128, g => {
      g.font = `900 112px ${FONT_UI}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 6; g.strokeStyle = '#6d6a62'; g.strokeText(L, 64, 70); g.fillStyle = '#f4f2ec'; g.fillText(L, 64, 70);
    });
  });
  const plaqueTex = text => canvasTex(256, 72, g => {
    g.fillStyle = '#4f7fae'; g.beginPath(); g.roundRect(0, 0, 256, 72, 10); g.fill();
    g.fillStyle = '#ffffff'; g.font = `700 46px ${FONT_NUM}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 39);
  });
  const nameTex = canvasTex(128, 160, g => {
    g.fillStyle = '#e3e6e8'; g.fillRect(0, 0, 128, 160);
    g.fillStyle = '#1f3d32'; for (let i = 0; i < 5; i++) g.fillRect(10, 12 + i * 29, 108, i ? 15 : 22);
  });
  function monitorTex(v) {
    return canvasTex(440, 300, (g) => {
      g.fillStyle = '#03060a'; g.fillRect(0, 0, 440, 300);
      const trace = (y0, color, f) => { g.strokeStyle = color; g.lineWidth = 3.4; g.beginPath(); for (let x = 10; x <= 272; x++) { const y = y0 + f(x); x === 10 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); };
      const beat = v.hr > 100 ? 50 : 74;
      trace(80, '#53ff8e', x => { const p = x % beat; if (p > 18 && p < 22) return -44 * Math.sin((p - 18) / 4 * Math.PI); if (p >= 22 && p < 25) return 9; if (p > 31 && p < 43) return -9 * Math.sin((p - 31) / 12 * Math.PI); return 0; });
      trace(162, '#4fe3ff', x => { const p = (x % beat) / beat; return -24 * Math.pow(Math.max(0, Math.sin(p * Math.PI)), 2) + 6; });
      trace(236, '#ffd166', x => -12 * Math.sin(x / (v.rr > 24 ? 20 : 34)));
      const num = (label, val, color, y, alarm) => {
        if (alarm) { g.fillStyle = '#d0202c'; g.fillRect(284, y - 60, 150, 78); }
        g.fillStyle = alarm ? '#ffffff' : color;
        g.font = `600 16px ${FONT_NUM}`; g.fillText(label, 294, y - 38);
        g.font = `700 56px ${FONT_NUM}`; g.fillText(String(val), 300, y + 8);
      };
      num('HR', v.hr, '#53ff8e', 80, false);
      num('SpO2', v.spo2, '#4fe3ff', 164, v.alarm);
      num('RR', v.rr, '#ffd166', 240, false);
      g.font = `600 16px ${FONT_NUM}`; g.fillStyle = '#ff9aa2'; g.fillText(`NIBP ${v.bp}`, 12, 288); g.fillStyle = '#ffb2e6'; g.fillText(`T ${v.bt}`, 190, 288);
    });
  }
  function signTex(main, sub, bg, fg, w = 512, h = 150, size) {
    return canvasTex(w, h, g => {
      g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, h, 14); g.fill();
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 ${size || (sub ? 64 : 76)}px ${FONT_UI}`; g.fillText(main, w / 2, sub ? h * 0.42 : h / 2 + 4);
      if (sub) { g.globalAlpha = 0.8; g.font = `700 24px ${FONT_NUM}`; g.fillText(sub, w / 2, h * 0.8); }
    });
  }
  const emrTex = canvasTex(320, 200, (g, w) => {
    g.fillStyle = '#e8f0f7'; g.fillRect(0, 0, w, 200); g.fillStyle = '#1f6fa8'; g.fillRect(0, 0, w, 28);
    g.fillStyle = '#fff'; g.font = `700 15px ${FONT_UI}`; g.fillText(`${WARD} · 今日檢查排程`, 10, 19);
    for (let i = 0; i < 7; i++) { const y = 36 + i * 23; g.fillStyle = i === 1 ? '#ffd5d5' : (i % 2 ? '#fff' : '#f2f6fa'); g.fillRect(6, y, w - 12, 19); g.fillStyle = '#7d8a99'; g.fillRect(12, y + 6, 36, 7); g.fillRect(58, y + 6, 130 - (i * 17) % 60, 7); g.fillStyle = i === 1 ? '#e5383b' : (i === 3 ? '#f0a020' : '#2fa36b'); g.fillRect(w - 44, y + 5, 28, 9); }
  });

  // ---------- repeated furniture: one InstancedMesh per shape and material ----------
  // 66 beds drawn one mesh at a time would be thousands of draw calls
  const kit = new Map();
  const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();
  function kitAdd(key, make, mat, x, y, z, rot, color) {
    let k = kit.get(key);
    if (!k) kit.set(key, k = { geo: make(), mat, items: [] });
    _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
    k.items.push({ m: new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s), color });
  }
  // every instance of a kit shape is drawn, seen or not, so only soft things (mattress, blanket,
  // pillow, cushions) get rounded corners; the rest are plain 12-triangle boxes
  const rgeo = (w, h, d, r) => { const rr = Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002); return r >= 0.05 && rr > 0.004 ? new RoundedBoxGeometry(w, h, d, 1, rr) : new THREE.BoxGeometry(w, h, d); };
  const kb = (mat, w, h, d, x, y, z, r = 0.03, rot, color) => kitAdd(`b${w},${h},${d},${r},${mat.uuid}`, () => rgeo(w, h, d, r), mat, x, y, z, rot, color);
  const kc = (mat, rt, rb, h, x, y, z, seg = 12, rot) => kitAdd(`c${rt},${rb},${h},${seg},${mat.uuid}`, () => new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, rot);
  const kp = (mat, w, h, x, y, z, rot) => kitAdd(`p${w},${h},${mat.uuid}`, () => new THREE.PlaneGeometry(w, h), mat, x, y, z, rot);
  function flushKit() {
    for (const k of kit.values()) {
      const im = new THREE.InstancedMesh(k.geo, k.mat, k.items.length);
      const tinted = k.items.some(it => it.color);
      k.items.forEach((it, i) => { im.setMatrixAt(i, it.m); if (tinted) im.setColorAt(i, _c.set(it.color || '#ffffff')); });
      world.add(im);
    }
    kit.clear();
  }

  // ---------- the floor ----------
  // One east-west corridor. North of it, three audiology rooms (聽力室 01 at the east end), each a
  // sound booth with its control desk. South of it, east to west: toilet, stairs, office, patient
  // waiting area, discussion room, cochlear-implant mapping room, pantry. The fire stairs are the
  // door at the west end of the corridor. North is -z and the camera looks from the south-east, so
  // the south rooms are open to the camera and the audiology rooms are seen over their low
  // corridor wall. x0 is a room's west edge, x1 its east edge, door the x of its door.
  const SOUTH = [
    { n: '廁所', x1: 12, x0: 9.2, door: 10.6, w: 0.9 },
    { n: '樓梯', x1: 9.2, x0: 6.4, door: 7.8, w: 1.0 },
    { n: '辦公室', x1: 6.4, x0: 2.4, door: 4.4, w: 1.0 },
    { n: '病患等候區', x1: 2.4, x0: -3.2, door: -0.4, w: 1.4 },
    { n: '討論室', x1: -3.2, x0: -6.8, door: -5.0, w: 1.0 },
    { n: '人工電子耳調頻室', x1: -6.8, x0: -9.2, door: -8.0, w: 0.9 },
    { n: '茶水間', x1: -9.2, x0: -12, door: -10.6, w: 1.0 },
  ];
  const ROOMS = [
    { n: wb('01'), x1: 12, x0: 4, door: 10.0 },
    { n: wb('02'), x1: 4, x0: -4, door: 2.0 },
    { n: wb('03'), x1: -4, x0: -12, door: -6.0 },
  ];
  // the rooms whose booths can ring get a call lamp by the door and an audiogram on the desk
  // screen (README.md lists them for public-cases.js)
  const CASE_ROOMS = ['01', '02', '03'];
  const BEDS = [], BED = {};
  // a station is where a ring is answered. booth: the sound booth's box and its door; desk: the
  // control desk's centre x. spot: where people stand (the audiologist at the booth door, the
  // assistant beside the desk), so the code that used to place them round a bed has one place to look.
  ROOMS.forEach(r => {
    const bx = r.x0 + 3.0;
    const b = { id: r.n, room: r, x0: r.door - 0.55, x: bx, z: -1.0, isCase: true, occupied: true, iv: false,
      booth: { x0: r.x0 + 0.6, x1: r.x0 + 4.0, z0: -3.7, z1: -0.7, door: bx }, desk: r.x0 + 6.1,
      spot: { approach: [bx, 0.15], touch: [bx, 0.1], cpr: [bx, 0.15], nurse: [r.x0 + 5.0, -0.1], leave: [r.x0 + 4.3, 0.3] } };
    BEDS.push(b); BED[b.id] = b;
  });
  // the waiting area is the fourth station: the small calls ring from the front counter
  {
    const b = { id: '候診', room: SOUTH[3], x0: 0.65, x: 1.2, z: 5.0, isCase: false, occupied: true, iv: false,
      spot: { approach: [1.2, 6.0], touch: [1.2, 6.0], cpr: [1.2, 6.0], nurse: [0.1, 6.2], leave: [2.0, 6.4] } };
    BEDS.push(b); BED[b.id] = b;
  }
  const SPOT = { approach: b => b.spot.approach, cpr: b => b.spot.cpr, nurse: b => b.spot.nurse, leave: b => b.spot.leave, touch: b => b.spot.touch };
  const lamps = {}, monitors = {};
  const lampOff = M('#7d858f', 0.4);
  const lampMat = { red: glow('#ff2a2a', 7), amber: glow('#ffa62b', 5), off: lampOff };
  // the desk screen: a normal audiogram while the room is quiet, a red-framed one while it rings.
  // Frequencies run across (250 Hz to 8 kHz), loudness down; O is the right ear, X the left.
  function audiogramTex(right, left, frame) {
    return canvasTex(440, 300, g => {
      g.fillStyle = '#0b1620'; g.fillRect(0, 0, 440, 300);
      const px = i => 50 + i * 68, py = d => 24 + d * 2.2;
      g.strokeStyle = '#27414f'; g.lineWidth = 1.5; g.fillStyle = '#7fa6b8'; g.font = `600 15px ${FONT_NUM}`; g.textAlign = 'center';
      ['250', '500', '1k', '2k', '4k', '8k'].forEach((t, i) => { g.beginPath(); g.moveTo(px(i), 24); g.lineTo(px(i), 266); g.stroke(); g.fillText(t, px(i), 290); });
      for (let d = 0; d <= 110; d += 20) { g.beginPath(); g.moveTo(50, py(d)); g.lineTo(390, py(d)); g.stroke(); }
      g.textAlign = 'right'; [0, 40, 80].forEach(d => g.fillText(String(d), 40, py(d) + 5));
      const trace = (vals, color, mark) => {
        g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 3; g.beginPath();
        vals.forEach((d, i) => (i ? g.lineTo(px(i), py(d)) : g.moveTo(px(i), py(d)))); g.stroke();
        g.font = `700 20px ${FONT_NUM}`; g.textAlign = 'center'; vals.forEach((d, i) => g.fillText(mark, px(i), py(d) + 7));
      };
      trace(right, '#ff6a6a', 'O'); trace(left, '#6aa8ff', 'X');
      if (frame) { g.strokeStyle = frame; g.lineWidth = 8; g.strokeRect(4, 4, 432, 292); }
    });
  }
  const okAudio = audiogramTex([10, 10, 5, 10, 15, 15], [10, 5, 10, 10, 10, 20]);
  const alertAudio = audiogramTex([30, 40, 55, 70, 80, 85], [10, 10, 10, 15, 15, 20], '#d0202c');
  const TEX = Object.fromEntries(CASE_ROOMS.map(n => [n, [alertAudio, okAudio]]));
  // the cochlear-implant mapping screen: one bar per electrode, tuned by the audiologist
  const mapTex = canvasTex(440, 300, g => {
    g.fillStyle = '#0b1620'; g.fillRect(0, 0, 440, 300);
    g.fillStyle = '#7fa6b8'; g.font = `600 16px ${FONT_NUM}`; g.fillText('MAP  T / C level', 16, 24);
    for (let i = 0; i < 22; i++) {
      const x = 16 + i * 19, c = 110 + Math.round(Math.sin(i / 3) * 24 + i * 2), t = c - 50;
      g.fillStyle = '#2f9a6c'; g.fillRect(x, 270 - t, 12, t - 40); g.fillStyle = '#e8b04a'; g.fillRect(x, 270 - c, 12, c - t);
    }
  });
  const posterTex = (text, sub) => signTex(text, sub, '#eef3f6', '#1f4e79', 300, 200, 36);

  // ---------- floors ----------
  box(world, XE - XW + 0.6, 0.7, ZF - ZB + 0.6, M('#131a26', 0.85), (XE + XW) / 2, -0.352, (ZB + ZF) / 2, 0.12);
  function floor(x0, x1, z0, z1, tex, opts = {}) {
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set((x1 - x0) / (opts.tile || 1.2), (z1 - z0) / (opts.tile || 1.2));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshStandardMaterial({ map: t, color: opts.tint || '#ffffff', roughness: opts.rough ?? 0.32 }));
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, opts.y || 0.003, (z0 + z1) / 2); world.add(m);
  }
  floor(XW, XE, ZFC, ZF, floorTex);
  floor(XW, XE, ZCS, ZFC, hallTex, { tile: 3, rough: 0.16 });
  floor(XW, XE, ZCN, ZCS, floorTex, { tint: '#eef1f2', y: 0.005 });
  floor(9.2, 12, ZFC, ZF, tileTex, { tint: '#dfe7ea', tile: 0.9, y: 0.007 });            // toilet
  floor(-3.2, 2.4, ZFC, ZF, hallTex, { tint: '#cfe3e0', tile: 3, y: 0.007 });             // waiting area
  floor(-9.2, -6.8, ZFC, ZF, hallTex, { tint: '#f1e4c9', tile: 2, y: 0.007 });            // mapping room, warm and quiet
  floor(-12, -9.2, ZFC, ZF, tileTex, { tint: '#e8e2d2', tile: 2.4, y: 0.007 });           // pantry
  // border strips where the corridor floor meets the walls
  const edgeM = M('#8aa3b3', 0.4);
  [ZCS + 0.12, ZFC - 0.12].forEach(z => {
    const m = plane(world, XE - XW, 0.24, edgeM, (XW + XE) / 2, 0.006, z); m.rotation.x = -Math.PI / 2;
  });

  // ---------- walls ----------
  // each face of a wall gets its own finish, lower panel then upper wall: blue-grey and off-white
  // in the rooms, grey and pale green in the corridor
  const FIN = {
    room: [M('#9fb7c6', 0.7), M('#f1efe8', 0.9)],
    hall: [M('#c9d3d6', 0.6), M('#e3eae2', 0.9)],
    core: [M('#cfd8db', 0.7), M('#eef1ef', 0.9)],
    oncall: [M('#b9c6cf', 0.8), new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.9 })],
    shut: [M('#97a1a8', 0.8), M('#b3bcc2', 0.9)],
  };
  const capM = M('#3d4550', 0.7), trimM = M('#8aa3b3', 0.6), frameM = M('#8f979e', 0.5), leafM = M('#c3ccd2', 0.6);
  // a: finish on the +z (or +x) face, b: on the -z (or -x) face. Each face is its own half-thick
  // slab, so every piece has one material and the static floor can be merged per material.
  function wall(x0, z0, x1, z1, h, a, b) {
    const horiz = Math.abs(z1 - z0) < 1e-6, t = 0.16;
    const w = horiz ? Math.abs(x1 - x0) : t, d = horiz ? t : Math.abs(z1 - z0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, low = Math.min(0.88, h);
    const slab = (y0, y1, mat, side) => box(world, horiz ? w : t / 2, y1 - y0, horiz ? t / 2 : d, mat,
      cx + (horiz ? 0 : side * t / 4), (y0 + y1) / 2, cz + (horiz ? side * t / 4 : 0), 0);
    slab(0, low, a[0], 1); slab(0, low, b[0], -1);
    if (h > low + 0.01) { slab(low, h, a[1], 1); slab(low, h, b[1], -1); box(world, w + (horiz ? 0 : 0.02), 0.04, d + (horiz ? 0.02 : 0), trimM, cx, low, cz, 0); }
    box(world, w, 0.02, d, capM, cx, h + 0.01, cz, 0);
    solid(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2);
  }
  // a wall along x with door openings; open leaves swing into the side named by `into`
  function run(x0, x1, z, h, doors, a, b, into, rail) {
    // openings are cut walking along the wall, so they must come in order of x; the room
    // lists run east to west, and unsorted they let one segment bury every door after it
    doors = [...doors].sort((p, q) => p.x - q.x);
    let cur = x0;
    const seg = (p, q) => {
      if (q - p < 0.05) return;
      wall(p, z, q, z, h, a, b);
      if (rail) for (const s of rail) kb(M('#bdb5a6', 0.45), q - p - 0.14, 0.07, 0.08, (p + q) / 2, 0.84, z + s * 0.15, 0.03);
    };
    for (const d of doors) { seg(cur, d.x - d.w / 2); cur = d.x + d.w / 2; }
    seg(cur, x1);
    for (const d of doors) {
      for (const s of [-1, 1]) kb(frameM, 0.08, h, 0.22, d.x + s * d.w / 2, h / 2, z, 0.01);
      if (into) kb(leafM, 0.05, h - 0.02, d.w - 0.08, d.x + d.w / 2 - 0.06, h / 2, z + into * (d.w / 2 + 0.06), 0.01);
    }
  }
  function runZ(z0, z1, x, h, doors, a, b) {
    doors = [...doors].sort((p, q) => p.z - q.z);
    let cur = z0;
    const seg = (p, q) => { if (q - p > 0.05) wall(x, p, x, q, h, a, b); };
    for (const d of doors) { seg(cur, d.z - d.w / 2); cur = d.z + d.w / 2; }
    seg(cur, z1);
    for (const d of doors) for (const s of [-1, 1]) kb(frameM, 0.22, h, 0.08, x, h / 2, d.z + s * d.w / 2, 0.01);
  }
  // south rooms: the corridor-side wall with a door for each, the dividers, and the low back wall
  run(XW, XE, ZFC, 1.0, SOUTH.map(r => ({ x: r.door, w: r.w })), FIN.room, FIN.hall, 1, [-1]);
  wall(XW, ZF + 0.08, XE, ZF + 0.08, 0.5, FIN.shut, FIN.room);
  const SOUTH_EDGES = [XE, ...SOUTH.map(r => r.x0)];
  SOUTH_EDGES.forEach((x, i) => wall(x, ZFC, x, ZF, 1.2, i === 0 ? FIN.shut : FIN.room, i === SOUTH_EDGES.length - 1 ? FIN.shut : FIN.room));
  // north rooms: the corridor-side wall with a door for each, and the walls between them
  run(XW, XE, ZCS, 1.0, ROOMS.map(r => ({ x: r.door, w: 1.0 })), FIN.hall, FIN.core, -1, [1]);
  [4, -4].forEach(x => wall(x, ZCN, x, ZCS, 1.0, FIN.core, FIN.core));
  // the outer walls: full height behind the audiology rooms and at the west end, low at the east end
  wall(XW, ZCN - 0.08, XE, ZCN - 0.08, 2.6, FIN.core, FIN.shut);
  wall(XW - 0.08, ZCN, XW - 0.08, ZCS, 2.6, FIN.core, FIN.shut);
  wall(XW - 0.08, ZCS, XW - 0.08, ZFC, 2.6, FIN.hall, FIN.shut);
  wall(XE + 0.08, ZCN, XE + 0.08, ZFC, 0.6, FIN.shut, FIN.hall);
  // the fire stairs at the west end of the corridor
  box(world, 0.06, 2.1, 1.1, M('#8f979e', 0.5), XW - 0.01, 1.05, 2.3, 0.01);
  plane(world, 0.62, 0.2, basic({ map: plaqueTex('安全梯'), color: '#d6e6f5' }), XW + 0.03, 2.25, 2.3).rotation.y = Math.PI / 2;

  // hanging signs: navy, white text, facing down the floor toward the camera
  // the wires are unlit: a ceiling light of the roaming pool can sit right beside one, and a lit
  // wire that close burns to a white spark that blooms and blinks as the pool moves
  const wireM = basic({ color: '#6f7780' });
  function hang(x, z, text, w = 1.9) {
    [x - w * 0.38, x + w * 0.38].forEach(xx => cyl(world, 0.008, 0.008, 0.5, wireM, xx, 2.95, z, 6));
    plane(world, w, 0.42, basic({ map: signTex(text, null, '#1f4e79', '#ffffff', 600, 130, 54), toneMapped: false, color: '#d6e6f5' }), x, 2.55, z);
  }
  function chair(x, z, rot = 0, seat = '#33404d') {
    const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = rot; world.add(c);
    cyl(c, 0.27, 0.27, 0.04, M('#2e3640', 0.5), 0, 0.05, 0, 18);
    cyl(c, 0.03, 0.03, 0.4, M('#8a939d', 0.4, 0.5), 0, 0.26, 0, 10);
    box(c, 0.48, 0.07, 0.46, M(seat, 0.7), 0, 0.47, 0, 0.03);
    box(c, 0.44, 0.5, 0.06, M(seat, 0.7), 0, 0.8, -0.24, 0.03);
    return c;
  }
  const shelfM = M('#9aa1a8', 0.5, 0.3), binColors = ['#e4572e', '#4f86c6', '#f3a712', '#29a36a', '#b56fd8', '#e94f87', '#3fb6c6'];
  function shelf(x, z, w, rotated) {
    const W = rotated ? 0.45 : w, D = rotated ? w : 0.45;
    for (let i = 0; i < 4; i++) kb(shelfM, W, 0.03, D, x, 0.2 + i * 0.42, z, 0);
    for (const s of [-1, 1]) kb(shelfM, rotated ? 0.45 : 0.04, 1.5, rotated ? 0.04 : 0.45, x + (rotated ? 0 : s * w / 2), 0.75, z + (rotated ? s * w / 2 : 0), 0);
    const r = rng(Math.round(x * 13 + z * 7));
    for (let i = 0; i < 3; i++) for (let k = 0; k < Math.floor(w / 0.32); k++) if (r() < 0.8) {
      const off = -w / 2 + 0.2 + k * 0.32;
      kb(M(binColors[Math.floor(r() * 7)], 0.6), rotated ? 0.34 : 0.26, 0.22, rotated ? 0.26 : 0.34, x + (rotated ? 0 : off), 0.33 + i * 0.42, z + (rotated ? off : 0), 0.02);
    }
    solid(x - W / 2, z - D / 2, x + W / 2, z + D / 2);
  }
  const counterM = M('#e9e6df', 0.5), sinkM = M('#cfd6dc', 0.25, 0.4);
  const plinthM = M('#7f9fb4', 0.6), whiteTopM = M('#f2f4f5', 0.3), baseWoodM = M('#7f9fb4', 0.55), topM = M('#eef1f3', 0.45);
  function counter(x0, z0, x1, z1, h, d, faceM, topMat) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const g = new THREE.Group(); g.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); g.rotation.y = -Math.atan2(z1 - z0, x1 - x0); world.add(g);
    box(g, len, h - 0.12, d, faceM, 0, (h - 0.12) / 2 + 0.06, 0, 0.02);
    box(g, len - 0.04, 0.08, d - 0.06, plinthM, 0, 0.04, 0, 0);
    box(g, len + 0.04, 0.05, d + 0.12, topMat, 0, h - 0.035, 0, 0.015);
    solid(Math.min(x0, x1) - d / 2, Math.min(z0, z1) - d / 2, Math.max(x0, x1) + d / 2, Math.max(z0, z1) + d / 2);
  }
  hang(8.6, 2.3, '← 聽力室 01–03', 2.3); hang(-1.0, 2.3, '↓ 病患等候區', 2.0); hang(-9.6, 2.95, '← 安全梯 EXIT', 2.1);

  // ---------- the audiology rooms ----------
  // each: a sound booth in the west half (double wall, observation window, door with a 檢查中
  // sign, a chair and a response table), and in the east half the audiologist's control desk with
  // the audiometer and the screen that shows the audiogram. The patient sits at the booth's west.
  const boothWall = [M('#6f8088', 0.7), M('#a7b5bb', 0.85)];
  const glassM = new THREE.MeshStandardMaterial({ color: '#cfe8f2', roughness: 0.1, transparent: true, opacity: 0.28 });
  const deskM = M('#e8e6df', 0.45), deskPanelM = M('#d4d1c7', 0.5), darkM = M('#2b3138', 0.5);
  // a screen on a short stand; rotY turns it toward the side that should see it (0 faces south)
  function screen(x, y, z, rotY, tex, w = 0.6, h = 0.4) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; world.add(g);
    box(g, 0.06, 0.24, 0.06, darkM, 0, 0.12, 0, 0.01);
    box(g, w + 0.06, h + 0.06, 0.05, M('#22272e', 0.5), 0, 0.24 + h / 2, 0, 0.02);
    return plane(g, w, h, basic({ map: tex, toneMapped: false }), 0, 0.24 + h / 2, 0.03);
  }
  const POSTERS = [['耳朵的構造', 'EAR'], ['怎麼看聽力圖', 'AUDIOGRAM'], ['保護你的耳朵', 'EAR CARE']];
  ROOMS.forEach((r, i) => {
    const b = BED[r.n], bo = b.booth, dx = b.desk;
    floor(bo.x0, bo.x1, bo.z0, bo.z1, tileTex, { tint: '#b9c4c9', tile: 1.2, y: 0.009 });
    const dl = bo.door - 0.45, dr = bo.door + 0.45;
    wall(bo.x0, bo.z0, bo.x1, bo.z0, 1.2, boothWall, boothWall);
    wall(bo.x0, bo.z0, bo.x0, bo.z1, 1.2, boothWall, boothWall);
    wall(bo.x1, bo.z0, bo.x1, bo.z1, 1.2, boothWall, boothWall);
    wall(bo.x0, bo.z1, dl, bo.z1, 1.2, boothWall, boothWall);
    wall(dr, bo.z1, bo.x1, bo.z1, 1.2, boothWall, boothWall);
    kb(boothWall[0], 1.1, 0.18, 0.2, bo.door, 1.11, bo.z1, 0.01);
    plane(world, 0.8, 0.22, basic({ map: signTex('檢查中', null, '#b3261e', '#ffffff', 300, 90, 44), toneMapped: false }), bo.door, 1.46, bo.z1 + 0.11);
    box(world, 0.05, 0.7, 1.5, glassM, bo.x1, 1.55, (bo.z0 + bo.z1) / 2, 0);
    // inside: the patient's chair, a small response table, two loudspeakers in the corners
    chair(bo.x0 + 1.7, -2.3, -Math.PI / 2, '#5d7a8c');
    box(world, 0.5, 0.04, 0.8, deskM, bo.x0 + 0.85, 0.72, -2.3, 0.01);
    cyl(world, 0.03, 0.03, 0.7, M('#8a939d', 0.4, 0.5), bo.x0 + 0.85, 0.36, -2.3, 8);
    box(world, 0.3, 0.45, 0.3, darkM, bo.x0 + 0.4, 0.23, bo.z0 + 0.35, 0.02);
    box(world, 0.3, 0.45, 0.3, darkM, bo.x0 + 0.4, 0.23, bo.z1 - 0.35, 0.02);
    // the control desk against the north wall
    const dz = -3.5;
    box(world, 2.7, 0.05, 0.8, deskM, dx, 0.76, dz, 0.015);
    [-1.25, 1.25].forEach(s => box(world, 0.05, 0.74, 0.76, deskPanelM, dx + s, 0.37, dz, 0));
    box(world, 2.5, 0.5, 0.03, deskPanelM, dx, 0.45, dz - 0.36, 0);
    box(world, 0.62, 0.14, 0.4, M('#c9ced3', 0.5), dx - 0.7, 0.86, dz, 0.02);
    [-0.22, -0.07, 0.08, 0.23].forEach(k => cyl(world, 0.03, 0.03, 0.03, darkM, dx - 0.7 + k, 0.94, dz + 0.1, 10));
    monitors[b.id] = screen(dx + 0.35, 0.785, dz - 0.05, 0.5, okAudio, 0.6, 0.4);
    box(world, 0.42, 0.015, 0.14, M('#d9dde2', 0.5), dx + 0.4, 0.8, dz + 0.3, 0.005);
    solid(dx - 1.35, dz - 0.4, dx + 1.35, dz + 0.4);
    chair(dx + 0.3, -2.45, Math.PI);
    plane(world, 0.9, 0.6, basic({ map: posterTex(...POSTERS[i]), toneMapped: false }), dx, 1.75, ZCN + 0.02);
    // the call lamp on the corridor wall, beside the door
    lamps[b.id] = sph(world, 0.07, lampOff, r.door + 0.75, 1.15, ZCS - 0.12, 14, 10);
  });
  // the waiting area's call lamp stands on the counter
  lamps['候診'] = sph(world, 0.07, lampOff, 0.8, 1.02, 7.7, 14, 10);

  // ---------- toilet (廁所) ----------
  const porcelain = M('#f4f5f3', 0.3);
  cyl(world, 0.17, 0.14, 0.4, porcelain, 11.4, 0.2, 8.15, 18);
  box(world, 0.46, 0.06, 0.38, porcelain, 11.4, 0.42, 8.15, 0.03);
  box(world, 0.44, 0.42, 0.18, porcelain, 11.4, 0.62, 8.62, 0.03);
  solid(11.05, 7.8, 11.75, 8.85);
  cyl(world, 0.07, 0.09, 0.72, porcelain, 10.0, 0.36, 8.6, 12);
  box(world, 0.52, 0.14, 0.4, porcelain, 10.0, 0.79, 8.55, 0.04);
  cyl(world, 0.015, 0.015, 0.16, M('#b9c1c8', 0.3, 0.6), 10.0, 0.92, 8.72, 8);
  solid(9.7, 8.3, 10.3, 8.8);

  // ---------- stairs (樓梯) ----------
  // the steps rise toward the back wall; the player walks the landing, never up them
  for (let i = 0; i < 6; i++) kb(M('#c9cfd3', 0.6), 2.4, 0.18 * (i + 1), 0.55, 7.8, 0.09 * (i + 1), 5.6 + i * 0.55, 0.01);
  kb(M('#8f979e', 0.4, 0.4), 0.05, 0.05, 3.3, 6.65, 1.0, 7.2, 0.01); kb(M('#8f979e', 0.4, 0.4), 0.05, 0.05, 3.3, 8.95, 1.0, 7.2, 0.01);
  solid(6.6, 5.3, 9.0, 8.7);

  // ---------- office (辦公室): the desk with the phone, the filing shelf, a snack table, and the cot ----------
  box(world, 0.7, 0.05, 1.9, deskM, 2.85, 0.76, 5.9, 0.015);
  [2.52, 3.17].forEach(x => box(world, 0.05, 0.74, 1.86, deskPanelM, x, 0.37, 5.9, 0));
  screen(2.85, 0.785, 5.4, Math.PI / 2, emrTex, 0.5, 0.34);
  // the desk phone: base, handset, and a lamp that glows while a call is waiting
  box(world, 0.26, 0.07, 0.2, M('#d9dde2', 0.4), 2.85, 0.82, 6.3, 0.02);
  box(world, 0.06, 0.05, 0.22, M('#2b3138', 0.5), 2.85, 0.88, 6.3, 0.02);
  const phoneLamp = sph(world, 0.035, lampOff, 2.85, 0.92, 6.43, 10, 8);
  solid(2.45, 4.95, 3.2, 6.85);
  chair(3.7, 5.7, -Math.PI / 2); chair(3.6, 6.5, -Math.PI / 2, '#e59a9a');
  shelf(5.7, 4.05, 1.3);
  // the snack table: a basket of biscuits and a box of tea bags
  box(world, 0.6, 0.04, 0.6, M('#c9a77a', 0.5), 5.95, 0.7, 5.6, 0.01); cyl(world, 0.04, 0.04, 0.68, M('#8a939d', 0.4, 0.5), 5.95, 0.34, 5.6, 8);
  box(world, 0.3, 0.1, 0.24, M('#a77b4f', 0.7), 5.87, 0.77, 5.6, 0.03);
  [['#e4572e', -0.06], ['#f3a712', 0.0], ['#29a36a', 0.06]].forEach(([c, dx]) => box(world, 0.08, 0.05, 0.12, M(c, 0.6), 5.87 + dx, 0.84, 5.6, 0.01));
  box(world, 0.16, 0.1, 0.1, M('#d96a77', 0.6), 6.1, 0.77, 5.7, 0.01);
  solid(5.65, 5.25, 6.25, 5.95);
  // the cot along the back wall, head to the west
  const cotX = 4.35, cotZ = 8.2;
  box(world, 2.12, 0.3, 0.82, M('#6b4f3a', 0.7), cotX, 0.15, cotZ, 0.03);
  box(world, 2.04, 0.14, 0.78, M('#f2f2f0', 0.9), cotX, 0.37, cotZ, 0.06);
  box(world, 0.34, 0.12, 0.5, M('#9fd8c6', 0.95), cotX - 0.8, 0.5, cotZ, 0.06);
  solid(3.25, 7.75, 5.45, 8.65);
  const bl1 = box(world, 1.15, 0.12, 0.8, new THREE.MeshStandardMaterial({ map: spreadTex, roughness: 0.95 }), cotX + 0.57, 0.5, cotZ + 0.03, 0.06); bl1.rotation.y = 0.18; bl1.rotation.x = 0.05;
  const sleepBlanket = box(world, 1.3, 0.14, 0.82, new THREE.MeshStandardMaterial({ map: spreadTex, roughness: 0.95 }), cotX + 0.37, 0.78, cotZ, 0.06);
  sleepBlanket.visible = false;

  // ---------- discussion room (討論室): a round table for talking a family through the results ----------
  cyl(world, 0.65, 0.65, 0.05, M('#c9a77a', 0.5), -5.0, 0.75, 6.6, 24);
  cyl(world, 0.08, 0.08, 0.72, M('#8a7a66', 0.5), -5.0, 0.37, 6.6, 10);
  solid(-5.7, 5.9, -4.3, 7.3);
  chair(-5.0, 5.55, 0); chair(-5.0, 7.65, Math.PI); chair(-6.1, 6.6, Math.PI / 2); chair(-3.9, 6.6, -Math.PI / 2);
  // a whiteboard on an easel, and a side table with the hearing-aid sample case
  [-5.65, -4.35].forEach(x => cyl(world, 0.015, 0.015, 1.0, M('#8a939d', 0.4, 0.5), x, 0.5, 8.7, 6));
  box(world, 1.4, 0.9, 0.04, M('#f7f8f9', 0.3), -5.0, 1.1, 8.7, 0.01);
  plane(world, 1.2, 0.7, basic({ map: signTex('助聽器怎麼戴？', null, '#f7f8f9', '#2a4d6e', 300, 180, 30), toneMapped: false }), -5.0, 1.1, 8.73);
  box(world, 0.5, 0.7, 0.5, M('#ecebe4', 0.6), -3.7, 0.35, 8.3, 0.02);
  box(world, 0.4, 0.08, 0.3, M('#2b3138', 0.5), -3.7, 0.74, 8.3, 0.02);
  solid(-3.95, 8.05, -3.45, 8.55);

  // ---------- cochlear-implant mapping room (人工電子耳調頻室) ----------
  // the audiologist's laptop at the back, the programming interface beside it, and a low toy table
  // by the west wall: mapping is done with a child on a parent's lap, so the room is built for them.
  // the aisle from the door stays 1.6 m wide on the east side
  box(world, 1.6, 0.05, 0.6, deskM, -8.0, 0.76, 8.55, 0.015);
  [-8.75, -7.25].forEach(x => box(world, 0.05, 0.74, 0.56, deskPanelM, x, 0.37, 8.55, 0));
  screen(-8.0, 0.785, 8.6, 0, mapTex, 0.56, 0.38);
  box(world, 0.2, 0.06, 0.14, M('#c9ced3', 0.5), -7.55, 0.81, 8.45, 0.02);
  solid(-8.8, 8.25, -7.2, 8.85);
  chair(-8.0, 7.75, 0);
  // two soft-play tables and a stack of blocks
  cyl(world, 0.3, 0.3, 0.04, M('#f3a712', 0.6), -8.7, 0.42, 5.6, 16); cyl(world, 0.03, 0.03, 0.4, M('#8a939d', 0.4, 0.5), -8.7, 0.21, 5.6, 8);
  [['#e4572e', -8.8, 5.55], ['#4f86c6', -8.6, 5.65], ['#29a36a', -8.7, 5.7]].forEach(([c, x, z]) => box(world, 0.1, 0.1, 0.1, M(c, 0.6), x, 0.49, z, 0.01));
  solid(-9.0, 5.3, -8.4, 5.9);
  box(world, 0.4, 0.3, 0.4, M('#9bb0a0', 0.6), -8.7, 0.15, 6.5, 0.05);
  // a rack of coil magnets and spare processors on the east wall
  box(world, 0.12, 0.9, 1.0, M('#ecebe4', 0.6), -6.95, 1.0, 7.0, 0.02);
  [0, 1, 2].forEach(i => box(world, 0.05, 0.08, 0.22, M(['#4f86c6', '#d96a77', '#29a36a'][i], 0.5), -6.88, 1.2, 6.7 + i * 0.3, 0.01));
  solid(-7.05, 6.45, -6.8, 7.55);

  // ---------- pantry (茶水間): counter with the water dispenser, microwave, fridge, a small table ----------
  const counterWM = M('#e9e6df', 0.5);
  box(world, 0.55, 0.86, 2.6, counterWM, -11.7, 0.43, 6.9, 0.02); box(world, 0.6, 0.04, 2.66, M('#a9b4bd', 0.4), -11.7, 0.88, 6.9, 0.01);
  // the water dispenser: tall blue jug on a white body, a cup tray, a stack of paper cups
  box(world, 0.36, 0.5, 0.36, M('#f4f4f2', 0.4), -11.7, 1.13, 5.9, 0.03);
  cyl(world, 0.13, 0.13, 0.34, new THREE.MeshStandardMaterial({ color: '#7ec4e8', transparent: true, opacity: 0.7, roughness: 0.2 }), -11.7, 1.55, 5.9, 14);
  cyl(world, 0.04, 0.035, 0.1, M('#f2f2f0', 0.6), -11.45, 0.96, 5.9, 10);
  box(world, 0.34, 0.26, 0.42, M('#d8dde2', 0.4), -11.7, 1.03, 7.6, 0.02);
  solid(-11.98, 5.6, -11.42, 8.2);
  box(world, 0.66, 1.7, 0.66, M('#d8dde2', 0.35, 0.2), -11.62, 0.85, 8.6, 0.04); solid(-11.98, 8.27, -11.3, 8.93);
  box(world, 0.9, 0.04, 0.7, deskM, -10.3, 0.75, 7.0, 0.01); cyl(world, 0.04, 0.04, 0.72, M('#8a939d', 0.4, 0.5), -10.3, 0.37, 7.0, 8);
  solid(-10.78, 6.62, -9.82, 7.38);
  chair(-10.3, 6.1, 0);
  // the bento, on the pantry table once dinner comes
  const bento = new THREE.Group(); bento.position.set(-10.3, 0.77, 7.0); world.add(bento);
  box(bento, 0.3, 0.06, 0.22, M('#2b2b2b', 0.6), 0, 0.03, 0, 0.015);
  box(bento, 0.16, 0.03, 0.18, M('#fbfaf5', 0.9), -0.06, 0.065, 0, 0.01);
  box(bento, 0.1, 0.03, 0.08, M('#b5652b', 0.7), 0.08, 0.07, -0.04, 0.01);
  box(bento, 0.08, 0.03, 0.06, M('#f2c230', 0.7), 0.08, 0.07, 0.05, 0.01);
  sph(bento, 0.025, M('#4f9d4a', 0.8), 0.02, 0.08, 0.06, 8, 6);
  const sticks = box(bento, 0.22, 0.012, 0.012, M('#d8b07a', 0.6), 0, 0.075, 0.13, 0); sticks.rotation.y = 0.15;
  const steamM = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false });
  const steam = [0, 1, 2].map(i => sph(bento, 0.035, steamM, -0.05 + i * 0.05, 0.16, 0, 8, 6));

  // ---------- waiting area (病患等候區): two benches, a number totem, the front counter ----------
  const benchM = M('#5d7a8c', 0.6);
  [-1.9, 1.2].forEach(x => {
    box(world, 1.6, 0.08, 0.45, benchM, x, 0.45, 4.95, 0.02);
    box(world, 1.6, 0.45, 0.06, benchM, x, 0.72, 4.75, 0.02);
    [-0.7, 0.7].forEach(s => box(world, 0.06, 0.42, 0.4, M('#8a939d', 0.4, 0.4), x + s, 0.21, 4.95, 0));
    solid(x - 0.8, 4.7, x + 0.8, 5.2);
  });
  box(world, 0.3, 1.5, 0.2, M('#dfe4e8', 0.5), 2.0, 0.75, 7.0, 0.02);
  plane(world, 0.26, 0.2, basic({ map: signTex('12', 'NOW', '#1f4e79', '#ffffff', 128, 100, 52), toneMapped: false }), 2.0, 1.3, 7.11);
  solid(1.85, 6.85, 2.15, 7.15);
  counter(0.6, 7.7, -2.4, 7.7, 0.84, 0.6, baseWoodM, whiteTopM);
  screen(-0.4, 0.89, 7.7, 0, emrTex, 0.5, 0.34);
  chair(-1.6, 8.45, Math.PI); chair(-0.2, 8.45, Math.PI);
  plant(-2.8, 8.4);

  // where the audiologist's routines happen: a bento in the pantry, the toilet, the cot in the
  // office, and (new) the office phone and snacks and the pantry's water dispenser.
  // bed: the cot's footprint (x0, z0, x1, z1), the same box the audiologist walks around
  const ONCALL = { bed: [3.25, 7.75, 5.45, 8.65], wake: [4.4, 7.25], eatAt: [-10.3, 5.3], seat: [-10.3, 6.1], seatRot: 0, stand: [-10.3, 5.3],
    toiletAt: [10.6, 7.0], toiletOut: [10.6, 5.6], sleeper: [cotX + 0.82, 0.64, cotZ], bento: [-10.3, 1.25, 7.0], zzz: [cotX - 0.08, 1.3, cotZ],
    phoneAt: [3.55, 6.1], snackAt: [5.0, 5.6], waterAt: [-11.05, 5.9] };

  // ---------- plants at the two ends of the corridor ----------
  function plant(x, z) {
    cyl(world, 0.22, 0.17, 0.42, M('#d9dde0', 0.7), x, 0.21, z, 16);
    [[0, 0.62, 0, 0.3], [0.12, 0.85, 0.05, 0.22], [-0.1, 0.8, -0.06, 0.2]].forEach(([dx, y, dz, r]) => sph(world, r, F('#3f8a52', 0.8), x + dx, y, z + dz, 8, 6));
    solid(x - 0.3, z - 0.3, x + 0.3, z + 0.3);
  }
  plant(XW + 0.5, 3.1); plant(XE - 0.5, 3.1);


  // ---------- people ----------
  const coatM = new THREE.MeshStandardMaterial({ color: '#f6f8fa', roughness: 0.85, side: THREE.DoubleSide, flatShading: true });
  function person(o) {
    const g = new THREE.Group();
    const skinM = F(o.skin || '#f0c6a6', 0.65), topM = F(o.top, 0.85), pantsM = F(o.pants || o.top, 0.85), shoeM = F(o.shoes || '#eceff2', 0.6);
    const pose = o.pose || 'stand';
    const lift = pose === 'sit' ? -0.36 : 0;
    const legs = [], arms = [];
    for (const s of [-1, 1]) {
      if (pose === 'stand') {
        const hip = new THREE.Group(); hip.position.set(s * 0.085, 0.74, 0); g.add(hip);
        cyl(hip, 0.068, 0.062, 0.66, pantsM, 0, -0.33, 0, 8);
        box(hip, 0.12, 0.08, 0.25, shoeM, 0, -0.7, 0.04, 0.035);
        legs.push(hip);
      } else {
        const th = cyl(g, 0.072, 0.072, 0.44, pantsM, s * 0.085, 0.5, 0.2, 8); th.rotation.x = Math.PI / 2;
        cyl(g, 0.062, 0.06, 0.46, pantsM, s * 0.085, 0.26, 0.4, 8);
        box(g, 0.12, 0.08, 0.25, shoeM, s * 0.085, 0.04, 0.46, 0.035);
      }
    }
    cyl(g, 0.19, 0.215, 0.6, topM, 0, 0.99 + lift, 0, 10);
    const sh = sph(g, 0.205, topM, 0, 1.27 + lift, 0, 10, 6); sh.scale.set(1, 0.42, 0.82);
    let armM = topM;
    if (o.coat) {
      armM = coatM;
      // short coat (PGY) ends at the hip; long coat (residents and up) reaches the knee
      const short = o.coat === 'short' || pose !== 'stand';
      const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.226, short ? 0.25 : 0.28, short ? 0.6 : 0.92, 12, 1, true, 0.42, Math.PI * 2 - 0.84), coatM);
      coat.position.set(0, pose === 'stand' ? (short ? 1.03 : 0.87) : 1.0 + lift, 0); g.add(coat);
      const cs = sph(g, 0.215, coatM, 0, 1.275 + lift, -0.01, 10, 6); cs.scale.set(1.02, 0.42, 0.8);
    }
    for (const s of [-1, 1]) {
      const shp = new THREE.Group(); shp.position.set(s * 0.258, 1.27 + lift, 0); shp.rotation.z = s * 0.1; g.add(shp);
      cyl(shp, 0.064, 0.056, 0.56, armM, 0, -0.27, 0, 8);
      sph(shp, 0.06, skinM, 0, -0.58, 0, 8, 6);
      arms.push(shp);
    }
    cyl(g, 0.07, 0.075, 0.1, skinM, 0, 1.36 + lift, 0, 8);
    const hy = 1.58 + lift;
    sph(g, 0.205, skinM, 0, hy, 0, 12, 10);
    for (const s of [-1, 1]) sph(g, 0.022, M('#1d1a1a', 0.4), s * 0.072, hy + 0.02, 0.19, 6, 5);
    const hm = F(o.hairColor || '#1d1817', 0.75);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.222, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), hm);
    cap.position.set(0, hy + 0.012, -0.012); cap.rotation.x = -0.32; g.add(cap);
    if (o.hair === 'pony') { sph(g, 0.09, hm, 0, hy + 0.08, -0.2, 8, 6); const tail = cyl(g, 0.07, 0.03, 0.3, hm, 0, hy - 0.08, -0.27, 8); tail.rotation.x = 0.35; }
    if (o.hair === 'bob') { const b = sph(g, 0.225, hm, 0, hy - 0.045, -0.04, 12, 8); b.scale.set(1.04, 0.92, 1); }
    if (o.mask) box(g, 0.21, 0.11, 0.07, F('#b9d8f0', 0.9), 0, hy - 0.08, 0.165, 0.03);
    if (o.clip) box(g, 0.24, 0.3, 0.03, F('#a77b4f', 0.7), 0, 1.06 + lift, 0.23, 0.01);
    if (o.steth) {
      const st = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.013, 6, 16, Math.PI), M('#2d3138', 0.5));
      st.rotation.z = Math.PI; st.rotation.x = -0.28; st.position.set(0, 1.27 + lift, 0.17); g.add(st);
    }
    if (o.badge) box(g, 0.075, 0.095, 0.02, M('#ffffff', 0.5), -0.1, 1.13 + lift, 0.215, 0.01);
    g.userData = { legs, arms, person: true };
    world.add(g);
    return g;
  }
  const place = (obj, x, z, rot = 0) => { obj.position.set(x, 0, z); obj.rotation.y = rot; return obj; };

  const PGY_LOOK = { m: { hair: 'short', hairColor: '#1b1716' }, f: { hair: 'pony', hairColor: '#141110' } };
  const players = {}, sitters = {}, sleepers = {};
  for (const k of ['m', 'f']) {
    // the shift starts in front of the station
    players[k] = place(person({ top: '#7fb2dc', coat: 'short', steth: true, badge: true, ...PGY_LOOK[k] }), 10.6, 2.3, -Math.PI / 2);
    players[k].rotation.order = 'YXZ'; // turn first, then lean forward over a chest
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 40), basic({ color: '#45e3cc', transparent: true, opacity: 0.9, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; players[k].add(ring);
    sitters[k] = place(person({ top: '#7fb2dc', coat: 'short', steth: true, pose: 'sit', ...PGY_LOOK[k] }), ONCALL.seat[0], ONCALL.seat[1], ONCALL.seatRot);
    sitters[k].visible = false;
    // lying on the on-call bed, head toward the west wall
    const holder = new THREE.Group(); holder.position.set(...ONCALL.sleeper); holder.rotation.y = Math.PI / 2; world.add(holder);
    const body = person({ top: '#7fb2dc', coat: 'short', ...PGY_LOOK[k] });
    holder.add(body); body.rotation.x = -Math.PI / 2;
    holder.visible = false; sleepers[k] = holder;
  }
  players.f.visible = false;
  let player = players.m, playerSit = sitters.m;

  const NURSE = { top: '#f5f6f8', hair: 'pony', hairColor: '#6b3f22', clip: true, badge: true };
  const nurseByBed = {};
  function ensureNurse(bed) {
    if (nurseByBed[bed]) { nurseByBed[bed].visible = true; return nurseByBed[bed]; }
    const [x, z] = SPOT.nurse(BED[bed]);
    const n = place(person(NURSE), x, z, -Math.PI / 2);
    n.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // she stands in the room's only aisle, so she is a small round obstacle (see collide), not a box
    return (nurseByBed[bed] = n);
  }
  const sitShufen = place(person({ top: '#f5f6f8', hair: 'bob', hairColor: '#2c201d', pose: 'sit', mask: true }), -1.6, 8.45, Math.PI);
  const sitAzhe = place(person({ top: '#7fb2dc', coat: 'long', steth: true, hair: 'short', hairColor: '#231c19', pose: 'sit', mask: true }), -5.0, 5.55, 0);
  const sitYaqi = place(person({ top: '#f5f6f8', hair: 'pony', hairColor: '#3a2a24', pose: 'sit', mask: true }), 3.7, 5.7, -Math.PI / 2);
  const prepJingyi = place(person({ ...NURSE, clip: false }), 5.8, 4.6, -Math.PI / 2); // by the filing shelf in the office

  // the rest of the night staff walk the corridor; they are scenery, so the player walks through them
  const staff = [];
  function walker(look, path, opts = {}) {
    const obj = place(person({ ...NURSE, ...look }), path[0][0], path[0][1], 0);
    const n = { obj, path, i: 1, dir: 1, wait: Math.random() * 3, speed: opts.speed || 1.25, phase: Math.random() * 6, active: opts.active !== false, once: !!opts.once, face: opts.face };
    obj.visible = n.active;
    staff.push(n);
    return n;
  }
  const wPinyu = walker({}, [[10.6, 2.4], [2.0, 2.4], [-5.0, 2.2], [-11.2, 2.4]]);
  const wShuhan = walker({ hair: 'bob', hairColor: '#2c201d', clip: false }, [[-11.0, 3.0], [-4.0, 3.1], [3.0, 3.0], [11.0, 3.0]]);
  const wAkai = walker({ top: '#4f6f95', hair: 'short', hairColor: '#2a2420', clip: false, badge: false }, [[11.0, 1.7], [0.0, 1.8], [-11.0, 1.7]]);
  const wAzhu = walker({ top: '#8fb3a2', hair: 'bob', hairColor: '#9c9c9c', clip: false, badge: false }, [[-4.0, 2.3], [-8.0, 2.3], [-8.0, 4.4], [-8.0, 5.0]]);
  // everyone who can be spoken to (chatter.js), and how close the doctor has to be: the station
  // staff sit behind the counter, so they are reached from across it
  const TALKERS = [
    { key: 'pinyu', obj: wPinyu.obj, walker: wPinyu, reach: 1.3 }, { key: 'shuhan', obj: wShuhan.obj, walker: wShuhan, reach: 1.3 },
    { key: 'akai', obj: wAkai.obj, walker: wAkai, reach: 1.3 }, { key: 'azhu', obj: wAzhu.obj, walker: wAzhu, reach: 1.3 },
    { key: 'shufen', obj: sitShufen, reach: 2.1 }, { key: 'yaqi', obj: sitYaqi, reach: 2.1 }, { key: 'azhe', obj: sitAzhe, reach: 2.1 },
    { key: 'jingyi', obj: prepJingyi, reach: 1.4 },
  ];
  // two more staff keep the front counter in the evening
  walker({}, [[9.0, 2.0]], { active: false, speed: 2.4, face: 0 });
  walker({ hair: 'bob', hairColor: '#2c201d' }, [[8.4, 2.0]], { active: false, speed: 2.2, face: -Math.PI / 2 });
  function updateStaff(dt) {
    for (const n of staff) {
      if (!n.active) continue;
      const { obj, path } = n, { legs, arms } = obj.userData;
      if (n.wait > 0) { n.wait -= dt; legs.forEach(l => { l.rotation.x *= 0.8; }); arms.forEach(a => { a.rotation.x *= 0.8; }); continue; }
      const [tx, tz] = path[n.i], dx = tx - obj.position.x, dz = tz - obj.position.z, d = Math.hypot(dx, dz);
      if (d < 0.05) {
        if (n.once && n.i === path.length - 1) { n.active = false; if (n.face != null) obj.rotation.y = n.face; legs.forEach(l => { l.rotation.x = 0; }); arms.forEach(a => { a.rotation.x = 0; }); continue; }
        if (n.i === path.length - 1 || n.i === 0) n.dir = -n.dir;
        n.i += n.dir; n.wait = n.once ? 0 : 0.6 + Math.random() * 2.4;
        continue;
      }
      const step = Math.min(d, n.speed * dt);
      obj.position.x += dx / d * step; obj.position.z += dz / d * step;
      let diff = Math.atan2(dx, dz) - obj.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      obj.rotation.y += diff * Math.min(1, dt * 10);
      n.phase += dt * n.speed * 3.4;
      const sw = Math.sin(n.phase) * 0.5;
      legs[0].rotation.x = sw; legs[1].rotation.x = -sw; arms[0].rotation.x = -sw * 0.6; arms[1].rotation.x = sw * 0.6;
    }
  }

  // ---------- patients ----------
  // A patient whose appointment has not started waits on a bench in the waiting area, and their
  // patience runs down on a label over their head (see updatePatients). Once the case is opened
  // the patient is in the booth of the room the call came from, and the bench seat is free again.
  const PATIENT_LOOKS = [{ top: '#d9ebe7', hair: 'bob', hairColor: '#cfcfcf' }, { top: '#e8dcc8', hair: 'short', hairColor: '#b8b8b8' }, { top: '#cfdcea', hair: 'short', hairColor: '#2b2421' }, { top: '#f0d9d9', hair: 'pony', hairColor: '#3a2a24' }];
  // the bench seats; the benches are centred at x 1.2 and -1.9 on z 4.95, two seats on each
  const WAIT_SEATS = [[0.8, 4.95], [-2.3, 4.95], [1.6, 4.95], [-1.5, 4.95]];
  const waiters = WAIT_SEATS.map(([x, z], i) => { const w = place(person({ ...PATIENT_LOOKS[i], pose: 'sit', mask: i % 2 === 0 }), x, z, 0); w.visible = false; return w; });
  const boothSitters = ROOMS.map((r, i) => { const w = place(person({ ...PATIENT_LOOKS[i], pose: 'sit' }), BED[r.n].booth.x0 + 1.7, -2.3, -Math.PI / 2); w.visible = false; return w; });

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight('#8f9dc8', '#2a2730', 1.05); scene.add(hemi);
  // moonlight through the windows; its shadow box follows the camera, so it stays sharp on a long floor
  const moon = new THREE.DirectionalLight('#b0c2ff', 1.0);
  const MOON = new THREE.Vector3(-10, 18, 10);
  moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -16, right: 16, top: 14, bottom: -14, near: 1, far: 70 });
  moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.03;
  scene.add(moon, moon.target);
  const point = (color, intensity, dist, x, y, z) => { const l = new THREE.PointLight(color, intensity, dist, 2); l.position.set(x, y, z); scene.add(l); return l; };
  // the floor has far more ceiling lights than a forward renderer should carry, so a fixed
  // pool of point lights moves to the fixtures nearest the camera
  const FIX = [];
  for (let x = 10; x >= -10; x -= 5) FIX.push([x, 2.3, '#f4f6ff', 9, 8]);
  ROOMS.forEach(r => FIX.push([r.x0 + 4, -1.6, '#fff1dc', 5, 7]));
  SOUTH.forEach(r => FIX.push([(r.x0 + r.x1) / 2, 6.3, '#fff1dc', r.n === '廁所' ? 3.5 : 4.5, 6]));
  const pool = Array.from({ length: 7 }, () => point('#ffffff', 0, 8, 0, 2.7, 0));
  let poolAt = null;
  let poolDim = 1;
  function updateLights(target) {
    const dim = S.t >= PACE.lightsOut ? 0.55 : 1;  // first called after S exists (updateCamera at the end of boot)
    if (poolAt && poolAt.distanceToSquared(target) < 1 && dim === poolDim) return;
    poolAt = (poolAt || new THREE.Vector3()).copy(target); poolDim = dim;
    const near = FIX.map(f => [f, (f[0] - target.x) ** 2 + (f[1] - target.z) ** 2]).sort((a, b) => a[1] - b[1]);
    pool.forEach((l, i) => { const f = near[i][0]; l.position.set(f[0], 2.7, f[1]); l.color.set(f[2]); l.intensity = f[3] * (f[2] === '#7d95d6' ? 1 : dim); l.distance = f[4]; });
  }
  point('#ffc27a', 5, 4, 2.9, 1.1, 5.3); // the office desk lamp
  // two roaming alarm lights follow the most urgent red and amber beds, so the light count stays fixed
  const alarmRed = point('#ff2d2d', 0, 4.5, 0, 1.9, 7.6), alarmAmber = point('#ffae3d', 0, 3.5, 0, 1.9, 7.6);

  flushKit();
  // Everything that never moves, changes material or hides is baked into one mesh per material:
  // a few hundred draw calls become a few dozen, which is what an integrated GPU can carry.
  function bake(keep) {
    world.updateMatrixWorld(true);
    const groups = new Map(), baked = [];
    world.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.visible) return;
      for (let q = o; q && q !== world; q = q.parent) if (keep.has(q) || q.userData.person || !q.visible) return;
      // indexed and non-indexed geometry cannot share a merge, so they go to separate groups
      const geo = o.geometry, key = `${o.material.uuid}|${geo.index ? 'i' : 'n'}|${Object.keys(geo.attributes).sort().join()}`;
      if (!groups.has(key)) groups.set(key, { mat: o.material, geos: [] });
      groups.get(key).geos.push(geo.clone().applyMatrix4(o.matrixWorld));
      baked.push(o);
    });
    baked.forEach(o => o.parent.remove(o));
    for (const { mat, geos } of groups.values()) world.add(new THREE.Mesh(mergeGeometries(geos), mat));
  }
  bake(new Set([...Object.values(lamps), ...Object.values(monitors), bl1, sleepBlanket, bento, phoneLamp]));
  // only people and beds cast moon shadows; walls and props just receive them
  world.traverse(o => {
    if (!o.isMesh) return;
    const flat = !Array.isArray(o.material) && o.material.isMeshBasicMaterial;
    let person = false;
    for (let q = o; q; q = q.parent) if (q.userData.person) { person = true; break; }
    o.receiveShadow = !flat;
    o.castShadow = !flat && (person || o.isInstancedMesh);
  });

  // ---------- render pipeline ----------
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const camDir = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH));
  const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 2 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, cam));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.86));
  composer.addPass(new OutputPass());
  let vw = 16, vh = 9;
  // render scale, lowered when the GPU cannot keep up (see frameLoop) and raised again when it can
  let quality = 1;
  function resize() {
    const r = frame.getBoundingClientRect();
    vw = Math.max(16, r.width); vh = Math.max(9, r.height);
    const dpr = Math.max(0.6, Math.min(window.devicePixelRatio || 1, 1.75) * quality);
    renderer.setPixelRatio(dpr); renderer.setSize(vw, vh, false);
    composer.setPixelRatio(dpr); composer.setSize(vw, vh);
  }
  new ResizeObserver(resize).observe(frame);
  resize();

  const camTarget = new THREE.Vector3(0.8, 0.6, 0.2);
  let zoom = 4.9;
  function updateCamera(dt, snap) {
    const want = S.map ? new THREE.Vector3(0, 0, 2.6) : new THREE.Vector3(player.position.x, 0.6, player.position.z - 0.4);
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    camTarget.lerp(want, k);
    zoom += ((S.map ? 11 : 4.9) - zoom) * (snap ? 1 : 1 - Math.exp(-dt * 5));
    cam.position.copy(camTarget).addScaledVector(camDir, 60);
    cam.lookAt(camTarget);
    const hw = zoom * vw / vh;
    cam.left = -hw; cam.right = hw; cam.top = zoom; cam.bottom = -zoom;
    cam.updateProjectionMatrix();
    const sh = S.map ? 34 : 16;
    if (moon.shadow.camera.right !== sh) { Object.assign(moon.shadow.camera, { left: -sh, right: sh, top: sh * 0.9, bottom: -sh * 0.9 }); moon.shadow.camera.updateProjectionMatrix(); }
    moon.target.position.copy(camTarget); moon.position.copy(camTarget).add(MOON);
    updateLights(camTarget);
  }

  // ---------- calls ----------
  // CASES holds every bed that can ring tonight. The patients and the corridor arrest are added
  // when the night is drawn (startPublicNight); the entries here are the small calls' scenes, for a
  // doctor who walks over anyway.
  const pickN = (list, n) => list.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
  const CASES = {
    // (the day's calls are answered on the phone; there are no walk-over scenes)
  };
  // the clinic day: doors open at 08:00, the last patient leaves at 17:30
  const START = 8 * 60, END = 18 * 60;
  // how fast the night happens: game minutes per real second (before PUBLIC_PACE) walking, at a
  // bed and asleep, and when the evening's fixed things happen. Slowed after playtesting on the
  // full floor, where the walk between beds alone takes ten seconds or more.
  const PACE = {
    walk: 0.45, pcase: 0.12, sleep: 3.6,
    quiet: 1.5,             // nobody waiting: the evening moves on faster
    dinnerAt: 12 * 60,
    spoilAt: 14 * 60,       // the bento goes sour after two o'clock      // lunch reaches the pantry
    lightsOut: 99 * 60,     // never: the clinic keeps its lights on
    dinnerCut: 0.5,         // the dinner call rings when half the bento is gone, give or take
  };
  // tonight's dinner patient, set when the night is drawn (startPublicNight)
  const night = { dinner: null };
  // blood results come back this many game minutes after the draw
  const LAB_WAIT = 30, PTA_WAIT = 10;   // 加做檢查 / 純音聽力報告（game minutes）
  // everything about tonight: the clock, the doctor's needs, the calls, the counts for the summary
  const S = {
    started: false, mode: 'walk', map: false, t: START,
    energy: 82, full: 35, bladder: 20, eaten: 0, cold: false, interrupted: true, interruptAt: PACE.dinnerCut + Math.random() * 0.2, labs: [],
    calls: {}, current: null, ended: false, paused: false,
    pgy: 'm', shift: 'normal', duty: true, snacks: 3, drinks: 0,
    complaints: 0, favors: {}, favorHit: {}, favBonus: {}, special: null, susp: {}, arrived: [], late: {}, outcome: {}, colleague: 100, colleagueGone: false, intern: null, sched: null, plog: [],
    stats: { transferred: 0, arranged: 0, callsIn: 0, wakeups: 0, sleptMin: 0, wentFine: 0, phoned: 0, ignoredFine: 0, unanswered: 0, worsened: 0 },
    sleepStart: 0, nextCallAt: Infinity, call: null,
  };
  // the portraits: placeholders drawn by tools/make-placeholders.mjs. Put your own art in
  // assets/game/char/ under the same names; if it is .png, change .svg here and in index.html
  const IMG = n => `assets/game/char/${n}.svg`;
  const ME = e => IMG(`pgy_${S.pgy}_${e}`);
  const activeIds = () => Object.keys(S.calls).filter(id => S.calls[id].state === 'active');
  const preload = () => ['worried', 'panic', 'relieved', 'annoyed', 'thankful', 'sleepy', 'caring', 'stern', 'holding_laugh', 'shocked']
    .map(e => `nurse_${e}`)
    .concat(['nervous', 'sleepy', 'eating', 'scolded', 'confident', 'survived'].map(e => `pgy_${S.pgy}_${e}`))
    .forEach(n => { const i = new Image(); i.src = IMG(n); });

  // ---------- markers ----------
  const marks = $('marks');
  const mk = (cls, html) => { const d = document.createElement('div'); d.className = `mk ${cls}`; d.innerHTML = html; marks.appendChild(d); return d; };
  const caseMarks = {}, edges = {};
  function markFor(id) {
    if (!caseMarks[id]) {
      const c = CASES[id];
      caseMarks[id] = mk(c.level, `<span class="bang">!</span><span class="lbl">${BL(c.bed)}</span>`);
      const d = document.createElement('div'); d.className = `edge ${c.level}`; d.innerHTML = `<i></i>${BL(c.bed)}`; d.hidden = true; marks.appendChild(d); edges[id] = d;
    }
    return caseMarks[id];
  }
  const bedTags = [];   // the booths are labelled from the corridor instead (roomTags)
  const roomTags = [
    ...ROOMS.map(r => ({ p: new THREE.Vector3(r.door, 1.45, ZCS), el: mk('tag', `<span class="lbl">聽力室 ${r.n}</span>`) })),
    ...SOUTH.map(r => ({ p: new THREE.Vector3(r.door, 1.45, ZFC), el: mk('tag', `<span class="lbl">${r.n}</span>`) })),
  ];
  const placeTags = [
    { p: new THREE.Vector3(2.85, 1.35, 6.3), el: mk('tag dimlbl', '<span class="lbl">電話</span>'), near: 5 },
    { p: new THREE.Vector3(5.95, 1.2, 5.6), el: mk('tag dimlbl', '<span class="lbl">點心</span>'), near: 5 },
    { p: new THREE.Vector3(-11.7, 2.1, 5.9), el: mk('tag dimlbl', '<span class="lbl">飲水機</span>'), near: 5 },
  ];
  const bentoTag = mk('tag', '<span class="lbl">便當</span>');
  const waitTags = WAIT_SEATS.map(() => { const t = mk('tag', '<span class="lbl"></span>'); t.hidden = true; return t; });
  const zzz = mk('zzz', 'Z z z'); zzz.hidden = true;
  const prompt = document.createElement('div'); prompt.className = 'mk';
  prompt.innerHTML = '<span class="prompt"><span class="key" id="promptKey">E</span><span id="promptText"></span></span>'; prompt.hidden = true; marks.appendChild(prompt);
  const v3 = new THREE.Vector3();
  const project = p => { v3.copy(p).project(cam); return v3; };
  const setPos = (el, v) => { el.style.left = `${((v.x + 1) / 2 * 100).toFixed(2)}%`; el.style.top = `${((1 - v.y) / 2 * 100).toFixed(2)}%`; };

  // ---------- HUD ----------
  const fmt = t => { const m = Math.floor(t) % 1440, h = Math.floor(m / 60), mm = m % 60; return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
  function setMeter(id, v, warnAt, badAt, invert) {
    const el = $(id); el.style.width = `${Math.max(2, Math.min(100, v))}%`;
    const bad = invert ? v > badAt : v < badAt, warn = invert ? v > warnAt : v < warnAt;
    el.className = bad ? 'bad' : warn ? 'warn' : '';
  }
  // a patient's marker is red, a small call walked to anyway amber
  const levelOf = id => S.calls[id]?.lvl || CASES[id].level;
  let hudTimer = 0, lastCallsHtml = '';
  function renderHud() {
    $('clock').textContent = fmt(S.t);
    const toOff = OFF - S.t;
    $('untilHandover').textContent = (toOff > 0 ? `距離下班 ${Math.floor(toOff / 60)} 小時 ${Math.floor(toOff % 60)} 分` : `加班中 ${Math.round(-toOff)} 分`) + ` · 投訴 ${S.complaints}`;
    setMeter('mEnergy', S.energy, 40, 20); $('tEnergy').textContent = `${Math.round(S.energy)}%`;
    setMeter('mFull', S.full, 40, 20); $('tFull').textContent = S.eaten >= 100 ? '吃飽了' : S.eaten > 0 ? `吃了 ${Math.round(S.eaten)}%` : '沒吃午餐';
    $('mIntRow').hidden = !S.intern;
    if (S.intern) { setMeter('mInt', S.intern.energy, 40, 20); $('tInt').textContent = S.intern.gone ? '已下班' : S.intern.brk ? `休息中 ${Math.round(S.intern.energy)}%` : `${Math.round(S.intern.energy)}%`; }
    $('btnInt').hidden = !S.intern;
    setMeter('mColl', S.colleague, 40, 20); $('tColl').textContent = S.colleagueGone ? '已下班' : S.colleagueBreak ? `休息中 ${Math.round(S.colleague)}%` : `${Math.round(S.colleague)}%`;
    setMeter('mBladder', S.bladder, 70, 85, true); $('tBladder').textContent = `${Math.round(S.bladder)}%`;
    const active = activeIds().sort((a, b) => (levelOf(a) === 'red' ? 0 : 1) - (levelOf(b) === 'red' ? 0 : 1) || S.calls[a].since - S.calls[b].since);
    const callsHtml = `<header>待處理 <b>${active.length}</b></header>` + (active.length
      ? `<ol>${active.map(id => { const c = CASES[id]; return `<li class="${levelOf(id)}"><b>${BL(c.bed)}</b><span>${c.short}</span><time>${Math.max(0, Math.round(S.t - S.calls[id].since))} 分鐘 · ${S.calls[id].prio ? '已安排' : '候診中'}</time></li>`; }).join('')}</ol>`
      : '<p class="empty">目前沒有人找你。</p>')
      + (S.labs.some(l => !l.seen) ? `<header class="labhead">檢查報告</header><ol class="labs">${S.labs.map((l, i) => (l.seen ? '' : l.ready
        ? `<li class="lab ready" data-lab="${i}"><b>${BL(l.bed)}</b><span>${l.kind === 'pta' ? '純音聽力報告' : '加做檢查報告'}出來了</span><time>點一下查看</time></li>`
        : `<li class="lab"><b>${BL(l.bed)}</b><span>${l.kind === 'pta' ? '純音聽力報告印製中' : '加做檢查中'}</span><time>約 ${Math.max(1, Math.ceil(l.readyAt - S.t))} 分鐘後出來</time></li>`)).join('')}</ol>` : '');
    // rebuilt only when it changes, so a lab result is still there when the click lands
    if (callsHtml !== lastCallsHtml) { lastCallsHtml = callsHtml; $('calls').innerHTML = callsHtml; }
    $('goal').innerHTML = goalText();
  }
  function goalText() {
    if (S.mode === 'sleep' || S.mode === 'scall') return '睡覺中……按 <b>E</b> 起床';
    if (S.mode === 'eat') return '吃飯中…能吃幾口算幾口';
    if (S.mode === 'toilet') return '上廁所中…';
    const active = activeIds();
    const red = active.find(id => levelOf(id) === 'red');
    if (red) return `先去 <b>${BL(CASES[red].bed)}</b>：${CASES[red].short}`;
    if (S.energy < TIRED) return '精力不到 20%，跑不動了。快去<b>辦公室</b>躺一下，歸零就會累倒';
    if (active.length) return `再去 <b>${CASES[active[0]].bed}</b>：${CASES[active[0]].short}`;
    if (S.bladder >= 85) return '快憋不住了，去<b>廁所</b>';
    if (S.eaten < 100) return S.eaten > 0 ? '午餐還沒吃完，回<b>茶水間</b>把它吃掉（已經涼了）' : '趁現在沒人找，去<b>茶水間</b>吃午餐';
    if (S.energy < 70) return '精力快沒了，去<b>辦公室</b>的折疊床上小憩一下';
    return '診間暫時安靜了，去<b>辦公室</b>歇一下吧，17:30 才下班';
  }
  let toastTimer = 0;
  function toast(text, secs = 4, avatar) {
    $('toastText').innerHTML = text;
    const av = $('toastAvatar');
    if (avatar) { av.style.backgroundImage = `url(${IMG(avatar)})`; av.hidden = false; $('toast').classList.add('soft'); }
    else { av.hidden = true; $('toast').classList.remove('soft'); }
    $('toast').hidden = false; toastTimer = secs;
  }

  // ---------- interactions ----------
  function nearest() {
    if (S.mode !== 'walk') return null;
    const p = player.position;
    let best = null, bd = 1e9;
    for (const id of activeIds()) {
      const c = CASES[id], [tx, tz] = SPOT.touch(BED[c.bed]), d = Math.hypot(p.x - tx, p.z - tz);
      if (d < 1.6 && d < bd) {
        bd = d;
        best = { kind: 'case', id, key: 'E', label: `看病人（${BL(c.bed)}）` };
      }
    }
    // from the waiting-area bench: call the longest-waiting patient in (E)
    for (const seat of WAIT_SEATS) {
      const d = Math.hypot(p.x - seat[0], p.z - seat[1]);
      if (d < 2.2 && d < bd) {
        const w = Object.keys(S.calls).filter(id => isPatient(id) && S.calls[id].state === 'active' && !S.calls[id].opened).sort((a, b) => S.calls[a].since - S.calls[b].since)[0];
        if (w) { bd = d; best = { kind: 'case', id: w, key: 'E', label: `請病人進診間（${PCASE[w].short}）` }; }
      }
    }
    if (S.eaten < 100 && S.t >= PACE.dinnerAt) { const d = Math.hypot(p.x - ONCALL.eatAt[0], p.z - ONCALL.eatAt[1]); if (d < 1.3 && d < bd) { bd = d; best = S.t >= PACE.spoilAt ? { kind: 'sour', key: 'E', label: '便當（臭酸了）' } : { kind: 'eat', key: 'E', label: S.eaten > 0 ? '把便當吃完' : '吃便當' }; } }
    if (S.bladder > 15) { const d = Math.hypot(p.x - ONCALL.toiletAt[0], p.z - ONCALL.toiletAt[1]); if (d < 0.9 && d < bd) { bd = d; best = { kind: 'toilet', key: 'E', label: '上廁所' }; } }
    // the bed takes the doctor however full the bar is: sleep no longer ends when it fills
    {
      const [x0, z0, x1, z1] = ONCALL.bed, d = Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(z0 - p.z, 0, p.z - z1));
      if (d < 0.95 && d < bd) { bd = d; best = { kind: 'sleep', key: 'E', label: '躺一下' }; }
    }
    // the office phone (where the calls land), the snack table and the pantry's water dispenser
    for (const [kind, at, r, label] of [['phone', ONCALL.phoneAt, 1.0, '看電話留言'],
        ['snack', ONCALL.snackAt, 0.9, S.snacks > 0 ? `吃點心（剩 ${S.snacks} 份）` : null], ['water', ONCALL.waterAt, 0.9, '裝水喝（E）／沖咖啡（C）']]) {
      const d = Math.hypot(p.x - at[0], p.z - at[1]);
      if (label && d < r && d < bd) { bd = d; best = { kind, key: 'E', label }; }
    }
    if (!best) {
      let td = 1e9;
      for (const t of talkers()) {
        const d = Math.hypot(p.x - t.obj.position.x, p.z - t.obj.position.z);
        if (d < t.reach && d < td) { td = d; best = { kind: 'chat', key: 'E', label: `跟${t.name || CHATTER[t.key].name}聊聊`, talker: t }; }
      }
    }
    return best;
  }

  function act() {
    if (!S.started || S.ended) return;
    if (S.mode === 'walk') {
      const n = nearest(); if (!n) return;
      if (n.kind === 'case') openCase(n.id);
      else if (n.kind === 'eat') startEat();
      else if (n.kind === 'sour') toast('便當臭酸了不能吃。', 3);
      else if (n.kind === 'sleep') startSleep();
      else if (n.kind === 'toilet') useToilet();
      else if (n.kind === 'phone') usePhone();
      else if (n.kind === 'snack') eatSnack();
      else if (n.kind === 'water') drinkWater();
      else if (n.kind === 'chat') openChat(n.talker);
      return;
    }
    if (S.mode === 'eat') { stopEat('先不吃了，便當放著。'); return; }
    if (S.mode === 'sleep') { stopSleep('自己醒來了。'); return; }
    if (S.mode === 'false') closeScripted();
    if (S.mode === 'chat') closeChat();
  }
  function spawnCase(id, late = 0) {
    const c = CASES[id];
    S.calls[id] = { state: 'active', since: S.t - late };
    ensureNurse(c.bed).userData.chatName = c.nurse; markFor(id);
    if (TEX[c.bed] && monitors[c.bed]) { monitors[c.bed].material.map = TEX[c.bed][0]; monitors[c.bed].material.needsUpdate = true; }
  }
  function resolve(id, stable = true) {
    const c = CASES[id], call = S.calls[id];
    if (call.state === 'done') return;
    call.state = 'done'; call.at = S.t; call.stable = stable;
    lamps[c.bed].material = lampOff;
    if (stable && TEX[c.bed] && monitors[c.bed]) { monitors[c.bed].material.map = TEX[c.bed][1]; monitors[c.bed].material.needsUpdate = true; }
    const m = markFor(id); m.className = 'mk done'; m.innerHTML = `<span class="bang">${stable ? '✓' : '…'}</span>`;
    call.flashUntil = performance.now() + 2500;
  }

  // a bed: a small call walked to anyway plays a short scene; a patient opens the choices
  function openCase(id) {
    if (CASES[id].kind === 'false') openScripted(id);
    else openPublicCase(id);
  }
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  // a nurse rings again for a patient nobody came to: wakes the doctor, puts the bento down
  function ring(c, face, text, note) {
    if (S.mode === 'sleep') { stopSleep(); S.stats.wakeups++; }
    if (S.mode === 'eat') stopEat();
    S.mode = 'recall'; prompt.hidden = true;
    $('recallPic').src = IMG(`nurse_${face}`);
    $('recallMe').src = ME('nervous');
    $('recallBed').textContent = `${BL(c.bed)} · 護士${c.nurse}`;
    $('recallText').textContent = `聽力師！${BL(c.bed)} ${text}`;
    $('recallNote').textContent = note;
    $('recall').hidden = false;
  }
  $('recallGo').addEventListener('click', () => {
    $('recall').hidden = true;
    S.mode = 'walk'; frame.focus();
  });

  // calls that were fine all along: a short scripted exchange
  function openScripted(id) {
    const c = CASES[id];
    S.mode = 'false'; S.current = id; prompt.hidden = true;
    $('dPortrait').src = IMG(`nurse_${c.face}`);
    $('dSpeaker').textContent = `護士 ${c.nurse}`;
    $('dLine').innerHTML = c.line;
    $('dMe').src = ME('sleepy');
    $('dialog').hidden = false;
    S.stats.wentFine++;
    resolve(id, true);
  }
  function closeScripted() {
    $('dialog').hidden = true; S.mode = 'walk'; S.current = null; frame.focus();
    toast('白跑一趟。電話交代就好的事，其實不用跑。', 3);
  }
  $('dBack').addEventListener('click', () => (S.mode === 'chat' ? closeChat() : closeScripted()));

  // ---------- small talk ----------
  // E beside anyone on the ward. A line fits the hour and the doctor (hungry, worn out, bursting);
  // a gift (a snack, a coffee) is given once a night; lines do not repeat until all have been said.
  const DBACK = $('dBack').innerHTML, said = {};
  let talking = null;
  function talkers() {
    const beds = Object.entries(nurseByBed).filter(([bed, n]) => n.visible && n.userData.chatName && !activeIds().some(id => CASES[id].bed === bed))
      .map(([bed, n]) => ({ key: 'bed', id: `bed-${bed}`, name: n.userData.chatName, obj: n, reach: 1.3 }));
    return [...TALKERS.filter(t => t.obj.visible), ...beds];
  }
  function openChat(t) {
    const who = CHATTER[t.key], id = t.id || t.key, name = t.name || who.name;
    const s = { morning: S.t < 12 * 60, afternoon: S.t >= 12 * 60 && S.t < 15 * 60 + 30, late: S.t >= 15 * 60 + 30,
      hungry: S.eaten < 100 && S.t >= PACE.dinnerAt, tired: S.energy < 45, needLoo: S.bladder >= 70 };
    S.gifts = S.gifts || {};
    const heard = (said[id] = said[id] || new Set());
    let fit = who.lines.map((l, i) => [l, i]).filter(([l]) => (!l.when || l.when(s)) && !(l.gift && S.gifts[id]));
    if (!fit.length) fit = [[who.lines[0], 0]];
    if (fit.every(([, i]) => heard.has(i))) fit.forEach(([, i]) => heard.delete(i));
    const fresh = fit.filter(([, i]) => !heard.has(i)), first = fresh.filter(([l]) => l.pri);
    const [line, i] = pickN(first.length ? first : fresh, 1)[0];
    heard.add(i);
    talking = t; S.mode = 'chat'; S.current = null; prompt.hidden = true; keys.clear();
    // a walker stops and turns to the doctor; the doctor turns to them
    const o = t.obj, p = player.position;
    if (t.walker) { t.walker.wait = 1e9; o.rotation.y = Math.atan2(p.x - o.position.x, p.z - o.position.z); }
    player.rotation.y = Math.atan2(o.position.x - p.x, o.position.z - p.z);
    $('dPortrait').closest('figure').hidden = !who.faces.length;
    if (who.faces.length) $('dPortrait').src = IMG(pickN(who.faces, 1)[0]);
    $('dSpeaker').textContent = `${who.role} ${name}`;
    $('dLine').textContent = line.text;
    $('dMe').src = ME(S.energy < 45 ? 'sleepy' : 'neutral');
    const teach = t.key === 'jingyi' && !S.intern && !S.taught;
    $('dBack').innerHTML = teach ? '有空再說 <span class="key">E</span>' : DBACK;
    $('dTeach').hidden = !teach;
    $('dialog').hidden = false;
    const g = line.gift;
    if (g) {
      S.gifts[id] = true;
      S.full = Math.min(100, S.full + (g.full || 0)); S.energy = Math.min(100, S.energy + (g.energy || 0)); S.bladder = Math.min(100, S.bladder + (g.bladder || 0));
      toast(g.toast, 3.5, who.faces[0]);
    }
  }
  // 敏心: teach her and she becomes a second pair of hands (same as the colleague: takes calls, tires, rests)
  function teachIntern() {
    if (S.intern || !talking) return;
    S.taught = true; S.t += 30; S.energy = Math.max(0, S.energy - 30);
    S.intern = { energy: 100, gone: false, brk: null, readyAt: 0 };
    $('dLine').textContent = '好的學姊！我用心記下來了，接下來的電話和小事交給我。';
    $('dTeach').hidden = true; $('dBack').innerHTML = '加油 <span class="key">E</span>';
    toast('教學花了 30 分鐘，精力 −30。敏心變成熟練的實習聽力師，可以幫忙接電話了。', 6, 'nurse_thankful');
    plog('教學敏心：花 30 分鐘，精力 −30，她能幫忙了', 'ok');
    S.stats.taught = true;
  }
  $('dTeach').addEventListener('click', teachIntern);
  function closeChat() {
    $('dTeach').hidden = true;
    $('dialog').hidden = true; $('dPortrait').closest('figure').hidden = false; $('dBack').innerHTML = DBACK;
    if (talking?.walker) talking.walker.wait = 0.6 + Math.random();
    talking = null; S.mode = 'walk'; S.t += 2; frame.focus();
  }
  // ---------- eating ----------
  function startEat() {
    S.mode = 'eat'; prompt.hidden = true;
    player.visible = false; playerSit.visible = true;
    $('eatMe').src = ME('eating');
    $('eatTitle').textContent = S.cold ? '排骨便當 · 涼掉了' : '排骨便當 · 還溫的';
    $('eat').hidden = false;
  }
  function stopEat(msg) {
    S.mode = 'walk'; $('eat').hidden = true;
    playerSit.visible = false; player.visible = true; place(player, ...ONCALL.stand, 0);
    if (msg) toast(msg, 2.5);
  }
  function spawnDinnerCall(late) {
    const id = night.dinner;
    S.stats.callsIn++; spawnCase(id, late ? 6 : 0);
    S.calls[id].said = publicText(id).replace(/^聽力師[！，]\S+ (?:的)?/, ''); S.calls[id].saidAt = S.t;
    plog(`電話：${BL(CASES[id].bed)} ${CASES[id].short}（午餐吃到一半）`, 'warn');
  }
  $('iGo').addEventListener('click', () => { $('interrupt').hidden = true; S.cold = true; stopEat(); spawnDinnerCall(false); toast(`${BL(CASES[night.dinner].bed)} ${CASES[night.dinner].short}，快去！`, 3); frame.focus(); });
  $('iBite').addEventListener('click', () => {
    $('interrupt').hidden = true; S.eaten = Math.min(100, S.eaten + 15); S.energy = Math.min(100, S.energy + 5); S.full = Math.max(S.full, 12 + S.eaten * 0.85); S.cold = true;
    stopEat(); spawnDinnerCall(true); toast('護士又打來了：「聽力師你人呢？！」', 3.5); frame.focus();
  });

  // ---------- lab results ----------
  // Blood drawn at a bed comes back LAB_WAIT game minutes later. The results sit in the call list
  // (and behind the bed's 檢驗報告 button) until the doctor opens them.
  function labsArrive() {
    for (const lab of S.labs) {
      if (lab.ready || S.t < lab.readyAt) continue;
      lab.ready = true;
      toast(lab.kind === 'pta' ? `${BL(lab.bed)} 的純音聽力報告出來了，回到診間按「看報告」才能繼續。` : `${BL(lab.bed)} 的加做檢查報告出來了${S.mode === 'pcase' ? '，按右上角「檢查報告」查看' : '，在 call 欄點一下查看'}。`, 4);
    }
    publicLabButton();
  }
  function openLab(i) {
    const lab = S.labs[i];
    if (!lab || !lab.ready) return;
    const first = !lab.seen;
    lab.seen = true;
    if (first && lab.kind === 'extra' && PCASE[lab.id]?.labs?.special && !S.special) specialEnding(lab);
    $('glabTitle').textContent = `${BL(lab.bed)} ${lab.kind === 'pta' ? '純音聽力報告' : '加做檢查報告'}`;
    $('glabWhen').textContent = `${fmt(lab.at)} ${lab.kind === 'pta' ? '檢查' : '加做'} · ${fmt(lab.readyAt)} 回報`;
    const tbody = $('glabRows'); tbody.replaceChildren();
    let group = '';
    for (const r of lab.rows) {
      if (r.group !== group) { group = r.group; tbody.insertAdjacentHTML('beforeend', `<tr class="lab-group"><th colspan="4">${esc(group)}</th></tr>`); }
      const value = typeof r.value === 'number' ? String(Math.round(r.value * 1000) / 1000) : r.value;
      if (Array.isArray(r.value)) {
        tbody.insertAdjacentHTML('beforeend', `<tr><td>${esc(r.label)}</td><td>${r.value.map(([v, ear]) => `<span class="ear-${ear === 'R' ? 'r' : 'l'}">${esc(ear)}-${esc(v)}</span>`).join('　')}</td><td>${esc(r.unit)}</td><td>${esc(r.ref ?? '')}</td></tr>`);
        continue;
      }
      tbody.insertAdjacentHTML('beforeend', `<tr class="${r.flag ? `lab-flag-${r.flag === 'U' ? 'h' : r.flag.toLowerCase()}` : ''}"><td>${esc(r.label)}</td><td>${esc(value)}${r.flag && r.flag !== 'U' && r.flag !== 'A' ? ` ${r.flag}` : ''}</td><td>${esc(r.unit)}</td><td>${esc(r.ref ?? '')}</td></tr>`);
    }
    // each sheet comes with what the numbers mean (the bed's labs.note in public-cases.js)
    $('glabFoot').textContent = lab.rows.some(r => Array.isArray(r.value)) ? 'R＝右耳（紅色）、L＝左耳（藍色）。僅供判讀練習，結果要由專業人員解讀。' : 'H／L：高於／低於一般參考範圍，僅供判讀練習，結果要由專業人員解讀。';
    $('glabNote').hidden = !lab.note; $('glabNote').textContent = lab.note || '';
    $('glab').hidden = false;
    if (S.mode === 'walk') S.mode = 'lab';
    publicLabButton(); renderHud();
  }
  // a report that turns out to hold a special ending (the acoustic neuroma behind a sudden hearing loss)
  function specialEnding(lab) {
    const sp = PCASE[lab.id].labs.special;
    S.special = sp; S.favBonus[lab.id] = sp.favor;
    if (S.favors[lab.id] != null) S.favors[lab.id] = Math.min(100, S.favors[lab.id] + sp.favor);
    plog(sp.tip, 'best'); toast(sp.toast, 7, 'nurse_thankful');
  }
  function closeLab() {
    $('glab').hidden = true;
    if (S.mode === 'lab') S.mode = 'walk';
    frame.focus();
  }
  $('glabClose').addEventListener('click', closeLab);
  $('calls').addEventListener('pointerdown', e => { const li = e.target.closest('[data-lab]'); if (li) openLab(Number(li.dataset.lab)); });

  // ---------- the toilet ----------
  function useToilet() {
    S.mode = 'toilet'; prompt.hidden = true; player.visible = false;
    toast('上廁所中……', 2);
    setTimeout(() => {
      if (S.mode !== 'toilet') return;
      S.bladder = 0; S.mode = 'walk'; player.visible = true;
      place(player, ...ONCALL.toiletOut, Math.PI / 2);
      toast('上完廁所，舒服多了。', 2.5);
    }, 2200);
  }

  // ---------- the office phone, the snack table, the water dispenser ----------
  // Calls ring on the office phone: its lamp glows while anyone is waiting (see runFrame). Snacks
  // and water are small, quick ways to get through the shift; talking all day is hard on the throat.
  function usePhone() {
    const ids = activeIds();
    if (!ids.length) { toast('電話很安靜。有人找你的時候，這裡的燈會亮。', 2.5); return; }
    const c = CASES[ids[0]];
    toast(`電話留言：${BL(c.bed)}　${c.short}（護士${c.nurse}）`, 3.5);
  }
  function drinkCoffee() {
    S.t += 2; S.energy = Math.min(100, S.energy + 10); S.bladder = Math.min(100, S.bladder + 8);
    toast('沖了一杯咖啡，精神好多了。喝多了會想上廁所。', 3);
  }
  function eatSnack() {
    if (S.snacks <= 0) return;
    S.snacks--; S.t += 2; S.full = Math.min(100, S.full + 8); S.energy = Math.min(100, S.energy + 4);
    toast(S.snacks ? `吃了一塊餅乾，還剩 ${S.snacks} 份。` : '最後一份點心吃掉了。', 2.5);
  }
  function drinkWater() {
    S.t += 1; S.drinks++; S.energy = Math.min(100, S.energy + 3); S.bladder = Math.min(100, S.bladder + 5);
    toast(S.drinks > 4 ? '裝水喝了一杯。喝這麼多，等一下要跑廁所了。' : '裝了水喝一杯，喉嚨舒服多了。', 2.5);
  }

  // ---------- sleeping and the calls that wake you ----------
  function startSleep() {
    S.mode = 'sleep'; prompt.hidden = true;
    place(player, ...ONCALL.wake, 0); player.visible = false;
    sleepers[S.pgy].visible = true; bl1.visible = false; sleepBlanket.visible = true;
    S.sleepStart = S.t; S.fullNoted = S.energy >= 100;
    $('sleepMe').src = ME('sleepy');
    // lying down after lights out: the night's next call is never far off
    if (S.pq?.length && S.t >= S.nightAt) S.nextCallAt = Math.min(S.nextCallAt, S.t + 20 + Math.random() * 15);
    $('sleep').hidden = false;
  }
  function stopSleep(msg) {
    S.mode = 'walk'; $('sleep').hidden = true;
    sleepers[S.pgy].visible = false; bl1.visible = true; sleepBlanket.visible = false;
    player.visible = true; place(player, ...ONCALL.wake, 0);
    if (msg) toast(msg, 2.5);
  }
  // every call card has the same three answers (see publicAnswer)
  $('scGo').addEventListener('click', () => { if (!$('scall').hidden) publicAnswer('go'); });
  $('scPhone').addEventListener('click', () => { if (!$('scall').hidden) publicAnswer('phone'); });
  $('scSleep').addEventListener('click', () => { if (!$('scall').hidden) publicAnswer('sleep'); });

  // ---------- the night's patients ----------
  // 17:00 to 08:00, for someone who has never been on call. A few patients a night, in a random
  // order: one interrupts dinner, the others ring through the evening and the night. Between them
  // the phone rings for things that need nobody at the bed -- the point is what it is like to be
  // woken for each of them anyway. A call answered but left waiting too long rings again, worse.
  // Each bed is a short script of choices (public-cases.js): the wrong choices make the patient
  // worse, enough of them stop his heart (or, for a stroke, cost him the window), and chest
  // compressions to the beat are the last chance.
  const PCASE = Object.fromEntries(PUBLIC_CASES.map(c => [c.id, c]));
  // order: the shuffled choices of the question on screen (orderFor), by position on screen
  const PC = { id: null, step: null, state: 'start', extra: null, danger: 0, off: new Set(), log: [], warned: false, cpr: null, done: false, outcome: null, snap: null, order: null, orderFor: null, v2: false, pat: 100, fav: 0, endText: null, waitReport: null };
  const plog = (text, kind = '') => S.plog.push({ t: S.t, text, kind });
  const publicText = id => PCASE[id].call.replace('{bed}', BL(CASES[id].bed));
  // A patient's call looks like any other call: the same three answers, 電話交代 included, and
  // the same faces on the card. Only what the nurse says tells them apart -- the point of the night.
  const realCall = c => ({ id: c.id, caseId: c.id, urgent: true, short: c.short, bed: c.bed, text: c.call, phone: c.phone });
  // the night's phone queue waits for lights out; a call put off rings again sooner
  const nextPublicCall = () => { S.nextCallAt = S.pq.length ? Math.max(S.nightAt, S.t + 30 + Math.random() * 20) : Infinity; };
  function groggy() { frame.classList.remove('groggy'); void frame.offsetWidth; frame.classList.add('groggy'); }
  // on a touch screen the controls are the stick and the buttons on it, so say those instead of keys
  if (matchMedia('(pointer: coarse)').matches) {
    $('gKeys').innerHTML = '<dt><span class="key">搖桿</span></dt><dd>左下角：大拇指在哪裡按下，搖桿就跟到哪裡；往任何方向滑就會走，推到底用跑的</dd>'
      + '<dt><span class="key">E</span></dt><dd>右下角：看病人、吃便當、上床睡覺、上廁所（走近就會出現提示）</dd>'
      + '<dt><span class="key">床邊</span></dt><dd>在床邊直接點你要做的事</dd>'
      + '<dt><span class="key">右上</span></dt><dd>暫停、全景（看整個聽力中心）、下班</dd>';
    document.querySelector('#brief .bkeys').innerHTML = '<div><span class="key">搖桿</span>走路，推到底跑</div><div><span class="key">E</span>看病人、吃、睡、廁所</div>'
      + '<div class="wide"><span class="key">床邊</span>點選項；心跳停了，照節拍點「壓胸」</div>'
      + '<div class="wide"><span class="key">右上</span>暫停、全景（看整個聽力中心）、下班</div>';
  }
  // ---------- the day: patients arrive, the phone rings ----------
  // Patients come to the waiting area on a schedule (see startDay); their patience runs down while
  // they wait. The office phone rings with small things and urgent ones, and every call has the same
  // three answers: 馬上安排 / 讓他等 / 轉給同事. Only what the caller says tells you which is which.
  const CALLS = Object.fromEntries(PHONE_CALLS.map(c => [c.id, c]));
  const OFF = 17 * 60 + 30;   // the clinic closes; patients still here mean overtime until END
  // the waiting area is patient for a long time: another patient may be in the booth for half an hour
  const WAIT_SCALE = 2.5;
  const patienceOf = id => (PCASE[id].patience || 40) * WAIT_SCALE * (S.calls[id]?.prio ? 3 : 1);
  const isPatient = id => CASES[id]?.kind === 'public';
  function freeRoom() {
    const used = Object.keys(S.calls).filter(id => S.calls[id].state === 'active' && isPatient(id)).map(id => CASES[id].bed);
    return ['01', '02', '03'].find(r => !used.includes(r)) || pickN(['01', '02', '03'], 1)[0];
  }
  // a patient reaches the waiting area (prio: an urgent call was answered with 馬上安排)
  function arrive(id, prio = false) {
    if (S.calls[id] || !PCASE[id]) return;
    const c = PCASE[id];
    CASES[id] = { bed: freeRoom(), kind: 'public', level: 'red', nurse: c.nurse, short: c.short };
    spawnCase(id);
    S.calls[id].prio = prio; S.arrived.push(id);
    toast(prio ? `${c.short}已安排，排在目前這位之後。` : `候診區來了一位：${c.short}`, 4);
    plog(`${prio ? '安排進來' : '到院'}：${c.who}`, prio ? 'best' : '');
  }
  // who can take a call: the colleague, or 敏心 once she is taught; the one with more energy goes first
  const intFree = () => S.intern && !S.intern.gone && !S.intern.brk;
  const colFree = () => !S.colleagueGone && !S.colleagueBreak;
  const helperFree = () => colFree() || intFree();
  function helperHit(n, zero) {   // spend n of a free helper's energy (zero: all of them)
    const useInt = intFree() && (!colFree() || S.intern.energy > S.colleague);
    if (zero) { S.colleague = 0; S.colleagueBreak = null; if (S.intern) { S.intern.energy = 0; S.intern.brk = null; } }
    else if (useInt) S.intern.energy = Math.max(0, S.intern.energy - n);
    else S.colleague = Math.max(0, S.colleague - n);
    checkColleague();
    return useInt ? '敏心' : '同事';
  }
  // the colleague who takes the calls you pass on
  function checkColleague() {
    if (S.intern && !S.intern.gone && S.intern.energy < 20) { S.intern.gone = true; toast('敏心精力用完，先回去休息了。', 5); plog('敏心累壞了，先下班', 'bad'); }
    if (S.colleague < 20 && !S.colleagueGone) {
      S.colleagueGone = true;
      toast('同事精力用完，提早下班了。接下來你的精力會掉得快兩倍。', 6);
      plog('同事累壞了，提早下班', 'bad');
    }
  }
  // the colleague's energy sets the difficulty: the lower it is, the faster yours drains (x2 once they go home)
  // send the colleague for a snack and a coffee: 30 game minutes, no calls passed on, then back with energy
  const BREAK_MIN = 30, BREAK_GAIN = 35, BREAK_COOLDOWN = 60;
  function sendBreak() {
    if (!S.started || S.ended) return;
    if (S.colleagueGone) { toast('同事已經下班了。', 2.5); return; }
    if (S.colleagueBreak) { toast('同事正在休息，大概還要 ' + Math.max(1, Math.ceil(S.colleagueBreak.until - S.t)) + ' 分鐘。', 3); return; }
    if (S.breakReadyAt && S.t < S.breakReadyAt) { toast(`同事剛休息過，約 ${Math.ceil(S.breakReadyAt - S.t)} 分鐘後才能再休息。`, 3); return; }
    S.colleagueBreak = { until: S.t + BREAK_MIN, from: S.colleague };
    toast('同事去茶水間吃點心、喝咖啡了。30 分鐘內不能轉電話或請他幫忙。', 4.5);
    plog('同事去休息（吃點心、喝咖啡）');
  }
  function internBreak() {
    const I = S.intern; if (!I || !S.started || S.ended) return;
    if (I.gone) { toast('敏心已經下班了。', 2.5); return; }
    if (I.brk) { toast('敏心正在休息，大概還要 ' + Math.max(1, Math.ceil(I.brk.until - S.t)) + ' 分鐘。', 3); return; }
    if (I.readyAt && S.t < I.readyAt) { toast(`敏心剛休息過，約 ${Math.ceil(I.readyAt - S.t)} 分鐘後才能再休息。`, 3); return; }
    I.brk = { until: S.t + BREAK_MIN };
    toast('敏心去茶水間吃點心、喝咖啡了。30 分鐘內不能請她幫忙。', 4.5);
    plog('敏心去休息（吃點心、喝咖啡）');
  }
  $('btnInt').addEventListener('click', () => { internBreak(); frame.focus(); });
  $('btnBreak').addEventListener('click', () => { sendBreak(); frame.focus(); });
  const spend = () => {
    const e = [S.colleagueGone ? null : S.colleague, S.intern && !S.intern.gone ? S.intern.energy : null].filter(v => v != null);
    return SPEND[S.shift] * (e.length ? 1 + (100 - Math.max(...e)) / 100 * 0.8 : 2);
  };
  // how much the patient liked it: 100, less for every wrong turn, a long wait and a phone call that cut in
  function calcFavor(id) {
    const c = PCASE[id], call = S.calls[id], waited = Math.max(0, (call?.waited || 0));
    const bonus = S.favBonus[id] || 0;
    if (c.v2) return Math.max(0, Math.min(100, bonus + Math.round((c.fav0 ?? 60) + PC.fav - 25 * Math.min(1, waited / patienceOf(id)) - (S.favorHit[id] || 0))));
    return Math.min(100, Math.max(0, bonus + Math.round(100 - PC.danger * 12 - 25 * Math.min(1, waited / patienceOf(id)) - (S.favorHit[id] || 0))));
  }
  // 08:00: draw the day. normal: 3–4 patients and 4–6 calls; hard (吃到鳳梨): 5–6 patients and 7–8 calls
  function startDay() {
    const hard = S.shift === 'hard', R = (a, b) => a + Math.random() * (b - a), T = (h, m = 0) => h * 60 + m;
    const sched = [];
    // calls: one small in the morning, an urgent at lunch, an urgent in the afternoon, a small before closing
    const small = pickN(PHONE_CALLS.filter(c => c.kind === 'small' && !c.midexam), 5), sends = pickN(PHONE_CALLS.filter(c => c.kind === 'urgent' && c.spawn), hard ? 2 : 1),
      urgent = pickN([...sends, ...(hard ? [] : PHONE_CALLS.filter(c => c.kind === 'urgent' && !c.spawn))], 2);
    // the urgent calls: normal gets one that sends a patient (random of the three) and the vendor; hard gets two that send
    const used = [];
    const add = (c, at, prefer) => { if (c) { used.push(c.id); sched.push({ type: 'call', id: c.id, at, prefer, kind: c.kind }); } };
    add(small.shift(), R(T(8, 10), T(8, 55)));
    add(small.shift(), R(T(9, 10), T(9, 55)), true);   // a second small one before ten, so the first two hours are not quiet
    add(urgent.shift(), R(T(13), T(13, 50)));
    add(urgent.shift(), R(T(14, 10), T(16)), true);
    add(small.shift(), R(T(16, 35), T(17, 15)), true);
    const extra = (hard ? 3 + Math.floor(Math.random() * 2) : Math.floor(Math.random() * 3));
    const windows = [[T(9), T(11), true], [T(11), T(12), true], [T(12), T(13)], [T(14), T(15), true], [T(15), T(16, 30), true], [T(16, 30), T(17, 25), true]];
    for (let i = 0; i < extra; i++) {
      const w = pickN(windows, 1)[0], c = small.length ? small.shift() : null;
      if (c) add(c, R(w[0], w[1]), w[2]);
    }
    // the cable can only come loose with a patient in the booth
    if (hard || Math.random() < 0.4) sched.push({ type: 'call', id: 'c_cable', at: R(T(9, 30), T(15)), midexam: true, kind: 'small' });
    // walk-in patients: 5–6 a day (hard: 7, all seven kinds that walk in). The patients an urgent call sends
    // (answered with 馬上安排) come on top and are not counted: one on normal, two on hard.
    // The 9-month-old comes at 10:00, the sudden-deafness patient early; the rest are spread evenly over morning and afternoon.
    const total = hard ? 7 : 5 + Math.floor(Math.random() * 2);
    const walkIns = total;
    sched.push({ type: 'patient', id: 'pD', at: T(10) });
    sched.push({ type: 'patient', id: 'pH', at: R(T(8, 30), T(9, 15)) });
    const others = pickN(['pA', 'pB', 'pC', 'pI', 'pJ'], walkIns - 2);
    const am = pickN([[T(9, 20), T(9, 55)], [T(10, 15), T(11)], [T(11, 10), T(11, 55)]], 3), pm = pickN([[T(13, 20), T(14, 5)], [T(14, 15), T(15)], [T(15, 10), T(15, 50)], [T(16), T(16, 45)]], 4);
    const first = Math.random() < 0.5 ? [pm, am] : [am, pm];
    const slots = []; for (let i = 0; i < 4; i++) for (const L of first) if (L[i]) slots.push(L[i]);
    others.forEach((id, i) => sched.push({ type: 'patient', id, at: R(...slots[i]) }));
    // off duty: the 12:00–13:00 calls are the colleague's
    S.sched = sched.filter(e => S.duty || e.type !== 'call' || e.at < T(12) || e.at >= T(13)).sort((a, b) => a.at - b.at).map(e => ({ ...e, done: false }));
    S.nextCallAt = Infinity;
  }
  // every frame: patients arriving, calls ringing, patients who ran out of patience going home
  function publicTick() {
    if (!S.sched || S.ended) return;
    const ok = ['walk', 'sleep', 'eat', 'pcase'].includes(S.mode) && !VRA.active && !BLK.active && !DRIP.active && !DRIP.active;
    for (const e of S.sched) {
      if (e.done || S.t < e.at) continue;
      if (e.type === 'patient') { e.done = true; arrive(e.id); continue; }
      if (!ok) break;
      if (e.midexam) { if (S.mode !== 'pcase') { if (S.t > e.at + 25) e.done = true; continue; } }
      else if (e.prefer && S.mode !== 'pcase' && S.t < e.at + 15) continue;
      e.done = true; publicCall(CALLS[e.id]); return;
    }
    for (const id of activeIds()) {
      if (!isPatient(id)) continue;
      const call = S.calls[id], c = PCASE[id];
      if (call.opened) continue;
      call.waited = S.t - call.since;
      const missed = c.deadline && S.t >= c.deadline, gone = call.waited >= patienceOf(id);
      if (!missed && !gone) continue;
      S.complaints++; S.favors[id] = 0; S.outcome[id] = 'left'; S.stats.worsened++;
      plog(missed ? `${c.name}錯過了黃金治療時間，被投訴` : `${c.name}等太久，生氣地走了，被投訴`, 'warn');
      toast(missed ? `${c.short}等太久，錯過了黃金治療時間。被投訴了。` : `${c.short}等不下去，走了。被投訴了。`, 5);
      resolve(id, false);
      return;
    }
  }
  function publicCall(sc) {
    if (!sc) return;
    if (S.mode === 'eat') stopEat();
    const asleep = S.mode === 'sleep', prev = S.mode;
    S.stats.callsIn++; if (asleep) { S.stats.wakeups++; S.energy = Math.max(0, S.energy - 3 * spend()); groggy(); }
    S.call = { ...sc, public: true, asleep, prev }; S.mode = 'scall';
    if (prev === 'pcase') $('pcase').hidden = true;
    $('scPic').src = IMG('nurse_neutral'); $('scallMe').src = ME(asleep ? 'sleepy' : 'neutral');
    $('scWhen').textContent = asleep ? `${fmt(S.t)} · 你才睡了 ${Math.round(S.t - S.sleepStart)} 分鐘` : fmt(S.t);
    $('scText').textContent = `${sc.from}：「${sc.text}」`;
    const own = sc.options;   // a call with its own three answers (see c_cable)
    $('scGo').textContent = own ? own[0].text : '馬上安排';
    $('scPhone').hidden = false; $('scPhone').textContent = own ? own[1].text : '讓他等';
    $('scSleep').hidden = false; $('scSleep').textContent = own ? own[2].text : helperFree() ? (colFree() ? '轉給同事' : '轉給敏心') : S.colleagueGone && (!S.intern || S.intern.gone) ? '同事已經下班了' : '同事休息中，不能轉';
    $('scSleep').disabled = own ? false : !helperFree();
    $('scNote').textContent = sc.note || '是小事，還是要緊事？只能從對方說的話判斷。';
    $('scall').hidden = false;
    plog(`電話：${sc.from}，${sc.short}`);
  }
  // 'go' = 馬上安排, 'phone' = 讓他等, 'sleep' = 轉給同事 (the three buttons of the call card)
  function publicAnswer(how) {
    const sc = S.call; $('scall').hidden = true; frame.focus();
    const cur = sc.prev === 'pcase' ? PC.id : null, urgent = sc.kind === 'urgent';
    if (sc.options) {
      const o = sc.options[{ go: 0, phone: 1, sleep: 2 }[how]];
      plog(`你：${o.text}`, o.good ? 'best' : 'bad');
      if (o.good) { S.t += 1; toast(o.say, 3.5, 'nurse_thankful'); }
      else {
        if (cur && PC.v2 && !PC.done) PC.pat = Math.max(0, PC.pat + (o.pat || 0));
        if (cur) S.favorHit[cur] = (S.favorHit[cur] || 0) - (o.favor || 0);
        if (o.min) S.t += o.min;
        if (o.energyTo != null) S.energy = Math.min(S.energy, o.energyTo);
        toast(o.say, 5);
      }
    } else if (how === 'sleep') {
      const who = helperHit(urgent ? 25 : 15); S.stats.transferred++;
      plog(`你：轉給${who}`, 'ok');
      toast(`${who}接下了「${sc.short}」，看起來有點累。`, 3.5);
    } else if (how === 'go') {
      plog('你：馬上安排', urgent ? 'best' : 'ok');
      if (urgent) {
        S.stats.arranged++;
        if (sc.spawn) arrive(sc.spawn, true);
        else { S.t += 5; toast('你確認授權後，把報告傳給廠商。', 3.5, 'nurse_thankful'); }
      } else {
        S.t += sc.fix || sc.midexam ? 1 : 3; S.trivial++;
        if (sc.midexam) toast('重新把耳機線插好，檢查繼續。', 3);
        else if (cur) { S.favorHit[cur] = (S.favorHit[cur] || 0) + 15; plog('為了小事打斷檢查，病人好感度下降', 'bad'); toast('為了小事打斷檢查，病人的好感度下降了。', 4); }
        else toast('這只是小事，其實可以晚點再處理。', 3);
      }
    } else {
      plog('你：讓他等', urgent ? 'bad' : 'best');
      if (urgent) { S.complaints++; S.stats.unanswered++; toast('對方很不高興：「這麼緊急你竟然讓我等？」被投訴了。', 5); }
      else {
        S.stats.ignoredFine++;
        if (sc.midexam && cur) { S.favorHit[cur] = (S.favorHit[cur] || 0) + 15; toast('耳機一直斷斷續續，病人有點不滿。', 4); }
        else toast('小事，晚點再處理沒關係。', 3);
      }
    }
    if (sc.prev === 'pcase') { S.mode = 'pcase'; $('pcase').hidden = false; renderPublicCase(); }
    else if (sc.asleep) { S.mode = 'sleep'; S.sleepStart = S.t; if (how !== 'go') setTimeout(() => { if (S.mode === 'sleep') toast(pickN(AFTER_PHONE, 1)[0], 4); }, 3200); }
    else S.mode = 'walk';
  }

  // the bed
  const say = (cls, text) => PC.log.push({ cls, text });
  const C = () => PCASE[PC.id];
  function openPublicCase(id) {
    const c = CASES[id];
    S.mode = 'pcase'; S.current = id; prompt.hidden = true; keys.clear();
    S.calls[id].waited = S.calls[id].waited ?? (S.t - S.calls[id].since);
    S.calls[id].opened = true;
    document.body.classList.add('at-bedside');
    place(player, ...SPOT.approach(BED[c.bed]), Math.PI);
    if (S.susp[id]) { Object.assign(PC, S.susp[id]); delete S.susp[id]; }
    else if (PC.id !== id || !PC.step) startPublicCase(id);
    $('pcBed').textContent = c.bed; $('pcWho').textContent = PCASE[id].who; $('pcSub').textContent = `護士${c.nurse}在旁邊等你決定`;
    $('pcase').hidden = false;
    renderPublicCase();
    frame.focus();
  }
  function startPublicCase(id) {
    const c = PCASE[id], late = !!S.late[id];
    // 「從這一床重來」 comes back to this moment
    if (PC.id !== id || !PC.snap) PC.snap = { t: S.t, energy: S.energy, plog: S.plog.length };
    Object.assign(PC, { id, step: 'first', state: late ? c.late : 'start', extra: null, danger: late ? 2 : 0, off: new Set(), log: [], orderFor: null,
      warned: late && c.late === c.warn.state, cpr: null, done: false, outcome: null, v2: !!c.v2, pat: c.pat0 ?? 100, fav: 0, endText: null, waitReport: null });
    say(late ? 'alarm' : 'nurse', `${c.nurse}：「${late ? c.introLate : c.intro}」`);
    plog(`到 ${BL(CASES[id].bed)} ${c.name}床邊`);
    $('pcNurse').src = IMG(late ? 'nurse_panic' : 'nurse_worried');
  }
  const EXTRA = { sugar: ['血糖', '還沒測'], ekg: ['心電圖', '還沒做'], breath: ['呼吸聲', '還沒聽'], urine: ['尿量', '還沒看'], skin: ['皮膚', '還沒看'],
    head: ['頭部', '還沒看'], fit: ['抽搐', '還沒計時'], temp: ['體溫', '還沒量'], rr: ['呼吸次數', '還沒數'], stool: ['大便', '還沒看'],
    rhythm: ['心律', '還沒貼 AED'] };
  function monitorHtml() {
    const c = C(), st = c.states[PC.state];
    if (c.extra && st[c.extra] !== undefined) PC.extra = st[c.extra];
    const cell = (label, value, word, cls = '') => `<div class="pc-v ${cls}"><small>${label}</small><b>${value}</b><em>${word}</em></div>`;
    const hr = st.hr === 0 ? cell('心跳', '—', '摸不到', 'bad')
      : cell('心跳', st.hr, st.hr > 120 ? '很快' : st.hr > 100 ? '偏快' : st.hr < 50 ? '很慢' : '正常', st.hr > 120 || st.hr < 50 ? 'bad' : st.hr > 100 ? 'warn' : '');
    const bp = !st.bp ? cell('血壓', '—', '量不到', 'bad')
      : cell('血壓', `${st.bp[0]}/${st.bp[1]}`, st.bp[0] < 90 ? '偏低' : st.bp[0] >= 180 ? '很高' : st.bp[0] >= 140 ? '偏高' : '正常', st.bp[0] < 90 || st.bp[0] >= 180 ? 'bad' : st.bp[0] >= 140 ? 'warn' : '');
    const sp = st.spo2 == null ? cell('血氧', '—', '測不到', 'bad')
      : cell('血氧', `${st.spo2}%`, st.spo2 < 90 ? '很低' : st.spo2 < 95 ? '偏低' : '正常', st.spo2 < 90 ? 'bad' : st.spo2 < 95 ? 'warn' : '');
    const v = PC.extra, [label, none] = EXTRA[c.extra] || ['', ''];
    const ex = v == null ? cell(label, '?', none, 'na txt')
      : c.extra === 'sugar' ? cell(label, v, v < 70 ? '太低' : v > 180 ? '偏高' : '正常', v < 70 ? 'bad' : v > 180 ? 'warn' : '')
      : cell(label, esc(v), '', `txt ${c.extraOk?.includes(v) ? '' : c.extraWarn?.includes(v) ? 'warn' : 'bad'}`);
    const patCell = c.v2 ? `<div class="pc-v ${patClass()}" id="pcPatCell"><small>耐心</small><b id="pcPat">${Math.round(PC.pat)}</b><em>${PC.pat <= 20 ? '快沒了' : PC.pat <= 50 ? '漸漸不耐' : '還可以'}</em></div>` : '';
    if (st.cells) return patCell + st.cells.map(([a, b, w, k]) => cell(a, esc(b), w || '', k || '')).join('') + cell(c.moodLabel || '狀態', esc(st.mind), '', st.calm || /^(?:放鬆|平靜|清醒|配合)/.test(st.mind) ? 'mind' : 'mind bad');
    return hr + bp + sp + ex + cell('意識', esc(st.mind), '', st.calm || /^清醒(?!，但)/.test(st.mind) ? 'mind' : 'mind bad');
  }
  function renderPublicCase() {
    const c = C();
    $('pcMonitor').innerHTML = monitorHtml();
    $('pcLog').innerHTML = PC.log.map(l => `<p class="${l.cls}">${esc(l.text)}</p>`).join('');
    $('pcLog').scrollTop = $('pcLog').scrollHeight;
    $('pcCpr').hidden = !PC.cpr; $('pcAsk').hidden = !!PC.cpr;
    publicLabButton();
    if (PC.cpr) return;
    if (PC.done) {
      $('pcQ').textContent = PC.endText || `${c.results[PC.outcome]}。`;
      $('pcOpts').innerHTML = '<button class="btn go pc-end" type="button" data-end="back">回去繼續上班</button>';
      return;
    }
    if (PC.waitReport) {
      const lab = PC.waitReport;
      if (lab.seen) PC.waitReport = null;
      else {
        $('pcQ').textContent = lab.ready ? '純音聽力報告出來了。看過報告，才能接著處理這位病人。' : `純音聽力報告印製中，約 ${Math.max(1, Math.ceil(lab.readyAt - S.t))} 分鐘後出來。你可以先去處理其他病人，之後再回來看報告。`;
        $('pcOpts').innerHTML = `<button class="btn pc-opt" type="button" data-act="leave"><span class="key">1</span><span>先離開檢查室，去處理其他病人</span></button>`
          + `<button class="btn pc-opt" type="button" data-act="view"${lab.ready ? '' : ' disabled'}><span class="key">2</span><span>${lab.ready ? '看報告' : '看報告（還沒出來）'}</span></button>`;
        PC.waitKey = `${lab.ready}|${Math.ceil(lab.readyAt - S.t)}`;
        return;
      }
    }
    const step = c.steps[PC.step];
    $('pcQ').textContent = (step.askBy?.[PC.state] || ([c.warn.state, c.late].includes(PC.state) && step.askWarn) || step.ask).replace('{sugar}', PC.extra ?? '');
    // the data lists the best answer first; each new question deals its choices in a fresh random
    // order, and keeps it while the question stays, so a crossed-out choice does not move
    if (PC.orderFor !== step) { PC.orderFor = step; PC.order = pickN(step.options.map((o, i) => i), step.options.length); }
    $('pcOpts').innerHTML = PC.order.map((oi, pos) => {
      const o = step.options[oi];
      const away = unavailable(o);
      return `<button class="btn pc-opt" type="button" data-i="${pos}"${PC.off.has(o.id) || away ? ' disabled' : ''}><span class="key">${pos + 1}</span><span>${esc(o.text)}${away ? `（${away}）` : ''}</span></button>`;
    }).join('');
  }
  // A screen that appears under a finger still tapping the compressions -- or a key still pressing
  // them -- takes no taps for a moment: on Android the next tap landed on a choice the doctor had
  // not read yet. Held elements are dimmed and ignore pointer and keyboard alike.
  const holds = new WeakMap();
  function holdTaps(el, ms) {
    holds.set(el, performance.now() + ms);
    el.classList.add('arming');
    setTimeout(() => { if (!held(el)) el.classList.remove('arming'); }, ms + 20);
  }
  const held = el => performance.now() < (holds.get(el) || 0);
  $('pcOpts').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || held($('pcOpts'))) return;
    if (b.dataset.end === 'back') closePublicCase(); else if (b.dataset.act) waitAct(b.dataset.act); else choosePublic(Number(b.dataset.i));
  });
  $('pcPause').addEventListener('click', () => setPaused(true));
  // blood tests: one draw per bed, the numbers come back LAB_WAIT game
  // minutes later in the call list and behind this button
  function publicLabButton() {
    const lab = S.labs.find(l => l.id === PC.id && l.kind === 'extra'), b = $('pcLab');
    b.hidden = !C().labs; if (b.hidden) return;
    b.textContent = !lab ? '加做檢查' : lab.ready ? (lab.seen ? '檢查報告' : '檢查報告（新）') : `報告約 ${Math.max(1, Math.ceil(lab.readyAt - S.t))} 分鐘後`;
    b.classList.toggle('go', !lab || lab.ready);
  }
  $('pcLab').addEventListener('click', () => {
    if (S.mode !== 'pcase' || PC.cpr) return;
    const k = S.labs.findIndex(l => l.id === PC.id && l.kind === 'extra'), lab = S.labs[k], c = C();
    if (lab?.ready) { openLab(k); return; }
    if (lab) { toast(`還在等報告，大約 ${Math.max(1, Math.ceil(lab.readyAt - S.t))} 分鐘後出來。`, 2.5); return; }
    say('you', '加做檢查'); plog('你：加做檢查');
    S.t += 2;
    say('nurse', `${c.nurse}：「好，我幫你排進去，結果大約 ${LAB_WAIT} 分鐘後出來，出來會通知你。」`);
    publicDraw(S.t, 'extra');
    renderPublicCase();
  });
  // a bed's one blood draw, from the button above or from a choice that draws blood as part of the
  // care (draw: true in public-cases.js); the report comes LAB_WAIT minutes after the blood was taken
  function publicDraw(at, kind = 'extra') {
    const c = C(), src = kind === 'pta' ? c.pta : c.labs;
    if (S.labs.some(l => l.id === PC.id && l.kind === kind)) return S.labs.find(l => l.id === PC.id && l.kind === kind);
    const lab = { id: PC.id, kind, bed: CASES[PC.id].bed, note: src.note, at, readyAt: at + (kind === 'pta' ? PTA_WAIT : LAB_WAIT), ready: false, seen: false,
      rows: src.rows.map(([label, value, unit, ref, flag]) => ({ group: kind === 'pta' ? '純音聽力檢查' : '加做檢查', label, value, unit, ref, flag })) };
    S.labs.push(lab); return lab;
  }
  function closePublicCase() {
    const id = PC.id;
    $('pcase').hidden = true; document.body.classList.remove('at-bedside');
    S.mode = 'walk'; S.current = null;
    place(player, ...SPOT.leave(BED[CASES[id].bed]), Math.PI / 2);
    PC.step = null; PC.snap = null;
    frame.focus();
    // never says how many are left: the doctor does not know how many beds the night holds
    toast('這位處理好了。別忘了喝水、吃東西、上廁所。', 3);
  }
  // i is the position on screen (button or key 1–4), not the option's place in the data
  function choosePublic(i) {
    if (S.mode !== 'pcase' || PC.cpr || PC.done || held($('pcOpts'))) return;
    if (PC.waitReport) { if (i <= 1) waitAct(i === 0 ? 'leave' : 'view'); return; }
    const c = C(), step = c.steps[PC.step], o = step?.options[PC.orderFor === step ? PC.order[i] : i];
    if (!o || PC.off.has(o.id) || unavailable(o)) return;
    if (c.v2) { choosePublicV2(c, o); return; }
    say('you', o.text); plog(`你：${o.text}`, o.grade);
    const began = S.t;
    S.t += o.min || 0;
    // blood taken at the start of the choice: with a choice as long as LAB_WAIT, the report is
    // back, and announced, as the next question is asked
    if (o.pta) { PC.waitReport = publicDraw(S.t, 'pta'); }
    if (o.cpr) { startCpr(); return; }
    if (o.gameover) { S.gameover = o.gameover; plog('你答應修改檢查結果', 'bad'); S.outcome[PC.id] = 'gameover'; S.favors[PC.id] = 0; endShift(); return; }
    if (o.death) { publicDeath(o.death); return; }
    if (o.say) say('nurse', o.say);
    if (o.state) PC.state = o.state;
    if (o.grade !== 'best') {
      PC.off.add(o.id);
      PC.danger += o.grade === 'ok' ? 1 : 2;
      if (o.why) say('why', o.why);
    }
    if (o.next === 'arrest' || PC.danger >= 5) { publicArrest(); return; }
    // the first warning that this is going badly (not mid-choke, which is its own question)
    if (o.grade !== 'best' && PC.danger >= 3 && !PC.warned && !o.quiet) {
      PC.warned = true; PC.state = c.warn.state;
      say('alarm', c.warn.line); plog(c.warn.log, 'warn');
      $('pcNurse').src = IMG('nurse_panic');
    }
    if (o.next === 'done') {
      PC.done = true; PC.outcome = o.outcome; S.outcome[PC.id] = o.outcome; S.favors[PC.id] = calcFavor(PC.id);
      resolve(PC.id, true); $('pcNurse').src = IMG('nurse_thankful');
      plog(c.results[o.outcome], 'best');
    } else if (o.next) PC.step = o.next;
    renderPublicCase();
  }

  // ---------- patients with a patience meter (v2 in public-cases.js) ----------
  // The patience drains with the game clock; every choice may move patience, the patient's liking,
  // the colleague's energy and the clock, and may end the visit (done / left / left and complained).
  const patClass = () => (PC.pat <= 20 ? 'bad' : PC.pat <= 50 ? 'warn' : '');
  const unavailable = o => (o.needs === 'colleague' && !helperFree() && (S.colleagueGone && (!S.intern || S.intern.gone) ? '同事已經下班了' : '同事休息中'));
  function pcPatience() {
    const el = $('pcPat'); if (!el) return;
    el.textContent = Math.round(PC.pat);
    el.parentElement.className = `pc-v ${patClass()}`;
    el.nextElementSibling.textContent = PC.pat <= 20 ? '快沒了' : PC.pat <= 50 ? '漸漸不耐' : '還可以';
    const v = $('vraPat'); if (v) v.textContent = Math.round(PC.pat);
    const w = $('blkPat'); if (w) w.textContent = Math.round(PC.pat);
    const w2 = $('dripPat'); if (w2) w2.textContent = Math.round(PC.pat);
  }
  // runs every frame at the bedside: warn at 20, go home at 0
  function patienceCheck() {
    if (!PC.v2 || PC.done) return;
    const c = C();
    if (PC.pat <= 0) {
      if (VRA.active) { vraClose(); $('pcase').hidden = false; }
      if (BLK.active) { blkClose(); $('pcase').hidden = false; }
      if (DRIP.active) { dripClose(); $('pcase').hidden = false; }
      S.complaints++;
      endV2({ end: 'fail', say: c.patOut || c.fail.text });
      return;
    }
    if (PC.pat <= 20 && !PC.warned) {
      PC.warned = true; PC.state = c.warn.state;
      say('alarm', c.warn.line); plog(c.warn.log, 'warn'); $('pcNurse').src = IMG('nurse_panic');
      if (!VRA.active && !BLK.active && !DRIP.active) renderPublicCase();
    }
    if (!VRA.active && !BLK.active && !DRIP.active) pcPatience();
  }
  // the colleague went on a break (or came back) while this question is open: redraw the choices
  function availCheck() {
    if (PC.done || PC.cpr || !PC.step) return;
    const key = C().steps[PC.step].options.map(o => unavailable(o)).join('|');
    if (PC.availKey !== key) { PC.availKey = key; renderPublicCase(); }
  }
  function applyFx(o) {
    if (o.min) S.t += o.min;
    if (o.pat != null) PC.pat = Math.max(0, Math.min(100, PC.pat + o.pat));
    if (o.favor) PC.fav += o.favor;
    if (o.colleague != null) {
      if (o.colleague === 'zero') helperHit(0, true);
      else if (o.colleague < 0) helperHit(-o.colleague);
      else S.colleague = Math.min(100, S.colleague + o.colleague);
    }
    if (o.complain) S.complaints++;
    if (o.incident) { S.stats.incidents = (S.stats.incidents || 0) + 1; plog('病安事件，補寫病安報告', 'bad'); }
    if (o.collapse) S.energy = 0;
    if (o.state) PC.state = o.state;
  }
  function endV2(o) {
    PC.done = true; PC.cpr = null;
    const ok = o.end === 'done';
    PC.outcome = ok ? (o.outcome || 'done') : 'left'; PC.endText = o.say;
    S.outcome[PC.id] = PC.outcome;
    S.favors[PC.id] = ok ? calcFavor(PC.id) : Math.min(calcFavor(PC.id), 40);
    if (!ok) S.stats.worsened++;
    if (!ok) { PC.state = o.end === 'fail' ? 'warned' : PC.state; }
    resolve(PC.id, ok);
    say('nurse', o.say);
    plog(ok ? C().results[PC.outcome] : (o.end === 'fail' ? `${C().name}離開，並被投訴` : `${C().name}離開了`), ok ? 'best' : 'bad');
    $('pcNurse').src = IMG(ok ? 'nurse_thankful' : 'nurse_panic');
    if ($('pcase').hidden === false) renderPublicCase();
  }
  function choosePublicV2(c, o) {
    say('you', o.text); plog(`你：${o.text}`, o.grade);
    if (o.minigame === 'vra') {
      $('pcase').hidden = true;
      vraStart(result => { $('pcase').hidden = false; finishV2(result === 'win' ? o.win : o.lose); });
      return;
    }
    if (o.minigame === 'block') {
      $('pcase').hidden = true;
      blkStart(result => { $('pcase').hidden = false; finishV2(result === 'win' ? o.win : o.lose); });
      return;
    }
    if (o.minigame === 'drip') {
      $('pcase').hidden = true;
      dripStart(result => { $('pcase').hidden = false; finishV2(result === 'win' ? o.win : o.lose); });
      return;
    }
    finishV2(o);
  }
  function finishV2(o) {
    applyFx(o);
    if (o.say && !o.end) say('nurse', o.say);
    if (o.why) say('why', o.why);
    if (o.end) { if (o.complain || o.end === 'fail') { if (!o.complain) S.complaints++; } endV2(o); return; }
    if (o.retry || !o.next) PC.off.add(o.id);
    if (o.next) PC.step = o.next;
    if (PC.pat <= 0) { patienceCheck(); return; }
    patienceCheck();
    renderPublicCase();
  }

  // ---------- 嬰幼兒視覺增強聽力檢查 (VRA) ----------
  // A beep comes from the audiometer and the baby turns toward the side it came from. Open the toy
  // on that side within 3 seconds to reward the turn. Three right ends the test; three misses ends it too.
  const VRA = { active: false, phase: 'idle', wait: 0, left: 0, side: 0, ok: 0, miss: 0, done: null, rest: 0 };
  const VRA_WINDOW = 3, VRA_NEED = 3, VRA_MAX_MISS = 3;
  let actx = null;
  function beepBeep() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      for (const at of [0, 0.28]) {
        const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + at;
        o.frequency.value = 1000; o.connect(g); g.connect(actx.destination);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
        o.start(t0); o.stop(t0 + 0.22);
      }
    } catch (e) { /* no sound: the light on the audiometer still shows the tone */ }
  }
  function vraView() {
    const root = $('vra'), pose = VRA.phase === 'turn' || VRA.phase === 'rest' ? VRA.side : 0;
    root.dataset.turn = pose; root.dataset.phase = VRA.phase;
    $('vraOk').textContent = `✓ ${VRA.ok} / ${VRA_NEED}`; $('vraMiss').textContent = `✗ ${VRA.miss} / ${VRA_MAX_MISS}`;
    $('vraPat').textContent = Math.round(PC.pat);
  }
  function vraStart(done) {
    Object.assign(VRA, { active: true, phase: 'wait', wait: 1.6 + Math.random() * 1.2, left: 0, side: 0, ok: 0, miss: 0, done, rest: 0 });
    $('vra').hidden = false; $('vra').dataset.toy = '0'; $('vraMsg').textContent = '等聲音響起，看寶寶轉向哪一邊。';
    $('vraBar').style.width = '0%';
    vraView(); frame.focus();
  }
  function vraClose() { VRA.active = false; VRA.phase = 'idle'; $('vra').hidden = true; }
  function vraResult(good, msg, toySide) {
    if (good) VRA.ok++; else VRA.miss++;
    VRA.phase = 'rest'; VRA.rest = 1.3;
    $('vra').dataset.toy = good ? String(toySide) : '0';
    $('vra').classList.toggle('good', good); $('vra').classList.toggle('badhit', !good);
    $('vraMsg').textContent = msg; $('vraBar').style.width = '0%';
    vraView();
    if (VRA.ok >= VRA_NEED || VRA.miss >= VRA_MAX_MISS) {
      const win = VRA.ok >= VRA_NEED, fin = VRA.done;
      VRA.phase = 'over'; VRA.rest = 1.1; VRA.done = () => { vraClose(); fin(win ? 'win' : 'lose'); };
    }
  }
  function vraPress(side) {
    if (!VRA.active) return;
    if (VRA.phase === 'wait') { vraResult(false, '還沒有聲音就開玩具了。寶寶會搞不清楚為什麼玩具會亮。', side); return; }
    if (VRA.phase !== 'turn') return;
    if (side === VRA.side) vraResult(true, '轉對了！玩具亮起來，寶寶笑了。', side);
    else vraResult(false, '開錯邊了！寶寶看著另一邊，沒有獎勵到他。', side);
  }
  function vraTick(dt) {
    if (VRA.phase === 'wait') {
      VRA.wait -= dt;
      if (VRA.wait <= 0) {
        VRA.phase = 'turn'; VRA.side = Math.random() < 0.5 ? -1 : 1; VRA.left = VRA_WINDOW;
        $('vra').classList.remove('good', 'badhit'); $('vra').dataset.toy = '0';
        $('vraMsg').textContent = '嗶嗶！寶寶轉頭了，快開那一側的玩具！';
        beepBeep(); vraView();
      }
    } else if (VRA.phase === 'turn') {
      VRA.left -= dt;
      $('vraBar').style.width = `${Math.max(0, VRA.left / VRA_WINDOW * 100)}%`;
      if (VRA.left <= 0) vraResult(false, '來不及！超過 3 秒，寶寶已經沒興趣了。', 0);
    } else if (VRA.phase === 'rest' || VRA.phase === 'over') {
      VRA.rest -= dt;
      if (VRA.rest <= 0) {
        if (VRA.phase === 'over') { const f = VRA.done; f(); return; }
        VRA.phase = 'wait'; VRA.wait = 1.4 + Math.random() * 1.8; VRA.side = 0;
        $('vra').classList.remove('good', 'badhit'); $('vra').dataset.toy = '0';
        $('vraMsg').textContent = '等聲音響起，看寶寶轉向哪一邊。'; vraView();
      }
    }
    if (VRA.active) $('vraPat').textContent = Math.round(PC.pat);
  }


  // ---------- 帶吊點滴的病人走路 ----------
  // The patient starts at the left and walks to the door on the right. Hold the bag and carry it right at a
  // steady pace: too fast and the patient cannot keep up (the line pulls), too slow and the corridor jams.
  // Keep the bag in the green band, or blood runs back up the line. Any meter that fills ends the walk.
  const DRIP = { active: false, phase: 'idle', bx: 130, by: 110, px: 90, held: false, ptr: null, keys: new Set(), tug: 0, jam: 0, back: 0, done: null, rest: 0, speed: 0, msgAt: 0 };
  const DRIP_X0 = 90, DRIP_X1 = 700, DRIP_TOP = 52, DRIP_LOW = 156, DRIP_VMAX = 75, DRIP_VMIN = 25, DRIP_LEAD = 40, DRIP_TETHER = 130;
  const dripSvg = $('dripSvg');
  function dripPoint(e) {
    const pt = dripSvg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const m = dripSvg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : { x: DRIP.bx, y: DRIP.by };
  }
  $('dBag').addEventListener('pointerdown', e => {
    if (!DRIP.active || DRIP.phase === 'over') return;
    e.preventDefault(); const p = dripPoint(e);
    DRIP.held = true; DRIP.ptr = { dx: DRIP.bx - p.x, dy: DRIP.by - p.y };
    try { dripSvg.setPointerCapture(e.pointerId); } catch {}
  });
  dripSvg.addEventListener('pointermove', e => {
    if (!DRIP.held || !DRIP.ptr) return; const p = dripPoint(e);
    DRIP.tx = p.x + DRIP.ptr.dx; DRIP.ty = p.y + DRIP.ptr.dy;
  });
  const dripRelease = () => { DRIP.held = false; DRIP.ptr = null; };
  dripSvg.addEventListener('pointerup', dripRelease); dripSvg.addEventListener('pointercancel', dripRelease);
  function dripStart(done) {
    Object.assign(DRIP, { active: true, phase: 'ready', bx: DRIP_X0 + DRIP_LEAD, by: 110, px: DRIP_X0, held: false, ptr: null, tx: null, ty: null, tug: 0, jam: 0, back: 0, done, rest: 0, speed: 0 });
    DRIP.keys.clear();
    $('drip').hidden = false; $('drip').classList.remove('good', 'badhit'); $('dripBar').style.width = '0%';
    $('dripMsg').textContent = '按住點滴袋，開始陪病人往右邊的出口走。';
    dripDraw(); frame.focus();
  }
  function dripClose() { DRIP.active = false; DRIP.phase = 'idle'; DRIP.held = false; $('drip').hidden = true; }
  function dripEnd(win, msg) {
    DRIP.phase = 'over'; DRIP.rest = 1.6; DRIP.held = false;
    $('drip').classList.toggle('good', win); $('drip').classList.toggle('badhit', !win); $('dripMsg').textContent = msg;
    const fin = DRIP.done; DRIP.done = () => { dripClose(); fin(win ? 'win' : 'lose'); };
    dripDraw();
  }
  function dripDraw() {
    const D = DRIP, step = Math.sin(D.px * 0.16) * 6 * Math.min(1, D.speed / 20);
    $('dPat').setAttribute('transform', `translate(${D.px} 0)`);
    $('dLegL').setAttribute('transform', `rotate(${step} 0 262)`); $('dLegR').setAttribute('transform', `rotate(${-step} 10 262)`);
    $('dQueue').setAttribute('transform', `translate(${Math.min(0, D.px - 150)} 0)`);
    $('dBag').setAttribute('transform', `translate(${D.bx} ${D.by})`);
    const hx = D.px + 14, hy = 248, ty = D.by + 34, sag = Math.max(0, 60 - Math.abs(D.bx - hx) * 0.4);
    $('dTube').setAttribute('d', `M${hx} ${hy} Q${(hx + D.bx) / 2} ${Math.max(hy, ty) + sag} ${D.bx} ${ty}`);
    $('dBlood').setAttribute('d', `M${hx} ${hy} Q${(hx + D.bx) / 2} ${Math.max(hy, ty) + sag} ${D.bx} ${ty}`);
    $('dBlood').setAttribute('stroke-dasharray', `${D.back} 100`);
    $('dTube').setAttribute('stroke', D.bx - D.px > DRIP_TETHER - 20 ? '#ff8d92' : '#cfe3f2');
    $('dTug').style.width = `${Math.min(100, D.tug)}%`; $('dJam').style.width = `${Math.min(100, D.jam)}%`; $('dBack2').style.width = `${Math.min(100, D.back)}%`;
    $('dripBar').style.width = `${Math.max(0, Math.min(100, (D.px - DRIP_X0) / (DRIP_X1 - DRIP_X0) * 100))}%`;
  }
  function dripTick(dt) {
    const D = DRIP;
    if (D.phase === 'over') { D.rest -= dt; if (D.rest <= 0) D.done(); return; }
    dt = Math.min(dt, 0.05);
    const kx = (D.keys.has('arrowright') || D.keys.has('d') ? 1 : 0) - (D.keys.has('arrowleft') || D.keys.has('a') ? 1 : 0);
    const ky = (D.keys.has('arrowdown') || D.keys.has('s') ? 1 : 0) - (D.keys.has('arrowup') || D.keys.has('w') ? 1 : 0);
    const held = D.held || kx || ky || (D.keys.size > 0);
    if (D.held && D.tx != null) { D.bx = D.tx; D.by = D.ty; }
    else if (held) { D.bx += kx * 55 * dt; D.by += ky * 90 * dt; }
    else D.by += 220 * dt;                               // let go: the bag drops
    D.bx = Math.max(D.px - 30, Math.min(780, D.bx)); D.by = Math.max(20, Math.min(330, D.by));
    if (D.phase === 'ready') {
      if (held) { D.phase = 'go'; $('dripMsg').textContent = '穩穩地往右走，不要太快也不要太慢。'; }
      else { dripDraw(); return; }
    }
    // the patient follows the bag, but only so fast
    const s = Math.max(0, Math.min(DRIP_VMAX, (D.bx - DRIP_LEAD - D.px) * 3));
    D.px += s * dt; D.speed = s;
    const gap = D.bx - D.px, tooFar = gap > DRIP_TETHER, tooSlow = s < DRIP_VMIN && D.px < DRIP_X1, high = D.by < DRIP_TOP, low = D.by > DRIP_LOW;
    const bump = (k, on, up) => { D[k] = on ? D[k] + up * dt : Math.max(0, D[k] - 25 * dt); };
    bump('tug', tooFar || high, tooFar ? 45 : 30); bump('jam', tooSlow, 28); bump('back', low, 45);
    const why = tooFar ? '太快了！病人跟不上，管子被拉扯。' : high ? '舉太高了，管子在拉病人的手。' : low ? '袋子太低了，血液會回流到管路！' : tooSlow ? '太慢了，後面的人被擋住了。' : '很好，繼續保持。';
    if ($('dripMsg').textContent !== why) $('dripMsg').textContent = why;
    dripDraw();
    if (D.tug >= 100) dripEnd(false, '拉扯太用力，針頭被扯得很痛，病人叫了出來。');
    else if (D.jam >= 100) dripEnd(false, '走得太慢，整條走廊被擋住，動線全卡死了。');
    else if (D.back >= 100) dripEnd(false, '點滴袋舉太低，血液倒流進管路，病人嚇到了。');
    else if (D.px >= DRIP_X1) dripEnd(true, '順利走進診間，病人安全地坐下了。');
  }

  // ---------- 幼兒遊戲式聽力檢查（積木） ----------
  // Each round the boy does one of three things: a tone sounds and he does not react (引導他),
  // a tone sounds and he stacks a block (鼓勵他), no tone and he stacks a block anyway (糾正他).
  // Press the right button within 3 seconds. Five right ends the test; five wrong ends it too.
  const BLK = { active: false, phase: 'idle', wait: 0, left: 0, kind: null, ok: 0, miss: 0, done: null, rest: 0, tower: 1 };
  const BLK_WINDOW = 3, BLK_NEED = 5, BLK_MAX_MISS = 5;
  const BLK_ROUNDS = {
    guide: { tone: true, act: 'idle', hint: '嗶嗶！孩子好像沒聽到，還在東張西望。' },
    encourage: { tone: true, act: 'stack', hint: '嗶嗶！孩子拿起積木往上疊。' },
    fix: { tone: false, act: 'stack', hint: '沒有聲音，孩子卻自己拿起積木疊了起來。' },
  };
  const BLK_RIGHT = { guide: '引導他：「你有聽到小聲音嗎？再仔細聽聽看。」', encourage: '鼓勵他：「好棒！聽到聲音就放一塊！」', fix: '糾正他：「要聽到聲音才放喔，我們等聲音。」' };
  function blkView() {
    const root = $('blk'), r = BLK.kind ? BLK_ROUNDS[BLK.kind] : null;
    root.dataset.phase = BLK.phase; root.dataset.tone = r && r.tone && BLK.phase === 'act' ? '1' : '0';
    root.dataset.act = r && BLK.phase !== 'wait' ? r.act : 'idle'; root.dataset.tower = String(BLK.tower);
    $('blkOk').textContent = `✓ ${BLK.ok} / ${BLK_NEED}`; $('blkMiss').textContent = `✗ ${BLK.miss} / ${BLK_MAX_MISS}`;
    $('blkPat').textContent = Math.round(PC.pat);
  }
  function blkStart(done) {
    Object.assign(BLK, { active: true, phase: 'wait', wait: 1.6 + Math.random() * 1, kind: null, ok: 0, miss: 0, done, rest: 0, tower: 1, hist: [] });
    $('blk').hidden = false; $('blk').classList.remove('good', 'badhit'); $('blkMsg').textContent = '仔細觀察孩子，也聽聽有沒有聲音。'; $('blkBar').style.width = '0%';
    blkView(); frame.focus();
  }
  function blkClose() { BLK.active = false; BLK.phase = 'idle'; $('blk').hidden = true; }
  function blkResult(good, msg) {
    if (good) BLK.ok++; else BLK.miss++;
    BLK.phase = 'rest'; BLK.rest = 1.4;
    $('blk').classList.toggle('good', good); $('blk').classList.toggle('badhit', !good);
    $('blkMsg').textContent = msg; $('blkBar').style.width = '0%';
    blkView();
    if (BLK.ok >= BLK_NEED || BLK.miss >= BLK_MAX_MISS) {
      const win = BLK.ok >= BLK_NEED, fin = BLK.done;
      BLK.phase = 'over'; BLK.rest = 1.1; BLK.done = () => { blkClose(); fin(win ? 'win' : 'lose'); };
    }
  }
  function blkPress(kind) {
    if (!BLK.active) return;
    if (BLK.phase === 'wait') { blkResult(false, '還沒有狀況就按了。先看清楚孩子在做什麼、有沒有聲音。'); return; }
    if (BLK.phase !== 'act') return;
    if (kind === BLK.kind) blkResult(true, `對了！${BLK_RIGHT[kind]}`);
    else blkResult(false, `按錯了。這時候該：${BLK_RIGHT[BLK.kind]}`);
  }
  function blkTick(dt) {
    if (BLK.phase === 'wait') {
      BLK.wait -= dt;
      if (BLK.wait <= 0) {
        { // five rounds: never all the same, never more than twice in a row
          const ks = ['guide', 'encourage', 'fix'], hist = BLK.hist = BLK.hist || [];
          let k; do { k = pickN(ks, 1)[0]; } while ((hist.length >= 2 && hist[hist.length - 1] === k && hist[hist.length - 2] === k) || (hist.length === 4 && new Set([...hist, k]).size < 2));
          hist.push(k); BLK.kind = k; } const r = BLK_ROUNDS[BLK.kind];
        BLK.phase = 'act'; BLK.left = BLK_WINDOW;
        if (r.act === 'stack') BLK.tower = BLK.tower % 5 + 1;
        $('blk').classList.remove('good', 'badhit');
        $('blkMsg').textContent = '看孩子在做什麼、有沒有聽到聲音，3 秒內選一個！';
        if (r.tone) beepBeep();
        blkView();
      }
    } else if (BLK.phase === 'act') {
      BLK.left -= dt;
      $('blkBar').style.width = `${Math.max(0, BLK.left / BLK_WINDOW * 100)}%`;
      if (BLK.left <= 0) blkResult(false, `來不及！超過 3 秒。這時候該：${BLK_RIGHT[BLK.kind]}`);
    } else if (BLK.phase === 'rest' || BLK.phase === 'over') {
      BLK.rest -= dt;
      if (BLK.rest <= 0) {
        if (BLK.phase === 'over') { const f = BLK.done; f(); return; }
        BLK.phase = 'wait'; BLK.wait = 1.3 + Math.random() * 1.4; BLK.kind = null;
        $('blk').classList.remove('good', 'badhit'); $('blkMsg').textContent = '仔細觀察孩子，也聽聽有沒有聲音。'; blkView();
      }
    }
    if (BLK.active) $('blkPat').textContent = Math.round(PC.pat);
  }
  $('blkGuide').addEventListener('click', () => { blkPress('guide'); frame.focus(); });
  $('blkEnc').addEventListener('click', () => { blkPress('encourage'); frame.focus(); });
  $('blkFix').addEventListener('click', () => { blkPress('fix'); frame.focus(); });
  $('vraL').addEventListener('click', () => { vraPress(-1); frame.focus(); });
  $('vraR').addEventListener('click', () => { vraPress(1); frame.focus(); });
  // waiting for the pure-tone report: leave the bed to see other patients, or read it once it is out
  function waitAct(act) {
    const lab = PC.waitReport; if (!lab) return;
    if (act === 'leave') { suspendPublicCase(); return; }
    if (!lab.ready) return;
    PC.waitReport = null;
    const c = C(); say('you', '看純音聽力報告'); plog('你：看純音聽力報告');
    if (c.pta.say) say('nurse', c.pta.say);
    openLab(S.labs.indexOf(lab));
    renderPublicCase();
  }
  // step away from the bed with the question still open (S.susp keeps it for when the doctor comes back)
  function suspendPublicCase() {
    const id = PC.id;
    S.susp[id] = { ...PC, off: new Set(PC.off), log: [...PC.log] };
    $('pcase').hidden = true; document.body.classList.remove('at-bedside');
    S.mode = 'walk'; S.current = null;
    place(player, ...SPOT.leave(BED[CASES[id].bed]), Math.PI / 2);
    PC.step = null; PC.waitReport = null;
    frame.focus();
    toast('先去處理其他病人。報告出來後，記得回來看報告。', 3.5);
  }
  // the report on the screen changes as the clock runs
  function waitTick() {
    const lab = PC.waitReport; if (!lab) return;
    if (lab.seen) { PC.waitReport = null; renderPublicCase(); return; }
    if (PC.waitKey !== `${lab.ready}|${Math.ceil(lab.readyAt - S.t)}`) renderPublicCase();
  }
  // too far gone: the heart stops, unless this is a bed that fails another way (a stroke)
  function publicArrest() {
    const c = C();
    if (!c.steps.arrest) { S.favors[PC.id] = Math.min(25, calcFavor(PC.id)); if (!S.failed?.[PC.id]) { S.failed = { ...(S.failed || {}), [PC.id]: true }; S.complaints++; } publicDeath(c.fail.text, c.fail.title); return; }
    PC.state = 'arrest'; PC.step = 'arrest';
    say('alarm', c.arrestLine); plog(`${c.name}沒有呼吸心跳`, 'warn');
    $('pcNurse').src = IMG('nurse_panic');
    renderPublicCase();
  }
  // chest compressions to the beat: judged on the middle presses, so a hesitant start is forgiven
  function startCpr() {
    PC.cpr = { times: [], timer: setInterval(() => {
      const cp = PC.cpr; if (!cp || S.paused || !cp.times.length) return;
      if (performance.now() - cp.times[cp.times.length - 1] > CPR.maxGap * 1000) publicDeath('壓胸中斷太久了。CPR 一旦開始就盡量不要停，直到 AED 或急救團隊接手。');
    }, 200) };
    $('pcCount').textContent = `0 / ${CPR.presses}`; $('pcRate').textContent = '準備好就開始按';
    renderPublicCase();
  }
  function cprPress() {
    const cp = PC.cpr; if (!cp || S.paused) return;
    cp.times.push(performance.now());
    const press = $('pcPress'); press.classList.remove('hit'); void press.offsetWidth; press.classList.add('hit');
    const gaps = cp.times.slice(1).map((t, i) => t - cp.times[i]), recent = gaps.slice(-4);
    const rate = recent.length ? Math.round(60000 / (recent.reduce((a, b) => a + b, 0) / recent.length)) : 0;
    $('pcCount').textContent = `${cp.times.length} / ${CPR.presses}`;
    $('pcRate').textContent = rate ? `每分鐘 ${rate} 下 · ${rate < 100 ? '太慢' : rate > 120 ? '太快' : '剛好'}` : '';
    if (cp.times.length < CPR.presses) return;
    clearInterval(cp.timer);
    const middle = gaps.slice(2).sort((a, b) => a - b), bpm = Math.round(60000 / middle[Math.floor(middle.length / 2)]);
    PC.cpr = null;
    if (bpm < CPR.slowest) { publicDeath(`壓胸太慢了（每分鐘大約 ${bpm} 下），血液送不到腦部。要壓每分鐘 100 到 120 下。`); return; }
    if (bpm > CPR.fastest) { publicDeath(`壓胸太快了（每分鐘大約 ${bpm} 下），心臟來不及回血。要壓每分鐘 100 到 120 下。`); return; }
    const c = C();
    S.t += 2; PC.state = c.cprState; PC.step = c.cprNext; PC.danger = 3;
    say('nurse', c.cprLine); plog(`壓胸 30 下（每分鐘約 ${bpm} 下）`, 'best');
    $('pcNurse').src = IMG(c.cprState === 'arrest' ? 'nurse_panic' : 'nurse_relieved');
    renderPublicCase();
    holdTaps($('pcOpts'), 1200);
  }
  $('pcPress').addEventListener('pointerdown', e => { e.preventDefault(); cprPress(); });
  const tipHtml = c => `<b>${esc(c.card.title)}</b><ol>${c.card.points.map(p => `<li>${esc(p)}</li>`).join('')}</ol>`;
  function publicDeath(reason, title) {
    const c = C();
    if (PC.cpr) clearInterval(PC.cpr.timer);
    PC.cpr = null; S.mode = 'pdead';
    plog(title || `${c.name}離開了`, 'warn');
    $('pcase').hidden = true;
    $('pdWhen').textContent = fmt(S.t);
    $('pdTitle').textContent = title || `${BL(CASES[PC.id].bed)} 的${c.name}沒有救回來`;
    $('pdText').textContent = `${reason}${title ? '' : '這是遊戲；在真實的聽力中心，每一天都有這樣的取捨。'}下面是今天發生的事，紅色的是警訊。`;
    $('pdTimeline').innerHTML = S.plog.map(l => `<li class="${l.kind}"><time>${fmt(l.t)}</time><span>${esc(l.text)}</span></li>`).join('');
    $('pdCard').innerHTML = tipHtml(c);
    $('pdeath').hidden = false;
    // the card fades in over about 1.4 s; its buttons wait for it, and for the finger that was pressing
    holdTaps($('pdRetry').parentElement, 1500);
    $('pdRetry').focus();
  }
  $('pdRetry').addEventListener('click', () => {
    if (held($('pdRetry').parentElement)) return;
    $('pdeath').hidden = true; S.pretries++;
    S.t = PC.snap.t; S.energy = PC.snap.energy; S.plog.length = PC.snap.plog;
    S.labs = S.labs.filter(l => !(l.id === PC.id && l.at > PC.snap.t));
    PC.step = null;
    openPublicCase(PC.id);
  });
  $('pdAgain').addEventListener('click', () => { if (!held($('pdAgain').parentElement)) location.reload(); });
  // the summary's word on looking after yourself, for a doctor who went without food or held it in
  function selfCare() {
    const lines = [
      ...(S.looFull ? ['聽力師一忙起來常常憋尿，憋久了容易泌尿道感染。再忙，也要記得上廁所。'] : []),
      ...(S.eaten <= 0 ? ['聽力師常常忙到忘了吃午餐。餓著肚子做事，精力掉得快、專注力也會變差。再忙，也要記得吃飯。'] : []),
    ];
    return lines.length ? '<li class="tiphead">照顧自己</li>' + lines.map(t => `<li class="tip">${esc(t)}</li>`).join('') : '';
  }
  function publicSummary() {
    if (S.ended) return;
    S.ended = true; S.mode = 'end';
    ['pcase', 'pdeath', 'dialog', 'sleep', 'scall', 'recall', 'eat', 'interrupt', 'glab'].forEach(id => { $(id).hidden = true; });
    document.body.classList.remove('at-bedside');
    const st = S.stats, tonight = S.arrived.map(id => PCASE[id]);
    const seen = tonight.filter(c => c.results[S.outcome?.[c.id]]);
    const gone = tonight.filter(c => S.outcome?.[c.id] === 'left');
    // arrived but never finished by closing time
    const left = tonight.filter(c => !seen.includes(c) && !gone.includes(c) && S.outcome?.[c.id] !== 'gameover');
    const favs = tonight.filter(c => S.favors[c.id] != null).map(c => S.favors[c.id]);
    const avgFav = favs.length ? Math.round(favs.reduce((a, b) => a + b, 0) / favs.length) : 0;
    const overtime = Math.max(0, Math.round(Math.min(S.t, END) - OFF));
    const all = tonight.length > 0 && seen.length === tonight.length;
    const bad = S.collapsed || S.infected || S.hypo || S.gameover;
    document.querySelector('#handover .mark').textContent = `${GAME.title} · ${SHIFT_NAME[S.shift]}${S.duty ? ' · 值班日' : ' · 非值班日'}`;
    $('hStamp').hidden = S.shift !== 'hard';
    if (S.shift === 'hard') drawStamp($('hStamp'), '#cf2027');
    $('hWhen').textContent = `${fmt(S.t)} · ${S.gameover ? '今天結束了' : S.collapsed ? '累倒了' : S.hypo ? '送急診' : S.infected ? '請假看醫生' : overtime ? `加班 ${overtime} 分鐘後下班` : '準時下班'}`;
    $('hTitle').textContent = (S.nick ? `${S.nick}聽力師，` : '') + (S.gameover ? '你答應了不能答應的事' : S.collapsed ? '你累倒了' : S.hypo ? '你低血糖昏倒了' : S.infected ? '你得了尿道感染' : all ? `${CN[tonight.length]}位病人都處理好了，今天順利下班`
      : left.length + gone.length ? `完成 ${seen.length} 位，還有 ${left.length + gone.length} 位沒處理好` : seen.length ? `處理好了 ${seen.length} 位` : '今天先到這裡');
    if (S.special && !bad) $('hTitle').textContent = (S.nick ? `${S.nick}聽力師，` : '') + S.special.title;
    $('hStats').innerHTML = [
      ['完成病人', seen.length, `/ ${tonight.length}`], ['被投訴', S.complaints, '次'], ['病人好感度', avgFav, '分'],
      ['加班', overtime, '分鐘'], ['轉給同事', st.transferred, '通'], ...(st.incidents ? [['病安事件', st.incidents, '件']] : []), ['從診間重來', S.pretries || 0, '次'],
    ].map(([k, v, u]) => `<div class="stat"><small>${k}</small><b>${v}<span>${u}</span></b></div>`).join('');
    const cards = tonight.filter(c => S.calls[c.id]?.opened);
    const spNote = S.special ? `<li class="tip best">${esc(S.special.tip)}</li>` : '';
    const note = spNote + (S.gameover ? `<li class="tip miss">${esc(S.gameover)}</li>` : S.hypo ? '<li class="tip miss">一整天沒好好吃東西，肚子餓到歸零，低血糖冒冷汗、眼前發黑，被同事扶去急診打葡萄糖，今天只好提早下班。再忙，也要記得吃飯。</li>' : S.infected ? '<li class="tip miss">尿意滿了又憋了一個多小時，得了尿道感染，只好請假去看醫生。再忙，也要記得上廁所。</li>' : '');
    $('hCases').innerHTML = note + seen.map(c => `<li class="tip"><b>${BL(CASES[c.id].bed)}</b> ${esc(c.results[S.outcome[c.id]])}</li>`).join('')
      + gone.map(c => `<li class="tip miss">${esc(c.name)}等不下去，走了，也投訴了。</li>`).join('')
      + left.map(c => `<li class="tip miss">${esc(c.name)}${S.calls[c.id]?.opened ? '還沒處理好，就到下班時間了' : '等到下班，都沒有人去看'}</li>`).join('')
      + cards.map(c => `<li class="tiphead">${esc(c.card.title)}</li>` + c.card.points.map(p => `<li class="tip">${esc(p)}</li>`).join('')).join('')
      + (S.colleagueGone ? '<li class="tiphead">給同事留一點力氣</li><li class="tip">電話轉給同事會消耗他的精力，轉太多他就提早下班了。分擔要適度，緊急的事盡量自己處理。</li>' : '')
      + selfCare();
    $('hScore').textContent = st.callsIn;
    $('hPgy').src = ME(all && !bad ? 'survived' : 'sleepy');
    $('hBadge').textContent = `稱號：${S.special && !bad && all && (S.complaints || S.pretries) ? S.special.badge : S.gameover ? '差點毀了專業的聽力師' : S.collapsed ? '累倒在辦公室的聽力師' : S.hypo ? '餓到去急診打葡萄糖的聽力師' : S.infected ? '憋尿憋到請假的聽力師' : !all ? '還在加班的人' : S.complaints ? '被投訴也撐過去的聽力師' : S.pretries ? '跌倒了再站起來的聽力師' : '一個人撐住整個聽力中心的聽力師'}`;
    $('hChiefAvatar').style.backgroundImage = `url(${IMG('nurse_caring')})`;
    $('hChief').textContent = S.hypo
      ? '你餓到手抖、臉色發白，同事趕緊扶你去急診打了葡萄糖，剩下的病人只好請人接手。工作再忙，午餐也要吃：照顧好自己，才照顧得了病人。'
      : S.collapsed
      ? '你趴在辦公室睡著了，怎麼叫都叫不醒，只好請同事來接手剩下的病人。再忙，也要找空檔喝水、吃飯、歇一下：照顧好自己，才照顧得了病人。'
      : '聽力檢查看起來只是戴上耳機、按按鈕，但每一位病人背後，都有要判斷的事：這是需要馬上處理的急症，還是可以慢慢調整的日常？電話裡的每一通，也都得在幾句話裡分辨輕重。';
    S.result = `我在《${GAME.title}》上了一天${SHIFT_NAME[S.shift]}：完成 ${seen.length}/${tonight.length} 位病人，被投訴 ${S.complaints} 次，病人好感度 ${avgFav} 分${overtime ? `，加班 ${overtime} 分鐘` : ''}${S.collapsed ? '，累倒了' : S.hypo ? '，低血糖送急診' : ''}。`;
    $('handover').hidden = false;
  }

  // ---------- ending ----------
  const endShift = () => publicSummary();
  $('hAgain').addEventListener('click', () => location.reload());
  $('hCopy').addEventListener('click', () => {
    const b = $('hCopy');
    navigator.clipboard.writeText(shareText()).then(() => { b.textContent = '已複製'; }, () => { b.textContent = '無法複製，請手動選取'; });
  });

  // ---------- sharing the night ----------
  // The summary on screen, redrawn as a story-sized card (1080×1920). A phone opens its share sheet
  // with it -- Instagram and Facebook offer their stories there; the web cannot post a story itself --
  // and a computer saves the picture instead.
  const shareUrl = () => `${location.origin}${location.pathname}`;
  const summaryStats = () => [...$('hStats').querySelectorAll('.stat')].map(el => {
    const b = el.querySelector('b'), unit = b.querySelector('span')?.textContent || '';
    return [el.querySelector('small').textContent, b.textContent.slice(0, b.textContent.length - unit.length).trim(), unit.trim()];
  });
  function shareText() {
    const badge = $('hBadge').textContent;
    return [`🌙 ${GAME.title}｜${SHIFT_NAME[S.shift]}`, $('hWhen').textContent, $('hTitle').textContent,
      ...summaryStats().map(([k, v, u]) => `・${k} ${v}${u ? ` ${u}` : ''}`),
      badge, `你撐得過一晚嗎？👉 ${shareUrl()}`, CREDIT.text].join('\n');
  }
  // text that wraps by character, as Chinese does
  function wrapText(g, text, width) {
    const lines = []; let line = '';
    for (const ch of text) { if (g.measureText(line + ch).width > width && line) { lines.push(line); line = ch; } else line += ch; }
    if (line) lines.push(line);
    return lines;
  }
  function pill(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  // 大爛班's stamp, upright on a canvas of its own: two rings and the name, in ink worn like
  // rubber (the same specks every time). The summary turns it with CSS; the share card turns it
  // as it draws it, in a brighter red for its dark background.
  function drawStamp(cv, color) {
    const g = cv.getContext('2d'), w = cv.width, h = cv.height, r = rng(9);
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif';
    g.clearRect(0, 0, w, h);
    g.strokeStyle = g.fillStyle = color;
    g.lineWidth = 12; pill(g, 8, 8, w - 16, h - 16, 26); g.stroke();
    g.lineWidth = 4; pill(g, 26, 26, w - 52, h - 52, 14); g.stroke();
    g.font = `900 ${Math.round(h * 0.52)}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('大爛班', w / 2, h / 2 + h * 0.03);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 420; i++) { g.globalAlpha = 0.25 + r() * 0.6; g.beginPath(); g.arc(r() * w, r() * h, 0.6 + r() * 2.6, 0, Math.PI * 2); g.fill(); }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    return cv;
  }
  async function drawShareCard() {
    const cv = $('shareCanvas'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif';
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0a1220'); bg.addColorStop(0.6, '#151c2f'); bg.addColorStop(1, '#2b1830');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, 560, 40, W / 2, 560, 560); glow.addColorStop(0, 'rgba(69, 227, 204, .22)'); glow.addColorStop(1, 'rgba(69, 227, 204, 0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, 1150);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#45e3cc'; g.font = `700 36px ${font}`; g.fillText(`${SHIFT_NAME[S.shift]}`, W / 2, 118);
    g.fillStyle = '#eef3f6'; g.font = `900 100px ${font}`; g.fillText(GAME.title, W / 2, 228, W - 80);
    // the doctor, as on the summary
    const px = 250, py = 280, pw = 580, ph = 600, img = new Image();
    img.src = $('hPgy').src;
    try { await img.decode(); } catch { /* drawn without the portrait */ }
    g.save(); pill(g, px, py, pw, ph, 40); g.clip();
    const pg = g.createLinearGradient(0, py, 0, py + ph); pg.addColorStop(0, '#2a3e55'); pg.addColorStop(1, '#152131'); g.fillStyle = pg; g.fillRect(px, py, pw, ph);
    if (img.naturalWidth) { const k = Math.max(pw / img.naturalWidth, ph / img.naturalHeight); g.drawImage(img, px + (pw - img.naturalWidth * k) / 2, py, img.naturalWidth * k, img.naturalHeight * k); }
    g.restore();
    g.fillStyle = '#f0b45a'; g.font = `700 42px ${font}`; g.fillText($('hWhen').textContent, W / 2, 962);
    g.fillStyle = '#ffffff'; g.font = `900 66px ${font}`;
    let y = 1052;
    for (const line of wrapText(g, $('hTitle').textContent, 960).slice(0, 3)) { g.fillText(line, W / 2, y); y += 84; }
    const badge = $('hBadge').textContent.replace(/^稱號：/, '');
    g.font = `700 38px ${font}`;
    const bw = Math.min(980, g.measureText(badge).width + 84);
    y += 6; pill(g, (W - bw) / 2, y - 50, bw, 72, 36);
    g.fillStyle = 'rgba(69, 227, 204, .15)'; g.fill(); g.strokeStyle = 'rgba(69, 227, 204, .6)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#c4f6ee'; g.fillText(badge, W / 2, y); y += 96;
    const stats = summaryStats(), cols = stats.length > 6 ? 3 : 2, cw = 960 / cols;
    stats.forEach(([k, v, u], i) => {
      const cx = 60 + cw * (i % cols) + cw / 2, cy = y + Math.floor(i / cols) * 128;
      g.fillStyle = '#8fa3b6'; g.font = `600 32px ${font}`; g.fillText(k, cx, cy);
      g.font = `800 62px ${font}`; const vw = g.measureText(v).width; g.font = `600 30px ${font}`; const uw = u ? g.measureText(u).width + 10 : 0;
      g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.font = `800 62px ${font}`; g.fillText(v, cx - (vw + uw) / 2, cy + 70);
      if (u) { g.fillStyle = '#8fa3b6'; g.font = `600 30px ${font}`; g.fillText(u, cx - (vw + uw) / 2 + vw + 10, cy + 70); }
      g.textAlign = 'center';
    });
    // 大爛班: the summary's stamp, slanted, in the room under the numbers (and short of the
    // closing line however many lines the title took)
    if (S.shift === 'hard') {
      const stamp = drawStamp(Object.assign(document.createElement('canvas'), { width: 460, height: 200 }), '#ff4a50');
      const below = y + Math.ceil(stats.length / cols) * 128 - 10;
      g.save(); g.translate(W / 2 + 70, Math.min(below, H - 290)); g.rotate(-12 * Math.PI / 180); g.globalAlpha = 0.92;
      g.drawImage(stamp, -184, -80, 368, 160); g.restore();
    }
    g.fillStyle = '#eef3f6'; g.font = `800 46px ${font}`; g.fillText('你撐得過一晚嗎？', W / 2, H - 150);
    g.fillStyle = '#45e3cc'; g.font = `700 38px ${font}`; g.fillText(GAME.site, W / 2, H - 92);
    // the credit line the license asks for (README.md, 授權)
    g.fillStyle = '#8fa3b6'; g.font = `500 26px ${font}`; g.fillText(CREDIT.text, W / 2, H - 46);
  }
  let shareFile = null;
  async function openShare() {
    $('share').hidden = false; $('shareGo').hidden = true; $('shareHint').textContent = '圖卡產生中……';
    await drawShareCard();
    shareFile = null;
    $('shareCanvas').toBlob(b => {
      shareFile = b && new File([b], `${GAME.title}.png`, { type: 'image/png' });
      const can = !!shareFile && !!navigator.canShare?.({ files: [shareFile] });
      $('shareGo').hidden = !can;
      $('shareHint').textContent = can ? '按「分享」，選 Instagram 或 Facebook，就能發到限時動態。'
        : '這台裝置沒有分享選單：先下載圖片，再從手機相簿分享到限時動態。';
      (can ? $('shareGo') : $('shareSave')).focus();
    }, 'image/png');
  }
  // the share sheet opens straight from the tap, with the picture made beforehand
  $('shareGo').addEventListener('click', () => { if (shareFile) navigator.share({ files: [shareFile], title: GAME.title, text: shareText() }).catch(() => {}); });
  $('shareSave').addEventListener('click', () => $('shareCanvas').toBlob(b => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${GAME.title}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png'));
  $('shareClose').addEventListener('click', () => { $('share').hidden = true; });
  $('hShare').addEventListener('click', openShare);
  $('btnEnd').addEventListener('click', () => { if (S.started) endShift(); });
  $('btnMap').addEventListener('click', () => { S.map = !S.map; frame.focus(); });

  // ---------- start ----------
  // only the nickname and the shift are kept, in this browser
  const KEYS = { name: 'oncall_template_name', shift: 'oncall_template_shift', duty: 'oncall_template_duty' };
  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: nothing is kept */ } },
  };
  $('gName').value = store.get(KEYS.name);
  // the credit line on the start card and the summary (README.md, 授權)
  document.querySelectorAll('.credit').forEach(el => el.replaceChildren(`${CREDIT.text} · `,
    Object.assign(document.createElement('a'), { href: CREDIT.url, target: '_blank', rel: 'noopener', textContent: new URL(CREDIT.url).host })));
  // the shift picked last time is picked again
  if (store.get(KEYS.shift) === 'hard') document.querySelector('#gShift [value="hard"]').checked = true;
  if (store.get(KEYS.duty) === 'off') document.querySelector('#gDuty [value="off"]').checked = true;
  // the line under the settings only speaks when there is something to say
  const startHint = (text, err = false) => { $('gHint').hidden = false; $('gHint').textContent = text; $('gHint').classList.toggle('err', err); };
  // the missing-name note goes away as soon as there is a name
  $('gName').addEventListener('input', () => {
    if (!$('gName').value.trim() || !$('gName').hasAttribute('aria-invalid')) return;
    $('gName').removeAttribute('aria-invalid'); $('gHint').classList.remove('err'); $('gHint').hidden = true;
  });
  document.querySelectorAll('.pick [data-pgy]').forEach(b => b.addEventListener('click', () => {
    // the doctor needs a name: the handover, the calls and the summary use it
    if (!$('gName').value.trim()) {
      startHint('請先輸入暱稱，才能開始上班。', true);
      $('gName').setAttribute('aria-invalid', 'true'); $('gName').focus(); return;
    }
    goSideways();
    document.querySelectorAll('.pick button').forEach(x => { x.disabled = true; });
    S.nick = $('gName').value.trim().slice(0, 40);
    store.set(KEYS.name, S.nick);
    S.shift = document.querySelector('#gShift input:checked')?.value === 'hard' ? 'hard' : 'normal';
    S.duty = document.querySelector('#gDuty input:checked')?.value !== 'off';
    store.set(KEYS.duty, S.duty ? 'duty' : 'off');
    store.set(KEYS.shift, S.shift);
    const k = b.dataset.pgy;
    S.pgy = k;
    players.m.visible = k === 'm'; players.f.visible = k === 'f';
    player = players[k]; playerSit = sitters[k];
    $('start').hidden = true;
    showBrief();
  }));

  // ---------- 17:00 handover ----------
  // The day team's handover lists a few quiet beds with ordinary problems, drawn at random.
  // None of them is tonight's trouble; the calls come from elsewhere. Time starts only when
  // the doctor says they are ready.
  // the daily routine on the briefing sheet (nothing to click: it is what the day starts with)
  const PREP = [['開啟電腦', '登入檢查系統，確認網路與列印都正常。'], ['校正儀器', '聽力檢查儀與耳機做日常檢查，確認聲音輸出正常。'],
    ['穿上制服', '換好制服、掛好名牌，準備好今天的耳塞和耳模材料。'], ['消毒環境', '擦拭耳機、桌面與隔音室的把手，換上乾淨的耳塞。'],
    ['確認預約名單', '看過今天的預約名單，注意有沒有需要特別安排的病人。']];
  const SLOTS = ['08:30', '09:00', '10:00', '13:30', '14:00', '15:00'];
  function showBrief() {
    $('briefTitle').textContent = `今天，${WARD}交給你了`;
    $('briefEyebrow').textContent = `開診 · ${WARD}`;
    $('briefMe').src = ME('confident');
    $('briefLevel').textContent = `${S.nick ? `${S.nick}聽力師` : '你'} · 今天的臨床聽力師`;
    $('briefFrom').textContent = `值班主管 → 你`;
    $('briefList').innerHTML = PREP.map(([t, d], i) => `<div class="pt"><b>${i + 1}</b><strong>${t}</strong><span>${d}</span></div>`).join('');
    $('briefTeam').innerHTML = [['廷偉', 'nurse_thankful', '跟診護士'], ['靜亞', 'nurse_neutral', '跟診護士'], ['姚雯', 'nurse_caring', '跟診護士'], ['同事', 'chief_approve', '另一位聽力師']]
      .map(([n, face, r]) => `<div class="nurse"><span class="av" style="background-image:url(${IMG(face)})"></span><b>${n}</b><small>${r}</small></div>`).join('');
    $('brief').hidden = false;
    setTimeout(() => $('briefGo').focus(), 60);
  }
  function beginShift() {
    if ($('brief').hidden) return;
    $('brief').hidden = true;
    S.started = true; frame.focus();
    startDay();
    preload();
    toast(`08:00 開診，${WARD}交給你了。先熟悉一下環境吧。`, 4);
  }
  $('briefGo').addEventListener('click', beginShift);
  $('hudWard').textContent = `${WARD} · 門診日`;

  // ---------- input ----------
  const keys = new Set();
  const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  const MOVE = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'];
  window.addEventListener('keydown', e => {
    if (typing(e)) { if (e.key === 'Escape') { e.target.blur(); frame.focus(); } return; }
    const k = e.key.toLowerCase();
    if (!$('share').hidden) { if (k === 'escape') { e.preventDefault(); $('share').hidden = true; } return; }
    if (S.ended && k === 's' && !e.repeat && !$('handover').hidden) { e.preventDefault(); openShare(); return; }
    if (S.paused) { if (['p', 'escape', 'enter', ' '].includes(k)) { e.preventDefault(); setPaused(false); } return; }
    if (k === 'p' && !e.repeat && S.started && !S.ended) { e.preventDefault(); setPaused(true); return; }
    if (!$('glab').hidden) { if (['escape', 'e', 'enter', ' '].includes(k)) { e.preventDefault(); closeLab(); } return; }
    if (!$('recall').hidden) { if (['escape', 'e', 'enter', ' '].includes(k)) { e.preventDefault(); $('recallGo').click(); } return; }
    if (!$('brief').hidden) { if (k === 'enter' || k === ' ') { e.preventDefault(); beginShift(); } return; }
    if (!S.started) return;
    if (S.mode === 'pcase') {
      if (DRIP.active) { if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'].includes(k)) { e.preventDefault(); DRIP.keys.add(k); } return; }
      if (BLK.active) { if (['1', '2', '3'].includes(k) && !e.repeat) { e.preventDefault(); blkPress(['guide', 'encourage', 'fix'][Number(k) - 1]); } return; }
      if (VRA.active) { if (['arrowleft', 'a'].includes(k) && !e.repeat) { e.preventDefault(); vraPress(-1); } else if (['arrowright', 'd'].includes(k) && !e.repeat) { e.preventDefault(); vraPress(1); } return; }
      if (PC.cpr && (k === 'c' || k === ' ') && !e.repeat) { e.preventDefault(); cprPress(); }
      else if (/^[1-4]$/.test(k) && !e.repeat) { e.preventDefault(); choosePublic(Number(k) - 1); }
      return;
    }
    if (S.mode === 'pdead') return;
    if (MOVE.includes(k) || k === ' ') e.preventDefault();
    keys.add(k);
    if (k === 'c' && !e.repeat && S.mode === 'walk' && nearest()?.kind === 'water') { drinkCoffee(); return; }
    if ((k === 'e' || k === ' ' || k === 'enter') && !e.repeat) act();
    if (k === 'm' && !e.repeat) S.map = !S.map;
    if (k === 'b' && !e.repeat) sendBreak();
    if (k === 'n' && !e.repeat) internBreak();
    if (k === '1' && S.mode === 'chat' && !$('dTeach').hidden) teachIntern();
    if (k === ']' && DEBUG) { S.t = Math.min(END, S.t + 30); toast(`（測試）時間快轉到 ${fmt(S.t)}`, 1.5); }
    if (k === 'escape' && S.mode === 'false') closeScripted();
    if (k === 'escape' && S.mode === 'chat') closeChat();
  });
  window.addEventListener('keyup', e => { keys.delete(e.key.toLowerCase()); DRIP.keys.delete(e.key.toLowerCase()); });
  window.addEventListener('blur', () => keys.clear());
  frame.addEventListener('pointerdown', e => { if (!e.target.closest('input, button, select')) frame.focus(); });
  // the thumb stick: x to the right, y up the screen, each -1..1; past STICK_RUN the doctor runs.
  // It floats: the thumb goes down anywhere in the lower-left corner and the ring centres under it,
  // kept whole inside the corner, so a big phone need not reach for one spot; let go and it drifts back.
  const stick = { x: 0, y: 0, mag: 0 }, STICK_DEAD = 0.2, STICK_RUN = 0.85;
  const stickZone = $('stickZone'), stickEl = $('stick'), knob = $('stickKnob');
  let centre = null;
  function stickAt(e) {
    const { x, y, R } = centre;
    let dx = (e.clientX - x) / R, dy = (y - e.clientY) / R;
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    Object.assign(stick, { x: dx, y: dy, mag: Math.min(1, m) });
    knob.style.transform = `translate(${dx * R * 0.58}px, ${-dy * R * 0.58}px)`;
    stickEl.classList.toggle('run', stick.mag > STICK_RUN && S.energy >= TIRED);
  }
  // the thumb on the stick is followed by its pointer id; capture keeps it when it slides out of the corner
  let stickId = null;
  function stickOff() { stickId = null; Object.assign(stick, { x: 0, y: 0, mag: 0 }); knob.style.transform = stickEl.style.transform = ''; stickEl.classList.remove('on', 'run'); }
  stickZone.addEventListener('pointerdown', e => {
    e.preventDefault(); stickId = e.pointerId;
    try { stickZone.setPointerCapture(e.pointerId); } catch { /* the stick still follows this pointer */ }
    // offsetLeft/Top is where the ring rests, before any transform
    const z = stickZone.getBoundingClientRect(), R = stickEl.offsetWidth / 2;
    const cx = Math.min(Math.max(e.clientX - z.left, R), z.width - R), cy = Math.min(Math.max(e.clientY - z.top, R), z.height - R);
    centre = { x: z.left + cx, y: z.top + cy, R };
    stickEl.classList.add('on');
    stickEl.style.transform = `translate(${cx - R - stickEl.offsetLeft}px, ${cy - R - stickEl.offsetTop}px)`;
    stickAt(e);
  });
  stickZone.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickAt(e); });
  ['pointerup', 'pointercancel'].forEach(ev => stickZone.addEventListener(ev, e => { if (e.pointerId === stickId) stickOff(); }));
  stickZone.addEventListener('lostpointercapture', e => { if (e.pointerId === stickId) stickOff(); });
  // phones: put the page sideways where the browser allows it (Android, from a tap, in full
  // screen); elsewhere the cover in index.html asks for the phone to be turned, and turning it
  // upright mid-shift stops the clock
  const PHONE = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 600;
  function goSideways() {
    if (!PHONE || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
  const upright = matchMedia('(pointer: coarse) and (orientation: portrait) and (max-width: 600px)');
  upright.addEventListener('change', () => { if (upright.matches) { stickOff(); setPaused(true); } });
  $('touchAct').addEventListener('click', act);

  // ---------- pause ----------
  // the whole shift stands still: the clock, the patients, the phone, the labs, the player's
  // needs. Whatever was open (the bedside, a call, a lab report) is still there on resume.
  let resumeFocus = null;
  function setPaused(on) {
    if (on === S.paused || (on && (!S.started || S.ended))) return;
    S.paused = on;
    keys.clear();
    // chest compressions are timed in real time: a pause starts them over
    if (on && PC.cpr) { PC.cpr.times = []; $('pcCount').textContent = `0 / ${CPR.presses}`; $('pcRate').textContent = '暫停過了，從第一下重新開始壓'; }
    $('pause').hidden = !on;
    if (on) { resumeFocus = document.activeElement; $('pauseGo').focus(); }
    else (resumeFocus?.isConnected && resumeFocus !== document.body ? resumeFocus : frame).focus();
  }
  $('btnPause').addEventListener('click', () => setPaused(true));
  $('pauseGo').addEventListener('click', () => setPaused(false));
  // a hidden tab draws no frames anyway; coming back to it paused gives the player a moment
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') setPaused(true); });

  // ---------- movement ----------
  // The player is a circle among the floor's boxes. It is a little slimmer than the shoulders
  // (0.3) so a 1 m door and a room's aisle leave room to spare; a nurse waiting at a bed's foot
  // stands in that aisle, so she is a small circle the player slides round, not a box.
  const R = 0.25, NURSE_R = 0.15;
  function collide(p) {
    for (let it = 0; it < 3; it++) {
      for (const b of solids) {
        const cx = Math.max(b[0], Math.min(p.x, b[2])), cz = Math.max(b[1], Math.min(p.z, b[3]));
        const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        if (d2 > 1e-9) { const d = Math.sqrt(d2), k = (R - d) / d; p.x += dx * k; p.z += dz * k; }
        else {
          const opts = [[b[0] - R - p.x, 0], [b[2] + R - p.x, 0], [0, b[1] - R - p.z], [0, b[3] + R - p.z]];
          opts.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
          p.x += opts[0][0]; p.z += opts[0][1];
        }
      }
      for (const n of Object.values(nurseByBed)) {
        if (!n.visible) continue;
        const dx = p.x - n.position.x, dz = p.z - n.position.z, d = Math.hypot(dx, dz), min = R + NURSE_R;
        if (d >= min) continue;
        if (d > 1e-6) { p.x += dx / d * (min - d); p.z += dz / d * (min - d); } else p.x += min;
      }
    }
    p.x = Math.max(X0 + R, Math.min(X1 - R, p.x)); p.z = Math.max(ZB + R, Math.min(ZF - R, p.z));
  }
  // Pressed into a wall a hand's width beside a door (or into the nurse, or a bed's corner), the
  // player used to stand pinned against the edge. When a step gets almost nowhere, feel to each
  // side, a short step at a time so the feeler cannot pass through a wall, for the nearest spot
  // with the way ahead open, and slide toward it. `slideSide` remembers the last choice so the
  // player does not flicker between two openings.
  let slideSide = 1;
  function walkStep(p, dir, d) {
    const x = p.x, z = p.z;
    p.x += dir.x * d; p.z += dir.z * d; collide(p);
    if (Math.hypot(p.x - x, p.z - z) > d * 0.3) return;
    const tx = -dir.z, tz = dir.x;
    let best = null;
    for (const s of [slideSide, -slideSide]) {
      const q = { x, z };
      for (let i = 1; i <= 8; i++) {
        const lx = q.x, lz = q.z;
        q.x += tx * s * 0.07; q.z += tz * s * 0.07; collide(q);
        if ((q.x - lx) * tx * s + (q.z - lz) * tz * s < 0.035) break;
        const f = { x: q.x + dir.x * 0.3, z: q.z + dir.z * 0.3 }; collide(f);
        if ((f.x - q.x) * dir.x + (f.z - q.z) * dir.z > 0.285) { if (!best || i < best.i) best = { i, s }; break; }
      }
    }
    if (!best) return;
    slideSide = best.s;
    p.x = x + tx * slideSide * d; p.z = z + tz * slideSide * d; collide(p);
  }
  const fwd = new THREE.Vector3(-Math.sin(YAW), 0, -Math.cos(YAW)), right = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW));
  let walkPhase = 0;
  function move(dt) {
    let ix = 0, iz = 0;
    if (keys.has('arrowup') || keys.has('w')) iz += 1;
    if (keys.has('arrowdown') || keys.has('s')) iz -= 1;
    if (keys.has('arrowright') || keys.has('d')) ix += 1;
    if (keys.has('arrowleft') || keys.has('a')) ix -= 1;
    const thumb = stick.mag > STICK_DEAD;
    if (thumb) { ix = stick.x; iz = stick.y; }
    const { legs, arms } = player.userData;
    if (S.mode !== 'walk' || (!ix && !iz)) {
      walkPhase = 0; legs.forEach(l => { l.rotation.x *= 0.7; }); arms.forEach(a => { a.rotation.x *= 0.7; });
      return;
    }
    const dir = new THREE.Vector3().addScaledVector(right, ix).addScaledVector(fwd, iz).normalize();
    // Shift, or the stick pushed to its rim, runs; under 20% there is nothing left to run on
    // (TIRED), and a short reminder says so
    const wantRun = keys.has('shift') || (thumb && stick.mag > STICK_RUN);
    const run = wantRun && S.energy >= TIRED;
    if (wantRun && !run && performance.now() > (S.noRunAt || 0)) { S.noRunAt = performance.now() + 8000; toast('精力不到 20%，跑不動了。', 2.5); }
    const speed = (run ? 4.6 : 2.9) * (S.energy < 15 ? 0.75 : 1) * 1.3;
    // a slow frame moves the full distance, in steps short enough that a wall cannot be skipped
    const steps = Math.ceil(dt / 0.04);
    for (let i = 0; i < steps; i++) walkStep(player.position, dir, speed * dt / steps);
    if (run) S.energy = Math.max(0, S.energy - dt * 0.4 * spend());
    const target = Math.atan2(dir.x, dir.z);
    let diff = target - player.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.rotation.y += diff * Math.min(1, dt * 14);
    walkPhase += dt * speed * 3.4;
    const sw = Math.sin(walkPhase) * 0.6;
    legs[0].rotation.x = sw; legs[1].rotation.x = -sw; arms[0].rotation.x = -sw * 0.7; arms[1].rotation.x = sw * 0.7;
  }

  // ---------- loop ----------
  // A patient is on a bench from the ring until the case is opened, with patience that drains over
  // the same 30 game minutes after which publicTick makes them worse; then they are in the booth.
  function updatePatients(asleep) {
    const real = id => CASES[id]?.kind === 'public' && S.calls[id].state === 'active';
    const waiting = Object.keys(S.calls).filter(id => real(id) && !S.calls[id].opened).sort((a, b) => S.calls[a].since - S.calls[b].since);
    WAIT_SEATS.forEach((seat, i) => {
      const id = waiting[i], tag = waitTags[i];
      waiters[i].visible = !!id; tag.hidden = !id || asleep;
      if (!id) return;
      const left = Math.max(0, Math.min(1, 1 - (S.t - S.calls[id].since) / patienceOf(id))), n = Math.ceil(left * 5);
      const html = `耐心 ${'●'.repeat(n)}${'○'.repeat(5 - n)}`, lbl = tag.querySelector('.lbl');
      if (lbl.textContent !== html) lbl.textContent = html;
      lbl.style.color = left < 0.34 ? '#ff6b6b' : left < 0.67 ? '#ffc857' : '';
      setPos(tag, project(v3.set(seat[0], 1.55, seat[1])));
    });
    ROOMS.forEach((r, i) => { boothSitters[i].visible = Object.keys(S.calls).some(id => real(id) && S.calls[id].opened && CASES[id].bed === r.n); });
  }
  function updateMarks() {
    const n = nearest(), now = performance.now(), asleep = S.mode === 'sleep' || S.mode === 'scall';
    for (const id of Object.keys(S.calls)) {
      const c = S.calls[id], el = markFor(id), edge = edges[id];
      el.hidden = asleep || !(c.state === 'active' || now < (c.flashUntil || 0));
      if (el.hidden) { edge.hidden = true; continue; }
      if (c.state === 'active') { el.className = `mk ${levelOf(id)}`; edge.className = `edge ${levelOf(id)}`; }
      const v = project(nurseByBed[CASES[id].bed].position.clone().setY(2.3));
      setPos(el, v);
      const off = Math.abs(v.x) > 0.94 || Math.abs(v.y) > 0.9;
      edge.hidden = !(off && c.state === 'active' && S.mode === 'walk');
      if (!edge.hidden) {
        // pointing down, it stops above the goal line at the foot of the screen
        const s = Math.max(Math.abs(v.x) / 0.84, v.y > 0 ? v.y / 0.76 : -v.y / 0.62);
        const ex = v.x / s, ey = v.y / s;
        edge.style.left = `${((ex + 1) / 2 * 100).toFixed(2)}%`; edge.style.top = `${((1 - ey) / 2 * 100).toFixed(2)}%`;
        edge.querySelector('i').style.setProperty('--a', `${Math.atan2(-v.y, v.x)}rad`);
      }
    }
    const p = player.position;
    roomTags.forEach(({ p: pp, el }) => {
      el.hidden = asleep || (!S.map && Math.hypot(p.x - pp.x, p.z - pp.z) > 6.5);
      if (!el.hidden) setPos(el, project(pp));
    });
    placeTags.forEach(({ p: pp, el, near }) => {
      el.hidden = asleep || (!!near && !S.map && Math.hypot(p.x - pp.x, p.z - pp.z) > near);
      if (!el.hidden) setPos(el, project(pp));
    });
    bentoTag.hidden = S.eaten >= 100 || S.mode === 'eat' || asleep || S.t < PACE.dinnerAt;
    bento.visible = S.t >= PACE.dinnerAt;
    if (!bentoTag.hidden) { bentoTag.querySelector('.lbl').textContent = S.t >= PACE.spoilAt ? '便當（臭酸了）' : S.eaten > 0 ? '便當（涼了）' : '便當'; setPos(bentoTag, project(v3.set(...ONCALL.bento))); }
    zzz.hidden = !asleep;
    if (!zzz.hidden) setPos(zzz, project(v3.set(...ONCALL.zzz)));
    updatePatients(asleep);
    prompt.hidden = !n;
    if (n) { $('promptKey').textContent = n.key; $('promptText').textContent = n.label; setPos(prompt, project(player.position.clone().setY(2.2))); }
  }
  let last = performance.now(), pulse = 0;
  // adaptive resolution: an integrated GPU on a large floor can drop to a few frames a second,
  // and the walk runs in slow motion below 20 (dt is capped), so trade pixels for frames
  const perf = { frames: 0, time: 0, since: performance.now() };
  function adapt(rawDt) {
    if (document.visibilityState !== 'visible' || rawDt > 0.5 || performance.now() - perf.since < 4000) return;
    perf.frames++; perf.time += rawDt;
    if (perf.time < 2) return;
    const fps = perf.frames / perf.time;
    perf.frames = 0; perf.time = 0;
    const next = fps < 20 ? Math.max(0.75, quality - 0.1) : fps > 45 ? Math.min(1, quality + 0.1) : quality;
    if (next !== quality) { quality = next; resize(); }
  }
  function runFrame(now) {
    const rawDt = Math.max(0, (now - last) / 1000), dt = Math.min(0.12, rawDt); last = now;
    adapt(rawDt);
    if (S.started && !S.ended && !S.paused) {
      // game minutes per real second: sleep fast-forwards, a bed runs slow so the choices are not
      // a race against the clock, a ringing phone waits
      const rate = S.mode === 'sleep' ? PACE.sleep : S.mode === 'pcase' ? (PCASE[S.current]?.pace ? PCASE[S.current].pace / 60 / PUBLIC_PACE : PACE.pcase * (PCASE[S.current]?.hard ? 2.2 : 1)) : S.mode === 'scall' || S.mode === 'recall' || S.mode === 'pdead' ? 0
        : S.mode === 'walk' && !activeIds().length ? PACE.quiet : PACE.walk;
      const gm = dt * rate * PUBLIC_PACE;
      S.t += gm;
      if (S.mode === 'pcase' && PC.v2 && !PC.done && !PC.cpr && !DRIP.active) { PC.pat = Math.max(0, PC.pat - gm * 5); patienceCheck(); }
      if (VRA.active) vraTick(dt);
      if (BLK.active) blkTick(dt);
      if (DRIP.active) dripTick(dt);
      // asleep, the bar fills from empty in about 3 hours 40 minutes (it used to take under 2), so a
      // night can hold six to eight hours of sleep; everything that spends it -- the hours awake,
      // running, a call that wakes you -- was halved with it on 普通班 (SPEND), and is not on 大爛班
      if (S.mode === 'sleep') { S.energy = Math.min(100, S.energy + gm * 0.45); S.stats.sleptMin += gm; }
      else S.energy = Math.max(0, S.energy - gm * 0.045 * spend() * (S.full <= 0 ? 2 : S.full < 20 ? 1.5 : 1));
      S.full = Math.max(0, S.full - gm * (S.eaten < 100 && S.t >= PACE.spoilAt ? 0.3 : S.eaten < 100 && S.t >= PACE.dinnerAt ? 0.16 : 0.1));
      if (S.colleagueBreak) {
        S.colleague = Math.min(100, S.colleague + gm * BREAK_GAIN / BREAK_MIN);
        if (S.t >= S.colleagueBreak.until) { S.colleagueBreak = null; S.breakReadyAt = S.t + BREAK_COOLDOWN; toast('同事休息完回來了，精神好多了。', 3.5, 'nurse_thankful'); }
      } else if (!S.colleagueGone) { S.colleague = Math.max(0, S.colleague - gm * 0.03); checkColleague(); }
      if (S.intern && !S.intern.gone) {
        const I = S.intern;
        if (I.brk) { I.energy = Math.min(100, I.energy + gm * BREAK_GAIN / BREAK_MIN); if (S.t >= I.brk.until) { I.brk = null; I.readyAt = S.t + BREAK_COOLDOWN; toast('敏心休息完回來了。', 3.5, 'nurse_thankful'); } }
        else { I.energy = Math.max(0, I.energy - gm * 0.03); checkColleague(); }
      }
      S.bladder = Math.min(100, S.bladder + gm * 0.15);
      move(dt);
      if (S.mode === 'eat') {
        S.eaten = Math.min(100, S.eaten + dt * 5.5 * 1.8);
        S.energy = Math.min(100, S.energy + dt * (S.cold ? 0.4 : 0.9));
        S.full = Math.max(S.full, 12 + S.eaten * 0.85);
        $('eatBar').style.width = `${S.eaten}%`; $('eatPct').textContent = `${Math.round(S.eaten)}%`;
        if (!S.interrupted && S.eaten >= S.interruptAt * 100) {
          S.interrupted = true;
          S.mode = 'interrupt';
          $('iText').textContent = publicText(night.dinner); $('interruptMe').src = ME('eating');
          $('interrupt').hidden = false;
        } else if (S.eaten >= 100) stopEat('便當吃完了，精力回來一點。');
      }
      // a full bar does not wake the doctor: sleep goes on until the phone, the bladder or E
      if (S.mode === 'sleep') {
        if (S.energy >= 100 && !S.fullNoted) { S.fullNoted = true; toast('精力補滿了。想起床就按 E，也可以繼續睡。', 4); }
        $('sleepBar').style.width = `${S.energy}%`; $('sleepPct').textContent = `${Math.round(S.energy)}%`;
      }
      publicTick();
      if (S.labs.some(l => !l.ready && S.t >= l.readyAt)) labsArrive();
      if (!S.sourNoted && S.eaten < 100 && S.t >= PACE.spoilAt) { S.sourNoted = true; toast('錯過午餐時間，便當臭酸了不能吃。肚子會掉得更快，趕快找點心。', 6); }
      if (!S.dinnerNoted && S.t >= PACE.dinnerAt) { S.dinnerNoted = true; toast('姚雯：「聽力師，你的午餐送到茶水間了，有空趕快去吃。」', 5, 'nurse_caring'); }
      if (S.t >= END || (S.t >= OFF && S.mode === 'walk' && !activeIds().some(isPatient))) endShift();
      // tiredness: a warning at 20% and at 10%, and at 0% the doctor drops -- but never in the
      // middle of a patient, a call or compressions: the moment they are back on their feet
      if (S.energy < TIRED && !S.warned20) { S.warned20 = true; toast('精力剩 20%，跑不動了。找空檔去辦公室躺一下。', 5); }
      if (S.energy < 10 && !S.warned10) { S.warned10 = true; toast('精力剩 10%……眼皮好重。再不休息，就要撐不住了。', 5); }
      // hunger: said once as it bites and once when it is empty; eating again resets it
      if (S.full < 20 && !S.hungry20) { S.hungry20 = true; toast('肚子好餓，頭有點暈……餓著做事，精力掉得比較快。', 5); }
      if (S.full <= 8 && !S.hungry0) { S.hungry0 = true; toast('餓到手在發抖，快低血糖了！再不吃東西，就要被送急診。', 6); }
      if (S.full >= 30) S.hungry20 = S.hungry0 = false;
      // a full bladder: it wakes a sleeping doctor, and nags an awake one until they go (never at a bed)
      if (S.bladder < 100) S.bladFullAt = null;
      if (S.bladder >= 100) {
        S.looFull = true;
        if (S.bladFullAt == null) S.bladFullAt = S.t;
        else if (S.t - S.bladFullAt >= 60 && !S.ended) { S.infected = true; keys.clear(); endShift(); }
        if (S.mode === 'sleep') stopSleep('憋不住了，被尿意叫醒。');
        else if ((S.mode === 'walk' || S.mode === 'eat') && performance.now() > (S.looNagAt || 0)) {
          S.looNagAt = performance.now() + 9000;
          toast(pickN(['憋不住了！快去廁所！', '尿意已經滿了，走路都要夾著走……快去廁所！', '再不去廁所，真的要漏出來了！'], 1)[0], 4);
        }
      }
      if (S.full <= 0 && !S.ended && !S.hypo) { S.hypo = true; keys.clear(); endShift(); }
      if (S.energy >= 30) S.warned20 = S.warned10 = false;
      if (S.energy <= 0 && S.mode === 'walk' && !S.ended) { S.collapsed = true; keys.clear(); endShift(); }
      if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').hidden = true; }
      hudTimer -= dt; if (hudTimer <= 0) { hudTimer = 0.25; renderHud(); if (S.mode === 'pcase') { publicLabButton(); if (PC.v2 && !VRA.active && !BLK.active && !DRIP.active) { pcPatience(); availCheck(); } if (PC.waitReport) waitTick(); } }
    }
    if (!S.paused) pulse += dt;
    if (S.started && !S.ended && !S.paused) updateStaff(dt);
    let redBed = null, amberBed = null;
    for (const id of activeIds()) {
      const c = CASES[id], red = levelOf(id) === 'red';
      lamps[c.bed].material = red ? lampMat.red : lampMat.amber;
      if (red && !redBed) redBed = c.bed; else if (!red && !amberBed) amberBed = c.bed;
    }
    { const ids = activeIds(); phoneLamp.material = ids.length ? (ids.some(id => levelOf(id) === 'red') ? lampMat.red : lampMat.amber) : lampOff; }
    const k = 0.65 + 0.35 * Math.sin(pulse * 6);
    // high on the headwall beside the call lamp, so whoever stands over the bed is not lit like a lantern
    if (redBed) { alarmRed.position.set(BED[redBed].x0 + 0.55, 2.35, BED[redBed].z); alarmRed.intensity = 5 * k; } else alarmRed.intensity = 0;
    if (amberBed) { alarmAmber.position.set(BED[amberBed].x0 + 0.55, 2.35, BED[amberBed].z); alarmAmber.intensity = 2.5 * k; } else alarmAmber.intensity = 0;
    steam.forEach((s, i) => { const q = (pulse * 0.5 + i / 3) % 1; s.position.y = 0.12 + q * 0.25; s.scale.setScalar(0.6 + q); s.visible = S.eaten < 100 && !S.cold; });
    updateCamera(dt);
    composer.render();
    updateMarks();
  }
  function frameLoop(now) { runFrame(now); requestAnimationFrame(frameLoop); }
  updateCamera(0, true);
  // compile every material up front: otherwise each part of the floor stalls the first time
  // it comes into view, which on an integrated GPU freezes the walk for a second or two
  renderer.compile(scene, cam);
  renderHud();
  $('loading').hidden = true;
  $('start').hidden = false;
  // index.html?debug exposes a handle for scripted playtests; on its own it changes nothing but ]
  if (DEBUG) {
    window.__ward = { S, night, CASES, PC, arrive, VRA, calcFavor, TALKERS, openChat, step: (n = 1) => { for (let i = 0; i < n; i++) runFrame(last + 1000 / 60); }, publicCall, publicTick, openPublicCase, BED, WARD, renderer, scene, composer, solids, openCase, spawnCase, startSleep, place, get player() { return player; }, get quality() { return quality; } };
  }
  requestAnimationFrame(frameLoop);
}
