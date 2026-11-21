/**
 * Версия сборки: версия пакета и время сборки по UTC (vite.config.ts, `__VZ_BUILD__`), например
 * `0.1.0+20261117.1452`; без сборки (тесты, отладка) — `dev`. Уходит в аналитику площадки: по ней
 * сводки производительности и события сравниваются от версии к версии.
 */
declare const __VZ_BUILD__: string | undefined;

export const BUILD_VERSION: string = typeof __VZ_BUILD__ === 'string' && __VZ_BUILD__ !== '' ? __VZ_BUILD__ : 'dev';
