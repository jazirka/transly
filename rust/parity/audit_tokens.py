import re,sys,os
css=['theme','phone','app','shell','panels','states','buttons','merge','projset','topbar','ext']
root='/home/user/transly/app/src/ui/'
final={}; where={}
for f in css:
    t=open(root+f+'.css',encoding='utf-8').read()
    t=re.sub(r'/\*.*?\*/','',t,flags=re.S)
    # only :root blocks
    for m in re.finditer(r':root\s*\{([^}]*)\}',t):
        for d in re.finditer(r'(--[a-z0-9-]+)\s*:\s*([^;]+);?',m.group(1)):
            final[d.group(1)]=d.group(2).strip(); where[d.group(1)]=f
rs=open('/home/user/transly/rust/transly-app/src/theme.rs',encoding='utf-8').read()
consts={m.group(1):'#%02x%02x%02x'%tuple(int(x,16) for x in m.groups()[1:]) for m in re.finditer(r'pub const (\w+): Color32 = Color32::from_rgb\(0x(\w\w), 0x(\w\w), 0x(\w\w)\)',rs) for _ in [0]} if False else {}
for m in re.finditer(r'pub const (\w+): Color32 = Color32::from_rgb\(0x(\w\w), 0x(\w\w), 0x(\w\w)\)',rs):
    consts[m.group(1)]='#'+m.group(2)+m.group(3)+m.group(4)
pairs={'BG':'--bg','PANEL':'--panel','PANEL2':'--panel-2','LINE':'--line','TEXT':'--text','MUTE':'--mute','DIM':'--dim','OK':'--ok','WARN':'--warn','BAD':'--bad','INFO':'--info','VIOLET':'--violet'}
print('TOKEN   rust      web(final)   from')
for k,v in pairs.items():
    w=final.get(v,'?'); r=consts.get(k,'?')
    print(f"{k:7} {r:9} {w:12} {where.get(v,'')} {'  <== РОЗБІЖНІСТЬ' if r.lower()!=w.lower() else ''}")
print('\nвеб-токени, яких немає в Rust:'); 
for k,v in final.items():
    if k not in pairs.values(): print(' ',k,v[:70],'('+where[k]+')')
