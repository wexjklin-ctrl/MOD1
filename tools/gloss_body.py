#!/usr/bin/env python3
"""Глянец кузова для шейдеров (labPBR _s): только кузов, колёса и руль не трогаем.

Берёт geo-модели (assets/rz_auto/geo), находит UV-прямоугольники кубов:
  колёса (кости *wheel*) и руль -> глянец НЕ добавляется; тёмные пиксели колёс (резина) принудительно матовые, диски остаются как в MER оригинала;
  всё остальное (кузов, стёкла, фары, салон) -> гладкость поднимается до BODY_SMOOTH и обрезается сверху до CAP_SMOOTH.
Почему не 255: при гладкости 255 (шероховатость 0) блик от солнца в шейдерах схлопывается в точку и машина выглядит матовой;
labPBR рекомендует ~0.88-0.94 для лакированной краски.
F0 (канал G) и свечение (канал A) не меняются. Скрипт идемпотентен, можно запускать повторно.
"""
import json, glob, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'src', 'main', 'resources')
GEO = os.path.join(ROOT, 'assets', 'rz_auto', 'geo')
TEX = os.path.join(ROOT, 'assets', 'rz_auto', 'textures', 'entity')
BODY_SMOOTH = 228   # 0.89 perceptual smoothness
CAP_SMOOTH = 240
TIRE_SMOOTH = 35    # резина: шероховатая
F0_PAINT = 14       # ~0.055 (лак), если файла _s не было

def face_rects(c):
    sx, sy, sz = c['size']; uv = c.get('uv')
    if isinstance(uv, dict):
        return [(f['uv'][0], f['uv'][1], f['uv_size'][0], f['uv_size'][1]) for f in uv.values() if isinstance(f, dict) and 'uv' in f]
    if not uv: return []
    u, v = uv
    return [(u + sz, v + sz, sx, sy), (u, v + sz, sz, sy), (u + sz + sx + sz, v + sz, sx, sy),
            (u + sz + sx, v + sz, sz, sy), (u + sz, v, sx, sz), (u + sz + sx, v, sx, sz)]

def masks(g):
    tw = g['description'].get('texture_width', 64); th = g['description'].get('texture_height', 64)
    bones = {b['name']: b for b in g['bones']}
    def protected(name):
        seen = set()
        while name and name not in seen:
            seen.add(name); low = name.lower()
            if 'steer' in low: return True
            if 'wheel' in low: return True
            name = (bones.get(name) or {}).get('parent')
        return False
    body = np.zeros((th, tw), bool); prot = np.zeros((th, tw), bool)
    for b in g['bones']:
        m = prot if protected(b['name']) else body
        for c in b.get('cubes', []):
            for (x, y, w, h) in face_rects(c):
                x0, y0 = int(np.floor(x)), int(np.floor(y)); x1, y1 = int(np.ceil(x + w)), int(np.ceil(y + h))
                m[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = True
    return body & ~prot, prot, (tw, th)

geos = {}
for f in glob.glob(os.path.join(GEO, '*.geo.json')):
    d = json.load(open(f, encoding='utf-8-sig'))
    for g in d['minecraft:geometry']: geos[g['description']['identifier']] = g

veh = json.load(open(os.path.join(ROOT, 'data', 'vehicles.json'), encoding='utf-8-sig'))
done = set(); n_new = n_upd = 0
for v in veh:
    g = geos.get(v.get('geometry')); tex = (v.get('texture') or '').split('/')[-1].lower()
    if not g or not tex or tex in done: continue
    done.add(tex)
    cpath = os.path.join(TEX, tex + '.png')
    if not os.path.exists(cpath): continue
    color = Image.open(cpath).convert('RGBA'); W, H = color.size
    body, prot, (tw, th) = masks(g)
    rim = np.asarray(Image.fromarray(prot.astype(np.uint8) * 255).resize((W, H), Image.NEAREST)) > 0
    lum = np.asarray(color)[..., :3].astype(int).mean(axis=2)
    tire = rim & (lum < 70) & (np.asarray(color)[..., 3] > 0)   # тёмные пиксели колёс = резина
    mask = np.asarray(Image.fromarray(body.astype(np.uint8) * 255).resize((W, H), Image.NEAREST)) > 0
    mask &= np.asarray(color)[..., 3] > 0
    spath = os.path.join(TEX, tex + '_s.png')
    if os.path.exists(spath):
        s = np.asarray(Image.open(spath).convert('RGBA')).copy()
        if s.shape[:2] != (H, W): s = np.asarray(Image.fromarray(s).resize((W, H), Image.NEAREST)).copy()
        n_upd += 1
    else:
        s = np.zeros((H, W, 4), np.uint8); s[..., 1] = 12; s[..., 3] = 255; s[mask, 1] = F0_PAINT; n_new += 1
    r = s[..., 0].astype(int)
    r[mask] = np.clip(np.maximum(r[mask], BODY_SMOOTH), 0, CAP_SMOOTH)
    r[tire] = np.minimum(r[tire], TIRE_SMOOTH)   # резина матовая (в MER оригинала она местами гладкая)
    s[..., 0] = r.astype(np.uint8)
    Image.fromarray(s, 'RGBA').save(spath)
print('textures:', len(done), 'updated:', n_upd, 'created:', n_new)
