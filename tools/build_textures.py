#!/usr/bin/env python3
"""RP Bedrock -> текстуры Java. Запуск: python3 tools/build_textures.py /path/to/RP
Для каждого texture_set:
  NAME.png    цвет. У материала entity_emissive_alpha (jeep, e46, mr2, f30...) пиксели с промежуточной альфой светятся -> в цвете они непрозрачны.
  NAME_s.png  labPBR specular для шейдеров (R гладкость, G F0, A свечение 0..254, 255 = нет)
  NAME_e.png  RGBA: цвет, альфа = сила свечения (слой «eyes» без шейдеров; там, где альфа 0, ничего не рисуется)"""
import json, os, sys, glob
from PIL import Image
rp = sys.argv[1] if len(sys.argv) > 1 else 'RP'
src = os.path.join(rp, 'textures/entity')
out = os.path.join(os.path.dirname(__file__), '..', 'src/main/resources/assets/rz_auto/textures/entity')
MAXW = 512
mat = {}
for f in glob.glob(os.path.join(rp, 'entity/*.json')):
    d = json.load(open(f, encoding='utf-8-sig'))['minecraft:client_entity']['description']
    mat[os.path.basename(d['textures']['default']).lower()] = d['materials']['default']
files = {f.lower(): f for f in os.listdir(src)}
def png(n): return os.path.join(src, files[n.lower() + '.png']) if n.lower() + '.png' in files else None
n_emis_alpha = n_done = 0
for ts in sorted(glob.glob(os.path.join(src, '*.texture_set.json'))):
    d = json.load(open(ts, encoding='utf-8-sig'))['minecraft:texture_set']
    name = d['color'].lower(); cp = png(name)
    if not cp: continue
    color = Image.open(cp).convert('RGBA')
    mer_n = d.get('metalness_emissive_roughness'); mp = png(mer_n) if isinstance(mer_n, str) else None
    mer = Image.open(mp).convert('RGB') if mp else None
    if mer is not None and mer.size != color.size: mer = mer.resize(color.size, Image.NEAREST)
    emissive_alpha = mat.get(name) == 'entity_emissive_alpha'
    a = color.getchannel('A')
    mer_e = mer.split()[1].point(lambda v: 255 if v > 0 else 0) if mer is not None else Image.new('L', color.size, 0)
    if emissive_alpha:
        # alpha 0 = не закрашено/прозрачно, 255 = обычный пиксель, промежуточная (например 48) = светящийся пиксель
        # (свечение = 255 - alpha). Для Java: прозрачность только у alpha 0, светящиеся пиксели делаем непрозрачными.
        n_emis_alpha += 1
        glow = a.point(lambda v: (255 - v) if 0 < v < 255 else 0)
        base = color.copy(); base.putalpha(a.point(lambda v: 255 if v > 0 else 0))
        from PIL import ImageChops
        mask = ImageChops.lighter(glow, mer_e)
    else:
        base = color
        mask = mer_e
    # размер
    sz = color.size
    if sz[0] > MAXW:
        sz = (MAXW, int(sz[1] * MAXW / sz[0]))
    def fit(im, mode=Image.NEAREST): return im.resize(sz, mode) if im.size != sz else im
    base = fit(base); mask = fit(mask)
    # свечение только там, где кузов непрозрачен и цвет не чёрный (иначе слой «eyes» рисует чёрные квадраты поверх прозрачных мигалок)
    from PIL import ImageChops
    mask = ImageChops.darker(mask, base.getchannel('A'))
    lum = ImageChops.lighter(ImageChops.lighter(base.getchannel('R'), base.getchannel('G')), base.getchannel('B'))
    mask = ImageChops.multiply(mask, lum.point(lambda v: 255 if v >= 8 else 0))
    base.save(os.path.join(out, name + '.png'))
    # specular
    if mer is not None:
        M, E, R = fit(mer).split()
        smooth = R.point(lambda v: 255 - v); f0 = M.point(lambda v: 255 if v > 127 else 12)
    else:
        smooth = Image.new('L', sz, 90); f0 = Image.new('L', sz, 12)
    emi = mask.point(lambda v: 255 if v == 0 else max(1, min(254, int(254 * v / 255))))
    Image.merge('RGBA', (smooth, f0, Image.new('L', sz, 0), emi)).save(os.path.join(out, name + '_s.png'))
    # слой свечения
    ep = os.path.join(out, name + '_e.png')
    if mask.getextrema()[1] > 0:
        e = base.convert('RGB').convert('RGBA'); e.putalpha(mask); e.save(ep)
    elif os.path.exists(ep): os.remove(ep)
    n_done += 1
print(n_done, 'textures, emissive_alpha:', n_emis_alpha)
