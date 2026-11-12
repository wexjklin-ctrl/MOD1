#!/usr/bin/env python3
"""Bedrock id -> Java id + рецепты. Запуск: make_idmap.py <addon_dir> <out_dir>"""
import json, glob, re, sys, os
SRC, OUT = sys.argv[1], sys.argv[2]
def jl(p):
    s = open(p, encoding="utf-8-sig").read()
    try: return json.loads(s)
    except Exception: return json.loads(re.sub(r'^\s*//.*$', '', s, flags=re.M))
vehicles = json.load(open(f"{OUT}/vehicles.json", encoding="utf-8"))
idmap = {}
for v in vehicles:
    ns, name = v["id"].split(":")
    jid = f"rz_auto:{ns}_{name}".lower().replace("-", "_")
    idmap[v["id"]] = {"entity": jid, "item": jid, "bedrock_spawn_egg": f"{v['id']}_spawn_egg"}
assert len({m["entity"] for m in idmap.values()}) == len(idmap), "коллизия id"
other = {
    "carworkshop:driver_license": "rz_auto:driver_license",
    "carworkshop:gear": "rz_auto:gear",
    "carworkshop:bench": "rz_auto:bench",
    "rz:vehicle_remote": "rz_auto:vehicle_remote",
    "jeep:roof": "rz_auto:jeep_roof (в оригинале ничего не делает с v1.33)",
    "city:siren_tool": "rz_auto:siren_tool (в оригинале ничего не делает с v1.33)",
    "maybach:bounce_tool": "rz_auto:bounce_tool (в оригинале ничего не делает с v1.33)",
}
recipes = []
for f in sorted(glob.glob(f"{SRC}/BP/recipes/**/*.json", recursive=True)):
    r = jl(f)
    for kind, body in r.items():
        if not kind.startswith("minecraft:recipe_"): continue
        item = {"id": body["description"]["identifier"], "type": kind.replace("minecraft:recipe_", ""),
                "station": "rz_auto:bench", "result": body["result"]}
        if "pattern" in body:
            item["pattern"] = body["pattern"]
            item["key"] = {k: v["item"] for k, v in body["key"].items()}
        else:
            item["ingredients"] = body["ingredients"]
        res = item["result"]["item"]
        if res.endswith("_spawn_egg"):
            bid = res[:-len("_spawn_egg")]
            item["result"]["java_item"] = idmap.get(bid, {}).get("item")
        recipes.append(item)
json.dump({"vehicles": idmap, "other_items": other}, open(f"{OUT}/id_map.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(recipes, open(f"{OUT}/recipes.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("id_map:", len(idmap), "recipes:", len(recipes), "unmapped results:", [r["id"] for r in recipes if r["result"]["item"].endswith("_spawn_egg") and not r["result"].get("java_item")][:10])
