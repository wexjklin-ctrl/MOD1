#!/usr/bin/env python3
"""Иконки ключей из spawn_egg_texture оригинала. Запуск: python3 tools/make_icons.py /path/to/RP"""
import json, os, sys, shutil
rp = sys.argv[1] if len(sys.argv) > 1 else 'RP'
root = os.path.join(os.path.dirname(__file__), '..', 'src/main/resources')
a = os.path.join(root, 'assets/rz_auto')
for d in ('textures/item', 'models/item', 'items'): os.makedirs(os.path.join(a, d), exist_ok=True)
have = {f.lower(): f for f in os.listdir(os.path.join(rp, 'textures/items'))}
ok = 0
for v in json.load(open(os.path.join(root, 'data/vehicles.json'))):
    name = v['id'].replace(':', '_').lower()
    egg = v.get('spawn_egg_texture', '').lower() + '.png'
    if egg not in have: continue
    shutil.copy(os.path.join(rp, 'textures/items', have[egg]), os.path.join(a, 'textures/item', name + '.png'))
    json.dump({"parent": "minecraft:item/generated", "textures": {"layer0": "rz_auto:item/" + name}}, open(os.path.join(a, 'models/item', name + '.json'), 'w'))
    json.dump({"model": {"type": "minecraft:model", "model": "rz_auto:item/" + name}}, open(os.path.join(a, 'items', name + '.json'), 'w'))
    ok += 1
print(ok, 'icons')
