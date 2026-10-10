/** Настройка «Эффекты камеры» (settings.cameraFx): умолчание, очистка сохранённого значения, сохранение. */
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
