import re,glob,collections
web=collections.Counter()
for f in glob.glob('/home/user/transly/app/src/ui/*.css'):
    t=open(f,encoding='utf-8').read()
    for m in re.finditer(r'#([0-9a-fA-F]{6})\b',t): web[m.group(1).lower()]+=1
    for m in re.finditer(r'#([0-9a-fA-F]{3})\b',t):
        h=m.group(1); web[''.join(c*2 for c in h).lower()]+=1
nat=collections.defaultdict(list)
for f in glob.glob('/home/user/transly/rust/transly-app/src/*.rs'):
    for i,l in enumerate(open(f,encoding='utf-8'),1):
        for m in re.finditer(r'from_rgb\(0x(\w\w), ?0x(\w\w), ?0x(\w\w)\)',l):
            nat[(m.group(1)+m.group(2)+m.group(3)).lower()].append(f"{f.split('/')[-1]}:{i}")
tok={'1e1f22','2b2d30','26282b','393b40','dfe1e5','a9aeb6','8f959d','5fb865','e5a04b','f75464','56a8f5','b589d6'}
print('Кольори в Rust, яких немає у веб-CSS (і не токени):')
for c,where in sorted(nat.items()):
    if c not in web and c not in tok:
        print(' #'+c, where[:3])
