# Режим «Воспоминания»: стиль кадров (промпт владельца, 2026-10-13)

Промпт и негатив — дословно от владельца. Генератор `tools/hod/memory.py` берёт из них разделы:

- **кадр сцены** (перерисовка кадра «Реализма»): все разделы, кроме 08 и 09 — подсветку говорящего и запись VHS
  делает игра на лету (маски и шейдер), впечённые в картинку они бы ошибались на половине реплик и легли дважды;
  из раздела 13 убраны строки про подсветку и VHS, из порядка приоритетов — пункты 7 и 8;
- **лист развёртки персонажа**: 02, 03, 04, 05, 10, 12 (композиция задаётся листом, а не исходным кадром).

Негатив модели передаётся строкой «Avoid: …» в конце промпта (отдельного поля у GPT Image нет).

## Промпт

```
CINEMATIC CRIME GRAPHIC NOVEL
CLEAN INK & ANALOG VHS EDITION

Transform the provided reference image into a premium
hand-drawn cinematic graphic novel illustration.

ART DIRECTION

Combine the gritty anatomical realism and mature visual
language of dark Western crime comics such as Crossed
with the simplified shapes, controlled cel shading,
and clean visual design of sophisticated adult 2D animation.

The final image should resemble a frame from a realistic
1990s Russian crime film, meticulously redrawn by
an experienced graphic novel artist.

The result must be cinematic, atmospheric, believable,
restrained, and visually consistent.

Avoid exaggerated comic-book aesthetics.
Avoid cartoonish facial proportions.
Avoid excessive stylization.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
01. SOURCE PRESERVATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use the original image as the authoritative reference.

Preserve exactly:

- Character identities and facial likenesses
- Facial expressions and emotions
- Realistic human anatomy and body proportions
- Hairstyles, facial hair, and existing skin details
- Clothing, colors, patterns, and accessories
- Body positions and gestures
- Camera angle, perspective, and framing
- Original scene composition
- Environment and architectural details
- Furniture and object placement
- Relative proportions between objects
- Time of day
- Original light direction
- Narrative atmosphere

Do not redesign characters or environments.

Do not add or remove objects.

Do not invent facial injuries, blood, scars, bruises,
or other physical characteristics.

Only preserve injuries that are visible in
the original reference.

Characters must remain immediately recognizable.

The result must depict exactly the same scene,
translated into a different artistic medium.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
02. CHARACTER RENDERING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Maintain realistic human anatomy and proportions.

Preserve individual facial characteristics:

- Natural facial asymmetry
- Bone structure
- Brow shape
- Jawline
- Eye placement
- Nose proportions
- Mouth shape
- Hairline
- Age characteristics
- Existing wrinkles and expression lines

Do not beautify faces.

Do not exaggerate expressions.

Do not create heroic or idealized anatomy.

Use confident, clean ink contours to describe
the silhouette and important anatomical details.

Render skin using simplified anatomical planes.

Use approximately 3–5 major tonal regions
for facial volume.

Preserve realistic skin color relationships.

Use selective fine details around:

- Eyes
- Eyebrows
- Nose
- Mouth
- Important expression lines

Avoid photographic skin texture.

Avoid excessive pores, scratches,
crosshatching, and decorative wrinkles.

Faces must remain expressive and recognizable
without unnecessary graphic noise.

Use more detail on faces than anywhere else.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
03. LINE ART
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use clean, expressive, hand-drawn ink outlines.

Line weight should vary naturally.

Outer silhouettes:
Moderately thick, confident contours.

Internal details:
Thin, selective, restrained strokes.

Use charcoal, dark brown, and near-black ink.

Avoid uniformly thick black outlines.

Use lines primarily to describe:

- Silhouette
- Anatomy
- Important clothing folds
- Expression
- Structural object boundaries

Do not outline every shadow or color transition.

MINIMAL HATCHING.

Avoid dense crosshatching entirely.

Do not fill shadows with repeated strokes.

Avoid scratch-like texture.

Avoid excessive fine lines.

Dark regions should be represented primarily
through clean, large tonal shapes.

Every visible stroke must describe form
or communicate important material information.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
04. SHADING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use sophisticated semi-realistic cel shading.

Combine large graphic shadow shapes
with occasional soft tonal transitions.

Favor broad, deliberate color regions.

Use approximately:

1. Primary illuminated tone
2. Natural midtone
3. Main shadow tone
4. Deep accent shadow

Preserve realistic volume and light direction.

Avoid excessive tonal fragmentation.

DARK AREAS:

Simplify shadow regions aggressively.

Remove unnecessary internal details.

Reduce texture and line density.

Use broad, relatively uniform dark shapes.

Retain only important structural information.

Do not introduce dense hatching,
random highlights, or graphic noise.

Shadows must remain readable without
becoming completely black.

The illustration should feel detailed
in important areas and visually quiet elsewhere.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
05. COLOR PALETTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use a realistic, slightly desaturated
cinematic color palette.

Preserve the main color relationships
of the original image.

Typical colors:

- Muted olive green
- Dusty blue-gray
- Warm beige
- Faded brown
- Natural skin tones
- Weathered cream
- Charcoal
- Soft amber sunlight

Use natural warm-cool color separation.

Highlights may be slightly warmer.

Shadows may be slightly cooler.

Avoid excessive saturation.

Avoid artificial teal-and-orange grading.

Avoid neon colors.

Avoid plastic-looking gradients.

Colors should resemble carefully painted
animation backgrounds combined with
sophisticated graphic novel rendering.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
06. ENVIRONMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Preserve the original environment and its
historical authenticity.

The setting should feel like a real location
from a 1990s Russian crime drama.

Retain authentic everyday objects,
architecture, materials, and signs of use.

Do not exaggerate decay or poverty.

Do not invent environmental damage.

Render the environment with less detail
than the characters.

Use simplified textures and clean shapes.

Preserve realistic perspective and proportions.

Environmental materials must remain recognizable.

WOOD:
Simplified grain and realistic color variation.

METAL:
Broad tonal regions and restrained highlights.

FABRIC:
Simplified folds and essential patterns.

GLASS:
Natural transparency and restrained reflections.

WALLS:
Large color regions with subtle material variation.

Avoid excessive background texture.

Avoid random scratches and surface noise.

The environment should support the characters,
not compete with them.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
07. CINEMATIC LIGHTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Preserve the original lighting direction,
time of day, and atmospheric conditions.

Use natural, physically believable lighting.

For daytime interiors:

Maintain bright, recognizable daylight
entering through windows.

Preserve visible environmental illumination.

Keep natural shadow gradients.

Retain realistic reflected light.

Do not make daytime interiors look like nighttime.

Avoid excessively dramatic contrast.

Avoid crushed blacks.

Avoid artificial HDR.

Lighting should feel like a realistically
photographed crime film translated
into graphic novel color shapes.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
08. ACTIVE SPEAKER FOCUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When a character is speaking,
subtly emphasize that character
through cinematic lighting.

ENVIRONMENT DIMMING

Reduce the brightness of the surrounding
environment by approximately 10–20%.

Preserve natural daylight and realistic
visibility of background objects.

Do not strongly darken the scene.

The environment should remain clearly readable.

SPEAKER EXPOSURE

Maintain the speaker's natural skin tones.

Keep the speaker approximately at
the original exposure level.

Preserve facial detail and clothing colors.

The speaking character should be visually
clearer than the surrounding environment.

SOFT RIM LIGHT

Introduce delicate, warm-neutral directional
rim lighting around selected parts
of the speaker's silhouette.

Emphasize:

- Hair edges
- Head silhouette
- Shoulders
- Outer clothing boundaries
- Selected arm contours

The light must be consistent with
existing environmental light sources.

Use soft transitions.

The rim light should be subtle
but clearly perceptible.

Avoid a continuous uniform outline.

Avoid artificial neon halos.

Avoid white glowing borders.

Avoid digital selection effects.

The result should resemble natural
cinematic backlighting.

The viewer should immediately understand
which character is speaking without
perceiving the effect as artificial.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
09. ANALOG VHS EFFECT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Apply a subtle, authentic analog
VHS videotape aesthetic across
the entire completed illustration.

The effect should evoke a well-preserved
1990s videotape recording.

Introduce:

- Fine analog luminance noise
- Very subtle chroma noise
- Mild analog color bleeding
- Occasional faint horizontal interference
- Minimal RGB misalignment near frame edges
- Slight analog image softness
- Subtle edge distortion
- Extremely light analog grain

Preserve the clarity of the illustration.

Faces must remain clearly readable.

Do not obscure important details.

Keep the VHS effect secondary
to the illustrated art style.

Avoid:

- Heavy scanlines
- Strong chromatic aberration
- Large tracking errors
- Excessive tape scratches
- Digital glitch effects
- Strong pixelation
- Heavy noise
- Distorted facial features
- Artificial vintage filters

The VHS treatment should be barely noticeable
at first glance and become apparent
only when examining the image closely.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
10. DETAIL HIERARCHY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use deliberate visual hierarchy.

HIGHEST DETAIL:
Faces, eyes, expressions.

HIGH DETAIL:
Hands and important gestures.

MEDIUM DETAIL:
Clothing, body anatomy, important props.

LOW DETAIL:
Furniture, walls, distant objects.

MINIMAL DETAIL:
Deep shadows, peripheral areas,
unimportant background regions.

Do not apply uniform detail density.

Do not over-render dark areas.

Do not create unnecessary decorative textures.

Prioritize silhouette, volume,
composition, and emotional readability.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
11. CINEMATIC COMPOSITION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Maintain realistic film cinematography.

Preserve original camera perspective.

Respect existing depth of field.

Keep foreground and background relationships.

Use natural character framing.

Preserve realistic lens behavior.

The composition should resemble
an authentic live-action crime drama frame.

Avoid heroic angles or exaggerated
comic-book compositions unless they
already exist in the source image.

Maintain subtle, believable visual tension.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
12. FINISH AND QUALITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The result should look like a professionally
illustrated graphic novel frame.

Hand-drawn quality.

Controlled imperfections.

Clean color separation.

Natural anatomical structure.

Confident organic linework.

Realistic lighting.

Simplified materials.

Restrained cinematic color grading.

Subtle analog videotape texture.

No generic AI illustration aesthetics.

No excessive sharpness.

No artificial photographic skin details.

No over-rendering.

No unnecessary visual complexity.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
13. FINAL VISUAL TARGET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

A premium cinematic crime graphic novel frame.

Realistic anatomy.
Recognizable human faces.
Mature Western comic influence.
Sophisticated adult animation simplification.
Confident ink contours.
Large clean shadow shapes.
Minimal hatching.
Muted natural colors.
Authentic environments.
Believable daylight.
Subtle environmental dimming.
Soft directional rim light on the active speaker.
Delicate VHS texture.

The final image should feel like
a real scene from a 1990s Russian crime film
meticulously illustrated by hand.

The style must remain consistent
across different scenes, locations,
lighting conditions, and characters.

Every line must describe form.
Every shadow must support volume.
Every detail must serve the composition.

PRIORITY ORDER:

1. Source image fidelity
2. Character identity preservation
3. Realistic anatomy and proportions
4. Clean graphic novel illustration
5. Natural cinematic lighting
6. Controlled shadow simplification
7. Active speaker lighting
8. Subtle analog VHS treatment
```

## Негатив

```
anime, manga, superhero comic, chibi,
exaggerated cartoon anatomy, oversized eyes,
stylized facial proportions, generic cartoon,
Pixar, Disney 3D, glossy CGI, low-poly 3D,
plastic skin, vector illustration,
corporate illustration, generic AI art,
photorealistic skin pores, hyperrealistic textures,
dense crosshatching, excessive hatching,
scratch textures, random ink strokes,
overly detailed shadows, noisy backgrounds,
halftone dots, comic printing patterns,
excessive grain, heavy VHS distortion,
digital glitches, strong RGB separation,
heavy scanlines, chromatic artifacts,
oversaturation, HDR, extreme contrast,
crushed blacks, dark daytime scenes,
excessive vignette, neon rim lighting,
glowing character outlines,
artificial lighting, invented injuries,
blood, additional scars, bruises,
exaggerated facial wrinkles,
changed character identity, altered anatomy,
different facial features, changed hairstyle,
changed clothing, modified camera angle,
altered composition, invented environment,
excessive environmental decay,
unnecessary grunge, excessive sharpening
```
