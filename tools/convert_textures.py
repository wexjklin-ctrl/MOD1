#!/usr/bin/env python3
"""Bedrock PBR (texture_set: color + MER) -> Java labPBR (Iris/Optifine шейдеры).

Bedrock MER: R=metalness, G=emissive, B=roughness.
labPBR _s : R=perceptual smoothness, G=F0 (255 = металл по albedo), B=пористость, A=emissive (0..254, 255 = нет).

Запуск: python convert_textures.py <RP/textures/entity> <out_dir> [--emissive-boost 1.0]
Выход (в <out_dir>):
  <name>.png            цветная текстура (как была)
  <name>_s.png          labPBR specular (металл/гладкость/свечение фар для шейдеров)
  <name>_e.png          маска свечения (для ванильного fullbright-слоя без шейдеров), только если есть emissive
"""
import json, os, sys, shutil, glob
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
boost = float(sys.argv[sys.argv.index("--emissive-boost") + 1]) if "--emissive-boost" in sys.argv else 1.0
os.makedirs(out, exist_ok=True)

def find_png(name):
    for cand in (name, name.lower()):
        p = os.path.join(src, cand + ".png")
        if os.path.exists(p):
            return p
    # регистронезависимый поиск
    low = name.lower() + ".png"
    for f in os.listdir(src):
        if f.lower() == low:
            return os.path.join(src, f)
    return None

stats = {"sets": 0, "with_emissive": 0, "no_mer": [], "size_mismatch": []}
done_mer_cache = {}
for ts in sorted(glob.glob(os.path.join(src, "*.texture_set.json"))):
    d = json.load(open(ts, encoding="utf-8-sig"))["minecraft:texture_set"]
    color_name = d["color"]
    cpath = find_png(color_name)
    if not cpath:
        continue
    stats["sets"] += 1
    shutil.copy(cpath, os.path.join(out, color_name.lower() + ".png"))
    mer_name = d.get("metalness_emissive_roughness")
    mpath = find_png(mer_name) if isinstance(mer_name, str) else None
    if not mpath:
        stats["no_mer"].append(color_name)
        continue
    color = Image.open(cpath).convert("RGBA")
    mer = Image.open(mpath).convert("RGB")
    if mer.size != color.size:
        stats["size_mismatch"].append((color_name, color.size, mer.size))
        mer = mer.resize(color.size, Image.NEAREST)
    M, E, R = mer.split()
    smooth = R.point(lambda v: 255 - v)                       # perceptual smoothness
    f0 = M.point(lambda v: 255 if v > 127 else 12)            # металл -> 255, диэлектрик ~4% F0
    por = Image.new("L", color.size, 0)
    # Фары: в MER emissive у этих машин очень слабый (G<=25). Для шейдеров делаем явное свечение.
    has_e = E.getextrema()[1] > 0
    emi = E.point(lambda v: min(254, int(254 * boost)) if v > 0 else 255)
    spec = Image.merge("RGBA", (smooth, f0, por, emi))
    spec.save(os.path.join(out, color_name.lower() + "_s.png"))
    if has_e:
        stats["with_emissive"] += 1
        mask = E.point(lambda v: 255 if v > 0 else 0)
        mask.save(os.path.join(out, color_name.lower() + "_e.png"))

print(json.dumps(stats, ensure_ascii=False, indent=1)[:1500])
