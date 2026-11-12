#!/usr/bin/env python3
"""Извлекает из Bedrock-аддона rz_авто всю игровую базу в JSON для Java-порта.
Запуск: python extract_data.py <папка_распакованного_аддона> <папка_вывода>
"""
import json, glob, os, re, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = sys.argv[2] if len(sys.argv) > 2 else "./data"
os.makedirs(OUT, exist_ok=True)

def jl(p):
    s = open(p, encoding="utf-8-sig").read()
    try:
        return json.loads(s)
    except Exception:
        return json.loads(re.sub(r'^\s*//.*$', '', s, flags=re.M))

def js_table(src, name):
    """Парсит JS-массив объектов вида { prefix: "x:", a: 1, b: [1,2] }."""
    m = re.search(r'const %s = \[(.*?)\n\];' % name, src, re.S)
    rows = []
    for line in m.group(1).splitlines():
        line = line.split('//')[0].strip().rstrip(',')
        if not line.startswith('{'):
            continue
        d = {}
        for k, v in re.findall(r'(\w+):\s*(\[[^\]]*\]|"[^"]*"|[-\d.]+)', line):
            d[k] = json.loads(v)
        rows.append(d)
    return rows

main = open(f"{SRC}/BP/scripts/main.js", encoding="utf-8").read()
prof = open(f"{SRC}/BP/scripts/vehicle_profiles.js", encoding="utf-8").read()

tables = {
    "fuel": js_table(main, "FUEL_PROFILES"),
    "breakdown": js_table(main, "BREAKDOWN_PROFILES"),
    "regen": js_table(main, "REGEN_PROFILES"),
    "accel": js_table(prof, "ACCEL_PROFILES"),
    "top_speed": js_table(prof, "TOP_SPEED_PROFILES"),
    "gear7": js_table(prof, "GEAR7_PROFILES"),
}
const = {
    "breakdown_thresholds_blocks": json.loads(re.search(r'BREAKDOWN_THRESHOLDS = (\[[^\]]*\])', main).group(1)),
    "speed_percent_levels": json.loads(re.search(r'SPEED_LEVELS = (\[[^\]]*\])', main).group(1)),
    "turn_strength": {"min": 1, "max": 10, "step": 0.5, "default": 1},
    "units": "1 unit = 1 block/tick = 72 km/h",
    "profiles": {
        "car": {"rotationSpeed": 40, "brakeSpeed": 0.5, "brakeForce": 3, "reverseModifier": 0.5, "default_accel": 2},
        "motorcycle": {"rotationSpeed": 65, "brakeSpeed": 0.8, "brakeForce": 4, "reverseModifier": 0.15, "default_accel": 1.4},
    },
    "items": {"license": "carworkshop:driver_license", "gear": "carworkshop:gear", "bench": "carworkshop:bench"},
}

def family(tid):
    for t in tables["top_speed"]:
        if tid.startswith(t["prefix"]):
            return t["prefix"]
    return None

def lookup(tab, tid):
    for r in tables[tab]:
        if tid.startswith(r["prefix"]):
            return {k: v for k, v in r.items() if k != "prefix"}
    return None

vehicles = []
for bp in sorted(glob.glob(f"{SRC}/BP/entities/*.json")):
    e = jl(bp)["minecraft:entity"]
    d, c = e["description"], e["components"]
    tid = d["identifier"]
    cid = tid.split(":")[1]
    rp = None
    for cand in glob.glob(f"{SRC}/RP/entity/*.json"):
        r = jl(cand)["minecraft:client_entity"]["description"]
        if r["identifier"] == tid:
            rp = r; break
    seats = c.get("minecraft:rideable", {}).get("seats", [])
    cb = c.get("minecraft:collision_box", {})
    vehicles.append({
        "id": tid,
        "family_prefix": family(tid),
        "is_motorcycle": tid.split(":")[0] in ("ducati", "ktm", "yamaha"),
        "geometry": (rp or {}).get("geometry", {}).get("default"),
        "texture": (rp or {}).get("textures", {}).get("default"),
        "animations": (rp or {}).get("animations", {}),
        "client_scripts": (rp or {}).get("scripts", {}),
        "seats": [s.get("position") for s in seats],
        "collision": [cb.get("width"), cb.get("height")],
        "max_auto_step": c.get("minecraft:variable_max_auto_step", {}).get("base_value"),
        "health": c.get("minecraft:health", {}).get("value"),
        "movement_bedrock": c.get("minecraft:movement", {}).get("value"),
        "profile": {
            "top_speed": (lookup("top_speed", tid) or {}).get("topSpeed"),
            "accel": (lookup("accel", tid) or {}).get("acceleration"),
            "fuel": lookup("fuel", tid),
            "breakdown_chances_pct": (lookup("breakdown", tid) or {}).get("chances"),
            "regen_power": (lookup("regen", tid) or {}).get("power"),
            "gear7": lookup("gear7", tid),
        },
        "spawn_egg_texture": (rp or {}).get("spawn_egg", {}).get("texture"),
    })

json.dump({"constants": const, "tables": tables}, open(f"{OUT}/balance.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(vehicles, open(f"{OUT}/vehicles.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("vehicles:", len(vehicles))
miss = [v["id"] for v in vehicles if v["profile"]["top_speed"] is None]
print("без профиля скорости:", miss)
miss = [v["id"] for v in vehicles if not v["geometry"] or not v["texture"]]
print("без клиентской записи:", miss)
