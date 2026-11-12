#!/usr/bin/env python3
"""Офлайн-рендер geo-модели (порт GeoModel.java) для проверки знаков поворотов/развёртки без игры.
usage: render_geo.py GEO_NAME TEXTURE.png out.png [yaw pitch] [--signs +-- ]"""
import json, sys, math, itertools
import numpy as np
from PIL import Image
RES = 'src/main/resources/assets/rz_auto/'

def rot(rx, ry, rz, order='ZYX'):
    def Rx(a): c,s=math.cos(a),math.sin(a); return np.array([[1,0,0],[0,c,-s],[0,s,c]])
    def Ry(a): c,s=math.cos(a),math.sin(a); return np.array([[c,0,s],[0,1,0],[-s,0,c]])
    def Rz(a): c,s=math.cos(a),math.sin(a); return np.array([[c,-s,0],[s,c,0],[0,0,1]])
    return Rz(rz) @ Ry(ry) @ Rx(rx)

def build(geo, signs=(1,-1,-1), floor_uv=True):
    d = geo['description']; tw, th = d['texture_width'], d['texture_height']
    bones = {b['name']: b for b in geo['bones']}
    memo = {}
    def world(name):
        if name in memo: return memo[name]
        b = bones[name]
        par = world(b['parent']) if b.get('parent') in bones else (np.eye(3), np.zeros(3))
        Rp, tp = par
        piv = np.array([b['pivot'][0], b['pivot'][1], -b['pivot'][2]]) / 16
        r = b.get('rotation', [0,0,0])
        R = rot(*[math.radians(signs[i]*r[i]) for i in range(3)])
        # M = parent * T(piv) R T(-piv)
        Rw = Rp @ R
        tw_ = Rp @ (piv - R @ piv) + tp + Rp @ np.zeros(3)
        # affine: x -> Rp(R(x-piv)+piv)+tp
        memo[name] = (Rw, tp + Rp @ (piv - R @ piv))
        return memo[name]
    # note: bone transform about its own pivot, then parent's transform applies to the result
    quads = []
    for b in geo['bones']:
        Rw, tw3 = world(b['name'])
        for c in b.get('cubes', []):
            quads += cube(c, tw, th, signs, Rw, tw3, floor_uv)
    return quads

def cube(o, tw, th, signs, Rb, tb, floor_uv):
    og, sz = o['origin'], o['size']; inf = o.get('inflate', 0)
    ws, hs, ds = sz
    fl = (lambda v: math.floor(v+1e-4)) if floor_uv else (lambda v: v)
    wu, hu, du = fl(ws), fl(hs), fl(ds)
    u, v = o['uv']; mirror = o.get('mirror', False)
    X0 = og[0]-inf; y0 = og[1]-inf; z0 = og[2]-inf
    X1 = X0+ws+2*inf; y1 = y0+hs+2*inf; z1 = z0+ds+2*inf
    x0, x1 = -X1, -X0
    c = [[x1,y1,z0, x0,y1,z0, x0,y0,z0, x1,y0,z0],
         [x0,y1,z1, x1,y1,z1, x1,y0,z1, x0,y0,z1],
         [x1,y1,z1, x1,y1,z0, x1,y0,z0, x1,y0,z1],
         [x0,y1,z0, x0,y1,z1, x0,y0,z1, x0,y0,z0],
         [x0,y1,z0, x1,y1,z0, x1,y1,z1, x0,y1,z1],
         [x0,y0,z1, x1,y0,z1, x1,y0,z0, x0,y0,z0]]
    rect = [(u+du, v+du, wu, hu), (u+du+wu+du, v+du, wu, hu), (u, v+du, du, hu),
            (u+du+wu, v+du, du, hu), (u+du, v, wu, du), (u+du+wu, v, wu, du)]
    cr = np.eye(3); pv = np.zeros(3)
    if 'rotation' in o:
        r = o['rotation']; cr = rot(*[math.radians(signs[i]*r[i]) for i in range(3)])
        p = o.get('pivot', [0,0,0]); pv = np.array([p[0], p[1], -p[2]])/16
    out = []
    for face in range(6):
        fr = rect[face]
        if mirror and face in (2,3): fr = rect[5-face]
        uvs = [(fr[0],fr[1]),(fr[0]+fr[2],fr[1]),(fr[0]+fr[2],fr[1]+fr[3]),(fr[0],fr[1]+fr[3])]
        if face==4: uvs=[uvs[2],uvs[3],uvs[0],uvs[1]]
        elif face==5: uvs=[uvs[1],uvs[0],uvs[3],uvs[2]]
        if mirror: uvs = [uvs[1],uvs[0],uvs[3],uvs[2]]
        P = []
        for k in range(4):
            t = np.array([-c[face][k*3], c[face][k*3+1], -c[face][k*3+2]])/16
            t = cr @ (t - pv) + pv
            t = Rb @ t + tb
            P.append(t)
        # order TL,BL,BR,TR
        order = [0,3,2,1]
        out.append(([P[i] for i in order], [(uvs[i][0]/tw, uvs[i][1]/th) for i in order]))
    return out

def render(quads, tex, yaw, pitch, W=900, H=560, dist=9.0, scale=1.0):
    t = np.array(tex.convert('RGBA')); th_, tw_, _ = t.shape
    img = np.full((H, W, 3), 60, np.uint8); zb = np.full((H, W), 1e9)
    cy, sy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    cp, sp = math.cos(math.radians(pitch)), math.sin(math.radians(pitch))
    Ry = np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]]); Rx = np.array([[1,0,0],[0,cp,-sp],[0,sp,cp]])
    f = 1.6 * H
    def proj(p):
        q = Rx @ (Ry @ (p - np.array([0,0.8,0]))) ; z = q[2] + dist
        return np.array([W/2 + f*q[0]/z, H/2 - f*q[1]/z, z])
    for P, UV in quads:
        pp = [proj(p) for p in P]
        for tri in ((0,1,2),(0,2,3)):
            a,b,c = [pp[i] for i in tri]; ua,ub,uc = [UV[i] for i in tri]
            minx=int(max(0,math.floor(min(a[0],b[0],c[0])))); maxx=int(min(W-1,math.ceil(max(a[0],b[0],c[0]))))
            miny=int(max(0,math.floor(min(a[1],b[1],c[1])))); maxy=int(min(H-1,math.ceil(max(a[1],b[1],c[1]))))
            if minx>maxx or miny>maxy: continue
            den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(den)<1e-9: continue
            xs,ys=np.meshgrid(np.arange(minx,maxx+1)+.5,np.arange(miny,maxy+1)+.5)
            w0=((b[1]-c[1])*(xs-c[0])+(c[0]-b[0])*(ys-c[1]))/den
            w1=((c[1]-a[1])*(xs-c[0])+(a[0]-c[0])*(ys-c[1]))/den
            w2=1-w0-w1
            m=(w0>=-1e-6)&(w1>=-1e-6)&(w2>=-1e-6)
            if not m.any(): continue
            z=w0*a[2]+w1*b[2]+w2*c[2]
            uu=(w0*ua[0]+w1*ub[0]+w2*uc[0]); vv=(w0*ua[1]+w1*ub[1]+w2*uc[1])
            tx=np.clip((uu*tw_).astype(int),0,tw_-1); ty=np.clip((vv*th_).astype(int),0,th_-1)
            px=t[ty,tx]
            ok=m&(px[...,3]>25)
            sub=zb[miny:maxy+1,minx:maxx+1]; upd=ok&(z<sub)
            sub[upd]=z[upd]; img[miny:maxy+1,minx:maxx+1][upd]=px[...,:3][upd]
    return Image.fromarray(img)

if __name__ == '__main__':
    name, texp, outp = sys.argv[1:4]
    yaw = float(sys.argv[4]) if len(sys.argv)>4 else 30; pitch = float(sys.argv[5]) if len(sys.argv)>5 else 20
    geo = json.load(open(RES+f'geo/{name}.geo.json'))['minecraft:geometry'][0]
    tex = Image.open(texp)
    combos = list(itertools.product((1,-1),repeat=3))
    tiles = []
    for s in combos:
        im = render(build(geo, s), tex, yaw, pitch, 600, 380)
        tiles.append(im); print(s)
    sheet = Image.new('RGB',(1200,380*4))
    for i,im in enumerate(tiles): sheet.paste(im,((i%2)*600,(i//2)*380))
    sheet.save(outp)
