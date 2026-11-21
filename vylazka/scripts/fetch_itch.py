#!/usr/bin/env python3
"""
Скачивание бесплатного файла с itch.io: страница игры -> ключ загрузки -> список файлов -> ссылка на файл.

Ключ страницы загрузки живёт около 10 секунд, поэтому вся цепочка идёт одним запуском, без пауз.
Запуск вручную (в сборку и CI не входит):
    python3 -I scripts/fetch_itch.py <url страницы> <каталог> [часть имени файла]
Пример:
    python3 -I scripts/fetch_itch.py https://kaylousberg.itch.io/furniture-bits /tmp/pack furniture
Каталог должен существовать и лучше быть пустым: скачанное — недоверенные данные, их только
распаковывают и разбирают, ничего оттуда не запускают.
Сертификаты: если задана переменная SSL_CERT_FILE — берётся она, иначе системный набор.
Берите только наборы с лицензией CC0 или равной по свободе; файл лицензии проверяют до импорта.
"""
import base64
import http.cookiejar
import json
import os
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    page, outdir = sys.argv[1].rstrip('/'), sys.argv[2]
    want = sys.argv[3] if len(sys.argv) > 3 else ''

    cafile = os.environ.get('SSL_CERT_FILE')
    ctx = ssl.create_default_context(cafile=cafile) if cafile else ssl.create_default_context()
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), urllib.request.HTTPSHandler(context=ctx))

    def req(url, data=None, ref=None, xhr=False):
        headers = {'User-Agent': UA}
        if ref:
            headers['Referer'] = ref
        if xhr:
            headers['X-Requested-With'] = 'XMLHttpRequest'
        body = urllib.parse.urlencode(data).encode() if data else None
        with opener.open(urllib.request.Request(url, data=body, headers=headers), timeout=60) as f:
            return f.geturl(), f.read()

    # 1. Страница игры: берём csrf-токен.
    _, html = req(page)
    html = html.decode('utf-8', 'replace')
    m = re.search(r'name="csrf_token" value="([^"]+)"', html)
    if not m:
        sys.exit('на странице нет csrf_token: возможно, у набора платная или закрытая загрузка')
    # 2. Ключ страницы загрузки (живёт ~10 с).
    _, j = req(page + '/download_url', {'csrf_token': m.group(1)}, ref=page, xhr=True)
    dl = json.loads(j)['url']
    try:
        key = dl.rsplit('/', 1)[1]
        print('ключ:', base64.b64decode(urllib.parse.unquote(key).split('.')[0] + '==').decode(), 'сейчас', int(time.time()))
    except Exception as e:  # разбор ключа нужен только для отладки
        print('ключ не разобран:', e)
    # 3. Страница загрузки: список файлов.
    final, body = req(dl, ref=page)
    body = body.decode('utf-8', 'replace')
    print('страница загрузки:', final[:90], len(body))
    ups = re.findall(r'data-upload_id="(\d+)"', body)
    names = re.findall(r'<strong class="name" title="([^"]+)"', body)
    print('файлы:', list(zip(ups, names)))
    m2 = re.search(r'name="csrf_token" value="([^"]+)"', body)
    if not m2:
        sys.exit('на странице загрузки нет csrf_token')
    # 4. Ссылка на каждый подходящий файл и сам файл.
    for up, name in zip(ups, names):
        if want and want.lower() not in name.lower():
            continue
        q = urllib.parse.urlencode({'source': 'game_download', 'after_download_lightbox': 'true'})
        _, j = req(f'{page}/file/{up}?{q}', {'csrf_token': m2.group(1)}, ref=dl, xhr=True)
        info = json.loads(j)
        if 'url' not in info:
            print('ответ без ссылки:', str(info)[:300])
            continue
        url = info['url']
        print('ссылка на файл:', urllib.parse.urlsplit(url).netloc, urllib.parse.urlsplit(url).path[:60])
        try:
            _, data = req(url)
            fn = os.path.join(outdir, re.sub(r'[^A-Za-z0-9_.-]', '_', name) + '.zip')
            with open(fn, 'wb') as f:
                f.write(data)
            print('скачано', fn, len(data))
        except Exception as e:
            print('не скачано:', type(e).__name__, str(e)[:200])


if __name__ == '__main__':
    main()
