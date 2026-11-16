#!/usr/bin/env python3
"""Adds a CLAUDE-MAP header to every script. Reversible via strip_annotations.py (byte-exact)."""
import os,sys,json,re,posixpath
scripts,catp,bundlep,out=sys.argv[1:5]
cat=json.load(open(catp)); bm=json.load(open(bundlep))
ROLES={
'main.js':'ENTRY POINT (esbuild bundle of src/PhysicsPhysics/main.ts + gameplay modules, ~25k lines). Contraption assembly/disassembly, sessions, input, rendering batches, persistence, plus RZ Lite glue. Startup wiring of every other module.',
'physics.js':'PHYSICS CORE (esbuild bundle). Contains cannon-es + CannonKernelRuntime + PhysicsWorld/PhysicsDimension/PhysicsBody adapter, world-mesh colliders, OBB, block collision tables.',
'config.js':'DEAD: describes an older engine (gravity -9.81, phys:* entities). Not imported.',
'api/physics.js':'Thin re-export of ../physics.js public API.',
'blocks/rz_drive.js':'RZ Lite drive: throttle/steering/gearbox for ground vehicles; kinematic velocity control; scriptevent rzlite:drive.',
'blocks/rz_susp.js':'RZ Lite suspension: spring/offset per wheel, ground sampling; scriptevent rzlite:susp.',
'blocks/track_belt.js':'RZ Lite tracked belt visuals/logic; scriptevent rzlite:track.',
'blocks/rz_parts.js':'RZ Lite part registry: block id -> visual entity id / rotation.',
'blocks/rz_block_mass.js':'Weight and buoyancy per block (RZ values); scriptevent rzlite:weight.',
'blocks/rz_block_strength.js':'Per-block strength used for explosion/projectile damage to vehicles.',
'blocks/car_drive.js':'Older car drive helper.','blocks/tower.js':'Tower/core block handling (mandatory core of a contraption).',
'blocks/airplane_flight.js':'Aircraft flight model.','blocks/airplane_math.js':'Aircraft math helpers.',
'blocks/rope_simulation.js':'Rope / handles link simulation.','blocks/deployer.js':'Deployer block automation.',
'blocks/wheel_marks.js':'DEAD: wheel tracks decals, not imported.',
'cbc/main.js':'Create Big Cannons port entry; scriptevent cbc:admin.','cbc/twin.js':'CBC multiblock/cannon logic (largest CBC file).',
'cbc/world.js':'CBC world interaction (break/explode/lever).','cbc/impact.js':'Projectile impact & damage to structures (hook into main.js).',
'cbc/projectiles.js':'Projectile entities/ballistics glue.','cbc/recoil.js':'Cannon recoil on contraptions.','cbc/fuze.js':'Fuzes/explosions.',
'cbc/cmMount.js':'Cannon mount integration with assembled contraptions.','irons/main.js':"Iron's Arms n Artifice guns port; scriptevent irons:kit.",
'core/cbcMount.js':'DEAD: old mount code; imports missing modules (lib/*, core/*).','core/cbcLooks.js':'DEAD.','cbc/types.js':'DEAD.',
'contraptions/ContraptionSailRenderer.js':'DEAD.','i18n/strings.js':'i18n table S[id]=[ru,en,es]; code calls __t(id). See docs _generated/strings.md.',
}
def role(k,v):
    if k in ROLES: return ROLES[k]
    src=open(os.path.join(scripts,k),encoding='utf8',errors='replace').read(400)
    m=re.match(r'\s*(?://|/\*+)\s*([^\n*]{8,140})',src)
    return ('(auto, from first comment) '+m.group(1).strip()) if m else '(no author comment; infer from name/exports — see docs/_generated/exports.md)'
def res(src,imp): return posixpath.normpath(posixpath.join(posixpath.dirname(src),imp)) if imp.startswith('.') else imp
rev={}
for k,v in cat.items():
    for i in v['imports']: rev.setdefault(res(k,i['from']),[]).append(k)
BEG='/* CLAUDE-MAP-BEGIN\n'; END=' CLAUDE-MAP-END */\n'
for k,v in sorted(cat.items()):
    p=os.path.join(scripts,k); raw=open(p,'rb').read()
    h=[f' FILE: {k}  ({v["bytes"]//1024} KB, {v["lines"]} lines)  [auto-generated header; code below is UNCHANGED]',f' ROLE: {role(k,v)}']
    h.append(' IMPORTS: '+(', '.join(sorted({res(k,i["from"]) for i in v["imports"]}))[:400] or '-'))
    h.append(' IMPORTED BY: '+(', '.join(sorted(rev.get(k,[])))[:300] or '- (none: DEAD or entry)'))
    if v['exports']: h.append(' EXPORTS: '+', '.join(v['exports'][:40])+(' …' if len(v['exports'])>40 else ''))
    ev=sorted({e['ev'].split('.')[-1] for e in v['events']})
    if ev: h.append(' EVENTS: '+', '.join(ev))
    if v['dynprops']: h.append(' DYN-PROPS: '+', '.join(v['dynprops'][:20]))
    big=sorted(v['functions'],key=lambda f:-(f['end']-f['line']))[:12]
    if big: h.append(' KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): '+'; '.join(f"{f['name']}@{f['line']}({f['end']-f['line']+1}L)" for f in big))
    if k in bm:
        h.append(' INTERNAL MODULES (original line numbers):')
        for s in bm[k]: h.append(f"   L{s['start']}-{s['end']} {s['module']}")
    h.append(' NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.')
    hdr=(BEG+'\n'.join(h).replace('*/','* /')+'\n'+END).encode('utf8')
    dst=os.path.join(out,k); os.makedirs(os.path.dirname(dst),exist_ok=True)
    # keep shebang/first line semantics: header is prepended; ES modules allow leading comments
    open(dst,'wb').write(hdr+raw)
print('annotated',len(cat))
