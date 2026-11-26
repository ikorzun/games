#!/usr/bin/env node
/**
 * Привести сгенерированные клипы к виду, в котором их берёт игра, и положить в public/audio/.
 *
 *   node scripts/audio_import.mjs <папка с исходниками> [--only id,id] [--partial] [--dry]
 *
 * Исходники называются как в манифесте: <id>_<n>.<mp3|wav|ogg|m4a|flac>, n от 1 до variants.
 * Что делается с каждым (нужен ffmpeg):
 *   - тишина в начале обрезается (у петель — и в конце: стык петли делает игра);
 *   - разовый звук обрезается до длины из манифеста с запасом 0,4 с и получает короткий спад в конце;
 *   - пик приводится к −2 дБ: баланс между звуками задаёт поле volume манифеста, а не громкость файла;
 *   - клипы сводятся в моно, музыка остаётся стерео; 44,1 кГц, mp3 96 кбит/с (музыка — 128).
 * Без --partial отсутствие любого исходника — ошибка: игра с половиной звуков не собирается.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'audio');
const EXTS = ['wav', 'flac', 'mp3', 'ogg', 'm4a'];
const PEAK_DB = -2;

const argv = process.argv.slice(2);
const srcDir = argv.find((a) => !a.startsWith('--'));
const flag = (name) => argv.includes(`--${name}`);
const only = (() => {
  const i = argv.indexOf('--only');
  return i >= 0 && argv[i + 1] ? new Set(argv[i + 1].split(',').map((s) => s.trim())) : null;
})();

if (!srcDir || !existsSync(srcDir)) {
  console.error('Использование: node scripts/audio_import.mjs <папка с исходниками> [--only id,id] [--partial] [--dry]');
  process.exit(2);
}
if (spawnSync('ffmpeg', ['-version']).status !== 0) {
  console.error('Нужен ffmpeg в PATH.');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'audio', 'manifest.json'), 'utf8'));
const have = new Set(readdirSync(srcDir));
const source = (name) => EXTS.map((e) => `${name}.${e}`).find((f) => have.has(f));

/** Запустить ffmpeg и вернуть его stderr (туда он пишет и отчёты фильтров). */
function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr.split('\n').slice(-6).join('\n'));
  return r.stderr;
}

const seconds = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());

let done = 0;
const missing = [];
const notes = [];
if (!flag('dry')) mkdirSync(OUT, { recursive: true });

for (const s of manifest.sounds) {
  if (only && !only.has(s.id)) continue;
  for (let v = 1; v <= s.variants; v++) {
    const name = `${s.id}_${v}`;
    const src = source(name);
    if (!src) {
      missing.push(name);
      continue;
    }
    const input = join(srcDir, src);
    // Тишина по краям: у разовых — только в начале (хвост обрежет длина), у петель — с обеих сторон.
    const trim = s.loop
      ? 'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.01,areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.01,areverse'
      : 'silenceremove=start_periods=1:start_threshold=-50dB';
    const cap = s.loop ? '' : `,atrim=0:${(s.seconds + 0.4).toFixed(2)}`;
    const shape = `${trim}${cap}`;
    // Первый проход: длина после обрезки и пик.
    const probe = ffmpeg(['-i', input, '-af', `${shape},volumedetect`, '-f', 'null', '-']);
    const peak = Number(/max_volume:\s*(-?[\d.]+) dB/.exec(probe)?.[1] ?? 'NaN');
    const timeMatch = [...probe.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
    const length = timeMatch ? Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]) : NaN;
    if (!Number.isFinite(peak) || !Number.isFinite(length) || length < 0.05) {
      notes.push(`${name}: пустой или тихий исходник (пик ${peak} дБ, длина ${length} с) — пропущен`);
      missing.push(name);
      continue;
    }
    const gain = Math.min(24, PEAK_DB - peak);
    const fade = s.loop ? '' : `,afade=t=out:st=${Math.max(0, length - 0.04).toFixed(3)}:d=0.04`;
    const music = s.bus === 'music';
    const out = join(OUT, `${name}.mp3`);
    if (!flag('dry')) {
      ffmpeg(['-i', input, '-af', `${shape},volume=${gain.toFixed(2)}dB${fade}`, '-ac', music ? '2' : '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', music ? '128k' : '96k', '-map_metadata', '-1', out]);
    }
    const outLen = flag('dry') ? length : seconds(out);
    const size = flag('dry') ? 0 : statSync(out).size;
    console.log(`  ${name.padEnd(18)} ${outLen.toFixed(2).padStart(6)} с  усиление ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} дБ  ${(size / 1024).toFixed(0).padStart(4)} КБ`);
    // Петля заметно короче задуманного будет слышна как повтор; разовый звук короче — не беда.
    if (s.loop && outLen < s.seconds * 0.6) notes.push(`${name}: петля ${outLen.toFixed(1)} с вместо ~${s.seconds} с — повтор будет заметен`);
    if (gain > 18) notes.push(`${name}: исходник очень тихий (усиление +${gain.toFixed(0)} дБ) — поднимется и шум`);
    done += 1;
  }
}

for (const n of notes) console.warn(`[audio_import] ЗАМЕЧАНИЕ: ${n}`);
console.log(`[audio_import] готово файлов: ${done}${flag('dry') ? ' (пробный прогон, ничего не записано)' : ` → ${OUT}`}`);
if (missing.length > 0) {
  const msg = `нет исходников: ${missing.length} (${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''})`;
  if (flag('partial') || only) console.warn(`[audio_import] ${msg}`);
  else {
    console.error(`[audio_import] ОШИБКА: ${msg}`);
    process.exit(1);
  }
}
