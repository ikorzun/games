import os
import sys
from PIL import Image, ImageDraw, ImageFont
G=os.environ.get("OUT", ".")
W,H=960,540; fr=[0,0.12,0.25,0.45,0.7,1.0]
def load(n,c):
    d=open(f"{G}/{n}.rgb","rb").read(); s=W*H*3
    return [Image.frombytes("RGB",(W,H),d[i*s:(i+1)*s]) for i in range(len(d)//s)]
try: font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",26)
except Exception: font=ImageFont.load_default()
for n,out in (("view","sheet_view"),("plan","sheet_plan")):
    ims=load(n,6); sh=Image.new("RGB",(3*W//2,2*H//2))
    for i,im in enumerate(ims):
        im=im.resize((W//2,H//2),Image.LANCZOS); ImageDraw.Draw(im).text((8,6),f"t = {fr[i]:.2f} T",fill=(255,230,120),font=font)
        sh.paste(im,((i%3)*W//2,(i//3)*H//2))
    sh.save(f"{G}/{out}.jpg",quality=90)
    for i,im in enumerate(ims): im.save(f"{G}/{n}_{i}.png")
g=[im.resize((480,270),Image.LANCZOS) for im in load("gif",36)]
g[0].save(f"{G}/growth.gif",save_all=True,append_images=g[1:],duration=83,loop=0,optimize=True)
