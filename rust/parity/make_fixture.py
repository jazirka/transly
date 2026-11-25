import json, os, sys
out = sys.argv[1]
d = os.path.join(out, 'ParityGame', 'data'); os.makedirs(d, exist_ok=True)
def w(name, obj): open(os.path.join(d, name), 'w', encoding='utf-8').write(json.dumps(obj, ensure_ascii=False))
parts = ['right leg', 'left leg', 'torso', 'head', 'left arm', 'right arm']
mobs = ['Villager', 'Ronteal', 'Platoon', 'Caligura']
enemies = [None] + [{'id': i + 1, 'name': f'{m} [{p}]', 'note': '', 'actions': [], 'traits': []} for i, (m, p) in enumerate((m, p) for m in mobs for p in parts)]
w('Enemies.json', enemies)
w('Actors.json', [None] + [{'id': i + 1, 'name': n, 'nickname': '', 'profile': pr, 'note': ''} for i, (n, pr) in enumerate([('Hero', 'Brave and loyal'), ('Mage', 'Wise, but tired'), ('Levi', 'Quiet traveller'), ('Cook', 'Makes soup at dawn')])])
w('Items.json', [None] + [{'id': i + 1, 'name': n, 'description': ds, 'note': ''} for i, (n, ds) in enumerate([('Red apple', 'Restores a little health.'), ('Old hat', 'A hat that has seen better days.'), ('Cloak', 'Keeps the cold off.'), ('Iron key', 'Opens the cellar door.')])])
w('System.json', {'gameTitle': 'Parity Game', 'terms': {'basic': ['Level', 'Lv', 'HP', 'HP', 'MP', 'MP']}, 'currencyUnit': 'G'})
def c(code, p, ind=0): return {'code': code, 'indent': ind, 'parameters': p}
def say(t, who='Cook'): return [c(101, ['', 0, 0, 2, who]), c(401, [t])]
page = lambda lst: {'conditions': {}, 'list': lst + [c(0, [])], 'trigger': 0}
ev1 = {'id': 1, 'name': 'Cook', 'x': 3, 'y': 4, 'pages': [page(say('Take your hat off, then pick the red apple up.') + say('Please take the cloak off.') + say('He took his boots off and sat down.', 'Narrator'))]}
ev2 = {'id': 2, 'name': 'Guard', 'x': 6, 'y': 2, 'pages': [page(say('Halt! Who goes there?', 'Guard') + say('Move along, traveller. The gate is closed.', 'Guard'))]}
w('Map001.json', {'displayName': 'Town', 'events': [None, ev1, ev2]})
# project.json (формат старого застосунку; без знімка: оригінали беруться з гри)
def ent(t, st, mt=1700000000000, hist=None, comments=None):
    e = {'target': t, 'status': st, 'mt': mt, 'history': hist or []}
    if comments: e['comments'] = comments
    return e
enemies_tr = {}
tr = {0: ('Селянин [права нога]', 'appr'), 1: ('Селянин [ліва нога]', 'done'), 2: ('Селянин [торс]', 'draft'), 3: ('Селянин [голова]', 'done'), 6: ('Ронтеаль [права нога]', 'draft')}
for i, (t, st) in tr.items(): enemies_tr[f'[{i + 1}].name'] = ent(t, st)
proj = {'version': 1, 'name': 'Parity Game', 'sourceLang': 'en', 'targetLang': 'uk', 'resetEpoch': 0,
  'files': {'Enemies.json': enemies_tr,
            'Actors.json': {'[1].name': ent('Герой', 'appr'), '[2].name': ent('Маг', 'done'), '[3].name': ent('Леві', 'draft')},
            'Map001.json': {'events[1].pages[0].list[1]': ent('Зніми капелюх, а тоді підніми червоне яблуко.', 'draft')}},
  'memory': [], 'terms': [
    {'en': 'hat', 'uk': 'капелюх', 'alt': 'шапка', 'qa': True, 'mt': 1700000000000},
    {'en': 'Levi', 'uk': 'Леві', 'qa': True, 'mt': 1700000000000},
    {'en': 'apple', 'uk': 'яблуко', 'qa': True, 'mt': 1700000000000},
    {'en': 'left arm', 'uk': 'ліва рука', 'qa': True, 'mt': 1700000000000}],
  'settings': {'tolerancePct': 25, 'blockErrors': True, 'who': 'Ви', 'propagate': True, 'pluginCommands': [], 'pluginsAsked': False, 'lineLimit': 0}}
open(os.path.join(out, 'project.json'), 'w', encoding='utf-8').write(json.dumps(proj, ensure_ascii=False))
print('ok', d)
