# Промты финальной генерации — эпизод 1 «Смерть за квартиры»

Сгенерировано `tools/export_prompts.py` (не править руками: правки — в `docs/production/prompts/ep01-images.md`, `style-bible.md`, `tools/shot_plan.py`, затем перегенерировать). Для каждой картинки промт = **базовый промпт** (§1 ниже, дословно) + блок из раздела картинки (REFERENCE IMAGES, CONTINUITY, SCENE). Модель: gpt_image_2_5, quality medium, 2k; фоны, CG и кадры — 16:9, лица — 1:1, документы — 3:4, спрайты — 3:4 с ровным фоном под вырезку.

## 0. Порядок работы (чтобы лица были одни и те же)

1. **Лица** (§2): по одному портрету на персонажа без референсов; принятый портрет — `assets/ep01/faces/<id>.webp` — дальше идёт первым референсом персонажа во всех его картинках (спрайты, кадры, CG). Черновые портреты этой сессии лежат там же; финальные — заменить файлы, не меняя имён.
2. **Спрайты** (§2, блок SPRITE): база с портретом как Reference 1, затем выражения от базы (стайл-библия §4).
3. **Фоны** (§3) без людей; **CG** (§4); **документы** и **UI** (§5) — по `objects.md`.
4. **Кадры покрытия** по сетам (файлы `*-shots-<set>.md`): сначала `wide_1` с фоном как Reference 1 и портретами людей; принятый `wide_1` — референс комнаты для ots, вставок и ракурсов; кроп принятого `wide_1` без нижней трети — референс средних планов и ракурсов; первый принятый крупный план — референс остальных крупных планов и реакций (порядок референсов в каждом кадре расписан в его блоке REFERENCE IMAGES).
5. Каждый кадр просматривается по стайл-библии §1a; брак перегенерируется тем же промтом.

## 1. Базовый промпт (стайл-библия §1, подстановки планировщика уже сделаны)

```
Create one original fictional live-action television drama still that evokes the cinematography of the first seasons of the Russian series “Ulitsy razbitykh fonarey” / “Streets of Broken Lights”.

PERIOD AND HUMAN PRESENCE

Moscow in the early 1990s. A modest television crew filming inside a real, functioning location of that period.

Everyday detective work, ordinary people, fatigue, understated human warmth and dry humor. Distinctive imperfect faces, natural hair, ordinary builds and unretouched skin.

Capture a small ongoing action or a pause inside a conversation: someone listening, waiting for an answer, thinking, handling a piece of paper or leaning toward a car window. Expressions and gestures respond to the situation. Nobody poses for the camera.

CAMERA AND STAGING

Use a practical camera position physically available within the room or vehicle, near the eye level of a participant. Keep the horizon straight.

Favor medium shots, two-shots and group compositions. Place people at different distances when the scene allows. Let a shoulder, furniture edge, door frame or car window naturally overlap the composition.

Use a moderate wide-to-normal field of view, approximately 32-45 mm full-frame equivalent as a visual instruction. Preserve readable spatial relationships and recognizable surroundings. Backgrounds have enough depth of field to remain part of the scene, with modest optical softness.

Frame the conversation or action clearly. Allow slightly cramped spacing and ordinary cropping at the edges. Landscape composition 16:9, the frame of the game, one frame, without borders. These are reconstruction settings, not claims about the original camera equipment.

ANALOG TELEVISION IMAGE CHARACTER — ESSENTIAL

Render the image with the visible limitations of late-1990s analog standard-definition television video.

Reduce high-frequency detail and fine local contrast. Individual hair strands should gently merge into natural hair masses. Fine knit loops, fabric fibers, tiny pores, paper fibers, wood grain and dashboard textures should no longer be individually crisp.

Preserve clear facial features, expressions, fingers, gestures, silhouettes and the important contours of objects. Faces remain human and expressive. Soft detail must not turn skin waxy or hands indistinct.

Keep color detail slightly softer than luminance detail. Use restrained color resolution and, at most, a very subtle horizontal softness at strong color boundaries. Do not produce conspicuous color bleeding or rainbow edges.

Allow slight electronic noise mainly in darker areas, modest dynamic range and occasional loss of detail in the brightest areas. Broad shapes and the action remain legible.

Make this texture inherent to the photographed image. Avoid a uniformly blurred, defocused, hazy or artificially distressed appearance. The result should feel like a clean surviving television frame with limited fine detail.

LIGHT AND EXPOSURE

Use light motivated by the actual window, overcast sky and simple room fixtures. Ordinary soft or slightly blunt shadows are appropriate. Keep the lighting plain and physically consistent.

Allow the exposure to be less perfectly balanced than in a contemporary commercial photograph. Different parts of the location can have visibly different brightness. Do not illuminate every face separately.

For a modest daytime office, use a gently warm room tone with subtle natural white-balance irregularity. Pale window areas may lose some exterior detail. Preserve normal skin color and the separate colors of clothing and furniture.

For a scene viewed from a shaded car interior toward a brighter overcast exterior, let the cabin, dashboard and shaded clothing be visibly darker than the street and the person outside. The driver’s face remains readable. The palest exterior areas may approach clipping. Do not crush the entire cabin into black.

Apply these exposure relationships only when they fit the scene. Other locations should follow their own actual light sources.

COLOR

Preserve colors belonging to the objects: honey-brown furniture, pale green or beige walls, off-white paper, washed blue cotton, slate-blue nylon, ochre fabric, rust knitwear and occasional stronger everyday colors.

Allow restrained, slightly imperfect color rendition while keeping these colors distinct. Retain ordinary skin warmth.

No blanket green, yellow, sepia or blue cast. No fashionable teal-and-orange separation.

LOCATION AND COSTUME

Use period-appropriate rooms, vehicles, clothing and objects. Locations are used but functioning.

Furniture and clothes have different ages, materials and practical reasons to be present. Include a few specific everyday objects, casual mismatched clothing and localized signs of wear.

Keep the environment believable without excessive set dressing or exaggerated decay.

AVOID

Modern prestige-TV polish, razor-sharp microdetail, beauty retouching, waxy skin, uniform blur, heavy haze, dramatic rim lighting, volumetric rays, anamorphic flares, very shallow depth of field, fashion styling, heroic poses, theatrical menace, picturesque ruins and obligatory rain.

Avoid large film grain, film scratches, strong VHS tracking damage, scanline overlays, conspicuous chromatic fringes, vignette, timestamps, subtitles, channel logos, watermarks, modern objects and recognizable members of the original cast.
```

Блок CONTINUITY (вставляется после REFERENCE IMAGES, перед SCENE, во все кадры с людьми):

```
CONTINUITY AND INTEGRITY (mandatory)
- The room is exactly the referenced background: same furniture, window, wallpaper and props in the same
  places; only the camera moved.
- Each person is exactly the referenced character: same face, age, hair, build and the same clothes in every
  shot of this set; expressions change, clothing never does.
- People are never swapped: the person named for Reference 2 has Reference 2's face and clothes, and so on;
  who is near the camera and who is far is exactly as the scene text says.
- Props are exactly as in the room reference: nothing added (no dust covers, extra chairs, cups or papers),
  nothing removed; the left-to-right order of people and furniture is the same as in the wide view.
- Anatomy and props are coherent even in the soft television image: five fingers on each hand, hands grip
  objects naturally, two eyes looking in one direction, glasses with two lenses; every object appears once
  (one lamp, one typewriter, one glass); nothing floats, melts or merges.
- Any writing on papers, stamps, signs or calendars is out of focus or too small to read; no invented letters.
- Period accuracy, Moscow 1993: no modern phones, cars, LED lights or plastic windows.
```

## 2. Персонажи: лица и спрайты

| id | Имя | Описание (CHARACTER, во все промты персонажа) | Психотип в портрете | Файл лица | Выражения спрайта |
|---|---|---|---|---|---|
| `sledak` | Андрей Громов | man, 29, lean, tired grey eyes, short dark hair, a day of stubble; grey wool coat over a dark sweater, folder under his arm; prosecutor's investigator, 1993 Moscow | an introvert who trusts paperwork and patience and is ashamed of pressing people; tired grey eyes, a face that listens more than it speaks | `assets/ep01/faces/sledak.webp` | neutral, tense, tired, firm |
| `sledak_old` | Андрей Громов, 2004 год | the same man at 40: heavier, grey at the temples, lines around the eyes; dark blazer, open collar, seated for an interview | the same man as Investigator Andrei Gromov eleven years later: heavier, grey at the temples, lines around the eyes, quiet grief without self-pity | `assets/ep01/faces/sledak_old.webp` | neutral, sad |
| `oper` | Виктор Сайко | man, 34, stocky, broken nose, close-cropped hair; black leather jacket, knitted sweater, jeans; criminal police detective | an extrovert street detective who can talk to anyone; a teasing half-smile held back, a face that has been hit and did not mind | `assets/ep01/faces/oper.webp` | neutral, grin, angry, hurt |
| `expert` | Нина Левина | woman, 45, sharp features, glasses on a chain, hair in a bun; white lab coat over a cardigan; forensic expert | a rational observer with dry irony, tired of expert reports being read only after verdicts; sharp attentive eyes behind glasses on a chain | `assets/ep01/faces/expert.webp` | neutral, focused |
| `murashov` | Сергей Мурашов | man, 38, tall, neat, pleasant forgettable face, well-groomed moustache; good grey suit slightly too new, briefcase; former journalist turned apartment dealer; deliberately ordinary, not charismatic | a narcissistic rationalizer who calls himself an orderly; polite, calm, with an editor's composure; a pleasant, instantly forgettable face | `assets/ep01/faces/murashov.webp` | neutral, smile, cold, cornered (also rendered as a silhouette by runtime) |
| `notary` | Нотариус Ковригин | man, 55, soft, balding, sweating; brown suit, tie askew; notary | a cowardly accomplice hiding behind the law; soft, balding, sweating, eyes that avoid contact | `assets/ep01/faces/notary.webp` | neutral, nervous |
| `zoya` | Зоя Павловна | woman, 74, small, kind face, white hair under a knitted beret; Sunday coat with a fur collar, handbag; pensioner | trusting and kind, shy of being a burden, lonely; a small bright face that lights up at the thought of her grandson | `assets/ep01/faces/zoya.webp` | neutral, warm, worried |
| `neighbor` | Галина, соседка | woman, 60, sturdy, flowered housecoat and cardigan, glass milk bottle in hand; neighbour | observant and pushy until it concerns herself, then afraid of being involved; a sturdy face used to talking in stairwells | `assets/ep01/faces/neighbor.webp` | neutral, worried |
| `buyer` | Лапин | man, 40, thin, anxious, cheap suit jacket over a sweater; family man who bought the apartment | an honest man under a steamroller: polite confusion turning into panic; thin, anxious, early lines on the face | `assets/ep01/faces/buyer.webp` | neutral, scared |
| `boss` | Валентин Павлович | man, 55, heavy, jowly face, grey hair combed back; dark navy suit, white shirt, patterned tie; head of the investigative department | not a villain: a department head who keeps the place afloat, fatherly and tired; heavy jowls, eyes that have made many compromises | `assets/ep01/faces/boss.webp` | neutral, stern, tired |
| `lapin_wife` | Ирина Лапина | woman, 40, thin, pale, tired eyes, hair pulled back in a low bun; beige cardigan over a plain dark grey dress; wife of a missing man | a mother defending her home: she holds longer than her husband and breaks deeper; pale, tired eyes, hair pulled back | `assets/ep01/faces/lapin_wife.webp` | neutral, worried, angry |
| `accomplice` | Дмитрий Шмелёв («Шмель») | man, 30, thick neck, boxer's build, short dark hair; black padded jacket over a navy tracksuit with white stripes, worn trainers; hired muscle | an empty executor who only drove and believed he was helping people move; thick neck, boxer's build, a scared, uncomprehending look | `assets/ep01/faces/accomplice.webp` | neutral, scared |
| `clerk` | Раиса Львовна, архив БТИ | woman, 60, short grey hair, glasses, stern mouth; grey cardigan over a floral blouse, brown skirt, a cardboard box of index cards in her arms; archive clerk | the mistress of the archive: strictness as a form of care, a mocking mouth; short grey hair, glasses | `assets/ep01/faces/clerk.webp` | neutral |

### `sledak` — Андрей Громов

FACE (портрет-референс, 1:1, без референсов; в базовом промпте строка про 16:9 заменяется на «Square composition 1:1, one frame, without borders.»):

```
SCENE

Location and time: Moscow, autumn 1993, daytime. An identity portrait made by the television crew for continuity: the person stands against a plain, evenly lit beige wall of an ordinary office corridor; nothing else is in the frame.
People and action: Investigator Andrei Gromov (man, 29, lean, tired grey eyes, short dark hair, a day of stubble; grey wool coat over a dark sweater, folder under his arm; prosecutor's investigator, 1993 Moscow), alone. An introvert who trusts paperwork and patience and is ashamed of pressing people; tired grey eyes, a face that listens more than it speaks. The face is straight to the camera, neutral, mouth closed, eyes to the lens, hair and clothing exactly as described; a real, ordinary, slightly asymmetrical face, not a model's. Exactly one person, head and shoulders.
Camera position: A television camera at the eye level of the person, a 50 mm-equivalent field of view, a medium close-up: the head and shoulders fill the frame with a little headroom, the horizon straight, the wall in focus behind.
Light sources: soft overcast window light from the front-left and a plain ceiling fixture; no separate face lighting.
Essential objects: none: the plain wall only.
```

SPRITE (база для выражений; Reference 1 — файл лица):

```
REFERENCE IMAGES
Reference 1 is the face of Investigator Andrei Gromov: keep this exact face, hair and build.

SCENE

Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).
People and action: Full-body portrait for a visual novel character sprite: Investigator Andrei Gromov (man, 29, lean, tired grey eyes, short dark hair, a day of stubble; grey wool coat over a dark sweater, folder under his arm; prosecutor's investigator, 1993 Moscow). The person stands in a three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture, whole body in frame including shoes, neutral expression, mouth closed. The face is exactly the face of the reference portrait.
Camera position: a television camera at chest height, a 40 mm-equivalent field of view, the whole figure in frame with headroom.
Light sources: soft overcast window light from the front-left.
Essential objects: none.
```

### `sledak_old` — Андрей Громов, 2004 год

FACE (портрет-референс, 1:1, без референсов; в базовом промпте строка про 16:9 заменяется на «Square composition 1:1, one frame, without borders.»):

```
SCENE

Location and time: Moscow, autumn 1993, daytime. An identity portrait made by the television crew for continuity: the person stands against a plain, evenly lit beige wall of an ordinary office corridor; nothing else is in the frame.
People and action: Andrei Gromov in 2004 (the same man at 40: heavier, grey at the temples, lines around the eyes; dark blazer, open collar), alone. The same man as Investigator Andrei Gromov eleven years later: heavier, grey at the temples, lines around the eyes, quiet grief without self-pity. The face is straight to the camera, neutral, mouth closed, eyes to the lens, hair and clothing exactly as described; a real, ordinary, slightly asymmetrical face, not a model's. Exactly one person, head and shoulders.
Camera position: A television camera at the eye level of the person, a 50 mm-equivalent field of view, a medium close-up: the head and shoulders fill the frame with a little headroom, the horizon straight, the wall in focus behind.
Light sources: soft overcast window light from the front-left and a plain ceiling fixture; no separate face lighting.
Essential objects: none: the plain wall only.
```

SPRITE (база для выражений; Reference 1 — файл лица):

```
REFERENCE IMAGES
Reference 1 is the face of Andrei Gromov in 2004: keep this exact face, hair and build.

SCENE

Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).
People and action: Full-body portrait for a visual novel character sprite: Andrei Gromov in 2004 (the same man at 40: heavier, grey at the temples, lines around the eyes; dark blazer, open collar). The person stands in a three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture, whole body in frame including shoes, neutral expression, mouth closed. The face is exactly the face of the reference portrait.
Camera position: a television camera at chest height, a 40 mm-equivalent field of view, the whole figure in frame with headroom.
Light sources: soft overcast window light from the front-left.
Essential objects: none.
```

### `oper` — Виктор Сайко

FACE (портрет-референс, 1:1, без референсов; в базовом промпте строка про 16:9 заменяется на «Square composition 1:1, one frame, without borders.»):

```
SCENE

Location and time: Moscow, autumn 1993, daytime. An identity portrait made by the television crew for continuity: the person stands against a plain, evenly lit beige wall of an ordinary office corridor; nothing else is in the frame.
People and action: Detective Viktor Sayko (man, 34, stocky, broken nose, close-cropped hair; black leather jacket, knitted sweater, jeans; criminal police detective), alone. An extrovert street detective who can talk to anyone; a teasing half-smile held back, a face that has been hit and did not mind. The face is straight to the camera, neutral, mouth closed, eyes to the lens, hair and clothing exactly as described; a real, ordinary, slightly asymmetrical face, not a model's. Exactly one person, head and shoulders.
Camera position: A television camera at the eye level of the person, a 50 mm-equivalent field of view, a medium close-up: the head and shoulders fill the frame with a little headroom, the horizon straight, the wall in focus behind.
Light sources: soft overcast window light from the front-left and a plain ceiling fixture; no separate face lighting.
Essential objects: none: the plain wall only.
```

SPRITE (база для выражений; Reference 1 — файл лица):

```
REFERENCE IMAGES
Reference 1 is the face of Detective Viktor Sayko: keep this exact face, hair and build.

SCENE

Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).
People and action: Full-body portrait for a visual novel character sprite: Detective Viktor Sayko (man, 34, stocky, broken nose, close-cropped hair; black leather jacket, knitted sweater, jeans; criminal police detective). The person stands in a three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture, whole body in frame including shoes, neutral expression, mouth closed. The face is exactly the face of the reference portrait.
Camera position: a television camera at chest height, a 40 mm-equivalent field of view, the whole figure in frame with headroom.
Light sources: soft overcast window light from the front-left.
Essential objects: none.
```

### `expert` — Нина Левина

FACE (портрет-референс, 1:1, без референсов; в базовом промпте строка про 16:9 заменяется на «Square composition 1:1, one frame, without borders.»):

```
SCENE

Location and time: Moscow, autumn 1993, daytime. An identity portrait made by the television crew for continuity: the person stands against a plain, evenly lit beige wall of an ordinary office corridor; nothing else is in the frame.
People and action: forensic expert Nina Levina (woman, 45, sharp features, glasses on a chain, hair in a bun; white lab coat over a cardigan; forensic expert), alone. A rational observer with dry irony, tired of expert reports being read only after verdicts; sharp attentive eyes behind glasses on a chain. The face is straight to the camera, neutral, mouth closed, eyes to the lens, hair and clothing exactly as described; a real, ordinary, slightly asymmetrical face, not a model's. Exactly one person, head and shoulders.
Camera position: A television camera at the eye level of the person, a 50 mm-equivalent field of view, a medium close-up: the head and shoulders fill the frame with a little headroom, the horizon straight, the wall in focus behind.
Light sources: soft overcast window light from the front-left and a plain ceiling fixture; no separate face lighting.
Essential objects: none: the plain wall only.
```

SPRITE (база для выражений; Reference 1 — файл лица):

```
REFERENCE IMAGES
Reference 1 is the face of forensic expert Nina Levina: keep this exact face, hair and build.

SCENE

Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).
People and action: Full-body portrait for a visual novel character sprite: forensic expert Nina Levina (woman, 45, sharp features, glasses on a chain, hair in a bun; white lab coat over a cardigan; forensic expert). The person stands in a three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture, whole body in frame including shoes, neutral expression, mouth closed. The face is exactly the face of the reference portrait.
Camera position: a television camera at chest height, a 40 mm-equivalent field of view, the whole figure in frame with headroom.
Light sources: soft overcast window light from the front-left.
Essential objects: none.
```

### `murashov` — Сергей Мурашов

FACE (портрет-референс, 1:1, без референсов; в базовом промпте строка про 16:9 заменяется на «Square composition 1:1, one frame, without borders.»):

```
SCENE

Location and time: Moscow, autumn 1993, daytime. An identity portrait made by the television crew for continuity: the person stands against a plain, evenly lit beige wall of an ordinary office corridor; nothing else is in the frame.
People and action: Sergei Murashov (man, 38, tall, neat, pleasant forgettable face, well-groomed moustache; good grey suit slightly too new, briefcase; former journalist turned apartment dealer; deliberately ordinary, not charismatic), alone. A narcissistic rationalizer who calls himself an orderly; polite, calm, with an editor's composure; a pleasant, instantly forgettable face. The face is straight to the camera, neutral, mouth closed, eyes to the lens, hair and clothing exactly as described; a real, ordinary, slightly asymmetrical face, not a model's. Exactly one person, head and shoulders.
Camera position: A television camera at the eye level of the person, a 50 mm-equivalent field of view, a medium close-up: the head and shoulders fill the frame with a little headroom, the horizon straight, the wall in focus behind.
Light sources: soft overcast window light from the front-left and a plain ceiling fixture; no separate face lighting.
Essential objects: none: the plain wall only.
```

SPRITE (база для выражений; Reference 1 — файл лица):

```
REFERENCE IMAGES
Reference 1 is the face of Sergei Murashov: keep this exact face, hair and build.

SCENE

Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).
People and action: Full-body portrait for a visual novel character sprite: Sergei Murashov (man, 38, tall, neat, pleasant forgettable face, well-groomed moustache; good grey suit slightly too new, briefcase; former journalist turned apartment dealer; deliberately ordinary, not charismatic). The person stands in a three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture, whole body in frame including shoes, neutral expression, mouth closed. The face is exactly the face of the reference portrait.
Camera position: a television camera at chest height, a 40 mm-equivalent field of view, the whole figure in frame with headroom.
Light sources: soft overcast window light from the front-left.
Essential objects: none.
```

### `notary` — Нотариус Ковригин

FACE (портрет-референс, 1:1, без референсов; в базовом промпте строка про 16:9 заменяется на «Square composition 1:1, one frame, without borders.»):

```
SCENE

Location and time: Moscow, autumn 1993, daytime. An identity portrait made by the television crew for continuity: the person stands against a plain, evenly lit beige wall of an ordinary office corridor; nothing else is in the frame.
People and action: notary Kovrigin (man, 55, soft, balding, sweating; brown suit, tie askew; notary), alone. A cowardly accomplice hiding behind the law; soft, balding, sweating, eyes that avoid contact. The face is straight to the camera, neutral, mouth closed, eyes to the lens, hair and clothing exactly as described; a real, ordinary, slightly asymmetrical face, not a model's. Exactly one person, head and shoulders.
Camera position: A television camera at the eye level of the person, a 50 mm-equivalent field of view, a medium close-up: the head and shoulders fill the frame with a little headroom, the horizon straight, the wall in focus behind.
Light sources: soft overcast window light from the front-left and a plain ceiling fixture; no separate face lighting.
Essential objects: none: the plain wall only.
```

SPRITE (база для выражений; Reference 1 — файл лица):

```
REFERENCE IMAGES
Reference 1 is the face of notary Kovrigin: keep this exact face, hair and build.

SCENE

Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).
People and action: Full-body portrait for a visual novel character sprite: notary Kovrigin (man, 55, soft, balding, sweating; brown suit, tie askew; notary). The person stands in a three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture, whole body in frame including shoes, neutral expression, mouth closed. The face is exactly the face of the reference portrait.
Camera position: a television camera at chest height, a 40 mm-equivalent field of view, the whole figure in frame with headroom.
Light sources: soft overcast window light from the front-left.
Essential objects: none.
```

### `zoya` — Зоя Павловна

FACE (портрет-референс, 1:1, без референсов; в базовом промпте строка про 16:9 заменяется на «Square composition 1:1, one frame, without borders.»):

```
SCENE

Location and time: Moscow, autumn 1993, daytime. An identity portrait made by the television crew for continuity: the person stands against a plain, evenly lit beige wall of an ordinary office corridor; nothing else is in the frame.
People and action: Zoya Pavlovna, an elderly pensioner (woman, 74, small, kind face, white hair under a knitted beret; Sunday coat with a fur collar, handbag; pensioner), alone. Trusting and kind, shy of being a burden, lonely; a small bright face that lights up at the thought of her grandson. The face is straight to the camera, neutral, mouth closed, eyes to the lens, hair and clothing exactly as described; a real, ordinary, slightly asymmetrical face, not a model's. Exactly one person, head and shoulders.
Camera position: A television camera at the eye level of the person, a 50 mm-equivalent field of view, a medium close-up: the head and shoulders fill the frame with a little headroom, the horizon straight, the wall in focus behind.
Light sources: soft overcast window light from the front-left and a plain ceiling fixture; no separate face lighting.
Essential objects: none: the plain wall only.
```

SPRITE (база для выражений; Reference 1 — файл лица):

```
REFERENCE IMAGES
Reference 1 is the face of Zoya Pavlovna, an elderly pensioner: keep this exact face, hair and build.

SCENE

Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).
People and action: Full-body portrait for a visual novel character sprite: Zoya Pavlovna, an elderly pensioner (woman, 74, small, kind face, white hair under a knitted beret; Sunday coat with a fur collar, handbag; pensioner). The person stands in a three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture, whole body in frame including shoes, neutral expression, mouth closed. The face is exactly the face of the reference portrait.
Camera position: a television camera at chest height, a 40 mm-equivalent field of view, the whole figure in frame with headroom.
Light sources: soft overcast window light from the front-left.
Essential objects: none.
```

### `neighbor` — Галина, соседка

FACE (портрет-референс, 1:1, без референсов; в базовом промпте строка про 16:9 заменяется на «Square composition 1:1, one frame, without borders.»):

```
SCENE

Location and time: Moscow, autumn 1993, daytime. An identity portrait made by the television crew for continuity: the person stands against a plain, evenly lit beige wall of an ordinary office corridor; nothing else is in the frame.
People and action: Galina, the neighbour (woman, 60, sturdy, flowered housecoat and cardigan, glass milk bottle in hand; neighbour), alone. Observant and pushy until it concerns herself, then afraid of being involved; a sturdy face used to talking in stairwells. The face is straight to the camera, neutral, mouth closed, eyes to the lens, hair and clothing exactly as described; a real, ordinary, slightly asymmetrical face, not a model's. Exactly one person, head and shoulders.
Camera position: A television camera at the eye level of the person, a 50 mm-equivalent field of view, a medium close-up: the head and shoulders fill the frame with a little headroom, the horizon straight, the wall in focus behind.
Light sources: soft overcast window light from the front-left and a plain ceiling fixture; no separate face lighting.
Essential objects: none: the plain wall only.
```

SPRITE (база для выражений; Reference 1 — файл лица):

```
REFERENCE IMAGES
Reference 1 is the face of Galina, the neighbour: keep this exact face, hair and build.

SCENE

Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).
People and action: Full-body portrait for a visual novel character sprite: Galina, the neighbour (woman, 60, sturdy, flowered housecoat and cardigan, glass milk bottle in hand; neighbour). The person stands in a three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture, whole body in frame including shoes, neutral expression, mouth closed. The face is exactly the face of the reference portrait.
Camera position: a television camera at chest height, a 40 mm-equivalent field of view, the whole figure in frame with headroom.
Light sources: soft overcast window light from the front-left.
Essential objects: none.
```

### `buyer` — Лапин

FACE (портрет-референс, 1:1, без референсов; в базовом промпте строка про 16:9 заменяется на «Square composition 1:1, one frame, without borders.»):

```
SCENE

Location and time: Moscow, autumn 1993, daytime. An identity portrait made by the television crew for continuity: the person stands against a plain, evenly lit beige wall of an ordinary office corridor; nothing else is in the frame.
People and action: Lapin, the new tenant (man, 40, thin, anxious, cheap suit jacket over a sweater; family man who bought the apartment), alone. An honest man under a steamroller: polite confusion turning into panic; thin, anxious, early lines on the face. The face is straight to the camera, neutral, mouth closed, eyes to the lens, hair and clothing exactly as described; a real, ordinary, slightly asymmetrical face, not a model's. Exactly one person, head and shoulders.
Camera position: A television camera at the eye level of the person, a 50 mm-equivalent field of view, a medium close-up: the head and shoulders fill the frame with a little headroom, the horizon straight, the wall in focus behind.
Light sources: soft overcast window light from the front-left and a plain ceiling fixture; no separate face lighting.
Essential objects: none: the plain wall only.
```

SPRITE (база для выражений; Reference 1 — файл лица):

```
REFERENCE IMAGES
Reference 1 is the face of Lapin, the new tenant: keep this exact face, hair and build.

SCENE

Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).
People and action: Full-body portrait for a visual novel character sprite: Lapin, the new tenant (man, 40, thin, anxious, cheap suit jacket over a sweater; family man who bought the apartment). The person stands in a three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture, whole body in frame including shoes, neutral expression, mouth closed. The face is exactly the face of the reference portrait.
Camera position: a television camera at chest height, a 40 mm-equivalent field of view, the whole figure in frame with headroom.
Light sources: soft overcast window light from the front-left.
Essential objects: none.
```

### `boss` — Валентин Павлович

FACE (портрет-референс, 1:1, без референсов; в базовом промпте строка про 16:9 заменяется на «Square composition 1:1, one frame, without borders.»):

```
SCENE

Location and time: Moscow, autumn 1993, daytime. An identity portrait made by the television crew for continuity: the person stands against a plain, evenly lit beige wall of an ordinary office corridor; nothing else is in the frame.
People and action: Valentin Pavlovich, head of the investigative department (man, 55, heavy, jowly face, grey hair combed back; dark navy suit, white shirt, patterned tie; head of the investigative department), alone. Not a villain: a department head who keeps the place afloat, fatherly and tired; heavy jowls, eyes that have made many compromises. The face is straight to the camera, neutral, mouth closed, eyes to the lens, hair and clothing exactly as described; a real, ordinary, slightly asymmetrical face, not a model's. Exactly one person, head and shoulders.
Camera position: A television camera at the eye level of the person, a 50 mm-equivalent field of view, a medium close-up: the head and shoulders fill the frame with a little headroom, the horizon straight, the wall in focus behind.
Light sources: soft overcast window light from the front-left and a plain ceiling fixture; no separate face lighting.
Essential objects: none: the plain wall only.
```

SPRITE (база для выражений; Reference 1 — файл лица):

```
REFERENCE IMAGES
Reference 1 is the face of Valentin Pavlovich, head of the investigative department: keep this exact face, hair and build.

SCENE

Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).
People and action: Full-body portrait for a visual novel character sprite: Valentin Pavlovich, head of the investigative department (man, 55, heavy, jowly face, grey hair combed back; dark navy suit, white shirt, patterned tie; head of the investigative department). The person stands in a three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture, whole body in frame including shoes, neutral expression, mouth closed. The face is exactly the face of the reference portrait.
Camera position: a television camera at chest height, a 40 mm-equivalent field of view, the whole figure in frame with headroom.
Light sources: soft overcast window light from the front-left.
Essential objects: none.
```

### `lapin_wife` — Ирина Лапина

FACE (портрет-референс, 1:1, без референсов; в базовом промпте строка про 16:9 заменяется на «Square composition 1:1, one frame, without borders.»):

```
SCENE

Location and time: Moscow, autumn 1993, daytime. An identity portrait made by the television crew for continuity: the person stands against a plain, evenly lit beige wall of an ordinary office corridor; nothing else is in the frame.
People and action: Irina Lapina (woman, 40, thin, pale, tired eyes, hair pulled back in a low bun; beige cardigan over a plain dark grey dress; wife of a missing man), alone. A mother defending her home: she holds longer than her husband and breaks deeper; pale, tired eyes, hair pulled back. The face is straight to the camera, neutral, mouth closed, eyes to the lens, hair and clothing exactly as described; a real, ordinary, slightly asymmetrical face, not a model's. Exactly one person, head and shoulders.
Camera position: A television camera at the eye level of the person, a 50 mm-equivalent field of view, a medium close-up: the head and shoulders fill the frame with a little headroom, the horizon straight, the wall in focus behind.
Light sources: soft overcast window light from the front-left and a plain ceiling fixture; no separate face lighting.
Essential objects: none: the plain wall only.
```

SPRITE (база для выражений; Reference 1 — файл лица):

```
REFERENCE IMAGES
Reference 1 is the face of Irina Lapina: keep this exact face, hair and build.

SCENE

Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).
People and action: Full-body portrait for a visual novel character sprite: Irina Lapina (woman, 40, thin, pale, tired eyes, hair pulled back in a low bun; beige cardigan over a plain dark grey dress; wife of a missing man). The person stands in a three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture, whole body in frame including shoes, neutral expression, mouth closed. The face is exactly the face of the reference portrait.
Camera position: a television camera at chest height, a 40 mm-equivalent field of view, the whole figure in frame with headroom.
Light sources: soft overcast window light from the front-left.
Essential objects: none.
```

### `accomplice` — Дмитрий Шмелёв («Шмель»)

FACE (портрет-референс, 1:1, без референсов; в базовом промпте строка про 16:9 заменяется на «Square composition 1:1, one frame, without borders.»):

```
SCENE

Location and time: Moscow, autumn 1993, daytime. An identity portrait made by the television crew for continuity: the person stands against a plain, evenly lit beige wall of an ordinary office corridor; nothing else is in the frame.
People and action: Dmitry Shmelyov (Shmel), the accomplice (man, 30, thick neck, boxer's build, short dark hair; black padded jacket over a navy tracksuit with white stripes, worn trainers; hired muscle), alone. An empty executor who only drove and believed he was helping people move; thick neck, boxer's build, a scared, uncomprehending look. The face is straight to the camera, neutral, mouth closed, eyes to the lens, hair and clothing exactly as described; a real, ordinary, slightly asymmetrical face, not a model's. Exactly one person, head and shoulders.
Camera position: A television camera at the eye level of the person, a 50 mm-equivalent field of view, a medium close-up: the head and shoulders fill the frame with a little headroom, the horizon straight, the wall in focus behind.
Light sources: soft overcast window light from the front-left and a plain ceiling fixture; no separate face lighting.
Essential objects: none: the plain wall only.
```

SPRITE (база для выражений; Reference 1 — файл лица):

```
REFERENCE IMAGES
Reference 1 is the face of Dmitry Shmelyov (Shmel), the accomplice: keep this exact face, hair and build.

SCENE

Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).
People and action: Full-body portrait for a visual novel character sprite: Dmitry Shmelyov (Shmel), the accomplice (man, 30, thick neck, boxer's build, short dark hair; black padded jacket over a navy tracksuit with white stripes, worn trainers; hired muscle). The person stands in a three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture, whole body in frame including shoes, neutral expression, mouth closed. The face is exactly the face of the reference portrait.
Camera position: a television camera at chest height, a 40 mm-equivalent field of view, the whole figure in frame with headroom.
Light sources: soft overcast window light from the front-left.
Essential objects: none.
```

### `clerk` — Раиса Львовна, архив БТИ

FACE (портрет-референс, 1:1, без референсов; в базовом промпте строка про 16:9 заменяется на «Square composition 1:1, one frame, without borders.»):

```
SCENE

Location and time: Moscow, autumn 1993, daytime. An identity portrait made by the television crew for continuity: the person stands against a plain, evenly lit beige wall of an ordinary office corridor; nothing else is in the frame.
People and action: Raisa Lvovna, the BTI archive clerk (woman, 60, short grey hair, glasses, stern mouth; grey cardigan over a floral blouse, brown skirt, a cardboard box of index cards in her arms; archive clerk), alone. The mistress of the archive: strictness as a form of care, a mocking mouth; short grey hair, glasses. The face is straight to the camera, neutral, mouth closed, eyes to the lens, hair and clothing exactly as described; a real, ordinary, slightly asymmetrical face, not a model's. Exactly one person, head and shoulders.
Camera position: A television camera at the eye level of the person, a 50 mm-equivalent field of view, a medium close-up: the head and shoulders fill the frame with a little headroom, the horizon straight, the wall in focus behind.
Light sources: soft overcast window light from the front-left and a plain ceiling fixture; no separate face lighting.
Essential objects: none: the plain wall only.
```

SPRITE (база для выражений; Reference 1 — файл лица):

```
REFERENCE IMAGES
Reference 1 is the face of Raisa Lvovna, the BTI archive clerk: keep this exact face, hair and build.

SCENE

Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).
People and action: Full-body portrait for a visual novel character sprite: Raisa Lvovna, the BTI archive clerk (woman, 60, short grey hair, glasses, stern mouth; grey cardigan over a floral blouse, brown skirt, a cardboard box of index cards in her arms; archive clerk). The person stands in a three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture, whole body in frame including shoes, neutral expression, mouth closed. The face is exactly the face of the reference portrait.
Camera position: a television camera at chest height, a 40 mm-equivalent field of view, the whole figure in frame with headroom.
Light sources: soft overcast window light from the front-left.
Essential objects: none.
```

## 3. Фоны (без людей, 16:9)

### `bg_yard_summer` — `assets/ep01/bg/yard_summer.webp`

```
SCENE

Location and time: Moscow, July 1993, dusk. courtyard of a nine-storey Soviet panel apartment block in Moscow, July evening; a wooden bench, a rusty children's climbing frame, poplar trees, a parked cherry-red Lada 2109, a row of windows where most are lit; one third-floor window is lit too, but behind unfamiliar bright new curtains.
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: wide shot from the courtyard path, building facade filling the upper half, empty foreground path; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: dusk, warm windows against blue-grey sky, one street lamp.
Essential objects: courtyard of a nine-storey Soviet panel apartment block in Moscow, July evening; a wooden bench, a rusty children's climbing frame, poplar trees, a parked cherry-red Lada 2109, a row of windows where most are lit; one third-floor window is lit too, but behind unfamiliar bright new curtains; nothing else.
```

### `bg_apartment_zoya` — `assets/ep01/bg/apartment_zoya.webp`

```
SCENE

Location and time: Moscow, August 1993, daytime. one-room apartment of an elderly Moscow pensioner, 1993: a dark polished sideboard with glass doors and a framed photo behind the glass, a carpet on the wall, lace curtains, a small TV on a stool, medicine bottles on a bedside table, folded glasses.
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: eye-level medium-wide shot from the doorway, sideboard centre-left, empty centre for characters; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: overcast daylight through tulle curtains.
Essential objects: a dark polished sideboard with glass doors and a framed photo behind the glass, a carpet on the wall, lace curtains, a small TV on a stool, medicine bottles on a bedside table, folded glasses; nothing else.
```

### `bg_moscow_1993` — `assets/ep01/bg/moscow_1993.webp`

```
SCENE

Location and time: Moscow, summer 1993, daytime. Moscow street in July 1993, hazy hot summer: a line of commercial kiosks with closed metal shutters, a few people in light summer clothes waiting at a bus stop, a trolleybus, a Soviet panel apartment block facade, poplar trees in full green leaf, dusty dry asphalt, poplar fluff in the air; the season must read clearly as summer (no snow, no slush, no coats, no bare trees).
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: wide establishing shot, slightly high angle; a clean photographic frame (the archive_photo look is added by the runtime filter); people small and distant, nobody in the foreground; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: flat hazy overcast summer daylight.
Essential objects: a line of commercial kiosks with closed metal shutters, a few people in light summer clothes waiting at a bus stop, a trolleybus, a Soviet panel apartment block facade, poplar trees in full green leaf, dusty dry asphalt, poplar fluff in the air; the season must read clearly as summer (no snow, no slush, no coats, no bare trees); nothing else.
```

### `bg_moscow_1994` — `assets/ep01/bg/moscow_1994.webp`

```
SCENE

Location and time: Moscow, winter 1994, daytime. Moscow street in 1993: a line of commercial kiosks with closed shutters, people in coats at a bus stop, a trolleybus, a Soviet apartment block facade, slush on the pavement.
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: wide establishing shot, slightly high angle; a clean photographic frame (the archive_photo look is added by the runtime filter); a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: flat grey winter daylight.
Essential objects: a line of commercial kiosks with closed shutters, people in coats at a bus stop, a trolleybus, a Soviet apartment block facade, slush on the pavement; nothing else.
```

### `bg_office_prosecutor` — `assets/ep01/bg/office_prosecutor.webp`

```
SCENE

Location and time: Moscow, autumn 1993, daytime. investigator's office in a district prosecutor's building, 1993: a heavy desk with a green-shaded lamp, a black mechanical typewriter, stacks of cardboard case folders tied with string, a grey metal safe, a wall calendar, a window with a radiator.
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: medium-wide, desk in the lower third but uncluttered, empty centre for two characters; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: afternoon window light plus warm desk lamp.
Essential objects: a heavy desk with a green-shaded lamp, a black mechanical typewriter, stacks of cardboard case folders tied with string, a grey metal safe, a wall calendar, a window with a radiator; nothing else.
```

### `bg_interrogation` — `assets/ep01/bg/interrogation.webp`

```
SCENE

Location and time: Moscow, autumn 1993, daytime. small interrogation room in a Moscow militia station, 1993: bare table, two chairs, a single lamp, painted half-wall in dark green, barred window high up.
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: symmetrical frontal shot, table centred low, empty wall behind for a character; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: one desk lamp plus cold daylight from the small window, realistic shadows (the noir look is added by the runtime filter).
Essential objects: bare table, two chairs, a single lamp, painted half-wall in dark green, barred window high up; nothing else.
```

### `bg_stairwell` — `assets/ep01/bg/stairwell.webp`

```
SCENE

Location and time: Moscow, August 1993, evening. stairwell landing of a Soviet panel apartment block in Moscow, 1993: a row of dented metal mailboxes, an old lift door, a padded apartment door with a new brass lock, concrete steps with a worn railing, a window with a cracked pane.
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: eye-level shot of the landing, the apartment door centre-right, empty centre for one or two characters; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: a bare bulb overhead plus grey daylight from the window.
Essential objects: a row of dented metal mailboxes, an old lift door, a padded apartment door with a new brass lock, concrete steps with a worn railing, a window with a cracked pane; nothing else.
```

### `bg_bti_archive` — `assets/ep01/bg/bti_archive.webp`

```
SCENE

Location and time: Moscow, autumn 1993, daytime. municipal technical inventory bureau archive: long rows of grey metal filing cabinets and wooden card drawers, a reading table with a green lamp, boxes of index cards.
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: corridor perspective between cabinets, table in the lower right, centre free; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: fluorescent tubes, dusty air.
Essential objects: long rows of grey metal filing cabinets and wooden card drawers, a reading table with a green lamp, boxes of index cards; nothing else.
```

### `bg_street_night` — `assets/ep01/bg/street_night.webp`

```
SCENE

Location and time: Moscow, October 1993, night in rain. narrow Moscow street at night in October rain outside a notary office on the ground floor of an old building, wet asphalt reflections, a Volga sedan parked, a dim doorway.
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: wide shot from across the street, doorway centre-right, empty left side; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: one sodium street lamp, warm office window.
Essential objects: narrow Moscow street at night in October rain outside a notary office on the ground floor of an old building, wet asphalt reflections, a Volga sedan parked, a dim doorway; nothing else.
```

### `bg_notary_office` — `assets/ep01/bg/notary_office.webp`

```
SCENE

Location and time: Moscow, summer 1993, daytime. a small notary office on the ground floor of an old Moscow building, 1993: a heavy desk with a green desk lamp, stacks of papers, a round stamp and an ink pad, a glass-fronted bookcase with law volumes, a coat rack, a half-open door to a corridor where a queue waits.
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: medium-wide shot at eye level, desk in the lower third, the space behind the desk empty for a seated notary and a standing visitor; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: warm desk lamp against grey window light.
Essential objects: a heavy desk with a green desk lamp, stacks of papers, a round stamp and an ink pad, a glass-fronted bookcase with law volumes, a coat rack, a half-open door to a corridor where a queue waits; nothing else.
```

### `bg_courtroom` — `assets/ep01/bg/courtroom.webp`

```
SCENE

Location and time: Moscow, winter 1994, daytime. Russian city courtroom, mid-1990s: wooden judge's bench with a coat-of-arms silhouette left blank, a metal defendant's cage at the side, rows of benches, tall windows.
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: wide frontal shot, bench centred, cage on the left; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: cold daylight.
Essential objects: wooden judge's bench with a coat-of-arms silhouette left blank, a metal defendant's cage at the side, rows of benches, tall windows; nothing else.
```

### `bg_office_now` — `assets/ep01/bg/office_now.webp`

```
SCENE

Location and time: Moscow, 2004, daytime. the same investigator's office in 2004: a beige computer monitor, a cordless phone, the same safe and folders, blinds instead of curtains.
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: medium shot, chair centred for a talking-head interview; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: soft window light.
Essential objects: a beige computer monitor, a cordless phone, the same safe and folders, blinds instead of curtains; nothing else.
```

### `bg_zhek` — `assets/ep01/bg/zhek.webp`

```
SCENE

Location and time: Moscow, autumn 1993, daytime. corridor of a Moscow housing office (ZhEK), 1993: a queue of people's coats on hooks and a bench, a cork notice board covered in blank paper slips, a small service window with a wooden shutter half open, pale green oil-painted walls, a potted plant on the windowsill.
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: corridor perspective, window centre-right in the middle distance, empty foreground for two characters; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: fluorescent tube plus grey window light.
Essential objects: a queue of people's coats on hooks and a bench, a cork notice board covered in blank paper slips, a small service window with a wooden shutter half open, pale green oil-painted walls, a potted plant on the windowsill; nothing else.
```

### `bg_street_day` — `assets/ep01/bg/street_day.webp`

```
SCENE

Location and time: Moscow, autumn 1993, daytime. Presnya street in Moscow by day, 1993, seen from inside a parked Lada 2109 through the windscreen: the ground-floor notary office opposite with a brass plate and heavy door, a black Volga sedan parked outside, pedestrians in coats, a kiosk, slush at the kerb; dashboard and wipers framing the bottom edge.
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: wide shot through the windscreen, office entrance centre, dashboard in the lower fifth; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: flat overcast daylight.
Essential objects: the ground-floor notary office opposite with a brass plate and heavy door, a black Volga sedan parked outside, pedestrians in coats, a kiosk, slush at the kerb; dashboard and wipers framing the bottom edge; nothing else.
```

### `bg_murashov_flat` — `assets/ep01/bg/murashov_flat.webp`

```
SCENE

Location and time: Moscow, October 1993, night. living room of a well-off Moscow operator's apartment, 1993: a desk with three telephones, stacks of cardboard folders, a cordless phone on a charger, an imported TV, new furniture mixed with old, a window overlooking a black Volga in the street below.
People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.
Camera position: medium-wide shot, desk in the lower left, window centre-right, empty centre for two characters; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).
Light sources: cold daylight from the window, one desk lamp.
Essential objects: a desk with three telephones, stacks of cardboard folders, a cordless phone on a charger, an imported TV, new furniture mixed with old, a window overlooking a black Volga in the street below; nothing else.
```

## 4. CG (16:9)

### `cg_door_sealed`

```
SCENE

Location and time: Moscow, 1993–1994. close-up of an apartment door on a Soviet stairwell landing, a fresh paper seal with a blurred stamp across the door frame, a new brass lock, a worn doormat, mailbox row in the background.
People and action: as described in the location: people, if any, are small, turned away or hidden by distance and weather; faces of named characters are the faces of their reference portraits.
Camera position: tight shot, door filling the frame, seal in the centre; a television camera, 32–45 mm-equivalent, the horizon straight.
Light sources: stairwell bulb, cold.
Essential objects: close-up of an apartment door on a Soviet stairwell landing, a fresh paper seal with a blurred stamp across the door frame, a new brass lock, a worn doormat, mailbox row in the background; nothing else.
```

### `cg_arrest_night`

```
SCENE

Location and time: Moscow, 1993–1994. night street in rain, a militia UAZ with its roof light on, two silhouettes of men in leather jackets leading a third man in a coat toward the car, faces hidden by rain and distance.
People and action: as described in the location: people, if any, are small, turned away or hidden by distance and weather; faces of named characters are the faces of their reference portraits.
Camera position: wide, figures small in the centre, reflections dominate; a television camera, 32–45 mm-equivalent, the horizon straight.
Light sources: flashing blue, sodium lamp.
Essential objects: night street in rain, a militia UAZ with its roof light on, two silhouettes of men in leather jackets leading a third man in a coat toward the car, faces hidden by rain and distance; nothing else.
```

### `cg_verdict`

```
SCENE

Location and time: Moscow, 1993–1994. view from the public benches of a courtroom: the back of a man's head behind cage bars, a judge's silhouette far away, a woman's hand clutching a folded handkerchief in the foreground.
People and action: as described in the location: people, if any, are small, turned away or hidden by distance and weather; faces of named characters are the faces of their reference portraits.
Camera position: shallow focus on the hand, cage soft in the middle; a television camera, 32–45 mm-equivalent, the horizon straight.
Light sources: cold daylight.
Essential objects: the back of a man's head behind cage bars, a judge's silhouette far away, a woman's hand clutching a folded handkerchief in the foreground; nothing else.
```

## 5. Документы и UI (промпт `objects.md`, OBJECT BRIEF)

- `doc_power_of_attorney`: blank Soviet notarial power-of-attorney form on yellowed paper, typewriter rules, two blurred purple round stamps, a signature line, no readable text
- `doc_contract_sale`: blank two-page sale contract form, stapled, dotted lines for names and amounts, one blurred stamp, no readable text
- `doc_bti_card`: blank technical inventory index card, grey cardboard, table grid, a hole punched at the top, pencil marks, no readable text
- `doc_newspaper_1994`: front page of a Moscow evening newspaper, 1994: masthead as a black bar without letters, columns as grey text blocks, one photo as a grey rectangle, no readable text
- `ui_title_plate`: black background, a single horizontal crimson-red plate slightly off-centre, faint CRT scanlines and static noise, no text (16:9)
- `ui_menu_video_salon`: 1993 video rental corner: a CRT television on a shelf, rows of VHS cassettes in plastic cases with blank labels, a cheap armchair, a curtain; no text (16:9)
- `ui_case_folder`: top-down texture of a grey cardboard case folder tied with white string, worn corners, no text (16:9)

Для документов текст накладывает рантайм (`text_key`); бриф по `objects.md`: реальный бланк эпохи как construction reference, вывод — flat scan 3:4 без читаемых букв.

## 6. Кадры покрытия по сетам

| сет | фон | время | сцены | кадров | файл промтов |
|---|---|---|---|---|---|
| yard | `bg_yard_summer` | evening | s01, s10 | 8 | `ep01-final-prompts-shots-yard.md` |
| stairwell | `bg_stairwell` | evening | s02, s03, s15, s15_q, s15_w1, s15_w2, s15_r | 28 | `ep01-final-prompts-shots-stairwell.md` |
| zhek | `bg_zhek` | day | s07 | 14 | `ep01-final-prompts-shots-zhek.md` |
| apartment_zoya | `bg_apartment_zoya` | day | s08, s13, s14, s13b, s14b | 35 | `ep01-final-prompts-shots-apartment_zoya.md` |
| notary | `bg_notary_office` | day | s09, s16, s29, s09b, s16b, s16c, s29b, s16b_q, s16b_w1, s16b_w2, s16b_r | 29 | `ep01-final-prompts-shots-notary.md` |
| office_day | `bg_office_prosecutor` | day | s11, s12, s18, s19, s22, s23, s27, s12b, s18b, s22b, s23b, s27b | 41 | `ep01-final-prompts-shots-office_day.md` |
| office_evening | `bg_office_prosecutor` | evening | s17, s26, s26b | 25 | `ep01-final-prompts-shots-office_evening.md` |
| interrogation | `bg_interrogation` | day | s20, s21, s38, s39, s40, s41, s20b, s38b, s38c, s40b, s40c, s41b, s20b_q, s20b_w1, s20b_w2, s20b_r | 39 | `ep01-final-prompts-shots-interrogation.md` |
| bti | `bg_bti_archive` | day | s24, s25, s24b | 21 | `ep01-final-prompts-shots-bti.md` |
| street_day | `bg_street_day` | day | s28, s28b | 19 | `ep01-final-prompts-shots-street_day.md` |
| office_now | `bg_office_now` | day | s30 | 9 | `ep01-final-prompts-shots-office_now.md` |
| office_night | `bg_office_prosecutor` | night | s31, s32, s33, s42, s31b, s31c, s33b, s42b, s42c | 27 | `ep01-final-prompts-shots-office_night.md` |
| street_night | `bg_street_night` | night | s34, s35, s36, s36a, s36b, s34b, s36a2, s36b2 | 24 | `ep01-final-prompts-shots-street_night.md` |
| murashov_flat | `bg_murashov_flat` | night | s37 | 14 | `ep01-final-prompts-shots-murashov_flat.md` |

