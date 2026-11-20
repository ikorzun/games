/* Дежурная часть — ход смены и интерфейс.
   Фазы: intro → (talk → inspect → leaving → verdict) × N → end.
   Данные дел — cases.js, строки — strings_<язык>.js, рисунки — art.js. */
(function (root) {
  const DZ = root.DZ;
  const doc = root.document;
  const S = DZ.strings.ru;
  const N = DZ.cases.length;

  const has = (k) => S[k] != null;
  function t(k, vars) {
    let s = S[k];
    if (s == null) return k;
    if (vars) for (const name of Object.keys(vars)) s = s.split('{' + name + '}').join(vars[name]);
    return s;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const T = (k, vars) => esc(t(k, vars));

  const st = {
    phase: 'intro', idx: 0, lines: [], line: 0, said: null,
    seen: new Set(), docs: new Set(), sheet: null, modal: { type: 'intro' },
    bribe: false, zoom: false, results: [],
    photo: !!DZ.PHOTO_LOBBY,   // графика: фото-черновик (true) или рисованная (false)
  };
  let el = {};
  let timers = [];
  let returnFocus = null;

  const cur = () => DZ.cases[st.idx];
  const reduced = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const later = (fn, ms) => { timers.push(root.setTimeout(fn, ms)); };
  const clearTimers = () => { timers.forEach((id) => root.clearTimeout(id)); timers = []; };

  const itemName = (c, it) => (has(`dz.${c.id}.${it.id}.name`) ? t(`dz.${c.id}.${it.id}.name`) : t(`dz.item.${it.art}.name`));
  const viewText = (c, it, i) => (has(`dz.${c.id}.${it.id}.v${i}`) ? t(`dz.${c.id}.${it.id}.v${i}`) : t(`dz.item.${it.art}.v${i}`));

  // ————————————————————————————————————————————— каркас

  function build() {
    const mount = doc.getElementById('dz');
    mount.innerHTML = `
<div class="dz-app" data-phase="intro" data-actors="none">
  <section class="dz-stage">
    <div class="dz-window">
      <button type="button" class="dz-scene" data-act="zoom" aria-label="${T('dz.scene.label')}">${DZ.art.scene(T('dz.glass'), T('dz.exit'), T('dz.board'))}</button>
      <div class="dz-hud">
        <span class="dz-count"></span>
        <span class="dz-hud-btns">
          <button type="button" class="dz-iconbtn" id="dz-zoom" data-act="zoom" aria-pressed="false">${DZ.art.icon('zoom')}</button>
          <button type="button" class="dz-iconbtn" id="dz-gfx" data-act="gfx" aria-pressed="false">${DZ.art.icon('gfx')}</button>
          <button type="button" class="dz-iconbtn" id="dz-sound" data-act="sound">${DZ.art.icon('sound_on')}</button>
        </span>
      </div>
    </div>
    <div class="dz-talk">
      <div class="dz-talk-body" aria-live="polite">
        <p class="dz-talk-q" hidden></p>
        <p class="dz-talk-who"></p>
        <p class="dz-talk-text"></p>
      </div>
      <button type="button" class="dz-next" id="dz-next" data-act="next" hidden>${T('dz.talk.next')}</button>
    </div>
  </section>
  <section class="dz-desk" aria-label="${T('dz.desk.label')}">
    <div class="dz-desk-main">
      <h2 class="dz-label">${T('dz.tray.title')}</h2>
      <div class="dz-tray"></div>
      <h2 class="dz-label">${T('dz.docs.title')}</h2>
      <div class="dz-docs">
        <button type="button" class="dz-docbtn" id="dz-doc-report" data-act="doc" data-id="report">${T('dz.doc.report')}</button>
        <button type="button" class="dz-docbtn" id="dz-doc-bulletin" data-act="doc" data-id="bulletin">${T('dz.doc.bulletin')}</button>
        <button type="button" class="dz-docbtn" id="dz-doc-memo" data-act="doc" data-id="memo">${T('dz.doc.memo')}</button>
      </div>
      <p class="dz-hint" hidden></p>
      <div class="dz-actions">
        <button type="button" class="dz-verdict-btn dz-verdict-btn--home" id="dz-home" data-act="home">${DZ.art.icon('home')}<span>${T('dz.act.home')}</span></button>
        <button type="button" class="dz-verdict-btn dz-verdict-btn--cell" id="dz-cell" data-act="cell">${DZ.art.icon('cell')}<span>${T('dz.act.cell')}</span></button>
      </div>
    </div>
    <div class="dz-sheet" hidden></div>
  </section>
  <div class="dz-modal" hidden></div>
</div>`;
    const q = (sel) => mount.querySelector(sel);
    el = {
      app: q('.dz-app'), actors: q('.dz-actors'), count: q('.dz-count'), zoomBtn: q('#dz-zoom'), soundBtn: q('#dz-sound'),
      scene: q('.dz-scene'), talkQ: q('.dz-talk-q'), talkWho: q('.dz-talk-who'), talkText: q('.dz-talk-text'), next: q('#dz-next'),
      tray: q('.dz-tray'), hint: q('.dz-hint'), home: q('#dz-home'), cell: q('#dz-cell'), sheet: q('.dz-sheet'), modal: q('.dz-modal'),
      main: q('.dz-desk-main'), stage: q('.dz-stage'), desk: q('.dz-desk'), clockH: q('.dz-clock-h'), clockM: q('.dz-clock-m'),
      docBtns: Array.from(mount.querySelectorAll('.dz-docbtn')),
      gfxBtn: q('#dz-gfx'), photoLobby: q('.dz-photo-lobby'), photoDet: q('.dz-photo-det'),
    };
    if (DZ.PHOTO_LOBBY) el.photoLobby.setAttribute('href', DZ.PHOTO_LOBBY);
    mount.addEventListener('click', onClick);
    doc.addEventListener('keydown', onKey);
  }

  // ————————————————————————————————————————————— события

  function onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const d = b.dataset;
    switch (d.act) {
      case 'start': startShift(); break;
      case 'next': advance(); break;
      case 'zoom': toggleZoom(); break;
      case 'sound': toggleSound(); break;
      case 'gfx': st.photo = !st.photo; DZ.sound.play('tick'); renderHud(); if (st.sheet) renderSheet(); break;
      case 'item': openItem(d.id, b); break;
      case 'doc': openDoc(d.id, b); break;
      case 'view': nextView(); break;
      case 'ask': ask(); break;
      case 'bribe': toggleBribe(); break;
      case 'close': closeSheet(); break;
      case 'home': decide('home'); break;
      case 'cell': decide('cell'); break;
      case 'ground': resolve('cell', d.id); break;
      case 'cancel': st.modal = null; render(); el.cell.focus(); break;
      case 'continue': nextCase(); break;
      case 'again': startShift(); break;
      default: break;
    }
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    if (st.modal && st.modal.type === 'grounds') { st.modal = null; render(); el.cell.focus(); } else if (st.sheet) closeSheet();
  }

  // ————————————————————————————————————————————— ход смены

  function startShift() {
    clearTimers();
    st.idx = 0; st.results = []; st.modal = null;
    enterCase();
  }

  function enterCase() {
    const c = cur();
    st.phase = 'talk'; st.seen = new Set(); st.docs = new Set(); st.sheet = null; st.modal = null;
    st.bribe = false; st.zoom = false; st.said = null; st.line = 0; st.lines = [];
    for (let i = 1; has(`dz.${c.id}.srg.${i}`); i++) st.lines.push({ kind: 'srg', who: t('dz.speaker.srg'), text: t(`dz.${c.id}.srg.${i}`) });
    for (let i = 1; has(`dz.${c.id}.det.${i}`); i++) st.lines.push({ kind: 'det', who: t(`dz.${c.id}.speaker`), text: t(`dz.${c.id}.det.${i}`) });
    el.app.dataset.actors = 'away';
    el.actors.innerHTML = DZ.art.actors(c.look, c.id);
    if (c.photo) el.photoDet.setAttribute('href', c.photo); else el.photoDet.removeAttribute('href');
    setClock(c.time);
    void el.app.offsetWidth;
    root.requestAnimationFrame(() => root.requestAnimationFrame(() => { el.app.dataset.actors = 'in'; }));
    DZ.sound.play('door');
    render();
    el.next.focus({ preventScroll: true });
  }

  function advance() {
    if (st.phase !== 'talk') return;
    if (st.line < st.lines.length - 1) {
      st.line++;
      DZ.sound.play('tick');
      renderTalk();
      return;
    }
    st.phase = 'inspect';
    st.said = st.lines[st.line];
    DZ.sound.play('drop');
    render();
    const first = el.tray.querySelector('.dz-item');
    if (first) first.focus({ preventScroll: true });
  }

  function openItem(id, btn) {
    if (st.phase !== 'inspect') return;
    st.seen.add(id);
    st.sheet = { type: 'item', id, view: 0 };
    returnFocus = btn || null;
    DZ.sound.play('paper');
    render();
    focusSheet();
  }

  function openDoc(id, btn) {
    if (st.phase !== 'inspect' && st.phase !== 'talk') return;
    st.docs.add(id);
    st.sheet = { type: 'doc', id };
    returnFocus = btn || null;
    DZ.sound.play('paper');
    render();
    focusSheet();
  }

  function focusSheet() {
    const b = el.sheet.querySelector('[data-act="view"], [data-act="close"]');
    if (b) b.focus({ preventScroll: true });
  }

  function closeSheet() {
    if (!st.sheet) return;
    st.sheet = null;
    render();
    if (returnFocus && doc.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function sheetItem() {
    if (!st.sheet || st.sheet.type !== 'item') return null;
    return cur().items.find((it) => it.id === st.sheet.id) || null;
  }

  function nextView() {
    const it = sheetItem();
    if (!it || it.views.length < 2) return;
    st.sheet.view = (st.sheet.view + 1) % it.views.length;
    DZ.sound.play('paper');
    renderSheet();
    focusSheet();
  }

  function ask() {
    const it = sheetItem();
    const c = cur();
    if (!it || !has(`dz.${c.id}.${it.id}.a`)) return;
    st.said = { kind: 'det', who: t(`dz.${c.id}.speaker`), text: t(`dz.${c.id}.${it.id}.a`), q: t(`dz.${c.id}.${it.id}.q`) };
    DZ.sound.play('tick');
    renderTalk();
  }

  function toggleBribe() {
    const it = sheetItem();
    if (!it || !it.bribe) return;
    st.bribe = !st.bribe;
    DZ.sound.play('paper');
    renderSheet();
    const b = el.sheet.querySelector('[data-act="bribe"]');
    if (b) b.focus({ preventScroll: true });
  }

  function toggleZoom() {
    if (st.phase !== 'talk' && st.phase !== 'inspect') return;
    st.zoom = !st.zoom;
    renderHud();
  }

  function toggleSound() {
    DZ.sound.toggle();
    DZ.sound.play('tick');
    renderHud();
  }

  function decide(kind) {
    if (st.phase !== 'inspect') return;
    st.sheet = null;
    if (kind === 'cell') {
      st.modal = { type: 'grounds' };
      render();
      const b = el.modal.querySelector('[data-act="ground"]');
      if (b) b.focus({ preventScroll: true });
    } else resolve('home');
  }

  function resolve(decision, ground) {
    if (st.phase !== 'inspect') return;
    const c = cur();
    const bribe = !!st.bribe;
    const grade = DZ.judge(c, decision, ground, bribe);
    st.results.push({ id: c.id, decision, ground: ground || null, grade, bribe, fb: DZ.feedbackKey(c, grade, ground, bribe, has) });
    st.phase = 'leaving'; st.modal = null; st.sheet = null; st.zoom = false;
    st.said = { kind: 'srg', who: t('dz.speaker.srg'), text: t(`dz.srg.${decision}` + (c.gender === 'f' ? '.f' : '')) };
    el.app.dataset.actors = decision;
    if (decision === 'cell') later(() => DZ.sound.play('clank'), reduced() ? 0 : 650); else DZ.sound.play('door');
    render();
    later(() => {
      st.phase = 'verdict'; st.modal = { type: 'verdict' };
      DZ.sound.play('stamp');
      render();
      const b = el.modal.querySelector('[data-act="continue"]');
      if (b) b.focus({ preventScroll: true });
    }, reduced() ? 60 : 1150);
  }

  function nextCase() {
    if (st.phase !== 'verdict') return;
    st.idx++;
    if (st.idx < N) { enterCase(); return; }
    st.phase = 'end'; st.modal = { type: 'end' }; st.said = null;
    el.app.dataset.actors = 'none';
    el.actors.innerHTML = '';
    setClock('06:00');
    DZ.sound.play('paper');
    render();
    const b = el.modal.querySelector('[data-act="again"]');
    if (b) b.focus({ preventScroll: true });
  }

  // ————————————————————————————————————————————— отрисовка

  function setClock(time) {
    const p = time.split(':');
    const h = Number(p[0]), m = Number(p[1]);
    el.clockH.setAttribute('transform', `rotate(${(h % 12) * 30 + m * 0.5} 268 42)`);
    el.clockM.setAttribute('transform', `rotate(${m * 6} 268 42)`);
  }

  function render() {
    el.app.dataset.phase = st.phase;
    renderHud(); renderTalk(); renderTray(); renderDesk(); renderSheet(); renderModal();
  }

  function renderHud() {
    const inCase = st.phase !== 'intro' && st.phase !== 'end';
    el.count.hidden = !inCase;
    if (inCase) {
      el.count.textContent = t('dz.hud.count', { n: st.idx + 1, total: N });
      el.count.setAttribute('aria-label', t('dz.hud.count_label', { n: st.idx + 1, total: N }));
    }
    const canZoom = st.phase === 'talk' || st.phase === 'inspect';
    el.app.classList.toggle('is-zoomed', canZoom && st.zoom);
    el.zoomBtn.hidden = !canZoom;
    el.zoomBtn.setAttribute('aria-pressed', st.zoom ? 'true' : 'false');
    el.zoomBtn.setAttribute('aria-label', t(st.zoom ? 'dz.zoom.off' : 'dz.zoom.on'));
    el.zoomBtn.title = t(st.zoom ? 'dz.zoom.off' : 'dz.zoom.on');
    el.scene.disabled = !canZoom;
    const photo = st.photo && !!DZ.PHOTO_LOBBY;
    el.app.classList.toggle('is-photo', photo);
    el.gfxBtn.hidden = !DZ.PHOTO_LOBBY;
    el.gfxBtn.setAttribute('aria-pressed', photo ? 'true' : 'false');
    el.gfxBtn.setAttribute('aria-label', t(photo ? 'dz.gfx.to_drawn' : 'dz.gfx.to_photo'));
    el.gfxBtn.title = t(photo ? 'dz.gfx.to_drawn' : 'dz.gfx.to_photo');
    const on = DZ.sound.isOn();
    el.soundBtn.innerHTML = DZ.art.icon(on ? 'sound_on' : 'sound_off');
    el.soundBtn.setAttribute('aria-label', t(on ? 'dz.sound.on' : 'dz.sound.off'));
    el.soundBtn.title = t(on ? 'dz.sound.on' : 'dz.sound.off');
  }

  function renderTalk() {
    const line = st.phase === 'talk' ? st.lines[st.line] : st.said;
    if (!line) {
      el.talkQ.hidden = true;
      el.talkWho.textContent = '';
      el.talkWho.hidden = true;
      el.talkText.textContent = t('dz.talk.idle');
      el.talkText.className = 'dz-talk-text dz-talk-text--idle';
    } else {
      el.talkQ.hidden = !line.q;
      el.talkQ.textContent = line.q ? '— ' + line.q : '';
      el.talkWho.hidden = false;
      el.talkWho.textContent = line.who;
      el.talkWho.className = 'dz-talk-who dz-talk-who--' + line.kind;
      el.talkText.textContent = line.text;
      el.talkText.className = 'dz-talk-text';
    }
    el.next.hidden = st.phase !== 'talk';
  }

  function renderTray() {
    const c = cur();
    if (st.phase === 'inspect' && c) {
      el.tray.style.setProperty('--n', String(c.items.length));
      el.tray.classList.remove('is-empty');
      const fresh = !el.tray.querySelector('.dz-item') || el.tray.dataset.case !== c.id;
      if (fresh) {
        el.tray.dataset.case = c.id;
        el.tray.innerHTML = c.items.map((it, i) => `<button type="button" class="dz-item" id="dz-item-${c.id}-${it.id}" data-act="item" data-id="${it.id}" style="--i:${i}">
          <span class="dz-item-art">${DZ.art.item(it.art)}</span><span class="dz-item-name">${esc(itemName(c, it))}</span></button>`).join('');
      }
      el.tray.querySelectorAll('.dz-item').forEach((b) => {
        const seen = st.seen.has(b.dataset.id);
        b.classList.toggle('is-seen', seen);
        b.setAttribute('aria-label', b.querySelector('.dz-item-name').textContent + (seen ? ', ' + t('dz.tray.seen') : ''));
      });
    } else {
      el.tray.dataset.case = '';
      el.tray.classList.add('is-empty');
      el.tray.style.setProperty('--n', '1');
      el.tray.innerHTML = `<p class="dz-tray-empty">${st.phase === 'talk' ? T('dz.tray.wait') : ''}</p>`;
    }
  }

  function renderDesk() {
    const inspect = st.phase === 'inspect';
    el.home.disabled = !inspect;
    el.cell.disabled = !inspect;
    const docsOn = inspect || st.phase === 'talk';
    el.docBtns.forEach((b) => { b.disabled = !docsOn; });
    let hint = '';
    if (st.idx === 0 && inspect) {
      if (st.seen.size === 0) hint = 'dz.hint.1';
      else if (st.docs.size === 0) hint = 'dz.hint.2';
      else hint = 'dz.hint.3';
    }
    el.hint.hidden = !hint;
    el.hint.textContent = hint ? t(hint) : '';
    el.main.inert = !!st.sheet;
  }

  function linesHtml(raw, asDoc) {
    return raw.split('\n').map((ln) => {
      const cut = ln.indexOf(': ');
      if (asDoc && cut > 0) return `<div class="dz-f"><span class="dz-f-k">${esc(ln.slice(0, cut))}</span><span class="dz-f-v">${esc(ln.slice(cut + 2))}</span></div>`;
      return `<p class="${ln.indexOf('— ') === 0 ? 'dz-li' : ''}">${esc(ln)}</p>`;
    }).join('');
  }

  function renderSheet() {
    if (!st.sheet) { el.sheet.hidden = true; el.sheet.innerHTML = ''; return; }
    const c = cur();
    let html = '';
    if (st.sheet.type === 'item') {
      const it = sheetItem();
      const i = st.sheet.view;
      const v = it.views[i];
      const name = esc(itemName(c, it));
      const text = viewText(c, it, i);
      let body;
      if (v.doc) {
        let extra = '';
        if (it.bribe) extra = `<p class="dz-bribe ${st.bribe ? 'is-taken' : ''}"><span class="dz-bill" aria-hidden="true">100</span>${T(st.bribe ? 'dz.bribe.out' : 'dz.bribe.in')}</p>`;
        body = `<div class="dz-paper dz-paper--${v.doc}"><div class="dz-paper-head">${name}</div>
          <div class="dz-paper-row">${v.photo ? (st.photo && c.photo ? `<div class="dz-photo dz-photo--real" style="background-image:url(${c.photo})"></div>` : `<div class="dz-photo">${DZ.art.photo(c.look, c.id)}</div>`) : ''}<div class="dz-fields">${linesHtml(text, true)}</div></div>${extra}</div>`;
      } else {
        body = `<div class="dz-hand"><div class="dz-hand-art">${DZ.art.item(v.art || it.art)}</div><div class="dz-hand-text">${linesHtml(text, false)}</div></div>`;
      }
      const btns = [];
      if (it.views.length > 1) btns.push(`<button type="button" class="dz-btn" data-act="view">${T('dz.act.' + it.views[(i + 1) % it.views.length].act)}</button>`);
      if (it.bribe && v.doc) btns.push(`<button type="button" class="dz-btn dz-btn--warn" data-act="bribe">${T(st.bribe ? 'dz.act.bribe_back' : 'dz.act.bribe_take')}</button>`);
      if (has(`dz.${c.id}.${it.id}.q`)) btns.push(`<button type="button" class="dz-btn dz-btn--ask" data-act="ask">«${T(`dz.${c.id}.${it.id}.q`)}»</button>`);
      html = `<div class="dz-sheet-in" role="group" aria-label="${name}">
        <div class="dz-sheet-head"><h3>${name}</h3><button type="button" class="dz-btn dz-btn--quiet" data-act="close">${T('dz.act.put')}</button></div>
        <div class="dz-scroll">${body}</div>
        ${btns.length ? `<div class="dz-sheet-btns">${btns.join('')}</div>` : ''}
      </div>`;
    } else {
      const id = st.sheet.id;
      let paper;
      if (id === 'report') {
        paper = `<div class="dz-paper dz-paper--report"><div class="dz-paper-head">${T('dz.report.title')}</div>
          <p class="dz-paper-meta">${T('dz.report.from')} · ${T('dz.report.time', { time: c.time })}</p>
          <p>${T(`dz.${c.id}.report`)}</p><p class="dz-sign">${T('dz.report.sign')}</p></div>`;
      } else if (id === 'bulletin') {
        let rows = '';
        for (let i = 1; has(`dz.bulletin.${i}`); i++) rows += `<div class="dz-entry"><p class="dz-entry-head">${T(`dz.bulletin.${i}.head`)}</p><p>${T(`dz.bulletin.${i}`)}</p></div>`;
        paper = `<div class="dz-paper dz-paper--bulletin"><div class="dz-paper-head">${T('dz.bulletin.title')}</div><p class="dz-paper-meta">${T('dz.bulletin.sub')}</p>${rows}</div>`;
      } else {
        let rows = '';
        for (let i = 1; has(`dz.memo.${i}`); i++) rows += `<li>${T(`dz.memo.${i}`)}</li>`;
        paper = `<div class="dz-paper dz-paper--memo"><div class="dz-paper-head">${T('dz.memo.title')}</div><p><b>${T('dz.memo.cell')}</b></p><ol>${rows}</ol>
          <p>${T('dz.memo.home')}</p><p class="dz-sign dz-sign--note">${T('dz.memo.note')}</p></div>`;
      }
      const title = T('dz.doc.' + id);
      html = `<div class="dz-sheet-in" role="group" aria-label="${title}">
        <div class="dz-sheet-head"><h3>${title}</h3><button type="button" class="dz-btn dz-btn--quiet" data-act="close">${T('dz.act.put_doc')}</button></div><div class="dz-scroll">${paper}</div></div>`;
    }
    el.sheet.innerHTML = html;
    el.sheet.hidden = false;
    const sc = el.sheet.querySelector('.dz-scroll');
    if (sc) {
      const more = () => sc.classList.toggle('is-more', sc.scrollTop + sc.clientHeight < sc.scrollHeight - 6);
      sc.addEventListener('scroll', more, { passive: true });
      more();
    }
  }

  function stampText(c, decision) {
    return t(`dz.stamp.${decision}` + (c.gender === 'f' ? '.f' : ''));
  }

  function renderModal() {
    const m = st.modal;
    el.stage.inert = !!m;
    el.desk.inert = !!m;
    if (!m) { el.modal.hidden = true; el.modal.innerHTML = ''; el.modal.className = 'dz-modal'; return; }
    let html = '';
    if (m.type === 'intro') {
      html = `<div class="dz-card dz-card--intro" role="dialog" aria-modal="true" aria-labelledby="dz-title">
        <div class="dz-plate"><h1 id="dz-title">${T('dz.title')}</h1></div>
        <p class="dz-intro-place">${T('dz.intro.place')}</p>
        <p>${T('dz.intro.p1')}</p><p>${T('dz.intro.p2')}</p>
        <button type="button" class="dz-btn dz-btn--lamp" data-act="start">${T('dz.intro.start')}</button></div>`;
    } else if (m.type === 'grounds') {
      html = `<div class="dz-card dz-paper dz-card--form" role="dialog" aria-modal="true" aria-labelledby="dz-g-title">
        <div class="dz-paper-head" id="dz-g-title">${T('dz.grounds.title')}</div>
        <p class="dz-paper-meta">${T(`dz.${cur().id}.who`)}</p><p>${T('dz.grounds.lead')}</p>
        <div class="dz-grounds">${DZ.GROUNDS.map((g, i) => `<button type="button" class="dz-ground" data-act="ground" data-id="${g}"><span class="dz-ground-n">${i + 1}</span>${T('dz.grounds.' + g)}</button>`).join('')}</div>
        <button type="button" class="dz-btn dz-btn--quiet dz-btn--onpaper" data-act="cancel">${T('dz.grounds.cancel')}</button></div>`;
    } else if (m.type === 'verdict') {
      const r = st.results[st.results.length - 1];
      const c = cur();
      const headKey = r.grade === 'half' && c.grounds.indexOf(r.ground) >= 0 ? 'dz.verdict.bribe' : 'dz.verdict.' + r.grade;
      html = `<div class="dz-card dz-paper dz-card--verdict dz-grade-${r.grade}" role="dialog" aria-modal="true" aria-labelledby="dz-v-title">
        <div class="dz-paper-head" id="dz-v-title">${T(`dz.${c.id}.who`)}</div>
        <p class="dz-paper-meta">${T('dz.report.time', { time: c.time })}${r.ground ? ' · ' + T('dz.grounds.' + r.ground) : ''}</p>
        <div class="dz-stamp dz-stamp--${r.decision}">${esc(stampText(c, r.decision))}</div>
        <p class="dz-note-label">${T('dz.verdict.note')}</p>
        <p class="dz-note"><b>${T(headKey)}</b> ${T(r.fb)}</p>
        <button type="button" class="dz-btn dz-btn--onpaper" data-act="continue">${T(st.idx + 1 < N ? 'dz.verdict.next' : 'dz.verdict.finish')}</button></div>`;
    } else if (m.type === 'end') {
      const rows = st.results.map((r, i) => {
        const c = DZ.cases[i];
        const mark = r.grade === 'half' && c.grounds.indexOf(r.ground) >= 0 ? 'bribe' : r.grade;
        return `<tr class="dz-grade-${r.grade}"><td>${esc(c.time)}</td><td>${T(`dz.${c.id}.who`)}</td><td>${T('dz.end.what.' + r.decision)}</td><td class="dz-mark">${T('dz.end.mark.' + mark)}</td></tr>`;
      }).join('');
      const ok = st.results.filter((r) => r.grade === 'ok').length;
      const bribed = st.results.some((r) => r.bribe);
      html = `<div class="dz-card dz-paper dz-card--end" role="dialog" aria-modal="true" aria-labelledby="dz-e-title">
        <div class="dz-paper-head" id="dz-e-title">${T('dz.end.title')}</div><p class="dz-paper-meta">${T('dz.end.sub')}</p>
        <div class="dz-ledger"><table><thead><tr><th>${T('dz.end.col.time')}</th><th>${T('dz.end.col.who')}</th><th>${T('dz.end.col.what')}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="dz-score">${T('dz.end.score', { ok, total: N })}</p>
        <p class="dz-note-label">${T('dz.end.resolution')}</p>
        <p class="dz-note">${T('dz.end.rate.' + DZ.rating(st.results))}${bribed ? ' ' + T('dz.end.bribe') : ''}</p>
        <p class="dz-sign">${T('dz.end.sign')}</p>
        <button type="button" class="dz-btn dz-btn--onpaper" data-act="again">${T('dz.end.again')}</button></div>`;
    }
    el.modal.className = 'dz-modal dz-modal--' + m.type;
    el.modal.innerHTML = html;
    el.modal.hidden = false;
  }

  // ————————————————————————————————————————————— запуск

  function boot(data) {
    build();
    setClock('00:00');
    const saved = data && Array.isArray(data.results)
      ? data.results.filter((r, i) => r && DZ.cases[i] && r.id === DZ.cases[i].id && DZ.POINTS[r.grade] != null).slice(0, N) : [];
    if (saved.length) {
      st.results = saved;
      st.idx = saved.length;
      if (st.idx >= N) { st.phase = 'end'; st.modal = { type: 'end' }; setClock('06:00'); render(); } else enterCase();
    } else render();
    const b = el.modal.querySelector('.dz-btn');
    if (b) b.focus({ preventScroll: true });
  }

  DZ.boot = boot;
  DZ.state = st;

  const hot = root.claude && root.claude.hot;
  try { if (hot && hot.snapshot) hot.snapshot(() => ({ results: st.results })); } catch (e) { /* вне просмотрщика хука нет */ }
  const begin = () => { if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {}); };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', begin); else begin();
})(window);
