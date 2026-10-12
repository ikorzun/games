/** Настройки «Эффекты камеры» (cameraFx) и «Озвучка» (voiceEnabled, voice): умолчание, очистка сохранённого значения, сохранение. */
import { describe, expect, it } from 'vitest';
import { SaveManager } from '../src/core/saves';
import { CAMERA_FX_LEVELS, DEFAULT_SETTINGS, sanitizeSettings } from '../src/core/settings';
import { MemoryStorage } from './helpers/fakes';

describe('settings.cameraFx: выкл / слабо / сильно', () => {
  it('уровни и умолчание: слабо', () => {
    expect([...CAMERA_FX_LEVELS]).toEqual(['off', 'low', 'high']);
    expect(DEFAULT_SETTINGS.cameraFx).toBe('low');
    expect(sanitizeSettings(null).cameraFx).toBe('low');
    expect(sanitizeSettings({}).cameraFx).toBe('low');
  });

  it('допустимые значения сохраняются как есть', () => {
    for (const level of CAMERA_FX_LEVELS) expect(sanitizeSettings({ cameraFx: level }).cameraFx).toBe(level);
  });

  it('неизвестное, не строка и «почти правильное» значение — к умолчанию (старые сейвы без поля тоже)', () => {
    for (const bad of ['max', 'LOW', 'Off', '', ' high', 1, true, null, undefined, {}, [], 'high '] as unknown[]) {
      expect(sanitizeSettings({ cameraFx: bad }).cameraFx, String(bad)).toBe('low');
    }
    // сейв, записанный до появления настройки: остальные поля читаются, камера — по умолчанию
    const old = sanitizeSettings({ v: 1, fontScale: 1.3, lang: 'es' });
    expect(old).toMatchObject({ fontScale: 1.3, lang: 'es', cameraFx: 'low' });
  });

  it('очистка не трогает остальные настройки и не добавляет лишних полей', () => {
    const s = sanitizeSettings({ cameraFx: 'off', timers: false, storyOnly: true });
    expect(s).toMatchObject({ cameraFx: 'off', timers: false, storyOnly: true });
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('SaveManager: updateSettings применяет те же правила, пишет в ключ settings и переживает перезапуск', async () => {
    const st = new MemoryStorage();
    const sm = new SaveManager(st, { slots: 0, debounceMs: 0 });
    await sm.init();
    expect(sm.settings.cameraFx).toBe('low');
    expect(sm.updateSettings({ cameraFx: 'high' }).cameraFx).toBe('high');
    // мусорное значение через патч очищается так же, как при чтении
    expect(sm.updateSettings({ cameraFx: 'ultra' as never }).cameraFx).toBe('low');
    sm.updateSettings({ cameraFx: 'off' });
    await sm.flush();
    expect((st.data.get('settings') as { cameraFx: string }).cameraFx).toBe('off');
    const again = new SaveManager(st, { slots: 0, debounceMs: 0 });
    await again.init();
    expect(again.settings.cameraFx).toBe('off');
  });
});

describe('settings: озвучка реплик (voiceEnabled + voice)', () => {
  it('по умолчанию включена, громкость 0,9; хранится в том же ключе settings, что и остальное', () => {
    expect(DEFAULT_SETTINGS.voiceEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.voice).toBe(0.9);
    expect(sanitizeSettings(null)).toMatchObject({ voiceEnabled: true, voice: 0.9 });
    expect(sanitizeSettings({})).toMatchObject({ voiceEnabled: true, voice: 0.9 });
  });

  it('громкость зажимается в 0–1, мусор — к умолчанию; флажок принимает только настоящее true / false', () => {
    expect(sanitizeSettings({ voice: 0.35 }).voice).toBe(0.35);
    expect(sanitizeSettings({ voice: 0 }).voice).toBe(0);
    expect(sanitizeSettings({ voice: 7 }).voice).toBe(1);
    expect(sanitizeSettings({ voice: -2 }).voice).toBe(0);
    for (const bad of ['loud', null, undefined, NaN, {}, [], true]) expect(sanitizeSettings({ voice: bad }).voice, String(bad)).toBe(0.9);
    expect(sanitizeSettings({ voiceEnabled: false }).voiceEnabled).toBe(false);
    expect(sanitizeSettings({ voiceEnabled: true }).voiceEnabled).toBe(true);
    for (const bad of [0, 1, 'false', 'no', null, undefined, {}, []]) expect(sanitizeSettings({ voiceEnabled: bad }).voiceEnabled, String(bad)).toBe(true);
  });

  it('сейв настроек из прежней версии (без voiceEnabled, громкость озвучки 1) читается: озвучка включена, прежняя громкость сохранена', () => {
    const old = sanitizeSettings({ v: 1, fontScale: 1.3, voice: 1, music: 0.2 });
    expect(old).toMatchObject({ voiceEnabled: true, voice: 1, music: 0.2, fontScale: 1.3 });
    expect(Object.keys(old).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('SaveManager: переключатель и громкость записываются, чистятся теми же правилами и переживают перезапуск', async () => {
    const st = new MemoryStorage();
    const sm = new SaveManager(st, { slots: 0, debounceMs: 0 });
    await sm.init();
    expect(sm.settings).toMatchObject({ voiceEnabled: true, voice: 0.9 });
    sm.updateSettings({ voiceEnabled: false, voice: 0.4 });
    expect(sm.updateSettings({ voice: 5 }).voice).toBe(1);
    expect(sm.updateSettings({ voiceEnabled: 'yes' as never }).voiceEnabled).toBe(true); // мусор → умолчание
    sm.updateSettings({ voiceEnabled: false, voice: 0.4 });
    await sm.flush();
    expect(st.data.get('settings')).toMatchObject({ voiceEnabled: false, voice: 0.4 });
    const again = new SaveManager(st, { slots: 0, debounceMs: 0 });
    await again.init();
    expect(again.settings).toMatchObject({ voiceEnabled: false, voice: 0.4 });
  });
});
