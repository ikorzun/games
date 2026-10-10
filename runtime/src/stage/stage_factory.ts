/**
 * Создание сцены: PixiJS (лениво, отдельным чанком) → если WebGL недоступен или параметр
 * ?renderer=dom — DOM-рендерер. Игра остаётся играбельной в обоих случаях.
 */
import { DomSceneRenderer } from './renderer_dom';
import { Stage } from './stage';

export type RendererChoice = 'auto' | 'pixi' | 'dom';

export async function createStage(parent: HTMLElement, choice: RendererChoice = 'auto'): Promise<Stage> {
  if (choice !== 'dom') {
    let stage: Stage | null = null;
    try {
      const { PixiSceneRenderer } = await import('./renderer_pixi');
      stage = new Stage(new PixiSceneRenderer());
      await stage.mount(parent);
      return stage;
    } catch (e) {
      console.warn('[stage] PixiJS/WebGL недоступен, переходим на DOM-рендерер:', e);
      stage?.destroy();
      if (choice === 'pixi') throw e;
    }
  }
  const fallback = new Stage(new DomSceneRenderer());
  await fallback.mount(parent);
  return fallback;
}
