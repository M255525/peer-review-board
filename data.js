/* 同儕互評：評分量表、計分引擎、轉播站訊息編解碼（瀏覽器 window.PEER；node 可 require） */
(function(root){
'use strict';

/* ---------- 評分量表預設（自行撰寫） ---------- */
var LEVELS = ['待加強', '尚可', '良好', '優秀', '卓越']; // 1～5 分
var PRESETS = [
  {id:'talk', ic:'🎤', n:'簡報報告', crit:[
    {n:'內容完整', w:25, h:'重點講到了，資料正確、有根據'},
    {n:'架構清楚', w:20, h:'開頭、主體、結論有條理，聽得懂'},
    {n:'表達台風', w:20, h:'音量、速度、眼神、肢體自然'},
    {n:'視覺設計', w:15, h:'投影片清楚好讀，圖表幫助理解'},
    {n:'時間掌控', w:10, h:'在時間內講完，不拖不趕'},
    {n:'回答提問', w:10, h:'聽懂問題，回答切題'}]},
  {id:'pitch', ic:'🚀', n:'創業提案', crit:[
    {n:'問題痛點', w:20, h:'找到真實、夠痛的問題'},
    {n:'解決方案', w:20, h:'方案能解決痛點，有特色'},
    {n:'市場客群', w:15, h:'目標客群明確，市場夠大'},
    {n:'商業模式', w:20, h:'怎麼賺錢說得清楚'},
    {n:'財務可行', w:15, h:'成本、售價、資金需求合理'},
    {n:'團隊執行', w:10, h:'有能力做出來，下一步具體'}]},
  {id:'poster', ic:'🖼', n:'海報作品展', crit:[
    {n:'主題清楚', w:20, h:'一眼看懂在講什麼'},
    {n:'創意巧思', w:25, h:'有新意，讓人印象深刻'},
    {n:'完成度', w:20, h:'內容齊全、細節用心'},
    {n:'版面美感', w:20, h:'配色、字體、排版舒服'},
    {n:'現場說明', w:15, h:'能清楚介紹、回答參觀者'}]},
  {id:'project', ic:'🧩', n:'小組專題', crit:[
    {n:'目標達成', w:25, h:'做到當初設定的目標'},
    {n:'方法資料', w:20, h:'方法合適，資料可信'},
    {n:'成果品質', w:25, h:'成果完整、可以用'},
    {n:'分工合作', w:15, h:'每個人都有貢獻'},
    {n:'反思改進', w:15, h:'知道哪裡可以做得更好'}]},
  {id:'mkt', ic:'📣', n:'行銷企劃', crit:[
    {n:'受眾洞察', w:25, h:'了解目標受眾在想什麼'},
    {n:'創意概念', w:25, h:'主軸有記憶點，跟品牌相符'},
    {n:'通路預算', w:20, h:'通路選擇與預算分配合理'},
    {n:'執行時程', w:15, h:'步驟、時間、分工具體'},
    {n:'成效指標', w:15, h:'有可以衡量的 KPI'}]},
  {id:'demo', ic:'🛠', n:'產品展示', crit:[
    {n:'實用價值', w:25, h:'真的有人會用、解決問題'},
    {n:'容易使用', w:20, h:'操作直覺，第一次就會'},
    {n:'創新程度', w:20, h:'跟現有產品比有不同'},
    {n:'完成度', w:20, h:'功能能動、少出錯'},
    {n:'展示表現', w:15, h:'展示流暢，講出亮點'}]}
];
var MAX_CRIT = 6, MAX_GROUPS = 20;
var TEAM_COLORS = ['#D9480F', '#1C64B8', '#2B8A3E', '#B8860B', '#9C36B5', '#0B8A8A', '#C2255C', '#5C7A1F', '#6741D9', '#A0522D', '#364FC7', '#862E3C'];

/* ---------- 亂數、代碼 ---------- */
var CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function cryptoInt(n){
  try{ var a = new Uint32Array(1); (root.crypto || require('crypto').webcrypto).getRandomValues(a); return a[0] % n; }catch(e){ return Math.floor(Math.random() * n); }
}
function newRoom(){ var s = ''; for(var i = 0; i < 6; i++) s += CODE_ABC[cryptoInt(CODE_ABC.length)]; return s; }
function newGid(){ return 10 + cryptoInt(90); } // 兩位數，每開一場換一次
function pad2(n){ n = Math.max(0, Math.min(99, n | 0)); return (n < 10 ? '0' : '') + n; }
function pad3(n){ n = Math.max(0, Math.min(999, n | 0)); return ('00' + n).slice(-3); }
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function shuffle(a){ a = a.slice(); for(var i = a.length - 1; i > 0; i--){ var j = cryptoInt(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

/* ---------- 文字清理 ---------- */
function cleanWho(s){ return Array.from(String(s == null ? '' : s).replace(/[\u0000-\u001f<>|,:]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 8).join(''); }
function cleanCrit(s){ return Array.from(String(s == null ? '' : s).replace(/[\u0000-\u001f<>|,，:]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 8).join(''); }
function cleanNote(s, n){ return Array.from(String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, n || 40).join(''); }

/* ---------- 轉播站訊息 ----------
   presence 的 name 欄位（≤24 字，會被不雅字詞過濾，所以只用數字＋T/J/S/|）：
   老師 T|<gid2><組數2><目前組2><階段1><項目數1><旗標1：1自評＋2評語><剩餘秒3>
        階段 0 等待開始、1 報告中、2 開放評分、3 截止、9 結束
   學生 J|<gid2><自己組2>               （還沒評分）
        S|<gid2><自己組2><報告組2>|<分數…> （每項 1～5，一位數）
   聊天（≤60 字）：
   老師 K<gid2>,<i>/<n>:<項目名,項目名…>   評分項目（分段）
        P<gid2>,<組2>:<題目>              目前報告組的題目
   學生 N:<學號或姓名>
        C<gid2>,<組2>+:<優點> ／ C<gid2>,<組2>-:<建議>
*/
function encT(t){
  return 'T|' + pad2(t.gid) + pad2(t.groups) + pad2(t.cur) + (t.ph | 0) + (t.nc | 0) + ((t.self ? 1 : 0) + (t.comments ? 2 : 0)) + pad3(t.secs || 0);
}
function decT(s){
  var m = /^T\|(\d\d)(\d\d)(\d\d)(\d)(\d)([0-3])(\d{3})$/.exec(String(s || ''));
  if(!m) return null;
  return {gid:+m[1], groups:+m[2], cur:+m[3], ph:+m[4], nc:+m[5], self:!!(+m[6] & 1), comments:!!(+m[6] & 2), secs:+m[7]};
}
function encS(o){
  if(o.k === 'score') return 'S|' + pad2(o.gid) + pad2(o.grp) + pad2(o.pres) + '|' + o.s.map(function(v){ return clamp(v | 0, 1, 5); }).join('');
  return 'J|' + pad2(o.gid) + pad2(o.grp || 0);
}
function decS(s){
  s = String(s || '');
  var m = /^S\|(\d\d)(\d\d)(\d\d)\|([1-5]{1,6})$/.exec(s);
  if(m) return {k:'score', gid:+m[1], grp:+m[2], pres:+m[3], s:m[4].split('').map(Number)};
  m = /^J\|(\d\d)(\d\d)$/.exec(s);
  if(m) return {k:'join', gid:+m[1], grp:+m[2]};
  return null;
}
function encRubric(gid, crit){
  var names = crit.map(function(c){ return cleanCrit(c.n) || '項目'; }), parts = [], cur = [];
  var head = function(i, n){ return 'K' + pad2(gid) + ',' + i + '/' + n + ':'; };
  names.forEach(function(nm){
    var t = cur.concat([nm]).join(',');
    if(head(9, 9).length + t.length > 60 && cur.length){ parts.push(cur); cur = [nm]; } else cur.push(nm);
  });
  if(cur.length) parts.push(cur);
  return parts.map(function(p, i){ return head(i + 1, parts.length) + p.join(','); });
}
function decRubric(s){
  var m = /^K(\d\d),(\d)\/(\d):(.*)$/.exec(String(s || ''));
  if(!m) return null;
  return {gid:+m[1], i:+m[2], n:+m[3], names:m[4].split(',')};
}
function encTitle(gid, grp, title){ return 'P' + pad2(gid) + ',' + pad2(grp) + ':' + cleanNote(title, 50); }
function decTitle(s){ var m = /^P(\d\d),(\d\d):(.*)$/.exec(String(s || '')); return m ? {gid:+m[1], grp:+m[2], title:m[3]} : null; }
function encWho(who){ return 'N:' + cleanWho(who); }
function decWho(s){ var m = /^N:(.{1,8})$/.exec(String(s || '')); return m ? m[1] : null; }
function encNote(gid, pres, sign, text){ return 'C' + pad2(gid) + ',' + pad2(pres) + sign + ':' + cleanNote(text, 50); }
function decNote(s){ var m = /^C(\d\d),(\d\d)([+-]):(.*)$/.exec(String(s || '')); return m ? {gid:+m[1], pres:+m[2], sign:m[3], text:m[4].trim()} : null; }

/* ---------- 計分 ---------- */
function weights(crit){ var w = crit.map(function(c){ return Math.max(0, +c.w || 0); }); var t = w.reduce(function(a, b){ return a + b; }, 0); return t > 0 ? w.map(function(x){ return x / t; }) : w.map(function(){ return 1 / w.length; }); }
function wscore(s, W){ var t = 0; for(var i = 0; i < W.length; i++) t += W[i] * (s[i] || 0); return t; } // 1～5
function mean(a){ return a.length ? a.reduce(function(x, y){ return x + y; }, 0) / a.length : null; }
function sd(a){ if(a.length < 2) return 0; var m = mean(a); return Math.sqrt(mean(a.map(function(x){ return (x - m) * (x - m); }))); }
function median(a){ if(!a.length) return null; var b = a.slice().sort(function(x, y){ return x - y; }), k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; }
function to100(x){ return x == null ? null : Math.round(x * 20 * 10) / 10; }

// reviews：[{rid, who, grp, pres, kind:'peer'|'self'|'teacher'|'paper', s:[…], plus, minus}]
function compute(cfg, reviews){
  var N = cfg.groups, C = cfg.crit.length, W = weights(cfg.crit), tw = clamp((+cfg.teacherW || 0) / 100, 0, 1);
  var valid = reviews.filter(function(r){ return r.pres >= 1 && r.pres <= N && r.s && r.s.length === C; });
  var groups = [];
  for(var p = 1; p <= N; p++){
    var rs = valid.filter(function(r){ return r.pres === p; });
    var peers = rs.filter(function(r){ return r.kind === 'peer' || r.kind === 'paper'; });
    var units = peers.map(function(r){ return {s:r.s, ws:wscore(r.s, W), grp:r.grp, rids:[r.rid]}; });
    if(cfg.mode === 'group'){
      var by = {};
      units.forEach(function(u){ (by[u.grp] = by[u.grp] || []).push(u); });
      units = Object.keys(by).map(function(g){
        var us = by[g], s = [];
        for(var i = 0; i < C; i++) s.push(mean(us.map(function(u){ return u.s[i]; })));
        return {s:s, ws:wscore(s, W), grp:+g, rids:[].concat.apply([], us.map(function(u){ return u.rids; }))};
      });
    }
    var dropped = [];
    if(cfg.trim && units.length >= 5){
      var sorted = units.slice().sort(function(a, b){ return a.ws - b.ws; });
      dropped = [sorted[0], sorted[sorted.length - 1]];
      units = sorted.slice(1, -1);
    }
    var avg = [];
    for(var c = 0; c < C; c++) avg.push(units.length ? mean(units.map(function(u){ return u.s[c]; })) : null);
    var peerWs = units.length ? mean(units.map(function(u){ return u.ws; })) : null;
    var teach = rs.filter(function(r){ return r.kind === 'teacher'; })[0] || null;
    var self = rs.filter(function(r){ return r.kind === 'self'; });
    var selfWs = self.length ? mean(self.map(function(r){ return wscore(r.s, W); })) : null;
    var selfAvg = [];
    for(var c2 = 0; c2 < C; c2++) selfAvg.push(self.length ? mean(self.map(function(r){ return r.s[c2]; })) : null);
    var teachWs = teach ? wscore(teach.s, W) : null;
    var finalWs = peerWs == null ? teachWs : teachWs == null || !tw ? peerWs : peerWs * (1 - tw) + teachWs * tw;
    groups.push({
      grp:p, title:(cfg.names || [])[p - 1] || '', n:units.length, nRaw:peers.length, dropped:dropped.length,
      avg:avg, peer:to100(peerWs), teacher:to100(teachWs), teacherS:teach ? teach.s : null, self:to100(selfWs), selfAvg:selfAvg, selfN:self.length,
      gap:selfWs != null && peerWs != null ? to100(selfWs - peerWs) : null,
      final:to100(finalWs), sd:to100(sd(units.map(function(u){ return u.ws; }))),
      plus:rs.filter(function(r){ return r.plus; }).map(function(r){ return {t:r.plus, k:r.kind}; }),
      minus:rs.filter(function(r){ return r.minus; }).map(function(r){ return {t:r.minus, k:r.kind}; })
    });
  }
  // 名次（同分同名次）
  var ranked = groups.filter(function(g){ return g.final != null; }).sort(function(a, b){ return b.final - a.final; });
  ranked.forEach(function(g, i){ g.rank = i && ranked[i - 1].final === g.final ? ranked[i - 1].rank : i + 1; });
  // 全班各項平均（強項／弱項）
  var classAvg = [];
  for(var c3 = 0; c3 < C; c3++){ var xs = groups.map(function(g){ return g.avg[c3]; }).filter(function(x){ return x != null; }); classAvg.push(xs.length ? mean(xs) : null); }
  return {groups:groups, ranked:ranked, classAvg:classAvg, raters:raterStats(cfg, valid, W)};
}

// 評分者分析：寬嚴（比同組平均高或低多少）、全給滿分、分數都一樣、離群
function raterStats(cfg, valid, W){
  var peers = valid.filter(function(r){ return r.kind === 'peer' || r.kind === 'paper'; });
  var byP = {};
  peers.forEach(function(r){ (byP[r.pres] = byP[r.pres] || []).push(wscore(r.s, W)); });
  var mP = {}, medP = {};
  Object.keys(byP).forEach(function(p){ mP[p] = mean(byP[p]); medP[p] = median(byP[p]); });
  var by = {};
  peers.forEach(function(r){
    var ws = wscore(r.s, W), o = by[r.rid] = by[r.rid] || {rid:r.rid, who:r.who, grp:r.grp, kind:r.kind, n:0, diffs:[], all5:true, flat:true, vals:{}, out:0};
    o.n++; if(r.who) o.who = r.who;
    if(byP[r.pres].length >= 3) o.diffs.push(ws - mP[r.pres]);
    if(r.s.some(function(v){ return v !== 5; })) o.all5 = false;
    r.s.forEach(function(v){ o.vals[v] = 1; });
    if(byP[r.pres].length >= 4 && Math.abs(ws - medP[r.pres]) >= 1.2) o.out++;
  });
  var list = Object.keys(by).map(function(k){
    var o = by[k], lean = o.diffs.length ? mean(o.diffs) : null;
    o.flat = Object.keys(o.vals).length === 1;
    var flags = [];
    if(o.n >= 2 && o.all5) flags.push('全部給滿分');
    else if(o.n >= 2 && o.flat) flags.push('每項分數都一樣');
    if(lean != null && o.diffs.length >= 2 && lean >= .6) flags.push('給分偏寬');
    if(lean != null && o.diffs.length >= 2 && lean <= -.6) flags.push('給分偏嚴');
    if(o.out >= 2) flags.push('常跟大家差很多');
    return {rid:o.rid, who:o.who || '', grp:o.grp, kind:o.kind, n:o.n, lean:lean == null ? null : Math.round(lean * 20 * 10) / 10, flags:flags};
  });
  // 各組（評分者所屬組）寬嚴
  var gl = {};
  list.forEach(function(r){ if(r.lean == null) return; (gl[r.grp] = gl[r.grp] || []).push(r.lean); });
  var groupLean = Object.keys(gl).map(function(g){ return {grp:+g, lean:Math.round(mean(gl[g]) * 10) / 10, n:gl[g].length}; }).sort(function(a, b){ return a.grp - b.grp; });
  return {list:list, groupLean:groupLean};
}

// 這一組報告「應該要收到幾份」：線上評分者中不屬於報告組的（允許自評則全部）
function expected(members, pres, allowSelf){
  return members.filter(function(m){ return m.grp && (allowSelf || m.grp !== pres); }).length;
}

var API = {LEVELS:LEVELS, PRESETS:PRESETS, MAX_CRIT:MAX_CRIT, MAX_GROUPS:MAX_GROUPS, TEAM_COLORS:TEAM_COLORS,
  cryptoInt:cryptoInt, newRoom:newRoom, newGid:newGid, shuffle:shuffle, clamp:clamp, pad2:pad2,
  cleanWho:cleanWho, cleanCrit:cleanCrit, cleanNote:cleanNote,
  encT:encT, decT:decT, encS:encS, decS:decS, encRubric:encRubric, decRubric:decRubric, encTitle:encTitle, decTitle:decTitle,
  encWho:encWho, decWho:decWho, encNote:encNote, decNote:decNote,
  weights:weights, wscore:wscore, mean:mean, median:median, compute:compute, expected:expected, to100:to100};
if(typeof module !== 'undefined' && module.exports) module.exports = API; else root.PEER = API;
})(typeof window !== 'undefined' ? window : globalThis);
