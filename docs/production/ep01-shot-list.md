# Шот-лист эпизода 1 по сетам

Всего кадров по плану: 331; по кредиту за кадр (gpt_image_2_5 medium/2k).
Сгенерировано `tools/shot_plan.py` по эпизоду: сет = фон × время суток; состав, пары собеседников и выражения —
из сцен. Промпты — `assets/ep01/shots/plan.json` (база стайл-библии §1 с блоком CAMERA §1a, PHOTOGRAPHIC REALISM,
CONTINUITY и референсами фона и спрайтов). Каждый кадр после генерации просматривается; брак перегенерируется.

## yard — `bg_yard_summer`, evening: сцены s01, s10; реплик 2; кадров 8

| id | kind | angle | состав (выражение) | from → focus |
|---|---|---|---|---|
| `sh_yard_wide_1` | wide | eye | neighbor (neutral) | — |
| `sh_yard_medium_1` | medium | eye | neighbor (neutral) | — |
| `sh_yard_close_neighbor_worried` | close | eye | neighbor (worried) | — → neighbor |
| `sh_yard_reaction_neighbor` | reaction | eye | neighbor (neutral) | — → neighbor |
| `sh_yard_insert_1` | insert | eye | — | — |
| `sh_yard_angle_low` | angle | low | neighbor (neutral) | — |
| `sh_yard_angle_high` | angle | high | neighbor (neutral) | — |
| `sh_yard_angle_doorway` | angle | doorway | neighbor (neutral) | — |

## stairwell — `bg_stairwell`, evening: сцены s02, s03, s15; реплик 22; кадров 26

| id | kind | angle | состав (выражение) | from → focus |
|---|---|---|---|---|
| `sh_stairwell_wide_1` | wide | eye | neighbor (neutral), oper (neutral), sledak (neutral) | — |
| `sh_stairwell_wide_2` | wide | eye | buyer_unknown (neutral), neighbor (neutral) | — |
| `sh_stairwell_wide_3` | wide | eye | neighbor (neutral) | — |
| `sh_stairwell_medium_1` | medium | eye | neighbor (neutral), oper (neutral), sledak (neutral) | — |
| `sh_stairwell_medium_2` | medium | eye | buyer_unknown (neutral), neighbor (neutral) | — |
| `sh_stairwell_medium_3` | medium | eye | neighbor (neutral) | — |
| `sh_stairwell_ots_neighbor_buyer_unknown` | ots | eye | buyer_unknown (neutral), neighbor (neutral) | neighbor → buyer_unknown |
| `sh_stairwell_ots_buyer_unknown_neighbor` | ots | eye | neighbor (neutral), buyer_unknown (neutral) | buyer_unknown → neighbor |
| `sh_stairwell_ots_neighbor_sledak` | ots | eye | sledak (neutral), neighbor (neutral) | neighbor → sledak |
| `sh_stairwell_ots_sledak_neighbor` | ots | eye | neighbor (neutral), sledak (neutral) | sledak → neighbor |
| `sh_stairwell_ots_oper_neighbor` | ots | eye | neighbor (neutral), oper (neutral) | oper → neighbor |
| `sh_stairwell_ots_neighbor_oper` | ots | eye | oper (neutral), neighbor (neutral) | neighbor → oper |
| `sh_stairwell_close_neighbor_worried` | close | eye | neighbor (worried) | — → neighbor |
| `sh_stairwell_close_buyer_unknown_neutral` | close | eye | buyer_unknown (neutral) | — → buyer_unknown |
| `sh_stairwell_close_oper_neutral` | close | eye | oper (neutral) | — → oper |
| `sh_stairwell_close_neighbor_neutral` | close | eye | neighbor (neutral) | — → neighbor |
| `sh_stairwell_close_sledak_neutral` | close | eye | sledak (neutral) | — → sledak |
| `sh_stairwell_reaction_neighbor` | reaction | eye | neighbor (neutral) | — → neighbor |
| `sh_stairwell_reaction_oper` | reaction | eye | oper (neutral) | — → oper |
| `sh_stairwell_reaction_sledak` | reaction | eye | sledak (neutral) | — → sledak |
| `sh_stairwell_reaction_buyer_unknown` | reaction | eye | buyer_unknown (neutral) | — → buyer_unknown |
| `sh_stairwell_insert_1` | insert | eye | — | — |
| `sh_stairwell_insert_2` | insert | eye | — | — |
| `sh_stairwell_angle_low` | angle | low | neighbor (neutral), oper (neutral), sledak (neutral) | — |
| `sh_stairwell_angle_high` | angle | high | neighbor (neutral), oper (neutral), sledak (neutral) | — |
| `sh_stairwell_angle_doorway` | angle | doorway | neighbor (neutral), oper (neutral), sledak (neutral) | — |

## zhek — `bg_zhek`, day: сцены s07; реплик 7; кадров 14

| id | kind | angle | состав (выражение) | from → focus |
|---|---|---|---|---|
| `sh_zhek_wide_1` | wide | eye | murashov_sil (neutral), zoya (neutral) | — |
| `sh_zhek_wide_2` | wide | eye | zoya (neutral) | — |
| `sh_zhek_medium_1` | medium | eye | murashov_sil (neutral), zoya (neutral) | — |
| `sh_zhek_medium_2` | medium | eye | zoya (neutral) | — |
| `sh_zhek_ots_zoya_murashov_sil` | ots | eye | murashov_sil (neutral), zoya (neutral) | zoya → murashov_sil |
| `sh_zhek_ots_murashov_sil_zoya` | ots | eye | zoya (neutral), murashov_sil (neutral) | murashov_sil → zoya |
| `sh_zhek_close_zoya_warm` | close | eye | zoya (warm) | — → zoya |
| `sh_zhek_close_zoya_worried` | close | eye | zoya (worried) | — → zoya |
| `sh_zhek_reaction_zoya` | reaction | eye | zoya (neutral) | — → zoya |
| `sh_zhek_insert_1` | insert | eye | — | — |
| `sh_zhek_insert_2` | insert | eye | — | — |
| `sh_zhek_angle_low` | angle | low | murashov_sil (neutral), zoya (neutral) | — |
| `sh_zhek_angle_high` | angle | high | murashov_sil (neutral), zoya (neutral) | — |
| `sh_zhek_angle_doorway` | angle | doorway | murashov_sil (neutral), zoya (neutral) | — |

## apartment_zoya — `bg_apartment_zoya`, day: сцены s08, s13, s14, s13b, s14b; реплик 35; кадров 35

| id | kind | angle | состав (выражение) | from → focus |
|---|---|---|---|---|
| `sh_apartment_zoya_wide_1` | wide | eye | murashov_sil (neutral), zoya (neutral) | — |
| `sh_apartment_zoya_wide_2` | wide | eye | expert (neutral), sledak (neutral) | — |
| `sh_apartment_zoya_wide_3` | wide | eye | lapin_wife (neutral), sledak (neutral) | — |
| `sh_apartment_zoya_wide_4` | wide | eye | buyer (neutral), lapin_wife (neutral), sledak (neutral) | — |
| `sh_apartment_zoya_medium_1` | medium | eye | murashov_sil (neutral), zoya (neutral) | — |
| `sh_apartment_zoya_medium_2` | medium | eye | expert (neutral), sledak (neutral) | — |
| `sh_apartment_zoya_medium_3` | medium | eye | lapin_wife (neutral), sledak (neutral) | — |
| `sh_apartment_zoya_medium_4` | medium | eye | buyer (neutral), lapin_wife (neutral), sledak (neutral) | — |
| `sh_apartment_zoya_ots_zoya_murashov_sil` | ots | eye | murashov_sil (neutral), zoya (neutral) | zoya → murashov_sil |
| `sh_apartment_zoya_ots_murashov_sil_zoya` | ots | eye | zoya (neutral), murashov_sil (neutral) | murashov_sil → zoya |
| `sh_apartment_zoya_ots_expert_sledak` | ots | eye | sledak (neutral), expert (neutral) | expert → sledak |
| `sh_apartment_zoya_ots_sledak_expert` | ots | eye | expert (neutral), sledak (neutral) | sledak → expert |
| `sh_apartment_zoya_ots_buyer_lapin_wife` | ots | eye | lapin_wife (neutral), buyer (neutral) | buyer → lapin_wife |
| `sh_apartment_zoya_ots_lapin_wife_sledak` | ots | eye | sledak (neutral), lapin_wife (neutral) | lapin_wife → sledak |
| `sh_apartment_zoya_ots_sledak_lapin_wife` | ots | eye | lapin_wife (neutral), sledak (neutral) | sledak → lapin_wife |
| `sh_apartment_zoya_ots_lapin_wife_buyer` | ots | eye | buyer (neutral), lapin_wife (neutral) | lapin_wife → buyer |
| `sh_apartment_zoya_close_lapin_wife_worried` | close | eye | lapin_wife (worried) | — → lapin_wife |
| `sh_apartment_zoya_close_buyer_neutral` | close | eye | buyer (neutral) | — → buyer |
| `sh_apartment_zoya_close_expert_focused` | close | eye | expert (focused) | — → expert |
| `sh_apartment_zoya_close_zoya_warm` | close | eye | zoya (warm) | — → zoya |
| `sh_apartment_zoya_close_expert_neutral` | close | eye | expert (neutral) | — → expert |
| `sh_apartment_zoya_close_zoya_worried` | close | eye | zoya (worried) | — → zoya |
| `sh_apartment_zoya_close_sledak_tired` | close | eye | sledak (tired) | — → sledak |
| `sh_apartment_zoya_close_sledak_tense` | close | eye | sledak (tense) | — → sledak |
| `sh_apartment_zoya_close_sledak_neutral` | close | eye | sledak (neutral) | — → sledak |
| `sh_apartment_zoya_close_sledak_firm` | close | eye | sledak (firm) | — → sledak |
| `sh_apartment_zoya_reaction_sledak` | reaction | eye | sledak (neutral) | — → sledak |
| `sh_apartment_zoya_reaction_lapin_wife` | reaction | eye | lapin_wife (neutral) | — → lapin_wife |
| `sh_apartment_zoya_reaction_zoya` | reaction | eye | zoya (neutral) | — → zoya |
| `sh_apartment_zoya_reaction_expert` | reaction | eye | expert (neutral) | — → expert |
| `sh_apartment_zoya_insert_1` | insert | eye | — | — |
| `sh_apartment_zoya_insert_2` | insert | eye | — | — |
| `sh_apartment_zoya_angle_low` | angle | low | murashov_sil (neutral), zoya (neutral) | — |
| `sh_apartment_zoya_angle_high` | angle | high | murashov_sil (neutral), zoya (neutral) | — |
| `sh_apartment_zoya_angle_doorway` | angle | doorway | murashov_sil (neutral), zoya (neutral) | — |

## notary — `bg_notary_office`, day: сцены s09, s16, s29, s09b, s16b, s16c, s29b; реплик 55; кадров 29

| id | kind | angle | состав (выражение) | from → focus |
|---|---|---|---|---|
| `sh_notary_wide_1` | wide | eye | notary (neutral), oper (neutral), sledak (neutral) | — |
| `sh_notary_wide_2` | wide | eye | murashov_sil (neutral), notary (neutral), zoya (neutral) | — |
| `sh_notary_medium_1` | medium | eye | notary (neutral), oper (neutral), sledak (neutral) | — |
| `sh_notary_medium_2` | medium | eye | murashov_sil (neutral), notary (neutral), zoya (neutral) | — |
| `sh_notary_ots_notary_oper` | ots | eye | oper (neutral), notary (neutral) | notary → oper |
| `sh_notary_ots_oper_notary` | ots | eye | notary (neutral), oper (neutral) | oper → notary |
| `sh_notary_ots_sledak_notary` | ots | eye | notary (neutral), sledak (neutral) | sledak → notary |
| `sh_notary_ots_notary_sledak` | ots | eye | sledak (neutral), notary (neutral) | notary → sledak |
| `sh_notary_ots_zoya_notary` | ots | eye | notary (neutral), zoya (neutral) | zoya → notary |
| `sh_notary_ots_oper_sledak` | ots | eye | sledak (neutral), oper (neutral) | oper → sledak |
| `sh_notary_ots_notary_zoya` | ots | eye | zoya (neutral), notary (neutral) | notary → zoya |
| `sh_notary_ots_notary_murashov_sil` | ots | eye | murashov_sil (neutral), notary (neutral) | notary → murashov_sil |
| `sh_notary_close_notary_nervous` | close | eye | notary (nervous) | — → notary |
| `sh_notary_close_oper_grin` | close | eye | oper (grin) | — → oper |
| `sh_notary_close_notary_neutral` | close | eye | notary (neutral) | — → notary |
| `sh_notary_close_oper_neutral` | close | eye | oper (neutral) | — → oper |
| `sh_notary_close_sledak_firm` | close | eye | sledak (firm) | — → sledak |
| `sh_notary_close_zoya_worried` | close | eye | zoya (worried) | — → zoya |
| `sh_notary_close_sledak_neutral` | close | eye | sledak (neutral) | — → sledak |
| `sh_notary_close_zoya_warm` | close | eye | zoya (warm) | — → zoya |
| `sh_notary_reaction_notary` | reaction | eye | notary (neutral) | — → notary |
| `sh_notary_reaction_oper` | reaction | eye | oper (neutral) | — → oper |
| `sh_notary_reaction_sledak` | reaction | eye | sledak (neutral) | — → sledak |
| `sh_notary_reaction_zoya` | reaction | eye | zoya (neutral) | — → zoya |
| `sh_notary_insert_1` | insert | eye | — | — |
| `sh_notary_insert_2` | insert | eye | — | — |
| `sh_notary_angle_low` | angle | low | notary (neutral), oper (neutral), sledak (neutral) | — |
| `sh_notary_angle_high` | angle | high | notary (neutral), oper (neutral), sledak (neutral) | — |
| `sh_notary_angle_doorway` | angle | doorway | notary (neutral), oper (neutral), sledak (neutral) | — |

## office_day — `bg_office_prosecutor`, day: сцены s11, s12, s18, s19, s22, s23, s27, s12b, s18b, s22b, s23b, s27b; реплик 118; кадров 41

| id | kind | angle | состав (выражение) | from → focus |
|---|---|---|---|---|
| `sh_office_day_wide_1` | wide | eye | oper (neutral), sledak (neutral) | — |
| `sh_office_day_wide_2` | wide | eye | expert (neutral), oper (neutral), sledak (neutral) | — |
| `sh_office_day_wide_3` | wide | eye | boss (neutral), sledak (neutral) | — |
| `sh_office_day_wide_4` | wide | eye | lapin_wife (neutral), sledak (neutral) | — |
| `sh_office_day_medium_1` | medium | eye | oper (neutral), sledak (neutral) | — |
| `sh_office_day_medium_2` | medium | eye | expert (neutral), oper (neutral), sledak (neutral) | — |
| `sh_office_day_medium_3` | medium | eye | boss (neutral), sledak (neutral) | — |
| `sh_office_day_medium_4` | medium | eye | lapin_wife (neutral), sledak (neutral) | — |
| `sh_office_day_ots_oper_sledak` | ots | eye | sledak (neutral), oper (neutral) | oper → sledak |
| `sh_office_day_ots_sledak_oper` | ots | eye | oper (neutral), sledak (neutral) | sledak → oper |
| `sh_office_day_ots_expert_oper` | ots | eye | oper (neutral), expert (neutral) | expert → oper |
| `sh_office_day_ots_oper_expert` | ots | eye | expert (neutral), oper (neutral) | oper → expert |
| `sh_office_day_ots_lapin_wife_sledak` | ots | eye | sledak (neutral), lapin_wife (neutral) | lapin_wife → sledak |
| `sh_office_day_ots_boss_sledak` | ots | eye | sledak (neutral), boss (neutral) | boss → sledak |
| `sh_office_day_ots_sledak_boss` | ots | eye | boss (neutral), sledak (neutral) | sledak → boss |
| `sh_office_day_ots_sledak_lapin_wife` | ots | eye | lapin_wife (neutral), sledak (neutral) | sledak → lapin_wife |
| `sh_office_day_close_oper_neutral` | close | eye | oper (neutral) | — → oper |
| `sh_office_day_close_oper_grin` | close | eye | oper (grin) | — → oper |
| `sh_office_day_close_expert_focused` | close | eye | expert (focused) | — → expert |
| `sh_office_day_close_sledak_tense` | close | eye | sledak (tense) | — → sledak |
| `sh_office_day_close_sledak_firm` | close | eye | sledak (firm) | — → sledak |
| `sh_office_day_close_sledak_neutral` | close | eye | sledak (neutral) | — → sledak |
| `sh_office_day_close_lapin_wife_worried` | close | eye | lapin_wife (worried) | — → lapin_wife |
| `sh_office_day_close_expert_neutral` | close | eye | expert (neutral) | — → expert |
| `sh_office_day_close_boss_stern` | close | eye | boss (stern) | — → boss |
| `sh_office_day_close_sledak_tired` | close | eye | sledak (tired) | — → sledak |
| `sh_office_day_close_boss_tired` | close | eye | boss (tired) | — → boss |
| `sh_office_day_close_lapin_wife_angry` | close | eye | lapin_wife (angry) | — → lapin_wife |
| `sh_office_day_close_oper_angry` | close | eye | oper (angry) | — → oper |
| `sh_office_day_close_boss_neutral` | close | eye | boss (neutral) | — → boss |
| `sh_office_day_close_lapin_wife_neutral` | close | eye | lapin_wife (neutral) | — → lapin_wife |
| `sh_office_day_reaction_sledak` | reaction | eye | sledak (neutral) | — → sledak |
| `sh_office_day_reaction_oper` | reaction | eye | oper (neutral) | — → oper |
| `sh_office_day_reaction_expert` | reaction | eye | expert (neutral) | — → expert |
| `sh_office_day_reaction_boss` | reaction | eye | boss (neutral) | — → boss |
| `sh_office_day_reaction_lapin_wife` | reaction | eye | lapin_wife (neutral) | — → lapin_wife |
| `sh_office_day_insert_1` | insert | eye | — | — |
| `sh_office_day_insert_2` | insert | eye | — | — |
| `sh_office_day_angle_low` | angle | low | oper (neutral), sledak (neutral) | — |
| `sh_office_day_angle_high` | angle | high | oper (neutral), sledak (neutral) | — |
| `sh_office_day_angle_doorway` | angle | doorway | oper (neutral), sledak (neutral) | — |

## office_evening — `bg_office_prosecutor`, evening: сцены s17, s26, s26b; реплик 26; кадров 25

| id | kind | angle | состав (выражение) | from → focus |
|---|---|---|---|---|
| `sh_office_evening_wide_1` | wide | eye | oper (neutral), sledak (neutral) | — |
| `sh_office_evening_wide_2` | wide | eye | expert (neutral), sledak (neutral) | — |
| `sh_office_evening_wide_3` | wide | eye | sledak (neutral) | — |
| `sh_office_evening_medium_1` | medium | eye | oper (neutral), sledak (neutral) | — |
| `sh_office_evening_medium_2` | medium | eye | expert (neutral), sledak (neutral) | — |
| `sh_office_evening_medium_3` | medium | eye | sledak (neutral) | — |
| `sh_office_evening_ots_sledak_expert` | ots | eye | expert (neutral), sledak (neutral) | sledak → expert |
| `sh_office_evening_ots_sledak_oper` | ots | eye | oper (neutral), sledak (neutral) | sledak → oper |
| `sh_office_evening_ots_expert_sledak` | ots | eye | sledak (neutral), expert (neutral) | expert → sledak |
| `sh_office_evening_ots_oper_sledak` | ots | eye | sledak (neutral), oper (neutral) | oper → sledak |
| `sh_office_evening_close_oper_neutral` | close | eye | oper (neutral) | — → oper |
| `sh_office_evening_close_expert_focused` | close | eye | expert (focused) | — → expert |
| `sh_office_evening_close_sledak_tense` | close | eye | sledak (tense) | — → sledak |
| `sh_office_evening_close_oper_grin` | close | eye | oper (grin) | — → oper |
| `sh_office_evening_close_sledak_firm` | close | eye | sledak (firm) | — → sledak |
| `sh_office_evening_close_sledak_tired` | close | eye | sledak (tired) | — → sledak |
| `sh_office_evening_close_expert_neutral` | close | eye | expert (neutral) | — → expert |
| `sh_office_evening_reaction_sledak` | reaction | eye | sledak (neutral) | — → sledak |
| `sh_office_evening_reaction_oper` | reaction | eye | oper (neutral) | — → oper |
| `sh_office_evening_reaction_expert` | reaction | eye | expert (neutral) | — → expert |
| `sh_office_evening_insert_1` | insert | eye | — | — |
| `sh_office_evening_insert_2` | insert | eye | — | — |
| `sh_office_evening_angle_low` | angle | low | oper (neutral), sledak (neutral) | — |
| `sh_office_evening_angle_high` | angle | high | oper (neutral), sledak (neutral) | — |
| `sh_office_evening_angle_doorway` | angle | doorway | oper (neutral), sledak (neutral) | — |

## interrogation — `bg_interrogation`, day: сцены s20, s21, s38, s39, s40, s41, s20b, s38b, s38c, s40b, s40c, s41b; реплик 81; кадров 39

| id | kind | angle | состав (выражение) | from → focus |
|---|---|---|---|---|
| `sh_interrogation_wide_1` | wide | eye | murashov (neutral), oper (neutral), sledak (neutral) | — |
| `sh_interrogation_wide_2` | wide | eye | buyer (neutral), oper (neutral), sledak (neutral) | — |
| `sh_interrogation_wide_3` | wide | eye | murashov (neutral), notary (neutral), sledak (neutral) | — |
| `sh_interrogation_wide_4` | wide | eye | murashov (neutral), sledak (neutral) | — |
| `sh_interrogation_medium_1` | medium | eye | murashov (neutral), oper (neutral), sledak (neutral) | — |
| `sh_interrogation_medium_2` | medium | eye | buyer (neutral), oper (neutral), sledak (neutral) | — |
| `sh_interrogation_medium_3` | medium | eye | murashov (neutral), notary (neutral), sledak (neutral) | — |
| `sh_interrogation_medium_4` | medium | eye | murashov (neutral), sledak (neutral) | — |
| `sh_interrogation_ots_sledak_murashov` | ots | eye | murashov (neutral), sledak (neutral) | sledak → murashov |
| `sh_interrogation_ots_murashov_sledak` | ots | eye | sledak (neutral), murashov (neutral) | murashov → sledak |
| `sh_interrogation_ots_oper_sledak` | ots | eye | sledak (neutral), oper (neutral) | oper → sledak |
| `sh_interrogation_ots_buyer_oper` | ots | eye | oper (neutral), buyer (neutral) | buyer → oper |
| `sh_interrogation_ots_sledak_oper` | ots | eye | oper (neutral), sledak (neutral) | sledak → oper |
| `sh_interrogation_ots_sledak_notary` | ots | eye | notary (neutral), sledak (neutral) | sledak → notary |
| `sh_interrogation_ots_oper_buyer` | ots | eye | buyer (neutral), oper (neutral) | oper → buyer |
| `sh_interrogation_ots_murashov_oper` | ots | eye | oper (neutral), murashov (neutral) | murashov → oper |
| `sh_interrogation_close_murashov_neutral` | close | eye | murashov (neutral) | — → murashov |
| `sh_interrogation_close_sledak_firm` | close | eye | sledak (firm) | — → sledak |
| `sh_interrogation_close_sledak_tense` | close | eye | sledak (tense) | — → sledak |
| `sh_interrogation_close_oper_angry` | close | eye | oper (angry) | — → oper |
| `sh_interrogation_close_buyer_scared` | close | eye | buyer (scared) | — → buyer |
| `sh_interrogation_close_notary_nervous` | close | eye | notary (nervous) | — → notary |
| `sh_interrogation_close_oper_neutral` | close | eye | oper (neutral) | — → oper |
| `sh_interrogation_close_murashov_cold` | close | eye | murashov (cold) | — → murashov |
| `sh_interrogation_close_sledak_neutral` | close | eye | sledak (neutral) | — → sledak |
| `sh_interrogation_close_notary_neutral` | close | eye | notary (neutral) | — → notary |
| `sh_interrogation_close_murashov_smile` | close | eye | murashov (smile) | — → murashov |
| `sh_interrogation_close_murashov_cornered` | close | eye | murashov (cornered) | — → murashov |
| `sh_interrogation_close_oper_grin` | close | eye | oper (grin) | — → oper |
| `sh_interrogation_reaction_sledak` | reaction | eye | sledak (neutral) | — → sledak |
| `sh_interrogation_reaction_oper` | reaction | eye | oper (neutral) | — → oper |
| `sh_interrogation_reaction_murashov` | reaction | eye | murashov (neutral) | — → murashov |
| `sh_interrogation_reaction_buyer` | reaction | eye | buyer (neutral) | — → buyer |
| `sh_interrogation_reaction_notary` | reaction | eye | notary (neutral) | — → notary |
| `sh_interrogation_insert_1` | insert | eye | — | — |
| `sh_interrogation_insert_2` | insert | eye | — | — |
| `sh_interrogation_angle_low` | angle | low | murashov (neutral), oper (neutral), sledak (neutral) | — |
| `sh_interrogation_angle_high` | angle | high | murashov (neutral), oper (neutral), sledak (neutral) | — |
| `sh_interrogation_angle_doorway` | angle | doorway | murashov (neutral), oper (neutral), sledak (neutral) | — |

## bti — `bg_bti_archive`, day: сцены s24, s25, s24b; реплик 22; кадров 21

| id | kind | angle | состав (выражение) | from → focus |
|---|---|---|---|---|
| `sh_bti_wide_1` | wide | eye | clerk (neutral), expert (neutral), sledak (neutral) | — |
| `sh_bti_medium_1` | medium | eye | clerk (neutral), expert (neutral), sledak (neutral) | — |
| `sh_bti_ots_clerk_expert` | ots | eye | expert (neutral), clerk (neutral) | clerk → expert |
| `sh_bti_ots_expert_clerk` | ots | eye | clerk (neutral), expert (neutral) | expert → clerk |
| `sh_bti_ots_expert_sledak` | ots | eye | sledak (neutral), expert (neutral) | expert → sledak |
| `sh_bti_ots_sledak_expert` | ots | eye | expert (neutral), sledak (neutral) | sledak → expert |
| `sh_bti_ots_sledak_clerk` | ots | eye | clerk (neutral), sledak (neutral) | sledak → clerk |
| `sh_bti_ots_clerk_sledak` | ots | eye | sledak (neutral), clerk (neutral) | clerk → sledak |
| `sh_bti_close_expert_neutral` | close | eye | expert (neutral) | — → expert |
| `sh_bti_close_clerk_neutral` | close | eye | clerk (neutral) | — → clerk |
| `sh_bti_close_expert_focused` | close | eye | expert (focused) | — → expert |
| `sh_bti_close_sledak_tense` | close | eye | sledak (tense) | — → sledak |
| `sh_bti_close_sledak_neutral` | close | eye | sledak (neutral) | — → sledak |
| `sh_bti_reaction_clerk` | reaction | eye | clerk (neutral) | — → clerk |
| `sh_bti_reaction_expert` | reaction | eye | expert (neutral) | — → expert |
| `sh_bti_reaction_sledak` | reaction | eye | sledak (neutral) | — → sledak |
| `sh_bti_insert_1` | insert | eye | — | — |
| `sh_bti_insert_2` | insert | eye | — | — |
| `sh_bti_angle_low` | angle | low | clerk (neutral), expert (neutral), sledak (neutral) | — |
| `sh_bti_angle_high` | angle | high | clerk (neutral), expert (neutral), sledak (neutral) | — |
| `sh_bti_angle_doorway` | angle | doorway | clerk (neutral), expert (neutral), sledak (neutral) | — |

## street_day — `bg_street_day`, day: сцены s28, s28b; реплик 18; кадров 19

| id | kind | angle | состав (выражение) | from → focus |
|---|---|---|---|---|
| `sh_street_day_wide_1` | wide | eye | oper (neutral), sledak (neutral) | — |
| `sh_street_day_wide_2` | wide | eye | accomplice (neutral), murashov (neutral), oper (neutral) | — |
| `sh_street_day_medium_1` | medium | eye | oper (neutral), sledak (neutral) | — |
| `sh_street_day_medium_2` | medium | eye | accomplice (neutral), murashov (neutral), oper (neutral) | — |
| `sh_street_day_ots_oper_sledak` | ots | eye | sledak (neutral), oper (neutral) | oper → sledak |
| `sh_street_day_ots_sledak_oper` | ots | eye | oper (neutral), sledak (neutral) | sledak → oper |
| `sh_street_day_close_oper_neutral` | close | eye | oper (neutral) | — → oper |
| `sh_street_day_close_oper_grin` | close | eye | oper (grin) | — → oper |
| `sh_street_day_close_sledak_tense` | close | eye | sledak (tense) | — → sledak |
| `sh_street_day_close_sledak_firm` | close | eye | sledak (firm) | — → sledak |
| `sh_street_day_reaction_oper` | reaction | eye | oper (neutral) | — → oper |
| `sh_street_day_reaction_sledak` | reaction | eye | sledak (neutral) | — → sledak |
| `sh_street_day_reaction_accomplice` | reaction | eye | accomplice (neutral) | — → accomplice |
| `sh_street_day_reaction_murashov` | reaction | eye | murashov (neutral) | — → murashov |
| `sh_street_day_insert_1` | insert | eye | — | — |
| `sh_street_day_insert_2` | insert | eye | — | — |
| `sh_street_day_angle_low` | angle | low | oper (neutral), sledak (neutral) | — |
| `sh_street_day_angle_high` | angle | high | oper (neutral), sledak (neutral) | — |
| `sh_street_day_angle_doorway` | angle | doorway | oper (neutral), sledak (neutral) | — |

## office_now — `bg_office_now`, day: сцены s30; реплик 5; кадров 9

| id | kind | angle | состав (выражение) | from → focus |
|---|---|---|---|---|
| `sh_office_now_wide_1` | wide | eye | sledak_old (neutral) | — |
| `sh_office_now_medium_1` | medium | eye | sledak_old (neutral) | — |
| `sh_office_now_close_sledak_old_neutral` | close | eye | sledak_old (neutral) | — → sledak_old |
| `sh_office_now_close_sledak_old_sad` | close | eye | sledak_old (sad) | — → sledak_old |
| `sh_office_now_reaction_sledak_old` | reaction | eye | sledak_old (neutral) | — → sledak_old |
| `sh_office_now_insert_1` | insert | eye | — | — |
| `sh_office_now_angle_low` | angle | low | sledak_old (neutral) | — |
| `sh_office_now_angle_high` | angle | high | sledak_old (neutral) | — |
| `sh_office_now_angle_doorway` | angle | doorway | sledak_old (neutral) | — |

## office_night — `bg_office_prosecutor`, night: сцены s31, s32, s33, s42, s31b, s31c, s33b, s42b, s42c; реплик 112; кадров 27

| id | kind | angle | состав (выражение) | from → focus |
|---|---|---|---|---|
| `sh_office_night_wide_1` | wide | eye | expert (neutral), oper (neutral), sledak (neutral) | — |
| `sh_office_night_wide_2` | wide | eye | oper (neutral), sledak (neutral) | — |
| `sh_office_night_medium_1` | medium | eye | expert (neutral), oper (neutral), sledak (neutral) | — |
| `sh_office_night_medium_2` | medium | eye | oper (neutral), sledak (neutral) | — |
| `sh_office_night_ots_oper_sledak` | ots | eye | sledak (neutral), oper (neutral) | oper → sledak |
| `sh_office_night_ots_sledak_oper` | ots | eye | oper (neutral), sledak (neutral) | sledak → oper |
| `sh_office_night_ots_oper_expert` | ots | eye | expert (neutral), oper (neutral) | oper → expert |
| `sh_office_night_ots_expert_oper` | ots | eye | oper (neutral), expert (neutral) | expert → oper |
| `sh_office_night_ots_expert_sledak` | ots | eye | sledak (neutral), expert (neutral) | expert → sledak |
| `sh_office_night_ots_sledak_expert` | ots | eye | expert (neutral), sledak (neutral) | sledak → expert |
| `sh_office_night_close_oper_neutral` | close | eye | oper (neutral) | — → oper |
| `sh_office_night_close_oper_grin` | close | eye | oper (grin) | — → oper |
| `sh_office_night_close_expert_focused` | close | eye | expert (focused) | — → expert |
| `sh_office_night_close_sledak_firm` | close | eye | sledak (firm) | — → sledak |
| `sh_office_night_close_sledak_tired` | close | eye | sledak (tired) | — → sledak |
| `sh_office_night_close_oper_angry` | close | eye | oper (angry) | — → oper |
| `sh_office_night_close_sledak_tense` | close | eye | sledak (tense) | — → sledak |
| `sh_office_night_close_sledak_neutral` | close | eye | sledak (neutral) | — → sledak |
| `sh_office_night_close_expert_neutral` | close | eye | expert (neutral) | — → expert |
| `sh_office_night_reaction_oper` | reaction | eye | oper (neutral) | — → oper |
| `sh_office_night_reaction_sledak` | reaction | eye | sledak (neutral) | — → sledak |
| `sh_office_night_reaction_expert` | reaction | eye | expert (neutral) | — → expert |
| `sh_office_night_insert_1` | insert | eye | — | — |
| `sh_office_night_insert_2` | insert | eye | — | — |
| `sh_office_night_angle_low` | angle | low | expert (neutral), oper (neutral), sledak (neutral) | — |
| `sh_office_night_angle_high` | angle | high | expert (neutral), oper (neutral), sledak (neutral) | — |
| `sh_office_night_angle_doorway` | angle | doorway | expert (neutral), oper (neutral), sledak (neutral) | — |

## street_night — `bg_street_night`, night: сцены s34, s35, s36, s36a, s36b, s34b, s36a2, s36b2; реплик 44; кадров 24

| id | kind | angle | состав (выражение) | from → focus |
|---|---|---|---|---|
| `sh_street_night_wide_1` | wide | eye | oper (neutral), sledak (neutral) | — |
| `sh_street_night_wide_2` | wide | eye | accomplice (neutral), oper (neutral), sledak (neutral) | — |
| `sh_street_night_medium_1` | medium | eye | oper (neutral), sledak (neutral) | — |
| `sh_street_night_medium_2` | medium | eye | accomplice (neutral), oper (neutral), sledak (neutral) | — |
| `sh_street_night_ots_oper_sledak` | ots | eye | sledak (neutral), oper (neutral) | oper → sledak |
| `sh_street_night_ots_sledak_oper` | ots | eye | oper (neutral), sledak (neutral) | sledak → oper |
| `sh_street_night_ots_accomplice_oper` | ots | eye | oper (neutral), accomplice (neutral) | accomplice → oper |
| `sh_street_night_ots_sledak_accomplice` | ots | eye | accomplice (neutral), sledak (neutral) | sledak → accomplice |
| `sh_street_night_close_oper_neutral` | close | eye | oper (neutral) | — → oper |
| `sh_street_night_close_oper_grin` | close | eye | oper (grin) | — → oper |
| `sh_street_night_close_oper_hurt` | close | eye | oper (hurt) | — → oper |
| `sh_street_night_close_accomplice_scared` | close | eye | accomplice (scared) | — → accomplice |
| `sh_street_night_close_sledak_tense` | close | eye | sledak (tense) | — → sledak |
| `sh_street_night_close_oper_angry` | close | eye | oper (angry) | — → oper |
| `sh_street_night_close_sledak_firm` | close | eye | sledak (firm) | — → sledak |
| `sh_street_night_close_sledak_neutral` | close | eye | sledak (neutral) | — → sledak |
| `sh_street_night_reaction_oper` | reaction | eye | oper (neutral) | — → oper |
| `sh_street_night_reaction_sledak` | reaction | eye | sledak (neutral) | — → sledak |
| `sh_street_night_reaction_accomplice` | reaction | eye | accomplice (neutral) | — → accomplice |
| `sh_street_night_insert_1` | insert | eye | — | — |
| `sh_street_night_insert_2` | insert | eye | — | — |
| `sh_street_night_angle_low` | angle | low | oper (neutral), sledak (neutral) | — |
| `sh_street_night_angle_high` | angle | high | oper (neutral), sledak (neutral) | — |
| `sh_street_night_angle_doorway` | angle | doorway | oper (neutral), sledak (neutral) | — |

## murashov_flat — `bg_murashov_flat`, night: сцены s37; реплик 8; кадров 14

| id | kind | angle | состав (выражение) | from → focus |
|---|---|---|---|---|
| `sh_murashov_flat_wide_1` | wide | eye | expert (neutral), sledak (neutral) | — |
| `sh_murashov_flat_medium_1` | medium | eye | expert (neutral), sledak (neutral) | — |
| `sh_murashov_flat_ots_expert_sledak` | ots | eye | sledak (neutral), expert (neutral) | expert → sledak |
| `sh_murashov_flat_ots_sledak_expert` | ots | eye | expert (neutral), sledak (neutral) | sledak → expert |
| `sh_murashov_flat_close_expert_focused` | close | eye | expert (focused) | — → expert |
| `sh_murashov_flat_close_sledak_neutral` | close | eye | sledak (neutral) | — → sledak |
| `sh_murashov_flat_close_sledak_tense` | close | eye | sledak (tense) | — → sledak |
| `sh_murashov_flat_reaction_expert` | reaction | eye | expert (neutral) | — → expert |
| `sh_murashov_flat_reaction_sledak` | reaction | eye | sledak (neutral) | — → sledak |
| `sh_murashov_flat_insert_1` | insert | eye | — | — |
| `sh_murashov_flat_insert_2` | insert | eye | — | — |
| `sh_murashov_flat_angle_low` | angle | low | expert (neutral), sledak (neutral) | — |
| `sh_murashov_flat_angle_high` | angle | high | expert (neutral), sledak (neutral) | — |
| `sh_murashov_flat_angle_doorway` | angle | doorway | expert (neutral), sledak (neutral) | — |

