#!/usr/bin/env python3
"""Restores byte-exact originals: strip_annotations.py <annotated_dir> <out_dir>"""
import os,sys
src,out=sys.argv[1:3]; BEG=b'/* CLAUDE-MAP-BEGIN\n'; END=b' CLAUDE-MAP-END */\n'
n=0
for r,_,fs in os.walk(src):
    for f in fs:
        if not f.endswith('.js'): continue
        b=open(os.path.join(r,f),'rb').read()
        if b.startswith(BEG): b=b[b.index(END)+len(END):]
        d=os.path.join(out,os.path.relpath(r,src)); os.makedirs(d,exist_ok=True); open(os.path.join(d,f),'wb').write(b); n+=1
print('stripped',n)
