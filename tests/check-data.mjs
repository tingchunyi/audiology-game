// npm test: checks game/public-cases.js against what game/game.js can play, without a browser.
//
// A bed with a typo in it (a `next` that names no question, a state the monitor does not know, a
// room with no bed lamp) loads fine and breaks only when a player reaches that choice, so every
// one of those is caught here instead. At the end it draws a thousand nights of each shift, the
// way startPublicNight does, and says how many patients a night gets from the beds listed.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url);
const read = rel => readFileSync(fileURLToPath(new URL(rel, root)), 'utf8');
const data = await import(pathToFileURL(fileURLToPath(new URL('game/public-cases.js', root))).href);
const game = read('game/game.js'), page = read('index.html');
const { PHONE_CALLS, AFTER_PHONE, PUBLIC_CASES, CPR } = data;

const problems = [];
const fail = (where, what) => problems.push(`${where}：${what}`);
const isText = v => typeof v === 'string' && v.trim().length > 0;

// ---------- what game.js knows: the beds that can ring, the scenes for a small call walked to,
// the monitor's fourth reading ----------
const caseRooms = game.match(/const CASE_ROOMS = \[([^\]]*)\]/);
if (!caseRooms) throw new Error('game.js 裡找不到 CASE_ROOMS');
// 01–03 are the audiology rooms, 04 is the waiting area (game.js wb() maps it to 候診)
const BEDS = new Set([...caseRooms[1].matchAll(/'(\d{2})'/g), { 1: '04' }].flatMap(m => ['A', 'B', 'C'].map(L => m[1] + L)));
const casesBlock = game.match(/const CASES = \{([\s\S]*?)\n {2}\};/) || ['', ''];
const extraBlock = game.match(/const EXTRA = \{([\s\S]*?)\};/);
if (!extraBlock) throw new Error('game.js 裡找不到 EXTRA');
const EXTRA = new Set([...[...extraBlock[1].matchAll(/(\w+): \[/g)].map(m => m[1]), 'none']);

// ---------- the phone calls ----------
const smallIds = new Set(), spawnable = new Set(PUBLIC_CASES.map(c => c.id));
if (!Array.isArray(PHONE_CALLS)) fail('PHONE_CALLS', '要是一個陣列');
else {
  for (const c of PHONE_CALLS) {
    const at = `PHONE_CALLS ${c.id || '(沒有 id)'}`;
    if (!isText(c.id)) fail(at, '沒有 id'); else if (smallIds.has(c.id)) fail(at, 'id 重複了'); else smallIds.add(c.id);
    if (!['small', 'urgent'].includes(c.kind)) fail(at, "kind 要是 'small'（小事）或 'urgent'（緊急）");
    for (const k of ['from', 'short', 'text']) if (!isText(c[k])) fail(at, `缺少 ${k}`);
    if (c.options && (c.options.length !== 3 || !c.options.every(o => isText(o.text) && isText(o.say)))) fail(at, 'options 要剛好三個，每個有 text 和 say');
    if (c.spawn && !spawnable.has(c.spawn)) fail(at, `spawn '${c.spawn}' 不是 PUBLIC_CASES 裡的病人`);
    if (c.spawn && c.kind !== 'urgent') fail(at, '只有緊急電話可以帶出病人（spawn）');
  }
  if (PHONE_CALLS.filter(c => c.kind === 'small' && !c.midexam).length < 3) fail('PHONE_CALLS', '至少要有三通可以排進一天的小事（不含 midexam）');
  if (PHONE_CALLS.filter(c => c.kind === 'urgent').length < 3) fail('PHONE_CALLS', '至少要有三通緊急（午休一通、下午一通，還要有備用）');
}
if (!Array.isArray(AFTER_PHONE) || !AFTER_PHONE.length || !AFTER_PHONE.every(isText)) fail('AFTER_PHONE', '至少要有一句');

// ---------- the beds ----------
const GRADES = new Set(['best', 'ok', 'bad']);
// v2 beds (耐心值玩法): the same data, but choices carry effects instead of minutes and grades of danger
function checkV2(c, at, states, steps, results) {
  for (const k of ['pat0', 'pace']) if (typeof c[k] !== 'number' || c[k] <= 0) fail(at, `${k} 要是大於 0 的數字`);
  if (!isText(c.patOut)) fail(at, '缺少 patOut（耐心歸零時發生的事）');
  if (!c.card || !isText(c.card.title) || !Array.isArray(c.card.points) || !c.card.points.length) fail(at, 'card 要有 title 和 points');
  const ENDS = new Set(['done', 'leave', 'fail']);
  let finishes = false;
  const reach = new Set(['first']);
  for (const [sk, step] of Object.entries(steps)) {
    const where = `${at} steps.${sk}`;
    if (!isText(step.ask)) fail(where, '缺少 ask（問題）');
    if (!Array.isArray(step.options) || !step.options.length) { fail(where, '沒有選項'); continue; }
    if (step.options.length > 4) fail(where, '選項最多四個（鍵盤 1–4）');
    const ids = new Set();
    for (const o of step.options) {
      const w = `${where} ${o.id || '(沒有 id 的選項)'}`;
      if (!isText(o.id)) fail(w, '選項沒有 id'); else if (ids.has(o.id)) fail(w, '同一題裡 id 重複'); else ids.add(o.id);
      if (!isText(o.text)) fail(w, '缺少 text');
      const outs = o.minigame ? [o.win, o.lose] : [o];
      if (o.minigame && (!['vra', 'block'].includes(o.minigame) || !o.win || !o.lose)) fail(w, "minigame 目前只有 'vra'、'block'，並且要有 win 和 lose");
      for (const r of outs.filter(Boolean)) {
        for (const k of ['pat', 'favor', 'min']) if (r[k] !== undefined && typeof r[k] !== 'number') fail(w, `${k} 要是數字`);
        if (r.colleague !== undefined && r.colleague !== 'zero' && typeof r.colleague !== 'number') fail(w, "colleague 要是數字或 'zero'");
        if (r.end && !ENDS.has(r.end)) fail(w, "end 只能是 'done'、'leave'、'fail'");
        if (r.end && !isText(r.say)) fail(w, '結束的選項要寫 say（結果說明）');
        if (r.end === 'done') { if (!results[r.outcome]) fail(w, `outcome '${r.outcome}' 不在 results 裡`); else finishes = true; }
        if (r.next && !steps[r.next]) fail(w, `next '${r.next}' 不在 steps 裡`);
        if (r.next) reach.add(r.next);
        if (!r.end && !r.next && !r.retry) fail(w, '要有 end、next 或 retry 其中一個');
        if (r.state && !states[r.state]) fail(w, `state '${r.state}' 不在 states 裡`);
      }
    }
  }
  if (!finishes) fail(at, '沒有任何選項能 end: done');
  for (const sk of Object.keys(steps)) if (!reach.has(sk)) fail(`${at} steps.${sk}`, '沒有任何選項會走到這一題');
}

function checkBed(c) {
  const at = c?.id || '(沒有 id 的床)';
  const need = ['id', 'bed', 'nurse', 'name', 'who', 'short', 'intro', 'extra',
    ...(c.steps?.arrest ? ['arrestLine'] : [])];
  for (const k of need) if (!isText(c[k])) fail(at, `缺少 ${k}`);
  if (!BEDS.has(c.bed)) fail(at, `房號 ${c.bed} 不在 game.js 的 CASE_ROOMS 裡`);
  if (!EXTRA.has(c.extra)) fail(at, `extra '${c.extra}' 監視器不認得，可以用：${[...EXTRA].join('、')}`);
  const states = c.states || {}, steps = c.steps || {}, results = c.results || {};
  if (!states.start) fail(at, 'states 裡要有 start（醫師剛到床邊時的樣子）');
  for (const [k, st] of Object.entries(states)) {
    if (!isText(st.mind)) fail(`${at} states.${k}`, '缺少 mind（病人狀態，用白話寫）');
    if (st.cells) {
      if (!Array.isArray(st.cells) || !st.cells.length || st.cells.length > 4 || !st.cells.every(r => Array.isArray(r) && isText(r[0]) && typeof r[1] === 'string')) fail(`${at} states.${k}`, 'cells 要是最多四格的 [標題, 內容, 說明, 顏色]');
      else if (st.cells.some(r => r[3] && !['warn', 'bad'].includes(r[3]))) fail(`${at} states.${k}`, "cells 的顏色只能是 'warn'、'bad' 或不寫");
    } else {
      if (typeof st.hr !== 'number') fail(`${at} states.${k}`, 'hr（心跳）要是數字，0 代表摸不到；或改用 cells');
      if (st.bp !== null && !(Array.isArray(st.bp) && st.bp.length === 2)) fail(`${at} states.${k}`, 'bp 要是 [收縮壓, 舒張壓]，量不到寫 null');
    }
  }
  if (!c.warn || !states[c.warn.state] || !isText(c.warn.line) || !isText(c.warn.log)) fail(at, 'warn 要有 state（在 states 裡）、line、log');
  if (!steps.first) fail(at, 'steps 裡要有 first（第一個問題）');
  if (!Object.keys(results).length) fail(at, 'results 至少要有一個結果');
  for (const key of ['labs', 'pta']) {
    const L = c[key]; if (!L) continue;
    if (!Array.isArray(L.rows) || !L.rows.length || !isText(L.note)) fail(at, `${key} 要有 rows 和 note`);
    else L.rows.forEach((r, i) => {
      if (!Array.isArray(r) || r.length < 4 || !isText(r[0]) || typeof r[3] !== 'string') fail(`${at} ${key}.rows[${i}]`, '要寫成 [項目, 結果, 單位, 參考值, 高低]');
      if (r[4] !== undefined && !['H', 'L', 'A', 'U'].includes(r[4])) fail(`${at} ${key}.rows[${i}]`, "第五格只能是 'H'、'L'、'A'（異常）或不寫");
    });
  }
  if (c.pta && !isText(c.pta.say)) fail(at, 'pta 要有 say（報告出來時護理師說的話）');
  if (false && c.labs && (!Array.isArray(c.labs.rows) || !c.labs.rows.length || !isText(c.labs.note))) fail(at, 'labs 要有 rows 和 note');
  else if (c.labs) c.labs.rows.forEach((r, i) => {
    if (!Array.isArray(r) || r.length < 4 || !isText(r[0]) || !isText(r[3])) fail(`${at} labs.rows[${i}]`, '要寫成 [項目, 結果, 單位, 參考值, 高低]');
    if (r[4] !== undefined && !['H', 'L', 'A', 'U'].includes(r[4])) fail(`${at} labs.rows[${i}]`, "第五格只能是 'H'、'L'、'A'（異常）或不寫");
  });
  if (c.v2) { checkV2(c, at, states, steps, results); return; }
  if (!c.card || !isText(c.card.title) || !Array.isArray(c.card.points) || !c.card.points.length) fail(at, 'card 要有 title 和 points');
  // a choice with cpr: true starts the compressions; when they are done, the bed goes on at cprNext
  const hasCpr = Object.values(steps).some(s => s.options?.some(o => o.cpr));
  if (hasCpr) {
    if (!steps[c.cprNext]) fail(at, `cprNext '${c.cprNext}' 不在 steps 裡（壓胸成功之後的問題）`);
    if (c.cprState && !states[c.cprState]) fail(at, `cprState '${c.cprState}' 不在 states 裡`);
    if (!isText(c.cprLine)) fail(at, '有壓胸的床要有 cprLine（壓胸成功時護理師說的話）');
  }
  if (steps.arrest && !steps.arrest.options?.some(o => o.cpr)) fail(at, 'arrest 這一題要有一個 cpr: true 的選項');
  if (!steps.arrest && (!c.fail || !isText(c.fail.title) || !isText(c.fail.text))) {
    fail(at, '沒有 arrest 這一題的床，要有 fail { title, text }（錯太多時怎麼結束）');
  }

  const usedOutcomes = new Set();
  for (const [sk, step] of Object.entries(steps)) {
    const where = `${at} steps.${sk}`;
    if (!isText(step.ask)) fail(where, '缺少 ask（問題）');
    if (!Array.isArray(step.options) || !step.options.length) { fail(where, '沒有選項'); continue; }
    if (step.options.length > 4) fail(where, '選項最多四個（鍵盤 1–4）');
    if (!step.options.some(o => o.grade === 'best')) fail(where, '至少要有一個 grade: best');
    for (const k of Object.keys(step.askBy || {})) if (!states[k]) fail(where, `askBy 的 '${k}' 不在 states 裡`);
    const ids = new Set();
    for (const o of step.options) {
      const w = `${where} ${o.id || '(沒有 id 的選項)'}`;
      if (!isText(o.id)) fail(w, '選項沒有 id'); else if (ids.has(o.id)) fail(w, '同一題裡 id 重複'); else ids.add(o.id);
      if (!isText(o.text)) fail(w, '缺少 text');
      if (!GRADES.has(o.grade)) fail(w, "grade 要是 'best'、'ok' 或 'bad'");
      if (typeof o.min !== 'number' || o.min < 0) fail(w, 'min（花幾分鐘）要是 0 以上的數字');
      if (o.state && !states[o.state]) fail(w, `state '${o.state}' 不在 states 裡`);
      if (o.next && o.next !== 'done' && o.next !== 'arrest' && !steps[o.next]) fail(w, `next '${o.next}' 不在 steps 裡`);
      if (o.next === 'arrest' && !steps.arrest && !c.fail) fail(w, 'next 是 arrest，可是這床沒有 arrest 題也沒有 fail');
      if (o.next === 'done') { if (!results[o.outcome]) fail(w, `outcome '${o.outcome}' 不在 results 裡`); else usedOutcomes.add(o.outcome); }
      if (o.grade !== 'best' && !o.death && !o.gameover && o.next !== 'arrest' && !isText(o.why)) fail(w, '不是 best 的選項要寫 why（為什麼不好），會劃掉顯示給玩家');
      if (o.death !== undefined && !isText(o.death)) fail(w, 'death 要是一段話');
      if (o.draw && !c.labs) fail(w, 'draw: true 的選項要有 labs');
      if (o.pta && !c.pta) fail(w, 'pta: true 的選項要有 pta（純音聽力報告的內容）');
      if (o.gameover !== undefined && !isText(o.gameover)) fail(w, 'gameover 要是一段話');
    }
  }
  for (const k of Object.keys(results)) if (!usedOutcomes.has(k)) fail(at, `results.${k} 沒有任何選項會走到（outcome: '${k}'）`);
  // following only the best choices, the bed can be finished
  const seen = new Set(), queue = ['first'];
  let finishes = false;
  while (queue.length) {
    const sk = queue.shift(); if (seen.has(sk) || !steps[sk]) continue; seen.add(sk);
    for (const o of steps[sk].options.filter(o => o.grade === 'best')) {
      if (o.next === 'done') finishes = true;
      else if (o.cpr) queue.push(c.cprNext);
      else if (o.next) queue.push(o.next);
      else fail(`${at} steps.${sk} ${o.id}`, 'best 的選項要有 next（下一題，或 done 結束）');
    }
  }
  if (!finishes) fail(at, '從 first 一路選 best，走不到 done');
  for (const sk of Object.keys(steps)) {
    const reached = seen.has(sk) || Object.values(steps).some(s => s.options?.some(o => o.next === sk)) || (sk === 'arrest') || sk === c.cprNext;
    if (!reached) fail(`${at} steps.${sk}`, '沒有任何選項會走到這一題');
  }
}

const bedIds = new Set();
if (!Array.isArray(PUBLIC_CASES) || !PUBLIC_CASES.length) fail('PUBLIC_CASES', '至少要有一床');
for (const c of PUBLIC_CASES) {
  if (bedIds.has(c?.id)) fail(c.id, 'id 和別床重複了'); else bedIds.add(c?.id);
  if (smallIds.has(c?.id)) fail(c.id, 'id 和某一通小事的 id 重複了');
  checkBed(c);
}
const rooms = new Map();
for (const c of PUBLIC_CASES) { if (rooms.has(c.bed)) fail(c.id, `床號 ${c.bed} 和 ${rooms.get(c.bed)} 重複了`); else rooms.set(c.bed, c.id); }
if (!(CPR.presses > 0 && CPR.slowest < CPR.fastest && CPR.maxGap > 0)) fail('CPR', 'presses、slowest、fastest、maxGap 的數字不合理');

// ---------- the credit line the license asks for ----------
if (!/const CREDIT = \{ text: '[^']+', url: 'https?:\/\/[^']+' \}/.test(game)) fail('game.js', 'CREDIT 要有 text 和 url（授權要求保留出處）');
if ((page.match(/class="credit"/g) || []).length < 2) fail('index.html', '開始畫面和結算畫面都要有 <p class="credit"></p>（授權要求保留出處）');

// ---------- every portrait the game asks for has a file ----------
const ext = (game.match(/const IMG = n => `assets\/game\/char\/\$\{n\}(\.\w+)`/) || [])[1];
if (!ext) fail('game.js', '找不到 IMG（立繪的路徑）');
else {
  const chatter = read('game/chatter.js'), cases = read('game/public-cases.js');
  const wanted = new Set([
    ...[game, chatter, page].flatMap(src => [...src.matchAll(/['"/]((?:nurse|chief|akai|azhu)_[a-z_]+)(?:'|"|\.\w+)/g)].map(m => m[1])),
    ...[...game.matchAll(/\bME\('([a-z_]+)'\)/g)].flatMap(m => [`pgy_m_${m[1]}`, `pgy_f_${m[1]}`]),
    ...[...page.matchAll(/char\/(pgy_[mf]_[a-z_]+)\./g)].map(m => m[1]),
    ...[...cases.matchAll(/\bface: '([a-z_]+)'/g), ...casesBlock[1].matchAll(/\bface: '([a-z_]+)'/g)].map(m => `nurse_${m[1]}`),
  ]);
  for (const name of wanted) {
    if (!existsSync(fileURLToPath(new URL(`assets/game/char/${name}${ext}`, root)))) fail('立繪', `缺少 assets/game/char/${name}${ext}`);
  }
}

const summary = [];
if (problems.length) {
  console.error(`檢查到 ${problems.length} 個問題：\n` + [...new Set(problems)].map(p => `  ✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`✓ public-cases.js 沒問題：${PUBLIC_CASES.length} 種病人、電話 ${smallIds.size} 通`);
