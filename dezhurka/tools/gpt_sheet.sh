#!/usr/bin/env bash
# Лист через OpenAI Images API (модель и качество — как для всего «с людьми» в проекте: sunburst, high).
#   tools/gpt_sheet.sh <prompt.txt> <out.png> [референс.png ...]
# С референсами идёт запрос правки (/images/edits), без них — генерации (/images/generations).
# Ключ в запрос подставляет сеть сессии (сохранён в окружении для api.openai.com); рядом с картинкой
# пишется <out>.json с расходом токенов. Повторов нет: каждый вызов платный.
set -euo pipefail
prompt_file=$1; out=$2; shift 2
model=${GPT_MODEL:-gpt-image-2.6-sunburst}; quality=${GPT_QUALITY:-high}; size=${GPT_SIZE:-2048x1360}
resp=$(mktemp)
if [ $# -gt 0 ]; then
  args=(); for r in "$@"; do args+=(-F "image[]=@${r}"); done
  curl -sS -m 900 https://api.openai.com/v1/images/edits -H "Authorization: Bearer set-by-proxy" \
    -F "model=${model}" -F "size=${size}" -F "quality=${quality}" -F "output_format=png" \
    "${args[@]}" --form-string "prompt=$(cat "$prompt_file")" -o "$resp"
else
  python3 -I -c 'import json,sys; print(json.dumps({"model":sys.argv[1],"size":sys.argv[2],"quality":sys.argv[3],"output_format":"png","prompt":open(sys.argv[4]).read()}))' \
    "$model" "$size" "$quality" "$prompt_file" > "$resp.req"
  curl -sS -m 900 https://api.openai.com/v1/images/generations -H "Authorization: Bearer set-by-proxy" \
    -H "Content-Type: application/json" --data-binary "@$resp.req" -o "$resp"
fi
python3 -I - "$resp" "$out" "$model" "$quality" "$size" <<'PY'
import base64, json, sys
resp, out, model, quality, size = sys.argv[1:6]
d = json.load(open(resp))
if "data" not in d:
    print("ОШИБКА:", json.dumps(d, ensure_ascii=False)[:800]); sys.exit(1)
open(out, "wb").write(base64.b64decode(d["data"][0]["b64_json"]))
meta = {"model": model, "quality": quality, "size": size, "usage": d.get("usage")}
json.dump(meta, open(out + ".json", "w"), ensure_ascii=False, indent=1)
print("ok", out, json.dumps(meta, ensure_ascii=False))
PY
