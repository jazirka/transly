import json,sys
d=json.load(open(sys.argv[1]))
def fam(s): return s.split(',')[0].strip("' \"")
for k,v in d.items():
    if not v: print(f"{k:11} -"); continue
    r=v['rect']; parts=[f"{r[0]},{r[1]} {r[2]}×{r[3]}"]
    if 'font-size' in v: parts.append(f"{fam(v.get('font-family',''))} {v['font-size']} w{v.get('font-weight','')} lh{v.get('line-height','')}")
    if 'color' in v: parts.append('fg '+v['color'].replace('rgb','').replace(' ',''))
    if 'background-color' in v: parts.append('bg '+v['background-color'].replace('rgb','').replace(' ',''))
    if 'border-top-color' in v: parts.append('bd '+v.get('border-top-width','')+' '+v.get('border-top-color','').replace('rgb','').replace(' ',''))
    if 'border-radius' in v: parts.append('r '+v['border-radius'])
    if 'padding' in v: parts.append('pad '+v['padding'])
    if 'gap' in v: parts.append('gap '+v['gap'])
    if 'text-transform' in v: parts.append(v['text-transform'])
    print(f"{k:11}",' | '.join(parts))
