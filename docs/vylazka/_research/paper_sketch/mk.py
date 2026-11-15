import os
from PIL import Image
G=os.path.dirname(os.path.abspath(__file__)); W,H=1280,720
ims=[]
for n in ("view_a","view_b"):
    im=Image.frombytes("RGB",(W,H),open(f"{G}/{n}.rgb","rb").read()); im.save(f"{G}/{n}.png"); ims.append(im)
sh=Image.new("RGB",(2*W+6,H),(0,0,0)); sh.paste(ims[0],(0,0)); sh.paste(ims[1],(W+6,0)); sh.save(f"{G}/sheet.jpg",quality=90)
