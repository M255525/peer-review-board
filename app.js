/* 同儕互評：畫面（老師投影端＋學生手機端） */
(function(){
'use strict';
var P = window.PEER, $ = function(id){ return document.getElementById(id); };
var QS = new URLSearchParams(location.search);
var JOIN = QS.has('join');
var PFX = 'prb.';
var ONLINE = 'https://m255525.github.io/peer-review-board/';
var PRESENCE = QS.get('presence') || 'wss://startup-island-presence.content-workflow.workers.dev/ws';
var ROOM_PREFIX = 'PEER';
var BADGE = 'https://visitor-badge.laobi.icu/badge?page_id=m255525.peerreviewboard';

function lsGet(k){ try{ return localStorage.getItem(PFX + k); }catch(e){ return null; } }
function lsSet(k, v){ try{ localStorage.setItem(PFX + k, v); }catch(e){} }
function lsDel(k){ try{ localStorage.removeItem(PFX + k); }catch(e){} }
function lsJson(k, d){ try{ var v = JSON.parse(lsGet(k)); return v == null ? d : v; }catch(e){ return d; } }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]; }); }
function randId(){ var s = ''; while(s.length < 12) s += P.cryptoInt(36).toString(36); return s; }
var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
function gname(i){ return '第 ' + i + ' 組'; }
function gcol(i){ return P.TEAM_COLORS[(i - 1 + 1200) % P.TEAM_COLORS.length]; }
function gchip(i){ return '<span class="gchip" style="background:' + gcol(i) + '">' + i + '</span>'; }
function f1(x){ return x == null ? '—' : (Math.round(x * 10) / 10).toFixed(1); }
function f0(x){ return x == null ? '—' : String(Math.round(x * 10) / 10); }
function signed(x){ return x == null ? '—' : (x > 0 ? '+' : '') + (Math.round(x * 10) / 10); }
function mmss(ms){ var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
function csvCell(v){ v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

/* ---------- 音效（WebAudio 合成） ---------- */
var AC = null;
function snd(kind){
  if(lsGet('mute') === '1') return;
  try{
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    var notes = {open:[660, 880], close:[880, 523], ok:[784, 1047], tick:[1200]}[kind] || [440];
    notes.forEach(function(f, i){
      var t = AC.currentTime + i * .12, o = AC.createOscillator(), g = AC.createGain();
      o.type = kind === 'tick' ? 'square' : 'triangle'; o.frequency.value = f; o.connect(g); g.connect(AC.destination);
      g.gain.setValueAtTime(kind === 'tick' ? .04 : .16, t); g.gain.exponentialRampToValueAtTime(.001, t + .25);
      o.start(t); o.stop(t + .3);
    });
  }catch(e){}
}

/* ---------- 共用：彈窗、提示 ---------- */
function openModal(h, wide){ $('modalBox').innerHTML = h; $('modalBox').className = wide ? 'wide' : ''; $('modal').classList.add('show'); }
function closeModal(){ $('modal').classList.remove('show'); }
var toastT;
function toast(s){ var t = document.querySelector('.toast'); if(!t){ t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); } t.textContent = s; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function(){ t.hidden = true; }, 2800); }
function copyText(s, ok){ var done = function(){ toast(ok || '已複製'); }; if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(done, function(){ fallbackCopy(s); done(); }); else { fallbackCopy(s); done(); } }
function fallbackCopy(s){ var t = document.createElement('textarea'); t.value = s; document.body.appendChild(t); t.select(); try{ document.execCommand('copy'); }catch(e){} t.remove(); }
function download(name, text){
  var blob = new Blob(['﻿' + text], {type:'text/csv;charset=utf-8'}), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
// 重畫前後保留焦點與游標
function keepFocus(fn){
  var a = document.activeElement, id = a && a.id, sel = null;
  if(id) try{ sel = [a.selectionStart, a.selectionEnd]; }catch(e){}
  fn();
  if(id){ var b = $(id); if(b && b !== a){ b.focus(); if(sel && sel[0] != null) try{ b.setSelectionRange(sel[0], sel[1]); }catch(e){} } }
}

/* ---------- 連線（老師與學生共用；借用創業島轉播站的教室模式） ---------- */
var NET = {ws:null, want:false, status:'off', code:'', role:JOIN ? 'S' : 'T', myId:randId(), peers:{}, retry:0, ping:0, q:[], qBusy:false, last:null, state:'T|0', tkey:''};
function roomUrl(code){
  var here = location.protocol === 'https:' && location.hostname === 'm255525.github.io';
  return (here ? location.origin + location.pathname : ONLINE) + '?join=' + code;
}
function netStart(code){
  NET.want = true; NET.code = code; NET.retry = 0;
  if(NET.role === 'T'){
    NET.tkey = lsGet('tkey.' + code); if(!NET.tkey){ NET.tkey = randId() + randId(); lsSet('tkey.' + code, NET.tkey); }
  } else { NET.myId = lsGet('sid.' + code) || randId(); lsSet('sid.' + code, NET.myId); }
  netConnect();
}
function netStop(closeRoom){
  var ws0 = NET.ws;
  if(closeRoom && NET.role === 'T' && ws0 && ws0.readyState === 1) try{ ws0.send('{"t":"close"}'); }catch(e){}
  NET.want = false; clearTimeout(NET.rt); clearInterval(NET.ping); NET.ws = null; NET.status = 'off'; NET.peers = {}; NET.q = [];
  if(ws0) try{ ws0.close(); }catch(e){}
  netPaint();
}
function netConnect(){
  if(!NET.want) return;
  var q = 'room=' + ROOM_PREFIX + NET.code + '&cls=1' + (NET.role === 'T' ? '&tkey=' + NET.tkey : ''), ws;
  try{ ws = new WebSocket(PRESENCE + '?' + q); }catch(e){ netRetry(); return; }
  NET.ws = ws; NET.status = 'wait'; netPaint();
  ws.onopen = function(){
    if(NET.ws !== ws) return;
    NET.status = 'on'; NET.retry = 0;
    ws.send(JSON.stringify({t:'hello', id:NET.myId, name:NET.role === 'T' ? NET.state : S.myName(), gx:0, gy:0}));
    clearInterval(NET.ping); NET.ping = setInterval(function(){ if(NET.ws && NET.ws.readyState === 1) NET.ws.send('{"t":"ping"}'); }, 25000);
    if(NET.role === 'T') rubricSoon(300); else S.whoSent = false;
    netPaint(); pump();
  };
  ws.onmessage = function(ev){ if(NET.ws !== ws) return; var m; try{ m = JSON.parse(ev.data); }catch(e){ return; } onNet(m); };
  ws.onclose = function(ev){
    if(NET.ws !== ws) return; NET.status = 'off'; NET.ws = null; clearInterval(NET.ping); NET.qBusy = false;
    var code = ev.code;
    if(NET.role === 'S' && (code === 4004 || code === 4005)){ S.closed = code; NET.want = false; renderStu(); return; }
    if(code === 4001 && NET.role === 'T'){ toast('這個代碼正由另一台電腦當主持人，已改用新代碼'); netStop(); G.room = P.newRoom(); saveG(); netStart(G.room); T.push(); render(); return; }
    if(code === 4002){ NET.myId = randId(); if(NET.role === 'S') lsSet('sid.' + NET.code, NET.myId); }
    netPaint(); netRetry();
  };
  ws.onerror = function(){};
}
function netRetry(){ if(!NET.want) return; NET.retry++; clearTimeout(NET.rt); NET.rt = setTimeout(netConnect, Math.min(30000, 1500 * Math.pow(2, NET.retry - 1))); }
function send(o){ if(NET.ws && NET.ws.readyState === 1){ NET.ws.send(JSON.stringify(o)); return true; } return false; }
function setName(name){ if(NET.state === name) return; NET.state = name; send({t:'look', name:name}); }
// 聊天佇列：轉播站限制同一人兩則至少隔 2.5 秒
function queueChats(list, tag){ if(tag) NET.q = NET.q.filter(function(x){ return x.tag !== tag; }); list.forEach(function(t){ NET.q.push({t:t, tag:tag}); }); pump(); }
function pump(){
  if(NET.qBusy || !NET.q.length || NET.status !== 'on') return;
  var it = NET.q.shift(); NET.last = it;
  if(!send({t:'chat', text:it.t})){ NET.q.unshift(it); return; }
  NET.qBusy = true; setTimeout(function(){ NET.qBusy = false; pump(); }, 2700);
}
function onNet(m){
  if(m.t === 'snapshot'){
    NET.peers = {}; (m.peers || []).forEach(function(p){ NET.peers[p.id] = String(p.name || ''); });
    if(NET.role === 'T'){ Object.keys(NET.peers).forEach(function(id){ T.onPeer(id, NET.peers[id]); }); (m.chat || []).forEach(function(c){ T.onChat(c); }); T.paint(); }
    else { Object.keys(NET.peers).forEach(function(id){ S.onPeer(id, NET.peers[id]); }); (m.chat || []).forEach(function(c){ S.onChat(c); }); renderStu(); }
  } else if(m.t === 'join' && m.peer){ NET.peers[m.peer.id] = String(m.peer.name || ''); if(NET.role === 'T'){ T.onPeer(m.peer.id, m.peer.name); rubricSoon(3000); T.paint(); } else S.onPeer(m.peer.id, m.peer.name); }
  else if(m.t === 'look'){ NET.peers[m.id] = String(m.name || ''); if(NET.role === 'T'){ T.onPeer(m.id, m.name); T.paint(); } else S.onPeer(m.id, m.name); }
  else if(m.t === 'leave'){ delete NET.peers[m.id]; if(NET.role === 'T') T.paint(); }
  else if(m.t === 'chat'){ if(NET.role === 'T') T.onChat(m); else S.onChat(m); }
  else if(m.t === 'chatSlow'){ if(NET.last) NET.q.unshift(NET.last); NET.qBusy = true; setTimeout(function(){ NET.qBusy = false; pump(); }, (m.wait || 1000) + 300); }
  netPaint();
}
function netPaint(){ var el = $('netChip'); if(el) el.innerHTML = netChipHtml(); }
function netChipHtml(){
  var n = NET.role === 'T' ? onlineIds().length : 0;
  var st = NET.status === 'on' ? 'on' : NET.status === 'wait' ? 'wait' : '';
  return '<span class="dot ' + st + '"></span>' + (NET.role === 'T' ? (NET.want ? '📱 ' + esc(NET.code) + '・' + n + ' 人' : '📱 手機連線關閉') : (NET.status === 'on' ? '已連線' : NET.status === 'wait' ? '連線中…' : '未連線'));
}
function onlineIds(){ return Object.keys(NET.peers).filter(function(id){ return id !== NET.myId && !/^T\|/.test(NET.peers[id]); }); }
var rubT;
function rubricSoon(ms){ clearTimeout(rubT); rubT = setTimeout(function(){ if(!G || NET.role !== 'T') return; nameSoon(); if(G.stage !== 'end'){ queueChats(P.encRubric(G.gid, G.cfg.crit), 'rub'); titleSoon(); } }, ms || 0); }
function nameSoon(){ if(G) queueChats([P.encRoomName(clsName())], 'rname'); }
function titleSoon(){ var g = curGrp(); if(g && G.cfg.names[g - 1]) queueChats([P.encTitle(G.gid, g, G.cfg.names[g - 1])], 'title'); }
var qrLib = null;
function loadQR(){
  if(window.QRCode) return Promise.resolve();
  if(!qrLib) qrLib = new Promise(function(ok, no){ var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s.onload = ok; s.onerror = function(){ qrLib = null; no(); }; document.head.appendChild(s); });
  return qrLib;
}
function drawQR(id, size){ var el = $(id); if(!el) return; loadQR().then(function(){ el = $(id); if(!el) return; el.innerHTML = ''; new window.QRCode(el, {text:roomUrl(NET.code), width:size, height:size, colorDark:'#111', colorLight:'#fff', correctLevel:window.QRCode.CorrectLevel.M}); }).catch(function(){ el.innerHTML = '<p class="small">QR code 載入失敗，請用代碼加入</p>'; }); }

/* =====================================================================
   老師端
   ===================================================================== */
var DEF_CFG = {title:'', groups:6, names:[], preset:'talk', crit:null, self:true, teacherW:0, trim:true, mode:'person', comments:true, presSec:300, scoreSec:90, reveal:'end'};
var G = null, V = {home:true, showCur:false};
/* ---------- 教室：每間教室有自己的名稱、代碼與資料；一個分頁開一間，可以開好幾個分頁同時進行 ---------- */
var TAB = randId();
function clsList(){ var l = lsJson('rooms', []); return Array.isArray(l) ? l : []; }
function clsSave(l){ lsSet('rooms', JSON.stringify(l)); }
function clsGet(id){ return clsList().filter(function(c){ return c.id === id; })[0] || null; }
function clsName(id){ var c = clsGet(id || (G && G.cid)); return c ? c.name : '教室'; }
function evKey(id){ return 'event.' + id; }
function loadEvent(id){ var g = lsJson(evKey(id), null); return g && g.v === 1 && g.cfg ? g : null; }
function newClsId(){ return randId().slice(0, 8); }
function migrate(){
  var old = lsJson('event', null);
  if(old && old.cfg && !clsList().length){ var id = newClsId(); old.cid = id; lsSet(evKey(id), JSON.stringify(old)); clsSave([{id:id, name:'我的教室', at:Date.now()}]); }
  lsDel('event');
}
// 同一間教室只能在一個分頁開：每 2 秒更新鎖，6 秒沒更新就算釋放
function lockOf(id){ return lsJson('lock.' + id, null); }
function lockBusy(id){ var l = lockOf(id); return !!(l && l.tab !== TAB && Date.now() - l.t < 6000); }
function lockTake(id){ lsSet('lock.' + id, JSON.stringify({tab:TAB, t:Date.now()})); }
function lockFree(id){ var l = lockOf(id); if(l && l.tab === TAB) lsDel('lock.' + id); }
function setUrl(id){ try{ history.replaceState(null, '', location.pathname + (id ? '?c=' + id : '')); }catch(e){} }
function enterCls(id, force){
  if(!clsGet(id)){ toast('找不到這間教室'); setUrl(null); render(); return; }
  if(lockBusy(id) && !force){
    openModal('<h2>🏫 「' + esc(clsName(id)) + '」已在另一個分頁開啟</h2><p>同一間教室一次只能在一個分頁操作，請切換到那個分頁。</p><p class="small">如果那個分頁已經關掉或當掉，可以改在這裡開，另一個分頁會自動退出。</p><div class="stack"><button class="btn red" data-act="enterForce" data-id="' + esc(id) + '">改在這個分頁開</button><button class="btn alt" data-act="close">取消</button></div>');
    return;
  }
  closeModal();
  if(G && G.cid !== id){ saveG(); lockFree(G.cid); if(NET.want) netStop(); }
  if(!G || G.cid !== id) G = loadEvent(id) || newEvent({}, null, id);
  G.cid = id;
  lockTake(id); V.home = false; V.showCur = false; setUrl(id); saveG();
  ensureNet(); T.push(); rubricSoon(400); render(); window.scrollTo(0, 0);
}
function leaveCls(closeRoom){ if(!G) return; saveG(); lockFree(G.cid); if(NET.want) netStop(closeRoom); G = null; V.home = true; setUrl(null); }
function clsStatus(g){
  if(!g) return ['尚未設定', ''];
  if(g.stage === 'setup') return ['設定中', ''];
  if(g.stage === 'run') return ['進行中・第 ' + (g.cur + 1) + ' / ' + g.order.length + ' 組' + (g.ph === 2 ? '・評分中' : ''), 'live'];
  return ['已結束', 'done'];
}
var saveT;
function saveG(){ if(G && G.cid){ G.at = Date.now(); lsSet(evKey(G.cid), JSON.stringify(G)); } }
function saveSoon(){ clearTimeout(saveT); saveT = setTimeout(saveG, 400); }
function cloneCrit(id){ var p = P.PRESETS.filter(function(x){ return x.id === id; })[0] || P.PRESETS[0]; return p.crit.map(function(c){ return {n:c.n, w:c.w, h:c.h}; }); }
function newEvent(cfg, room, cid){
  var c = Object.assign({}, DEF_CFG, lsJson('cfg', {}), cfg || {});
  if(!c.crit || !c.crit.length) c.crit = cloneCrit(c.preset);
  c.names = (c.names || []).slice(0, c.groups);
  return {v:1, cid:cid || (G && G.cid) || '', room:room || P.newRoom(), gid:P.newGid(), stage:'setup', cfg:c, order:seqOrder(c.groups), cur:-1, ph:0, until:0, closedAt:0,
    pres:{left:c.presSec * 1000, runAt:0}, reviews:{}, notes:{}, members:{}, paperN:0, tdraft:{}, pdraft:{grp:0, s:[]}, done:{}, shown:{}};
}
function seqOrder(n){ return Array.from({length:n}, function(_, i){ return i + 1; }); }
function curGrp(){ return G && G.stage === 'run' && G.cur >= 0 ? G.order[G.cur] || 0 : 0; }
function reviewList(){
  return Object.keys(G.reviews).map(function(k){
    var r = Object.assign({}, G.reviews[k]), n = G.notes[k];
    if(r.rid && G.members[r.rid] && G.members[r.rid].who) r.who = G.members[r.rid].who;
    if(n){ r.plus = n.plus || r.plus; r.minus = n.minus || r.minus; }
    return r;
  });
}
// 只有評語、沒打分數的也要列進評語
function allNotes(){
  var out = [];
  Object.keys(G.notes).forEach(function(k){ if(G.reviews[k]) return; var n = G.notes[k], m = G.members[n.rid] || {}; out.push({rid:n.rid, who:m.who || '', grp:m.grp || 0, pres:n.pres, kind:m.grp === n.pres ? 'self' : 'peer', s:null, plus:n.plus, minus:n.minus}); });
  return out;
}
function result(){ return P.compute(G.cfg, reviewList()); }
function accepting(pres){ return G.stage === 'run' && curGrp() === pres && (G.ph === 2 || (G.ph === 3 && Date.now() - G.closedAt < 6000)); }

var T = {
  push:function(){
    if(!G) return;
    var g = curGrp(), secs = G.ph === 2 ? Math.ceil(Math.max(0, G.until - Date.now()) / 1000) : 0;
    setName(P.encT({gid:G.gid, groups:G.cfg.groups, cur:g, ph:G.stage === 'end' ? 9 : G.stage === 'setup' ? 0 : G.ph, nc:G.cfg.crit.length, self:G.cfg.self, comments:G.cfg.comments, secs:secs}));
  },
  onPeer:function(id, name){
    if(!G || id === NET.myId) return;
    var d = P.decS(name); if(!d || d.gid !== G.gid) return;
    var m = G.members[id] = G.members[id] || {who:'', grp:0};
    m.grp = d.grp;
    if(d.k === 'score' && d.s.length === G.cfg.crit.length && accepting(d.pres) && d.grp){
      var kind = d.grp === d.pres ? (G.cfg.self ? 'self' : '') : 'peer';
      if(kind){
        var key = id + '@' + d.pres, old = G.reviews[key];
        if(!old || old.s.join('') !== d.s.join('')){ G.reviews[key] = {rid:id, who:m.who, grp:d.grp, pres:d.pres, kind:kind, s:d.s, at:Date.now()}; if(!old) snd('tick'); }
      }
    }
    saveSoon();
  },
  onChat:function(m){
    if(!G || !m || m.id === NET.myId) return;
    var who = P.decWho(m.text);
    if(who){ var mm = G.members[m.id] = G.members[m.id] || {who:'', grp:0}; mm.who = who; saveSoon(); T.paint(); return; }
    var n = P.decNote(m.text);
    if(n && n.gid === G.gid && accepting(n.pres) && G.cfg.comments){
      var key = m.id + '@' + n.pres, o = G.notes[key] = G.notes[key] || {rid:m.id, pres:n.pres};
      if(n.sign === '+') o.plus = n.text; else o.minus = n.text;
      saveSoon(); T.paint();
    }
  },
  // 局部更新：不重畫整頁（避免打斷老師正在輸入的欄位）
  paint:function(){
    netPaint();
    if(!G || JOIN || V.home) return;
    if(G.stage === 'setup'){ var jb = $('joinList'); if(jb) jb.innerHTML = joinListHtml(); return; }
    if(G.stage !== 'run') return;
    var el = $('meter'); if(el) el.innerHTML = meterHtml();
    el = $('mgroups'); if(el) el.innerHTML = memberHtml();
  },
  tick:function(){
    if(!G || JOIN || G.stage !== 'run') return;
    var now = Date.now();
    if(G.ph === 2 && G.until && now >= G.until){ T.close(); return; }
    var c = $('clock');
    if(c){
      if(G.ph === 2){ var left = G.until - now; c.innerHTML = '<small>評分倒數</small>' + mmss(left); c.className = 'clock' + (left < 10000 ? ' hot' : ''); }
      else { var pl = presLeft(); c.innerHTML = '<small>報告時間' + (G.pres.runAt ? '' : '（暫停）') + '</small>' + (pl < 0 ? '-' : '') + mmss(Math.abs(pl)); c.className = 'clock' + (G.ph === 1 && pl < 30000 ? ' hot' : ''); }
    }
  },
  go:function(idx){
    if(G.ph === 2) T.close(true);
    G.cur = Math.max(0, Math.min(G.order.length - 1, idx)); G.ph = 1; G.pres = {left:G.cfg.presSec * 1000, runAt:0}; V.showCur = false;
    T.push(); titleSoon(); saveG(); render();
  },
  open:function(){
    if(G.ph === 2) return;
    if(G.pres.runAt){ G.pres.left = presLeft(); G.pres.runAt = 0; }
    G.ph = 2; G.until = Date.now() + G.cfg.scoreSec * 1000; snd('open'); T.push(); titleSoon(); saveG(); render();
  },
  close:function(silent){
    if(G.ph !== 2) return;
    G.ph = 3; G.closedAt = Date.now(); G.done[curGrp()] = 1; if(!silent){ snd('close'); }
    T.push(); saveG(); if(!silent) render();
  },
  next:function(){
    if(G.cur < G.order.length - 1) T.go(G.cur + 1);
    else ACT.toEnd();
  }
};
function presLeft(){ return G.pres.runAt ? G.pres.left - (Date.now() - G.pres.runAt) : G.pres.left; }

/* ---------- 老師：共用片段 ---------- */
function topBar(){
  return '<div class="top noprint"><h1>📝 同儕互評 <small>小組報告即時評分</small></h1>' +
    (G && !V.home ? '<button class="ibtn" data-act="home">🏠 首頁</button><button class="ibtn" data-act="renameCls" data-id="' + esc(G.cid) + '" title="改教室名稱">🏫 ' + esc(clsName()) + '</button><button class="ibtn" id="netChip" data-act="room">' + netChipHtml() + '</button>' : '') +
    '<a class="ibtn" href="manual.html">📖 操作手冊</a><button class="ibtn" data-act="settings" aria-label="常用設定">⚙</button></div>' +
    '<p class="warn-line noprint">互評分數是同學的主觀意見，建議當作回饋與參考，搭配老師評分使用。<button data-act="warn">⚠ 使用警語</button></p>';
}
function footer(){
  return '<footer class="foot noprint">👤 創作者 Mark Tsai（蔡豐全）<a href="mailto:tsaimark@gmail.com">tsaimark@gmail.com</a><br><a href="manual.html">📖 操作手冊</a><a href="#" data-act="warn">⚠ 使用警語</a>' +
    (standalone ? '' : '<a href="#" data-act="install">📲 加入主畫面</a>') + '<a href="?join">📱 我是學生</a><a href="https://m255525.github.io/startup-island/" target="_blank" rel="noopener">🏝 創業島</a>' +
    '<br><img src="' + BADGE + '" alt="訪客次數" height="20" loading="lazy" style="vertical-align:middle;margin-top:.4rem"></footer>';
}
function homeView(){
  return topBar() +
    '<section class="hero"><div><h2 class="ttl">台上報告，<br><span class="hl">台下用手機評分</span></h2>' +
    '<p>小組輪流上台，其他同學掃 QR code，依評分量表打 1～5 分，再寫一句優點和建議。結束後自動算出每組分數、雷達圖和評語，一鍵印出各組回饋單。</p>' +
    '<div class="go"><button class="btn big red" data-act="newCls">＋ 新增教室</button>' + (G ? '<button class="btn alt big" data-act="resume">▶ 回到「' + esc(clsName()) + '」</button>' : '') + '</div>' +
    '<p class="small">學生不用下載 App、不用登入。沒有手機的同學，老師可以收紙本評分單再幫忙輸入。　<a href="?join">📱 我是學生，輸入代碼</a></p></div>' +
    '<div class="demo" aria-hidden="true"><span class="stamp">已評</span><h3 style="font-size:1.1rem">第 3 組・校園二手書平台</h3><div class="small" style="margin-bottom:.4rem">同儕 24 份・老師 1 份</div>' +
    [['內容完整', '4.4'], ['架構清楚', '4.1'], ['表達台風', '3.6'], ['視覺設計', '4.5'], ['時間掌控', '3.2']].map(function(r){ return '<div class="row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('') +
    '<p class="small" style="margin:.5rem 0 0">👍 例子很生活化，一聽就懂<br>💡 結論可以再收斂，時間有點超過</p></div></section>' +
    clsListHtml() +
    '<section class="feats">' +
    feat('📋', '評分量表自己定', '6 組常用量表（簡報、創業提案、海報、專題、行銷企劃、產品展示），項目、權重、說明都能改。') +
    feat('⚖', '分數更公平', '自己的組不能評他評；可以開自評比較落差。可去掉最高最低分、選每人一票或每組一票、加老師分數比重。') +
    feat('🔍', '看出誰亂給分', '自動標出全部給滿分、每項都一樣、給分偏寬或偏嚴的評分者，老師心裡有數。') +
    feat('🖨', '回饋單一鍵印', '每組一張：分數、雷達圖、各項跟全班比較、同學的優點與建議。也能下載 CSV 或印紙本評分單。') +
    '</section>' +
    '<section class="card"><h2>怎麼進行</h2><ol class="steps"><li>新增教室（例如「三年二班」），設定活動名稱、組數、各組題目，選評分量表。</li><li>投影 QR code，學生用手機加入、選自己的組。</li><li>每組報告完按「開放評分」，倒數時間內大家打分寫評語。</li><li>全部評完看結果：排名、各組回饋、評分者分析，列印或下載。</li></ol></section>' +
    footer();
}
function clsListHtml(){
  var list = clsList().slice().sort(function(a, b){ return (b.at || 0) - (a.at || 0); });
  var h = '<section class="card margin" id="clsList"><div style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:center"><h2 style="flex:1 1 12rem">🏫 我的教室' + (list.length ? '（' + list.length + ' 間）' : '') + '</h2><button class="btn red sm" data-act="newCls">＋ 新增教室</button></div>' +
    '<p class="lead">每間教室有自己的代碼、評分量表和分數。<b>一個分頁開一間</b>，開好幾個分頁就能讓好幾班同時互評。</p>';
  if(!list.length) return h + '<p class="alert warn">還沒有教室。按「＋ 新增教室」，取個名字（例如「三年二班」「週六創業班」）就能開始。</p></section>';
  h += '<div class="clsgrid">' + list.map(function(c){
    var g = loadEvent(c.id), st = clsStatus(g), here = G && G.cid === c.id, busy = !here && lockBusy(c.id);
    var n = g ? Object.keys(g.reviews || {}).length : 0;
    return '<div class="clscard' + (here ? ' here' : '') + '"><div class="cn">🏫 ' + esc(c.name) + '</div>' +
      '<div class="cm">' + esc(g && g.cfg.title ? g.cfg.title : '（還沒取活動名稱）') + '</div>' +
      '<div class="cs"><span class="tag ' + (st[1] === 'live' ? 'green' : st[1] === 'done' ? '' : 'amber') + '">' + st[0] + '</span>' + (g ? '<span class="tag">代碼 ' + esc(g.room) + '</span>' : '') + (n ? '<span class="tag">' + n + ' 份評分</span>' : '') +
      (here ? '<span class="tag red">這個分頁</span>' : busy ? '<span class="tag red">在其他分頁開啟中</span>' : '') + '</div>' +
      '<div class="go" style="margin-top:.5rem">' + (here ? '<button class="btn sm" data-act="resume">▶ 回到教室</button>' : '<button class="btn sm" data-act="enterCls" data-id="' + esc(c.id) + '">' + (busy ? '改在這裡開' : '▶ 進入') + '</button>' + (busy ? '' : '<a class="btn alt sm" href="?c=' + esc(c.id) + '" target="_blank" rel="noopener">↗ 新分頁</a>')) +
      '<button class="btn alt sm" data-act="renameCls" data-id="' + esc(c.id) + '">✏ 改名</button><button class="btn alt sm" data-act="delCls" data-id="' + esc(c.id) + '" aria-label="刪除教室">🗑</button></div></div>';
  }).join('') + '</div></section>';
  return h;
}
function feat(ic, h, p){ return '<div class="feat"><div class="fi">' + ic + '</div><h3>' + h + '</h3><p>' + p + '</p></div>'; }
function segBtns(key, opts){ return '<div class="seg">' + opts.map(function(o){ return '<button data-cfg="' + key + '" data-v="' + o[0] + '" aria-pressed="' + (String(G.cfg[key]) === String(o[0])) + '">' + o[1] + '</button>'; }).join('') + '</div>'; }
function wsum(){ return G.cfg.crit.reduce(function(a, c){ return a + (+c.w || 0); }, 0); }

function setupView(){
  var c = G.cfg;
  var h = topBar() + '<section class="card margin"><h2>① 活動資料</h2><p class="lead">教室：<b>🏫 ' + esc(clsName()) + '</b>　<button class="btn alt sm" data-act="renameCls" data-id="' + esc(G.cid) + '">✏ 改名</button></p><div class="form">' +
    '<label class="fld">活動名稱<input id="cTitle" maxlength="30" value="' + esc(c.title) + '" placeholder="例如：期末專題發表"></label>' +
    '<label class="fld">組數<select id="cGroups">' + Array.from({length:P.MAX_GROUPS - 1}, function(_, i){ var n = i + 2; return '<option' + (n === c.groups ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label></div>' +
    '<label class="fld" style="margin-top:.6rem">各組題目（一行一組，可以空白）<textarea id="cNames" placeholder="第 1 組的題目&#10;第 2 組的題目&#10;…">' + esc(c.names.join('\n')) + '</textarea><small>投影和學生手機上會顯示目前報告組的題目。</small></label></section>' +
    '<section class="card margin"><h2>② 評分量表</h2><p class="lead">每項 1～5 分。先選一組預設，再依需要修改（最多 ' + P.MAX_CRIT + ' 項，項目名稱最多 8 個字）。</p>' +
    '<div class="presets">' + P.PRESETS.map(function(p){ return '<button data-preset="' + p.id + '" aria-pressed="' + (c.preset === p.id) + '">' + p.ic + ' ' + p.n + '</button>'; }).join('') + '</div>' +
    '<div class="crits">' + c.crit.map(function(cr, i){ return '<div class="crit"><span class="no">' + (i + 1) + '</span><input data-ci="' + i + '" data-cf="n" maxlength="8" value="' + esc(cr.n) + '" placeholder="項目名稱" aria-label="項目名稱"><span class="wt"><input data-ci="' + i + '" data-cf="w" inputmode="numeric" maxlength="3" value="' + esc(cr.w) + '" aria-label="權重">%</span><input class="hint" data-ci="' + i + '" data-cf="h" maxlength="30" value="' + esc(cr.h || '') + '" placeholder="給評分者看的說明（選填）" aria-label="說明"><button data-act="delCrit" data-i="' + i + '" aria-label="刪除" ' + (c.crit.length <= 1 ? 'disabled' : '') + '>✕</button></div>'; }).join('') + '</div>' +
    '<div class="go"><button class="btn alt sm" data-act="addCrit" ' + (c.crit.length >= P.MAX_CRIT ? 'disabled' : '') + '>＋ 加一項</button><span class="small">權重合計 <b class="wsum" id="wsum">' + wsum() + '</b>%（不是 100 也沒關係，會自動換算比例）</span></div>' +
    '<p class="small">分數說明：' + P.LEVELS.map(function(l, i){ return (i + 1) + '＝' + l; }).join('、') + '。總分換算成 100 分（全部 5 分＝100）。</p></section>' +
    '<section class="card margin"><h2>③ 評分規則</h2><div class="form">' +
    '<div class="fld">自己的組<small>不管怎麼選，自評都不會算進同儕分數</small>' + segBtns('self', [[true, '可以自評（另外比較）'], [false, '不能評自己']]) + '</div>' +
    '<div class="fld">寫評語<small>每人一句優點、一句建議</small>' + segBtns('comments', [[true, '要寫（選填）'], [false, '不用']]) + '</div>' +
    '<div class="fld">報告時間' + segBtns('presSec', [[180, '3 分'], [300, '5 分'], [480, '8 分'], [600, '10 分'], [900, '15 分']]) + '</div>' +
    '<div class="fld">評分時間<small>倒數到 0 自動截止，可以延長</small>' + segBtns('scoreSec', [[60, '60 秒'], [90, '90 秒'], [120, '2 分'], [180, '3 分']]) + '</div>' +
    '<div class="fld">公布分數' + segBtns('reveal', [['end', '全部評完再公布'], ['each', '每組評完就公布']]) + '</div>' +
    '<div class="fld">老師分數比重<small>老師沒打分數的組只算同儕</small>' + segBtns('teacherW', [[0, '不算'], [20, '20%'], [30, '30%'], [50, '50%']]) + '</div>' +
    '<div class="fld">計分單位' + segBtns('mode', [['person', '每人一票'], ['group', '每組一票（組內先平均）']]) + '</div>' +
    '<div class="fld">去掉最高與最低<small>份數 5 份以上才會去掉</small>' + segBtns('trim', [[true, '去掉'], [false, '不去掉']]) + '</div>' +
    '</div><p class="small">老師比重、計分單位、去頭尾在結果頁也能隨時改，分數會重新計算。</p></section>' +
    '<section class="card margin"><h2>④ 上台順序</h2><ol class="order">' + G.order.map(function(g, i){ return '<li><span class="n">' + (i + 1) + '</span>' + gchip(g) + '<b>' + esc(gname(g) + (c.names[g - 1] ? '・' + c.names[g - 1] : '')) + '</b><button data-act="mvUp" data-i="' + i + '" aria-label="往前" ' + (i ? '' : 'disabled') + '>▲</button><button data-act="mvDn" data-i="' + i + '" aria-label="往後" ' + (i < G.order.length - 1 ? '' : 'disabled') + '>▼</button></li>'; }).join('') + '</ol>' +
    '<div class="go"><button class="btn alt sm" data-act="shuffleOrder">🎲 隨機抽順序</button><button class="btn alt sm" data-act="seqOrder">1→' + c.groups + ' 照順序</button></div></section>' +
    '<section class="card margin"><h2>⑤ 讓學生加入</h2>' + joinBoxHtml() + '</section>' +
    '<div class="go"><button class="btn big red" data-act="start">▶ 開始互評</button><button class="btn alt" data-act="printBlank">🖨 印紙本評分單</button></div>' + footer();
  return h;
}
function joinBoxHtml(){
  if(!NET.want) return '<p class="lead">學生用手機掃 QR code 加入、選自己的組別。</p><div class="go"><button class="btn red" data-act="netOn">📱 開放手機加入</button></div><p class="small">不開也能用：收紙本評分單，再用「紙本代填」輸入。</p>';
  var local = !(location.protocol === 'https:' && location.hostname === 'm255525.github.io');
  return '<div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center"><div class="qr" id="qrJoin"></div><div style="flex:1 1 14rem"><div style="font-weight:900;font-size:1.15rem">🏫 ' + esc(clsName()) + '</div><div class="small">手機掃描，或打開 ' + esc(ONLINE.replace('https://', '')) + '?join 輸入代碼</div><div style="font-family:var(--serif);font-size:2.4rem;letter-spacing:.12em;color:var(--red)">' + esc(NET.code) + '</div>' +
    (local ? '<p class="small">目前不是線上版網址，QR code 指向線上版。</p>' : '') +
    '<div class="go"><button class="btn alt sm" data-act="copyJoin">📋 複製加入連結</button><button class="btn alt sm" data-act="bigQR">🔍 放大 QR code</button><button class="btn alt sm" data-act="netOff">🚪 關閉教室</button></div><div id="joinList" class="small" style="margin-top:.5rem">' + joinListHtml() + '</div></div></div>';
}
function liveMembers(){ var on = {}; onlineIds().forEach(function(id){ on[id] = 1; }); return Object.keys(G.members).filter(function(id){ return on[id]; }).map(function(id){ return Object.assign({id:id}, G.members[id]); }); }
function joinListHtml(){
  var ms = liveMembers(), by = {};
  ms.forEach(function(m){ (by[m.grp] = by[m.grp] || []).push(m.who || '同學'); });
  if(!ms.length) return '還沒有人加入';
  return '已加入 <b>' + ms.length + '</b> 人：' + Object.keys(by).sort(function(a, b){ return a - b; }).map(function(g){ return (+g ? gname(g) : '還沒選組') + ' ' + by[g].length + ' 人'; }).join('、');
}

function runView(){
  var g = curGrp(), c = G.cfg, title = c.names[g - 1] || '';
  var ph = G.ph, phLabel = ph === 1 ? '<span class="ph p1">🎤 報告中</span>' : ph === 2 ? '<span class="ph p2">✍ 評分中</span>' : '<span class="ph p3">✅ 已截止</span>';
  var h = topBar() + '<div class="prog noprint" aria-label="上台順序">' + G.order.map(function(x, i){ return '<button data-act="goto" data-i="' + i + '" class="' + (i === G.cur ? 'cur' : G.done[x] ? 'done' : '') + '" title="' + esc(gname(x) + (c.names[x - 1] ? '・' + c.names[x - 1] : '')) + '">' + x + '</button>'; }).join('') + '<button data-act="toEnd" class="' + '" title="看結果">📊</button></div>' +
    '<div class="run"><div>' +
    '<section class="stage"><div class="sh"><b>🏫 ' + esc(clsName()) + (c.title ? '・' + esc(c.title) : '') + '</b><span class="small">第 ' + (G.cur + 1) + ' / ' + G.order.length + ' 組上台</span>' + phLabel + '</div>' +
    '<div class="sb"><div><h2 class="who" style="color:' + gcol(g) + '">' + gname(g) + '</h2>' + (title ? '<div class="topic">' + esc(title) + '</div>' : '') + '</div><div class="clock" id="clock"></div></div>' +
    (ph >= 2 ? '<div class="meter" id="meter">' + meterHtml() + '</div>' : '') +
    '<div class="ctl noprint">' +
    (ph === 1 ? (G.pres.runAt ? '<button class="btn alt" data-act="presPause">⏸ 暫停計時</button>' : '<button class="btn alt" data-act="presRun">▶ ' + (G.pres.left < c.presSec * 1000 ? '繼續' : '開始') + '報告計時</button>') + '<button class="btn alt sm" data-act="presReset">↺ 重設</button><button class="btn big red" data-act="open">✍ 開放評分</button>' : '') +
    (ph === 2 ? '<button class="btn alt" data-act="addTime">＋30 秒</button><button class="btn big" data-act="stop">⏹ 截止評分</button>' : '') +
    (ph === 3 ? '<button class="btn alt" data-act="reopen">↩ 重新開放</button>' + (c.reveal === 'each' ? '<button class="btn alt" data-act="showCur">' + (V.showCur ? '🙈 收起分數' : '👀 公布這組分數') + '</button>' : '') + '<button class="btn big red" data-act="next">' + (G.cur < G.order.length - 1 ? '下一組 ▶' : '📊 看結果') + '</button>' : '') +
    '<span class="small" style="align-self:center">空白鍵＝下一步</span></div>' +
    (ph === 3 && V.showCur ? '<div class="reveal">' + curRevealHtml(g) + '</div>' : '') + '</section>' +
    teacherPanel(g) + paperPanel(g) +
    '</div><aside class="side">' + sideRoom() + '<h3>👥 各組評分狀況</h3><div class="mgroups" id="mgroups">' + memberHtml() + '</div></aside></div>' + footer();
  return h;
}
function meterHtml(){
  var g = curGrp(); if(!g) return '';
  var got = Object.keys(G.reviews).filter(function(k){ var r = G.reviews[k]; return r.pres === g && (r.kind === 'peer' || r.kind === 'self'); }).length;
  var exp = P.expected(liveMembers(), g, G.cfg.self);
  var paper = Object.keys(G.reviews).filter(function(k){ var r = G.reviews[k]; return r.pres === g && r.kind === 'paper'; }).length;
  var pct = exp ? Math.min(100, Math.round(got / exp * 100)) : got ? 100 : 0;
  return '<div class="mt"><span>📱 已收到</span><span><b>' + got + '</b> / ' + exp + ' 份' + (paper ? '・紙本 ' + paper : '') + '</span></div><div class="bar"><i style="width:' + pct + '%"></i></div>';
}
function memberHtml(){
  var g = curGrp(), on = {}; onlineIds().forEach(function(id){ on[id] = 1; });
  var by = {};
  Object.keys(G.members).forEach(function(id){ var m = G.members[id]; if(!on[id] && !G.reviews[id + '@' + g]) return; (by[m.grp] = by[m.grp] || []).push({id:id, m:m}); });
  var h = '';
  for(var i = 1; i <= G.cfg.groups; i++){
    var list = by[i] || [], ok = list.filter(function(x){ return G.reviews[x.id + '@' + g]; }).length;
    var isCur = i === g;
    h += '<div class="mg' + (isCur ? ' on' : '') + '"><div class="mh">' + gchip(i) + '<span>' + (G.cfg.names[i - 1] ? esc(G.cfg.names[i - 1]).slice(0, 14) : gname(i)) + '</span><span>' + (isCur ? (G.cfg.self ? '自評 ' + ok + '/' + list.length : '報告中') : g && G.ph >= 2 ? ok + '/' + list.length : list.length + ' 人') + '</span></div>' +
      (list.length ? '<div class="ms">' + list.map(function(x){ return '<i class="' + (G.reviews[x.id + '@' + g] ? 'ok' : '') + (on[x.id] ? '' : ' off') + '">' + esc(x.m.who || '同學') + '</i>'; }).join('') + '</div>' : '') + '</div>';
  }
  var none = by[0] || by.undefined;
  if(none && none.length) h += '<p class="small">還沒選組：' + none.map(function(x){ return esc(x.m.who || '同學'); }).join('、') + '</p>';
  return h;
}
function sideRoom(){
  return '<div class="roomcard noprint"><div style="font-weight:900">🏫 ' + esc(clsName()) + '</div>' + (NET.want ? '<div class="small">掃描或輸入代碼加入</div><div class="qr" id="qrJoin"></div><div class="code">' + esc(NET.code) + '</div><button class="ibtn" data-act="bigQR">🔍 放大</button>' : '<button class="btn red" data-act="netOn">📱 開放手機加入</button>') + '</div>';
}
function scoreRows(prefix, vals){
  return '<div class="scorer">' + G.cfg.crit.map(function(c, i){ return '<div class="srow"><span class="lb">' + esc(c.n) + '<small>' + c.w + '%</small></span>' + [1, 2, 3, 4, 5].map(function(v){ return '<button data-' + prefix + '="' + i + ',' + v + '" aria-pressed="' + (vals[i] === v) + '" title="' + P.LEVELS[v - 1] + '">' + v + '</button>'; }).join('') + '</div>'; }).join('') + '</div>';
}
function teacherPanel(g){
  var r = G.reviews['T@' + g], d = G.tdraft[g] || (r ? r.s.slice() : []);
  return '<details class="panel noprint"' + (lsGet('tpOpen') === '1' ? ' open' : '') + ' data-keep="tpOpen"><summary>🧑‍🏫 老師評分 ' + (r ? '<span class="tag green">已存 ' + P.to100(P.wscore(r.s, P.weights(G.cfg.crit))) + ' 分</span>' : '<span class="tag">' + (G.cfg.teacherW ? '佔 ' + G.cfg.teacherW + '%' : '目前不計入，可在結果頁改比重') + '</span>') + '</summary><div class="pb">' +
    scoreRows('tsc', d) + '<p class="small">每項都點了就自動存檔。' + (r ? '<button class="btn alt sm" data-act="tclear">清除老師分數</button>' : '') + '</p></div></details>';
}
function paperPanel(g){
  var pd = G.pdraft, papers = Object.keys(G.reviews).filter(function(k){ return G.reviews[k].pres === g && G.reviews[k].kind === 'paper'; });
  var opts = '';
  for(var i = 1; i <= G.cfg.groups; i++) if(i !== g) opts += '<option value="' + i + '"' + (pd.grp === i ? ' selected' : '') + '>' + gname(i) + '</option>';
  return '<details class="panel noprint"' + (lsGet('ppOpen') === '1' ? ' open' : '') + ' data-keep="ppOpen"><summary>📄 紙本代填（沒有手機的同學）' + (papers.length ? ' <span class="tag">' + papers.length + ' 份</span>' : '') + '</summary><div class="pb">' +
    '<label class="fld" style="max-width:16rem">評分者的組別<select id="pGrp"><option value="0">請選擇</option>' + opts + '</select></label>' + scoreRows('psc', pd.s) +
    '<div class="go"><button class="btn green" data-act="paperAdd">＋ 加入這一份</button></div>' +
    (papers.length ? '<ul class="notes" style="margin-top:.6rem">' + papers.map(function(k){ var r = G.reviews[k]; return '<li style="padding-left:0">' + gname(r.grp) + '：' + r.s.join('、') + ' <button class="btn alt sm" data-act="paperDel" data-k="' + esc(k) + '">刪除</button></li>'; }).join('') + '</ul>' : '') + '</div></details>';
}
function curRevealHtml(g){
  var res = result(), x = res.groups[g - 1];
  if(!x || x.final == null) return '<p class="lead">這組還沒有收到分數。</p>';
  return '<div style="display:flex;gap:1.2rem;flex-wrap:wrap;align-items:center"><div><div class="small">得分</div><div class="big">' + f0(x.final) + '</div><div class="small">' + x.n + ' 份' + (x.dropped ? '（已去掉最高最低）' : '') + '</div></div><div style="flex:1 1 16rem">' + cbarsHtml(x.avg, null) + '</div></div>';
}
function cbarsHtml(avg, cls){
  return '<div class="cbars">' + G.cfg.crit.map(function(c, i){ var v = avg[i]; return '<div class="cbar"><span>' + esc(c.n) + '</span><span class="tr"><i style="width:' + (v == null ? 0 : v / 5 * 100) + '%"></i></span><span class="v">' + f1(v) + (cls && cls[i] != null && v != null ? ' <small class="' + (v - cls[i] >= 0 ? 'pos' : 'neg') + '">' + signed(v - cls[i]) + '</small>' : '') + '</span></div>'; }).join('') + '</div>';
}
function radar(vals, cmp, size){
  var n = G.cfg.crit.length; size = size || 220;
  if(n < 3) return '';
  var cx = size / 2, cy = size / 2 + 4, R = size / 2 - 38, pt = function(i, v){ var a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * R * v / 5, cy + Math.sin(a) * R * v / 5]; };
  var poly = function(vs){ return vs.map(function(v, i){ return pt(i, v == null ? 0 : v).map(function(x){ return x.toFixed(1); }).join(','); }).join(' '); };
  var h = '<svg class="radar" viewBox="0 0 ' + size + ' ' + (size + 8) + '" role="img" aria-label="各項平均雷達圖">';
  [1, 2, 3, 4, 5].forEach(function(l){ h += '<polygon points="' + poly(Array(n).fill(l)) + '" fill="none" stroke="#D9D2BF" stroke-width="' + (l === 5 ? 1.4 : .8) + '"/>'; });
  for(var i = 0; i < n; i++){ var e = pt(i, 5), lp = pt(i, 6.15); h += '<line x1="' + cx + '" y1="' + cy + '" x2="' + e[0].toFixed(1) + '" y2="' + e[1].toFixed(1) + '" stroke="#D9D2BF" stroke-width=".8"/><text x="' + lp[0].toFixed(1) + '" y="' + (lp[1] + 4).toFixed(1) + '" text-anchor="middle">' + esc(G.cfg.crit[i].n.slice(0, 5)) + '</text>'; }
  if(cmp) h += '<polygon points="' + poly(cmp) + '" fill="none" stroke="#5F6678" stroke-width="1.5" stroke-dasharray="4 3"/>';
  h += '<polygon points="' + poly(vals) + '" fill="rgba(200,16,46,.18)" stroke="#C8102E" stroke-width="2.2"/>';
  vals.forEach(function(v, i){ if(v == null) return; var p = pt(i, v); h += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="#C8102E"/>'; });
  return h + '</svg>';
}

/* ---------- 結果 ---------- */
function endView(){
  var res = result(), c = G.cfg, notes = allNotes();
  var total = Object.keys(G.reviews).filter(function(k){ var r = G.reviews[k]; return r.kind === 'peer' || r.kind === 'paper'; }).length;
  var people = {}; Object.keys(G.reviews).forEach(function(k){ var r = G.reviews[k]; if(r.kind === 'peer' || r.kind === 'self') people[r.rid] = 1; });
  var h = topBar() + '<section class="card margin"><div style="display:flex;flex-wrap:wrap;gap:.6rem;align-items:center"><h2 style="flex:1 1 14rem">📊 ' + esc(clsName()) + (c.title ? '・' + esc(c.title) : '') + '・結果</h2>' +
    '<button class="btn alt sm" data-act="backRun">↩ 回到評分</button><button class="btn sm" data-act="printSheets">🖨 印各組回饋單</button><button class="btn alt sm" data-act="csvRaw">⬇ 原始分數 CSV</button><button class="btn alt sm" data-act="csvSum">⬇ 總表 CSV</button></div>' +
    '<p class="lead">' + c.groups + ' 組・同儕評分 ' + total + ' 份・手機參與 ' + Object.keys(people).length + ' 人。分數＝各項加權平均，換算成 100 分。</p>' +
    '<div class="form noprint" style="margin-top:.4rem"><div class="fld">老師分數比重' + segBtns('teacherW', [[0, '不算'], [20, '20%'], [30, '30%'], [50, '50%']]) + '</div><div class="fld">計分單位' + segBtns('mode', [['person', '每人一票'], ['group', '每組一票']]) + '</div><div class="fld">去掉最高與最低' + segBtns('trim', [[true, '去掉'], [false, '不去掉']]) + '</div></div></section>';
  h += '<section class="card"><h2>🏆 排名</h2>' + (res.ranked.length ? '<div class="rank">' + res.ranked.map(function(x){
    return '<div class="rk' + (x.rank === 1 ? ' first' : '') + '"><span class="n">' + x.rank + '</span><div><b style="font-size:1.1rem">' + gchip(x.grp) + ' ' + esc(gname(x.grp)) + '</b> ' + esc(x.title) + '</div><div class="tot">' + f0(x.final) + '<small>總分</small></div>' +
      '<div class="bd">同儕 ' + f0(x.peer) + '（' + x.n + ' 份' + (x.dropped ? '，去掉最高最低' : '') + '）' + (x.teacher != null ? '・老師 ' + f0(x.teacher) + (c.teacherW ? '（佔 ' + c.teacherW + '%）' : '（不計入）') : '') + (x.self != null ? '・自評 ' + f0(x.self) + ' <span class="tag ' + (x.gap >= 10 ? 'amber' : x.gap <= -10 ? 'green' : '') + '">落差 ' + signed(x.gap) + '</span>' : '') + '</div></div>';
  }).join('') + '</div>' : '<p class="lead">還沒有任何分數。</p>') +
    (res.groups.filter(function(x){ return x.final == null; }).length ? '<p class="small">還沒有分數：' + res.groups.filter(function(x){ return x.final == null; }).map(function(x){ return gname(x.grp); }).join('、') + '</p>' : '') + '</section>';
  h += '<section class="card"><h2>💡 全班觀察</h2><div class="insights">' + insightsHtml(res) + '</div></section>';
  h += '<section class="card"><h2>📋 各組回饋</h2><p class="lead">紅色是這組的平均，灰色虛線是全班平均。評語不顯示是誰寫的。</p><div class="gcards">' + res.groups.map(function(x){ return gcardHtml(x, res, notes); }).join('') + '</div></section>';
  h += '<details class="panel noprint"><summary>🔍 評分者分析（老師看就好，不建議投影）</summary><div class="pb">' + ratersHtml(res) + '</div></details>';
  h += '<div class="go noprint"><button class="btn alt" data-act="again">🔁 同一班再開一場（代碼不變）</button><button class="btn alt" data-act="newSetup">＋ 這間教室開新的互評</button></div>' + footer();
  return h;
}
function insightsHtml(res){
  var c = G.cfg, out = [], ca = res.classAvg, idx = ca.map(function(v, i){ return i; }).filter(function(i){ return ca[i] != null; });
  if(idx.length >= 2){
    idx.sort(function(a, b){ return ca[b] - ca[a]; });
    out.push(['💪 全班強項', '「' + c.crit[idx[0]].n + '」平均 ' + f1(ca[idx[0]]) + ' 分，是全班表現最好的一項。']);
    out.push(['🔧 全班待加強', '「' + c.crit[idx[idx.length - 1]].n + '」平均 ' + f1(ca[idx[idx.length - 1]]) + ' 分。下次上課可以多花一點時間練這一項。']);
  }
  var gaps = res.groups.filter(function(x){ return x.gap != null; });
  if(gaps.length){
    var hi = gaps.filter(function(x){ return x.gap >= 10; }), lo = gaps.filter(function(x){ return x.gap <= -10; });
    out.push(['🪞 自評 vs 同學評', '有自評的 ' + gaps.length + ' 組，平均落差 ' + signed(P.mean(gaps.map(function(x){ return x.gap; }))) + ' 分。' + (hi.length ? '自己評得比同學高 10 分以上：' + hi.map(function(x){ return gname(x.grp); }).join('、') + '。' : '') + (lo.length ? '對自己比較嚴格：' + lo.map(function(x){ return gname(x.grp); }).join('、') + '。' : '')]);
  }
  var sds = res.groups.filter(function(x){ return x.n >= 3; }).sort(function(a, b){ return b.sd - a.sd; });
  if(sds.length) out.push(['🗣 意見最分歧', gname(sds[0].grp) + '（標準差 ' + f0(sds[0].sd) + ' 分）同學的看法差最多，可以請大家分享為什麼。']);
  var gl = res.raters.groupLean.filter(function(x){ return x.n >= 1; });
  if(gl.length >= 2){
    gl.sort(function(a, b){ return b.lean - a.lean; });
    out.push(['⚖ 給分寬嚴', '最寬鬆：' + gname(gl[0].grp) + '（平均比大家高 ' + signed(gl[0].lean) + ' 分）；最嚴格：' + gname(gl[gl.length - 1].grp) + '（' + signed(gl[gl.length - 1].lean) + ' 分）。']);
  }
  var fl = res.raters.list.filter(function(r){ return r.flags.length; });
  out.push(['🔍 需要留意的評分', fl.length ? fl.length + ' 位評分者有「全部滿分／每項一樣／偏寬偏嚴」等情形，詳見下方評分者分析。' : '沒有發現明顯亂給分的情形。']);
  return out.map(function(o){ return '<div class="insight"><h3>' + o[0] + '</h3><p>' + esc(o[1]) + '</p></div>'; }).join('');
}
function notesOf(g, notes, sign){
  var key = sign === '+' ? 'plus' : 'minus';
  var arr = g[key].map(function(x){ return x; });
  notes.forEach(function(n){ if(n.pres === g.grp && n[key]) arr.push({t:n[key], k:n.kind}); });
  return arr;
}
function gcardHtml(x, res, notes){
  var plus = notesOf(x, notes, '+'), minus = notesOf(x, notes, '-');
  var li = function(a){ return a.map(function(n){ return '<li' + (n.k === 'teacher' ? ' class="t"' : '') + '>' + esc(n.t) + (n.k === 'self' ? '<span class="tag">自評</span>' : '') + '</li>'; }).join(''); };
  return '<div class="gcard" style="--c:' + gcol(x.grp) + '"><h3>' + gname(x.grp) + (x.rank ? ' <span class="tag red">第 ' + x.rank + ' 名</span>' : '') + '</h3><div class="tp">' + esc(x.title || '　') + '</div><div class="score">' + f0(x.final) + '</div>' +
    (x.final == null ? '<p class="lead">還沒有分數</p>' : '<div class="gb"><div>' + radar(x.avg, res.classAvg, 200) + '</div><div>' + cbarsHtml(x.avg, res.classAvg) + '</div></div>' +
    '<div class="mini">同儕 ' + f0(x.peer) + '（' + x.n + ' 份）' + (x.teacher != null ? '・老師 ' + f0(x.teacher) : '') + (x.self != null ? '・自評 ' + f0(x.self) + '（落差 ' + signed(x.gap) + '）' : '') + '</div>') +
    (plus.length ? '<ul class="notes plus">' + li(plus) + '</ul>' : '') + (minus.length ? '<ul class="notes minus">' + li(minus) + '</ul>' : '') + '</div>';
}
function ratersHtml(res){
  var list = res.raters.list.slice().sort(function(a, b){ return (b.flags.length - a.flags.length) || (a.grp - b.grp); });
  if(!list.length) return '<p class="lead">還沒有同儕評分。</p>';
  return '<p class="small">寬嚴＝這個人給的分數平均比同一場其他人高（＋）或低（－）幾分（100 分制），同一場要有 3 份以上才算。每人至少評 2 組才會標「全部給滿分」等提醒。提醒只是參考，不代表一定亂評。</p><div class="tw"><table class="t"><thead><tr><th>評分者</th><th>組別</th><th>評了幾組</th><th>寬嚴</th><th>提醒</th></tr></thead><tbody>' +
    list.map(function(r){ return '<tr><td>' + esc(r.kind === 'paper' ? '紙本' : r.who || '（沒填名字）') + '</td><td>' + gname(r.grp) + '</td><td class="n">' + r.n + '</td><td class="n ' + (r.lean >= 12 ? 'neg' : '') + '">' + signed(r.lean) + '</td><td>' + r.flags.map(function(f){ return '<span class="tag amber">' + f + '</span>'; }).join('') + '</td></tr>'; }).join('') + '</tbody></table></div>';
}

/* ---------- 列印：回饋單、紙本評分單 ---------- */
function printHtml(html){
  $('printArea').innerHTML = html; document.body.classList.add('print-area');
  var done = function(){ document.body.classList.remove('print-area'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(function(){ window.print(); setTimeout(done, 1500); }, 60);
}
function sheetsHtml(){
  var res = result(), c = G.cfg, notes = allNotes(), date = new Date().toLocaleDateString('zh-TW');
  return res.groups.map(function(x){
    var plus = notesOf(x, notes, '+'), minus = notesOf(x, notes, '-');
    return '<div class="psheet"><h1>' + esc(c.title || '同儕互評') + '・回饋單</h1><div class="meta">' + date + '　' + esc(clsName()) + '　' + gname(x.grp) + (x.title ? '・' + esc(x.title) : '') + '</div>' +
      '<div class="two"><div>' + radar(x.avg, res.classAvg, 200) + '<div style="font-size:10px;color:#555;text-align:center">紅：本組　灰虛線：全班平均</div></div><div><div>總分</div><div class="bigs">' + f0(x.final) + '</div>' +
      '<div>' + (x.rank ? '全班第 ' + x.rank + ' 名（共 ' + res.ranked.length + ' 組）・' : '') + '同儕 ' + f0(x.peer) + '（' + x.n + ' 份）' + (x.teacher != null ? '・老師 ' + f0(x.teacher) : '') + (x.self != null ? '・自評 ' + f0(x.self) : '') + '</div>' +
      '<table><thead><tr><th>評分項目</th><th>權重</th><th>本組</th><th>全班平均</th>' + (x.self != null ? '<th>自評</th>' : '') + (x.teacherS ? '<th>老師</th>' : '') + '</tr></thead><tbody>' +
      c.crit.map(function(cr, i){ return '<tr><td>' + esc(cr.n) + '</td><td class="c">' + cr.w + '%</td><td class="c"><b>' + f1(x.avg[i]) + '</b></td><td class="c">' + f1(res.classAvg[i]) + '</td>' + (x.self != null ? '<td class="c">' + f1(x.selfAvg[i]) + '</td>' : '') + (x.teacherS ? '<td class="c">' + x.teacherS[i] + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table></div></div>' +
      '<h3 style="font-size:14px;margin-top:10px">👍 同學說的優點</h3>' + (plus.length ? '<ul>' + plus.map(function(n){ return '<li>' + esc(n.t) + (n.k === 'self' ? '（自評）' : '') + '</li>'; }).join('') + '</ul>' : '<p>（沒有）</p>') +
      '<h3 style="font-size:14px">💡 同學給的建議</h3>' + (minus.length ? '<ul>' + minus.map(function(n){ return '<li>' + esc(n.t) + (n.k === 'self' ? '（自評）' : '') + '</li>'; }).join('') + '</ul>' : '<p>（沒有）</p>') +
      '<h3 style="font-size:14px">🧑‍🏫 老師的話</h3><div class="box" style="min-height:70px"></div></div>';
  }).join('');
}
function blankHtml(){
  var c = G.cfg, rows = '';
  for(var i = 1; i <= c.groups; i++) rows += '<tr><td>' + gname(i) + (c.names[i - 1] ? '<br><small>' + esc(c.names[i - 1]) + '</small>' : '') + '</td>' + c.crit.map(function(){ return '<td></td>'; }).join('') + (c.comments ? '<td style="width:30%"></td>' : '') + '</tr>';
  return '<div class="psheet"><h1>' + esc(c.title || '同儕互評') + '・評分單</h1><div class="meta">' + esc(clsName()) + '　評分者：＿＿＿＿＿＿＿＿　我的組別：第＿＿組　（自己的組' + (c.self ? '可以自評，另外計算' : '不用評') + '）</div>' +
    '<div>每項填 1～5 分：' + P.LEVELS.map(function(l, i){ return (i + 1) + '＝' + l; }).join('　') + '</div>' +
    '<table><thead><tr><th style="width:16%">報告組</th>' + c.crit.map(function(cr){ return '<th>' + esc(cr.n) + '<br><small>' + cr.w + '%</small></th>'; }).join('') + (c.comments ? '<th>優點／建議</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<table style="margin-top:8px"><tbody>' + c.crit.map(function(cr){ return '<tr><td style="width:18%"><b>' + esc(cr.n) + '</b></td><td>' + esc(cr.h || '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
}
function csvRaw(){
  var c = G.cfg, rows = [['報告組', '題目', '評分者', '評分者組別', '類型'].concat(c.crit.map(function(x){ return x.n + '(' + x.w + '%)'; }), ['加權平均(1-5)', '換算100分', '優點', '建議'])];
  var W = P.weights(c.crit), kindN = {peer:'同儕', self:'自評', teacher:'老師', paper:'紙本'};
  reviewList().concat(allNotes()).sort(function(a, b){ return a.pres - b.pres || a.grp - b.grp; }).forEach(function(r){
    var ws = r.s ? P.wscore(r.s, W) : null;
    rows.push([gname(r.pres), c.names[r.pres - 1] || '', r.kind === 'teacher' ? '老師' : r.kind === 'paper' ? '紙本' : r.who || '', r.grp ? gname(r.grp) : '', kindN[r.kind] || ''].concat(c.crit.map(function(_, i){ return r.s ? r.s[i] : ''; }), [ws == null ? '' : ws.toFixed(2), ws == null ? '' : P.to100(ws), r.plus || '', r.minus || '']));
  });
  return rows.map(function(r){ return r.map(csvCell).join(','); }).join('\n');
}
function csvSum(){
  var res = result(), c = G.cfg, rows = [['名次', '組別', '題目', '總分', '同儕分', '同儕份數', '老師分', '自評分', '自評落差'].concat(c.crit.map(function(x){ return x.n + '平均'; }))];
  res.groups.slice().sort(function(a, b){ return (a.rank || 99) - (b.rank || 99); }).forEach(function(x){
    rows.push([x.rank || '', gname(x.grp), x.title, f0(x.final), f0(x.peer), x.n, f0(x.teacher), f0(x.self), x.gap == null ? '' : x.gap].concat(x.avg.map(function(v){ return v == null ? '' : v.toFixed(2); })));
  });
  rows.push([]); rows.push(['全班平均', '', '', '', '', '', '', '', ''].concat(res.classAvg.map(function(v){ return v == null ? '' : v.toFixed(2); })));
  return rows.map(function(r){ return r.map(csvCell).join(','); }).join('\n');
}

/* ---------- 老師：主繪製與事件 ---------- */
function render(){
  if(JOIN){ renderStu(); return; }
  var h;
  if(!G || V.home) h = homeView();
  else if(G.stage === 'setup') h = setupView();
  else if(G.stage === 'run') h = runView();
  else h = endView();
  $('app').innerHTML = h;
  if(G && !V.home && NET.want && $('qrJoin')) drawQR('qrJoin', G.stage === 'run' ? 130 : 170);
  T.tick();
}
function readCfg(){
  var c = G.cfg;
  var t = $('cTitle'); if(t) c.title = t.value.trim().slice(0, 30);
  var n = $('cNames'); if(n) c.names = n.value.split(/\r?\n/).map(function(s){ return P.cleanNote(s, 40); }).slice(0, c.groups);
  lsSet('cfg', JSON.stringify({preset:c.preset, crit:c.crit, self:c.self, teacherW:c.teacherW, trim:c.trim, mode:c.mode, comments:c.comments, presSec:c.presSec, scoreSec:c.scoreSec, reveal:c.reveal}));
  saveSoon();
}
document.addEventListener('click', function(e){
  var el = e.target.closest('[data-act],[data-cfg],[data-preset],[data-tsc],[data-psc],[data-sc],[data-grp],[data-fontsize]');
  if(!el) return;
  var ds = el.dataset;
  if(el.tagName === 'A' && ds.act) e.preventDefault();
  if(JOIN && S.click(el, ds)) return;
  if(ds.fontsize){ lsSet('fs', ds.fontsize); applyView(); openSettings(); return; }
  if(ds.cfg && G){
    var v = ds.v === 'true' ? true : ds.v === 'false' ? false : /^\d+$/.test(ds.v) ? +ds.v : ds.v;
    if(G.stage === 'setup') readCfg();
    G.cfg[ds.cfg] = v; if(ds.cfg === 'presSec' && G.stage === 'setup') G.pres.left = v * 1000;
    readCfg(); if(ds.cfg === 'self' || ds.cfg === 'comments') T.push(); render(); return;
  }
  if(ds.preset){ readCfg(); G.cfg.preset = ds.preset; G.cfg.crit = cloneCrit(ds.preset); readCfg(); T.push(); render(); return; }
  if(ds.tsc){ var a = ds.tsc.split(',').map(Number), g = curGrp(), d = G.tdraft[g] = G.tdraft[g] || (G.reviews['T@' + g] ? G.reviews['T@' + g].s.slice() : []); d[a[0]] = a[1];
    var full = G.cfg.crit.every(function(_, i){ return d[i]; });
    if(full){ G.reviews['T@' + g] = {rid:'T', who:'老師', grp:0, pres:g, kind:'teacher', s:d.slice(0, G.cfg.crit.length), at:Date.now()}; }
    saveG(); render(); return; }
  if(ds.psc){ var b = ds.psc.split(',').map(Number); G.pdraft.s[b[0]] = b[1]; G.pdraft.grp = +($('pGrp') || {}).value || G.pdraft.grp; render(); return; }
  var act = ds.act; if(act && ACT[act]) ACT[act](el);
});
document.addEventListener('input', function(e){
  var t = e.target;
  if(JOIN){ S.onInput(t); return; }
  if(!G) return;
  if(t.dataset && t.dataset.ci != null){
    var c = G.cfg.crit[+t.dataset.ci]; if(!c) return;
    if(t.dataset.cf === 'w'){ var w = parseInt(t.value.replace(/[^0-9]/g, ''), 10); c.w = isFinite(w) ? Math.min(100, w) : 0; var ws = $('wsum'); if(ws) ws.textContent = wsum(); }
    else if(t.dataset.cf === 'n') c.n = P.cleanCrit(t.value);
    else c.h = P.cleanNote(t.value, 30);
    readCfg(); return;
  }
  if(t.id === 'cTitle' || t.id === 'cNames') readCfg();
});
document.addEventListener('change', function(e){
  var t = e.target; if(JOIN || !G) return;
  if(t.id === 'cGroups'){ readCfg(); var n = +t.value; G.cfg.groups = n; G.cfg.names = G.cfg.names.slice(0, n); G.order = G.order.filter(function(x){ return x <= n; }); for(var i = 1; i <= n; i++) if(G.order.indexOf(i) < 0) G.order.push(i); readCfg(); T.push(); render(); }
  if(t.id === 'pGrp') G.pdraft.grp = +t.value;
  if(t.dataset && t.dataset.cf === 'n'){ t.value = P.cleanCrit(t.value) || ''; }
});
document.addEventListener('toggle', function(e){ var d = e.target; if(d.dataset && d.dataset.keep) lsSet(d.dataset.keep, d.open ? '1' : '0'); }, true);
$('modal').addEventListener('click', function(e){ if(e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape') closeModal();
  if(!JOIN && G && G.stage === 'run' && e.key === ' ' && !/INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY/.test((e.target.tagName || '')) && !$('modal').classList.contains('show')){
    e.preventDefault();
    if(G.ph === 1) T.open(); else if(G.ph === 2) T.close(); else T.next();
  }
});
var ACT = {
  close:closeModal, warn:function(){ showWarn(); }, settings:openSettings, install:function(){ closeModal(); install(); },
  home:function(){ closeModal(); if(G) saveG(); V.home = true; render(); window.scrollTo(0, 0); },
  resume:function(){ if(G) enterCls(G.cid, true); },
  enterCls:function(el){ enterCls(el.dataset.id, !lockBusy(el.dataset.id)); },
  enterForce:function(el){ enterCls(el.dataset.id, true); },
  newCls:function(){ openModal('<h2>🏫 新增教室</h2><p class="lead">取一個好認的名字，學生手機上也會看到。</p><label class="fld">教室名稱<input id="clsName" maxlength="20" placeholder="例如：三年二班、週六創業班"></label><div class="stack"><button class="btn red" data-act="newClsYes">建立並進入</button><button class="btn alt" data-act="close">取消</button></div>'); setTimeout(function(){ var i = $('clsName'); if(i) i.focus(); }, 50); },
  newClsYes:function(){
    var name = P.cleanRoomName(($('clsName') || {}).value);
    if(!name){ toast('請輸入教室名稱'); return; }
    if(clsList().some(function(c){ return c.name === name; })){ toast('已經有同名的教室'); return; }
    var id = newClsId(), l = clsList(); l.push({id:id, name:name, at:Date.now()}); clsSave(l);
    closeModal(); enterCls(id, true); toast('已建立「' + name + '」');
  },
  renameCls:function(el){ var id = el.dataset.id; openModal('<h2>✏ 改教室名稱</h2><label class="fld">教室名稱<input id="clsName" maxlength="20" value="' + esc(clsName(id)) + '"></label><div class="stack"><button class="btn red" data-act="renameYes" data-id="' + esc(id) + '">儲存</button><button class="btn alt" data-act="close">取消</button></div>'); },
  renameYes:function(el){
    var id = el.dataset.id, name = P.cleanRoomName(($('clsName') || {}).value);
    if(!name){ toast('請輸入教室名稱'); return; }
    if(clsList().some(function(c){ return c.name === name && c.id !== id; })){ toast('已經有同名的教室'); return; }
    var l = clsList(); l.forEach(function(c){ if(c.id === id) c.name = name; }); clsSave(l);
    closeModal(); if(G && G.cid === id) nameSoon(); render();
  },
  delCls:function(el){ var id = el.dataset.id; if(lockBusy(id)){ toast('這間教室正在其他分頁開啟，請先在那邊回到首頁'); return; } openModal('<h2>🗑 刪除「' + esc(clsName(id)) + '」？</h2><p>這間教室的設定、分數、評語都會刪掉，無法復原；學生會離線。需要留存請先下載 CSV。</p><div class="stack"><button class="btn red" data-act="delClsYes" data-id="' + esc(id) + '">刪除教室</button><button class="btn alt" data-act="close">取消</button></div>'); },
  delClsYes:function(el){
    var id = el.dataset.id;
    if(G && G.cid === id) leaveCls(true);
    clsSave(clsList().filter(function(c){ return c.id !== id; })); lsDel(evKey(id)); lsDel('lock.' + id);
    closeModal(); render(); toast('已刪除教室');
  },
  newSetup:function(){
    if(G && Object.keys(G.reviews).length && !V.sureNew){ openModal('<h2>開新的互評？</h2><p>目前「' + esc(G.cfg.title || '上次的互評') + '」的分數會被取代。需要留存請先到結果頁下載 CSV。</p><div class="stack"><button class="btn red" data-act="newSetupYes">開新的互評</button><button class="btn alt" data-act="close">取消</button></div>'); return; }
    ACT.newSetupYes();
  },
  newSetupYes:function(){ closeModal(); if(!G){ ACT.newCls(); return; } G = newEvent({}, G.room, G.cid); V.home = false; saveG(); ensureNet(); T.push(); render(); window.scrollTo(0, 0); },
  again:function(){ var c = JSON.parse(JSON.stringify(G.cfg)); G = newEvent(c, G.room, G.cid); saveG(); T.push(); render(); window.scrollTo(0, 0); toast('同一個代碼，學生不用重新加入'); },
  addCrit:function(){ readCfg(); if(G.cfg.crit.length < P.MAX_CRIT) G.cfg.crit.push({n:'新項目', w:10, h:''}); readCfg(); T.push(); render(); },
  delCrit:function(el){ readCfg(); if(G.cfg.crit.length > 1) G.cfg.crit.splice(+el.dataset.i, 1); readCfg(); T.push(); render(); },
  mvUp:function(el){ var i = +el.dataset.i; if(i > 0){ var o = G.order; o.splice(i - 1, 0, o.splice(i, 1)[0]); } readCfg(); render(); },
  mvDn:function(el){ var i = +el.dataset.i, o = G.order; if(i < o.length - 1) o.splice(i + 1, 0, o.splice(i, 1)[0]); readCfg(); render(); },
  shuffleOrder:function(){ readCfg(); G.order = P.shuffle(G.order); readCfg(); render(); toast('已隨機抽好上台順序'); },
  seqOrder:function(){ readCfg(); G.order = seqOrder(G.cfg.groups); readCfg(); render(); },
  start:function(){
    readCfg();
    var bad = G.cfg.crit.filter(function(c){ return !P.cleanCrit(c.n); }).length;
    if(bad){ toast('有評分項目沒有名稱'); return; }
    var names = {}; G.cfg.crit.forEach(function(c){ names[c.n] = (names[c.n] || 0) + 1; });
    if(Object.keys(names).some(function(k){ return names[k] > 1; })){ toast('評分項目名稱不能重複'); return; }
    G.stage = 'run'; G.cur = 0; G.ph = 1; G.pres = {left:G.cfg.presSec * 1000, runAt:0}; saveG(); ensureNet(); T.push(); rubricSoon(100); render(); window.scrollTo(0, 0);
  },
  goto:function(el){ var i = +el.dataset.i; if(i === G.cur) return; if(G.ph === 2){ V.gotoI = i; openModal('<h2>還在評分中</h2><p>換組會先截止目前這組的評分。</p><div class="stack"><button class="btn red" data-act="gotoYes">截止並換組</button><button class="btn alt" data-act="close">取消</button></div>'); return; } T.go(i); },
  gotoYes:function(){ closeModal(); T.go(V.gotoI); },
  presRun:function(){ G.pres.runAt = Date.now(); saveG(); render(); },
  presPause:function(){ G.pres.left = presLeft(); G.pres.runAt = 0; saveG(); render(); },
  presReset:function(){ G.pres = {left:G.cfg.presSec * 1000, runAt:0}; saveG(); render(); },
  open:function(){ T.open(); }, stop:function(){ T.close(); }, next:function(){ T.next(); },
  reopen:function(){ G.ph = 2; G.until = Date.now() + Math.max(30, G.cfg.scoreSec / 2) * 1000; delete G.done[curGrp()]; snd('open'); T.push(); saveG(); render(); },
  addTime:function(){ if(G.ph === 2){ G.until = Math.max(G.until, Date.now()) + 30000; T.push(); saveSoon(); T.tick(); } },
  showCur:function(){ V.showCur = !V.showCur; render(); },
  tclear:function(){ var g = curGrp(); delete G.reviews['T@' + g]; delete G.tdraft[g]; saveG(); render(); },
  paperAdd:function(){
    var g = curGrp(), pd = G.pdraft; pd.grp = +($('pGrp') || {}).value || 0;
    if(!pd.grp){ toast('請選評分者的組別'); return; }
    if(!G.cfg.crit.every(function(_, i){ return pd.s[i]; })){ toast('每一項都要點分數'); return; }
    G.paperN++; G.reviews['P' + G.paperN + '@' + g] = {rid:'P' + G.paperN, who:'紙本', grp:pd.grp, pres:g, kind:'paper', s:pd.s.slice(0, G.cfg.crit.length), at:Date.now()};
    G.pdraft = {grp:pd.grp, s:[]}; saveG(); render(); toast('已加入一份紙本評分');
  },
  paperDel:function(el){ delete G.reviews[el.dataset.k]; saveG(); render(); },
  toEnd:function(){ if(G.ph === 2) T.close(true); G.stage = 'end'; T.push(); saveG(); render(); window.scrollTo(0, 0); },
  backRun:function(){ G.stage = 'run'; if(G.cur < 0) G.cur = 0; if(G.ph === 2) G.ph = 3; T.push(); saveG(); render(); },
  printSheets:function(){ printHtml(sheetsHtml()); },
  printBlank:function(){ readCfg(); printHtml(blankHtml()); },
  csvRaw:function(){ download(clsName() + '_互評原始分數_' + new Date().toISOString().slice(0, 10) + '.csv', csvRaw()); },
  csvSum:function(){ download(clsName() + '_互評總表_' + new Date().toISOString().slice(0, 10) + '.csv', csvSum()); },
  room:function(){ if(!NET.want){ ACT.netOn(); return; } openModal('<h2>📱 讓學生加入</h2>' + joinBoxHtml() + '<div class="stack"><button class="btn alt" data-act="close">關閉</button></div>', true); drawQR('qrJoin', 200); },
  bigQR:function(){ if(!NET.want) return; openModal('<div style="text-align:center"><h2>📱 掃描加入「' + esc(clsName()) + '」</h2><div class="qr" id="qrBig"></div><div style="font-family:var(--serif);font-size:3.4rem;letter-spacing:.14em;color:var(--red)">' + esc(NET.code) + '</div><p class="small">或打開 ' + esc(ONLINE.replace('https://', '')) + '?join 輸入代碼</p><button class="btn" data-act="close">關閉</button></div>', true); drawQR('qrBig', Math.min(420, window.innerWidth - 80, window.innerHeight - 260)); },
  netOn:function(){ if(G){ G.netOff = false; saveG(); } closeModal(); ensureNet(true); render(); },
  netOff:function(){ openModal('<h2>🚪 關閉教室？</h2><p>所有學生會離線，舊的 QR code 和連結從此失效。之後再開放會換一個新代碼。</p><div class="stack"><button class="btn red" data-act="netOffYes">關閉教室</button><button class="btn alt" data-act="close">取消</button></div>'); },
  netOffYes:function(){ closeModal(); netStop(true); if(G){ G.netOff = true; G.room = P.newRoom(); saveG(); } render(); },
  copyJoin:function(){ copyText(roomUrl(NET.code), '加入連結已複製'); },
  wipeAll:function(){ openModal('<h2>確定嗎？</h2><p>所有教室的分數、評語、設定都會刪掉，無法復原（字體與音效設定會保留）。</p><div class="stack"><button class="btn red" data-act="wipeAllYes">清除全部資料</button><button class="btn alt" data-act="close">取消</button></div>'); },
  wipeAllYes:function(){
    if(NET.want) netStop(NET.role === 'T');
    G = null; setUrl(null);
    var keep = {fs:1, fold:1, warnSeen:1, marquee:1, mute:1, who:1};
    try{ Object.keys(localStorage).forEach(function(k){ if(k.indexOf(PFX) === 0 && !keep[k.slice(PFX.length)]) localStorage.removeItem(k); }); }catch(e){}
    G = null; V.home = true; closeModal(); render(); toast('資料已清除');
  },
  mute:function(){ lsSet('mute', lsGet('mute') === '1' ? '0' : '1'); openSettings(); },
  foldall:function(){ var all = document.querySelectorAll('.set-sec'), any = [].some.call(all, function(d){ return !d.open; }); all.forEach(function(d){ d.open = any; }); }
};
function ensureNet(force){
  if(JOIN || !G) return;
  if(NET.want && NET.code === G.room) return;
  if(!force && G.netOff) return;
  if(NET.want) netStop();
  NET.state = 'T|0'; netStart(G.room); T.push();
}

/* ---------- 警語、設定、安裝 ---------- */
var WARN_HTML = '<h2>⚠ 使用警語</h2><ul>' +
  '<li>同儕互評是<b>同學的主觀意見</b>，難免受人際關係、從眾、印象影響。建議當作<b>回饋與參考</b>，搭配老師評分；用在正式成績時，請事先跟學生說明比重與規則。</li>' +
  '<li>「給分偏寬／偏嚴、全部給滿分」等提醒是統計上的參考，<b>不代表一定亂評</b>，請不要公開點名。</li>' +
  '<li>手機連線借用「創業島」的轉播站，只傳送組別、分數、評語與學生自己填的學號或姓名（最多 8 個字）。<b>學生只看得到老師的畫面</b>，看不到其他同學的分數與評語。轉播站不儲存資料，離線就消失。</li>' +
  '<li>評語會經過轉播站的不雅字詞過濾，仍請提醒學生<b>就事論事、對事不對人</b>，不要填身分證字號、電話等個人資料。</li>' +
  '<li>分數、評語、設定只存在老師這台電腦的瀏覽器。清除瀏覽器資料就會不見；需要留存請下載 CSV 或列印回饋單。</li>' +
  '<li>手機送出受網路影響可能有延遲，評分截止前幾秒送出的可能來不及收到；重要場合請預留時間，或搭配紙本評分單。</li></ul>';
function showWarn(){ openModal(WARN_HTML + '<div class="stack"><button class="btn" data-act="close">我知道了</button></div>'); }
function sec(id, title, val, body){ return '<details class="set-sec" data-sec="' + id + '"><summary><span class="sst">' + title + '</span><span class="ssv">' + esc(val) + '</span></summary><div class="set-body">' + body + '</div></details>'; }
function openSettings(){
  var muted = lsGet('mute') === '1';
  var h = '<div class="top"><h2 style="flex:1 1 0">⚙ 常用設定</h2><button class="ibtn" data-act="foldall">全部展開／收合</button></div>' +
    sec('view', '顯示', lsGet('fs') === 'xl' ? '大字（投影用）' : '標準字', '<div class="stack"><button class="btn' + (lsGet('fs') === 'xl' ? ' alt' : '') + '" data-fontsize="m">標準字</button><button class="btn' + (lsGet('fs') === 'xl' ? '' : ' alt') + '" data-fontsize="xl">大字（投影用）</button></div>') +
    sec('sound', '音效', muted ? '關閉' : '開啟', '<div class="stack"><button class="btn alt" data-act="mute">' + (muted ? '🔊 打開音效' : '🔇 關閉音效') + '</button></div><p class="small">開放評分、截止、收到分數的提示音（瀏覽器合成，不載入音檔）。</p>') +
    (JOIN ? '' : sec('net', '手機連線', NET.want ? '代碼 ' + NET.code : '關閉', '<p class="small">借用創業島轉播站的教室模式，學生只看得到老師。</p><div class="stack">' + (NET.want ? '<button class="btn red" data-act="netOff">🚪 關閉教室（換新代碼）</button>' : '<button class="btn" data-act="netOn">📱 開放手機加入</button>') + '</div>')) +
    (JOIN ? '' : sec('wipe', '🧹 清除全部資料', '', '<p class="small">清掉這台電腦上<b>所有教室</b>的互評分數、評語與設定。字體與音效設定會保留。</p><div class="stack"><button class="btn red" data-act="wipeAll">清除全部資料</button></div>')) +
    sec('about', '關於本工具', '', '<p>👤 創作者 Mark Tsai（蔡豐全）<br><a href="mailto:tsaimark@gmail.com">tsaimark@gmail.com</a></p><div class="stack"><a class="btn alt" href="manual.html">📖 操作手冊</a><a class="btn alt" href="manual.html#creator">👤 創作者資訊</a><button class="btn alt" data-act="warn">⚠ 使用警語</button>' +
      (standalone ? '' : '<button class="btn alt" data-act="install">📲 加入主畫面</button>') + '</div><p class="small" style="margin-top:.5rem">訪客數 <img src="' + BADGE + '" alt="訪客次數" height="20" loading="lazy" style="vertical-align:middle"></p>') +
    '<div class="stack"><button class="btn" data-act="close">關閉</button></div>';
  openModal(h);
  var open = lsJson('fold', []);
  document.querySelectorAll('.set-sec').forEach(function(d){ d.open = open.indexOf(d.dataset.sec) >= 0; d.addEventListener('toggle', saveFold); });
}
function saveFold(){ var o = []; document.querySelectorAll('.set-sec').forEach(function(d){ if(d.open) o.push(d.dataset.sec); }); lsSet('fold', JSON.stringify(o)); }
function applyView(){ document.documentElement.dataset.fs = lsGet('fs') === 'xl' ? 'xl' : 'm'; }
function install(){
  if(window._dp){ window._dp.prompt(); window._dp = null; return; }
  openModal('<h2>📲 加入主畫面</h2><ul><li><b>iPhone／iPad（Safari）</b>：按下方「分享」→「加入主畫面」。</li><li><b>Android（Chrome）</b>：右上角「⋮」→「安裝應用程式」或「加到主畫面」。</li><li><b>電腦（Chrome／Edge）</b>：網址列右邊的安裝圖示。</li></ul><div class="stack"><button class="btn" data-act="close">知道了</button></div>');
}

/* =====================================================================
   學生（手機）端
   ===================================================================== */
var S = {
  code:'', who:'', grp:0, tid:'', room:'', T:null, until:0, gid:0, rub:{}, titles:{}, mine:{}, last:0, draft:null, closed:0, askWho:false, pickGrp:false, whoSent:false, flash:'',
  myName:function(){
    var t = S.T, m = S.last && S.mine[S.last];
    if(t && m && m.s && m.s.length === t.nc) return P.encS({k:'score', gid:S.gid, grp:S.grp, pres:S.last, s:m.s});
    return P.encS({k:'join', gid:S.gid || 0, grp:S.grp});
  },
  start:function(code){
    S.code = code; S.room = lsGet('room.' + code) || ''; S.who = lsGet('who') || ''; S.grp = +(lsGet('grp.' + code) || 0); S.closed = 0;
    S.askWho = !S.who; netStart(code); renderStu();
  },
  names:function(){
    var r = S.rub; if(!r.n) return null;
    var out = []; for(var i = 1; i <= r.n; i++){ if(!r.parts[i]) return null; out = out.concat(r.parts[i]); }
    return S.T && out.length === S.T.nc ? out : null;
  },
  onPeer:function(id, name){
    var t = P.decT(name); if(!t) return;
    S.tid = id;
    var prev = S.T; S.T = t;
    if(t.gid !== S.gid){
      S.gid = t.gid; S.rub = {}; S.titles = {}; S.mine = lsJson('mine.' + S.code + '.' + t.gid, {}); S.last = 0; S.draft = null;
      if(S.grp > t.groups) S.grp = 0;
    }
    if(t.ph === 2) S.until = Date.now() + t.secs * 1000;
    if(t.ph === 2 && (!prev || prev.ph !== 2 || prev.cur !== t.cur) && S.grp && (S.grp !== t.cur || t.self)){ snd('open'); try{ navigator.vibrate && navigator.vibrate(120); }catch(e){} }
    if(!S.whoSent && S.who && NET.status === 'on'){ S.whoSent = true; queueChats([P.encWho(S.who)], 'who'); }
    S.sendState(); renderStu();
  },
  onChat:function(m){
    if(m.id === NET.myId) return;
    if(S.tid && m.id !== S.tid) return;
    var r = P.decRubric(m.text);
    if(r){ if(r.gid !== S.gid && S.gid) return; if(S.rub.n !== r.n) S.rub = {n:r.n, parts:{}}; S.rub.parts[r.i] = r.names; renderStu(); return; }
    var rn = P.decRoomName(m.text);
    if(rn){ S.room = rn; lsSet('room.' + S.code, rn); renderStu(); return; }
    var tt = P.decTitle(m.text);
    if(tt && (!S.gid || tt.gid === S.gid)){ S.titles[tt.grp] = tt.title; renderStu(); }
  },
  sendState:function(){ setName(S.myName()); },
  saveMine:function(){ lsSet('mine.' + S.code + '.' + S.gid, JSON.stringify(S.mine)); },
  curDraft:function(){
    var t = S.T; if(!t || !t.cur) return null;
    if(!S.draft || S.draft.pres !== t.cur || S.draft.gid !== S.gid){ var m = S.mine[t.cur]; S.draft = {pres:t.cur, gid:S.gid, s:m ? m.s.slice() : [], plus:m ? m.plus || '' : '', minus:m ? m.minus || '' : ''}; }
    return S.draft;
  },
  onInput:function(t){
    var d = S.draft; if(!d) return;
    if(t.id === 'nPlus') d.plus = t.value; if(t.id === 'nMinus') d.minus = t.value;
  },
  click:function(el, ds){
    if(ds.grp){ S.grp = +ds.grp; lsSet('grp.' + S.code, String(S.grp)); S.pickGrp = false; S.sendState(); renderStu(); return true; }
    if(ds.sc){ var a = ds.sc.split(','), d = S.curDraft(); if(d){ d.s[+a[0]] = +a[1]; renderStu(); } return true; }
    var act = ds.act;
    if(act === 'saveWho'){ var w = P.cleanWho(($('whoIn') || {}).value); if(!w){ toast('請輸入學號或姓名'); return true; } S.who = w; lsSet('who', w); S.askWho = false; S.whoSent = false; if(NET.status === 'on'){ S.whoSent = true; queueChats([P.encWho(w)], 'who'); } renderStu(); return true; }
    if(act === 'editWho'){ S.askWho = true; renderStu(); return true; }
    if(act === 'changeGrp'){ S.pickGrp = true; renderStu(); return true; }
    if(act === 'submit'){ S.submit(); return true; }
    if(act === 'retry'){ S.closed = 0; netStart(S.code); renderStu(); return true; }
    if(act === 'leave'){ netStop(); location.href = location.pathname + '?join'; return true; }
    if(act === 'joinCode'){ var c = String(($('codeIn') || {}).value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if(c.length !== 6){ toast('代碼是 6 個英文字母或數字'); return true; } history.replaceState(null, '', location.pathname + '?join=' + c); S.start(c); return true; }
    return false;
  },
  submit:function(){
    var t = S.T, d = S.curDraft(); if(!t || t.ph !== 2 || !d) return;
    for(var i = 0; i < t.nc; i++) if(!d.s[i]){ toast('第 ' + (i + 1) + ' 項還沒評分'); return; }
    var plus = t.comments ? P.cleanNote(d.plus, 50) : '', minus = t.comments ? P.cleanNote(d.minus, 50) : '', old = S.mine[t.cur] || {};
    S.mine[t.cur] = {s:d.s.slice(0, t.nc), plus:plus, minus:minus}; S.last = t.cur; S.saveMine();
    S.sendState();
    if(plus && plus !== old.plus) queueChats([P.encNote(S.gid, t.cur, '+', plus)], 'p' + t.cur);
    if(minus && minus !== old.minus) queueChats([P.encNote(S.gid, t.cur, '-', minus)], 'm' + t.cur);
    snd('ok'); S.flash = old.s ? '✅ 已更新，截止前都可以再改' : '✅ 已送出，截止前都可以再改'; renderStu();
    window.scrollTo({top:0, behavior:'smooth'});
  }
};
function stuTop(){ return '<div class="top noprint"><h1>📝 同儕互評</h1><button class="ibtn" data-act="settings" aria-label="常用設定">⚙</button></div>'; }
function renderStu(){
  var h = '<div class="stu">' + stuTop() + (S.code && S.room && !S.closed ? '<div class="roomline">🏫 ' + esc(S.room) + '</div>' : '');
  if(!S.code){
    h += '<section class="card margin"><h2>📱 加入互評</h2><p class="lead">輸入老師投影上的 6 碼代碼。</p><div class="amtin"><input id="codeIn" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="例如 AB3K7Q" style="text-align:center;letter-spacing:.2em;text-transform:uppercase"><button class="btn red" data-act="joinCode">加入</button></div></section>';
  } else if(S.closed){
    h += '<section class="card"><h2>' + (S.closed === 4005 ? '🚫 你已被請出這個教室' : '🚪 教室已關閉，或老師還沒開放') + '</h2><p class="lead">請看老師投影上的代碼是不是 <b>' + esc(S.code) + '</b>。</p><div class="go"><button class="btn red" data-act="retry">再試一次</button><button class="btn alt" data-act="leave">輸入新代碼</button></div></section>';
  } else if(S.askWho){
    h += '<section class="card margin"><h2>👤 你是誰？</h2><p class="lead">填學號或姓名（最多 8 個字），只有老師看得到。不要填身分證字號或電話。</p><div class="amtin"><input id="whoIn" maxlength="8" value="' + esc(S.who) + '" placeholder="學號或姓名"><button class="btn red" data-act="saveWho">下一步</button></div></section>';
  } else if(!S.grp || S.pickGrp){
    var n = S.T ? S.T.groups : 0;
    h += '<section class="card margin"><h2>👥 你是第幾組？</h2>' + (n ? '<p class="lead">選你自己的組別。自己的組報告時' + (S.T.self ? '可以自評（不算進同學給的分數）' : '不用評分') + '。</p><div class="tpick">' + Array.from({length:n}, function(_, i){ return '<button data-grp="' + (i + 1) + '" style="background:' + gcol(i + 1) + '" aria-pressed="' + (S.grp === i + 1) + '">' + gname(i + 1) + '</button>'; }).join('') + '</div>' : '<p class="lead">' + (NET.status === 'on' ? '等老師開放…' : '連線中…') + '</p>') + '</section>';
  } else {
    h += '<div class="mychip">' + gchip(S.grp) + '<span>' + esc(S.who) + '・' + gname(S.grp) + '</span><span class="sp"><button data-act="editWho">改名字</button>　<button data-act="changeGrp">換組</button></span></div>' + stuLive();
  }
  h += '<p class="foot">只有老師看得到你的分數與評語・<a href="#" data-act="warn">使用警語</a></p></div>';
  // 重畫時保留還沒送出的代碼／名字輸入（轉播站訊息隨時會觸發重畫）
  var keep = {}; ['codeIn', 'whoIn'].forEach(function(id){ var el = $(id); if(el && el.value) keep[id] = el.value; });
  keepFocus(function(){ $('app').innerHTML = h; Object.keys(keep).forEach(function(id){ var el = $(id); if(el) el.value = keep[id]; }); });
  stuTick();
}
function stuLive(){
  var t = S.T;
  if(!t) return '<section class="card"><p class="bigstate">' + (NET.status === 'on' ? '等老師開始…' : '連線中…') + '</p></section>';
  if(t.ph === 9) return '<section class="card"><p class="bigstate">🎉 互評結束<br>謝謝你認真給回饋！</p><p class="lead" style="text-align:center">你這次評了 ' + Object.keys(S.mine).length + ' 組。</p></section>';
  if(t.ph === 0 || !t.cur) return '<section class="card"><p class="bigstate">✅ 已加入<br>等老師開始</p><p class="lead" style="text-align:center">待會每組報告完，這裡會出現評分表。</p></section>';
  var own = t.cur === S.grp, title = S.titles[t.cur] || '', head = '<section class="card margin"><div class="small">現在上台</div><h2 style="color:' + gcol(t.cur) + ';font-size:1.6rem">' + gname(t.cur) + '</h2>' + (title ? '<div style="font-weight:700">' + esc(title) + '</div>' : '') + '</section>';
  if(own && !t.self) return head + '<section class="card"><p class="bigstate">' + (t.ph === 1 ? '🎤 輪到你們上台<br>加油！' : '這是你們組<br>不用評分') + '</p></section>';
  if(t.ph === 1) return head + '<section class="card"><p class="bigstate">🎤 報告中<br>' + (own ? '你們上台，結束後可以自評' : '仔細聽，等一下要評分') + '</p></section>';
  var mine = S.mine[t.cur];
  if(t.ph === 3) return head + '<section class="card"><p class="bigstate">⏹ 評分已截止</p>' + (mine ? '<p class="lead" style="text-align:center">你給的分數：' + mine.s.join('、') + '</p>' : '<p class="lead" style="text-align:center">這組你沒有送出評分。</p>') + '</section>';
  // 評分中
  var names = S.names();
  if(!names) return head + '<section class="card"><p class="bigstate">✍ 開放評分了<br><small class="small">正在接收評分項目…</small></p></section>';
  var d = S.curDraft(), sent = !!mine;
  var h = head + (S.flash && sent ? '<div class="alert ok">' + esc(S.flash) + '</div>' : '') +
    '<section class="card">' + (own ? '<div class="alert warn">🪞 這是自評，不會算進同學給的分數</div>' : '') +
    '<div style="display:flex;align-items:center"><h2 style="flex:1">✍ ' + (own ? '自評' : '幫這組評分') + '</h2><span class="clock" style="font-size:1.6rem" id="scd"></span></div>' +
    names.map(function(nm, i){ return '<div class="sitem"><div class="q"><span class="no">' + (i + 1) + '</span>' + esc(nm) + (d.s[i] ? '<small>' + P.LEVELS[d.s[i] - 1] + '</small>' : '') + '</div><div class="pick5">' + [1, 2, 3, 4, 5].map(function(v){ return '<button data-sc="' + i + ',' + v + '" aria-pressed="' + (d.s[i] === v) + '">' + v + '<small>' + P.LEVELS[v - 1] + '</small></button>'; }).join('') + '</div></div>'; }).join('') +
    (t.comments ? '<div class="sitem"><label class="fld">👍 一句優點（選填）<input class="notein" id="nPlus" maxlength="50" value="' + esc(d.plus) + '" placeholder="例如：例子很生活化"></label><label class="fld" style="margin-top:.5rem">💡 一句建議（選填）<input class="notein" id="nMinus" maxlength="50" value="' + esc(d.minus) + '" placeholder="例如：結論可以再清楚一點"></label><p class="small">對事不對人，具體說哪裡好、哪裡可以更好。</p></div>' : '') +
    '<div class="sendbar"><button class="btn red" data-act="submit">' + (sent ? '🔁 更新評分' : '📨 送出評分') + '</button></div></section>';
  return h;
}
function stuTick(){
  var el = $('scd'); if(!el || !S.T || S.T.ph !== 2) return;
  var left = S.until - Date.now(); el.textContent = mmss(left); el.className = 'clock' + (left < 10000 ? ' hot' : '');
}

/* ---------- 跑馬燈（工作區共用公告，不可關） ---------- */
function initMarquee(){
  var URL_ = "https://script.google.com/macros/s/AKfycbwKX0DNNbY8y4nf90BFTHtxgfqJcHHcZasRrgycl4QAe52_hkjMWSkYk4xOsqU-JPCROw/exec";
  var REFRESH = 20 * 60 * 1000, bar = $('marqueeBar'), track = $('marqueeTrack'), lastKey = null;
  function appendText(c, text){ var re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, li = 0, m; while((m = re.exec(text))){ if(m.index > li) c.appendChild(document.createTextNode(text.slice(li, m.index))); var a = document.createElement('a'); a.href = m[2]; a.textContent = m[1]; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.color = 'inherit'; a.style.textDecoration = 'underline'; c.appendChild(a); li = re.lastIndex; } if(li < text.length) c.appendChild(document.createTextNode(text.slice(li))); }
  function renderM(items){
    if(!items || !items.length) return;
    var k = JSON.stringify(items); if(k === lastKey) return; lastKey = k; track.innerHTML = '';
    var fr = document.createDocumentFragment();
    function pass(){ items.forEach(function(it, i){ if(i > 0) fr.appendChild(document.createTextNode('　★　')); appendText(fr, String(it)); }); }
    pass(); fr.appendChild(document.createTextNode('　★　')); pass(); track.appendChild(fr);
    bar.classList.add('show'); document.body.classList.add('has-marquee');
    track.style.animationDuration = Math.max(track.scrollWidth / 2 / 60, 12) + 's';
  }
  function fetchM(){ fetch(URL_, {method:'POST', body:JSON.stringify({serial:''})}).then(function(r){ return r.json(); }).then(function(d){ if(d && Array.isArray(d.marquee) && d.marquee.length){ lsSet('marquee', JSON.stringify(d.marquee)); renderM(d.marquee); } }).catch(function(){}); }
  renderM(lsJson('marquee', [])); fetchM(); setInterval(fetchM, REFRESH);
}

window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); window._dp = e; });
if('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('service-worker.js').catch(function(){});
(function(){ if(!window.SOC_WATERMARK) return; var w = document.createElement('div'); w.id = 'printWm'; w.setAttribute('aria-hidden', 'true'); w.innerHTML = '<img alt="" src="' + window.SOC_WATERMARK + '">'; document.body.appendChild(w); })();
applyView();
if(JOIN){
  var jc = String(QS.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if(jc.length === 6) S.start(jc); else renderStu();
  setInterval(stuTick, 250);
} else {
  migrate();
  var qc = QS.get('c');
  if(qc && clsGet(qc)) enterCls(qc); else { setUrl(null); render(); }
  setInterval(T.tick, 250);
  // 分頁鎖：被其他分頁接手就退出；首頁的「其他分頁開啟中」標示也順便更新
  setInterval(function(){
    if(G){ if(lockBusy(G.cid)){ var nm = clsName(); leaveCls(false); render(); openModal('<h2>🏫 「' + esc(nm) + '」已改在另一個分頁開啟</h2><p>這個分頁已退出這間教室，避免兩邊同時改動分數。</p><div class="stack"><button class="btn" data-act="close">知道了</button></div>'); } else lockTake(G.cid); }
    var box = $('clsList');
    if(V.home && box && !$('modal').classList.contains('show')){ var tmp = document.createElement('div'); tmp.innerHTML = clsListHtml(); if(tmp.firstChild.innerHTML !== box.innerHTML) box.innerHTML = tmp.firstChild.innerHTML; }
  }, 2000);
  // 評分中每 10 秒重送一次剩餘秒數，剛加入的手機倒數才準
  setInterval(function(){ if(G && G.stage === 'run' && G.ph === 2) T.push(); }, 10000);
  if(!lsGet('warnSeen')){ lsSet('warnSeen', '1'); showWarn(); }
}
initMarquee();
window.addEventListener('pagehide', function(){ if(G){ saveG(); lockFree(G.cid); } });
window._prb = {get G(){ return G; }, set G(v){ G = v; }, T:T, S:S, NET:NET, ACT:ACT, render:render, V:V, P:P, result:function(){ return result(); }};
})();
