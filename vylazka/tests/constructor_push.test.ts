import { describe, expect, it } from 'vitest';
import { failKind, isToken, parseRemote } from '../tools/constructor/push_lib.mjs';

// «Залить в игру» из окна программы (партнёр 18.11: «давай конструктор отдельной простой программой без этих плясок с
// терминалом»): по тексту git окно говорит, что делать — войти, проверить интернет или написать основной модели.
describe('конструктор: «Залить в игру»', () => {
  it('понимает, что нужен вход в GitHub', () => {
    expect(failKind("fatal: could not read Username for 'https://github.com': terminal prompts disabled")).toBe('auth');
    expect(failKind("remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/ikorzun/games.git/'")).toBe('auth');
    expect(failKind("remote: Permission to ikorzun/games.git denied to someone.\nfatal: unable to access 'https://github.com/ikorzun/games.git/': The requested URL returned error: 403")).toBe('auth');
  });
  it('отличает «на GitHub пришло новое» и «нет связи» от остального', () => {
    expect(failKind(' ! [rejected]        claude/x -> claude/x (fetch first)\nerror: failed to push some refs')).toBe('behind');
    expect(failKind(' ! [rejected]        claude/x -> claude/x (non-fast-forward)')).toBe('behind');
    expect(failKind("fatal: unable to access 'https://github.com/ikorzun/games.git/': Could not resolve host: github.com")).toBe('offline');
    expect(failKind("fatal: unable to access 'https://github.com/x/y.git/': Failed to connect to github.com port 443 after 75000 ms: Operation timed out")).toBe('offline');
    expect(failKind('error: Your local changes to the following files would be overwritten by merge')).toBe('other');
  });
  it('берёт хост и владельца из адреса origin; путь к папке — не адрес', () => {
    // Путь — ключ входа в связке ключей (credential.useHttpPath): вход только для этого репозитория.
    expect(parseRemote('https://github.com/ikorzun/games.git')).toEqual({ protocol: 'https', host: 'github.com', path: 'ikorzun/games.git', owner: 'ikorzun' });
    expect(parseRemote('https://someone@github.com/ikorzun/games/')).toEqual({ protocol: 'https', host: 'github.com', path: 'ikorzun/games', owner: 'ikorzun' });
    expect(parseRemote('http://127.0.0.1:5400/ikorzun/games.git')).toEqual({ protocol: 'http', host: '127.0.0.1:5400', path: 'ikorzun/games.git', owner: 'ikorzun' });
    expect(parseRemote('/tmp/remote.git')).toBeNull();
    expect(parseRemote('https://github.com/')).toBeNull();
  });
  it('токен узнаёт по виду, лишнее — нет', () => {
    expect(isToken(`ghp_${'a1B2'.repeat(9)}`)).toBe(true);
    expect(isToken(`  github_pat_${'Ab9_'.repeat(20)}  `)).toBe(true);
    expect(isToken('ghp_short')).toBe(false);
    expect(isToken('мой пароль')).toBe(false);
    expect(isToken(undefined)).toBe(false);
  });
});
