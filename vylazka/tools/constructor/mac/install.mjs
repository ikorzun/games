// Ставит программу «Конструктор» на Mac (партнёр 18.11: «давай конструктор отдельной простой программой без этих плясок с
// терминалом»): npm run constructor:app — один раз. Дальше программа открывается, как любая другая, и обновляется сама
// (app.mjs при каждом запуске забирает свежее с GitHub и, если оболочка устарела, пересобирает её этим же файлом).
//
// Оболочка — main.swift: собирается компилятором Swift из инструментов разработчика (они ставятся вместе с git). Нет
// компилятора или сборка не вышла — ставится запасная программа: открывает тот же конструктор в окне браузера.
// Программа кладётся рядом с папкой проекта (у партнёра — ~/Desktop/Claude), не в карантине (собрана на этом же Mac),
// подписана «для этого компьютера» (codesign -s -).
//
//   npm run constructor:app                  — поставить и открыть
//   npm run constructor:app -- --to <папка>  — поставить в другую папку
//   --no-open — не открывать; --browser — сразу запасную; --dry-run — только собрать файлы (проверка не на Mac)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
/** Версия оболочки: поменялся main.swift — увеличить, и app.mjs пересоберёт программу у партнёра сам. */
export const SHELL_VERSION = 1;
export const APP_NAME = 'Конструктор';
const BUNDLE_ID = 'local.untitled-session.constructor';

/** Куда ставить по умолчанию: рядом с папкой проекта (репозиторий — на уровень выше vylazka). */
export const defaultDir = () => dirname(resolve(ROOT, '..'));

/** Какой node записать в программу: устойчивую ссылку Homebrew или nodejs.org, если она ведёт на этот же node. */
function stableNode() {
  const real = realpathSync(process.execPath);
  for (const link of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    try {
      if (realpathSync(link) === real) return link;
    } catch {
      // нет такой ссылки
    }
  }
  return process.execPath;
}

const swiftString = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const appleString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function plist(executable) {
  const entries = {
    CFBundleName: APP_NAME,
    CFBundleDisplayName: APP_NAME,
    CFBundleIdentifier: BUNDLE_ID,
    CFBundleExecutable: executable,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: `1.${SHELL_VERSION}`,
    CFBundleVersion: String(SHELL_VERSION),
    CFBundleIconFile: 'AppIcon',
    LSMinimumSystemVersion: '11.0',
    LSApplicationCategoryType: 'public.app-category.developer-tools',
    NSPrincipalClass: 'NSApplication',
    // Программа русская: системные пункты меню (диктовка, эмодзи, «Во весь экран», окно «О программе») — тоже по-русски,
    // на каком бы языке ни был Mac, а не вперемешку с английскими.
    CFBundleDevelopmentRegion: 'ru',
    CFBundleLocalizations: ['ru'],
  };
  const value = (v) => (Array.isArray(v) ? `<array>${v.map((x) => `<string>${xml(x)}</string>`).join('')}</array>` : `<string>${xml(v)}</string>`);
  const body = Object.entries(entries)
    .map(([k, v]) => `  <key>${k}</key>${value(v)}`)
    .join('\n');
  // Страница конструктора — с этого же компьютера (http://127.0.0.1): разрешить это окну.
  const ats = '  <key>NSHighResolutionCapable</key><true/>\n  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n${body}\n${ats}\n</dict></plist>\n`;
}

/** Исходник оболочки с путями этого Mac. */
export function shellSource(node = stableNode()) {
  return readFileSync(join(HERE, 'main.swift'), 'utf8')
    .replace('__ROOT__', swiftString(ROOT))
    .replace('__NODE__', swiftString(node))
    .replace('__SHELL_VERSION__', String(SHELL_VERSION));
}

/** Собрать оболочку компилятором Swift. Ответ: путь к исполняемому файлу или текст ошибки. */
function compile(work, dry) {
  const src = join(work, 'main.swift');
  writeFileSync(src, shellSource());
  const out = join(work, 'constructor');
  if (dry) {
    writeFileSync(out, '#!/bin/sh\necho "dry run"\n', { mode: 0o755 });
    return { ok: true, out };
  }
  try {
    execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' });
  } catch {
    return { ok: false, why: 'нет компилятора Swift (инструменты разработчика: xcode-select --install)' };
  }
  try {
    execFileSync('xcrun', ['swiftc', '-O', '-swift-version', '5', '-o', out, src], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
    return { ok: true, out };
  } catch (e) {
    const text = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || String(e.message);
    const logFile = join(ROOT, 'tools/constructor/work/app-build.log');
    writeFileSync(logFile, text);
    return { ok: false, why: `сборка не вышла (подробности — ${logFile})` };
  }
}

/** Подписать «для этого компьютера»: без подписи новые Mac не запускают программу. */
function sign(app, dry) {
  if (dry) return;
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
  } catch {
    // уже подписана компилятором — запустится и так
  }
}

/** Запасная программа: открывает конструктор в браузере (app.mjs --browser). */
function applet(target, dry) {
  const node = stableNode();
  const cmd = `cd ${sh(ROOT)} && PATH=${sh(dirname(node))}:/usr/bin:/bin:/usr/sbin:/sbin nohup ${sh(node)} tools/constructor/app.mjs --browser >/dev/null 2>&1 &`;
  if (dry) {
    mkdirSync(join(target, 'Contents/Resources'), { recursive: true });
    writeFileSync(join(target, 'Contents/Resources/script.txt'), `do shell script ${appleString(cmd)}\n`);
    return;
  }
  execFileSync('osacompile', ['-o', target, '-e', `do shell script ${appleString(cmd)}`], { stdio: 'ignore' });
  copyFileSync(join(HERE, 'AppIcon.icns'), join(target, 'Contents/Resources/applet.icns'));
}

/**
 * Поставить программу в папку dir. Сначала — во временную папку рядом, потом подменить старую целиком.
 * Ответ: { ok, app, kind: 'window' | 'browser', why? }.
 */
export async function buildApp({ dir = defaultDir(), name = APP_NAME, browser = false, onlyWindow = false, dry = false } = {}) {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${name}.app`);
  const work = mkdtempSync(join(dir, '.constructor-build-'));
  try {
    const app = join(work, `${APP_NAME}.app`);
    let kind = 'browser';
    let why = '';
    if (!browser) {
      const built = compile(work, dry);
      if (built.ok) {
        mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
        mkdirSync(join(app, 'Contents/Resources'), { recursive: true });
        renameSync(built.out, join(app, 'Contents/MacOS/constructor'));
        writeFileSync(join(app, 'Contents/Info.plist'), plist('constructor'));
        writeFileSync(join(app, 'Contents/PkgInfo'), 'APPL????');
        copyFileSync(join(HERE, 'AppIcon.icns'), join(app, 'Contents/Resources/AppIcon.icns'));
        mkdirSync(join(app, 'Contents/Resources/ru.lproj'), { recursive: true });
        writeFileSync(join(app, 'Contents/Resources/ru.lproj/InfoPlist.strings'), `"CFBundleName" = "${APP_NAME}";\n"CFBundleDisplayName" = "${APP_NAME}";\n`);
        kind = 'window';
      } else why = built.why;
    }
    // Пересборка работающей программы: не вышло своё окно — оставить ту, что есть, а не менять её на запасную.
    if (kind === 'browser' && onlyWindow) return { ok: false, app: target, kind, why };
    if (kind === 'browser') applet(app, dry);
    sign(app, dry);
    rmSync(target, { recursive: true, force: true });
    renameSync(app, target);
    return { ok: true, app: target, kind, why };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Пересобрать программу на месте (её путь знает оболочка): новая оболочка заработает со следующего запуска. */
export function refreshApp(bundle) {
  return buildApp({ dir: dirname(bundle), name: basename(bundle, '.app'), onlyWindow: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const dry = args.includes('--dry-run');
  if (process.platform !== 'darwin' && !dry) {
    console.error('[программа] собирается только на Mac.');
    process.exit(1);
  }
  const dir = resolve(opt('--to') ?? defaultDir());
  console.log('[программа] Собираю «Конструктор» — это до минуты…');
  const r = await buildApp({ dir, browser: args.includes('--browser'), dry });
  if (r.kind === 'window') {
    console.log(`[программа] Готово: «${APP_NAME}» лежит в ${dir}.`);
    console.log('[программа] Перетащи её в Dock. Терминал больше не нужен: свежее она забирает сама, «Залить в игру» — кнопка в окне.');
    console.log('[программа] Спросит Mac про доступ к папке «Рабочий стол» — «Разрешить»: проект лежит там.');
  } else {
    console.log(r.why ? `[программа] Своё окно собрать не вышло: ${r.why}.` : '[программа] Запасная — как просили (--browser).');
    console.log(`[программа] Поставил запасную «${APP_NAME}» в ${dir}: она открывает конструктор в браузере. Пришли это основной модели.`);
  }
  if (!dry && !args.includes('--no-open') && existsSync(r.app)) {
    execFileSync('open', ['-R', r.app]);
    execFileSync('open', [r.app]);
  }
}
