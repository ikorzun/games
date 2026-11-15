// Ролик о сути игры: кадры для scripts/trailer.py. В сборку и CI не входит.
//   node e2e/trailer.mjs record [q] [seed]   — кадры ролика подряд (e2e/out/trailer) и marks.json с границами сцен
//   node e2e/trailer.mjs scout  [q] [seed]   — отдельные кадры с точек съёмки (e2e/out/scout): выбрать вещь и ракурсы
// Снимается собранная игра (dist/) в Chromium на программном WebGL, пошагово: кадр ролика — два шага
// симуляции (30 кадров в секунду); там, где время сжато, шагов на кадр больше. Сцены:
//   1–3. убежище, один дубль: темно → свет собирает комнату → игрок идёт к вещи → она рассыпается →
//        свет гаснет и зажигается → на её месте другая;
//   4.   офис: фонаря нет; игрок замер — панели гаснут, место осыпается; пошёл — собирается;
//   5.   жёлтые комнаты: свет гаснет, остаётся экран; на этих кадрах — название.
// Номер вещи (THING), экран (SCREEN) и координаты коридора привязаны к сиду и к обстановке уровня:
// после изменений генератора или мебели их надо выбрать заново (scout) — вещь должна возвращаться
// другим предметом, иначе подпись «not the same» будет неправдой.
import { join, resolve } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const ROOT = process.cwd();
const mode = process.argv[2] ?? 'record';
const q = process.argv[3] ?? 'high';
const seed = process.argv[4] ?? '20041113';
const env = (name, fallback) => Number(process.env[name] ?? fallback);
// Убежище: какую вещь трогаем (номер объекта из __vz.objects()) и с какого расстояния начинаем, м.
const THING = env('THING', 28);
const START = env('START', 3.3);
// Офис: прямой проход вдоль x на z = OFFICE_Z, у стены стоит экран; встаём в OFFICE_X лицом на +x.
const OFFICE_X = env('OFFICE_X', -7.5);
const OFFICE_Z = env('OFFICE_Z', 12);
// Жёлтые комнаты: номер экрана в __vz.flats(), сдвиг вбок от него (м) и поворот камеры от него (рад).
const SCREEN = env('SCREEN', 2);
const SIDE = env('SIDE', 0.9);
const TURN = env('TURN', -0.3);

const OUT = join(ROOT, 'e2e', 'out', mode === 'record' ? 'trailer' : 'scout');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const size = q === 'high' ? [1280, 720] : [960, 540];
const server = await preview({ configFile: false, root: ROOT, base: './', logLevel: 'error', build: { outDir: resolve(ROOT, 'dist') }, preview: { host: '127.0.0.1', port: 4248, strictPort: false, open: false } });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
});
const marks = {};
let n = 0;
const mark = (name) => { marks[name] = n; };
// Едва заметный поворот взгляда: датчики движения офиса не теряют игрока, пока место собирается.
const WIGGLE = { lookYaw: 0.0005 };

async function open(world) {
  const page = await (await browser.newContext({ viewport: { width: size[0], height: size[1] }, locale: 'en-US' })).newPage();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto(new URL(`?q=${q}&fail=0&seed=${seed}&rank=2&touch=0&world=${world}`, server.resolvedUrls.local[0]).toString());
  await page.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 180000 });
  const vz = (fn, arg) => page.evaluate(fn, arg);
  await vz(() => { window.__vz.start(); window.__vz.freeze(true); window.__vz.calm(true); });
  // От интерфейса остаётся только рамка камеры: значок записи, номер, время.
  await page.addStyleTag({ content: '.vz-hud__goals,.vz-hud__toast,.vz-hud__hint,.vz-hud__fps,.vz-hud__prompt,.vz-hud__mark,.vz-hud__bat,.vz-hud__act,.vz-hud__flash,.vz-hud__limbo{display:none!important}' });
  const settle = async (k = 20, input) => { for (let i = 0; i < k; i++) await vz((inp) => window.__vz.step(6, inp ?? undefined), input ?? null); };
  const frames = async (count, input, steps = 2) => {
    for (let i = 0; i < count; i++) {
      await vz(([inp, s]) => window.__vz.step(s, inp ?? undefined), [input ?? null, steps]);
      await page.screenshot({ path: join(OUT, `${String(n++).padStart(4, '0')}.png`), timeout: 120000 });
    }
  };
  const still = async (name) => { await vz(() => window.__vz.step(1)); await page.screenshot({ path: join(OUT, `${String(n++).padStart(3, '0')}_${world}_${name}.png`), timeout: 120000 }); };
  const light = async (on) => { const s = await vz(() => window.__vz.state()); if ((s.light.state === 'on') !== on) await vz(() => window.__vz.toggleLight()); };
  const obj = (id) => vz(([k]) => window.__vz.objects().find((o) => o.id === k), [id]);
  // Что стоит на месте объекта после возврата: вещи сна рядом с его прежним местом.
  const near = async (o) => (await vz(() => window.__vz.things())).filter((t) => Math.hypot(t.pos[0] - o.at[0], t.pos[2] - o.at[2]) < 1.5).map((t) => `${t.kind}:${t.state}`).join(', ') || '—';
  return { page, vz, settle, frames, still, light, obj, near };
}

// Встать напротив экрана: в `far` раз дальше точки съёмки, на той же линии взгляда.
const atScreen = (vz, far) => vz(([k, d, sd, tn]) => { window.__vz.gotoFlat(k, d, sd); window.__vz.look(tn, -0.06); }, [SCREEN, 3.4 * far, SIDE * far, TURN]);
// Идти к экрану по линии взгляда на него (камера повёрнута от экрана на TURN).
const TO_SCREEN = { moveX: -Math.sin(-TURN) * 0.45, moveZ: Math.cos(TURN) * 0.45 };

if (mode === 'scout') {
  // Убежище: каждая вещь из списка — до касания, после, без света, после возврата; в лог — чем вернулась.
  {
    const { page, vz, settle, still, light, obj, near } = await open('shelter');
    await settle(30);
    for (const id of (process.env.THINGS ?? String(THING)).split(',').map(Number)) {
      const o = await obj(id);
      if (!o) { console.log('нет объекта', id); continue; }
      await light(true);
      await vz(([k, d]) => { window.__vz.gotoObject(k, d); window.__vz.look(0, -0.08); }, [id, START]);
      await settle(40);
      await still(`${o.name}_a_before`);
      let steps = 0;
      for (; steps < 120; steps++) { await vz(() => window.__vz.step(2, { moveZ: 1 })); if ((await obj(id)).state !== 'here') break; }
      await still(`${o.name}_b_touch`);
      await vz(() => window.__vz.step(52, { moveZ: -1 }));
      await still(`${o.name}_c_gone`);
      await light(false);
      await vz(() => window.__vz.step(48));
      await still(`${o.name}_d_off`);
      await light(true);
      await vz(() => window.__vz.step(12));
      await still(`${o.name}_e_coming`);
      await settle(12);
      await still(`${o.name}_f_back`);
      console.log(`${o.name}#${id}: до касания ${steps * 2} шагов; после света — ${(await obj(id)).state}; на её месте: ${await near(o)}`);
    }
    await page.close();
  }
  // Офис: вид вдоль прохода, после остановки — кадры по мере того, как гаснут панели.
  {
    const { page, vz, settle, still } = await open('office');
    await vz(([px, pz]) => window.__vz.teleport(px, 0, pz, -Math.PI / 2, 0), [OFFICE_X, OFFICE_Z]);
    await settle(20, WIGGLE);
    await still('a_start');
    await vz(() => window.__vz.step(52, { moveZ: 1 }));
    await still('b_walked');
    await vz(() => window.__vz.step(170));
    for (let i = 0; i < 7; i++) { await vz(() => window.__vz.step(18)); const s = await vz(() => window.__vz.state()); await still(`c_still_${(s.stillFor ?? 0).toFixed(1)}s`); }
    await vz(() => window.__vz.step(16, { moveZ: 1 }));
    await still('d_moved');
    await page.close();
  }
  // Жёлтые комнаты: экран со светом, на подходе и без света.
  {
    const { page, vz, settle, still, light } = await open('yellow');
    const flats = await vz(() => window.__vz.flats());
    console.log('экраны:', JSON.stringify(flats.map((f, i) => [i, f.kind, f.what]).filter((f) => f[1] === 'screen')));
    await light(true);
    await atScreen(vz, 1.3);
    await settle(40);
    await still('a_far_lit');
    await vz(([inp]) => window.__vz.step(66, inp), [TO_SCREEN]);
    await still('b_near_lit');
    await light(false);
    for (const k of [40, 60, 100]) { await vz(([steps]) => window.__vz.step(steps), [k]); await still(`c_off_${k}`); }
    await page.close();
  }
} else {
  // ── 1–3. Убежище, один дубль ──
  {
    const { page, vz, settle, frames, light, obj, near } = await open('shelter');
    await settle(30);
    const o = await obj(THING);
    await vz(([k, d]) => { window.__vz.gotoObject(k, d); window.__vz.look(0, -0.08); }, [THING, START]);
    // Восемь секунд темноты: место успевает осыпаться, свет собирает его заново.
    await light(false);
    await settle(80);
    mark('dark');
    await frames(12);
    await light(true);
    mark('on');
    await frames(38);
    let walked = 0;
    for (; walked < 70; walked++) { await frames(1, { moveZ: 1 }); if ((await obj(THING)).state !== 'here') break; }
    mark('touch');
    await frames(26, { moveZ: -1 });
    await frames(12);
    mark('off');
    await light(false);
    await frames(24);
    await light(true);
    mark('back');
    await frames(50);
    console.log(`${o.name}#${THING}: до касания кадров ${walked}; после возврата — ${(await obj(THING)).state}; на её месте: ${await near(o)}`);
    await page.close();
  }
  // ── 4. Офис ──
  {
    const { page, vz, settle, frames } = await open('office');
    await vz(([px, pz]) => window.__vz.teleport(px, 0, pz, -Math.PI / 2, 0), [OFFICE_X, OFFICE_Z]);
    await settle(20, WIGGLE);
    mark('office');
    await frames(26, { moveZ: 1 });
    mark('still');
    // Ожидание сжато: 14 кадров по 12 шагов (2,8 с из 3,2 с, за которые датчики теряют неподвижного)…
    await frames(14, undefined, 12);
    mark('lost');
    // …дальше — в полтора раза быстрее жизни: панели гаснут, место осыпается.
    await frames(50, undefined, 3);
    mark('move');
    await frames(20, { moveZ: 1 });
    await page.close();
  }
  // ── 5. Жёлтые комнаты; последние кадры идут под название ──
  {
    const { page, vz, settle, frames, light } = await open('yellow');
    await light(true);
    await atScreen(vz, 1.3);
    await settle(40);
    mark('yellow');
    await frames(33, TO_SCREEN);
    await light(false);
    mark('yellow_off');
    await frames(44);
    mark('title');
    await frames(54);
    await page.close();
  }
  mark('end');
  writeFileSync(join(OUT, 'marks.json'), JSON.stringify(marks));
  console.log(JSON.stringify(marks));
}
await browser.close();
await server.close();
