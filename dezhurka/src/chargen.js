/* Межгалактическая дежурная часть — конструктор задержанных.
   Персонаж собирается из деталей (spec) и рисуется SVG-строкой в стиле направления A из img/style/:
   большая округлая голова, мелкие черты в центре лица, тонкий ровный тёмно-коричневый контур,
   плоская приглушённая заливка с одним тоном тени. Кроме людей есть пришельцы и нечисть.
     DZ.chargen.random(seed, speciesId?) → spec     случайный персонаж по зерну (одно зерно — один персонаж)
     DZ.chargen.normalize(spec)          → spec     дополняет пропущенные детали по виду и зерну
     DZ.chargen.svg(spec, opts?)         → строка   поясной кадр 320×360; opts: { bg: 'lobby' | 'plain' | 'none', uid }
     DZ.chargen.prompt(spec)             → строка   английское описание того же персонажа для генеративной модели
   Списки деталей — DZ.chargen.OPTIONS, виды — DZ.chargen.SPECIES; подписи к ним — ключи dz.cg.* в chargen_strings_ru.js. */
(function (root) {
  const DZ = (root.DZ = root.DZ || {});
  const W = 320, H = 360, CX = 160, LINE = '#3b2a20', SW = 2.1;

  // ————————————————————————————————————————————— случайность и цвет

  function rng(seed) {
    let a = (Number(seed) >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const f = (n) => Math.round(n * 10) / 10;
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }
  const shade = (c, t) => mix(c, LINE, t == null ? 0.2 : t);
  const tint = (c, t) => mix(c, '#efe6d2', t == null ? 0.25 : t);

  const SKIN = { peach: '#e2b48e', tan: '#d3a077', ruddy: '#cf9272', pale: '#d6cfbd', grey: '#a7ab9f', olive: '#93a070', teal: '#7f9d92',
    lilac: '#a094ad', ochre: '#c9a35c', moss: '#8a8c5c', bone: '#d2c8ae', brick: '#9a5d4d', steel: '#8e9492', jelly: '#9fc0a8', fur: '#8a7461',
    umber: '#9c6b4a', bronze: '#b98458', plum: '#8a6a86', azure: '#7d93b0', coral: '#c9806a', mint: '#9fbfa6', mustard: '#c9b05a', rose: '#c69a9a', ash: '#9a96a3',
    copper: '#a07c5f', enamel: '#7f9484', bark: '#8a6f55', ashfur: '#8d8a84' };
  const HAIR = { dark: '#4a3a2e', brown: '#6b4a33', ginger: '#9a5a34', grey: '#8d877b', white: '#d9d3c3', black: '#2e2925', moss: '#6f7a45', blond: '#c9a868', bluegrey: '#6f7a86' };
  // приглушённые тона одежды и один насыщенный акцент на персонажа (галстук, узор платка, отделка)
  const TONE = { slate: '#5f6f7d', ink: '#3a4354', olive: '#666b4c', sand: '#a39a7e', rust: '#8f5a3c', wine: '#7a3038', plum: '#6b4a66', sage: '#7d8c72', teal: '#4f7673', mustard: '#b0903f' };
  const ACCENT = { crimson: '#9b2f2a', mustard: '#c9a23f', teal: '#3f7a78', blue: '#3d5c8a', plum: '#7a4370', green: '#5d7a4e', orange: '#c2703a' };

  // ————————————————————————————————————————————— детали и виды

  const OPTIONS = {
    head: ['potato', 'egg', 'pear', 'brick', 'bean', 'bulb', 'dome', 'skull', 'box', 'drop'],
    skin: Object.keys(SKIN),
    eyes: ['dot', 'almond', 'compound', 'slit', 'lamp', 'stalk'],
    eyen: [1, 2, 3, 4],
    nose: ['none', 'bump', 'potato', 'hook', 'snout', 'slits'],
    mouthx: ['none', 'fangs', 'tusks', 'mandibles', 'tentacles', 'grille'],
    ears: ['none', 'round', 'pointed', 'fin', 'animal'],
    top: ['bald', 'buzz', 'short', 'curly', 'sidehair', 'long', 'bun', 'widow', 'flatcap', 'ushanka', 'hat', 'scarf', 'peaked', 'crown',
      'horns', 'bullhorns', 'moss', 'antennae', 'antenna', 'snakes', 'crest', 'helmet'],
    hair: Object.keys(HAIR),
    face: ['none', 'stubble', 'moustache', 'longmoustache', 'beard', 'hugebeard', 'mossbeard'],
    tex: ['none', 'wrinkles', 'scales', 'spots', 'cracks', 'rivets', 'fur'],
    clothes: ['denim', 'vatnik', 'coat', 'overcoat', 'leather', 'blazer', 'chef', 'uniform', 'tracksuit', 'telnyashka', 'rubakha', 'trench',
      'suit', 'sweater', 'cape', 'spacesuit', 'none'],
    tone: ['own'].concat(Object.keys(TONE)),
    accent: Object.keys(ACCENT),
    build: ['tiny', 'narrow', 'medium', 'wide', 'huge'],
    glasses: ['none', 'round', 'rect'],
    mark: ['none', 'scar', 'tattoo', 'both'],
    mood: ['calm', 'irritated', 'caught', 'smug', 'scared', 'sullen'],
  };
  const PARTS = ['head', 'skin', 'eyes', 'eyen', 'nose', 'mouthx', 'ears', 'top', 'hair', 'face', 'tex', 'clothes', 'tone', 'accent', 'build', 'glasses', 'mark', 'mood'];

  const HUMAN_TOPS = ['bald', 'buzz', 'short', 'curly', 'sidehair', 'bun', 'flatcap', 'ushanka', 'scarf', 'hat'];
  const SPECIES = {
    human: { kind: 'human', head: ['potato', 'egg', 'pear', 'brick', 'bean'], skin: ['peach', 'tan', 'ruddy', 'pale', 'umber', 'bronze'], eyes: ['dot'], eyen: [2],
      nose: ['bump', 'bump', 'potato'], mouthx: ['none'], ears: ['round'], top: HUMAN_TOPS, hair: ['dark', 'brown', 'ginger', 'grey', 'black', 'blond'],
      face: ['none', 'none', 'stubble', 'moustache', 'beard'], tex: ['none', 'none', 'wrinkles'],
      clothes: ['denim', 'vatnik', 'coat', 'overcoat', 'leather', 'blazer', 'chef', 'tracksuit', 'sweater', 'trench', 'suit'],
      build: ['narrow', 'medium', 'wide', 'huge'], glasses: ['none', 'none', 'none', 'round', 'rect'] },
    // пришельцы
    grey: { kind: 'alien', head: ['bulb'], skin: ['grey', 'grey', 'ash', 'mint'], eyes: ['almond'], eyen: [2], nose: ['slits', 'none'], mouthx: ['none'], ears: ['none'],
      top: ['bald', 'bald', 'flatcap', 'ushanka', 'hat', 'helmet'], face: ['none'], tex: ['none'],
      clothes: ['vatnik', 'trench', 'sweater', 'spacesuit', 'coat', 'tracksuit'], build: ['tiny', 'narrow'] },
    squid: { kind: 'alien', head: ['dome', 'egg'], skin: ['lilac', 'teal', 'ochre', 'plum', 'coral', 'azure'], eyes: ['dot', 'slit'], eyen: [2], nose: ['none'], mouthx: ['tentacles'],
      ears: ['none'], top: ['bald', 'hat', 'flatcap', 'crest'], face: ['none'], tex: ['spots', 'none'],
      clothes: ['trench', 'overcoat', 'suit', 'leather'], build: ['narrow', 'medium'] },
    insect: { kind: 'alien', head: ['egg', 'bean'], skin: ['ochre', 'olive', 'brick', 'mustard', 'coral'], eyes: ['compound'], eyen: [2], nose: ['none'], mouthx: ['mandibles'],
      ears: ['none'], top: ['antennae'], face: ['none'], tex: ['none', 'spots'], clothes: ['tracksuit', 'leather', 'vatnik', 'denim'], build: ['narrow', 'medium'] },
    blob: { kind: 'alien', head: ['drop'], skin: ['jelly', 'lilac', 'ochre', 'rose', 'azure', 'mint'], eyes: ['dot'], eyen: [3, 3, 4, 1], nose: ['none'], mouthx: ['none'], ears: ['none'],
      top: ['bald', 'flatcap', 'hat', 'ushanka'], face: ['none'], tex: ['spots'], clothes: ['none'], build: ['wide'] },
    reptile: { kind: 'alien', head: ['bean', 'brick', 'pear'], skin: ['olive', 'teal', 'ochre', 'mustard', 'azure', 'coral'], eyes: ['slit'], eyen: [2], nose: ['slits'], mouthx: ['none', 'fangs'],
      ears: ['none'], top: ['bald', 'crest', 'flatcap', 'hat'], face: ['none'], tex: ['scales'],
      clothes: ['blazer', 'leather', 'tracksuit', 'suit', 'overcoat'], build: ['medium', 'wide', 'huge'] },
    robot: { kind: 'alien', head: ['box'], skin: ['steel', 'steel', 'copper', 'enamel'], eyes: ['lamp'], eyen: [1, 2], nose: ['none'], mouthx: ['grille'], ears: ['none'],
      top: ['antenna', 'ushanka', 'flatcap', 'antenna'], face: ['none'], tex: ['rivets'], clothes: ['none', 'vatnik', 'overcoat', 'uniform'], build: ['medium', 'wide'] },
    stalker: { kind: 'alien', head: ['bean', 'potato'], skin: ['ochre', 'lilac', 'teal', 'rose', 'azure', 'mint'], eyes: ['stalk'], eyen: [2, 3], nose: ['none', 'slits'], mouthx: ['none'],
      ears: ['none'], top: ['bald'], face: ['none'], tex: ['spots', 'none'], clothes: ['sweater', 'denim', 'coat', 'telnyashka'], build: ['medium', 'wide'] },
    // нечисть
    leshy: { kind: 'myth', head: ['potato', 'pear'], skin: ['moss', 'moss', 'bark'], eyes: ['dot'], eyen: [2], nose: ['potato', 'hook'], mouthx: ['none'], ears: ['pointed', 'none'],
      top: ['moss'], hair: ['moss'], face: ['mossbeard'], tex: ['cracks'], clothes: ['vatnik', 'rubakha', 'coat'], build: ['medium', 'wide'] },
    vodyanoy: { kind: 'myth', head: ['bean', 'pear'], skin: ['teal', 'olive', 'azure', 'mint'], eyes: ['dot'], eyen: [2], nose: ['potato', 'bump'], mouthx: ['none'], ears: ['fin'],
      top: ['bald', 'sidehair'], hair: ['grey', 'moss'], face: ['longmoustache'], tex: ['spots', 'scales'], clothes: ['telnyashka', 'sweater'], build: ['wide', 'huge'] },
    domovoy: { kind: 'myth', head: ['potato', 'bean'], skin: ['ruddy', 'tan'], eyes: ['dot'], eyen: [2], nose: ['potato'], mouthx: ['none'], ears: ['round', 'pointed'],
      top: ['curly', 'short', 'ushanka'], hair: ['grey', 'white', 'brown'], face: ['hugebeard'], tex: ['none'], clothes: ['rubakha'], build: ['tiny'] },
    chert: { kind: 'myth', head: ['pear', 'potato', 'egg'], skin: ['brick', 'brick', 'plum', 'umber'], eyes: ['dot', 'slit'], eyen: [2], nose: ['snout'], mouthx: ['none', 'fangs'],
      ears: ['pointed'], top: ['horns'], hair: ['black', 'dark'], face: ['none', 'beard', 'stubble'], tex: ['fur', 'none'],
      clothes: ['leather', 'tracksuit', 'blazer'], build: ['narrow', 'medium'] },
    gorynych: { kind: 'myth', heads: 3, head: ['egg', 'potato'], skin: ['olive', 'teal', 'mustard', 'azure', 'plum'], eyes: ['slit', 'dot'], eyen: [2], nose: ['slits'], mouthx: ['none', 'fangs'],
      ears: ['none'], top: ['crest', 'bald'], face: ['none'], tex: ['scales'], clothes: ['overcoat', 'trench', 'coat'], build: ['wide', 'huge'] },
    koschei: { kind: 'myth', head: ['skull'], skin: ['bone', 'bone', 'ash'], eyes: ['dot'], eyen: [2], nose: ['slits', 'none'], mouthx: ['none'], ears: ['none', 'round'],
      top: ['crown', 'bald'], face: ['none'], tex: ['wrinkles', 'cracks'], clothes: ['suit', 'cape', 'overcoat'], build: ['narrow'] },
    vampire: { kind: 'myth', head: ['egg', 'brick'], skin: ['pale', 'ash', 'rose'], eyes: ['dot', 'slit'], eyen: [2], nose: ['bump', 'hook'], mouthx: ['fangs'], ears: ['pointed'],
      top: ['widow'], hair: ['black'], face: ['none'], tex: ['none'], clothes: ['cape', 'suit', 'overcoat'], build: ['narrow', 'medium'] },
    volkolak: { kind: 'myth', head: ['potato', 'pear', 'brick'], skin: ['fur', 'ashfur', 'umber'], eyes: ['slit', 'dot'], eyen: [2], nose: ['snout'], mouthx: ['fangs'], ears: ['animal'],
      top: ['bald'], face: ['none'], tex: ['fur'], clothes: ['vatnik', 'denim', 'leather', 'tracksuit'], build: ['wide', 'huge', 'medium'] },
    likho: { kind: 'myth', head: ['potato', 'egg', 'pear'], skin: ['pale', 'tan', 'olive'], eyes: ['dot'], eyen: [1], nose: ['bump', 'potato', 'hook'], mouthx: ['none'],
      ears: ['round'], top: ['long', 'scarf', 'bald', 'sidehair'], hair: ['grey', 'dark'], face: ['none', 'stubble'], tex: ['wrinkles', 'none'],
      clothes: ['coat', 'vatnik', 'sweater'], build: ['narrow', 'medium', 'wide'] },
    kikimora: { kind: 'myth', head: ['egg', 'pear'], skin: ['olive', 'pale', 'mint', 'plum'], eyes: ['dot'], eyen: [2], nose: ['hook'], mouthx: ['none'], ears: ['pointed', 'none'],
      top: ['long', 'scarf', 'bun'], hair: ['moss', 'grey', 'dark', 'bluegrey'], face: ['none'], tex: ['wrinkles', 'spots'], clothes: ['coat', 'sweater', 'rubakha'], build: ['narrow', 'tiny'] },
    minotaur: { kind: 'myth', head: ['brick', 'bean', 'pear'], skin: ['tan', 'ruddy', 'fur'], eyes: ['dot'], eyen: [2], nose: ['snout'], mouthx: ['none'],
      ears: ['animal', 'round'], top: ['bullhorns'], face: ['none', 'stubble'], tex: ['fur', 'none'],
      clothes: ['chef', 'leather', 'tracksuit', 'uniform', 'blazer'], build: ['huge', 'wide'] },
    gorgon: { kind: 'myth', head: ['egg', 'pear', 'potato'], skin: ['olive', 'pale', 'teal', 'plum', 'mint', 'coral'], eyes: ['slit', 'dot'], eyen: [2], nose: ['bump', 'slits'], mouthx: ['none', 'fangs'],
      ears: ['none'], top: ['snakes'], face: ['none'], tex: ['scales', 'none'], clothes: ['coat', 'blazer', 'sweater', 'trench'], build: ['narrow', 'medium'] },
  };
  const KINDS = ['human', 'alien', 'myth'];

  function random(seed, speciesId) {
    const r = rng(seed);
    const ids = Object.keys(SPECIES);
    const species = SPECIES[speciesId] ? speciesId : pick(r, ids);
    const sp = SPECIES[species];
    const spec = { seed: Number(seed) >>> 0, species };
    for (const p of PARTS) {
      if (p === 'mood') spec.mood = pick(r, OPTIONS.mood);
      else if (p === 'mark') spec.mark = r() < 0.16 ? pick(r, ['scar', 'tattoo', 'both']) : 'none';
      else if (p === 'hair') spec.hair = pick(r, sp.hair || OPTIONS.hair);
      else if (p === 'glasses') spec.glasses = pick(r, sp.glasses || ['none']);
      else if (p === 'tone') spec.tone = pick(r, (CLOTHES[spec.clothes] || {}).tones || ['own']);
      else if (p === 'accent') spec.accent = pick(r, OPTIONS.accent);
      else spec[p] = pick(r, sp[p]);
    }
    return spec;
  }

  function normalize(spec) {
    const base = random(spec && spec.seed != null ? spec.seed : 1, spec && spec.species);
    const out = Object.assign({}, base);
    for (const p of PARTS) {
      const v = spec ? spec[p] : undefined;
      if (v != null && OPTIONS[p].indexOf(p === 'eyen' ? Number(v) : v) >= 0) out[p] = p === 'eyen' ? Number(v) : v;
    }
    return out;
  }

  // ————————————————————————————————————————————— рисование: общее

  const st = (w) => `stroke="${LINE}" stroke-width="${w || SW}" stroke-linejoin="round" stroke-linecap="round"`;
  const P = (d, fill, w, extra) => `<path d="${d}" fill="${fill || 'none'}" ${st(w)}${extra ? ' ' + extra : ''}/>`;
  const E = (cx, cy, rx, ry, fill, w, extra) => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry == null ? rx : ry)}" fill="${fill || 'none'}" ${st(w)}${extra ? ' ' + extra : ''}/>`;
  const dot = (cx, cy, r, fill) => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill || LINE}"/>`;

  function closedPath(pts) {   // гладкий замкнутый контур через точки (Catmull-Rom → кривые Безье)
    const n = pts.length;
    let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
    }
    return d + 'Z';
  }

  // формы головы: ширина, высота, «квадратность» n и расширение книзу k (k < 0 — купол шире подбородка)
  const HEADS = {
    potato: { w: 172, h: 166, n: 2.7, k: 0.07 }, egg: { w: 150, h: 176, n: 2.3, k: -0.08 }, pear: { w: 174, h: 168, n: 2.5, k: 0.2 },
    brick: { w: 166, h: 160, n: 3.3, k: 0.04 }, bean: { w: 196, h: 150, n: 3.0, k: 0.1 }, bulb: { w: 172, h: 172, n: 2.2, k: -0.3 },
    dome: { w: 142, h: 188, n: 2.6, k: -0.04 }, skull: { w: 148, h: 170, n: 2.4, k: -0.2 }, box: { w: 156, h: 146, n: 7, k: 0 }, drop: { w: 236, h: 250, n: 2.3, k: 0.3 },
  };
  function headPath(hd, cx, cy, r) {
    const pts = [], N = 36, ex = 2 / hd.n;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      pts.push([cx + (hd.w / 2) * (1 + hd.k * s) * Math.sign(c) * Math.pow(Math.abs(c), ex) + (r() - 0.5) * 2.2,
        cy + (hd.h / 2) * Math.sign(s) * Math.pow(Math.abs(s), ex) + (r() - 0.5) * 2.2]);
    }
    return closedPath(pts);
  }
  // заливка с одним тоном тени: тёмная форма, поверх неё светлая копия со сдвигом влево-вверх, обрезанная по форме
  function lit(d, fill, id, dx, dy, w) {
    return `<clipPath id="${id}"><path d="${d}"/></clipPath><path d="${d}" fill="${shade(fill, 0.2)}"/>` +
      `<g clip-path="url(#${id})"><path d="${d}" fill="${fill}" transform="translate(${dx == null ? -9 : dx},${dy == null ? -10 : dy})"/></g>` + P(d, 'none', w);
  }

  // ————————————————————————————————————————————— состояние: играется головой, плечами, взглядом

  const MOODS = {
    calm: { tilt: 0, dy: 0, sh: 0, gx: 0, gy: 0, brow: 'flat', mouth: 'line', es: 1 },
    irritated: { tilt: -5, dy: 0, sh: 3, gx: 2.2, gy: 0, brow: 'angry', mouth: 'frown', es: 1 },
    caught: { tilt: 2, dy: -4, sh: 10, gx: 0, gy: 0, brow: 'raised', mouth: 'open', es: 1.22, sweat: true },
    smug: { tilt: 6, dy: -2, sh: 0, gx: 1.6, gy: -0.6, brow: 'cocked', mouth: 'smirk', es: 1, lid: 0.3 },
    scared: { tilt: -2, dy: -2, sh: 13, gx: 0, gy: 0.6, brow: 'worried', mouth: 'wavy', es: 1.15, sweat: true },
    sullen: { tilt: 3, dy: 7, sh: -2, gx: 0, gy: 2.2, brow: 'low', mouth: 'frownsmall', es: 1, lid: 0.45 },
  };

  // ————————————————————————————————————————————— туловище и одежда

  const CLOTHES = {
    denim: { tones: ['own', 'own', 'slate', 'ink'], fill: '#71849a', inner: 'plaid', lapel: 'collar', close: 'buttons', det: ['pockets'] },
    vatnik: { tones: ['own', 'own', 'olive', 'slate', 'sand'], fill: '#6c675d', inner: 'sweater', lapel: 'collar', close: 'open', det: ['quilt'] },
    coat: { tones: ['own', 'plum', 'sage', 'rust', 'slate', 'wine'], fill: '#6a5848', inner: 'none', lapel: 'round', close: 'buttons' },
    overcoat: { tones: ['own', 'sand', 'slate', 'rust', 'ink'], fill: '#62664b', inner: 'tie', lapel: 'wide', close: 'open' },
    leather: { tones: ['own', 'own', 'rust', 'wine'], fill: '#3b3933', inner: 'sweater', lapel: 'wide', close: 'zip' },
    blazer: { tones: ['own', 'own', 'plum', 'teal', 'mustard', 'ink'], fill: '#7d3035', inner: 'turtle', lapel: 'wide', close: 'open', det: ['chain'] },
    chef: { fill: '#e2dbcc', inner: 'none', lapel: 'stand', close: 'double' },
    uniform: { fill: '#5e6c79', inner: 'tie', lapel: 'small', close: 'buttons', det: ['boards', 'pockets'] },
    tracksuit: { tones: ['own', 'wine', 'ink', 'sage', 'plum', 'teal'], fill: '#3f5d6e', inner: 'tee', lapel: 'stand', close: 'zip', det: ['stripes'] },
    telnyashka: { fill: '#ddd6c6', inner: 'none', lapel: 'none', close: 'none', det: ['hstripes'] },
    rubakha: { fill: '#d8cdb6', inner: 'none', lapel: 'none', close: 'placket', det: ['belt'] },
    trench: { tones: ['own', 'sand', 'olive', 'slate'], fill: '#8c8775', inner: 'tie', lapel: 'wide', close: 'open', det: ['belt'] },
    suit: { tones: ['own', 'ink', 'sand', 'plum', 'olive'], fill: '#77756f', inner: 'tie', lapel: 'wide', close: 'open', det: ['ribbons'] },
    sweater: { tones: ['own', 'rust', 'mustard', 'sage', 'teal', 'wine', 'plum'], fill: '#5a5148', inner: 'none', lapel: 'none', close: 'none', det: ['rib'] },
    cape: { tones: ['own', 'own', 'wine', 'plum'], fill: '#2f2b2b', inner: 'shirt', lapel: 'high', close: 'open' },
    spacesuit: { tones: ['own', 'mustard', 'teal', 'sand'], fill: '#c5bfae', inner: 'none', lapel: 'ring', close: 'none', det: ['quilt', 'panel'] },
  };
  const BUILD = { tiny: 150, narrow: 172, medium: 206, wide: 242, huge: 280 };

  function torso(spec, m, uid, skin) {
    const sw = BUILD[spec.build] || 206, sy = 238 - m.sh, x0 = CX - sw / 2, x1 = CX + sw / 2;
    const d = `M${x0},${H + 6} L${x0},${sy + 48} Q${x0},${sy + 6} ${x0 + 40},${sy} L${CX - 26},${sy - 10} L${CX + 26},${sy - 10} L${x1 - 40},${sy} Q${x1},${sy + 6} ${x1},${sy + 48} L${x1},${H + 6} Z`;
    const own = CLOTHES[spec.clothes], acc = ACCENT[spec.accent] || ACCENT.crimson;
    const cl = own && Object.assign({}, own, TONE[spec.tone] ? { fill: TONE[spec.tone] } : null);
    let s = '';
    if (!cl) {                                    // без одежды: робот — корпус с панелью, остальные — голое тело
      const metal = spec.species === 'robot';
      s += lit(d, skin, uid + 'b', -8, -8);
      if (metal) {
        s += `<rect x="${CX - 34}" y="${sy + 34}" width="68" height="46" rx="4" fill="${shade(skin, 0.12)}" ${st(2)}/>`;
        for (let i = 0; i < 4; i++) s += `<path d="M${CX - 22},${sy + 46 + i * 8} L${CX + 22},${sy + 46 + i * 8}" ${st(1.8)} fill="none"/>`;
        s += dot(x0 + 16, sy + 30, 2.2) + dot(x1 - 16, sy + 30, 2.2) + dot(x0 + 16, sy + 96, 2.2) + dot(x1 - 16, sy + 96, 2.2);
      }
      return { svg: s, sy };
    }
    s += lit(d, cl.fill, uid + 'b', -8, -8);
    const inner = { plaid: mix('#8a5a4c', acc, 0.45), sweater: '#3f3a34', tie: '#d9d0bd', turtle: '#2c2927', tee: '#cfc8b8', shirt: '#e6e0d2' }[cl.inner];
    const open = cl.close === 'open', vy = open ? H + 6 : sy + 62, vw = open ? 34 : 0;
    const clip = `clip-path="url(#${uid}b)"`;
    if (inner) {
      s += `<g ${clip}>` + P(`M${CX - 24},${sy - 12} L${CX + 24},${sy - 12} L${CX + vw},${vy} L${CX - vw},${vy} Z`, inner, 2);
      if (cl.inner === 'plaid') for (let i = 0; i < 5; i++) s += `<path d="M${CX - 30},${sy + i * 22} L${CX + 30},${sy + i * 22}" stroke="${shade(inner, 0.35)}" stroke-width="1.6" fill="none"/>`;
      if (cl.inner === 'plaid') s += `<path d="M${CX - 8},${sy - 12} L${CX - 8},${H} M${CX + 8},${sy - 12} L${CX + 8},${H}" stroke="${shade(inner, 0.35)}" stroke-width="1.6" fill="none"/>`;
      if (cl.inner === 'sweater' || cl.inner === 'turtle') s += P(`M${CX - 26},${sy + 2} Q${CX},${sy + 14} ${CX + 26},${sy + 2}`, 'none', 2);
      if (cl.inner === 'tie') s += P(`M${CX - 6},${sy - 4} L${CX + 6},${sy - 4} L${CX + 4},${sy + 8} L${CX + 10},${sy + 74} L${CX},${sy + 88} L${CX - 9},${sy + 74} L${CX - 4},${sy + 8} Z`, shade(acc, 0.22), 2);
      if (cl.inner === 'shirt') s += P(`M${CX},${sy - 6} L${CX},${H}`, 'none', 1.6);
      s += '</g>';
    }
    if (cl.lapel === 'wide') s += P(`M${CX - 26},${sy - 10} L${CX - 56},${sy + 14} L${CX - (open ? 30 : 6)},${sy + (open ? 92 : 62)} Z`, tint(cl.fill, 0.08), 2.2) +
      P(`M${CX + 26},${sy - 10} L${CX + 56},${sy + 14} L${CX + (open ? 30 : 6)},${sy + (open ? 92 : 62)} Z`, shade(cl.fill, 0.1), 2.2);
    if (cl.lapel === 'collar' || cl.lapel === 'small') s += P(`M${CX - 26},${sy - 10} L${CX - 50},${sy + 6} L${CX - 22},${sy + 30} Z`, tint(cl.fill, 0.08), 2.2) +
      P(`M${CX + 26},${sy - 10} L${CX + 50},${sy + 6} L${CX + 22},${sy + 30} Z`, shade(cl.fill, 0.1), 2.2);
    if (cl.lapel === 'stand') s += P(`M${CX - 30},${sy - 8} Q${CX},${sy + 14} ${CX + 30},${sy - 8} L${CX + 30},${sy + 8} Q${CX},${sy + 30} ${CX - 30},${sy + 8} Z`, tint(cl.fill, 0.06), 2.2);
    if (cl.lapel === 'round') s += P(`M${CX - 30},${sy - 8} Q${CX - 64},${sy + 4} ${CX - 44},${sy + 34} Q${CX - 16},${sy + 34} ${CX},${sy + 10} Q${CX + 16},${sy + 34} ${CX + 44},${sy + 34} Q${CX + 64},${sy + 4} ${CX + 30},${sy - 8} Z`, shade(cl.fill, 0.14), 2.2);
    if (cl.lapel === 'high') s += P(`M${CX - 30},${sy + 10} L${CX - 86},${sy - 46} L${CX - 60},${sy + 40} Z`, shade(cl.fill, 0.1), 2.2) + P(`M${CX + 30},${sy + 10} L${CX + 86},${sy - 46} L${CX + 60},${sy + 40} Z`, cl.fill, 2.2);
    if (cl.lapel === 'ring') s += E(CX, sy - 2, 52, 13, shade(cl.fill, 0.2), 2.2);
    const g = (inside) => `<g ${clip}>${inside}</g>`;
    if (cl.close === 'buttons') { let b = P(`M${CX},${sy + 30} L${CX},${H}`, 'none', 1.8); for (let i = 0; i < 3; i++) b += E(CX + 7, sy + 48 + i * 30, 3.4, 3.4, shade(cl.fill, 0.3), 1.6); s += g(b); }
    if (cl.close === 'zip') s += g(P(`M${CX},${sy + 60} L${CX},${H}`, 'none', 2) + `<path d="M${CX},${sy + 60} L${CX},${H}" stroke="#b9a66a" stroke-width="1.2" stroke-dasharray="2 3" fill="none"/>`);
    if (cl.close === 'double') { let b = ''; for (let i = 0; i < 4; i++) b += E(CX - 20, sy + 42 + i * 24, 3.6, 3.6, '#f1ecdf', 1.6) + E(CX + 20, sy + 42 + i * 24, 3.6, 3.6, '#f1ecdf', 1.6); s += g(b); }
    if (cl.close === 'placket') s += g(P(`M${CX - 16},${sy - 8} L${CX + 16},${sy - 8} L${CX + 9},${sy + 44} L${CX - 9},${sy + 44} Z`, acc, 2) + `<path d="M${CX},${sy - 4} L${CX},${sy + 40}" stroke="#efe6d2" stroke-width="2" stroke-dasharray="3 4" fill="none"/>`);
    for (const k of cl.det || []) {
      if (k === 'quilt') { let q = ''; for (let x = x0 + 16; x < x1; x += 20) if (Math.abs(x - CX) > (open ? 40 : 6)) q += `<path d="M${f(x)},${sy + 10} L${f(x)},${H}" stroke="${shade(cl.fill, 0.42)}" stroke-width="1.5" fill="none"/>`; s += g(q); }
      if (k === 'pockets') s += g(P(`M${CX - 66},${sy + 54} h28 v20 h-28 Z`, shade(cl.fill, 0.08), 1.8) + P(`M${CX + 38},${sy + 54} h28 v20 h-28 Z`, shade(cl.fill, 0.08), 1.8));
      if (k === 'chain') s += g(`<path d="M${CX - 22},${sy + 6} Q${CX},${sy + 44} ${CX + 22},${sy + 6}" stroke="${LINE}" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M${CX - 22},${sy + 6} Q${CX},${sy + 44} ${CX + 22},${sy + 6}" stroke="#c9a23f" stroke-width="3.4" stroke-dasharray="5 3" fill="none"/>`);
      if (k === 'boards') s += P(`M${x0 + 12},${sy + 6} l34,-8 l3,12 l-34,8 Z`, '#9b2f2a', 2) + P(`M${x1 - 12},${sy + 6} l-34,-8 l-3,12 l34,8 Z`, '#9b2f2a', 2) +
        `<path d="M${x0 + 22},${sy + 3} l3,12 M${x0 + 30},${sy + 1} l3,12 M${x1 - 22},${sy + 3} l-3,12 M${x1 - 30},${sy + 1} l-3,12" stroke="#d6b354" stroke-width="2" fill="none"/>`;
      if (k === 'stripes') s += g(`<path d="M${x0 + 10},${sy + 26} L${x0 + 10},${H} M${x0 + 20},${sy + 14} L${x0 + 20},${H} M${x1 - 10},${sy + 26} L${x1 - 10},${H} M${x1 - 20},${sy + 14} L${x1 - 20},${H}" stroke="#e2dbcc" stroke-width="4" fill="none"/>`);
      if (k === 'hstripes') { let q = ''; for (let y = sy + 6; y < H; y += 17) q += `<path d="M${x0},${y} Q${CX},${y + 9} ${x1},${y}" stroke="#3d4c66" stroke-width="6" fill="none"/>`; s += g(q) + P(`M${CX - 30},${sy - 9} Q${CX},${sy + 20} ${CX + 30},${sy - 9}`, 'none', 2); }
      if (k === 'belt') s += g(P(`M${x0},${H - 34} Q${CX},${H - 24} ${x1},${H - 34} L${x1},${H - 22} Q${CX},${H - 12} ${x0},${H - 22} Z`, spec.clothes === 'rubakha' ? '#8a6a43' : shade(cl.fill, 0.3), 2));
      if (k === 'ribbons') { let q = ''; ['#9b2f2a', '#c9a23f', '#3d4c66', '#5d7a4e'].forEach((c, i) => { q += `<rect x="${CX + 42 + (i % 2) * 15}" y="${sy + 46 + (i >> 1) * 9}" width="14" height="8" fill="${c}" ${st(1.4)}/>`; }); s += g(q); }
      if (k === 'rib') s += P(`M${CX - 32},${sy - 9} Q${CX},${sy + 14} ${CX + 32},${sy - 9} L${CX + 32},${sy + 3} Q${CX},${sy + 26} ${CX - 32},${sy + 3} Z`, shade(cl.fill, 0.12), 2.2);
      if (k === 'panel') s += g(`<rect x="${CX - 30}" y="${sy + 46}" width="60" height="32" rx="4" fill="#8e9492" ${st(2)}/>` + dot(CX - 16, sy + 62, 4.5, '#b9483f') + dot(CX, sy + 62, 4.5, '#c9a23f') + dot(CX + 16, sy + 62, 4.5, '#5d7a4e'));
    }
    return { svg: s, sy };
  }

  // ————————————————————————————————————————————— голова: уши, волосы и уборы, лицо

  function ears(kind, hd, cy, skin) {
    const xl = CX - hd.w / 2 * (1 + hd.k * 0.1) + 4, xr = CX + hd.w / 2 * (1 + hd.k * 0.1) - 4, y = cy + 6, c = shade(skin, 0.06);
    if (kind === 'round') return E(xl, y, 10, 15, c) + E(xr, y, 10, 15, c) + P(`M${xl - 3},${y - 6} q-4,6 1,12 M${xr + 3},${y - 6} q4,6 -1,12`, 'none', 1.6);
    if (kind === 'pointed') return P(`M${xl + 8},${y - 12} L${xl - 26},${y - 30} L${xl + 6},${y + 14} Z`, c) + P(`M${xr - 8},${y - 12} L${xr + 26},${y - 30} L${xr - 6},${y + 14} Z`, c);
    if (kind === 'fin') return P(`M${xl + 8},${y - 16} L${xl - 30},${y - 28} L${xl - 14},${y - 8} L${xl - 34},${y + 2} L${xl - 12},${y + 8} L${xl - 24},${y + 24} L${xl + 8},${y + 16} Z`, shade(skin, 0.14)) +
      P(`M${xr - 8},${y - 16} L${xr + 30},${y - 28} L${xr + 14},${y - 8} L${xr + 34},${y + 2} L${xr + 12},${y + 8} L${xr + 24},${y + 24} L${xr - 8},${y + 16} Z`, shade(skin, 0.14));
    if (kind === 'animal') { const ty = cy - hd.h / 2 + 22; return P(`M${CX - 62},${ty + 16} L${CX - 74},${ty - 44} L${CX - 26},${ty - 8} Z`, c) + P(`M${CX + 62},${ty + 16} L${CX + 74},${ty - 44} L${CX + 26},${ty - 8} Z`, c) +
      P(`M${CX - 60},${ty + 2} L${CX - 66},${ty - 26} L${CX - 42},${ty - 6} Z`, shade(skin, 0.3), 1.4) + P(`M${CX + 60},${ty + 2} L${CX + 66},${ty - 26} L${CX + 42},${ty - 6} Z`, shade(skin, 0.3), 1.4); }
    return '';
  }

  // back — то, что рисуется за головой; front — поверх головы (clip — id обрезки по контуру головы)
  function top(kind, hd, cy, hair, skin, r, clip, spec) {
    const ty = cy - hd.h / 2, hw = hd.w * (1 - hd.k * 0.6), o = { back: '', front: '' };
    const v = (spec.seed >>> 3) % 4, acc = ACCENT[spec.accent] || ACCENT.crimson;
    const capc = ['#5a4f44', '#4f5560', '#6b5a3e', '#55604f'][v], hatc = ['#5c5347', '#3f3d3b', '#6f6450', '#4d5560'][v];
    const cap = (depth, col) => `<g clip-path="url(#${clip})">` + P(`M${CX - hw},${ty - 20} L${CX + hw},${ty - 20} L${CX + hw},${ty + depth} Q${CX},${ty + depth - 12} ${CX - hw},${ty + depth} Z`, col, 2) + '</g>';
    const scallop = (x0, x1, y, n, rad, col) => { let s = ''; for (let i = 0; i < n; i++) s += E(x0 + (x1 - x0) * (i / (n - 1)) + (r() - 0.5) * 6, y + (r() - 0.5) * 8, rad, rad, col, 2); return s; };
    if (kind === 'buzz') o.front = cap(30, mix(skin, hair, 0.55));
    if (kind === 'short') { o.back = E(CX, ty + 30, hw / 2 + 5, 44, hair); o.front = cap(34, hair); }
    if (kind === 'widow') { o.back = E(CX, ty + 30, hw / 2 + 4, 42, hair); o.front = `<g clip-path="url(#${clip})">` + P(`M${CX - hw},${ty - 20} L${CX + hw},${ty - 20} L${CX + hw},${ty + 52} Q${CX + 34},${ty + 16} ${CX},${ty + 46} Q${CX - 34},${ty + 16} ${CX - hw},${ty + 52} Z`, hair, 2) + '</g>'; }
    if (kind === 'curly') { o.back = scallop(CX - hw / 2 - 2, CX + hw / 2 + 2, ty + 24, 7, 22, hair) + scallop(CX - hw / 2 + 14, CX + hw / 2 - 14, ty + 2, 5, 22, hair); o.front = scallop(CX - hw / 2 + 20, CX + hw / 2 - 20, ty + 12, 5, 15, hair); }
    if (kind === 'sidehair') o.back = scallop(CX - hd.w / 2 - 6, CX - hd.w / 2 + 6, cy - 22, 3, 15, hair) + scallop(CX + hd.w / 2 - 6, CX + hd.w / 2 + 6, cy - 22, 3, 15, hair);
    if (kind === 'long') { o.back = P(`M${CX - hd.w / 2 - 12},${cy + 96} Q${CX - hd.w / 2 - 30},${ty + 10} ${CX},${ty - 12} Q${CX + hd.w / 2 + 30},${ty + 10} ${CX + hd.w / 2 + 12},${cy + 96} Z`, hair); o.front = cap(26, hair); }
    if (kind === 'bun') { o.back = E(CX, ty - 6, 24, 20, hair) + E(CX, ty + 30, hw / 2 + 4, 42, hair); o.front = cap(28, hair); }
    if (kind === 'flatcap') o.front = P(`M${CX - hw / 2 - 6},${ty + 30} Q${CX - hw / 2 - 4},${ty - 26} ${CX + 6},${ty - 22} Q${CX + hw / 2 + 16},${ty - 18} ${CX + hw / 2 + 12},${ty + 28} Q${CX + hw / 2 + 22},${ty + 42} ${CX + 28},${ty + 40} Q${CX - 30},${ty + 26} ${CX - hw / 2 - 6},${ty + 30} Z`, capc) +
      P(`M${CX + 28},${ty + 40} Q${CX - 30},${ty + 26} ${CX - hw / 2 - 6},${ty + 30}`, 'none', 2) + E(CX, ty - 20, 5, 3, capc, 1.8);
    if (kind === 'ushanka') { const fc = ['#7a6652', '#5c5650', '#8a7a5c', '#6b5d57'][v]; o.back = P(`M${CX - hd.w / 2 - 16},${ty + 26} q-16,42 6,78 l22,-8 l-2,-66 Z`, fc) + P(`M${CX + hd.w / 2 + 16},${ty + 26} q16,42 -6,78 l-22,-8 l2,-66 Z`, fc);
      o.front = P(`M${CX - hw / 2 - 16},${ty + 40} Q${CX - hw / 2 - 20},${ty - 34} ${CX},${ty - 36} Q${CX + hw / 2 + 20},${ty - 34} ${CX + hw / 2 + 16},${ty + 40} Q${CX},${ty + 26} ${CX - hw / 2 - 16},${ty + 40} Z`, fc) +
        P(`M${CX - 44},${ty + 30} Q${CX - 46},${ty - 2} ${CX},${ty - 4} Q${CX + 46},${ty - 2} ${CX + 44},${ty + 30}`, shade(fc, 0.16), 2); }
    if (kind === 'hat') o.front = E(CX, ty + 26, hw / 2 + 34, 13, hatc) + P(`M${CX - hw / 2 + 6},${ty + 24} Q${CX - hw / 2 + 10},${ty - 40} ${CX},${ty - 38} Q${CX + hw / 2 - 10},${ty - 40} ${CX + hw / 2 - 6},${ty + 24} Q${CX},${ty + 36} ${CX - hw / 2 + 6},${ty + 24} Z`, hatc) +
      P(`M${CX - hw / 2 + 6},${ty + 10} Q${CX},${ty + 24} ${CX + hw / 2 - 6},${ty + 10}`, 'none', 5, 'opacity=".55"');
    if (kind === 'scarf') { const sc = ['#b9a877', '#a9b5a0', '#c2a59a', '#a3adba'][v], x0 = CX - hd.w / 2 - 14, x1 = CX + hd.w / 2 + 14;
      o.back = P(`M${x0 + 4},${cy + hd.h / 2 + 6} Q${x0 - 14},${ty - 4} ${CX},${ty - 18} Q${x1 + 14},${ty - 4} ${x1 - 4},${cy + hd.h / 2 + 6} Z`, sc);
      let spots = ''; for (let i = 0; i < 9; i++) spots += E(CX + (r() - 0.5) * hd.w * 0.9, ty + 6 + r() * 26, 6, 4, acc, 0.01, 'stroke="none"');
      o.front = `<g clip-path="url(#${clip})">` + P(`M${CX - hw},${ty - 24} L${CX + hw},${ty - 24} L${CX + hw},${ty + 46} Q${CX},${ty + 8} ${CX - hw},${ty + 46} Z`, sc, 2) + spots + '</g>' +
        P(`M${CX - 12},${cy + hd.h / 2 - 2} q12,-10 24,0 q-2,12 -12,12 q-10,0 -12,-12 Z`, sc) + P(`M${CX - 8},${cy + hd.h / 2 + 8} l-22,34 l26,-6 Z`, sc) + P(`M${CX + 8},${cy + hd.h / 2 + 8} l22,34 l-26,-6 Z`, shade(sc, 0.1)); }
    if (kind === 'peaked') o.front = P(`M${CX - hw / 2 - 26},${ty + 8} Q${CX},${ty - 52} ${CX + hw / 2 + 26},${ty + 8} Q${CX},${ty - 4} ${CX - hw / 2 - 26},${ty + 8} Z`, '#5e6c79') +
      P(`M${CX - hw / 2 - 2},${ty + 6} Q${CX},${ty - 6} ${CX + hw / 2 + 2},${ty + 6} L${CX + hw / 2},${ty + 28} Q${CX},${ty + 16} ${CX - hw / 2},${ty + 28} Z`, '#9b2f2a') +
      P(`M${CX - hw / 2 + 4},${ty + 28} Q${CX},${ty + 16} ${CX + hw / 2 - 4},${ty + 28} Q${CX},${ty + 50} ${CX - hw / 2 + 4},${ty + 28} Z`, '#2b2826') + E(CX, ty + 10, 6, 7, '#d6b354', 1.6);
    if (kind === 'crown') o.front = P(`M${CX - 34},${ty + 8} L${CX - 40},${ty - 34} L${CX - 20},${ty - 14} L${CX},${ty - 42} L${CX + 20},${ty - 14} L${CX + 40},${ty - 34} L${CX + 34},${ty + 8} Q${CX},${ty - 2} ${CX - 34},${ty + 8} Z`, '#c9a23f') + dot(CX, ty - 8, 3.5, '#9b2f2a');
    if (kind === 'horns') o.front = P(`M${CX - 50},${ty + 20} Q${CX - 72},${ty - 26} ${CX - 44},${ty - 44} Q${CX - 48},${ty - 14} ${CX - 28},${ty + 8} Z`, '#d9cfb6') + P(`M${CX + 50},${ty + 20} Q${CX + 72},${ty - 26} ${CX + 44},${ty - 44} Q${CX + 48},${ty - 14} ${CX + 28},${ty + 8} Z`, '#c7bca0');
    if (kind === 'bullhorns') o.back = P(`M${CX - hd.w / 2 + 14},${ty + 36} Q${CX - hd.w / 2 - 58},${ty + 30} ${CX - hd.w / 2 - 50},${ty - 34} Q${CX - hd.w / 2 - 22},${ty + 4} ${CX - hd.w / 2 + 24},${ty + 12} Z`, '#d9cfb6') +
      P(`M${CX + hd.w / 2 - 14},${ty + 36} Q${CX + hd.w / 2 + 58},${ty + 30} ${CX + hd.w / 2 + 50},${ty - 34} Q${CX + hd.w / 2 + 22},${ty + 4} ${CX + hd.w / 2 - 24},${ty + 12} Z`, '#c7bca0');
    if (kind === 'moss') { const mc = '#6f7a45'; o.back = P(`M${CX - 36},${ty + 16} l-22,-50 m10,22 l-18,-6 m22,14 l-2,-20`, 'none', 3.4) + P(`M${CX + 40},${ty + 16} l18,-54 m-8,24 l18,-10 m-22,22 l2,-18`, 'none', 3.4) +
        scallop(CX - hw / 2 - 4, CX + hw / 2 + 4, ty + 12, 8, 19, mc);
      o.front = scallop(CX - hw / 2 + 12, CX + hw / 2 - 12, ty + 12, 6, 14, shade(mc, 0.06)) + P(`M${CX + 4},${ty - 6} l0,-18`, 'none', 5) + P(`M${CX - 14},${ty - 22} q18,-22 36,0 q-18,8 -36,0 Z`, '#a8463b') + dot(CX - 2, ty - 27, 2.4, '#efe6d2') + dot(CX + 11, ty - 25, 2, '#efe6d2'); }
    if (kind === 'antennae') o.back = P(`M${CX - 26},${ty + 16} Q${CX - 34},${ty - 50} ${CX - 76},${ty - 60}`, 'none', 3) + P(`M${CX + 26},${ty + 16} Q${CX + 34},${ty - 50} ${CX + 76},${ty - 60}`, 'none', 3) + E(CX - 78, ty - 60, 5, 5, skin) + E(CX + 78, ty - 60, 5, 5, skin);
    if (kind === 'antenna') o.back = P(`M${CX + 30},${ty + 12} L${CX + 40},${ty - 46}`, 'none', 3.2) + E(CX + 41, ty - 50, 6.5, 6.5, acc);
    if (kind === 'snakes') { let s = ''; for (let i = 0; i < 7; i++) { const x = CX - hw / 2 + 10 + (hw - 20) * (i / 6), a = (i - 3) * 9 + (r() - 0.5) * 8, len = 40 + r() * 22;
      const ex = x + Math.sin(a * Math.PI / 180) * len * 1.4, ey = ty + 14 - len;
      s += `<path d="M${f(x)},${ty + 22} Q${f(x + (i % 2 ? 16 : -16))},${f(ty - len / 3)} ${f(ex)},${f(ey)}" stroke="${LINE}" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M${f(x)},${ty + 22} Q${f(x + (i % 2 ? 16 : -16))},${f(ty - len / 3)} ${f(ex)},${f(ey)}" stroke="${shade(skin, 0.14)}" stroke-width="7.6" fill="none" stroke-linecap="round"/>` + dot(ex - 2, ey - 1, 1.3) + dot(ex + 2, ey - 1, 1.3); }
      o.back = s; }
    if (kind === 'crest') { let d = `M${CX - 30},${ty + 14}`; for (let i = 0; i < 5; i++) d += ` L${CX - 22 + i * 12},${ty - 22 - (i === 2 ? 10 : 0)} L${CX - 16 + i * 12},${ty + 8}`; o.back = P(d + ' Z', shade(skin, 0.22)); }
    if (kind === 'helmet') o.front = `<ellipse cx="${CX}" cy="${f(cy - 4)}" rx="${f(hd.w / 2 + 26)}" ry="${f(hd.h / 2 + 24)}" fill="#cfe0dc" fill-opacity=".2" ${st(2.6)}/>` +
      `<path d="M${f(CX - hd.w / 2 - 6)},${f(cy - hd.h / 2 + 12)} q8,-22 34,-30" stroke="#f3f0e6" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/>`;
    return o;
  }

  function brows(kind, xs, y, es) {   // xs — центры глаз, над которыми стоят брови
    if (xs.length < 1) return '';
    const l = xs[0] - 4 * es, rr = xs[xs.length - 1] + 4 * es, yy = y - 13 * es;
    const one = (x, a, b) => `M${f(x - 7)},${f(yy + a)} L${f(x + 7)},${f(yy + b)}`;
    const m = { flat: [0, 0, 0, 0], angry: [-3, 3, 3, -3], raised: [-5, -7, -7, -5], worried: [2, -4, -4, 2], low: [3, 4, 4, 3], cocked: [0, 0, -7, -5] }[kind] || [0, 0, 0, 0];
    return P(one(l, m[0], m[1]) + ' ' + one(rr, m[2], m[3]), 'none', 2.6);
  }

  function mouth(kind, x, y) {
    if (kind === 'line') return P(`M${x - 10},${y} q10,2.5 20,0`, 'none', 2.4);
    if (kind === 'frown') return P(`M${x - 12},${y + 3} q12,-8 24,0`, 'none', 2.4);
    if (kind === 'frownsmall') return P(`M${x - 8},${y + 2} q8,-5 16,0`, 'none', 2.4);
    if (kind === 'smirk') return P(`M${x - 11},${y} q12,7 22,-5`, 'none', 2.4);
    if (kind === 'open') return E(x, y + 2, 7.5, 5, '#4a2b26', 2.2);
    if (kind === 'wavy') return P(`M${x - 12},${y + 1} q3,-5 6,0 t6,0 t6,0 t6,0`, 'none', 2.4);
    return '';
  }

  function face(spec, hd, cy, skin, hair, m, r, uid) {
    const fy = cy + (spec.head === 'bulb' ? 14 : spec.head === 'drop' ? -40 : 0), es = m.es, n = spec.eyen;
    const clip = `clip-path="url(#${uid}h)"`;
    let s = '', over = '';
    // фактура кожи — под чертами лица, обрезана по голове
    if (spec.tex === 'wrinkles') s += P(`M${CX - 30},${fy - 36} q30,-8 60,0 M${CX - 22},${fy - 46} q22,-6 44,0 M${CX - 34},${fy + 8} q-6,10 0,20 M${CX + 34},${fy + 8} q6,10 0,20`, 'none', 1.5, 'opacity=".6"');
    if (spec.tex === 'scales') { let q = ''; for (let i = 0; i < 26; i++) { const x = CX + (r() - 0.5) * hd.w * 0.95, y = cy + (r() - 0.5) * hd.h * 0.95; if (Math.abs(x - CX) < 34 && Math.abs(y - fy - 8) < 34) continue; q += `<path d="M${f(x - 5)},${f(y)} q5,6 10,0" ${st(1.4)} fill="none" opacity=".55"/>`; } s += `<g ${clip}>${q}</g>`; }
    if (spec.tex === 'spots') { let q = ''; for (let i = 0; i < 12; i++) { const x = CX + (r() - 0.5) * hd.w * 0.9, y = cy + (r() - 0.5) * hd.h * 0.9; if (Math.abs(x - CX) < 32 && Math.abs(y - fy - 8) < 34) continue; q += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(4 + r() * 5)}" ry="${f(3 + r() * 4)}" fill="${shade(skin, 0.22)}" opacity=".7"/>`; } s += `<g ${clip}>${q}</g>`; }
    if (spec.tex === 'cracks') s += `<g ${clip}>` + P(`M${CX - 60},${cy - 40} l14,10 l-6,12 l12,8 M${CX + 44},${cy - 58} l-8,14 l10,8 M${CX + 50},${cy + 30} l-12,6 l4,14 M${CX - 46},${cy + 40} l10,-6`, 'none', 1.5, 'opacity=".6"') + '</g>';
    if (spec.tex === 'rivets') { const hx = hd.w / 2 - 14, hy = hd.h / 2 - 14; s += dot(CX - hx, cy - hy, 2.4) + dot(CX + hx, cy - hy, 2.4) + dot(CX - hx, cy + hy, 2.4) + dot(CX + hx, cy + hy, 2.4) + P(`M${CX - hd.w / 2 + 6},${cy + 34} L${CX + hd.w / 2 - 6},${cy + 34}`, 'none', 1.5, 'opacity=".5"'); }
    if (spec.tex === 'fur') { let q = ''; for (let i = 0; i < 34; i++) { const a = r() * Math.PI * 2, x = CX + Math.cos(a) * hd.w * 0.46, y = cy + Math.sin(a) * hd.h * 0.46; q += `<path d="M${f(x)},${f(y)} l${f(Math.cos(a) * 9)},${f(Math.sin(a) * 9 + 4)}" ${st(1.6)} fill="none" opacity=".7"/>`; } s += q; }
    if (spec.face === 'stubble') { let q = ''; for (let i = 0; i < 46; i++) { const x = CX + (r() - 0.5) * hd.w * 0.8, y = fy + 22 + r() * (hd.h * 0.3); if (Math.abs(x - CX) < 16 && y < fy + 44) continue; q += dot(x, y, 0.9, shade(skin, 0.5)); } s += `<g ${clip}>${q}</g>`; }
    // глаза
    const ey = fy - 4, R = 7 * es;
    let xs = [], eyes = '';
    const pupil = (x, y, rr) => dot(x + m.gx * es, y + m.gy * es, rr || 2.3);
    const lid = (x, y, rad) => (m.lid ? `<path d="M${f(x - rad)},${f(y - rad * (1 - m.lid * 1.6))} q${f(rad)},${f(-rad * 0.5)} ${f(rad * 2)},0" ${st(2.2)} fill="none"/>` : '');
    if (spec.eyes === 'almond') { xs = [CX - 24, CX + 24];
      eyes = `<ellipse cx="${CX - 24}" cy="${f(ey)}" rx="19" ry="12" fill="#2b2826" ${st(2)} transform="rotate(22 ${CX - 24} ${f(ey)})"/><ellipse cx="${CX + 24}" cy="${f(ey)}" rx="19" ry="12" fill="#2b2826" ${st(2)} transform="rotate(-22 ${CX + 24} ${f(ey)})"/>` +
        `<path d="M${CX - 34},${f(ey - 5)} q6,-5 12,-2 M${CX + 14},${f(ey - 3)} q6,-5 12,-2" stroke="#8d9aa0" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    } else if (spec.eyes === 'compound') { xs = [CX - 24, CX + 24];
      for (const x of xs) eyes += E(x, ey, 14, 17, '#4a3a2e', 2.2) + `<path d="M${x - 9},${f(ey - 8)} l18,16 M${x - 9},${f(ey + 2)} l12,11 M${x - 3},${f(ey - 14)} l13,12 M${x + 9},${f(ey - 8)} l-18,16" stroke="#8a7461" stroke-width="1.2" fill="none"/>` + dot(x - 4, ey - 7, 2.6, '#d9cfb6');
    } else if (spec.eyes === 'lamp') { xs = n === 1 ? [CX] : [CX - 22, CX + 22];
      for (const x of xs) eyes += E(x, ey, n === 1 ? 20 : 13, n === 1 ? 20 : 13, '#5b5f5c', 2.4) + E(x, ey, n === 1 ? 12 : 8, n === 1 ? 12 : 8, '#e8cf74', 2) + dot(x + m.gx, ey + m.gy, n === 1 ? 4 : 2.8, '#fff6cf');
    } else if (spec.eyes === 'stalk') { const k = Math.max(2, Math.min(3, n)), ty = cy - hd.h / 2; xs = [];
      for (let i = 0; i < k; i++) { const x = CX + (i - (k - 1) / 2) * 46, top = ty - 34 - (k === 3 && i === 1 ? 14 : 0);
        over += `<path d="M${f(x * 0.7 + CX * 0.3)},${f(ty + 14)} Q${f(x)},${f(ty - 6)} ${f(x)},${f(top)}" stroke="${LINE}" stroke-width="11" fill="none" stroke-linecap="round"/><path d="M${f(x * 0.7 + CX * 0.3)},${f(ty + 14)} Q${f(x)},${f(ty - 6)} ${f(x)},${f(top)}" stroke="${skin}" stroke-width="6.4" fill="none" stroke-linecap="round"/>` +
          E(x, top - 6, 11 * es, 11 * es, '#f1ecdf', 2.2) + dot(x + m.gx * 1.4, top - 6 + m.gy * 1.4, 3) + lid(x, top - 6, 11 * es); }
    } else {                                      // dot и slit: мелкие круглые глаза рядом, по одному, по два, три или четыре
      const pos = n === 1 ? [[0, 0, 1.75]] : n === 3 ? [[-9, 4, 1], [9, 4, 1], [0, -12, 1]] : n === 4 ? [[-9, 5, 1], [9, 5, 1], [-9, -11, 1], [9, -11, 1]] : [[-8.5, 0, 1], [8.5, 0, 1]];
      for (const [dx, dy, k] of pos) { const x = CX + dx * es, y = ey + dy * es, rad = R * k;
        if (dy >= 0) xs.push(x);
        if (spec.eyes === 'slit') eyes += E(x, y, rad, rad, '#d8c56a', 2) + `<ellipse cx="${f(x + m.gx * 0.6)}" cy="${f(y + m.gy * 0.6)}" rx="${f(1.5 * k)}" ry="${f(rad * 0.72)}" fill="${LINE}"/>`;
        else eyes += E(x, y, rad, rad, '#f4efe2', 2) + pupil(x, y, 2.3 * k);
        eyes += lid(x, y, rad); }
      if (n === 1) xs = [CX - 6, CX + 6];
    }
    s += eyes;
    if (spec.eyes !== 'almond' && spec.eyes !== 'lamp' && spec.eyes !== 'compound' && spec.eyes !== 'stalk') s += brows(m.brow, xs, ey - (n >= 3 ? 12 * es : 0), n === 1 ? 1.75 * es : es);
    else if (spec.eyes === 'compound' || spec.eyes === 'almond') s += '';
    // нос
    const ny = ey + (n === 1 ? 20 : 12) * es;
    if (spec.nose === 'bump') s += P(`M${CX - 3},${ny - 2} q-7,11 2,13 q9,1 6,-9`, 'none', 2.2);
    if (spec.nose === 'potato') s += E(CX + 1, ny + 8, 11, 9, mix(skin, '#c9695a', 0.28), 2.2);
    if (spec.nose === 'hook') s += P(`M${CX - 5},${ny - 4} Q${CX + 20},${ny + 6} ${CX + 12},${ny + 34} Q${CX + 2},${ny + 30} ${CX - 4},${ny + 20} Q${CX + 2},${ny + 8} ${CX - 5},${ny - 4} Z`, shade(skin, 0.1), 2.2);
    if (spec.nose === 'snout') s += E(CX, ny + 13, 19, 14, mix(skin, '#e6b7a4', 0.4), 2.2) + E(CX - 7, ny + 13, 3, 4.4, shade(skin, 0.6), 0.01, 'stroke="none"') + E(CX + 7, ny + 13, 3, 4.4, shade(skin, 0.6), 0.01, 'stroke="none"');
    if (spec.nose === 'slits') s += P(`M${CX - 4},${ny + 4} l-1,7 M${CX + 4},${ny + 4} l1,7`, 'none', 2);
    const noseH = { none: 4, bump: 16, potato: 22, hook: 36, snout: 32, slits: 14 }[spec.nose] || 8;
    const my = ny + noseH + 9;
    // рот и то, что у рта
    if (spec.mouthx === 'tentacles') { let q = ''; for (let i = 0; i < 5; i++) { const x = CX - 24 + i * 12, len = 36 + (i % 2 ? 14 : 0) + r() * 8, sway = (i - 2) * 3;
      q += `<path d="M${x},${my - 12} q${sway + 6},${f(len / 2)} ${sway},${f(len)}" stroke="${LINE}" stroke-width="11" fill="none" stroke-linecap="round"/><path d="M${x},${my - 12} q${sway + 6},${f(len / 2)} ${sway},${f(len)}" stroke="${shade(skin, 0.06)}" stroke-width="6.6" fill="none" stroke-linecap="round"/>`; } over += q;
    } else if (spec.mouthx === 'grille') { s += `<rect x="${CX - 22}" y="${f(my - 4)}" width="44" height="16" rx="3" fill="#5b5f5c" ${st(2)}/>`; for (let i = 1; i < 6; i++) s += `<path d="M${CX - 22 + i * 7.3},${f(my - 4)} l0,16" ${st(1.4)} fill="none"/>`;
    } else if (spec.mouthx === 'mandibles') { s += P(`M${CX - 12},${my - 4} Q${CX - 34},${my + 6} ${CX - 14},${my + 30} Q${CX - 18},${my + 12} ${CX - 4},${my + 4} Z`, shade(skin, 0.34), 2.2) + P(`M${CX + 12},${my - 4} Q${CX + 34},${my + 6} ${CX + 14},${my + 30} Q${CX + 18},${my + 12} ${CX + 4},${my + 4} Z`, shade(skin, 0.34), 2.2);
    } else {
      s += mouth(m.mouth, CX, my);
      if (spec.mouthx === 'fangs') s += P(`M${CX - 8},${my + 1} l2.5,9 l3,-8 Z`, '#f4efe2', 1.6) + P(`M${CX + 8},${my + 1} l-2.5,9 l-3,-8 Z`, '#f4efe2', 1.6);
      if (spec.mouthx === 'tusks') s += P(`M${CX - 13},${my + 4} l-2,-13 l7,10 Z`, '#f4efe2', 1.6) + P(`M${CX + 13},${my + 4} l2,-13 l-7,10 Z`, '#f4efe2', 1.6);
    }
    // усы и борода
    const hc = spec.face === 'mossbeard' ? HAIR.moss : hair;
    if (spec.face === 'moustache') s += P(`M${CX},${my - 9} Q${CX - 16},${my - 16} ${CX - 30},${my - 2} Q${CX - 16},${my + 2} ${CX},${my - 2} Q${CX + 16},${my + 2} ${CX + 30},${my - 2} Q${CX + 16},${my - 16} ${CX},${my - 9} Z`, hc, 2.2);
    if (spec.face === 'longmoustache') over += P(`M${CX},${my - 9} Q${CX - 22},${my - 14} ${CX - 30},${my + 8} Q${CX - 34},${my + 50} ${CX - 24},${my + 74} Q${CX - 20},${my + 30} ${CX - 8},${my} Z`, hc, 2.2) + P(`M${CX},${my - 9} Q${CX + 22},${my - 14} ${CX + 30},${my + 8} Q${CX + 34},${my + 50} ${CX + 24},${my + 74} Q${CX + 20},${my + 30} ${CX + 8},${my} Z`, shade(hc, 0.1), 2.2);
    if (spec.face === 'beard' || spec.face === 'mossbeard') { const by = cy + hd.h / 2;
      over += P(`M${CX - hd.w * 0.36},${my - 14} Q${CX - hd.w * 0.5},${by - 6} ${CX - 30},${by + 26} Q${CX},${by + 44} ${CX + 30},${by + 26} Q${CX + hd.w * 0.5},${by - 6} ${CX + hd.w * 0.36},${my - 14} Q${CX + 18},${my + 16} ${CX},${my + 6} Q${CX - 18},${my + 16} ${CX - hd.w * 0.36},${my - 14} Z`, hc, 2.2);
      if (spec.face === 'mossbeard') over += P(`M${CX - 22},${by + 6} l-6,12 M${CX + 2},${by + 14} l0,14 M${CX + 24},${by + 4} l6,12`, 'none', 1.8, 'opacity=".6"'); }
    if (spec.face === 'hugebeard') { const by = cy + hd.h / 2;
      over += P(`M${CX - hd.w * 0.42},${my - 20} Q${CX - hd.w * 0.72},${by + 30} ${CX - 44},${by + 96} Q${CX - 14},${by + 132} ${CX},${by + 110} Q${CX + 14},${by + 132} ${CX + 44},${by + 96} Q${CX + hd.w * 0.72},${by + 30} ${CX + hd.w * 0.42},${my - 20} Q${CX + 20},${my + 16} ${CX},${my + 6} Q${CX - 20},${my + 16} ${CX - hd.w * 0.42},${my - 20} Z`, hc, 2.2) +
        P(`M${CX - 30},${by + 20} q-4,30 6,54 M${CX},${by + 30} l0,56 M${CX + 30},${by + 20} q4,30 -6,54`, 'none', 1.6, 'opacity=".5"'); }
    // очки — только на двух обычных глазах: каждое стекло вокруг своего глаза
    if (spec.glasses !== 'none' && spec.eyes === 'dot' && n === 2) { const gx = 8.5 * es, gr = R + 3.2;
      if (spec.glasses === 'round') s += E(CX - gx, ey, gr, gr, 'none', 2) + E(CX + gx, ey, gr, gr, 'none', 2);
      else s += `<rect x="${f(CX - gx - gr)}" y="${f(ey - gr + 1.5)}" width="${f(gr * 2 - 1)}" height="${f(gr * 2 - 3)}" rx="2.5" fill="none" ${st(2)}/><rect x="${f(CX + gx - gr + 1)}" y="${f(ey - gr + 1.5)}" width="${f(gr * 2 - 1)}" height="${f(gr * 2 - 3)}" rx="2.5" fill="none" ${st(2)}/>`;
      s += P(`M${f(CX - gx - gr)},${f(ey - 1)} L${f(CX - hd.w / 2 + 6)},${f(ey - 6)} M${f(CX + gx + gr)},${f(ey - 1)} L${f(CX + hd.w / 2 - 6)},${f(ey - 6)}`, 'none', 1.8); }
    // приметы: шрам через бровь, якорь на шее у челюсти
    if (spec.mark === 'scar' || spec.mark === 'both') s += `<path d="M${CX + 24},${f(ey - 32)} L${CX + 9},${f(ey - 6)}" stroke="#b9483f" stroke-width="4.2" stroke-linecap="round" fill="none"/><path d="M${CX + 24},${f(ey - 32)} L${CX + 9},${f(ey - 6)} M${CX + 12},${f(ey - 24)} l8,4 M${CX + 8},${f(ey - 16)} l8,4" ${st(1.3)} fill="none"/>`;
    if (spec.mark === 'tattoo' || spec.mark === 'both') { const ax = CX + hd.w * 0.27, ay = cy + hd.h / 2 - 22;
      s += `<g stroke="#2e3f5c" stroke-width="2.4" fill="none" stroke-linecap="round"><path d="M${f(ax)},${f(ay - 9)} l0,19 M${f(ax - 6)},${f(ay - 3)} l12,0 M${f(ax - 9)},${f(ay + 4)} q9,12 18,0"/><circle cx="${f(ax)}" cy="${f(ay - 12)}" r="2.6"/></g>`; }
    if (m.sweat) s += P(`M${CX + hd.w * 0.3},${fy - 34} q-7,12 0,15 q7,-3 0,-15 Z`, '#a9c6cf', 1.8);
    return { under: s, over };
  }

  // голова целиком в своих координатах; собирается вокруг (CX, cy)
  function head(spec, m, r, uid, cy0) {
    const hd = HEADS[spec.head] || HEADS.potato, skin = SKIN[spec.skin] || SKIN.peach, hair = HAIR[spec.hair] || HAIR.dark;
    const cy = cy0 != null ? cy0 : (spec.head === 'drop' ? 262 : 230 - hd.h / 2) + m.dy;
    const d = headPath(hd, CX, cy, r);
    const t = top(spec.top, hd, cy, hair, skin, r, uid + 'h', spec);
    const fc = face(spec, hd, cy, skin, hair, m, r, uid);
    const jelly = spec.skin === 'jelly' || spec.species === 'blob';
    let s = t.back + ears(spec.ears, hd, cy, skin);
    s += jelly ? `<clipPath id="${uid}h"><path d="${d}"/></clipPath><path d="${d}" fill="${skin}" fill-opacity=".72" ${st()}/><path d="M${CX - 66},${f(cy - 70)} q-22,40 -10,92" stroke="#f3f0e6" stroke-width="7" fill="none" stroke-linecap="round" opacity=".5"/>` +
      dot(CX + 60, cy + 30, 5, '#f3f0e6') + dot(CX - 40, cy + 70, 3.5, '#f3f0e6') + dot(CX + 30, cy + 84, 4, '#f3f0e6')
      : lit(d, skin, uid + 'h');
    s += fc.under + t.front + fc.over;
    return { svg: s, cy, hd, skin };
  }

  // ————————————————————————————————————————————— фон кадра и сборка

  function lobby(uid) {
    return `<rect width="${W}" height="${H}" fill="#b3ab8e"/><rect y="150" width="${W}" height="140" fill="#6f7a5a"/><path d="M0,150 L${W},150" ${st(2)} fill="none"/>` +
      `<rect y="286" width="${W}" height="80" fill="#857a63"/><path d="M0,286 L${W},286 M40,286 L20,${H} M110,286 L100,${H} M190,286 L196,${H} M262,286 L280,${H} M0,318 L${W},318" ${st(1.6)} fill="none" opacity=".55"/>` +
      `<rect x="236" y="74" width="72" height="212" fill="#6a4e37" ${st(2.2)}/><rect x="246" y="86" width="52" height="80" fill="#5c432f" ${st(1.6)}/><rect x="246" y="178" width="52" height="96" fill="#5c432f" ${st(1.6)}/>` + dot(244, 190, 3.4, '#c9a23f') +
      `<path d="M8,214 L96,214 L96,226 L8,226 Z M8,236 L96,236 L96,246 L8,246 Z" fill="#8a6a43" ${st(1.8)}/><path d="M16,246 L16,292 M88,246 L88,292" ${st(3)} fill="none"/>` +
      `<rect x="104" y="14" width="112" height="13" rx="5" fill="#f1e7a8" ${st(1.8)}/><ellipse cx="160" cy="26" rx="120" ry="34" fill="#f1e7a8" opacity=".18"/>` +
      `<path d="M22,96 q10,-10 22,0 q-4,12 6,20 M196,112 q8,6 4,16" stroke="#8f8a70" stroke-width="5" fill="none" opacity=".5" stroke-linecap="round"/>` +
      `<radialGradient id="${uid}v" cx="50%" cy="42%" r="75%"><stop offset="55%" stop-color="#1a1410" stop-opacity="0"/><stop offset="100%" stop-color="#1a1410" stop-opacity=".5"/></radialGradient><rect width="${W}" height="${H}" fill="url(#${uid}v)"/>`;
  }

  let counter = 0;
  function svg(input, opts) {
    const spec = normalize(input), o = opts || {}, uid = o.uid || 'cg' + (++counter), r = rng((spec.seed ^ 0x9e3779b9) >>> 0);
    const m = MOODS[spec.mood] || MOODS.calm, sp = SPECIES[spec.species] || SPECIES.human;
    const skin = SKIN[spec.skin] || SKIN.peach;
    let fig = '';
    if (spec.head === 'drop') {                    // слизень: тела нет, вся фигура — капля
      const h = head(spec, m, r, uid);
      fig = `<g transform="rotate(${m.tilt * 0.4} ${CX} ${H})">${h.svg}</g>`;
    } else if (sp.heads === 3) {                   // три головы на шеях из одного воротника
      const b = torso(spec, m, uid, skin), moods = [spec.mood, 'sullen', 'smug', 'irritated', 'calm', 'scared'];
      let necks = '', heads = '';
      [[-74, 20, 0.5, -14], [0, -20, 0.56, 0], [74, 20, 0.5, 14]].forEach(([dx, dy, k, tilt], i) => {
        const mm = MOODS[i === 1 ? spec.mood : moods[1 + ((spec.seed + i) % 5)]] || MOODS.calm;
        const hh = head(Object.assign({}, spec, { mark: i === 1 ? spec.mark : 'none' }), mm, rng(spec.seed + 31 * (i + 1)), uid + 'n' + i, 110);
        const hx = CX + dx, hy = 104 + dy + mm.dy;
        necks += `<path d="M${CX + dx * 0.25},${b.sy + 4} Q${CX + dx * 0.7},${f((b.sy + hy) / 2 + 30)} ${hx},${hy + 30}" stroke="${LINE}" stroke-width="34" fill="none" stroke-linecap="round"/><path d="M${CX + dx * 0.25},${b.sy + 4} Q${CX + dx * 0.7},${f((b.sy + hy) / 2 + 30)} ${hx},${hy + 30}" stroke="${shade(skin, 0.08)}" stroke-width="29" fill="none" stroke-linecap="round"/>`;
        heads += `<g transform="translate(${hx} ${hy}) rotate(${tilt + mm.tilt}) scale(${k}) translate(${-CX} -110)">${hh.svg}</g>`;
      });
      fig = necks + b.svg + heads;
    } else {
      const b = torso(spec, m, uid, skin), h = head(spec, m, r, uid);
      const neck = `<path d="M${CX - 30},${f(h.cy + h.hd.h / 2 - 22)} L${CX - 26},${b.sy + 6} L${CX + 26},${b.sy + 6} L${CX + 30},${f(h.cy + h.hd.h / 2 - 22)} Z" fill="${shade(skin, 0.2)}" ${st(2)}/>`;
      const under = `<g clip-path="url(#${uid}b)"><ellipse cx="${CX + 6}" cy="${f(h.cy + h.hd.h / 2 + 4)}" rx="${f(h.hd.w * 0.46)}" ry="20" fill="${LINE}" opacity=".22"/></g>`;
      fig = neck + b.svg + under + `<g transform="rotate(${m.tilt} ${CX} ${f(h.cy + h.hd.h / 2 - 10)})">${h.svg}</g>`;
    }
    const scale = spec.build === 'tiny' ? 0.74 : spec.build === 'huge' ? 1.04 : 1;
    if (scale !== 1) fig = `<g transform="translate(${CX} ${H}) scale(${scale}) translate(${-CX} ${-H})">${fig}</g>`;
    const bg = o.bg === 'lobby' ? lobby(uid) : o.bg === 'plain' ? `<rect width="${W}" height="${H}" fill="#cfc6b3"/>` : '';
    const wob = `<filter id="${uid}w" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="${spec.seed % 97}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.6"/></filter>`;
    const grain = bg ? `<filter id="${uid}g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .12  0 0 0 0 .09  0 0 0 0 .07  0 0 0 .5 -.12"/></filter>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" class="cg-svg"><defs>${wob}${grain}</defs>${bg}<g filter="url(#${uid}w)">${fig}</g>` +
      (bg ? `<rect width="${W}" height="${H}" filter="url(#${uid}g)" opacity=".4"/>` : '') + '</svg>';
  }

  // ————————————————————————————————————————————— описание для генеративной модели (по-английски, это техническая инструкция)

  const EN = {
    species: { human: 'an ordinary person', grey: 'a small grey-skinned alien', squid: 'an alien with a squid-like face', insect: 'an insect-like alien', blob: 'a translucent jelly blob alien',
      reptile: 'a lizard-skinned alien', robot: 'a dented boxy robot', stalker: 'an alien with eyes on stalks', leshy: 'a forest spirit covered with moss and bark', vodyanoy: 'a fat wet water spirit',
      domovoy: 'a tiny hairy house spirit', chert: 'a small-time devil', gorynych: 'a three-headed dragon standing upright like a man', koschei: 'a very thin, very old immortal king',
      vampire: 'a pale vampire', volkolak: 'a werewolf', likho: 'a one-eyed creature of bad luck', kikimora: 'a thin swamp hag', minotaur: 'a bull-headed man', gorgon: 'a gorgon with snakes for hair' },
    head: { potato: 'a potato-shaped head', egg: 'an egg-shaped head', pear: 'a pear-shaped head with heavy jowls', brick: 'a brick-shaped head', bean: 'a wide bean-shaped head',
      bulb: 'a large bulb-shaped head with a narrow chin', dome: 'a tall domed head', skull: 'a skull-like head with sunken cheeks', box: 'a boxy head', drop: 'a drop-shaped body with no separate head' },
    eyes: { dot: 'small round eyes with dot pupils', almond: 'big dark almond eyes', compound: 'faceted insect eyes', slit: 'small yellow eyes with slit pupils', lamp: 'lamp eyes', stalk: 'eyes on stalks' },
    nose: { none: '', bump: 'a tiny nose', potato: 'a round red nose', hook: 'a long hooked nose', snout: 'a pig-like snout', slits: 'nostril slits instead of a nose' },
    mouthx: { none: '', fangs: 'small fangs', tusks: 'short tusks', mandibles: 'mandibles', tentacles: 'short tentacles where the mouth would be', grille: 'a speaker grille for a mouth' },
    ears: { none: '', round: '', pointed: 'pointed ears', fin: 'fin-like ears', animal: 'animal ears' },
    top: { bald: 'bald', buzz: 'a buzz cut', short: 'short hair', curly: 'curly hair', sidehair: 'a bald top with tufts at the sides', long: 'long lank hair', bun: 'hair in a bun', widow: 'slicked black hair with a widow\'s peak',
      flatcap: 'a flat cap', ushanka: 'a fur hat with ear flaps', hat: 'a felt hat', scarf: 'a floral headscarf tied under the chin', peaked: 'a peaked uniform cap with a red band', crown: 'a small crown',
      horns: 'short horns', bullhorns: 'bull horns', moss: 'twigs and one small mushroom growing from the head', antennae: 'two antennae', antenna: 'one antenna', snakes: 'small snakes instead of hair',
      crest: 'a spiny crest', helmet: 'a glass dome helmet' },
    face: { none: '', stubble: 'stubble', moustache: 'a thick moustache', longmoustache: 'a long drooping moustache', beard: 'a beard', hugebeard: 'a huge beard down to the belt', mossbeard: 'a beard of moss' },
    tex: { none: '', wrinkles: 'deep wrinkles', scales: 'scaly skin', spots: 'spotted skin', cracks: 'cracked bark-like skin', rivets: 'rivets and dents', fur: 'shaggy fur' },
    clothes: { denim: 'a {c} denim jacket over a plaid shirt', vatnik: 'a {c} quilted padded work jacket', coat: 'an old {c} coat', overcoat: 'a long unbuttoned {c} overcoat with a crooked tie', leather: 'a {c} leather jacket',
      blazer: 'a {c} blazer with a thick gold chain', chef: 'a {c} chef jacket', uniform: 'a {c} militia uniform', tracksuit: 'a {c} 1990s tracksuit with side stripes', telnyashka: 'a striped sailor vest',
      rubakha: 'a long {c} peasant shirt with a rope belt', trench: 'a belted {c} trench coat', suit: 'a worn {c} suit with medal ribbons', sweater: 'a plain {c} sweater', cape: 'a {c} cape with a high collar',
      spacesuit: 'a worn {c} quilted spacesuit', none: 'no clothes' },
    own: { denim: 'faded blue', vatnik: 'grey', coat: 'brown', overcoat: 'olive', leather: 'black', blazer: 'crimson', chef: 'white', uniform: 'grey-blue', tracksuit: 'dark teal', rubakha: 'unbleached',
      trench: 'grey-beige', suit: 'grey', sweater: 'dark brown', cape: 'black', spacesuit: 'off-white' },
    tone: { slate: 'slate-blue', ink: 'dark ink-blue', olive: 'olive', sand: 'sand-coloured', rust: 'rust-brown', wine: 'wine-red', plum: 'dusty plum', sage: 'sage-green', teal: 'muted teal', mustard: 'mustard' },
    accent: { crimson: 'crimson', mustard: 'yellow', teal: 'turquoise', blue: 'blue', plum: 'purple', green: 'green', orange: 'orange' },
    build: { tiny: 'half the height of a man', narrow: 'thin', medium: 'of average build', wide: 'stout', huge: 'huge and broad' },
    mood: { calm: 'calm and heavy, looking straight at us', irritated: 'irritated, head turned a little away, eyes aside', caught: 'caught out: head pulled back, brows raised, a drop of sweat on the temple',
      smug: 'smug, head tilted, one eyebrow raised, a one-sided smile', scared: 'frightened, shoulders up, mouth open', sullen: 'sullen, head lowered, looking at the floor' },
    mark: { none: '', scar: 'one straight scar through the left eyebrow', tattoo: 'a small anchor tattoo on the side of the neck', both: 'one straight scar through the left eyebrow and a small anchor tattoo on the side of the neck' },
    skin: { peach: '', tan: '', ruddy: 'ruddy skin', pale: 'pale skin', grey: 'grey skin', olive: 'olive-green skin', teal: 'grey-green skin', lilac: 'dull lilac skin', ochre: 'ochre skin', moss: 'mossy green-brown skin',
      bone: 'bone-white skin', brick: 'dark brick-red skin', steel: 'dull steel plating', jelly: 'translucent pale green jelly', fur: 'grey-brown fur',
      umber: 'dark brown skin', bronze: 'bronze skin', plum: 'dusty plum skin', azure: 'dusty blue skin', coral: 'dull coral skin', mint: 'pale mint skin', mustard: 'mustard-yellow skin', rose: 'dusty pink skin',
      ash: 'ash-violet skin', copper: 'dull copper plating', enamel: 'chipped green enamel', bark: 'brown bark-like skin', ashfur: 'ash-grey fur' },
  };
  function prompt(input) {
    const s = normalize(input), bits = [];
    const add = (v) => { if (v) bits.push(v); };
    add(EN.build[s.build]); add(EN.head[s.head]); add(EN.skin[s.skin]);
    add(s.eyen === 2 || s.eyes === 'stalk' ? EN.eyes[s.eyes] : `${['', 'one', 'two', 'three', 'four'][s.eyen]} ${s.eyes === 'dot' ? 'small round eye' + (s.eyen > 1 ? 's' : '') : EN.eyes[s.eyes]}`);
    add(EN.nose[s.nose]); add(EN.mouthx[s.mouthx]); add(EN.ears[s.ears]); add(EN.top[s.top]); add(EN.face[s.face]); add(EN.tex[s.tex]);
    if (s.glasses !== 'none' && s.eyes === 'dot' && s.eyen === 2) add(s.glasses === 'round' ? 'small round wire glasses, each eye inside its own lens' : 'small rectangular glasses, each eye inside its own lens');
    add(EN.mark[s.mark]);
    return `One detainee seen from the waist up from the duty officer's window of an intergalactic militia station (a shabby Russian station lobby at night, 1994): ${EN.species[s.species]}, ${bits.join(', ')}, wearing ${EN.clothes[s.clothes].replace('{c}', EN.tone[s.tone] || EN.own[s.clothes] || '')}. The only saturated colour is one small ${EN.accent[s.accent]} accent (tie, scarf pattern or trim). ` +
      `State, acted with the whole upper body: ${EN.mood[s.mood]}. Ordinary, tired, deadpan; nothing cute, heroic or scary. Match the art style of the attached reference sheet exactly: thin, even, slightly wobbly dark-brown contour, ` +
      `flat muted earthy colours with one soft shadow tone, an oversized rounded head with small features in the centre of the face. No bars, no window frame, no text.`;
  }

  DZ.chargen = { OPTIONS, PARTS, SPECIES, KINDS, random, normalize, svg, prompt, W, H };
})(typeof window !== 'undefined' ? window : globalThis);
