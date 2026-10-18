"""Build the game's AED (DEA) dataset from the Generalitat open data registry (wpud-ukyg).
Only fixed AEDs (not in vehicles) with location are kept."""
import json, sys, urllib.parse, urllib.request
from collections import Counter

from zones import Zones

API = 'https://analisi.transparenciacatalunya.cat/resource/wpud-ukyg.json'
params = {'$select': 'numero_inscripcio,nom_centre,espai_fisic,municipi,latitud,longitud',
          '$where': "vehicle != 'Sí' AND latitud IS NOT NULL", '$limit': '50000'}
with urllib.request.urlopen(API + '?' + urllib.parse.urlencode(params), timeout=120) as r:
    rows = json.load(r)

zones = Zones(sys.argv[1])
deas = []
for r in rows:
    try: lat, lon = float(r['latitud']), float(r['longitud'])
    except (KeyError, ValueError): continue
    if not (40.4 <= lat <= 42.95 and 0.1 <= lon <= 3.4): continue
    regio, subzona = zones.nearest(lat, lon)
    deas.append(dict(id=r.get('numero_inscripcio'), nom=(r.get('nom_centre') or '').strip(), espai=(r.get('espai_fisic') or '').strip(),
                     municipi=r.get('municipi'), lat=round(lat, 6), lon=round(lon, 6), regio=regio, subzona=subzona))

deas.sort(key=lambda d: (d['regio'], d['municipi'] or '', d['nom']))
json.dump(deas, open(sys.argv[2], 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(rows), 'registres,', len(deas), 'DEA fixos amb ubicació', dict(Counter(d['regio'] for d in deas)))
