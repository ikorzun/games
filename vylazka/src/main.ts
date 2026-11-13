/** Точка входа: платформа → строки → приложение. game_ready уходит после первого кадра (app.init). */
import { App } from './app';
import { i18n } from './core/i18n';
import { installDebug } from './debug/debug';
import { createPlatform } from './platform';
import en from '../locales/en/ui.json';
import ru from '../locales/ru/ui.json';
import './ui/styles.css';

async function main(): Promise<void> {
  i18n.addStrings('ru', ru);
  i18n.addStrings('en', en);
  const root = document.getElementById('app');
  if (!root) throw new Error('нет #app');
  const platform = await createPlatform();
  const app = new App(root, platform, new URLSearchParams(location.search));
  installDebug(app);
  await app.init();
}

void main();
