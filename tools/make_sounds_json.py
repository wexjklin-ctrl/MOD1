#!/usr/bin/env python3
"""RP/sound_definitions.json (Bedrock) -> assets/rz_auto/sounds.json (Java). Имена событий сохраняются (rz.idle.e46s54.00 и т.д.)."""
import json, sys
src = sys.argv[1] if len(sys.argv) > 1 else '/tmp/addon/RP/sounds/sound_definitions.json'
d = json.load(open(src)); d = d.get('sound_definitions', d)
out = {}
for k, v in d.items():
    snds = []
    for s in v['sounds']:
        n = s if isinstance(s, str) else s['name']
        snds.append({'name': 'rz_auto:' + n.replace('sounds/', '', 1)})
    out[k] = {'sounds': snds}
json.dump(out, open('src/main/resources/assets/rz_auto/sounds.json', 'w'), indent=1)
print(len(out), 'событий')
