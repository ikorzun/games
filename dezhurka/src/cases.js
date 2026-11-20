/* Дежурная часть — данные смены: семь задержанных одной ночи.
   Текста здесь нет: строки лежат в strings_<язык>.js под ключами dz.<id дела>.<id вещи>.*
   verdict: 'home' | 'cell'; grounds — основания, которые протокол примет (при verdict 'cell').
   Вид вещи (views[i]): act — подпись кнопки, которая к нему ведёт; art — рисунок; doc — показать текст как документ. */
(function (root) {
  const DZ = (root.DZ = root.DZ || {});

  DZ.GROUNDS = ['nodocs', 'stolen', 'wanted', 'weapon'];

  const passport = (extra) => Object.assign({
    id: 'passport', art: 'passport',
    views: [{ act: 'close' }, { act: 'open', doc: 'passport', photo: true }],
  }, extra || {});

  DZ.cases = [
    {
      id: 'c01', time: '00:10', verdict: 'home', grounds: [],
      look: { jaw: 'narrow', skin: '#cfa98a', shade: '#a67f66', hair: '#6a4e33', hairStyle: 'shaggy', glasses: 'round',
        brows: 'worried', mouth: 'neutral', clothes: 'denim' },
      items: [
        passport(),
        { id: 'student', art: 'student', views: [{ act: 'close' }, { act: 'open', doc: 'card', photo: true }] },
        { id: 'bag', art: 'bag', views: [{ act: 'close' }, { act: 'inside', art: 'bag_open' }] },
        { id: 'pass', art: 'pass', views: [{}] },
      ],
    },
    {
      id: 'c02', time: '00:55', verdict: 'cell', grounds: ['stolen'],
      look: { jaw: 'mid', skin: '#c2957a', shade: '#96705a', hair: '#3a2f27', hairStyle: 'cap', hat: '#34352f',
        stubble: true, brows: 'neutral', mouth: 'frown', wrinkles: true, clothes: 'vatnik' },
      items: [
        passport(),
        { id: 'radio', art: 'radio', views: [{ act: 'flip_back' }, { act: 'flip', art: 'radio_back' }] },
        { id: 'screwdriver', art: 'screwdriver', views: [{}] },
        { id: 'keys', art: 'keys', views: [{}] },
      ],
    },
    {
      id: 'c03', time: '01:40', verdict: 'home', grounds: [], gender: 'f',
      look: { jaw: 'mid', skin: '#d0ab92', shade: '#a8846e', hair: '#b9b6ad', hairStyle: 'kerchief', hat: '#7c3a3c',
        brows: 'worried', mouth: 'smile', wrinkles: true, clothes: 'oldcoat', scale: 0.92 },
      items: [
        { id: 'pension', art: 'pension', views: [{ act: 'close' }, { act: 'open', doc: 'card', photo: true }] },
        { id: 'seeds', art: 'seeds', views: [{}] },
        { id: 'coins', art: 'coins', views: [{}] },
        { id: 'ticket', art: 'ticket', views: [{ doc: 'slip' }] },
      ],
    },
    {
      id: 'c04', time: '02:25', verdict: 'home', grounds: [],
      look: { jaw: 'wide', skin: '#cda184', shade: '#a27a61', hair: '#8d8c85', hairStyle: 'balding', moustache: '#6f6d66',
        brows: 'neutral', mouth: 'flat', wrinkles: true, clothes: 'cook' },
      items: [
        passport(),
        { id: 'knives', art: 'knives', views: [{ act: 'roll' }, { act: 'unroll', art: 'knives_open' }] },
        { id: 'apron', art: 'apron', views: [{}] },
        { id: 'workpass', art: 'workpass', views: [{ doc: 'card', photo: true }] },
        { id: 'jar', art: 'jar', views: [{}] },
      ],
    },
    {
      id: 'c05', time: '03:05', verdict: 'cell', grounds: ['stolen'],
      look: { jaw: 'narrow', skin: '#d3ab90', shade: '#a9836b', hair: '#2f2a26', hairStyle: 'slick', glasses: 'rect',
        brows: 'raised', mouth: 'smirk', blush: true, lids: true, clothes: 'overcoat' },
      items: [
        passport(),
        { id: 'wallet', art: 'wallet', views: [{ act: 'close' }, { act: 'open', art: 'wallet_open' }] },
        { id: 'watch', art: 'watch', views: [{ act: 'flip_back' }, { act: 'flip', art: 'watch_back' }] },
        { id: 'coin', art: 'coin', views: [{}] },
      ],
    },
    {
      id: 'c06', time: '04:00', verdict: 'cell', grounds: ['wanted', 'nodocs'],
      look: { jaw: 'wide', skin: '#c3987b', shade: '#96705a', hair: '#27231f', hairStyle: 'crew', stubble: true,
        brows: 'angry', mouth: 'flat', scar: true, tattoo: true, clothes: 'leather' },
      items: [
        { id: 'ticket', art: 'ticket', views: [{ doc: 'slip' }] },
        { id: 'money', art: 'money', views: [{}] },
        { id: 'smokes', art: 'smokes', views: [{}] },
        { id: 'gloves', art: 'gloves', views: [{}] },
      ],
    },
    {
      id: 'c07', time: '04:55', verdict: 'cell', grounds: ['weapon'], bribe: 'passport',
      look: { jaw: 'wide', skin: '#d4a98b', shade: '#a9806a', hair: '#2b2521', hairStyle: 'short',
        brows: 'raised', mouth: 'smirk', clothes: 'blazer' },
      items: [
        passport({ bribe: true }),
        { id: 'pistol', art: 'pistol', views: [{}] },
        { id: 'card', art: 'card', views: [{ doc: 'slip' }] },
        { id: 'carkeys', art: 'carkeys', views: [{}] },
      ],
    },
  ];

  /* Оценка решения. decision: 'home' | 'cell'; ground — одно из DZ.GROUNDS (для 'cell'); bribe — купюра в кармане.
     Возвращает 'ok' | 'half' | 'bad'. Взятка превращает «верно» в «половину». */
  DZ.judge = function (c, decision, ground, bribe) {
    const guilty = c.verdict === 'cell';
    let grade;
    if (decision === 'home') grade = guilty ? 'bad' : 'ok';
    else if (!guilty) grade = 'bad';
    else grade = c.grounds.indexOf(ground) >= 0 ? 'ok' : 'half';
    if (bribe && grade === 'ok') grade = 'half';
    return grade;
  };

  /* Ключ пояснения к решению: самый точный из существующих. */
  DZ.feedbackKey = function (c, grade, ground, bribe, has) {
    const base = 'dz.' + c.id + '.fb.';
    const tries = [];
    if (bribe) tries.push(base + (grade === 'half' && c.grounds.indexOf(ground) >= 0 ? 'ok' : grade) + '.bribe');
    if (grade === 'ok' && ground) tries.push(base + 'ok.' + ground);
    tries.push(base + grade);
    for (const k of tries) if (has(k)) return k;
    return base + grade;
  };

  DZ.POINTS = { ok: 2, half: 1, bad: 0 };

  DZ.rating = function (results) {
    const max = results.length * DZ.POINTS.ok;
    const sum = results.reduce((s, r) => s + DZ.POINTS[r.grade], 0);
    const share = max ? sum / max : 0;
    if (share >= 1) return 'a';
    if (share >= 0.7) return 'b';
    if (share >= 0.45) return 'c';
    return 'd';
  };
})(typeof window !== 'undefined' ? window : globalThis);
