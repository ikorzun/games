/** Весь реквизит разом: убежище (PROPS) и «дом каждого» (HOME_PROPS). Витрина и обстановка берут отсюда. */
import { HOME_PROPS } from './props_home';
import { PROPS } from './props_more';
import type { PropSpec } from './props_more';

export const ALL_PROPS: Record<string, PropSpec> = { ...PROPS, ...HOME_PROPS };
