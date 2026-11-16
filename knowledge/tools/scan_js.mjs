// Parses every BP script via AST -> JSON catalog. Usage: node scan_js.mjs <scriptsDir> <out.json>
import fs from 'fs'; import path from 'path';
import * as acorn from 'acorn'; import * as walk from 'acorn-walk';
const root = process.argv[2], out = process.argv[3];
const files = []; (function rec(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) { const p=path.join(d,e.name); e.isDirectory()?rec(p):e.name.endsWith('.js')&&files.push(p);} })(root);
const cat = {};
for (const f of files.sort()) {
  const rel = path.relative(root, f).replace(/\\/g,'/'); const src = fs.readFileSync(f,'utf8');
  const rec = { bytes: Buffer.byteLength(src), lines: src.split('\n').length, imports: [], exports: [], functions: [], classes: [], consts: [], events: [], intervals: 0, scriptevents: [], dynprops: [], error: null };
  let ast; try { ast = acorn.parse(src,{ecmaVersion:'latest',sourceType:'module',locations:true,allowHashBang:true}); } catch(e){ rec.error=String(e); cat[rel]=rec; continue; }
  const L = n => n.loc.start.line;
  for (const n of ast.body) {
    if (n.type==='ImportDeclaration') rec.imports.push({from:n.source.value, names:n.specifiers.map(s=>s.local.name)});
    let d = n; if (n.type.startsWith('Export')) { d = n.declaration||n; if (n.source) rec.imports.push({from:n.source.value,names:['(re-export)']}); n.specifiers&&n.specifiers.forEach(s=>rec.exports.push(s.exported.name)); }
    const exp = n.type.startsWith('Export');
    if (d.type==='FunctionDeclaration') { rec.functions.push({name:d.id.name,line:L(d),end:d.loc.end.line,params:d.params.length,async:d.async||false}); exp&&rec.exports.push(d.id.name); }
    else if (d.type==='ClassDeclaration') { rec.classes.push({name:d.id.name,line:L(d),end:d.loc.end.line,methods:d.body.body.filter(m=>m.key).map(m=>m.key.name||m.key.value)}); exp&&rec.exports.push(d.id.name); }
    else if (d.type==='VariableDeclaration') for (const v of d.declarations) if (v.id.name) {
      const fn = v.init && /Function/.test(v.init.type);
      (fn?rec.functions:rec.consts).push({name:v.id.name,line:L(v),end:v.loc.end.line,...(fn?{params:v.init.params.length}:{})}); exp&&rec.exports.push(v.id.name); }
  }
  walk.simple(ast,{ CallExpression(n){
    const c=n.callee; const s = c.type==='MemberExpression' ? src.slice(c.start,c.end) : (c.name||'');
    if (/^(world|system)\.(afterEvents|beforeEvents)\.\w+\.subscribe$/.test(s)) rec.events.push({ev:s.replace(/\.subscribe$/,''),line:L(n)});
    else if (/^system\.(runInterval|runTimeout|run)$/.test(s)) { rec.intervals++; }
    else if (/(setDynamicProperty|getDynamicProperty)$/.test(s) && n.arguments[0] && n.arguments[0].type==='Literal') { if(!rec.dynprops.includes(n.arguments[0].value)) rec.dynprops.push(n.arguments[0].value); }
  }, Literal(n){ }});
  const re=/\/scriptevent[^\n]{0,60}|scriptEventReceive|id\s*===?\s*["']([\w]+:[\w:]+)["']/g; let m; const seen=new Set();
  while((m=re.exec(src))) if(m[1]&&!seen.has(m[1])){seen.add(m[1]);rec.scriptevents.push(m[1]);}
  cat[rel]=rec;
}
fs.writeFileSync(out, JSON.stringify(cat,null,1));
const errs = Object.entries(cat).filter(([,r])=>r.error); console.log('files',files.length,'errors',errs.length, errs.map(e=>e[0]+': '+e[1].error));
