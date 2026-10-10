/**
 * Встроенные строки интерфейса, которых ещё нет в locales/<lang>/ui.json.
 *
 * Рантайм не владеет файлами локалей (они лежат вне runtime/), поэтому новые подписи, добавленные
 * вместе с кодом, живут здесь — в слое «ниже» файлов (I18n.addDefaults): как только такой ключ
 * появится в ui.json, он главнее. Правило: ключ `ui.*`, все четыре языка, одинаковый набор ключей
 * (проверяет tests/i18n.test.ts). Чтобы перенести строки в локали — добавьте их в ui.json всех
 * языков и удалите отсюда.
 *
 * Перевод es/pt — рабочий вариант для проверки переводчиком (CLAUDE.md: перевод — отдельный этап).
 */
import { LANGS } from './types';
import type { Lang } from './types';
import type { I18n } from './i18n';

export const BUILTIN_UI: Readonly<Record<Lang, Readonly<Record<string, string>>>> = {
  ru: {
    'ui.settings.camera_fx': 'Эффекты камеры',
    'ui.settings.camera_fx_off': 'Выкл.',
    'ui.settings.camera_fx_low': 'Слабо',
    'ui.settings.camera_fx_high': 'Сильно',
  },
  en: {
    'ui.settings.camera_fx': 'Camera effects',
    'ui.settings.camera_fx_off': 'Off',
    'ui.settings.camera_fx_low': 'Subtle',
    'ui.settings.camera_fx_high': 'Strong',
  },
  es: {
    'ui.settings.camera_fx': 'Efectos de cámara',
    'ui.settings.camera_fx_off': 'Desactivados',
    'ui.settings.camera_fx_low': 'Suaves',
    'ui.settings.camera_fx_high': 'Intensos',
  },
  pt: {
    'ui.settings.camera_fx': 'Efeitos de câmera',
    'ui.settings.camera_fx_off': 'Desligados',
    'ui.settings.camera_fx_low': 'Suaves',
    'ui.settings.camera_fx_high': 'Intensos',
  },
};

/** Подключить встроенные строки всех языков (вызывается один раз при старте). */
export function installBuiltinStrings(i18n: Pick<I18n, 'addDefaults'>): void {
  for (const lang of LANGS) i18n.addDefaults(lang, BUILTIN_UI[lang]);
}
