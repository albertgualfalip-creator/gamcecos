"""Build the game's health centre dataset (CAP, atenció continuada, hospitals) from the
Generalitat open data catalogue "Equipaments de Catalunya" (8gmd-gz7i)."""
import json, re, sys, urllib.parse, urllib.request

from zones import Zones

API = 'https://analisi.transparenciacatalunya.cat/resource/8gmd-gz7i.json'
TIPUS = {
    "1. Centres d'atenció primària (CAP)": 'CAP',
    "2. Centres amb atenció continuada": 'PAC',
    "3. Hospitals": 'HOSPITAL',
}

def fetch():
    params = {
        '$select': 'idequipament,nom,categoria,poblacio,propietats,latitud,longitud',
        '$where': "starts_with(categoria,'Salut|Centres sanitaris|1.') OR categoria like '%|2. Centres amb atenció continuada|%'"
                  " OR categoria like '%|3. Hospitals|%'",
        '$limit': '5000',
    }
    with urllib.request.urlopen(API + '?' + urllib.parse.urlencode(params), timeout=120) as r:
        return json.load(r)

def horari(propietats):
    m = re.search(r'Horari\|([^|]*)', propietats or '')
    return m[1].strip() if m else None

zones = Zones(sys.argv[1])
centres = []
for r in fetch():
    tipus = next((t for k, t in TIPUS.items() if k in r['categoria']), None)
    try: lat, lon = float(r['latitud']), float(r['longitud'])
    except (KeyError, ValueError): continue
    if tipus is None: continue
    # Region/subzone of the nearest unit base, so centres follow the same zones as the units
    regio, subzona = zones.nearest(lat, lon)
    centres.append(dict(id=r['idequipament'], nom=r['nom'].strip(), tipus=tipus, municipi=r.get('poblacio', '').title(),
                        lat=round(lat, 6), lon=round(lon, 6), horari=horari(r.get('propietats')),
                        regio=regio, subzona=subzona))

centres.sort(key=lambda c: (c['tipus'], c['regio'], c['nom']))
json.dump(centres, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
from collections import Counter
print(len(centres), 'centres', Counter(c['tipus'] for c in centres))
for reg in sorted({c['regio'] for c in centres}):
    print(reg, dict(Counter(c['tipus'] for c in centres if c['regio'] == reg)))
