#!/usr/bin/env python3
"""Статический граф импортов скриптов аддона: какие файлы достижимы от scripts/main.js, какие импорты битые.
Запуск из папки Trackwork_RZ_BP: python3 reach.py   (динамических require/eval не видит)."""
import re, os, glob
root = 'scripts'
files = {os.path.normpath(f) for f in glob.glob(root + '/**/*.js', recursive=True)}
pat = re.compile(r'''(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)''')
graph, missing = {}, {}
for f in files:
    src = open(f, errors='replace').read()
    deps = set()
    for m in pat.finditer(src):
        p = next(x for x in m.groups() if x)
        if p.startswith('.'):
            t = os.path.normpath(os.path.join(os.path.dirname(f), p))
            (deps.add(t) if t in files else missing.setdefault(f, []).append(p))
    graph[f] = deps
seen, st = set(), [os.path.normpath('scripts/main.js')]
while st:
    x = st.pop()
    if x in seen: continue
    seen.add(x); st.extend(graph.get(x, ()))
print('total', len(files), 'reachable', len(seen), 'unreachable', len(files - seen))
for u in sorted(files - seen): print('UNREACH', u)
for f, l in missing.items(): print('MISSING in', f, sorted(set(l)))
