# План сверху (tools/plans): по комнатам — клетки, стены, проходы (оранжевое кольцо — главный вход: ближний к началу сна по
# ходу), вещи (габариты сверху, красная точка — лицо вещи), места вещей воспоминаний, приметы, преграды. Вход — JSON dump.ts,
# выход — страница HTML на мир и сид. Только стандартная библиотека.
#   python3 render.py levels.json out_dir [мир,мир]
import json, sys, html
CELL=3.0; HALF=8; DROP=4.5; S=46  # пикселей на метр
src, outdir = sys.argv[1], sys.argv[2]
only = sys.argv[3].split(',') if len(sys.argv)>3 and sys.argv[3] else None
d=json.load(open(src))
def w(c): return (c-HALF)*CELL
SHORT={}
def short(n):
    n=n.replace('s3_','')
    return n[:14]
def color(o,floor):
    lo=o['min'][1]-floor; hi=o['max'][1]-floor
    if o['flat']: return '#c9a0dc','#7a4a96'
    if lo>0.45: return 'none','#4a7bd0'   # на стене / под потолком
    if hi>1.3: return '#5b5b66','#222'
    if hi>0.6: return '#9a8f7a','#3d3529'
    return '#cfc6b0','#6d6450'
pages={}
for lv in d:
    if only and lv['world'] not in only: continue
    world=lv['world']; seed=lv['seed']
    edges={(e['tier'],e['cx'],e['cz'],e['dir']):e['kind'] for e in lv['edges']}
    cellroom={}
    for r in lv['rooms']:
        for cx,cz in r['cells']: cellroom[(r['tier'],cx,cz)]=r['id']
    svgs=[]
    from collections import deque
    start_room=lv['rooms'][lv['entrance']]; sc=start_room['cells'][0]
    adj={}
    for r in lv['rooms']:
        cs=set((c[0],c[1]) for c in r['cells'])
        for (x,z) in cs:
            for dx,dz in ((1,0),(0,1),(-1,0),(0,-1)):
                if (x+dx,z+dz) in cs: adj.setdefault((r['tier'],x,z),[]).append((r['tier'],x+dx,z+dz))
    for e in lv['edges']:
        a=(e['tier'],e['cx'],e['cz']); b=(e['tier'],e['cx']+(1 if e['dir']==0 else 0),e['cz']+(1 if e['dir']==1 else 0))
        adj.setdefault(a,[]).append(b); adj.setdefault(b,[]).append(a)
    for st in lv['stairs']:
        dx,dz=[(1,0),(0,1),(-1,0),(0,-1)][st['dir']]
        a=(st['upperTier'],st['cx'],st['cz']); b=(st['upperTier']+1,st['cx']+dx*4,st['cz']+dz*4)
        adj.setdefault(a,[]).append(b); adj.setdefault(b,[]).append(a)
    dist={(start_room['tier'],sc[0],sc[1]):0}; dq=deque([(start_room['tier'],sc[0],sc[1])])
    while dq:
        c=dq.popleft()
        for n in adj.get(c,[]):
            if n not in dist: dist[n]=dist[c]+1; dq.append(n)
    for r in sorted(lv['rooms'], key=lambda r:(r['type'],r['id'])):
        if r['type'] in ('stairwell','track'): continue
        t=r['tier']; floor=-DROP*t
        xs=[w(c[0]) for c in r['cells']]; zs=[w(c[1]) for c in r['cells']]
        x0=min(xs)-1.5-0.6; x1=max(xs)+1.5+0.6; z0=min(zs)-1.5-0.6; z1=max(zs)+1.5+0.6
        W=(x1-x0)*S; H=(z1-z0)*S
        P=lambda x,z: ((x-x0)*S,(z-z0)*S)
        el=[]
        cells=set((c[0],c[1]) for c in r['cells'])
        for cx,cz in r['cells']:
            px,pz=P(w(cx)-1.5,w(cz)-1.5)
            el.append(f'<rect x="{px:.1f}" y="{pz:.1f}" width="{CELL*S:.1f}" height="{CELL*S:.1f}" fill="#f4f1ea" stroke="#e2ddd2" stroke-width="1"/>')
        doors=[]
        best=None
        for cx,cz in r['cells']:
            for dd,(dx,dz) in enumerate([(1,0),(0,1),(-1,0),(0,-1)]):
                if (cx+dx,cz+dz) in cells: continue
                key={0:(t,cx,cz,0),1:(t,cx,cz,1),2:(t,cx-1,cz,0),3:(t,cx,cz-1,1)}[dd]
                kind=edges.get(key)
                ccx,ccz=w(cx),w(cz)
                if dd in (0,2):
                    xx=ccx+(1.5 if dd==0 else -1.5); a=P(xx,ccz-1.5); b=P(xx,ccz+1.5)
                else:
                    zz=ccz+(1.5 if dd==1 else -1.5); a=P(ccx-1.5,zz); b=P(ccx+1.5,zz)
                if kind is None:
                    nb=cellroom.get((t,cx+dx,cz+dz))
                    el.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#222" stroke-width="7"/>')
                else:
                    # проход: стена с проёмом 1,2 м посередине (open — весь край)
                    mx=(a[0]+b[0])/2; my=(a[1]+b[1])/2
                    doors.append((mx,my,kind))
                    dd_=dist.get((t,cx+dx,cz+dz),10**9)
                    if r['id']!=lv['entrance'] and (best is None or dd_<best[0]): best=(dd_,mx,my)
                    if kind=='open':
                        el.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#2a9d8f" stroke-width="3" stroke-dasharray="6 5"/>')
                    else:
                        g=0.6*S
                        if dd in (0,2):
                            el.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{a[0]:.1f}" y2="{my-g:.1f}" stroke="#222" stroke-width="7"/>')
                            el.append(f'<line x1="{a[0]:.1f}" y1="{my+g:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#222" stroke-width="7"/>')
                        else:
                            el.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{mx-g:.1f}" y2="{a[1]:.1f}" stroke="#222" stroke-width="7"/>')
                            el.append(f'<line x1="{mx+g:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#222" stroke-width="7"/>')
                        el.append(f'<circle cx="{mx:.1f}" cy="{my:.1f}" r="7" fill="{"#e76f51" if kind=="hermo" else "#2a9d8f"}"/>')
        if best: el.append(f'<circle cx="{best[1]:.1f}" cy="{best[2]:.1f}" r="13" fill="none" stroke="#ff7f00" stroke-width="4"/>')
        # пути между проходами
        for i in range(len(doors) if r['type'] not in ('corridor','hall','passage','concourse','platform') else 0):
            for j in range(i+1,len(doors)):
                a,b=doors[i],doors[j]
                el.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#2a9d8f" stroke-width="2" stroke-dasharray="2 6" opacity="0.7"/>')
        inroom=lambda x,z: (round(x/CELL)+HALF, round(z/CELL)+HALF) in cells
        objs=[o for o in lv['objects'] if abs(o['at'][1]-floor)<2.9 and o['at'][1]>=floor-0.05 and inroom(o['at'][0],o['at'][2])]
        # сначала низкое, потом высокое, потом настенное
        def order(o):
            lo=o['min'][1]-floor; hi=o['max'][1]-floor
            return (2 if lo>0.45 else (1 if hi>1.3 else 0))
        for bx in lv['boxes']:
            if bx[1]>floor+2.2 or bx[4]<floor+0.05 or bx[1]<floor-0.5: continue
            cxm=(bx[0]+bx[3])/2; czm=(bx[2]+bx[5])/2
            if not inroom(cxm,czm): continue
            a=P(bx[0],bx[2]); b=P(bx[3],bx[5])
            el.append(f'<rect x="{a[0]:.1f}" y="{a[1]:.1f}" width="{max(1,b[0]-a[0]):.1f}" height="{max(1,b[1]-a[1]):.1f}" fill="url(#hatch)" stroke="#999" stroke-width="0.8"/>')
        for o in sorted(objs,key=order):
            fill,stroke=color(o,floor)
            a=P(o['min'][0],o['min'][2]); b=P(o['max'][0],o['max'][2])
            dash=' stroke-dasharray="4 3"' if (o['min'][1]-floor>0.45) else ''
            el.append(f'<rect x="{a[0]:.1f}" y="{a[1]:.1f}" width="{max(2,b[0]-a[0]):.1f}" height="{max(2,b[1]-a[1]):.1f}" fill="{fill}" fill-opacity="0.85" stroke="{stroke}" stroke-width="1.5"{dash}/>')
            # передняя сторона (rot: 0 → +z смотрит … ) — точка на «лице»
            cx_=(a[0]+b[0])/2; cz_=(a[1]+b[1])/2
            fx,fz={0:(0,1),1:(1,0),2:(0,-1),3:(-1,0)}[o['rot']]
            hw=(b[0]-a[0])/2; hh=(b[1]-a[1])/2
            el.append(f'<circle cx="{cx_+fx*hw*0.8:.1f}" cy="{cz_+fz*hh*0.8:.1f}" r="2.2" fill="#d62828"/>')
        for o in sorted(objs,key=order):
            a=P(o['min'][0],o['min'][2]); b=P(o['max'][0],o['max'][2])
            cx_=(a[0]+b[0])/2; cz_=(a[1]+b[1])/2
            el.append(f'<text x="{cx_:.1f}" y="{cz_+3:.1f}" font-size="9" text-anchor="middle" fill="#000" stroke="#fff" stroke-width="2.5" paint-order="stroke" font-family="DejaVu Sans, sans-serif">{html.escape(short(o["n"]))}</text>')
        for s in lv['spots']:
            if s['tier']!=t or s['room']!=r['id']: continue
            p=P(s['x'],s['z'])
            col={'table':'#f4a261','shelf':'#e9c46a','floor':'#e63946'}[s['kind']]
            el.append(f'<circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="5" fill="{col}" stroke="#000" stroke-width="1"/>')
        for m in lv['landmarks']:
            if m['tier']!=t or m['room']!=r['id']: continue
            p=P(m['x'],m['z'])
            el.append(f'<text x="{p[0]:.1f}" y="{p[1]-6:.1f}" font-size="14" text-anchor="middle" fill="#7209b7">★</text>')
        title=f'{r["type"]} #{r["id"]} t{t} · {len(r["cells"])} кл.'+(' · ВХОД' if r['id']==lv['entrance'] else '')
        svgs.append(f'<figure><figcaption>{html.escape(title)}</figcaption><svg width="{W:.0f}" height="{H:.0f}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#bbb" stroke-width="2"/></pattern></defs>{"".join(el)}</svg></figure>')
    pages.setdefault(f'{world}_{seed}',[]).extend(svgs)
legend='<p class="lg">чёрное — высокая мебель (&gt;1,3 м) · бурое — средняя · светлое — низкая · синий пунктир — на стене/под потолком · сиреневое — картонка · красная точка — лицо вещи · кружки: оранжевый — вещь памяти на столе, жёлтый — на полке, красный — на полу · ★ — примета · бирюзовый кружок — дверь, оранжевое кольцо — главный вход, пунктир — путь между дверями · штриховка — преграды (несъёмное и вещи)</p>'
for k,svgs in pages.items():
    open(f'{outdir}/{k}.html','w').write('<!doctype html><meta charset=utf8><style>body{font:12px DejaVu Sans,sans-serif;margin:8px;background:#fff}figure{display:inline-block;margin:6px;vertical-align:top;border:1px solid #ddd;padding:4px}figcaption{font-weight:bold;margin-bottom:3px}.lg{max-width:1500px}</style>'+f'<h3>{k}</h3>'+legend+''.join(svgs))
print('pages',list(pages))
