# -*- coding: utf-8 -*-
import sys, numpy as np
from PIL import Image, ImageFilter, ImageOps, ImageChops
src='/Users/elena/Projects/sistema-yasnosti-club/source/img/hero-player.png'
out=sys.argv[1]; OPA=float(sys.argv[3]) if len(sys.argv)>3 else 0.8; shift=float(sys.argv[2]) if len(sys.argv)>2 else 0.50
im=Image.open(src).convert('RGB'); W,H=im.size
s=2000/W; im=im.resize((2000,int(H*s)),Image.LANCZOS); W,H=im.size
a=np.asarray(im).astype(np.float32)/255
# mirrored copy shifted left so faces look at each other
m=np.asarray(ImageOps.mirror(im)).astype(np.float32)/255
dx=int(W*shift); mm=np.ones_like(m)*a[:, :1, :].mean(axis=(0,1))  # fill
mm[:, :W-dx]=m[:, dx:]
# soften mirrored figure: blur + darken -> out-of-focus silhouette
mimg=Image.fromarray((mm*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))
mm=np.asarray(mimg).astype(np.float32)/255
lum=mm.mean(axis=2,keepdims=True)
# mask: only dark parts of the mirrored copy (figure), fade by x (left side)
x=np.linspace(0,1,W)[None,:,None]
fx=np.clip((0.305-x)/0.025,0,1)            # strong on left, off before her face
from PIL import ImageDraw
poly=[(365,130),(450,72),(525,66),(615,140),(645,300),(700,450),(745,600),(720,650),(705,747),(340,747),(440,520),(470,480),(432,400),(372,372),(338,335),(318,285),(338,222),(350,160)]
fm=Image.new('L',(1000,747),0); ImageDraw.Draw(fm).polygon(poly,fill=255)
fm=fm.resize((W,H),Image.LANCZOS).filter(ImageFilter.GaussianBlur(14))
fm=np.asarray(ImageOps.mirror(fm)).astype(np.float32)/255
fmm=np.zeros_like(fm); fmm[:, :W-dx]=fm[:, dx:]
mask=(fx*fmm[...,None])*OPA
res=a*(1-mask)+ (0.55*mm*0.97+0.45*a*mm*1.12)*mask           # multiply-ish double exposure
# mist wisp between faces
rng=np.random.default_rng(7)
def noise(sc):
    n=rng.random((H//sc+2,W//sc+2)).astype(np.float32)
    return np.asarray(Image.fromarray((n*255).astype(np.uint8)).resize((W,H),Image.BICUBIC)).astype(np.float32)/255
n=(noise(120)*0.5+noise(50)*0.3+noise(18)*0.2)
yy=np.linspace(0,1,H)[:,None]; xx=np.linspace(0,1,W)[None,:]
cx,cy=0.29,0.36
band=np.exp(-(((xx-cx)/0.035)**2+((yy-cy-0.05*np.sin((xx-cx)*30))/0.13)**2))
mist=np.clip(band*(n*2.2-0.25),0,1)[...,None]
mist=np.asarray(Image.fromarray((mist[...,0]*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(14))).astype(np.float32)[...,None]/255
warm=np.array([1.0,0.95,0.86])
res=res*(1-mist*0.95)+warm*mist*0.95
# glow
glow=np.exp(-(((xx-cx)/0.12)**2+((yy-cy)/0.2)**2))[...,None]
res=1-(1-res)*(1-glow*0.10*warm)
# unify sepia tone
l=res.mean(axis=2,keepdims=True); sep=np.concatenate([l*1.06,l*0.98,l*0.84],2)
res=res*0.55+np.clip(sep,0,1)*0.45
# grain
g=rng.normal(0,0.018,(H,W,1)).astype(np.float32); res=np.clip(res+g,0,1)
Image.fromarray((res*255).astype(np.uint8)).save(out)
