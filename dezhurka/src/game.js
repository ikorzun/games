/* Дежурная часть — ход смены и интерфейс.
   Фазы: intro → (talk → inspect → leaving → verdict) × N → end.
   Экран всегда из пяти зон (README, «Интерфейс»): шапка, окно, реплика, стол, панель действия.
   Главное действие фазы стоит только в панели действия; вещь или бумага открывается листом над столом.
   Данные дел — cases.js, строки — strings_<язык>.js, рисунки — art.js. */
(function (root) {
  const DZ = root.DZ;
  const doc = root.document;
  const S = DZ.strings.ru;
  const N = DZ.cases.length;
  const icon = DZ.art.icon;

  const has = (k) => S[k] != null;
  function t(k, vars) {
    let s = S[k];
    if (s == null) return k;
    if (vars) for (const name of Object.keys(vars)) s = s.split('{' + name + '}').join(vars[name]);
    return s;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const T = (k, vars) => esc(t(k, vars));

  // ————————————————————————————————————————————— настройки игрока

  const PREFS_KEY = 'dezhurka.prefs.v1';
  const TEXT_SCALE = [100, 130, 160, 200];   // проценты базового кегля; HIG просит давать увеличение до 200 %
  const prefs = { sound: true, haptics: true, photo: !!DZ.PHOTO_LOBBY, text: 0, tipsDone: false };
  try {
    const saved = JSON.parse(root.localStorage.getItem(PREFS_KEY) || '{}');
    for (const k of ['sound', 'haptics', 'photo', 'tipsDone']) if (typeof saved[k] === 'boolean') prefs[k] = saved[k];
    if (saved.text === 1 || saved.text === 2 || saved.text === 3) prefs.text = saved.text;
  } catch (e) { /* без хранилища играем с настройками по умолчанию */ }
  if (!DZ.PHOTO_LOBBY) prefs.photo = false;
  const savePrefs = () => { try { root.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* не сохранилось — не страшно */ } };
  const canBuzz = () => !!(root.navigator && typeof root.navigator.vibrate === 'function');
  const buzz = (pattern) => { if (prefs.haptics && canBuzz()) { try { root.navigator.vibrate(pattern); } catch (e) { /* не обязательно */ } } };
  // Ход смены тоже запоминается: после перезагрузки страницы игра продолжается со следующего задержанного.
  const PROGRESS_KEY = 'dezhurka.shift.v1';
  const saveProgress = () => {
    try {
      if (st.results.length) root.localStorage.setItem(PROGRESS_KEY, JSON.stringify({ results: st.results })); else root.localStorage.removeItem(PROGRESS_KEY);
    } catch (e) { /* без хранилища смена живёт до перезагрузки */ }
  };
  const loadProgress = () => { try { return JSON.parse(root.localStorage.getItem(PROGRESS_KEY) || 'null'); } catch (e) { return null; } };

  function applyPrefs() {
    DZ.sound.set(prefs.sound);
    doc.documentElement.style.fontSize = TEXT_SCALE[prefs.text] + '%';
    if (el.app) el.app.dataset.text = String(prefs.text);
  }

  // ————————————————————————————————————————————— состояние

  const st = {
    phase: 'intro', idx: 0, lines: [], line: 0, said: null,
    seen: new Set(), docs: new Set(), asked: new Set(),
    sheet: null,      // { type: 'item' | 'doc', id, view, large }
    modal: null,      // { type: 'grounds' | 'menu' | 'restart' }
    bribe: false, zoom: false, results: [],
  };
  let el = {};
  let timers = [];
  let returnFocus = null;
  const keys = { caption: '', desk: '', actions: '' };

  const cur = () => DZ.cases[st.idx];
  const inCase = () => st.phase !== 'intro' && st.phase !== 'end';
  const reduced = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const regular = () => !!(root.matchMedia && root.matchMedia('(min-width: 860px) and (min-height: 480px)').matches);
  const later = (fn, ms) => { timers.push(root.setTimeout(fn, ms)); };
  const clearTimers = () => { timers.forEach((id) => root.clearTimeout(id)); timers = []; };
  const focus = (node) => { if (node) node.focus({ preventScroll: true }); };

  const itemName = (c, it) => (has(`dz.${c.id}.${it.id}.name`) ? t(`dz.${c.id}.${it.id}.name`) : t(`dz.item.${it.art}.name`));
  const viewText = (c, it, i) => (has(`dz.${c.id}.${it.id}.v${i}`) ? t(`dz.${c.id}.${it.id}.v${i}`) : t(`dz.item.${it.art}.v${i}`));
  const tipsOn = () => !prefs.tipsDone && st.idx === 0;

  // ————————————————————————————————————————————— каркас

  function build() {
    const mount = doc.getElementById('dz');
    mount.innerHTML = `
<div class="dz-app" data-phase="intro" data-actors="none">
  <header class="dz-bar">
    <div class="dz-bar-text"><p class="dz-bar-main"></p><p class="dz-bar-sub"></p></div>
    <ol class="dz-pips" aria-hidden="true">${DZ.cases.map(() => '<li></li>').join('')}</ol>
    <button type="button" class="dz-iconbtn" id="dz-menu" data-act="menu" aria-label="${T('dz.menu.open')}" title="${T('dz.menu.open')}">${icon('gear')}</button>
  </header>
  <div class="dz-body">
    <section class="dz-stage" aria-label="${T('dz.stage.label')}">
      <div class="dz-window">
        <div class="dz-scene" data-act="zoom">${DZ.art.scene(T('dz.glass'), T('dz.exit'), T('dz.board'))}</div>
        <button type="button" class="dz-iconbtn dz-zoombtn" id="dz-zoom" data-act="zoom" aria-pressed="false" hidden>${icon('zoom')}</button>
      </div>
    </section>
    <section class="dz-caption" aria-live="polite"></section>
    <section class="dz-desk" aria-label="${T('dz.desk.label')}">
      <div class="dz-desk-main"></div>
      <div class="dz-sheet" hidden></div>
    </section>
    <footer class="dz-actions"></footer>
  </div>
  <div class="dz-modal" hidden></div>
</div>`;
    const q = (sel) => mount.querySelector(sel);
    el = {
      mount, app: q('.dz-app'), barMain: q('.dz-bar-main'), barSub: q('.dz-bar-sub'), pips: Array.from(mount.querySelectorAll('.dz-pips li')),
      bar: q('.dz-bar'), body: q('.dz-body'), stage: q('.dz-stage'), actors: q('.dz-actors'), zoomBtn: q('#dz-zoom'),
      caption: q('.dz-caption'), desk: q('.dz-desk'), main: q('.dz-desk-main'), sheet: q('.dz-sheet'), actions: q('.dz-actions'), modal: q('.dz-modal'),
      clockH: q('.dz-clock-h'), clockM: q('.dz-clock-m'), photoLobby: q('.dz-photo-lobby'), photoDet: q('.dz-photo-det'),
    };
    if (DZ.PHOTO_LOBBY) el.photoLobby.setAttribute('href', DZ.PHOTO_LOBBY);
    mount.addEventListener('click', onClick);
    doc.addEventListener('keydown', onKey);
    root.addEventListener('resize', placeSheet);
    el.sheet.addEventListener('pointerdown', dragStart);
  }

  // ————————————————————————————————————————————— события

  function onClick(e) {
    if (e.target === el.modal) { if (st.modal) closeModal(); return; }   // касание затемнения = «Отмена»
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const d = b.dataset;
    switch (d.act) {
      case 'start': startShift(); break;
      case 'next': advance(); break;
      case 'zoom': toggleZoom(); break;
      case 'item': openSheet('item', d.id, b); break;
      case 'doc': openSheet('doc', d.id, b); break;
      case 'view': setView(Number(d.id)); break;
      case 'size': if (!dragMoved) toggleSheetSize(); break;
      case 'ask': ask(); break;
      case 'bribe': toggleBribe(); break;
      case 'close': if (st.modal) closeModal(); else closeSheet(); break;
      case 'home': decide('home'); break;
      case 'cell': decide('cell'); break;
      case 'ground': resolve('cell', d.id); break;
      case 'continue': nextCase(); break;
      case 'again': startShift(); break;
      case 'menu': openModal('menu', b); break;
      case 'pref': setPref(d.id, d.value); break;
      case 'restart': openModal('restart', returnFocus); break;
      case 'help': openModal('help', returnFocus); break;
      case 'restart-yes': st.modal = null; startShift(); break;
      default: break;
    }
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    if (st.modal) closeModal(); else if (st.sheet) closeSheet();
  }

  // Лист тянется за ручку: вниз — свернуть или убрать, вверх — развернуть. Кнопка «закрыть» остаётся всегда.
  let drag = null;
  let dragMoved = false;
  function dragStart(e) {
    if (regular() || !st.sheet || !e.target.closest('.dz-sheet-head') || e.target.closest('[data-act="close"]')) return;
    const box = el.sheet.firstElementChild;
    drag = { y: e.clientY, dy: 0, box };
    dragMoved = false;
    const move = (ev) => {
      drag.dy = ev.clientY - drag.y;
      if (Math.abs(drag.dy) > 6) dragMoved = true;
      if (dragMoved && !reduced()) drag.box.style.transform = `translateY(${Math.max(drag.dy, -24)}px)`;
    };
    const up = () => {
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', up);
      const dy = drag.dy;
      drag.box.style.transform = '';
      drag = null;
      if (dy > 70) { if (st.sheet && st.sheet.large) toggleSheetSize(); else closeSheet(); } else if (dy < -40 && st.sheet && !st.sheet.large) toggleSheetSize();
      root.setTimeout(() => { dragMoved = false; }, 0);
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
  }

  // ————————————————————————————————————————————— ход смены

  function startShift() {
    clearTimers();
    st.idx = 0; st.results = []; st.modal = null; st.sheet = null;
    saveProgress();
    enterCase();
  }

  function enterCase() {
    const c = cur();
    st.phase = 'talk'; st.seen = new Set(); st.docs = new Set(); st.asked = new Set(); st.sheet = null; st.modal = null;
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
    root.scrollTo(0, 0);
    focus(el.actions.querySelector('button'));
  }

  function advance() {
    if (st.phase !== 'talk') return;
    if (st.line < st.lines.length - 1) {
      st.line++;
      DZ.sound.play('tick');
      renderCaption();
      return;
    }
    st.phase = 'inspect';
    st.said = st.lines[st.line];
    DZ.sound.play('drop');
    buzz(12);
    render();
    focus(el.main.querySelector('.dz-item'));
  }

  function openSheet(type, id, btn) {
    if (st.phase !== 'inspect' && !(type === 'doc' && st.phase === 'talk')) return;
    if (st.sheet && st.sheet.type === type && st.sheet.id === id) { closeSheet(); return; }
    if (type === 'item') st.seen.add(id); else st.docs.add(id);
    st.sheet = { type, id, view: 0, large: false };
    returnFocus = btn || null;
    DZ.sound.play('paper');
    if (!regular()) root.scrollTo(0, 0);
    render();
    focus(el.sheet.querySelector('[data-act="close"]'));
  }

  function closeSheet() {
    if (!st.sheet) return;
    st.sheet = null;
    render();
    if (returnFocus && doc.contains(returnFocus)) focus(returnFocus);
    returnFocus = null;
  }

  function toggleSheetSize() {
    if (!st.sheet || regular()) return;
    st.sheet.large = !st.sheet.large;
    placeSheet();
  }

  function sheetItem() {
    if (!st.sheet || st.sheet.type !== 'item') return null;
    return cur().items.find((it) => it.id === st.sheet.id) || null;
  }

  function setView(i) {
    const it = sheetItem();
    if (!it || !it.views[i] || st.sheet.view === i) return;
    st.sheet.view = i;
    DZ.sound.play('paper');
    renderSheet();
    focus(el.sheet.querySelector('[data-act="view"][aria-checked="true"]'));
  }

  function ask() {
    const it = sheetItem();
    const c = cur();
    if (!it || !has(`dz.${c.id}.${it.id}.a`)) return;
    st.asked.add(it.id);
    st.said = { kind: 'det', who: t(`dz.${c.id}.speaker`), text: t(`dz.${c.id}.${it.id}.a`), q: t(`dz.${c.id}.${it.id}.q`) };
    DZ.sound.play('tick');
    renderCaption();
    renderSheet();
    const qa = el.sheet.querySelector('.dz-qa');
    if (qa) { qa.scrollIntoView({ block: 'nearest' }); focus(qa); }
  }

  function toggleBribe() {
    const it = sheetItem();
    if (!it || !it.bribe) return;
    st.bribe = !st.bribe;
    DZ.sound.play('paper');
    renderSheet();
    focus(el.sheet.querySelector('[data-act="bribe"]'));
  }

  function toggleZoom() {
    if (st.phase !== 'talk' && st.phase !== 'inspect') return;
    st.zoom = !st.zoom;
    renderStage();
  }

  function decide(kind) {
    if (st.phase !== 'inspect') return;
    st.sheet = null;
    if (kind === 'cell') { render(); openModal('grounds', el.actions.querySelector('[data-act="cell"]')); } else resolve('home');
  }

  function resolve(decision, ground) {
    if (st.phase !== 'inspect') return;
    const c = cur();
    const bribe = !!st.bribe;
    const grade = DZ.judge(c, decision, ground, bribe);
    st.results.push({ id: c.id, decision, ground: ground || null, grade, bribe, fb: DZ.feedbackKey(c, grade, ground, bribe, has) });
    saveProgress();
    st.phase = 'leaving'; st.modal = null; st.sheet = null; st.zoom = false;
    st.said = { kind: 'srg', who: t('dz.speaker.srg'), text: t(`dz.srg.${decision}` + (c.gender === 'f' ? '.f' : '')) };
    el.app.dataset.actors = decision;
    if (decision === 'cell') later(() => DZ.sound.play('clank'), reduced() ? 0 : 650); else DZ.sound.play('door');
    if (st.idx === 0 && !prefs.tipsDone) { prefs.tipsDone = true; savePrefs(); }
    render();
    later(() => {
      st.phase = 'verdict';
      DZ.sound.play('stamp');
      buzz(grade === 'ok' ? 18 : [18, 60, 18]);
      render();
      const card = el.main.querySelector('.dz-verdict');
      if (card && !regular()) card.scrollIntoView({ block: 'nearest' });
      focus(el.actions.querySelector('button'));
    }, reduced() ? 60 : 1150);
  }

  function nextCase() {
    if (st.phase !== 'verdict') return;
    st.idx++;
    if (st.idx < N) { enterCase(); return; }
    endShift();
  }

  function endShift() {
    st.phase = 'end'; st.said = null; st.sheet = null; st.modal = null;
    el.app.dataset.actors = 'none';
    el.actors.innerHTML = '';
    setClock('06:00');
    DZ.sound.play('paper');
    render();
    root.scrollTo(0, 0);
    focus(el.actions.querySelector('button'));
  }

  // ————————————————————————————————————————————— окна поверх экрана: основание, настройки, подтверждение

  function openModal(type, from) {
    st.modal = { type };
    returnFocus = from || returnFocus;
    renderModal();
    focus(el.modal.querySelector(type === 'grounds' ? '[data-act="ground"]' : type === 'restart' ? '[data-cancel]' : '[data-act="close"]'));
  }

  function closeModal() {
    if (!st.modal) return;
    st.modal = null;
    renderModal();
    if (returnFocus && doc.contains(returnFocus)) focus(returnFocus);
    returnFocus = null;
  }

  function setPref(id, value) {
    if (id === 'sound') { prefs.sound = !prefs.sound; applyPrefs(); DZ.sound.play('tick'); }
    else if (id === 'haptics') { prefs.haptics = !prefs.haptics; buzz(18); }
    else if (id === 'text') prefs.text = Math.max(0, Math.min(TEXT_SCALE.length - 1, Number(value) || 0));
    else if (id === 'photo') prefs.photo = value === '1';
    else return;
    savePrefs();
    applyPrefs();
    renderStage();
    if (st.sheet) renderSheet();
    renderModal();
    placeSheet();
    focus(el.modal.querySelector(`[data-act="pref"][data-id="${id}"]` + (value != null ? `[data-value="${value}"]` : '')));
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
    renderBar(); renderStage(); renderCaption(); renderDesk(); renderActions(); renderSheet(); renderModal();
  }

  function renderBar() {
    const c = cur();
    const kind = st.phase === 'intro' ? 'intro' : st.phase === 'end' ? 'end' : 'case';
    const vars = c ? { n: st.idx + 1, total: N, time: c.time } : {};
    el.barMain.textContent = t(`dz.bar.${kind}.main`, vars);
    el.barSub.textContent = t(`dz.bar.${kind}.sub`, vars);
    el.pips.forEach((pip, i) => {
      const r = st.results[i];
      pip.className = r ? 'is-' + r.grade : (kind === 'case' && i === st.idx ? 'is-now' : '');
    });
  }

  function renderStage() {
    const canZoom = st.phase === 'talk' || st.phase === 'inspect';
    el.app.classList.toggle('is-photo', prefs.photo && !!DZ.PHOTO_LOBBY);
    el.app.classList.toggle('is-zoomed', canZoom && st.zoom);
    el.app.classList.toggle('can-zoom', canZoom);
    el.zoomBtn.hidden = !canZoom;
    el.zoomBtn.setAttribute('aria-pressed', st.zoom ? 'true' : 'false');
    el.zoomBtn.setAttribute('aria-label', t(st.zoom ? 'dz.zoom.off' : 'dz.zoom.on'));
    el.zoomBtn.title = t(st.zoom ? 'dz.zoom.off' : 'dz.zoom.on');
  }

  function renderCaption() {
    let html;
    if (st.phase === 'intro') html = `<div class="dz-plate"><h1>${T('dz.title')}</h1></div>`;
    else {
      let line = st.phase === 'talk' ? st.lines[st.line] : st.said;
      if (st.phase === 'end') {
        const bribed = st.results.some((r) => r.bribe);
        line = { kind: 'chief', who: t('dz.speaker.chief'), text: t('dz.end.rate.' + DZ.rating(st.results)) + (bribed ? ' ' + t('dz.end.bribe') : '') };
      }
      html = line ? `${line.q ? `<p class="dz-q">— ${esc(line.q)}</p>` : ''}<p class="dz-who dz-who--${line.kind}">${esc(line.who)}</p><p class="dz-line">${esc(line.text)}</p>` : '';
    }
    if (html === keys.caption) return;
    keys.caption = html;
    el.caption.innerHTML = html;
    el.caption.classList.toggle('dz-caption--plate', st.phase === 'intro');
  }

  // ——— стол: что лежит перед дежурным в этой фазе

  function renderDesk() {
    const mode = st.phase === 'intro' ? 'intro' : st.phase === 'end' ? 'end' : st.phase === 'verdict' ? 'verdict' : 'case';
    const key = mode + ':' + st.idx + ':' + st.results.length;
    if (key !== keys.desk) {
      keys.desk = key;
      el.main.innerHTML = mode === 'intro' ? introHtml() : mode === 'end' ? endHtml() : mode === 'verdict' ? verdictHtml() : caseHtml();
    }
    if (mode === 'case') updateCaseDesk();
  }

  function introHtml() {
    return `<h2 class="dz-h">${T('dz.intro.lead')}</h2>
      <ol class="dz-steps">${[1, 2, 3].map((n) => `<li><span class="dz-step-n" aria-hidden="true">${n}</span><span>${T('dz.intro.step' + n)}</span></li>`).join('')}</ol>
      <p class="dz-foot">${T('dz.intro.note')}</p>`;
  }

  function caseHtml() {
    return `<div class="dz-sec">
        <div class="dz-sec-head"><h2 class="dz-h">${T('dz.tray.title')}</h2><p class="dz-sec-note" id="dz-tray-note"></p></div>
        <div class="dz-tray" id="dz-tray"></div>
      </div>
      <div class="dz-sec">
        <div class="dz-sec-head"><h2 class="dz-h">${T('dz.docs.title')}</h2><p class="dz-sec-note" id="dz-docs-note"></p></div>
        <div class="dz-papers">${['report', 'bulletin', 'memo'].map((d) => `<button type="button" class="dz-paperbtn" id="dz-doc-${d}" data-act="doc" data-id="${d}">${icon(d)}<span>${T('dz.doc.' + d)}</span></button>`).join('')}</div>
      </div>
      <p class="dz-detail-empty">${T('dz.detail.empty')}</p>`;
  }

  function updateCaseDesk() {
    const c = cur();
    const tray = el.main.querySelector('#dz-tray');
    const note = el.main.querySelector('#dz-tray-note');
    if (st.phase === 'inspect') {
      if (!tray.querySelector('.dz-item')) {
        tray.classList.remove('is-empty');
        tray.style.setProperty('--n', String(c.items.length));
        tray.innerHTML = c.items.map((it, i) => `<button type="button" class="dz-item" id="dz-item-${c.id}-${it.id}" data-act="item" data-id="${it.id}" style="--i:${i}">
          <span class="dz-item-art">${DZ.art.item(it.art)}</span><span class="dz-item-name">${esc(itemName(c, it))}</span><span class="dz-item-seen" aria-hidden="true">${icon('ok')}</span></button>`).join('');
      }
      tray.querySelectorAll('.dz-item').forEach((b) => {
        const seen = st.seen.has(b.dataset.id);
        const open = !!st.sheet && st.sheet.type === 'item' && st.sheet.id === b.dataset.id;
        b.classList.toggle('is-seen', seen);
        b.classList.toggle('is-open', open);
        b.setAttribute('aria-pressed', open ? 'true' : 'false');
        b.setAttribute('aria-label', b.querySelector('.dz-item-name').textContent + (seen ? ', ' + t('dz.tray.seen') : ''));
      });
      setNote(note, tipsOn() && st.seen.size === 0 ? 'dz.hint.1' : '', t('dz.tray.progress', { n: st.seen.size, total: c.items.length }));
    } else {
      tray.classList.add('is-empty');
      tray.style.setProperty('--n', '1');
      tray.innerHTML = `<p class="dz-tray-empty">${T(st.phase === 'talk' ? 'dz.tray.wait' : 'dz.tray.gone')}</p>`;
      setNote(note, '', '');
    }
    const docsOn = st.phase === 'inspect' || st.phase === 'talk';
    el.main.querySelectorAll('.dz-paperbtn').forEach((b) => {
      const open = !!st.sheet && st.sheet.type === 'doc' && st.sheet.id === b.dataset.id;
      b.disabled = !docsOn;
      b.classList.toggle('is-open', open);
      b.setAttribute('aria-pressed', open ? 'true' : 'false');
    });
    const hint = tipsOn() && st.phase === 'inspect' && st.seen.size > 0 ? (st.docs.size === 0 ? 'dz.hint.2' : 'dz.hint.3') : '';
    setNote(el.main.querySelector('#dz-docs-note'), hint, '');
  }

  // Заметка справа от заголовка раздела: подсказка первой смены (со значком) или обычный текст.
  function setNote(node, hintKey, text) {
    const key = hintKey || 'text:' + text;
    if (node.dataset.key === key) return;
    node.dataset.key = key;
    node.classList.toggle('is-tip', !!hintKey);
    if (hintKey) { node.innerHTML = `${icon('tip')}<span>${T(hintKey)}</span>`; node.setAttribute('role', 'status'); } else { node.textContent = text; node.removeAttribute('role'); }
  }

  function gradeMark(c, r) {
    return r.grade === 'half' && c.grounds.indexOf(r.ground) >= 0 ? 'bribe' : r.grade;
  }

  function verdictHtml() {
    const r = st.results[st.results.length - 1];
    const c = cur();
    const mark = gradeMark(c, r);
    return `<article class="dz-paper dz-verdict dz-grade-${r.grade}">
        <h2 class="dz-paper-head">${T(`dz.${c.id}.who`)}</h2>
        <p class="dz-paper-meta">${T('dz.report.time', { time: c.time })}${r.ground ? ' · ' + T('dz.grounds.' + r.ground) : ''}</p>
        <p class="dz-stamp dz-stamp--${r.decision}">${T(`dz.stamp.${r.decision}` + (c.gender === 'f' ? '.f' : ''))}</p>
        <p class="dz-result">${icon(r.grade)}<span>${T('dz.verdict.' + mark)}</span></p>
        <p class="dz-explain">${T(r.fb)}</p>
      </article>`;
  }

  function endHtml() {
    const ok = st.results.filter((r) => r.grade === 'ok').length;
    const rows = st.results.map((r, i) => {
      const c = DZ.cases[i];
      return `<li class="dz-row dz-grade-${r.grade}">${icon(r.grade)}
        <span class="dz-row-main"><b>${T(`dz.${c.id}.who`)}</b><span>${esc(c.time)} · ${T('dz.end.what.' + r.decision)}</span></span>
        <span class="dz-row-mark">${T('dz.end.mark.' + gradeMark(c, r))}</span></li>`;
    }).join('');
    return `<article class="dz-paper dz-ledger">
        <h2 class="dz-paper-head">${T('dz.end.title')}</h2>
        <p class="dz-score"><b>${T('dz.end.score', { ok, total: N })}</b> <span>${T('dz.end.score.label')}</span></p>
        <ol class="dz-rows">${rows}</ol>
        <p class="dz-sign">${T('dz.end.sign')}</p>
      </article>`;
  }

  // ——— панель действия: одно главное действие фазы, всегда в одном месте

  function renderActions() {
    const last = st.idx + 1 >= N;
    const key = st.phase + (st.phase === 'verdict' && last ? ':last' : '');
    if (key === keys.actions) return;
    keys.actions = key;
    const primary = (act, label, id) => `<button type="button" class="dz-btn dz-btn--primary"${id ? ` id="${id}"` : ''} data-act="${act}">${T(label)}</button>`;
    let html = '';
    if (st.phase === 'intro') html = primary('start', 'dz.intro.start');
    else if (st.phase === 'talk') html = primary('next', 'dz.talk.next', 'dz-next');
    else if (st.phase === 'inspect') {
      html = `<button type="button" class="dz-btn dz-btn--stamp dz-btn--home" id="dz-home" data-act="home">${icon('home')}<span>${T('dz.act.home')}</span></button>
        <button type="button" class="dz-btn dz-btn--stamp dz-btn--cell" id="dz-cell" data-act="cell">${icon('cell')}<span>${T('dz.act.cell')}</span></button>`;
    } else if (st.phase === 'verdict') html = primary('continue', last ? 'dz.verdict.finish' : 'dz.verdict.next');
    else if (st.phase === 'end') html = primary('again', 'dz.end.again');
    el.actions.innerHTML = html;
    el.actions.classList.toggle('is-idle', !html);
  }

  // ——— лист: вещь в руках или бумага со стола

  function linesHtml(raw, asDoc) {
    return raw.split('\n').map((ln) => {
      const cut = ln.indexOf(': ');
      if (asDoc && cut > 0) return `<div class="dz-f"><span class="dz-f-k">${esc(ln.slice(0, cut))}</span><span class="dz-f-v">${esc(ln.slice(cut + 2))}</span></div>`;
      return `<p class="${ln.indexOf('— ') === 0 ? 'dz-li' : ''}">${esc(ln)}</p>`;
    }).join('');
  }

  function itemSheetHtml(c, it) {
    const i = st.sheet.view;
    const v = it.views[i];
    const name = esc(itemName(c, it));
    const text = viewText(c, it, i);
    const usePhoto = prefs.photo && !!c.photo;
    let body;
    if (v.doc) {
      body = `<div class="dz-paper dz-paper--${v.doc}"><p class="dz-paper-head">${name}</p>
        <div class="dz-paper-row">${v.photo ? (usePhoto ? `<div class="dz-photo dz-photo--real" style="background-image:url(${c.photo})"></div>` : `<div class="dz-photo">${DZ.art.photo(c.look, c.id)}</div>`) : ''}<div class="dz-fields">${linesHtml(text, true)}</div></div>
        ${it.bribe ? `<p class="dz-bribe ${st.bribe ? 'is-taken' : ''}"><span class="dz-bill" aria-hidden="true">100</span><span>${T(st.bribe ? 'dz.bribe.out' : 'dz.bribe.in')}</span></p>` : ''}</div>`;
    } else {
      body = `<div class="dz-hand"><div class="dz-hand-art">${DZ.art.item(v.art || it.art)}</div><div class="dz-hand-text">${linesHtml(text, false)}</div></div>`;
    }
    const tabs = it.views.length > 1
      ? `<div class="dz-seg" role="radiogroup" aria-label="${T('dz.views.label')}">${it.views.map((vw, n) => `<button type="button" role="radio" aria-checked="${n === i}" data-act="view" data-id="${n}">${T('dz.tab.' + vw.tab)}</button>`).join('')}</div>` : '';
    let extra = '';
    if (it.bribe && v.doc) extra += `<button type="button" class="dz-btn dz-btn--plain" data-act="bribe">${T(st.bribe ? 'dz.bribe.back' : 'dz.bribe.take')}</button>`;
    if (has(`dz.${c.id}.${it.id}.q`)) {
      extra += st.asked.has(it.id)
        ? `<div class="dz-qa" tabindex="-1"><p><b>${T('dz.speaker.you')}:</b> ${T(`dz.${c.id}.${it.id}.q`)}</p><p><b>${T(`dz.${c.id}.speaker`)}:</b> ${T(`dz.${c.id}.${it.id}.a`)}</p></div>`
        : `<button type="button" class="dz-btn dz-btn--plain dz-btn--ask" data-act="ask">${icon('ask')}<span>${T('dz.ask')}: «${T(`dz.${c.id}.${it.id}.q`)}»</span></button>`;
    }
    return { title: name, close: 'dz.sheet.put', html: `${tabs}<div class="dz-scroll">${body}${extra}</div>` };
  }

  function docSheetHtml(c, id) {
    let paper;
    if (id === 'report') {
      paper = `<div class="dz-paper dz-paper--report"><p class="dz-paper-head">${T('dz.report.title')}</p>
        <p class="dz-paper-meta">${T('dz.report.from')} · ${T('dz.report.time', { time: c.time })}</p>
        <p>${T(`dz.${c.id}.report`)}</p><p class="dz-sign">${T('dz.report.sign')}</p></div>`;
    } else if (id === 'bulletin') {
      let rows = '';
      for (let i = 1; has(`dz.bulletin.${i}`); i++) rows += `<div class="dz-entry"><p class="dz-entry-head">${T(`dz.bulletin.${i}.head`)}</p><p>${T(`dz.bulletin.${i}`)}</p></div>`;
      paper = `<div class="dz-paper dz-paper--bulletin"><p class="dz-paper-head">${T('dz.bulletin.title')}</p><p class="dz-paper-meta">${T('dz.bulletin.sub')}</p>${rows}</div>`;
    } else {
      let rows = '';
      for (let i = 1; has(`dz.memo.${i}`); i++) rows += `<li>${T(`dz.memo.${i}`)}</li>`;
      paper = `<div class="dz-paper dz-paper--memo"><p class="dz-paper-head">${T('dz.memo.title')}</p><p class="dz-strong">${T('dz.memo.cell')}</p><ol>${rows}</ol>
        <p>${T('dz.memo.home')}</p><p class="dz-sign dz-sign--note">${T('dz.memo.note')}</p></div>`;
    }
    return { title: T('dz.doc.' + id), close: 'dz.sheet.put_doc', html: `<div class="dz-scroll">${paper}</div>` };
  }

  function renderSheet() {
    const open = !!st.sheet && (st.phase === 'inspect' || st.phase === 'talk');
    el.app.classList.toggle('has-sheet', open);
    const cover = open && !regular();           // на телефоне лист закрывает реплику, стол и панель действия
    el.caption.inert = cover; el.main.inert = cover; el.actions.inert = cover;
    if (!open) { st.sheet = null; el.sheet.hidden = true; el.sheet.innerHTML = ''; if (keys.desk.indexOf('case') === 0) updateCaseDesk(); return; }
    const c = cur();
    const part = st.sheet.type === 'item' ? itemSheetHtml(c, sheetItem()) : docSheetHtml(c, st.sheet.id);
    const keep = el.sheet.querySelector('.dz-scroll');
    const top = keep && el.sheet.dataset.key === st.sheet.type + ':' + st.sheet.id + ':' + st.sheet.view ? keep.scrollTop : 0;
    el.sheet.dataset.key = st.sheet.type + ':' + st.sheet.id + ':' + st.sheet.view;
    el.sheet.innerHTML = `<div class="dz-sheet-in" role="region" aria-label="${part.title}">
      <div class="dz-sheet-head">
        <button type="button" class="dz-grabber" data-act="size" aria-label="${T('dz.sheet.size')}"><span></span></button>
        <h3 class="dz-sheet-title">${part.title}</h3>
        <button type="button" class="dz-iconbtn dz-closebtn" data-act="close" aria-label="${T(part.close)}" title="${T(part.close)}">${icon('close')}</button>
      </div>${part.html}</div>`;
    el.sheet.hidden = false;
    const sc = el.sheet.querySelector('.dz-scroll');
    if (sc) {
      sc.scrollTop = top;
      const more = () => sc.classList.toggle('is-more', sc.scrollTop + sc.clientHeight < sc.scrollHeight - 6);
      sc.addEventListener('scroll', more, { passive: true });
      placeSheet();
      more();
    }
    updateCaseDesk();
  }

  // Высота листа на телефоне: средний упор — от нижнего края окна до низа экрана, большой — почти весь экран.
  function placeSheet() {
    if (!st.sheet || el.sheet.hidden) return;
    if (regular()) { el.sheet.style.removeProperty('--sheet-h'); return; }
    const vh = root.innerHeight;
    const below = vh - el.stage.getBoundingClientRect().bottom - 6;
    const medium = Math.max(below, Math.min(vh * 0.62, 360));
    const large = vh - el.bar.getBoundingClientRect().bottom - 6;
    el.sheet.style.setProperty('--sheet-h', Math.round(st.sheet.large ? large : Math.min(medium, large)) + 'px');
    el.sheet.classList.toggle('is-large', !!st.sheet.large);
    const sc = el.sheet.querySelector('.dz-scroll');
    if (sc) sc.dispatchEvent(new root.Event('scroll'));
  }

  function renderModal() {
    const m = st.modal;
    el.bar.inert = !!m; el.body.inert = !!m;
    if (!m) { el.modal.hidden = true; el.modal.innerHTML = ''; return; }
    let html = '';
    const head = (title, id) => `<div class="dz-dialog-head"><h2 id="${id}">${T(title)}</h2><button type="button" class="dz-iconbtn dz-closebtn" data-act="close" aria-label="${T('dz.close')}" title="${T('dz.close')}">${icon('close')}</button></div>`;
    if (m.type === 'grounds') {
      html = `<div class="dz-dialog dz-dialog--paper" role="dialog" aria-modal="true" aria-labelledby="dz-g-title">
        <h2 class="dz-paper-head" id="dz-g-title">${T('dz.grounds.title')}</h2>
        <p class="dz-paper-meta">${T(`dz.${cur().id}.who`)}</p><p class="dz-dialog-lead">${T('dz.grounds.lead')}</p>
        <div class="dz-grounds">${DZ.GROUNDS.map((g, i) => `<button type="button" class="dz-ground" data-act="ground" data-id="${g}"><span class="dz-ground-n" aria-hidden="true">${i + 1}</span><span>${T('dz.grounds.' + g)}</span></button>`).join('')}</div>
        <button type="button" class="dz-btn dz-btn--onpaper" data-act="close">${T('dz.cancel')}</button></div>`;
    } else if (m.type === 'menu') {
      const sw = (id, on, label) => `<div class="dz-setrow"><span id="dz-l-${id}">${T(label)}</span>
        <button type="button" class="dz-switch" role="switch" aria-checked="${on}" aria-labelledby="dz-l-${id}" data-act="pref" data-id="${id}"><span></span></button></div>`;
      const seg = (id, label, opts, value) => `<div class="dz-setrow dz-setrow--stack"><span id="dz-l-${id}">${T(label)}</span>
        <div class="dz-seg" role="radiogroup" aria-labelledby="dz-l-${id}">${opts.map((o) => `<button type="button" role="radio" aria-checked="${String(o[0]) === String(value)}" data-act="pref" data-id="${id}" data-value="${o[0]}">${has(o[1]) ? T(o[1]) : esc(o[1])}</button>`).join('')}</div></div>`;
      html = `<div class="dz-dialog" role="dialog" aria-modal="true" aria-labelledby="dz-m-title">${head('dz.menu.title', 'dz-m-title')}
        ${sw('sound', prefs.sound, 'dz.menu.sound')}
        ${canBuzz() ? sw('haptics', prefs.haptics, 'dz.menu.haptics') : ''}
        ${seg('text', 'dz.menu.text', TEXT_SCALE.map((p, i) => [i, p + '\u00a0%']), prefs.text)}
        ${DZ.PHOTO_LOBBY ? seg('photo', 'dz.menu.gfx', [[1, 'dz.menu.gfx.photo'], [0, 'dz.menu.gfx.drawn']], prefs.photo ? 1 : 0) + `<p class="dz-foot">${T('dz.menu.gfx.note')}</p>` : ''}
        <button type="button" class="dz-btn dz-btn--plain dz-btn--row" data-act="help"><span>${T('dz.menu.help')}</span>${icon('next')}</button>
        ${inCase() ? `<button type="button" class="dz-btn dz-btn--danger" data-act="restart">${T('dz.menu.restart')}</button>` : ''}</div>`;
    } else if (m.type === 'help') {
      html = `<div class="dz-dialog" role="dialog" aria-modal="true" aria-labelledby="dz-h-title">${head('dz.menu.help', 'dz-h-title')}
        <ol class="dz-steps">${[1, 2, 3].map((n) => `<li><span class="dz-step-n" aria-hidden="true">${n}</span><span>${T('dz.intro.step' + n)}</span></li>`).join('')}</ol>
        <p class="dz-foot">${T('dz.intro.note')}</p></div>`;
    } else if (m.type === 'restart') {
      html = `<div class="dz-dialog dz-dialog--alert" role="alertdialog" aria-modal="true" aria-labelledby="dz-r-title" aria-describedby="dz-r-text">
        <h2 id="dz-r-title">${T('dz.restart.title')}</h2><p id="dz-r-text">${T('dz.restart.text')}</p>
        <div class="dz-dialog-btns"><button type="button" class="dz-btn dz-btn--plain" data-act="close" data-cancel>${T('dz.cancel')}</button>
        <button type="button" class="dz-btn dz-btn--danger" data-act="restart-yes">${T('dz.restart.yes')}</button></div></div>`;
    }
    el.modal.className = 'dz-modal dz-modal--' + m.type;
    el.modal.innerHTML = html;
    el.modal.hidden = false;
  }

  // ————————————————————————————————————————————— запуск

  function boot(data) {
    build();
    applyPrefs();
    setClock('00:00');
    const src = data && Array.isArray(data.results) && data.results.length ? data : loadProgress();
    const saved = src && Array.isArray(src.results)
      ? src.results.filter((r, i) => r && DZ.cases[i] && r.id === DZ.cases[i].id && DZ.POINTS[r.grade] != null).slice(0, N) : [];
    if (saved.length) {
      st.results = saved;
      st.idx = saved.length;
      if (st.idx >= N) endShift(); else enterCase();
    } else render();
    focus(el.actions.querySelector('button'));
  }

  DZ.boot = boot;
  DZ.state = st;
  DZ.prefs = prefs;

  const hot = root.claude && root.claude.hot;
  try { if (hot && hot.snapshot) hot.snapshot(() => ({ results: st.results })); } catch (e) { /* вне просмотрщика хука нет */ }
  const begin = () => { if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {}); };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', begin); else begin();
})(window);
