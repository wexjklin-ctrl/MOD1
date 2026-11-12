#!/usr/bin/env python3
"""Динамические каналы rotation из RP/animations/*.animation.json: вращение колёс, поворот передних колёс, руль, крен.
Понимаем только простые формулы:  число | query.modified_distance_moved * K | variable.steering * K | variable.steering / D.
Всё остальное (variable.pitch, variable.susp, variable.roll и суммы) пропускаем.
Результат: src/main/resources/assets/rz_auto/geo/anim_dyn.json
  {animation_id: {bone: [[kind,k],[kind,k],[kind,k]]}}, kind: 0 = константа k (градусы), 1 = дистанция(блоки)*k, 2 = steering(град/с)*k
Использование: python3 tools/extract_anim_dyn.py /path/to/RP"""
import json, glob, os, re, sys
rp = sys.argv[1] if len(sys.argv) > 1 else 'RP'
NUM = r'(-?\d+(?:\.\d+)?)'
def comp(v):
    if isinstance(v, (int, float)): return [0, float(v)]
    if not isinstance(v, str): return None
    s = v.strip().replace(' ', '')
    m = re.fullmatch(r'query\.modified_distance_moved\*' + NUM, s)
    if m: return [1, float(m.group(1))]
    m = re.fullmatch(r'variable\.steering\*' + NUM, s)
    if m: return [2, float(m.group(1))]
    m = re.fullmatch(r'variable\.steering/' + NUM, s)
    if m and float(m.group(1)) != 0: return [2, 1.0 / float(m.group(1))]
    return None
out = {}
for f in sorted(glob.glob(os.path.join(rp, 'animations', '*.animation.json'))):
    for name, an in json.load(open(f)).get('animations', {}).items():
        bones = {}
        for bone, ch in (an.get('bones') or {}).items():
            r = ch.get('rotation')
            if not isinstance(r, list) or len(r) != 3: continue
            cs = [comp(x) for x in r]
            if any(c is None for c in cs): continue
            if not any(c[0] != 0 for c in cs): continue   # без динамики: уже в anim_static.json
            bones[bone] = cs
        if bones: out[name] = bones
dst = os.path.join(os.path.dirname(__file__), '..', 'src/main/resources/assets/rz_auto/geo/anim_dyn.json')
json.dump(out, open(dst, 'w'), separators=(',', ':'))
print(len(out), 'animations ->', os.path.normpath(dst))
