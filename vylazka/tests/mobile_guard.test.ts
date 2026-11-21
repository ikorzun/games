import { describe, expect, it } from 'vitest';
import { EDGE_GUARD, guardTouch, nearEdge, playThroughSilentSwitch, ScreenAwake } from '../src/platform/mobile_guard';

/** Документ-заглушка: запоминает слушателей и даёт их вызвать. */
function fakeDoc(): { doc: Document; fire: (type: string, e: object) => void; count: () => number } {
  const ls = new Map<string, Set<(e: unknown) => void>>();
  const doc = {
    addEventListener: (type: string, fn: (e: unknown) => void, opts?: AddEventListenerOptions) => {
      expect(opts?.passive).toBe(false);
      if (!ls.has(type)) ls.set(type, new Set());
      ls.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => ls.get(type)?.delete(fn),
  } as unknown as Document;
  return {
    doc,
    fire: (type, e) => ls.get(type)?.forEach((fn) => fn(e)),
    count: () => [...ls.values()].reduce((n, s) => n + s.size, 0),
  };
}

function touch(x: number, target: unknown = { closest: () => null }): { e: object; prevented: () => boolean } {
  let prevented = false;
  const e = { cancelable: true, target, changedTouches: [{ clientX: x }], preventDefault: () => (prevented = true) };
  return { e, prevented: () => prevented };
}

describe('телефон: обвязка браузера (исследование mobile_controls.md; слова партнёра 17.11)', () => {
  it('край экрана — полоса шириной EDGE_GUARD слева и справа', () => {
    expect(nearEdge(3, 400)).toBe(true);
    expect(nearEdge(EDGE_GUARD - 1, 400)).toBe(true);
    expect(nearEdge(200, 400)).toBe(false);
    expect(nearEdge(400 - EDGE_GUARD + 1, 400)).toBe(true);
  });

  it('касание у края не отдаётся браузеру (свайп «назад» на iPhone), в середине — отдаётся; щипок гасится', () => {
    const f = fakeDoc();
    const off = guardTouch(f.doc, () => 400);
    const edge = touch(6);
    f.fire('touchstart', edge.e);
    expect(edge.prevented()).toBe(true);
    const mid = touch(200);
    f.fire('touchstart', mid.e);
    expect(mid.prevented()).toBe(false);
    const right = touch(395);
    f.fire('touchstart', right.e);
    expect(right.prevented()).toBe(true);
    let pinch = false;
    f.fire('gesturestart', { cancelable: true, preventDefault: () => (pinch = true) });
    expect(pinch).toBe(true);
    off();
    expect(f.count()).toBe(0);
  });

  it('у кнопки касание не трогаем, даже у края: иначе пропадёт нажатие (пауза стоит у левого края)', () => {
    const f = fakeDoc();
    guardTouch(f.doc, () => 400);
    const onButton = touch(14, { closest: (sel: string) => (sel.includes('button') ? {} : null) });
    f.fire('touchstart', onButton.e);
    expect(onButton.prevented()).toBe(false);
  });

  it('звук сквозь беззвучный режим: сессия «playback», где она есть; где нет — ничего не ломается', () => {
    const session = { type: 'auto' };
    expect(playThroughSilentSwitch({ audioSession: session } as unknown as Navigator)).toBe(true);
    expect(session.type).toBe('playback');
    expect(playThroughSilentSwitch({} as Navigator)).toBe(false);
    const broken = {
      get type(): string {
        return 'auto';
      },
      set type(_v: string) {
        throw new Error('нельзя');
      },
    };
    expect(playThroughSilentSwitch({ audioSession: broken } as unknown as Navigator)).toBe(false);
  });

  it('экран не гаснет, пока идёт игра: один запрос, отпускание на паузе, повтор после фона', async () => {
    let requests = 0;
    let releases = 0;
    const sentinels: { released: boolean; release: () => Promise<void> }[] = [];
    const api = {
      request: () => {
        requests += 1;
        const s = { released: false, release: async () => void ((s.released = true), (releases += 1)) };
        sentinels.push(s);
        return Promise.resolve(s);
      },
    };
    const awake = new ScreenAwake(api, () => true);
    awake.want(true);
    awake.want(true);
    await Promise.resolve();
    expect(requests).toBe(1);
    expect(awake.held).toBe(true);
    awake.want(true);
    expect(requests).toBe(1);
    // Пауза — отпустили.
    awake.want(false);
    await Promise.resolve();
    expect(releases).toBe(1);
    expect(awake.held).toBe(false);
    // Снова игра, потом браузер сам отпустил замок в фоне; вкладка видна — берём заново.
    awake.want(true);
    await Promise.resolve();
    expect(requests).toBe(2);
    sentinels.at(-1)!.released = true;
    awake.visible();
    await Promise.resolve();
    expect(requests).toBe(3);
  });

  it('отказ на видимой странице — больше не просим; в фоне отказ законный — попросим потом', async () => {
    let visible = true;
    let requests = 0;
    const api = {
      request: () => {
        requests += 1;
        return Promise.reject(new Error('NotAllowedError'));
      },
    };
    const hidden = new ScreenAwake(api, () => visible);
    visible = false;
    hidden.want(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(hidden.denied).toBe(false);
    visible = true;
    hidden.visible();
    await Promise.resolve();
    await Promise.resolve();
    expect(hidden.denied).toBe(true);
    const before = requests;
    hidden.want(false);
    hidden.want(true);
    hidden.visible();
    expect(requests).toBe(before);
    // Нет API вовсе (старый браузер, iframe без разрешения) — тихо ничего.
    const none = new ScreenAwake(null, () => true);
    none.want(true);
    expect(none.held).toBe(false);
  });
});
