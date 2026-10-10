/** Выбор платформы по наличию `window.bridge` (Playgama Bridge SDK). */
import { PlaygamaPlatform } from './playgama';
import type { BridgeLike } from './playgama';
import type { IPlatform } from './types';
import { WebPlainPlatform } from './web_plain';

export type { IPlatform, PlatformCapabilities, TrackData } from './types';
export { PlaygamaPlatform } from './playgama';
export type { BridgeLike } from './playgama';
export { WebPlainPlatform } from './web_plain';

export async function createPlatform(scope: { bridge?: BridgeLike } = globalThis as { bridge?: BridgeLike }): Promise<IPlatform> {
  const bridge = scope.bridge;
  if (bridge) {
    try {
      return await PlaygamaPlatform.create(bridge);
    } catch (e) {
      console.warn('[platform] Playgama Bridge не инициализировался, работаем как web-plain:', e);
    }
  }
  return new WebPlainPlatform();
}
