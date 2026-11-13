import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Lifecycle } from '../src/lifecycle';
import { DesktopInput, LOCK_QUIET_MS } from '../src/player/input_desktop';
import { ShakeMeter } from '../src/player/shake';

/** Источник событий вместо document, window и элемента игры: в тестах браузера нет. */
class FakeTarget {
  private readonly handlers = new Map<string, Set<(e: unknown) => void>>();

  addEventListener(type: string, fn: (e: unknown) => void): void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
  }

  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.handlers.get(type)?.delete(fn);
  }

  emit(type: string, e: object = {}): void {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn(e);
  }

  get listeners(): number {
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    return n;
  }
}

class FakeDocument extends FakeTarget {
  pointerLockElement: unknown = null;

  exitPointerLock(): void {
    this.pointerLockElement = null;
  }
}

/** Элемент игры: захват мыши либо удаётся, либо (песочница iframe) отклоняется. */
class FakeElement extends FakeTarget {
  lockAllowed = true;
  requests = 0;

  constructor(private readonly doc: FakeDocument) {
    super();
  }

  requestPointerLock(): Promise<void> {
    this.requests += 1;
    if (!this.lockAllowed) return Promise.reject(new Error('sandboxed'));
    this.doc.pointerLockElement = this;
    return Promise.resolve();
  }
}

let doc: FakeDocument;
let win: FakeTarget;
let el: FakeElement;
let shake: ShakeMeter;
let life: Lifecycle;
let input: DesktopInput;

const move = (ts: number, dx: number, dy = 0): void => doc.emit('mousemove', { timeStamp: ts, movementX: dx, movementY: dy });

/** Клик по игре: захват мыши и событие о нём в момент ts (часы Event.timeStamp). */
function lockAt(ts: number): void {
  el.emit('mousedown', { timeStamp: ts });
  win.emit('mouseup', { timeStamp: ts });
  doc.emit('pointerlockchange', { timeStamp: ts });
}

beforeEach(() => {
  doc = new FakeDocument();
  win = new FakeTarget();
  el = new FakeElement(doc);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  shake = new ShakeMeter();
  life = new Lifecycle();
  input = new DesktopInput(el as unknown as HTMLElement, shake, life);
});

afterEach(() => {
  input.dispose();
  vi.unstubAllGlobals();
});

describe('мышь на ПК', () => {
  it('без захвата движение мыши взгляд не ведёт', () => {
    move(100, 300, 200);
    const f = input.poll();
    expect(f.lookYaw).toBe(0);
    expect(f.lookPitch).toBe(0);
    expect(shake.strokes).toBe(0);
  });

  it('клик захватывает мышь, после тихого окна движение ведёт луч', () => {
    lockAt(1000);
    expect(el.requests).toBe(1);
    move(1000 + LOCK_QUIET_MS, 100, -50);
    const f = input.poll();
    // Мышь вправо — луч вправо (yaw отрицательный), мышь вверх — луч вверх.
    expect(f.lookYaw).toBeCloseTo(-0.21, 6);
    expect(f.lookPitch).toBeCloseTo(0.105, 6);
    // Накопленный поворот отдаётся один раз.
    expect(input.poll().lookYaw).toBe(0);
  });

  it('движение, созданное до захвата или сразу после него, пропускается — даже если дошло позже', () => {
    lockAt(1000);
    // Браузер перенёс курсор при захвате и прислал это как движение на полэкрана. Событие создано
    // до подтверждения захвата, но страница получила его уже под захватом.
    move(960, -640, -360);
    move(1000, -640, -360);
    move(1000 + LOCK_QUIET_MS - 1, 500, 0);
    const f = input.poll();
    expect(f.lookYaw).toBe(0);
    expect(f.lookPitch).toBe(0);
    expect(shake.strokes).toBe(0);
    expect(shake.level).toBe(0);
  });

  it('движение, вклинившееся между захватом и событием о нём, тоже пропускается', () => {
    // Браузер уже выставил элемент захвата, но pointerlockchange ещё не раздал: первым приходит
    // «возврат курсора». Так ведёт себя chromium-headless-shell, и взгляд от этого уезжал на 77°.
    el.emit('mousedown', { timeStamp: 1000 });
    expect(doc.pointerLockElement).toBe(el);
    move(1004, -640, -360);
    doc.emit('pointerlockchange', { timeStamp: 1010 });
    move(1012, 0, 0);
    let f = input.poll();
    expect(f.lookYaw).toBe(0);
    expect(f.lookPitch).toBe(0);

    move(1010 + LOCK_QUIET_MS, 10, 0);
    f = input.poll();
    expect(f.lookYaw).toBeCloseTo(-0.021, 6);
  });

  it('если часы событий мыши и захвата расходятся, мышь всё равно ведёт луч', () => {
    // Старые браузеры отдавали время pointerlockchange от 1970 года, а время мыши — от загрузки
    // страницы. Тихое окно в таком браузере не должно затянуться навсегда.
    lockAt(1_700_000_000_000);
    move(5000, 100);
    expect(input.poll().lookYaw).toBeCloseTo(-0.21, 6);
  });

  it('размах движения не ограничен: резкая тряска считается при любой скорости мыши', () => {
    lockAt(0);
    // Рывки по 700 px за событие: быстрая мышь при редких кадрах. Раньше такие события отбрасывались
    // как «выбросы», и фонарь нельзя было оживить.
    let ts = LOCK_QUIET_MS;
    for (let i = 0; i < 8; i++) {
      move(ts, i % 2 === 0 ? 700 : -700);
      ts += 16;
      shake.update(0.016);
    }
    expect(shake.strokes).toBeGreaterThanOrEqual(6);
    expect(shake.level).toBeGreaterThan(0.8);
    // Восемь равных рывков туда-обратно: взгляд остаётся на месте.
    expect(input.poll().lookYaw).toBeCloseTo(0, 9);
  });

  it('потеря захвата ставит паузу; после возврата снова тихое окно', () => {
    lockAt(0);
    move(LOCK_QUIET_MS + 10, 40);
    expect(input.poll().lookYaw).not.toBe(0);

    // Esc или переключение окна.
    doc.pointerLockElement = null;
    doc.emit('pointerlockchange', { timeStamp: 5000 });
    expect(life.has('pointer')).toBe(true);
    move(5300, 40);
    expect(input.poll().lookYaw).toBe(0);

    life.set('pointer', false);
    lockAt(9000);
    move(9000 + LOCK_QUIET_MS - 1, 640);
    expect(input.poll().lookYaw).toBe(0);
    move(9000 + LOCK_QUIET_MS, 40);
    expect(input.poll().lookYaw).toBeCloseTo(-0.084, 6);
  });

  it('на паузе мышь не считается', () => {
    lockAt(0);
    life.set('user', true);
    move(1000, 100);
    expect(input.poll().lookYaw).toBe(0);
    expect(shake.strokes).toBe(0);
  });

  it('захват недоступен (песочница iframe): луч ведётся с зажатой кнопкой, паузы нет', async () => {
    el.lockAllowed = false;
    el.emit('mousedown', { timeStamp: 100 });
    await Promise.resolve();
    await Promise.resolve();
    expect(doc.pointerLockElement).toBeNull();

    move(120, 50);
    expect(input.poll().lookYaw).toBeCloseTo(-0.105, 6);
    win.emit('mouseup', { timeStamp: 200 });
    move(220, 50);
    expect(input.poll().lookYaw).toBe(0);

    // Повторно захват не запрашивается, потеря «захвата» игру не останавливает.
    el.emit('mousedown', { timeStamp: 300 });
    expect(el.requests).toBe(1);
    doc.emit('pointerlockchange', { timeStamp: 310 });
    expect(life.paused).toBe(false);
  });

  it('dispose снимает все обработчики', () => {
    expect(doc.listeners + win.listeners + el.listeners).toBeGreaterThan(0);
    input.dispose();
    expect(doc.listeners + win.listeners + el.listeners).toBe(0);
  });
});
