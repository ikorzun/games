import { describe, expect, it } from 'vitest';
import { ALL_PROPS, PROP_SETS } from '../src/world/props_all';
import { KAYKIT_SWAPS } from '../src/world/props_real';

describe('весь реквизит', () => {
  it('имя каждого предмета есть только в одном наборе (иначе поздний набор молча перекроет ранний)', () => {
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const [setName, set] of Object.entries(PROP_SETS)) {
      for (const name of Object.keys(set)) {
        const was = seen.get(name);
        if (was) twice.push(`${name}: ${was} и ${setName}`);
        else seen.set(name, setName);
      }
    }
    expect(twice).toEqual([]);
  });

  it('домашний торшер с абажуром и латунный — разные вещи', () => {
    expect(ALL_PROPS.floor_lamp?.ru).toBe('торшер с абажуром');
    expect(ALL_PROPS.floor_lamp_brass?.ru).toMatch(/латунная/);
  });

  it('каждая замена вещи набора KayKit указывает на существующий предмет', () => {
    for (const s of KAYKIT_SWAPS) expect(ALL_PROPS[s.to], s.to).toBeDefined();
  });
});
