# Промпт для предметов: реквизит мини-игр и окружения

Решение владельца, 2026-10-11 (вечер): предметы мини-игр (ключи, документы, кассеты, коробки, замки) и вставки
с предметами генерируются по этому промпту **дословно**; в конце заполняется OBJECT BRIEF. Стиль, свет и мягкость
картинки — те же, что у утверждённых сцен по базовому промпту `style-bible.md` §1 (аналоговое ТВ конца 1990-х);
конструкция предмета — только по фотографиям реальных вещей эпохи, никогда по ранним нейрогенерациям.

Правила подготовки брифа (по-русски, для команды):

- Перед генерацией собираем **фотографии реального предмета** (модель, год выпуска) и достоверные размеры или
  предмет-эталон масштаба в том же кадре. Без них промпт не запускаем: модель не должна «придумывать» механизм.
- Несколько предметов в одной мини-игре (связка ключей, замок и ключ к нему, карточки картотеки) генерируются в
  **одном масштабе**: бриф называет общий масштаб вывода и условия камеры, а не подгоняет каждую вещь под один размер.
- Вставка в сцену (`scene insert`) — предмет лежит в утверждённом кадре сета с его светом; изолированный ассет
  (`isolated transparent asset`) — прозрачный фон, но свет и камера сцены-назначения.
- Приёмка: сверяем с фотографией реального предмета пропорции, число и положение деталей, посадку (ключ в кольце,
  дужка в замке, ящик в коробке), материалы и тени. Структурная ошибка — брак, «стиль» её не оправдывает.
- Id ассетов — как в `episodes/s1/ep01_murylev.json` (`assets.documents`, `assets.cg`); журнал —
  `assets/ep01/generation-log.md`.

## Текст промпта (дословно)

```
OBJECT PROMPT — REAL PROPS FOR DETECTIVE MINI-GAMES
Visual continuity with the approved early “Ulitsy razbitykh fonarey” scene style

Create the objects specified in the brief as photographed physical props from the same late-1990s St Petersburg setting as the approved scenes. They should belong naturally to an ordinary, functioning location filmed by a modest television crew.

REAL OBJECTS AND REFERENCES — HIGHEST PRIORITY

Every object must correspond to an existing real-world object of the specified period. Its construction must be real, not merely plausible-looking. Use photographs of actual objects, documented models and reliable supplied measurements as the authority for geometry.

Keep one coherent real design per object. Do not invent objects, combine incompatible designs, improvise missing mechanisms or redesign parts to improve the composition.

Real-object references determine construction, proportions and material identity. Approved scene references determine camera treatment, light, color and image softness. Earlier AI-generated objects are not evidence of real construction; do not reproduce their geometric errors for visual continuity.

Do not invent dimensions, model names, product markings or “verified” specifications. Preparation requirement: supply real references and resolve essential missing construction information before generation. A photograph without a scale reference establishes appearance, not an exact physical size.

PROPORTIONS AND SCALE — THREE MANDATORY LEVELS

1. WITHIN EACH OBJECT

Preserve the actual length, width and thickness of the object and the ratios between all its parts. Match the body, heads, handles, shafts, blades, openings, fasteners and attachments to the real reference. Preserve the number, position and size of functional parts and negative spaces. Do not miniaturize a head, stretch a shaft, thicken a ring or enlarge a hole for visual convenience.

2. BETWEEN DIFFERENT OBJECTS

Use one consistent physical scale. Preserve real size relationships between keys, locks, cassettes, boxes, paper and any other items present. Do not resize each item independently to make them equally prominent. For separate assets that must align in the game, specify a common output scale and compatible camera conditions. Different crops alone do not establish a shared pixel scale. Use framing and canvas padding for layout; do not normalize different objects to equal apparent dimensions.

3. WITHIN THE SCENE

Relate each object correctly to the table, hand, door, furniture and other surroundings, using supplied dimensions or a clearly identified scale reference. Apply one coherent camera perspective. Apparent size must follow physical size, distance, orientation and foreshortening. Objects resting on the same surface must share a consistent surface plane and believable contact.

Across views and mini-game states, keep the same physical dimensions and construction. Projected size may change with the camera, orientation and distance. Opening or moving an object must not redesign its parts.

KEYS, RINGS AND FUNCTIONAL ASSEMBLY

For every key, follow a real manufactured example. Preserve the actual proportions of its bow or head, suspension hole, blade or shaft, grooves, teeth or bit, and thickness. Do not invent hybrid key types. Do not reduce or enlarge the head relative to the real reference.

Distinguish three separate structures: the key head, the through-hole in that head, and the split key ring holding the keys.

The ring must pass through genuine holes with plausible clearance. Its wire thickness and usable inner space must accommodate the actual holes and the number and thickness of the keys. Keys must hang or lie in physically possible orientations, with correct overlap and freedom to move. No metal passing through solid metal, fused parts or decorative connections that could not be assembled.

Apply the same functional discipline to other objects: real hinges and joints, a lock shackle entering its sockets, a matchbox drawer fitting its sleeve, cassette reels fitting their housing. A key presented as fitting a lock must have a compatible real design.

MATERIALS AND WEAR

Describe materials through their actual response to light: metal reflections, the sheen of molded plastic, matte paper and cardboard, and transparency where physically present. Preserve differences between materials.

Keep large surfaces calm. Avoid uniform micro-scratches, sand-like roughness, exaggerated paper fibers, embossed dirt, artificial pitting and repeated procedural noise. Small wear marks should occur where handling and contact would cause them.

Age and wear must match the object’s condition during the story, not decades of additional deterioration. Realism comes from correct form, material behavior, light and selective wear.

LIGHT, CAMERA AND IMAGE CHARACTER

Match the approved main prompt. Use a practical viewpoint, natural perspective and enough depth of field to read the object and its important parts. Close framing must not distort proportions.

Light the object from the sources actually present in the destination scene: a window, overcast sky or ordinary room fixtures. Keep reflections, contact shadows, occlusion and reflected color consistent with that environment. Objects sharing a scene must share its lighting; avoid individually staged studio highlights.

Preserve distinct, restrained everyday colors. Use modest dynamic range, soft color detail and reduced fine local contrast consistent with the approved analog standard-definition television look.

Let tiny scratches, paper fibers and fine surface grain merge naturally at the intended viewing size. Keep silhouettes, openings, joints and functional geometry legible. Do not replace excess detail with uniform blur, waxy surfaces or haze.

Avoid CGI product polish, HDR-like clarity, dramatic rim lighting, extreme bokeh, stylized isometric proportions, blanket color casts, fake VHS damage, watermarks and interface graphics.

OUTPUT MODE

For a scene insert, integrate the object at the correct physical scale with believable contact and shadows.

For an isolated asset, use true transparent background and retain the destination scene’s light and camera character. Through-holes are transparent only where the camera actually sees the removed background. Preserve their visible inner walls, overlapping parts and enclosed dark recesses. Keep the entire object visible. A larger output canvas must not introduce newly invented microtexture.

PRODUCTION CHECK BEFORE ACCEPTANCE

Compare the generated result with the actual real-object reference: existing design, internal proportions, relative size, perspective, functional fit, materials and lighting. Correct impossible geometry before accepting the image. Style, wear and softness must never conceal or justify structural errors.

OBJECT BRIEF

Object(s), existing type or model, period: […]

Photographs of the real object(s), designated as construction references: […]

Reliable dimensions or identified scale reference: […]

Configuration, condition and required mini-game state: […]

Approved scene reference and destination location: […]

Other visible objects and their dimensions or scale relationship: […]

Placement, camera position and actual light sources: […]

Output: scene insert / isolated transparent asset; shared asset scale if applicable: […]
```

Пометка для команды: строка «late-1990s St Petersburg setting» в промпте — стилевая отсылка к сериалу; в брифе
(`Approved scene reference and destination location`) называется реальное место и год эпизода (для эпизода 1 —
Москва, 1993), как и в поле `Location and time` базового промпта.
