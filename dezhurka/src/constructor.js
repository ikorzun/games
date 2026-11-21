/* Страница конструктора задержанных: окно дежурки с персонажем, детали, очередь случайных и выгрузка.
   Рисует всё DZ.chargen (src/chargen.js), тексты берёт по ключам dz.cg.* (src/chargen_strings_ru.js). */
(function (root) {
  const DZ = root.DZ, CG = DZ.chargen, RU = DZ.strings.ru;
  const t = (k) => (RU[k] != null ? RU[k] : k);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'dezhurka.constructor.v1';

  const GROUPS = [
    ['sec.head', ['head', 'skin', 'top', 'hair', 'ears', 'tex']],
    ['sec.face', ['eyes', 'eyen', 'nose', 'mouthx', 'face', 'glasses']],
    ['sec.body', ['build', 'clothes', 'tone', 'accent', 'mark']],
  ];

  const st = { kind: 'all', spec: null, bars: true, lobby: true, tab: 'data', queue: [] };
  const el = {};
  let nextSeed = (Date.now() % 900000) + 1000;
  const newSeed = () => (nextSeed = (nextSeed * 1103515245 + 12345) % 2147483647);

  function speciesOf(kind) { return Object.keys(CG.SPECIES).filter((id) => kind === 'all' || CG.SPECIES[id].kind === kind); }
  function randomSpec(speciesId) {
    const ids = speciesOf(st.kind), seed = newSeed();
    return CG.random(seed, speciesId || ids[seed % ids.length]);
  }

  function save() { try { root.localStorage.setItem(KEY, JSON.stringify({ kind: st.kind, spec: st.spec, bars: st.bars, lobby: st.lobby })); } catch (e) { /* без хранилища */ } }
  function load() { try { return JSON.parse(root.localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }

  function caption(s) { return [t('dz.cg.species.' + s.species), t('dz.cg.mood.' + s.mood).toLowerCase(), t('dz.cg.clothes.' + s.clothes).toLowerCase()].join(' · '); }

  function build(rootEl) {
    rootEl.innerHTML =
      `<header class="cg-bar"><div class="cg-plate"><h1>${esc(t('dz.cg.title'))}</h1><p>${esc(t('dz.cg.sub'))}</p></div></header>` +
      `<main class="cg-main">` +
      `<section class="cg-stage" aria-label="${esc(t('dz.cg.sub'))}">` +
        `<div class="cg-window" id="cg-window"><div class="cg-frame" id="cg-frame"></div><div class="cg-bars" id="cg-bars" aria-hidden="true"></div></div>` +
        `<p class="cg-who" id="cg-who" aria-live="polite"></p>` +
        `<div class="cg-row"><button type="button" class="cg-btn cg-btn--main" id="cg-random" data-act="random">${esc(t('dz.cg.random'))}</button>` +
        `<button type="button" class="cg-btn" id="cg-same" data-act="same">${esc(t('dz.cg.same'))}</button></div>` +
        `<div class="cg-row cg-row--toggles"><label class="cg-check"><input type="checkbox" id="cg-bars-on" data-act="bars"><span>${esc(t('dz.cg.bars'))}</span></label>` +
        `<label class="cg-check"><input type="checkbox" id="cg-lobby-on" data-act="lobby"><span>${esc(t('dz.cg.lobby'))}</span></label></div>` +
      `</section>` +
      `<section class="cg-panel">` +
        `<p class="cg-lead">${esc(t('dz.cg.lead'))}</p>` +
        `<div class="cg-group"><h2>${esc(t('dz.cg.sec.who'))}</h2><div class="cg-seg" id="cg-kinds" role="group" aria-label="${esc(t('dz.cg.sec.who'))}"></div>` +
        `<div class="cg-fields"><label class="cg-field cg-field--wide" for="cg-species"><span>${esc(t('dz.cg.part.species'))}</span><select id="cg-species" data-part="species"></select></label></div></div>` +
        `<div class="cg-group"><h2>${esc(t('dz.cg.sec.state'))}</h2><div class="cg-chips" id="cg-moods" role="group" aria-label="${esc(t('dz.cg.sec.state'))}"></div></div>` +
        GROUPS.map(([sec, parts]) => `<div class="cg-group"><h2>${esc(t('dz.cg.' + sec))}</h2><div class="cg-fields">` +
          parts.map((p) => `<label class="cg-field" for="cg-${p}"><span>${esc(t('dz.cg.part.' + p))}</span><select id="cg-${p}" data-part="${p}">` +
            CG.OPTIONS[p].map((o) => `<option value="${o}">${esc(t('dz.cg.' + p + '.' + o))}</option>`).join('') + `</select></label>`).join('') +
          `</div></div>`).join('') +
      `</section>` +
      `</main>` +
      `<section class="cg-queue"><div class="cg-queue-head"><div><h2>${esc(t('dz.cg.queue'))}</h2><p>${esc(t('dz.cg.queue.note'))}</p></div>` +
        `<button type="button" class="cg-btn" id="cg-queue-new" data-act="queue">${esc(t('dz.cg.queue.new'))}</button></div><div class="cg-thumbs" id="cg-thumbs"></div></section>` +
      `<section class="cg-take"><h2>${esc(t('dz.cg.take'))}</h2><div class="cg-seg" id="cg-tabs" role="group" aria-label="${esc(t('dz.cg.take'))}">` +
        ['data', 'prompt', 'svg'].map((k) => `<button type="button" data-act="tab" data-id="${k}">${esc(t('dz.cg.tab.' + k))}</button>`).join('') + `</div>` +
        `<p class="cg-note" id="cg-take-note"></p><textarea id="cg-out" class="cg-out" readonly rows="7" spellcheck="false" aria-label="${esc(t('dz.cg.take'))}"></textarea>` +
        `<button type="button" class="cg-btn" id="cg-copy" data-act="copy">${esc(t('dz.cg.copy'))}</button></section>`;
    for (const id of ['window', 'frame', 'bars', 'who', 'kinds', 'species', 'moods', 'thumbs', 'out', 'take-note', 'copy', 'tabs', 'bars-on', 'lobby-on']) el[id] = rootEl.querySelector('#cg-' + id);
    el.kinds.innerHTML = ['all'].concat(CG.KINDS).map((k) => `<button type="button" data-act="kind" data-id="${k}">${esc(t('dz.cg.kind.' + k))}</button>`).join('');
    el.moods.innerHTML = CG.OPTIONS.mood.map((m) => `<button type="button" data-act="mood" data-id="${m}">${esc(t('dz.cg.mood.' + m))}</button>`).join('');

    rootEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.tagName === 'INPUT') return;
      const act = b.dataset.act, id = b.dataset.id;
      if (act === 'random') { st.spec = randomSpec(); render(); }
      else if (act === 'same') { st.spec = randomSpec(st.spec.species); render(); }
      else if (act === 'kind') { st.kind = id; if (id !== 'all' && CG.SPECIES[st.spec.species].kind !== id) st.spec = randomSpec(); fillQueue(); render(); }
      else if (act === 'mood') { st.spec.mood = id; render(); }
      else if (act === 'queue') { fillQueue(); renderQueue(); }
      else if (act === 'thumb') { st.spec = Object.assign({}, st.queue[Number(id)]); render(); el.window.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      else if (act === 'tab') { st.tab = id; renderTake(); }
      else if (act === 'copy') copy();
    });
    rootEl.addEventListener('change', (e) => {
      const c = e.target;
      if (c.dataset.act === 'bars') { st.bars = c.checked; render(); return; }
      if (c.dataset.act === 'lobby') { st.lobby = c.checked; render(); return; }
      const part = c.dataset.part;
      if (!part) return;
      if (part === 'species') st.spec = CG.random(st.spec.seed, c.value);
      else st.spec[part] = part === 'eyen' ? Number(c.value) : c.value;
      render();
    });
  }

  function fillQueue() { st.queue = []; for (let i = 0; i < 12; i++) st.queue.push(randomSpec()); }

  function renderQueue() {
    el.thumbs.innerHTML = st.queue.map((s, i) => `<button type="button" class="cg-thumb" data-act="thumb" data-id="${i}" aria-label="${esc(caption(s))}">` +
      CG.svg(s, { bg: 'lobby', uid: 'q' + i }) + `<span>${esc(t('dz.cg.species.' + s.species))}</span></button>`).join('');
  }

  function renderTake() {
    const s = CG.normalize(st.spec);
    for (const b of el.tabs.children) b.setAttribute('aria-pressed', String(b.dataset.id === st.tab));
    el['take-note'].textContent = t('dz.cg.take.' + st.tab);
    el.out.value = st.tab === 'data' ? JSON.stringify(s, null, 1) : st.tab === 'prompt' ? CG.prompt(s) : CG.svg(s, { bg: st.lobby ? 'lobby' : 'plain', uid: 'out' });
    el.copy.textContent = t('dz.cg.copy');
  }

  function render() {
    st.spec = CG.normalize(st.spec);
    const s = st.spec;
    el.frame.innerHTML = CG.svg(s, { bg: st.lobby ? 'lobby' : 'plain', uid: 'main' });
    el.bars.hidden = !st.bars;
    el['bars-on'].checked = st.bars; el['lobby-on'].checked = st.lobby;
    el.who.textContent = caption(s) + '  ·  № ' + s.seed;
    for (const b of el.kinds.children) b.setAttribute('aria-pressed', String(b.dataset.id === st.kind));
    for (const b of el.moods.children) b.setAttribute('aria-pressed', String(b.dataset.id === s.mood));
    const ids = speciesOf(st.kind);
    if (ids.indexOf(s.species) < 0) ids.unshift(s.species);
    el.species.innerHTML = ids.map((id) => `<option value="${id}">${esc(t('dz.cg.species.' + id))}</option>`).join('');
    el.species.value = s.species;
    for (const p of CG.PARTS) { const c = document.getElementById('cg-' + p); if (c && c.tagName === 'SELECT') c.value = String(s[p]); }
    renderTake();
    save();
  }

  function copy() {
    const done = () => { el.copy.textContent = t('dz.cg.copied'); };
    const fallback = () => { el.out.focus(); el.out.select(); };
    try { root.navigator.clipboard.writeText(el.out.value).then(done, fallback); } catch (e) { fallback(); }
  }

  function start(data) {
    const rootEl = document.getElementById('cg');
    build(rootEl);
    const saved = (data && data.spec ? data : null) || load();
    if (saved && saved.spec) { st.kind = saved.kind || 'all'; st.spec = saved.spec; st.bars = saved.bars !== false; st.lobby = saved.lobby !== false; }
    else st.spec = CG.random(1994, 'leshy');
    fillQueue(); renderQueue(); render();
    const hot = root.claude && root.claude.hot;
    if (hot && hot.snapshot) hot.snapshot(() => ({ kind: st.kind, spec: st.spec, bars: st.bars, lobby: st.lobby }));
  }

  const hot = root.claude && root.claude.hot;
  if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || {});
})(window);
