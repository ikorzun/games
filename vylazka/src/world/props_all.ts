/**
 * Весь реквизит разом: убежище (PROPS), «дом каждого» (HOME_PROPS), офис (OFFICE_PROPS) и готовые
 * модели (MODEL_PROPS). Витрина и обстановка берут отсюда.
 */
import { HOME_PROPS } from './props_home';
import { MODEL_PROPS } from './props_models';
import { PROPS } from './props_more';
import type { PropSpec } from './props_more';
import { OFFICE_PROPS } from './props_office';

export const ALL_PROPS: Record<string, PropSpec> = { ...PROPS, ...HOME_PROPS, ...OFFICE_PROPS, ...MODEL_PROPS };
