# Страшные кадры: находка тела и анонимное признание

Промпты владельца (2026-10-14), дословно. Приём передачи «Криминальная Россия»: тело на месте преступления заменено
красной пиксельной фигурой; преступник или загадочный человек — тёмный силуэт без лица на красном фоне. Модель
рисует красную замену сама — тела под ней нет.

Генерация — `tools/hod/scary.py` (GPT Image 2.5 sunburst, high, журнал расходов — общий с «Воспоминаниями»).
Как скрипт подставляет промпты:
- **Находка:** секция SCENE BRIEF заменяется сценой эпизода (лесополоса, без людей). Референсы: Image 1 — черновой
  кадр «Реализма» той же находки (scene reference), Image 2 — принятый кадр «Воспоминаний» того же места (style
  reference). Фото владельца с квартирой не передаётся: промпт взял бы оттуда комнату.
- **Признание:** в начало добавляется одна строка о картинках. Image 1 — вырезка с фото владельца строго внутри экрана
  проектора (композиция), Image 2 — утверждённый лист головы персонажа (character reference).
- **VHS не запекается** (правило `memory-style.md`, аналоговую запись кладёт игра поверх кадра): секции ANALOG FINISH
  и строки про VHS в FINAL CHECK скрипт убирает, остальное идёт дословно.

## Место преступления

```
CINEMATIC CRIME GRAPHIC NOVEL
CLEAN INK & VHS — PIXELATED RED BODY REPLACEMENT

Create ONE standalone landscape frame for a mature fictional detective visual novel.

Depict a non-graphic crime-scene aftermath. The deceased adult is represented entirely by an opaque, coarse-pixelated red silhouette. The room remains fully illustrated and visually readable.

OUTPUT
One cinematic image, not a collage, storyboard, comparison sheet or split screen.
No captions, subtitles, dialogue boxes, labels, logos or interface elements.

REFERENCE PRIORITY
If the supplied reference is a four-panel sheet, use ONLY the upper-left crime-scene panel. Ignore the confession portrait and both lower panels. Do not reproduce the panel borders.

Use the selected scene reference to determine camera position, room layout, perspective, furniture placement, lighting and the figure's position.

Use a separate style reference only for drawing language, color treatment and analog texture. Do not import unrelated people, props or locations.

SCENE BRIEF
An ordinary lived-in apartment in Russia in the 1990s, viewed from an open doorway during daylight.

A patterned rug lies between a worn sofa, a low coffee table and a television cabinet. Daylight enters through a window with sheer curtains. Furniture and belongings feel naturally used, not deliberately arranged for a horror illustration.

On the rug, one deceased adult is represented by a single red pixelated silhouette, lying diagonally across the floor. Its position communicates a motionless human figure without showing bodily details.

Do not add detectives, witnesses or other people unless explicitly requested in the scene brief.

ART DIRECTION
A restrained hybrid of realistic Western crime comics and sophisticated adult 2D animation.

Preserve believable human proportions, architectural perspective and object scale. Translate the scene into intentional hand-drawn shapes rather than applying a generic cartoon filter.

Use confident ink contours with varied line weight, controlled cel shading, broad color planes and selective material detail.

Keep dark areas visually quiet: large shadow masses, minimal internal lines, almost no crosshatching. Furniture, fabric and wallpaper must remain recognizable without excessive scratches or microscopic texture.

Muted olive, dusty blue-gray, weathered beige, warm brown and natural daylight. The red figure is the principal unnatural color accent.

CRITICAL: HUMAN SCALE AND POSITION
The red silhouette must occupy the correct projected footprint of a realistically proportioned adult lying in this exact position.

Judge its scale against nearby furniture at the same depth, the rug and the room's perspective. Apply believable foreshortening.

Retain the broad spatial relationship between head, torso, arms and legs. Communicate the pose through the overall silhouette, not through internal anatomy.

Do not shrink the figure into a small floor marker.
Do not enlarge it into a giant shape.
Do not spread the red region beyond the figure like a puddle.
Do not replace the silhouette with a rectangular censorship box.

CRITICAL: OPAQUE RED REPLACEMENT
Replace the entire visible figure with an opaque graphic fill.

No face, hair, skin, clothing, shoes, fingers, folds or anatomical surface details may remain visible inside or outside the red replacement.

The fill is not transparent. It is not a red tint over a rendered person.

Use a deep, matte brick-red or dark vermilion, consistent with the reference. Allow only slight variation between two or three neighboring red tones.

No volumetric modeling within the red area.
No realistic highlights or body-shaped internal shadows.
No glossy, wet or liquid appearance.
No blood, splashes, drips or surrounding stains.
No glow, red light spill or neon outline.

CRITICAL: STRONG LOCAL PIXELATION
Construct the replacement from large square blocks aligned to a consistent screen-space grid.

Use an approximate visual density of 20–30 blocks along the figure's projected head-to-foot length. The blocks must be clearly visible at normal viewing size.

Pixelate BOTH the outer silhouette and the interior color regions.

The boundary must have pronounced square steps. Do not retain a smooth anatomical contour beneath a pixelated texture.

Keep the silhouette connected and human-sized, but simplify fine extremities into broad block clusters. Preserve larger gaps between limbs where the pose requires them.

Use hard-edged squares, not rounded tiles, blurred mosaic, triangular polygons, random debris or tiny pixel noise.

Pixelation applies ONLY to the red silhouette. Do not pixelate the room, furniture, floor, window or the entire image.

LIGHTING AND ATMOSPHERE
Preserve the scene's original time of day.

Daylight must remain visibly present. Keep the room readable with natural ambient illumination and moderate contrast. Do not turn a daytime apartment into a nighttime scene.

The atmosphere should come from stillness, ordinary surroundings and the disturbing red human-shaped absence, not from exaggerated darkness or theatrical horror lighting.

ANALOG FINISH
Apply restrained VHS texture to the completed frame: fine luminance noise, slight color bleed and occasional faint horizontal interference.

Keep the interference low contrast. It must not fragment the illustration or obscure the red silhouette's block structure.

No heavy scanlines, large tracking failures, digital glitch effects or distressed film scratches.

FINAL CHECK
One crime-scene frame.
One correctly scaled adult-shaped red replacement.
Entire figure covered by opaque red blocks.
Clearly stepped pixelated edges.
No visible bodily details.
No pixelation outside the red replacement.
Readable cinematic environment.
Clean graphic-novel rendering and subtle VHS.
```

## Маньяк или загадочное лицо

```
CINEMATIC CRIME GRAPHIC NOVEL
CLEAN INK & VHS — ANONYMOUS CONFESSION

Create ONE standalone landscape portrait frame for a mature fictional detective visual novel.

A fictional adult male perpetrator is recounting his crimes in an anonymous interview. Show only the interview portrait, not the crimes themselves.

OUTPUT
One cinematic image, not a collage, storyboard, comparison sheet or split screen.
No captions, subtitles, dialogue boxes, labels, logos or interface elements.

REFERENCE PRIORITY
If the supplied reference is a four-panel sheet, use ONLY the upper-right portrait: a dark male silhouette against a red background.

Ignore the crime-scene panel and both lower panels. Do not reproduce their objects, pixelated red shapes or panel borders.

The selected portrait determines the framing, silhouette-to-background relationship, red palette and restrained atmosphere.

If a separate character reference is supplied, preserve the character's head shape, hairstyle, ears, build and clothing silhouette without revealing the face.

SUBJECT AND COMPOSITION
One ordinary-looking adult man with short hair and a plain dark collared shirt.

A nearly frontal, chest-up composition at eye level. Place the head near the center, with the shoulders extending across the lower frame.

Maintain natural human proportions. Allow slight asymmetry in the shoulders and a small, believable head tilt.

Keep the posture quiet and unperformed. No theatrical gesture, aggressive pose, exaggerated grin or horror-movie expression.

The shot should feel like an unsettling documentary interview, not a villain poster.

ART DIRECTION
Use the same mature illustrated language as the crime-scene frames: realistic proportions, confident organic ink drawing, restrained cel shading and broad tonal shapes.

Combine the grounded visual weight of a realistic Western crime graphic novel with the selective simplification of sophisticated adult 2D animation.

Do not render a live-action photograph, glossy CGI character, low-poly model, superhero illustration or exaggerated cartoon.

Use very little linework in dark areas. Do not fill the shirt, face or background with dense hatching, scratches or decorative texture.

FACE AND SILHOUETTE
Keep the face unreadable through deep shadow, not through pixelation.

The head and facial area should form an almost continuous charcoal-black or very dark burgundy mass.

Eyes, mouth and expression must not be legible. No eye glints, visible teeth, illuminated nose or detailed skin.

Preserve a natural head outline, believable ears and a recognizable human neck-and-shoulder relationship.

A few extremely subdued tonal shapes may suggest the shirt collar and major fabric folds. These must remain secondary to the silhouette.

Do not add scars, injuries, masks, supernatural features or invented facial abnormalities.

RED BACKGROUND
Use a full-frame, nonliteral crimson-red backdrop.

It is a documentary graphic background, not a visible room lit with red lamps.

Allow broad, subtle variations between deeper crimson near the outer frame and a somewhat lighter red behind the head and shoulders.

Keep the transitions understated. Avoid a circular spotlight, radial rays, smoke, flames, splatter or decorative graphics.

Do not depict a television, projector screen, wall projection or the room surrounding a screen.

SEPARATION LIGHTING
Separate the figure primarily through the contrast between the dark silhouette and red background.

Allow a very faint, narrow red reflected edge along selected parts of one ear, the neck or one shoulder.

Keep this edge irregular and directionally motivated. It must disappear across other parts of the silhouette.

No continuous glowing outline.
No gold or white hero rim light.
No frontal fill light.
Do not lift the facial exposure to make the speaker more readable.

The anonymity of the face takes priority over conventional active-speaker lighting.

CRITICAL: NO PIXELATION
Do not pixelate the head, face, shoulders or red background.

Use a naturally drawn silhouette with clean, subtly organic edges.

No mosaic censorship, square block structure, digital fragmentation or pixel-art treatment.

The coarse red pixelation belongs exclusively to the separate crime-scene visual language. It must not appear in this portrait.

ANALOG FINISH
Add the same restrained VHS treatment used in the crime-scene frames.

Fine low-contrast luminance noise.
Very subtle chroma softness.
Occasional faint horizontal interference.
Minimal color bleed at selected high-contrast edges.

Keep the main silhouette strong and stable. Do not obscure it with heavy tracking errors, thick scanlines or large digital glitches.

EMOTIONAL TARGET
An ordinary human presence made unsettling by proximity, stillness and an unreadable face.

The threat comes from the context of the confession and the inability to read the speaker's expression, not from monstrous appearance or visible violence.

FINAL CHECK
One anonymous interview portrait.
One fictional adult man.
Face entirely unreadable in shadow.
Deep red background.
Natural, non-pixelated silhouette.
Minimal red edge separation.
Quiet illustrated shadows.
Subtle VHS texture.
No crime-scene insert, weapons, bodily injuries or additional panels.
```
