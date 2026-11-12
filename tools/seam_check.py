import sys,json,math,itertools,os
import numpy as np
from PIL import Image
RES='/home/claude/MOD1/src/main/resources/assets/rz_auto/'
def cubeinfo(o):
    og,sz=o['origin'],o['size']; inf=o.get('inflate',0)
    ws,hs,ds=sz; fl=lambda v: math.floor(v+1e-4)
    wu,hu,du=fl(ws),fl(hs),fl(ds); u,v=o['uv']
    X0=og[0]-inf;y0=og[1]-inf;z0=og[2]-inf;X1=X0+ws+2*inf;y1=y0+hs+2*inf;z1=z0+ds+2*inf
    x0,x1=-X1,-X0
    c=[[x1,y1,z0, x0,y1,z0, x0,y0,z0, x1,y0,z0],
       [x0,y1,z1, x1,y1,z1, x1,y0,z1, x0,y0,z1],
       [x1,y1,z1, x1,y1,z0, x1,y0,z0, x1,y0,z1],
       [x0,y1,z0, x0,y1,z1, x0,y0,z1, x0,y0,z0],
       [x0,y1,z0, x1,y1,z0, x1,y1,z1, x0,y1,z1],
       [x0,y0,z1, x1,y0,z1, x1,y0,z0, x0,y0,z0]]
    rect=[(u+du,v+du,wu,hu),(u+du+wu+du,v+du,wu,hu),(u,v+du,du,hu),(u+du+wu,v+du,du,hu),(u+du,v,wu,du),(u+du+wu,v,wu,du)]
    return c,rect
def corner_param(face_c,pt):
    for k in range(4):
        if all(abs(face_c[k*3+i]-pt[i])<1e-6 for i in range(3)): return [(0,0),(1,0),(1,1),(0,1)][k]
    return None
FLIPS=[(0,0),(1,0),(0,1),(1,1)]
def sample(a,rect,st,flip,sx,sy,W,H,inward):
    x,y,w,h=rect; s,t=st
    # nudge inward by ~0.35 texel
    if w<2 or h<2: return None
    s=min(max(s,0.35/w),1-0.35/w) if True else s
    t=min(max(t,0.35/h),1-0.35/h)
    if flip[0]: s=1-s
    if flip[1]: t=1-t
    px=int((x+s*w)*sx); py=int((y+t*h)*sy)
    if not(0<=px<W and 0<=py<H): return None
    return a[py,px]
def run(geoname,texname):
    geo=json.load(open(RES+f'geo/{geoname}.geo.json'))['minecraft:geometry'][0]
    img=np.array(Image.open(RES+'textures/entity/'+texname).convert('RGBA')).astype(int); H,W,_=img.shape
    sx=W/geo['description']['texture_width']; sy=H/geo['description']['texture_height']
    cost={}   # (fa,fb) -> 4x4 array
    for b in geo['bones']:
        for o in b.get('cubes',[]):
            if o.get('mirror'): continue
            c,rect=cubeinfo(o)
            for fa in range(6):
                for fb in range(fa+1,6):
                    # shared corners
                    sh=[]
                    for k in range(4):
                        p=c[fa][k*3:k*3+3]
                        if corner_param(c[fb],p) is not None: sh.append(p)
                    if len(sh)!=2: continue
                    pa=[corner_param(c[fa],p) for p in sh]; pb=[corner_param(c[fb],p) for p in sh]
                    M=np.zeros((4,4)); N=np.zeros((4,4))
                    for tt in (0.15,0.5,0.85):
                        sta=(pa[0][0]*(1-tt)+pa[1][0]*tt, pa[0][1]*(1-tt)+pa[1][1]*tt)
                        stb=(pb[0][0]*(1-tt)+pb[1][0]*tt, pb[0][1]*(1-tt)+pb[1][1]*tt)
                        for i,f1 in enumerate(FLIPS):
                            ca=sample(img,rect[fa],sta,f1,sx,sy,W,H,0)
                            if ca is None or ca[3]<200: continue
                            for j,f2 in enumerate(FLIPS):
                                cb=sample(img,rect[fb],stb,f2,sx,sy,W,H,0)
                                if cb is None or cb[3]<200: continue
                                M[i,j]+=np.abs(ca[:3]-cb[:3]).sum(); N[i,j]+=1
                    if N.max()==0: continue
                    k=(fa,fb); 
                    cost.setdefault(k,[np.zeros((4,4)),np.zeros((4,4))])
                    cost[k][0]+=M; cost[k][1]+=N
    return cost
def merge(costs):
    tot={}
    for c in costs:
        for k,(M,N) in c.items():
            tot.setdefault(k,[np.zeros((4,4)),np.zeros((4,4))])
            tot[k][0]+=M; tot[k][1]+=N
    return tot
def solve(tot):
    best=None
    for combo in itertools.product(range(4),repeat=6):
        s=0;n=0
        for (fa,fb),(M,N) in tot.items():
            s+=M[combo[fa],combo[fb]]; n+=N[combo[fa],combo[fb]]
        sc=s/max(n,1)
        if best is None or sc<best[0]: best=(sc,combo)
    return best
if __name__=='__main__':
    pairs=[('458','458blue.png'),('e46','e46ssilvergray.png'),('f30','f30graybrown.png'),('m3','m3redred.png'),('xj','xjbluelif.png'),('p1','p1yellow.png'),('centenario','centenarioblackredroadster.png'),('mr2','mr2white.png')]
    costs=[]
    for g,t in pairs:
        c=run(g,t); costs.append(c)
        b=solve(c); print(g,'best',[FLIPS[i] for i in b[1]],round(b[0],1),'identity score',round(sum(v[0][0,0] for v in c.values())/max(1,sum(v[1][0,0] for v in c.values())),1),flush=True)
    tot=merge(costs); b=solve(tot); print('ALL',[FLIPS[i] for i in b[1]],round(b[0],1))
    ident=sum(v[0][0,0] for v in tot.values())/sum(v[1][0,0] for v in tot.values()); print('identity',round(ident,1))
