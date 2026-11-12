#!/usr/bin/env python3
"""Достаёт из RP/animations/*.animation.json статичные (числовые) каналы костей: scale/rotation/position.
Результат: src/main/resources/assets/rz_auto/geo/anim_static.json  {animation_id: {bone: {scale:[x,y,z], rot:[..], pos:[..]}}}
Использование: python3 tools/extract_anim_static.py /path/to/RP"""
import json, glob, os, sys
rp = sys.argv[1] if len(sys.argv) > 1 else 'RP'
def num(v):
    if isinstance(v, (int, float)): return [float(v)] * 3
    if isinstance(v, list) and len(v) == 3 and all(isinstance(x, (int, float)) for x in v): return [float(x) for x in v]
    return None
out = {}
for f in sorted(glob.glob(os.path.join(rp, 'animations', '*.animation.json'))):
    for name, an in json.load(open(f)).get('animations', {}).items():
        bones = {}
        for bone, ch in (an.get('bones') or {}).items():
            e = {}
            for src, dst in (('scale', 'scale'), ('rotation', 'rot'), ('position', 'pos')):
                if src in ch:
                    n = num(ch[src])
                    if n is not None: e[dst] = n
            if e: bones[bone] = e
        if bones: out[name] = bones
dst = os.path.join(os.path.dirname(__file__), '..', 'src/main/resources/assets/rz_auto/geo/anim_static.json')
json.dump(out, open(dst, 'w'), indent=0, separators=(',', ':'))
print(len(out), 'animations ->', os.path.normpath(dst))
