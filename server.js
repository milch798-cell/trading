// 무역왕! 서버 — Express + Socket.IO
// 모든 게임 규칙(거래, 경제 발전)은 서버에서 검사하므로 학생 기기에서 값을 바꿀 수 없습니다.
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { GOODS, COUNTRIES, COUNTRY_ORDER, SETTINGS } = require('./game-data');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');
const ROOM_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3일 지난 방은 정리

const josa = (w, a, b) => { const s = String(w); const c = s.charCodeAt(s.length - 1); const has = c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0; return s + (has ? a : b); };
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/config.json', (req, res) => res.json({ GOODS, COUNTRIES, COUNTRY_ORDER, SETTINGS }));
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

const server = http.createServer(app);
const io = new Server(server);

/** @type {Map<string, any>} */
const rooms = new Map();

// ---------- 저장/불러오기 (서버를 껐다 켜도 게임이 이어지도록) ----------
function loadRooms() {
  try {
    const arr = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const now = Date.now();
    for (const r of arr) if (now - r.updatedAt < ROOM_TTL_MS) rooms.set(r.code, r);
    console.log(`저장된 게임방 ${rooms.size}개를 불러왔습니다.`);
  } catch { /* 처음 실행 */ }
}
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify([...rooms.values()]));
    } catch (e) { console.error('저장 실패', e.message); }
  }, 800);
}

// ---------- 방 만들기 ----------
const randDigits = (n) => Array.from({ length: n }, () => crypto.randomInt(10)).join('');
function uniqueRoomCode() {
  let c;
  do { c = randDigits(4); } while (rooms.has(c) || c[0] === '0');
  return c;
}
function freshCountry(id, groupCode) {
  return {
    id, groupCode,
    cash: SETTINGS.startCash,
    stage: 0,
    inventory: { ...COUNTRIES[id].startInventory },
    stageTimes: [null, null, null],
    savings: 0,      // 알뜰 수입으로 아낀 돈(억원)
    credited: {},    // 시민 만족도에 반영된 수입품 개수 (물건별)
  };
}

// ---------- 시민 만족도 ----------
// 필요한 물건을 기준 가격보다 싸게 수입하면 아낀 만큼 시민 만족도가 오릅니다.
// 짜고 주고받기를 막기 위해 우리 시민에게 필요한 물건만, 필요한 개수까지만 셉니다.
function needCap(id, good) {
  return COUNTRIES[id].needs.filter((n) => n.good === good).reduce((a, n) => a + n.qty, 0);
}
function satisfaction(c) {
  const fromStage = c.stage * SETTINGS.satPerStage;
  const fromSaving = Math.min(SETTINGS.satSavingMax, Math.floor((c.savings || 0) / SETTINGS.savingPerPoint));
  return { total: fromStage + fromSaving, fromStage, fromSaving };
}
// buyer가 gave를 내고 got을 받았을 때 아낀 돈을 계산해 반영하고, 늘어난 만족도(%)를 돌려줍니다.
function creditSavings(buyer, gave, got) {
  const units = Object.values(got.items).reduce((a, n) => a + n, 0);
  if (!units) return 0;
  const givenItems = Object.values(gave.items).reduce((a, n) => a + n, 0);
  const cost = gave.cash + givenItems * SETTINGS.basePrice - got.cash;   // 실제로 치른 값
  const unitPrice = cost / units;                                         // 1개당 값
  const save = Math.max(0, SETTINGS.basePrice - unitPrice);
  if (!save) return 0;
  buyer.credited = buyer.credited || {};
  const before = satisfaction(buyer).fromSaving;
  for (const [g, n] of Object.entries(got.items)) {
    const left = needCap(buyer.id, g) - (buyer.credited[g] || 0);
    const k = Math.min(n, Math.max(0, left));
    if (k > 0) {
      buyer.credited[g] = (buyer.credited[g] || 0) + k;
      buyer.savings = (buyer.savings || 0) + Math.round(k * save);
    }
  }
  return satisfaction(buyer).fromSaving - before;
}
function createRoom() {
  const code = uniqueRoomCode();
  const used = new Set();
  const countries = {};
  for (const id of COUNTRY_ORDER) {
    let gc;
    do { gc = randDigits(4); } while (used.has(gc));
    used.add(gc);
    countries[id] = freshCountry(id, gc);
  }
  const room = {
    code,
    teacherKey: crypto.randomBytes(12).toString('hex'),
    createdAt: Date.now(), updatedAt: Date.now(),
    status: 'lobby',            // lobby | playing | paused | ended
    timer: { endsAt: null, pausedRemaining: null },
    countries, offers: [], log: [], notice: null, seq: 0,
  };
  rooms.set(code, room);
  return room;
}

// ---------- 거래 도우미 ----------
function cleanBundle(b) {
  const out = { items: {}, cash: 0 };
  if (!b || typeof b !== 'object') return out;
  if (b.items && typeof b.items === 'object') {
    for (const [g, n] of Object.entries(b.items)) {
      if (!GOODS[g]) continue;
      const k = Math.floor(Number(n));
      if (k > 0 && k <= 99) out.items[g] = k;
    }
  }
  const cash = Math.floor(Number(b.cash));
  if (Number.isFinite(cash) && cash > 0 && cash <= 10000000) out.cash = cash;
  return out;
}
const bundleEmpty = (b) => b.cash === 0 && Object.keys(b.items).length === 0;
function lackOf(country, b) {
  if (country.cash < b.cash) return '국가 자산(돈)';
  for (const [g, n] of Object.entries(b.items)) {
    if ((country.inventory[g] || 0) < n) return GOODS[g].name;
  }
  return null;
}
function move(a, b, bundle) {
  a.cash -= bundle.cash; b.cash += bundle.cash;
  for (const [g, n] of Object.entries(bundle.items)) {
    a.inventory[g] = (a.inventory[g] || 0) - n;
    if (a.inventory[g] <= 0) delete a.inventory[g];
    b.inventory[g] = (b.inventory[g] || 0) + n;
  }
}
function tradeKind(give, want) {
  const gi = Object.keys(give.items).length, wi = Object.keys(want.items).length;
  if (give.cash === 0 && want.cash === 0) return '물물교환';
  if ((gi === 0 && wi > 0 && want.cash === 0) || (wi === 0 && gi > 0 && give.cash === 0)) return '현금거래';
  return '물건+현금';
}
function addLog(room, entry) {
  room.log.push({ t: Date.now(), ...entry });
  if (room.log.length > 400) room.log.splice(0, room.log.length - 400);
}

// ---------- 학습용 통계: 의존(누가 누구와 거래했나)과 경쟁(같은 물건을 누가 팔았나) ----------
function computeStats(room) {
  const pairs = {};                       // 'blue|red' -> 거래 횟수
  const sold = {};                        // good -> { country: 판 개수 }
  const imports = {};                     // country -> { from country: 개수 }
  for (const id of COUNTRY_ORDER) imports[id] = {};
  for (const e of room.log) {
    if (e.type !== 'trade') continue;
    const key = [e.from, e.to].sort().join('|');
    pairs[key] = (pairs[key] || 0) + 1;
    const record = (seller, buyer, items) => {
      for (const [g, n] of Object.entries(items)) {
        sold[g] = sold[g] || {};
        sold[g][seller] = (sold[g][seller] || 0) + n;
        imports[buyer][seller] = (imports[buyer][seller] || 0) + n;
      }
    };
    record(e.from, e.to, e.give.items);
    record(e.to, e.from, e.want.items);
  }
  return { pairs, sold, imports };
}

// ---------- 화면에 보낼 상태 ----------
function onlineCount(room, id) {
  return io.sockets.adapter.rooms.get(`${room.code}:${id}`)?.size || 0;
}
function stateFor(room, role, me) {
  const countries = {};
  for (const id of COUNTRY_ORDER) {
    const c = room.countries[id];
    countries[id] = { id, cash: c.cash, stage: c.stage, inventory: c.inventory, stageTimes: c.stageTimes, online: onlineCount(room, id), savings: c.savings || 0, satisfaction: satisfaction(c) };
    if (role === 'teacher') countries[id].groupCode = c.groupCode;
  }
  const offers = role === 'teacher'
    ? room.offers.filter((o) => o.status === 'pending')
    : room.offers.filter((o) => o.from === me || o.to === me).slice(-40);
  return {
    code: room.code, role, me: me || null,
    status: room.status, timer: room.timer, serverNow: Date.now(),
    notice: room.notice, countries, offers,
    log: room.log.slice(-80),
    stats: computeStats(room),
  };
}
function broadcast(room) {
  room.updatedAt = Date.now();
  io.to(`${room.code}:teacher`).emit('state', stateFor(room, 'teacher'));
  for (const id of COUNTRY_ORDER) io.to(`${room.code}:${id}`).emit('state', stateFor(room, 'group', id));
  scheduleSave();
}
const toastTo = (room, target, text, kind = 'info') => io.to(`${room.code}:${target}`).emit('toast', { text, kind });

// ---------- 타이머 ----------
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status === 'playing' && room.timer.endsAt && room.timer.endsAt <= now) {
      room.status = 'paused';
      room.timer = { endsAt: null, pausedRemaining: null };
      addLog(room, { type: 'system', text: '⏰ 제한시간이 끝났어요. 무역이 멈췄습니다.' });
      io.to(room.code).emit('toast', { text: '⏰ 제한시간 끝! 무역이 멈췄어요.', kind: 'warn' });
      broadcast(room);
    }
  }
}, 1000);

// ---------- 소켓 ----------
io.on('connection', (socket) => {
  const ctx = () => {
    const d = socket.data;
    const room = d.roomCode && rooms.get(d.roomCode);
    return room ? { room, role: d.role, me: d.countryId } : null;
  };
  const fail = (ack, msg) => typeof ack === 'function' && ack({ ok: false, error: msg });
  const ok = (ack, extra = {}) => typeof ack === 'function' && ack({ ok: true, ...extra });
  const leaveAll = () => { for (const r of socket.rooms) if (r !== socket.id) socket.leave(r); };
  const refreshOnline = () => { const c = ctx(); if (c) broadcast(c.room); };

  // 선생님: 게임방 만들기
  socket.on('teacher:create', (_, ack) => {
    const room = createRoom();
    leaveAll();
    socket.data = { roomCode: room.code, role: 'teacher' };
    socket.join([room.code, `${room.code}:teacher`]);
    addLog(room, { type: 'system', text: '🏝️ 게임방이 열렸어요.' });
    ok(ack, { roomCode: room.code, teacherKey: room.teacherKey });
    broadcast(room);
  });

  // 선생님: 다시 들어가기
  socket.on('teacher:join', ({ roomCode, teacherKey } = {}, ack) => {
    const room = rooms.get(String(roomCode || '').trim());
    if (!room || room.teacherKey !== teacherKey) return fail(ack, '게임방을 찾을 수 없어요.');
    leaveAll();
    socket.data = { roomCode: room.code, role: 'teacher' };
    socket.join([room.code, `${room.code}:teacher`]);
    ok(ack, { roomCode: room.code });
    socket.emit('state', stateFor(room, 'teacher'));
  });

  // 모둠: 방 코드 + 모둠 코드로 입장
  socket.on('group:join', ({ roomCode, groupCode } = {}, ack) => {
    const room = rooms.get(String(roomCode || '').trim());
    if (!room) return fail(ack, '방 코드를 다시 확인해 주세요.');
    const gc = String(groupCode || '').trim();
    const id = COUNTRY_ORDER.find((k) => room.countries[k].groupCode === gc);
    if (!id) return fail(ack, '모둠 코드를 다시 확인해 주세요.');
    leaveAll();
    socket.data = { roomCode: room.code, role: 'group', countryId: id };
    socket.join([room.code, `${room.code}:${id}`]);
    ok(ack, { roomCode: room.code, countryId: id });
    broadcast(room);
  });

  socket.on('disconnect', () => setTimeout(refreshOnline, 200));

  // ----- 모둠 행동 -----
  socket.on('offer:create', (payload = {}, ack) => {
    const c = ctx();
    if (!c || c.role !== 'group') return fail(ack, '먼저 입장해 주세요.');
    const { room, me } = c;
    if (room.status !== 'playing') return fail(ack, '지금은 무역 시간이 아니에요. 선생님의 신호를 기다려요.');
    const to = payload.to;
    if (!COUNTRIES[to] || to === me) return fail(ack, '거래할 나라를 골라 주세요.');
    const give = cleanBundle(payload.give);
    const want = cleanBundle(payload.want);
    if (bundleEmpty(give) || bundleEmpty(want)) return fail(ack, '주는 것과 받는 것을 모두 정해 주세요.');
    if (Object.keys(give.items).length + Object.keys(want.items).length === 0) return fail(ack, '돈끼리는 바꿀 수 없어요. 물건을 넣어 주세요.');
    const myLack = lackOf(room.countries[me], give);
    if (myLack) return fail(ack, `우리 창고에 ${josa(myLack,'이','가')} 부족해요.`);
    const theirLack = lackOf(room.countries[to], { items: want.items, cash: 0 });
    if (theirLack) return fail(ack, `${COUNTRIES[to].name} 창고에 ${josa(theirLack,'이','가')} 부족해요.`);
    const pending = room.offers.filter((o) => o.from === me && o.status === 'pending').length;
    if (pending >= SETTINGS.maxPendingOffers) return fail(ack, `답을 기다리는 제안이 너무 많아요. (최대 ${SETTINGS.maxPendingOffers}개)`);
    const message = String(payload.message || '').slice(0, 60);
    const offer = {
      id: `${room.code}-${++room.seq}`, from: me, to, give, want, message,
      kind: tradeKind(give, want), status: 'pending', createdAt: Date.now(), resolvedAt: null, reason: null,
    };
    room.offers.push(offer);
    if (room.offers.length > 500) room.offers.splice(0, room.offers.length - 500);
    toastTo(room, to, `📨 ${COUNTRIES[me].name}에서 무역 제안이 왔어요!`, 'offer');
    ok(ack);
    broadcast(room);
  });

  socket.on('offer:respond', ({ offerId, accept } = {}, ack) => {
    const c = ctx();
    if (!c || c.role !== 'group') return fail(ack, '먼저 입장해 주세요.');
    const { room, me } = c;
    const o = room.offers.find((x) => x.id === offerId);
    if (!o || o.to !== me || o.status !== 'pending') return fail(ack, '이미 끝난 제안이에요.');
    const from = room.countries[o.from], to = room.countries[o.to];
    if (!accept) {
      o.status = 'rejected'; o.resolvedAt = Date.now();
      toastTo(room, o.from, `🙅 ${josa(COUNTRIES[me].name,'이','가')} 제안을 거절했어요.`, 'warn');
      ok(ack); return broadcast(room);
    }
    if (room.status !== 'playing') return fail(ack, '지금은 무역 시간이 아니에요.');
    const lackFrom = lackOf(from, o.give);
    if (lackFrom) {
      o.status = 'failed'; o.resolvedAt = Date.now(); o.reason = `${COUNTRIES[o.from].name}의 ${josa(lackFrom,'이','가')} 부족해졌어요.`;
      toastTo(room, o.from, `⚠️ 제안이 취소됐어요: 우리 ${josa(lackFrom,'이','가')} 부족해요.`, 'warn');
      ok(ack, { note: o.reason }); return broadcast(room);
    }
    const lackTo = lackOf(to, o.want);
    if (lackTo) return fail(ack, `우리 창고에 ${josa(lackTo,'이','가')} 부족해서 수락할 수 없어요.`);
    move(from, to, o.give);
    move(to, from, o.want);
    o.status = 'accepted'; o.resolvedAt = Date.now();
    const satFrom = creditSavings(from, o.give, o.want);   // 제안한 나라: give를 내고 want를 받음
    const satTo = creditSavings(to, o.want, o.give);       // 수락한 나라: want를 내고 give를 받음
    addLog(room, { type: 'trade', from: o.from, to: o.to, give: o.give, want: o.want, kind: o.kind, satFrom, satTo });
    if (satFrom > 0) toastTo(room, o.from, `😊 필요한 물건을 싸게 수입했어요! 시민 만족도 +${satFrom}%`, 'good');
    if (satTo > 0) toastTo(room, o.to, `😊 필요한 물건을 싸게 수입했어요! 시민 만족도 +${satTo}%`, 'good');
    toastTo(room, o.from, `🤝 ${josa(COUNTRIES[me].name,'과','와')} 무역 성공!`, 'good');
    toastTo(room, o.to, `🤝 ${josa(COUNTRIES[o.from].name,'과','와')} 무역 성공!`, 'good');
    ok(ack); broadcast(room);
  });

  socket.on('offer:cancel', ({ offerId } = {}, ack) => {
    const c = ctx();
    if (!c || c.role !== 'group') return fail(ack, '먼저 입장해 주세요.');
    const o = c.room.offers.find((x) => x.id === offerId);
    if (!o || o.from !== c.me || o.status !== 'pending') return fail(ack, '이미 끝난 제안이에요.');
    o.status = 'cancelled'; o.resolvedAt = Date.now();
    ok(ack); broadcast(c.room);
  });

  // 부족한 물건으로 문제 해결 → 경제발전 1단계 + 국가 자산 1조원
  socket.on('need:resolve', (_, ack) => {
    const c = ctx();
    if (!c || c.role !== 'group') return fail(ack, '먼저 입장해 주세요.');
    const { room, me } = c;
    if (room.status !== 'playing') return fail(ack, '지금은 무역 시간이 아니에요.');
    const country = room.countries[me];
    if (country.stage >= 3) return fail(ack, '이미 모든 문제를 해결했어요!');
    const need = COUNTRIES[me].needs[country.stage];
    const have = country.inventory[need.good] || 0;
    if (have < need.qty) return fail(ack, `${GOODS[need.good].name} ${need.qty}개가 필요해요. 지금 ${have}개 있어요.`);
    country.inventory[need.good] -= need.qty;
    if (country.inventory[need.good] <= 0) delete country.inventory[need.good];
    country.stageTimes[country.stage] = Date.now();
    country.stage += 1;
    country.cash += SETTINGS.levelBonus;
    addLog(room, { type: 'levelup', country: me, stage: country.stage, good: need.good, qty: need.qty });
    io.to(`${room.code}:${me}`).emit('celebrate', { stage: country.stage, good: need.good, qty: need.qty, sat: SETTINGS.satPerStage });
    io.to(room.code).except(`${room.code}:${me}`).emit('toast', { text: `🎉 ${josa(COUNTRIES[me].name,'이','가')} 경제발전 ${country.stage}단계를 달성했어요!`, kind: 'good' });
    ok(ack); broadcast(room);
  });

  // ----- 선생님 행동 -----
  const teacher = (ack) => {
    const c = ctx();
    if (!c || c.role !== 'teacher') { fail(ack, '선생님만 할 수 있어요.'); return null; }
    return c.room;
  };

  socket.on('teacher:status', ({ status } = {}, ack) => {
    const room = teacher(ack); if (!room) return;
    const t = room.timer;
    if (status === 'playing') {
      if (t.pausedRemaining) { t.endsAt = Date.now() + t.pausedRemaining; t.pausedRemaining = null; }
      addLog(room, { type: 'system', text: room.status === 'lobby' ? '🚢 무역을 시작합니다!' : '▶️ 무역을 다시 시작합니다.' });
      room.status = 'playing';
    } else if (status === 'paused') {
      if (t.endsAt) { t.pausedRemaining = Math.max(0, t.endsAt - Date.now()); t.endsAt = null; }
      room.status = 'paused';
      addLog(room, { type: 'system', text: '⏸️ 잠시 멈춤! 선생님 말씀을 들어요.' });
    } else if (status === 'ended') {
      room.status = 'ended';
      room.timer = { endsAt: null, pausedRemaining: null };
      for (const o of room.offers) if (o.status === 'pending') { o.status = 'cancelled'; o.resolvedAt = Date.now(); }
      addLog(room, { type: 'system', text: '🏁 게임이 끝났어요. 결과를 확인해요!' });
    } else return fail(ack, '알 수 없는 상태예요.');
    ok(ack); broadcast(room);
  });

  socket.on('teacher:timer', ({ minutes } = {}, ack) => {
    const room = teacher(ack); if (!room) return;
    const m = Math.floor(Number(minutes));
    if (!m || m <= 0) {
      room.timer = { endsAt: null, pausedRemaining: null };
    } else {
      const ms = Math.min(m, 60) * 60000;
      room.timer = room.status === 'playing' ? { endsAt: Date.now() + ms, pausedRemaining: null } : { endsAt: null, pausedRemaining: ms };
      addLog(room, { type: 'system', text: `⏱️ 제한시간 ${m}분이 정해졌어요.` });
    }
    ok(ack); broadcast(room);
  });

  socket.on('teacher:produce', (_, ack) => {
    const room = teacher(ack); if (!room) return;
    for (const id of COUNTRY_ORDER) {
      const inv = room.countries[id].inventory;
      for (const g of COUNTRIES[id].produces) inv[g] = (inv[g] || 0) + 1;
    }
    addLog(room, { type: 'system', text: '🏭 생산의 시간! 모든 나라가 자기 나라 물건을 1개씩 더 만들었어요.' });
    io.to(room.code).emit('toast', { text: '🏭 새 물건이 생산되었어요!', kind: 'good' });
    ok(ack); broadcast(room);
  });

  socket.on('teacher:notice', ({ text } = {}, ack) => {
    const room = teacher(ack); if (!room) return;
    const s = String(text || '').trim().slice(0, 100);
    room.notice = s ? { text: s, t: Date.now() } : null;
    if (s) io.to(room.code).emit('toast', { text: `📢 ${s}`, kind: 'info' });
    ok(ack); broadcast(room);
  });

  socket.on('teacher:adjust', ({ countryId, cashDelta, good, itemDelta } = {}, ack) => {
    const room = teacher(ack); if (!room) return;
    const c = room.countries[countryId];
    if (!c) return fail(ack, '나라를 골라 주세요.');
    const cd = Math.floor(Number(cashDelta) || 0);
    c.cash = Math.max(0, c.cash + cd);
    if (GOODS[good]) {
      const d = Math.floor(Number(itemDelta) || 0);
      c.inventory[good] = Math.max(0, (c.inventory[good] || 0) + d);
      if (!c.inventory[good]) delete c.inventory[good];
    }
    addLog(room, { type: 'system', text: `🛠️ 선생님이 ${COUNTRIES[countryId].name}의 창고를 조정했어요.` });
    ok(ack); broadcast(room);
  });

  socket.on('teacher:reset', (_, ack) => {
    const room = teacher(ack); if (!room) return;
    for (const id of COUNTRY_ORDER) room.countries[id] = freshCountry(id, room.countries[id].groupCode);
    room.offers = []; room.log = []; room.notice = null;
    room.status = 'lobby'; room.timer = { endsAt: null, pausedRemaining: null };
    addLog(room, { type: 'system', text: '🔄 게임이 처음 상태로 돌아갔어요.' });
    ok(ack); broadcast(room);
  });
});

loadRooms();
server.listen(PORT, () => {
  const nets = require('os').networkInterfaces();
  const ips = Object.values(nets).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  console.log('\n🚢 무역왕! 서버가 켜졌어요.');
  console.log(`   이 컴퓨터:  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`   학생 기기:  http://${ip}:${PORT}`);
  console.log('');
});
