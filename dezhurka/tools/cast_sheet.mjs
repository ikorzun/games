// Картотека задержанных в выбранном стиле: кадры рисует генеративная модель по описаниям конструктора.
//   node tools/cast_sheet.mjs prompt img/cast/batch01.json img/cast/batch01.txt
//       — из девяти описаний (детали конструктора) собирает промпт листа 3×3; дальше tools/gpt_sheet.sh и tools/cut_grid.py
//   node tools/cast_sheet.mjs register
//       — по всем img/cast/batch*.json пересобирает src/cast.js (список готовых кадров для страницы и игры)
// Пакет — массив из девяти объектов: { "id": "c0101", "seed": 11, "species": "chert", …любые детали конструктора… }.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const box = { console }; box.window = box; box.globalThis = box; vm.createContext(box);
vm.runInContext(readFileSync(join(here, 'src/chargen.js'), 'utf8'), box);
const CG = box.DZ.chargen;
const [cmd, a, b] = process.argv.slice(2);

if (cmd === 'prompt') {
  const batch = JSON.parse(readFileSync(a, 'utf8'));
  if (batch.length !== 9) throw new Error('в пакете должно быть девять персонажей');
  const lines = batch.map((raw, i) => { const d = CG.describe(raw); return `${i + 1}) ${d.who}. State: ${d.state}.`; });
  writeFileSync(b, `CAST SHEET for a small video game, a continuation of the attached style sheets. Match the art style of the references exactly: thin, even, slightly wobbly dark-brown contour, flat colours with one soft shadow tone, oversized rounded heads with small features in the centre of the face, grounded cinematic lighting, fine film grain. The first reference shows the frame layout, the lobby and how people look; the second shows how aliens and folklore creatures look in this style.

The setting: the lobby of a shabby Russian militia station at night in 1994, which is an intergalactic duty station. The detainees are people, aliens and folklore creatures in ordinary shabby clothes of 1990s townsfolk. Nobody poses; nothing is cute, heroic or scary: the comedy is in how ordinary they look.

One landscape image: nine framed panels in a grid of three columns and three rows on a plain light warm-grey board with thin even margins, all panels exactly the same size, each panel landscape with proportions 3:2. Each panel is a game frame: one detainee seen from the waist up from the duty officer's window, centred, the head in the upper half of the panel, the same scale in every panel. The same fixed camera and the same background in all nine panels: a wall painted dull green below and whitewashed above, a brown wooden door on the right, a wooden bench with a slatted back against the wall on the left, a cast-iron radiator, a worn linoleum floor, sickly yellow-green light from one fluorescent tube above. No bars, no window frame and no sergeant.

The nine detainees, left to right, top to bottom. The state of each is acted with the whole upper body (head, shoulders, hands), so that it reads at a small size:
${lines.join('\n')}

PALETTE. Keep the muted, slightly dusty look of the references and the same lobby, but make the nine characters clearly different from each other in colour: follow the skin and clothing colours named in each description (dusty blue, mint, plum, coral, mustard, rust, teal, wine and so on are all muted, never neon). Each character has one small saturated accent. No two neighbouring panels have the same dominant colour.

DRAWING RULES (strict)
- Ordinary eyes are small round white circles with a single outline and a black dot pupil, set side by side; no line joins them and no line goes from an eye towards the ear, so they never read as spectacles. Above each eye there is a short thin eyebrow stroke. A character whose description names other eyes (big dark almond eyes, faceted eyes, lamp eyes, eyes on stalks) has only those eyes and no extra ordinary eyes.
- Glasses only where the description names them, each eye inside its own lens.
- Hands and paws are drawn clearly: every finger, claw or tentacle is a clear separate shape; people and human-like creatures have a thumb and four fingers.
- Exactly one character in each panel.

No text anywhere: no letters, no captions, no labels, no numbers, no logos, no watermark, no signature. All characters are original designs; do not depict any existing cartoon, film or game characters.
`);
  console.log('prompt →', b, `(${batch.map((x) => x.id).join(' ')})`);
} else if (cmd === 'register') {
  const dir = join(here, 'img/cast'), out = [];
  for (const f of readdirSync(dir).filter((x) => /^batch\d+\.json$/.test(x)).sort())
    for (const raw of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
      if (!existsSync(join(dir, raw.id + '.webp'))) continue;      // кадр не снят или отбракован при проверке
      out.push({ id: raw.id, img: `img/cast/${raw.id}.webp`, spec: CG.normalize(raw) });
    }
  writeFileSync(join(here, 'src/cast.js'), `/* Картотека: кадры задержанных в выбранном стиле, нарисованные генеративной моделью по описаниям конструктора.\n   Файл собирается командой node tools/cast_sheet.mjs register из img/cast/batch*.json; руками не править. */\n(function (root) {\n  const DZ = (root.DZ = root.DZ || {});\n  DZ.cast = [\n` +
    out.map((x) => `    { id: '${x.id}', img: '${x.img}', spec: ${JSON.stringify(x.spec)} },`).join('\n') + `\n  ];\n})(typeof window !== 'undefined' ? window : globalThis);\n`);
  console.log('src/cast.js:', out.length, 'кадров');
} else { console.error('команды: prompt <пакет.json> <промпт.txt> | register'); process.exit(1); }
