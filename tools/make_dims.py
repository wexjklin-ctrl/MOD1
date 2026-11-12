import json,glob,os
R='src/main/resources/'
vs=json.load(open(R+'data/vehicles.json'))
st=json.load(open(R+'assets/rz_auto/geo/anim_static.json'))
ext={}
for f in glob.glob(R+'assets/rz_auto/geo/*.geo.json'):
    d=json.load(open(f))
    for g in d.get('minecraft:geometry',[]):
        gid=g['description']['identifier']
        xs=[];zs=[];ys=[]
        for b in g.get('bones',[]):
            for c in b.get('cubes',[]):
                o=c['origin'];s=c['size']
                xs+= [o[0],o[0]+s[0]]; ys+=[o[1],o[1]+s[1]]; zs+=[o[2],o[2]+s[2]]
        if xs: ext[gid]=(max(xs)-min(xs),max(zs)-min(zs),max(ys))
    for b in d.get('geometry',[]) if isinstance(d.get('geometry'),list) else []: pass
out={}
for v in vs:
    g=v['geometry']; e=ext.get(g)
    if not e: continue
    sc=1.0
    an=v.get('animations',{})
    k='drive' if 'drive' in an else next((k for k in an if k.startswith('drive')),None)
    if k:
        a=st.get(an[k],{}).get('root',{}).get('scale')
        if a: sc=a[0]
    out[v['id']]=[round(e[0]*sc/16,2),round(e[1]*sc/16,2),round(e[2]*sc/16,2)]
json.dump(out,open(R+'data/dims.json','w'))
print(len(out),'of',len(vs)); print(list(out.items())[:3]); 
import statistics
print(min(o[0] for o in out.values()),max(o[0] for o in out.values()),min(o[1] for o in out.values()),max(o[1] for o in out.values()))
