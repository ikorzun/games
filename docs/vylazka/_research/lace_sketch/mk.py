import os
from PIL import Image
L=os.environ["L"]; W,H=1280,720
ims=[]
for n,o in (("a","view_a"),("b","view_b")):
    im=Image.frombytes("RGB",(W,H),open(f"{L}/{n}.rgb","rb").read()); im.save(f"{L}/{o}.png"); ims.append(im)
sh=Image.new("RGB",(2*W+6,H),(30,30,30)); sh.paste(ims[0],(0,0)); sh.paste(ims[1],(W+6,0)); sh.save(f"{L}/sheet.jpg",quality=92)
