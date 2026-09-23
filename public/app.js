/* 무역왕! 클라이언트 */
(() => {
  const socket = io({ transports: ['websocket', 'polling'] });
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const josa = (w, a, b) => { const s = String(w); const c = s.charCodeAt(s.length - 1); const has = c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0; return s + (has ? a : b); };
  let CFG = null;         // 게임 데이터 (/config.json)
  let state = null;       // 서버가 보낸 최신 상태
  let skew = 0;           // 서버 시계 - 내 시계
  let mounted = null;     // 'group' | 'teacher'
  let session = loadSession();

  // ---------- 저장된 입장 정보 ----------
  function loadSession() { try { return JSON.parse(localStorage.getItem('tk-session')) || null; } catch { return null; } }
  function saveSession(s) { session = s; try { s ? localStorage.setItem('tk-session', JSON.stringify(s)) : localStorage.removeItem('tk-session'); } catch {} }
  function teacherRooms() { try { return JSON.parse(localStorage.getItem('tk-teacher-rooms')) || []; } catch { return []; } }
  function rememberTeacherRoom(code, key) {
    const list = teacherRooms().filter((r) => r.code !== code);
    list.unshift({ code, key, t: Date.now() });
    try { localStorage.setItem('tk-teacher-rooms', JSON.stringify(list.slice(0, 5))); } catch {}
  }

  // ---------- 표시 도우미 ----------
  const G = (id) => CFG.GOODS[id];
  const C = (id) => CFG.COUNTRIES[id];
  function won(eok) {
    const jo = Math.floor(eok / 10000), r = eok % 10000;
    if (jo && r) return `${jo}조 ${r.toLocaleString()}억원`;
    if (jo) return `${jo}조원`;
    return `${r.toLocaleString()}억원`;
  }
  const goodLabel = (g, n) => `${G(g).icon} ${G(g).name}${n > 1 ? ` ×${n}` : ''}`;
  function bundleHTML(b) {
    const parts = Object.entries(b.items).map(([g, n]) => `<span class="chip">${goodLabel(g, n)}</span>`);
    if (b.cash) parts.push(`<span class="chip chip-cash">💰 ${won(b.cash)}</span>`);
    return parts.join('') || '<span class="muted">없음</span>';
  }
  const countryTag = (id, extra = '') => `<span class="ctag ${extra}" style="--c:${C(id).color};--ci:${C(id).ink}">${esc(C(id).name)}</span>`;
  const stagePips = (stage) => `<span class="pips" aria-label="경제발전 ${stage}단계">${[1, 2, 3].map((i) => `<i class="${i <= stage ? 'on' : ''}"></i>`).join('')}</span>`;
  const invTotal = (inv) => Object.values(inv).reduce((a, b) => a + b, 0);
  const statusText = { lobby: '준비 중', playing: '무역 중', paused: '잠시 멈춤', ended: '게임 끝' };

  function timeLeft() {
    if (!state) return null;
    const t = state.timer;
    if (t.endsAt) return Math.max(0, t.endsAt - (Date.now() + skew));
    if (t.pausedRemaining) return t.pausedRemaining;
    return null;
  }
  const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function ranking() {
    return CFG.COUNTRY_ORDER.map((id) => state.countries[id]).sort((a, b) => {
      if (b.stage !== a.stage) return b.stage - a.stage;
      if (b.cash !== a.cash) return b.cash - a.cash;
      const ta = a.stage ? a.stageTimes[a.stage - 1] : 0, tb = b.stage ? b.stageTimes[b.stage - 1] : 0;
      return ta - tb;
    });
  }

  // ---------- 알림 ----------
  function toast(text, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.textContent = text;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3700);
  }
  function emit(ev, payload) {
    return new Promise((res) => socket.emit(ev, payload, (r) => { if (r && !r.ok) toast(r.error, 'warn'); res(r || { ok: false }); }));
  }

  // ---------- 시작 ----------
  fetch('/config.json').then((r) => r.json()).then((cfg) => {
    CFG = cfg;
    if (session) rejoin(); else showLanding();
  });
  socket.on('connect', () => { if (CFG && session) rejoin(); });
  socket.on('disconnect', () => document.body.classList.add('offline'));
  socket.on('connect', () => document.body.classList.remove('offline'));
  socket.on('state', (s) => { state = s; skew = s.serverNow - Date.now(); render(); });
  socket.on('toast', (t) => toast(t.text, t.kind));
  socket.on('celebrate', (c) => celebrate(c));

  async function rejoin() {
    const r = session.role === 'teacher'
      ? await emit('teacher:join', { roomCode: session.roomCode, teacherKey: session.teacherKey })
      : await emit('group:join', { roomCode: session.roomCode, groupCode: session.groupCode });
    if (!r.ok) { saveSession(null); showLanding(); }
  }

  function showLanding() {
    mounted = null; state = null;
    $('#app').innerHTML = '';
    $('#landing').hidden = false;
    const list = teacherRooms();
    $('#resumeTeacher').innerHTML = list.length ? `<p class="muted small">최근에 만든 게임방</p>` + list.map((r) =>
      `<button class="btn btn-ghost btn-sm" data-resume="${esc(r.code)}">방 ${esc(r.code)} 다시 열기</button>`).join('') : '';
  }

  $('#joinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const roomCode = $('#joinRoom').value.trim(), groupCode = $('#joinGroup').value.trim();
    const r = await new Promise((res) => socket.emit('group:join', { roomCode, groupCode }, res));
    if (!r.ok) { $('#joinError').textContent = r.error; return; }
    $('#joinError').textContent = '';
    saveSession({ role: 'group', roomCode, groupCode });
  });
  $('#createRoomBtn').addEventListener('click', async () => {
    const r = await emit('teacher:create', {});
    if (r.ok) { saveSession({ role: 'teacher', roomCode: r.roomCode, teacherKey: r.teacherKey }); rememberTeacherRoom(r.roomCode, r.teacherKey); }
  });
  $('#resumeTeacher').addEventListener('click', async (e) => {
    const code = e.target.dataset.resume; if (!code) return;
    const item = teacherRooms().find((r) => r.code === code);
    const r = await emit('teacher:join', { roomCode: code, teacherKey: item.key });
    if (r.ok) saveSession({ role: 'teacher', roomCode: code, teacherKey: item.key });
  });

  function logout() { saveSession(null); socket.disconnect(); socket.connect(); showLanding(); }

  function render() {
    if (!state || !CFG) return;
    $('#landing').hidden = true;
    if (state.role === 'teacher') { if (mounted !== 'teacher') mountTeacher(); renderTeacher(); }
    else { if (mounted !== 'group') mountGroup(); renderGroup(); }
    renderEnd();
  }

  setInterval(() => {
    const el = document.querySelectorAll('[data-timer]');
    if (!el.length || !state) return;
    const ms = timeLeft();
    el.forEach((e) => {
      e.textContent = ms == null ? '--:--' : mmss(ms);
      e.classList.toggle('hurry', ms != null && ms < 30000 && state.status === 'playing');
    });
  }, 250);

  // =====================================================================
  //  모둠 화면
  // =====================================================================
  const draft = { to: null, give: { items: {}, cash: 0 }, want: { items: {}, cash: 0 } };

  function mountGroup() {
    mounted = 'group';
    const me = state.me, info = C(me);
    document.documentElement.style.setProperty('--me', info.color);
    document.documentElement.style.setProperty('--me-ink', info.ink);
    $('#app').innerHTML = `
      <header class="topbar group-top">
        <div class="tb-name"><span class="flag"></span><b>${esc(info.name)}</b><span class="tb-sub">무역원정대</span></div>
        <div class="tb-stats">
          <div class="stat"><small>경제발전</small><strong id="gStage"></strong></div>
          <div class="stat"><small>국가 자산</small><strong id="gCash"></strong></div>
          <div class="stat"><small>남은 시간</small><strong data-timer>--:--</strong></div>
          <span id="gStatus" class="status-pill"></span>
          <button id="gLeave" class="btn btn-ghost btn-sm on-color" type="button">나가기</button>
        </div>
      </header>
      <div id="gNotice"></div>
      <main class="group-grid">
        <div class="col">
          <section class="panel">
            <h2>경제 발전 사다리</h2>
            <p class="muted small">부족한 물건을 1번부터 차례대로 수입해 문제를 해결하면 경제가 1단계씩 발전하고 국가 자산이 1조원씩 늘어요.</p>
            <ol id="gLadder" class="ladder"></ol>
          </section>
          <section class="panel">
            <h2>우리 창고</h2>
            <p class="muted small">우리 나라가 잘 만드는 것: ${info.rich.map(esc).join(' ')}</p>
            <div id="gStore" class="store"></div>
          </section>
          <section class="panel">
            <h2>받은 제안</h2>
            <div id="gInbox" class="offer-list"></div>
            <h3>보낸 제안</h3>
            <div id="gOutbox" class="offer-list"></div>
          </section>
        </div>
        <div class="col">
          <section class="panel composer" id="composer">
            <h2>무역 제안 보내기</h2>
            <div class="partner-pick" id="gPartners"></div>
            <div id="gComposeBody"></div>
            <label class="msg-label">한마디 (선택)
              <input id="gMsg" maxlength="60" placeholder="예) 바나나가 꼭 필요해요!" />
            </label>
            <div class="compose-foot">
              <span id="gKind" class="kind-badge"></span>
              <button id="gSend" class="btn btn-go" type="button">제안 보내기</button>
            </div>
          </section>
          <section class="panel">
            <h2>세계 여러 나라</h2>
            <div id="gWorld" class="world"></div>
          </section>
          <section class="panel">
            <h2>무역 소식</h2>
            <ul id="gNews" class="news"></ul>
          </section>
        </div>
      </main>`;

    $('#gLeave').onclick = () => { if (confirm('입장 화면으로 나갈까요? 모둠 코드로 다시 들어올 수 있어요.')) logout(); };
    $('#gPartners').addEventListener('click', (e) => {
      const b = e.target.closest('[data-partner]'); if (!b) return;
      if (draft.to !== b.dataset.partner) draft.want = { items: {}, cash: 0 };
      draft.to = b.dataset.partner; renderComposer();
    });
    $('#gComposeBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]'); if (!b) return;
      const side = draft[b.dataset.side], d = Number(b.dataset.step);
      if (b.dataset.good) {
        const g = b.dataset.good;
        side.items[g] = Math.max(0, (side.items[g] || 0) + d);
        if (!side.items[g]) delete side.items[g];
      } else side.cash = Math.max(0, side.cash + d);
      renderComposer();
    });
    $('#gSend').onclick = async () => {
      const r = await emit('offer:create', { to: draft.to, give: draft.give, want: draft.want, message: $('#gMsg').value });
      if (r.ok) {
        toast(`📤 ${C(draft.to).name}에 제안을 보냈어요.`, 'good');
        draft.give = { items: {}, cash: 0 }; draft.want = { items: {}, cash: 0 }; $('#gMsg').value = '';
        renderComposer();
      }
    };
    $('#gLadder').addEventListener('click', async (e) => {
      if (e.target.closest('[data-resolve]')) await emit('need:resolve', {});
    });
    const offerClick = async (e) => {
      const b = e.target.closest('[data-offer]'); if (!b) return;
      b.disabled = true;
      if (b.dataset.act === 'cancel') await emit('offer:cancel', { offerId: b.dataset.offer });
      else await emit('offer:respond', { offerId: b.dataset.offer, accept: b.dataset.act === 'accept' });
    };
    $('#gInbox').addEventListener('click', offerClick);
    $('#gOutbox').addEventListener('click', offerClick);
    $('#gWorld').addEventListener('click', (e) => {
      const b = e.target.closest('[data-trade-with]'); if (!b) return;
      if (draft.to !== b.dataset.tradeWith) draft.want = { items: {}, cash: 0 };
      draft.to = b.dataset.tradeWith; renderComposer();
      $('#composer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function renderGroup() {
    const me = state.me, mine = state.countries[me], info = C(me);
    $('#gStage').textContent = CFG.SETTINGS.stageNames[mine.stage];
    $('#gCash').textContent = won(mine.cash);
    const pill = $('#gStatus'); pill.textContent = statusText[state.status]; pill.dataset.s = state.status;
    $('#gNotice').innerHTML = state.notice ? `<div class="notice">📢 ${esc(state.notice.text)}</div>` : '';
    if (state.status !== 'playing') $('#gNotice').innerHTML += `<div class="notice notice-soft">${state.status === 'lobby' ? '선생님이 무역 시작을 누르면 거래할 수 있어요. 그동안 우리 나라에 무엇이 부족한지 살펴보세요.' : state.status === 'paused' ? '무역이 잠시 멈췄어요. 선생님 말씀을 들어요.' : '게임이 끝났어요.'}</div>`;

    // 사다리
    $('#gLadder').innerHTML = info.needs.map((n, i) => {
      const have = mine.inventory[n.good] || 0;
      const sellers = CFG.COUNTRY_ORDER.filter((id) => id !== me && (state.countries[id].inventory[n.good] || 0) > 0);
      let action;
      if (i < mine.stage) action = `<span class="done">해결 완료 · +1조원</span>`;
      else if (i === mine.stage) {
        const pct = Math.min(100, (have / n.qty) * 100);
        const bar = `<div class="need-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${n.qty}" aria-valuenow="${Math.min(have, n.qty)}"><i style="width:${pct}%"></i><span>${Math.min(have, n.qty)} / ${n.qty}개 모음</span></div>`;
        action = bar + (have >= n.qty
          ? `<button class="btn btn-go btn-sm" data-resolve ${state.status !== 'playing' ? 'disabled' : ''}>${G(n.good).icon} ${esc(G(n.good).name)} ${n.qty}개로 해결하기</button>`
          : `<span class="hint">${n.qty - have}개 더 필요해요 · 지금 가진 나라: ${sellers.length ? sellers.map((id) => `${countryTag(id, 'sm')}<small> ${state.countries[id].inventory[n.good]}개</small>`).join(' ') : '<em>없어요. 생산을 기다려요</em>'}</span>`);
      } else action = `<span class="locked">${i}번을 먼저 해결해요${have ? ` · 지금 ${have}개 있음` : ''}</span>`;
      const cls = i < mine.stage ? 'done' : i === mine.stage ? 'now' : 'later';
      return `<li class="rung ${cls}">
        <div class="rung-num">${i + 1}</div>
        <div class="rung-good">${G(n.good).icon}<span>${esc(G(n.good).name)} ${n.qty}개</span></div>
        <div class="rung-body"><p>${esc(n.text)}</p>${action}</div>
      </li>`;
    }).join('') + (mine.stage >= 3 ? `<li class="rung champion">🏆 모든 문제를 해결했어요! 우리 나라는 무역 강국!</li>` : '');

    // 창고
    const inv = Object.entries(mine.inventory);
    $('#gStore').innerHTML = inv.length ? inv.map(([g, n]) => {
      const needed = info.needs.slice(mine.stage).some((n) => n.good === g);
      const ours = info.produces.includes(g);
      return `<div class="crate ${needed ? 'crate-need' : ''}"><span class="crate-icon">${G(g).icon}</span><span class="crate-name">${esc(G(g).name)}</span><span class="crate-n">${n}</span>${ours ? '<span class="crate-tag">수출품</span>' : '<span class="crate-tag import">수입품</span>'}</div>`;
    }).join('') : `<p class="empty">창고가 비었어요. 다른 나라와 거래해 보세요.</p>`;

    // 제안함
    const inbox = state.offers.filter((o) => o.to === me && o.status === 'pending').reverse();
    const outbox = state.offers.filter((o) => o.from === me).slice(-8).reverse();
    $('#gInbox').innerHTML = inbox.length ? inbox.map((o) => {
      const lacking = Object.entries(o.want.items).some(([g, n]) => (mine.inventory[g] || 0) < n) || mine.cash < o.want.cash;
      return `<article class="offer" style="--c:${C(o.from).color}">
        <header>${countryTag(o.from)} <span class="kind-badge">${o.kind}</span></header>
        ${o.message ? `<p class="offer-msg">“${esc(o.message)}”</p>` : ''}
        <div class="offer-swap">
          <div><small>우리가 받을 것</small>${bundleHTML(o.give)}</div>
          <div class="swap-arrow" aria-hidden="true">⇄</div>
          <div><small>우리가 줄 것</small>${bundleHTML(o.want)}</div>
        </div>
        <footer>
          <button class="btn btn-go btn-sm" data-offer="${o.id}" data-act="accept" ${lacking || state.status !== 'playing' ? 'disabled' : ''}>수락</button>
          <button class="btn btn-ghost btn-sm" data-offer="${o.id}" data-act="reject">거절</button>
          ${lacking ? '<span class="warn-text">우리 창고가 부족해요</span>' : ''}
        </footer>
      </article>`;
    }).join('') : `<p class="empty">아직 받은 제안이 없어요.</p>`;
    const stLabel = { pending: '답 기다리는 중', accepted: '성공 🤝', rejected: '거절됨', cancelled: '취소됨', failed: '실패' };
    $('#gOutbox').innerHTML = outbox.length ? outbox.map((o) => `
      <article class="offer offer-out s-${o.status}" style="--c:${C(o.to).color}">
        <header>${countryTag(o.to)}에게 <span class="kind-badge">${o.kind}</span><span class="st">${stLabel[o.status]}</span></header>
        <div class="offer-swap">
          <div><small>우리가 줄 것</small>${bundleHTML(o.give)}</div>
          <div class="swap-arrow" aria-hidden="true">⇄</div>
          <div><small>우리가 받을 것</small>${bundleHTML(o.want)}</div>
        </div>
        ${o.reason ? `<p class="warn-text">${esc(o.reason)}</p>` : ''}
        ${o.status === 'pending' ? `<footer><button class="btn btn-ghost btn-sm" data-offer="${o.id}" data-act="cancel">제안 취소</button></footer>` : ''}
      </article>`).join('') : `<p class="empty">보낸 제안이 없어요.</p>`;

    // 세계
    const myNeedObj = info.needs[mine.stage], myNeed = myNeedObj?.good;
    $('#gWorld').innerHTML = CFG.COUNTRY_ORDER.filter((id) => id !== me).map((id) => {
      const c = state.countries[id], ci = C(id);
      const theirNeedObj = ci.needs[c.stage], theirNeed = theirNeedObj?.good;
      const hasMyNeed = myNeed && (c.inventory[myNeed] || 0) > 0;
      const wantsMine = theirNeed && (mine.inventory[theirNeed] || 0) > 0;
      return `<article class="nation" style="--c:${ci.color};--ci:${ci.ink}">
        <header><b>${esc(ci.name)}</b>${stagePips(c.stage)}${c.online ? '<span class="online" title="접속 중"></span>' : ''}</header>
        <p class="nation-need">지금 필요한 것: ${theirNeed ? `<b>${G(theirNeed).icon} ${esc(G(theirNeed).name)} ${theirNeedObj.qty}개</b> <small>(${Math.min(c.inventory[theirNeed] || 0, theirNeedObj.qty)}개 모음)</small>` : '<b>모두 해결!</b>'}</p>
        <div class="mini-inv">${Object.entries(c.inventory).map(([g, n]) => `<span title="${esc(G(g).name)}">${G(g).icon}<sub>${n}</sub></span>`).join('') || '<span class="muted small">창고 비었음</span>'}</div>
        ${hasMyNeed ? `<p class="match good">우리에게 필요한 ${esc(G(myNeed).name)} ${c.inventory[myNeed]}개가 있어요!</p>` : ''}
        ${wantsMine ? `<p class="match">우리 ${josa(esc(G(theirNeed).name),'이','가')} 필요한 나라예요</p>` : ''}
        <button class="btn btn-ghost btn-sm" data-trade-with="${id}">이 나라와 거래하기</button>
      </article>`;
    }).join('');

    renderComposer();
    renderNews($('#gNews'), 14);
  }

  function renderComposer() {
    if (!state || state.role !== 'group') return;
    const me = state.me, mine = state.countries[me];
    $('#gPartners').innerHTML = CFG.COUNTRY_ORDER.filter((id) => id !== me).map((id) =>
      `<button type="button" class="partner ${draft.to === id ? 'sel' : ''}" data-partner="${id}" style="--c:${C(id).color};--ci:${C(id).ink}">${esc(C(id).name)}</button>`).join('');
    if (!draft.to) {
      $('#gComposeBody').innerHTML = `<p class="empty">거래할 나라를 먼저 골라요.</p>`;
      $('#gKind').textContent = ''; $('#gSend').disabled = true; return;
    }
    const them = state.countries[draft.to];
    // 창고가 바뀌면 고른 수량을 맞춰요
    for (const [g, n] of Object.entries(draft.give.items)) { const max = mine.inventory[g] || 0; if (n > max) { if (max) draft.give.items[g] = max; else delete draft.give.items[g]; } }
    for (const [g, n] of Object.entries(draft.want.items)) { const max = them.inventory[g] || 0; if (n > max) { if (max) draft.want.items[g] = max; else delete draft.want.items[g]; } }
    draft.give.cash = Math.min(draft.give.cash, mine.cash);

    const side = (key, inv, title, cashMax) => {
      const b = draft[key];
      const rows = Object.entries(inv).map(([g, have]) => {
        const n = b.items[g] || 0;
        return `<div class="step-row ${n ? 'on' : ''}">
          <span class="sr-good">${G(g).icon} ${esc(G(g).name)} <small>(있음 ${have})</small></span>
          <span class="stepper">
            <button type="button" data-side="${key}" data-good="${g}" data-step="-1" ${n ? '' : 'disabled'} aria-label="${esc(G(g).name)} 빼기">−</button>
            <output>${n}</output>
            <button type="button" data-side="${key}" data-good="${g}" data-step="1" ${n < have ? '' : 'disabled'} aria-label="${esc(G(g).name)} 더하기">+</button>
          </span></div>`;
      }).join('') || '<p class="empty small">물건이 없어요.</p>';
      const cash = b.cash;
      return `<div class="side side-${key}">
        <h3>${title}</h3>${rows}
        <div class="step-row cash-row ${cash ? 'on' : ''}">
          <span class="sr-good">💰 돈 <small>${won(cash)}</small></span>
          <span class="cash-btns">
            <button type="button" data-side="${key}" data-step="-1000" ${cash >= 1000 ? '' : 'disabled'}>−1000억</button>
            <button type="button" data-side="${key}" data-step="-100" ${cash >= 100 ? '' : 'disabled'}>−100억</button>
            <button type="button" data-side="${key}" data-step="100" ${cash + 100 <= cashMax ? '' : 'disabled'}>+100억</button>
            <button type="button" data-side="${key}" data-step="1000" ${cash + 1000 <= cashMax ? '' : 'disabled'}>+1000억</button>
          </span></div>
      </div>`;
    };
    $('#gComposeBody').innerHTML = `<div class="sides">
      ${side('give', mine.inventory, '우리가 줄 것', mine.cash)}
      ${side('want', them.inventory, `${esc(C(draft.to).name)}에게 받을 것`, 10000000)}
    </div>`;
    const gi = Object.keys(draft.give.items).length, wi = Object.keys(draft.want.items).length;
    const ready = (gi || draft.give.cash) && (wi || draft.want.cash) && (gi + wi) > 0;
    let kind = '';
    if (ready) kind = !draft.give.cash && !draft.want.cash ? '물물교환' : ((gi === 0 && !draft.want.cash) || (wi === 0 && !draft.give.cash)) ? '현금거래' : '물건+현금';
    $('#gKind').textContent = kind ? `${kind} 제안` : '주는 것과 받는 것을 골라요';
    $('#gSend').disabled = !ready || state.status !== 'playing';
  }

  function renderNews(el, n) {
    const items = state.log.slice(-n).reverse();
    el.innerHTML = items.map((e) => {
      if (e.type === 'trade') return `<li>${countryTag(e.from, 'sm')} ${bundleHTML(e.give)} ⇄ ${bundleHTML(e.want)} ${countryTag(e.to, 'sm')}</li>`;
      if (e.type === 'levelup') return `<li class="news-up">🎉 ${countryTag(e.country, 'sm')} ${esc(G(e.good).name)} ${e.qty || 1}개 수입으로 경제발전 <b>${e.stage}단계</b> 달성!</li>`;
      return `<li class="news-sys">${esc(e.text)}</li>`;
    }).join('') || '<li class="empty">아직 소식이 없어요.</li>';
  }

  function celebrate({ stage, good, qty }) {
    const o = $('#overlay');
    o.innerHTML = `<div class="celebrate">
      <div class="burst" aria-hidden="true">${Array.from('🎉🚢💰✨'.repeat(4)).map((e, i) => `<span style="--i:${i}">${e}</span>`).join('')}</div>
      <p class="cel-good">${G(good).icon}</p>
      <h2>경제발전 ${stage}단계 달성!</h2>
      <p>${esc(G(good).name)} ${qty || 1}개를 수입해서 문제를 해결했어요.<br/>국가 자산이 <b>1조원</b> 늘었어요.</p>
      ${stage >= 3 ? '<p class="cel-final">🏆 우리 나라는 이제 무역 강국!</p>' : ''}
      <button class="btn btn-go" type="button">계속하기</button></div>`;
    o.hidden = false;
    o.querySelector('button').onclick = () => { o.hidden = true; };
  }

  // =====================================================================
  //  선생님 화면
  // =====================================================================
  let showCodes = false;

  function mountTeacher() {
    mounted = 'teacher';
    document.documentElement.style.setProperty('--me', '#13385C');
    document.documentElement.style.setProperty('--me-ink', '#fff');
    $('#app').innerHTML = `
      <header class="topbar teacher-top">
        <div class="tb-name"><b class="logo-sm">무역왕!</b><span class="room-code">방 코드 <strong id="tCode"></strong></span></div>
        <div class="tb-stats">
          <div class="stat"><small>남은 시간</small><strong data-timer class="big-timer">--:--</strong></div>
          <span id="tStatus" class="status-pill"></span>
          <button id="tLeave" class="btn btn-ghost btn-sm on-color" type="button">나가기</button>
        </div>
      </header>
      <section class="control-bar">
        <div class="ctrl-group" id="tFlow"></div>
        <div class="ctrl-group">
          <span class="ctrl-label">제한시간</span>
          ${[3, 5, 10].map((m) => `<button class="btn btn-ghost btn-sm" data-min="${m}">${m}분</button>`).join('')}
          <button class="btn btn-ghost btn-sm" data-min="0">없음</button>
        </div>
        <div class="ctrl-group">
          <button class="btn btn-ghost btn-sm" id="tProduce" title="모든 나라가 자기 나라 물건을 1개씩 더 얻어요">🏭 생산 라운드</button>
          <button class="btn btn-ghost btn-sm" id="tNoticeBtn">📢 공지</button>
          <button class="btn btn-ghost btn-sm" id="tCodes">🔑 모둠 코드 보기</button>
          <button class="btn btn-ghost btn-sm" id="tPrint">🖨️ 코드 카드 인쇄</button>
          <button class="btn btn-ghost btn-sm" id="tAdjustBtn">🛠️ 조정</button>
          <button class="btn btn-ghost btn-sm danger" id="tReset">처음부터</button>
        </div>
      </section>
      <main class="teacher-grid">
        <section class="nations-row" id="tNations"></section>
        <section class="panel t-rank"><h2>순위</h2><ol id="tRank" class="rank"></ol></section>
        <section class="panel t-net"><h2>무역 연결망 <small class="muted">선이 굵을수록 서로 많이 의존해요</small></h2><div id="tNet"></div></section>
        <section class="panel t-comp"><h2>경쟁 보드 <small class="muted">같은 물건을 여러 나라가 팔거나 사려 해요</small></h2><div id="tComp"></div></section>
        <section class="panel t-news"><h2>무역 소식 <small class="muted" id="tPending"></small></h2><ul id="tNews" class="news"></ul></section>
      </main>
      <div id="printCodes" class="print-codes"></div>
      <dialog id="tAdjust" class="dlg">
        <form method="dialog" id="tAdjustForm">
          <h3>창고·자산 조정</h3>
          <p class="muted small">실제 카드와 맞지 않을 때만 사용하세요.</p>
          <label>나라 <select name="countryId">${CFG.COUNTRY_ORDER.map((id) => `<option value="${id}">${esc(C(id).name)}</option>`).join('')}</select></label>
          <label>국가 자산 증감(억원) <input name="cashDelta" type="number" step="100" value="0" /></label>
          <label>물건 <select name="good"><option value="">(없음)</option>${Object.keys(CFG.GOODS).map((g) => `<option value="${g}">${goodLabel(g)}</option>`).join('')}</select></label>
          <label>물건 증감(개) <input name="itemDelta" type="number" value="0" /></label>
          <div class="dlg-foot"><button value="cancel" class="btn btn-ghost btn-sm">닫기</button><button value="ok" class="btn btn-navy btn-sm">적용</button></div>
        </form>
      </dialog>`;

    $('#tLeave').onclick = () => { if (confirm('선생님 화면을 닫을까요? 첫 화면의 "다시 열기"로 돌아올 수 있어요.')) logout(); };
    $('#tFlow').addEventListener('click', (e) => {
      const b = e.target.closest('[data-status]'); if (!b) return;
      if (b.dataset.status === 'ended' && !confirm('게임을 끝내고 결과를 발표할까요?')) return;
      emit('teacher:status', { status: b.dataset.status });
    });
    document.querySelectorAll('[data-min]').forEach((b) => b.onclick = () => emit('teacher:timer', { minutes: Number(b.dataset.min) }));
    $('#tProduce').onclick = () => emit('teacher:produce', {});
    $('#tNoticeBtn').onclick = () => {
      const t = prompt('모든 모둠 화면에 보낼 공지를 적어 주세요. (비우면 공지 지우기)', state.notice?.text || '');
      if (t !== null) emit('teacher:notice', { text: t });
    };
    $('#tCodes').onclick = () => { showCodes = !showCodes; renderTeacher(); };
    $('#tPrint').onclick = () => window.print();
    $('#tReset').onclick = () => { if (confirm('모든 나라의 창고와 자산, 거래 기록을 처음 상태로 되돌릴까요? 모둠 코드는 그대로예요.')) emit('teacher:reset', {}); };
    $('#tAdjustBtn').onclick = () => $('#tAdjust').showModal();
    $('#tAdjustForm').addEventListener('submit', (e) => {
      if (e.submitter?.value !== 'ok') return;
      const f = new FormData(e.target);
      emit('teacher:adjust', Object.fromEntries(f.entries()));
    });
  }

  function renderTeacher() {
    $('#tCode').textContent = state.code;
    const pill = $('#tStatus'); pill.textContent = statusText[state.status]; pill.dataset.s = state.status;
    const flow = { lobby: [['playing', '🚢 무역 시작', 'btn-go']], playing: [['paused', '⏸️ 잠시 멈춤', 'btn-navy'], ['ended', '🏁 게임 끝내기', 'btn-ghost']], paused: [['playing', '▶️ 다시 시작', 'btn-go'], ['ended', '🏁 게임 끝내기', 'btn-ghost']], ended: [['playing', '▶️ 게임 이어하기', 'btn-ghost']] }[state.status];
    $('#tFlow').innerHTML = flow.map(([s, l, c]) => `<button class="btn ${c}" data-status="${s}">${l}</button>`).join('');
    $('#tCodes').textContent = showCodes ? '🔑 모둠 코드 숨기기' : '🔑 모둠 코드 보기';

    $('#tNations').innerHTML = CFG.COUNTRY_ORDER.map((id) => {
      const c = state.countries[id], ci = C(id), needObj = ci.needs[c.stage], need = needObj?.good;
      return `<article class="t-nation" style="--c:${ci.color};--ci:${ci.ink}">
        <header><b>${esc(ci.name)}</b><span class="code ${showCodes ? '' : 'blur'}" title="모둠 코드">${showCodes ? c.groupCode : '••••'}</span></header>
        <div class="tn-row">${stagePips(c.stage)}<span class="tn-cash">${won(c.cash)}</span></div>
        <p class="tn-need">${need ? `다음 과제: ${G(need).icon} ${esc(G(need).name)} <b>${Math.min(c.inventory[need] || 0, needObj.qty)}/${needObj.qty}</b>` : '🏆 3단계 달성'}</p>
        <div class="mini-inv">${Object.entries(c.inventory).map(([g, n]) => `<span title="${esc(G(g).name)}">${G(g).icon}<sub>${n}</sub></span>`).join('') || '<span class="small">비었음</span>'}</div>
        <p class="tn-online">${c.online ? `● 기기 ${c.online}대 접속` : '○ 접속 전'}</p>
      </article>`;
    }).join('');

    $('#tRank').innerHTML = ranking().map((c, i) => `<li>
      <span class="rank-n">${i + 1}</span>${countryTag(c.id)}
      <span class="rank-bar"><i style="width:${(c.stage / 3) * 100}%;--c:${C(c.id).color}"></i></span>
      <span class="rank-stage">${c.stage}단계</span><span class="rank-cash">${won(c.cash)}</span></li>`).join('');

    renderNetwork();
    renderCompetition();
    $('#tPending').textContent = state.offers.length ? `· 답을 기다리는 제안 ${state.offers.length}건` : '';
    renderNews($('#tNews'), 30);

    $('#printCodes').innerHTML = `<h1>무역왕! 모둠 코드 · 방 코드 ${state.code}</h1><div class="pc-grid">` + CFG.COUNTRY_ORDER.map((id) => `
      <div class="pc-card" style="--c:${C(id).color}"><p class="pc-name">${esc(C(id).name)}</p>
      <p>방 코드 <b>${state.code}</b></p><p>모둠 코드 <b class="pc-code">${state.countries[id].groupCode}</b></p>
      <p class="pc-url">${esc(location.origin)}</p></div>`).join('') + '</div>';
  }

  function renderNetwork() {
    const ids = CFG.COUNTRY_ORDER, cx = 200, cy = 190, R = 140;
    const pos = {}; ids.forEach((id, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / ids.length; pos[id] = [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
    const pairs = state.stats.pairs;
    const lines = Object.entries(pairs).map(([k, n]) => {
      const [a, b] = k.split('|'); const [x1, y1] = pos[a], [x2, y2] = pos[b];
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${Math.min(3 + n * 3, 18)}" />
        <text x="${mx}" y="${my}" class="net-n">${n}</text>`;
    }).join('');
    const nodes = ids.map((id) => {
      const [x, y] = pos[id], c = state.countries[id];
      const partners = Object.keys(pairs).filter((k) => k.split('|').includes(id)).length;
      return `<g class="net-node"><circle cx="${x}" cy="${y}" r="${30 + c.stage * 4}" fill="${C(id).color}" />
        <text x="${x}" y="${y - 2}" fill="${C(id).ink}" class="net-name">${esc(C(id).name.replace(' 나라', ''))}</text>
        <text x="${x}" y="${y + 15}" fill="${C(id).ink}" class="net-sub">${partners}개국</text></g>`;
    }).join('');
    const total = Object.values(pairs).reduce((a, b) => a + b, 0);
    $('#tNet').innerHTML = `<svg viewBox="0 0 400 380" class="net" role="img" aria-label="나라 사이 무역 연결망">
      <g class="net-lines">${lines}</g>${nodes}
      ${total ? '' : `<text x="200" y="195" class="net-empty">아직 거래가 없어요</text>`}</svg>
      <p class="muted small center">원 안 숫자: 함께 거래한 나라 수 · 원이 클수록 경제가 발전했어요</p>`;
  }

  function renderCompetition() {
    const producers = {}, needers = {}, supply = {}, demand = {};
    for (const id of CFG.COUNTRY_ORDER) {
      C(id).produces.forEach((g) => (producers[g] = producers[g] || []).push(id));
      C(id).needs.forEach((n) => (needers[n.good] = needers[n.good] || []).push(id));
      for (const g of C(id).produces) (supply[g] = (supply[g] || 0) + (C(id).startInventory[g] || 0));
      C(id).needs.forEach((n) => (demand[n.good] = (demand[n.good] || 0) + n.qty));
    }
    const rows = Object.keys(CFG.GOODS).map((g) => {
      const sellers = producers[g] || [], buyers = needers[g] || [];
      const sold = state.stats.sold[g] || {};
      const compSell = sellers.length > 1, compBuy = buyers.length > sellers.length;
      if (!compSell && !compBuy) return '';
      return `<div class="comp-row">
        <span class="comp-good">${G(g).icon} ${esc(G(g).name)}<small class="comp-sd">처음 공급 ${supply[g] || 0} · 수요 ${demand[g] || 0}</small></span>
        <div class="comp-body">
          ${compSell ? `<p><b class="tag-sell">판매 경쟁</b> ${sellers.map((id) => `${countryTag(id, 'sm')}<small>${sold[id] ? ` ${sold[id]}개 팜` : ''}</small>`).join(' ')}</p>` : ''}
          ${compBuy ? `<p><b class="tag-buy">구매 경쟁</b> ${buyers.map((id) => countryTag(id, 'sm')).join(' ')} <small>한 나라만 팔아요</small></p>` : ''}
        </div></div>`;
    }).join('');
    $('#tComp').innerHTML = rows;
  }

  // =====================================================================
  //  게임 끝 — 결과 발표와 정리 질문
  // =====================================================================
  function renderEnd() {
    let el = $('#endScreen');
    if (state.status !== 'ended') { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('section'); el.id = 'endScreen'; el.className = 'end-screen'; ($('#app .control-bar') || $('#gNotice')).insertAdjacentElement('afterend', el); }
    const r = ranking();
    const tradeCount = state.log.filter((e) => e.type === 'trade').length;
    let mineLine = '';
    if (state.role === 'group') {
      const imp = state.stats.imports[state.me];
      const partners = Object.keys(imp);
      mineLine = `<p class="end-mine">우리 나라는 <b>${partners.length}개 나라</b>에서 물건을 수입했어요${partners.length ? `: ${partners.map((id) => countryTag(id, 'sm')).join(' ')}` : ''}.</p>`;
    }
    el.innerHTML = `
      <h2>🏁 무역왕 결과 발표</h2>
      <ol class="podium">${r.map((c, i) => `<li class="p${i + 1}" style="--c:${C(c.id).color};--ci:${C(c.id).ink}">
        <span class="p-rank">${i + 1}위</span><b>${esc(C(c.id).name)}</b><span>${CFG.SETTINGS.stageNames[c.stage]}</span><span>${won(c.cash)}</span></li>`).join('')}</ol>
      <p class="muted center">오늘 여섯 나라는 모두 <b>${tradeCount}번</b> 무역했어요.</p>
      ${mineLine}
      <div class="reflect">
        <h3>함께 생각해요</h3>
        <ol>
          <li>우리 나라는 왜 다른 나라와 무역을 해야 했나요? (자연환경, 기술, 자원의 차이)</li>
          <li>우리 나라는 어떤 나라에 <b>의존</b>했고, 어떤 나라가 우리에게 의존했나요?</li>
          <li>같은 물건을 파는 나라가 여럿일 때, 어떻게 <b>경쟁</b>했나요?</li>
          <li>세계 여러 나라는 무역을 통해 ○○하고 ○○합니다. 빈칸을 채워 보세요.</li>
        </ol>
      </div>`;
  }
})();
