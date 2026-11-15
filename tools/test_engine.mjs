// 引擎測試：node tools/test_engine.mjs
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const P = require(path.join(here, '..', 'data.js'));

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; if (fail < 30) console.log('FAIL', msg); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// 轉播站的不雅字詞過濾（有工作區時用 Worker 同一份）
const bwPath = path.join(here, '..', '..', '..', '互動遊戲', 'startup-island', 'presence-worker', 'badwords.js');
let hasBad = null;
if (existsSync(bwPath)) hasBad = (await import(pathToFileURL(bwPath).href)).hasBadWord;
const BAD = /[cfhklmnprwxz]/i;
const safe = (s, what) => { ok(s.length <= 24, what + ' 太長 ' + s); ok(!BAD.test(s), what + ' 含危險字母 ' + s); if (hasBad) ok(!hasBad(s), what + ' 被過濾 ' + s); };

// 1. 預設量表
P.PRESETS.forEach(p => {
  ok(p.crit.length >= 3 && p.crit.length <= P.MAX_CRIT, p.n + ' 項目數');
  ok(p.crit.reduce((a, c) => a + c.w, 0) === 100, p.n + ' 權重加總 100');
  p.crit.forEach(c => { ok(P.cleanCrit(c.n) === c.n, p.n + ' 項目名稱合法 ' + c.n); ok(c.h && c.h.length <= 30, '說明長度 ' + c.n); });
});

// 2. 老師狀態
for (let i = 0; i < 4000; i++) {
  const t = { gid: 10 + (i % 90), groups: 2 + (i % 19), cur: i % 21, ph: [0, 1, 2, 3, 9][i % 5], nc: 1 + (i % 6), self: !!(i & 1), comments: !!(i & 2), secs: (i * 37) % 1000 };
  const s = P.encT(t); safe(s, 'T');
  const d = P.decT(s);
  ok(d && d.gid === t.gid && d.groups === t.groups && d.cur === t.cur && d.ph === t.ph && d.nc === t.nc && d.self === t.self && d.comments === t.comments && d.secs === t.secs, 'T 還原 ' + s);
}
// 3. 學生狀態（窮舉組別與部分分數組合）
for (let gid = 10; gid < 100; gid += 7) for (let grp = 0; grp <= 20; grp++) {
  const j = P.encS({ k: 'join', gid, grp }); safe(j, 'J'); const dj = P.decS(j); ok(dj && dj.k === 'join' && dj.grp === grp && dj.gid === gid, 'J 還原');
  for (let pres = 1; pres <= 20; pres += 3) for (let n = 1; n <= 6; n++) for (let k = 0; k < 25; k++) {
    const sc = Array.from({ length: n }, (_, i) => 1 + ((k * 7 + i * 3 + pres + grp) % 5));
    const s = P.encS({ k: 'score', gid, grp, pres, s: sc }); safe(s, 'S');
    const d = P.decS(s); ok(d && d.k === 'score' && d.pres === pres && d.grp === grp && d.s.join('') === sc.join(''), 'S 還原 ' + s);
  }
}
// 全部 1～5 的六位數分數也檢查一次過濾
for (let x = 0; x < 15625; x++) { let v = x, sc = []; for (let i = 0; i < 6; i++) { sc.push(1 + v % 5); v = Math.floor(v / 5); } const s = P.encS({ k: 'score', gid: 37, grp: 4, pres: 11, s: sc }); if (hasBad) ok(!hasBad(s), 'S 窮舉過濾 ' + s); }
ok(P.decS('S|101203|0') === null && P.decS('S|101203|6') === null, '不合法分數');
ok(P.decT('旅人') === null && P.decS('旅人') === null, '被過濾的名字不解析');

// 4. 聊天
P.PRESETS.forEach(p => {
  const parts = P.encRubric(42, p.crit);
  parts.forEach(s => ok(s.length <= 60, '項目訊息長度'));
  const names = [].concat(...parts.map(s => P.decRubric(s).names));
  ok(names.join('|') === p.crit.map(c => c.n).join('|'), '項目還原 ' + p.n);
});
const longCrit = Array.from({ length: 6 }, (_, i) => ({ n: '很長很長的評分項目' + i, w: 1 }));
const lp = P.encRubric(11, longCrit); lp.forEach(s => ok(s.length <= 60, '長項目長度'));
ok([].concat(...lp.map(s => P.decRubric(s).names)).length === 6, '長項目分段還原');
ok(P.decRubric(lp[lp.length - 1]).n === lp.length, '分段總數');
const n1 = P.encNote(42, 3, '+', '投影片很漂亮，例子很生活化，聽得很清楚，結論可以再更明確一點，加油加油加油加油加油'); ok(n1.length <= 60, '評語長度');
const dn = P.decNote(n1); ok(dn && dn.pres === 3 && dn.sign === '+', '評語還原');
ok(P.decWho(P.encWho('  王小明<b>|  ')) === '王小明b', '名字清理');
ok(P.decTitle(P.encTitle(42, 5, '智慧農業：用感測器省水')).title === '智慧農業：用感測器省水', '題目還原');
ok(P.cleanWho('1234567890') === '12345678', '名字 8 字');

// 5. 計分
const crit = [{ n: 'A', w: 50 }, { n: 'B', w: 30 }, { n: 'C', w: 20 }];
const base = { groups: 3, crit, teacherW: 0, trim: false, mode: 'person', names: ['甲', '乙', '丙'] };
const R = [
  { rid: 'a', grp: 2, pres: 1, kind: 'peer', s: [5, 4, 3] },
  { rid: 'b', grp: 3, pres: 1, kind: 'peer', s: [3, 3, 3] },
  { rid: 'c', grp: 1, pres: 1, kind: 'self', s: [5, 5, 5] },
  { rid: 'T', grp: 0, pres: 1, kind: 'teacher', s: [4, 4, 4] },
  { rid: 'a', grp: 2, pres: 3, kind: 'peer', s: [2, 2, 2] }
];
let out = P.compute(base, R);
const g1 = out.groups[0];
ok(near(g1.avg[0], 4) && near(g1.avg[1], 3.5) && near(g1.avg[2], 3), '各項平均');
ok(g1.peer === 73, '同儕分 ' + g1.peer); // a=5*.5+4*.3+3*.2=4.3、b=3 → 3.65×20=73
ok(g1.self === 100 && g1.teacher === 80, '自評與老師');
ok(g1.final === g1.peer, '老師權重 0 時＝同儕分');
out = P.compute(Object.assign({}, base, { teacherW: 30 }), R);
ok(near(out.groups[0].final, Math.round((3.65 * .7 + 4 * .3) * 200) / 10), '老師權重 30% ' + out.groups[0].final);
ok(out.groups[1].final === null && out.groups[1].rank === undefined, '沒人評的組沒有分數');
ok(out.groups[2].rank === 2 && out.groups[0].rank === 1, '名次');
// 每組一票
const R2 = [
  { rid: 'a', grp: 2, pres: 1, kind: 'peer', s: [5, 5, 5] }, { rid: 'b', grp: 2, pres: 1, kind: 'peer', s: [5, 5, 5] }, { rid: 'd', grp: 2, pres: 1, kind: 'peer', s: [5, 5, 5] },
  { rid: 'e', grp: 3, pres: 1, kind: 'peer', s: [1, 1, 1] }
];
ok(P.compute(base, R2).groups[0].peer === 80, '每人一票');
ok(P.compute(Object.assign({}, base, { mode: 'group' }), R2).groups[0].peer === 60, '每組一票');
// 去頭尾
const R3 = [1, 3, 3, 3, 5].map((v, i) => ({ rid: 'r' + i, grp: 2 + (i % 2), pres: 1, kind: 'peer', s: [v, v, v] }));
const t3 = P.compute(Object.assign({}, base, { trim: true }), R3).groups[0];
ok(t3.peer === 60 && t3.dropped === 2 && t3.n === 3, '去掉最高最低');
ok(P.compute(Object.assign({}, base, { trim: true }), R3.slice(0, 4)).groups[0].dropped === 0, '少於 5 份不去頭尾');
ok(P.compute(base, R).groups[0].gap === 27, '自評落差 ' + P.compute(base, R).groups[0].gap);
// 權重全 0 → 平均
ok(near(P.weights([{ w: 0 }, { w: 0 }])[0], .5), '權重全 0 平均分配');
// 評分者分析
const crit1 = [{ n: 'A', w: 1 }];
const RR = [];
for (let p = 1; p <= 4; p++) {
  RR.push({ rid: 'easy', grp: 9, pres: p, kind: 'peer', s: [5] });
  RR.push({ rid: 'x' + p, grp: 8, pres: p, kind: 'peer', s: [3] });
  RR.push({ rid: 'y' + p, grp: 7, pres: p, kind: 'peer', s: [3] });
  RR.push({ rid: 'hard', grp: 6, pres: p, kind: 'peer', s: [1] });
}
const rs = P.compute({ groups: 4, crit: crit1, mode: 'person' }, RR).raters;
const easy = rs.list.find(r => r.rid === 'easy'), hard = rs.list.find(r => r.rid === 'hard');
ok(easy.flags.includes('全部給滿分') && easy.flags.includes('給分偏寬'), '偏寬 ' + easy.flags);
ok(hard.flags.includes('給分偏嚴') && hard.flags.includes('常跟大家差很多'), '偏嚴 ' + hard.flags);
ok(rs.groupLean.find(g => g.grp === 9).lean > 0, '組別寬嚴');
ok(P.expected([{ grp: 1 }, { grp: 2 }, { grp: 2 }, { grp: 0 }], 2, false) === 1 && P.expected([{ grp: 1 }, { grp: 2 }], 2, true) === 2, '應收份數');
// 隨機壓力：分數範圍
for (let k = 0; k < 300; k++) {
  const N = 2 + (k % 19), C = 1 + (k % 6);
  const cr = Array.from({ length: C }, (_, i) => ({ n: 'c' + i, w: (k * (i + 3)) % 40 }));
  const rv = [];
  for (let i = 0; i < 60; i++) { const grp = 1 + ((i * 7 + k) % N), pres = 1 + ((i * 3 + k) % N); rv.push({ rid: 'r' + (i % 25), grp, pres, kind: grp === pres ? 'self' : (i % 9 ? 'peer' : 'paper'), s: Array.from({ length: C }, (_, j) => 1 + ((i + j + k) % 5)) }); }
  rv.push({ rid: 'T', grp: 0, pres: 1, kind: 'teacher', s: Array(C).fill(4) });
  const o = P.compute({ groups: N, crit: cr, teacherW: (k % 6) * 10, trim: !!(k & 1), mode: k % 3 ? 'person' : 'group' }, rv);
  o.groups.forEach(g => { if (g.final != null) ok(g.final >= 20 && g.final <= 100, '分數範圍 ' + g.final); g.avg.forEach(a => ok(a == null || (a >= 1 && a <= 5), '平均範圍')); });
  ok(o.ranked.every((g, i) => !i || o.ranked[i - 1].final >= g.final), '排序');
}

console.log((fail ? '有失敗 ' : '全部通過 ') + pass + ' 項' + (fail ? '，失敗 ' + fail : '') + (hasBad ? '（含轉播站過濾檢查）' : '（找不到轉播站過濾清單，略過）'));
process.exit(fail ? 1 : 0);
