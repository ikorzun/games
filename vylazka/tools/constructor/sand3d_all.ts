/**
 * Модели полки Sand3D — в конструкторе сразу (в игре они отдельный кусок сборки и грузятся по нужде, world/sand3d.ts).
 * Импортируется в main.ts первым: до того как что-нибудь соберёт вещь полки.
 */
import { registerModels } from '../../src/world/models';
import { SAND3D_DATA } from '../../src/world/sand3d_data';

registerModels(SAND3D_DATA);
