/**
 * Ввод игрока за кадр: общий вид для клавиатуры с мышью и для тача. Игрок только ходит, смотрит
 * и светит — кнопок действия нет.
 */
export interface InputFrame {
  /** Движение в осях игрока: x — вправо, z — вперёд; длина до 1. */
  moveX: number;
  moveZ: number;
  run: boolean;
  /** Поворот луча за кадр, радианы: yaw — влево положительный, pitch — вверх положительный. */
  lookYaw: number;
  lookPitch: number;
  /** Выключатель фонаря нажат в этом кадре: компьютер — F, телефон — короткий тап по кнопке фонаря. */
  light: boolean;
  /**
   * Палец держат на кнопке фонаря (телефон; не нажатие, а состояние): пока держат, фонарь заряжается, полный —
   * вспышка и свет (слова партнёра 17.11 08:42).
   */
  crank: boolean;
  /** Запрошена пауза. */
  pause: boolean;
}

export function emptyInput(): InputFrame {
  return { moveX: 0, moveZ: 0, run: false, lookYaw: 0, lookPitch: 0, light: false, crank: false, pause: false };
}

export interface InputSource {
  /** Забрать накопленный ввод (счётчики нажатий и поворота обнуляются). */
  poll(): InputFrame;
  /** Сбросить всё зажатое (пауза, потеря фокуса). */
  release(): void;
  dispose(): void;
}
