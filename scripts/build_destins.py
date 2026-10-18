"""Build the list of real destination centres (hospitals, CUAP, CAP) from activation exports,
located with the Generalitat open data catalogue "Equipaments de Catalunya" (8gmd-gz7i).

Usage: build_destins.py <unitats.json> <export1.xlsx> [<export2.xlsx> ...] <out.json>"""
import difflib, json, re, sys, unicodedata, urllib.parse, urllib.request

import pandas as pd

from zones import Zones

API = 'https://analisi.transparenciacatalunya.cat/resource/8gmd-gz7i.json'
CENTRE = re.compile(r'hospital|cuap|^cap |althaia|parc tauli|mutua|parc sanitari|santa caterina|fundacio|institut|clinica|consorci|ico', re.I)
MIN_SERVEIS = 3
# Export name -> exact catalogue name, where similarity matching fails or picks the wrong centre
ALIES = {
    'Corporació Sanitària Parc Taulí': 'Hospital Universitari Parc Taulí',
    'Althaia Manresa': 'Hospital Sant Joan de Déu de Manresa',
    'Edifici Santa Caterina-Parc Hospitalari Martí i Julià': 'Parc Hospitalari Martí i Julià',
    'H.Psiquiàtric-Parc Hospitalari Martí i Julià': 'Parc Hospitalari Martí i Julià',
    'Mutua de Terrassa': 'Hospital Mútua de Terrassa',
    'Hospital Clínic i Provincial de Barcelona': 'Hospital Clínic de Barcelona',
    'Hospital Plató': 'Hospital Clínic de Barcelona, seu Plató',
    'Hospital Universitari de Girona Doctor Josep Trueta': 'Hospital Universitari Doctor Josep Trueta de Girona',
    'Hospital Universitari de Tarragona Joan XXIII': 'Hospital Universitari Joan XXIII de Tarragona',
    'Fundació Privada Hospital de Mollet': 'Hospital de Mollet',
    'Hospital Moises Broggi-CSI': 'Hospital de Sant Joan Despí Moisès Broggi',
    'Hospital Sant Jaume': 'Hospital Comarcal Sant Jaume de Calella',
    'Hospital General de Vic': 'Hospital Universitari de Vic',
    'Hospital de Blanes i Comarcal de la Selva': 'Hospital Comarcal de Blanes',
    "Hospital de l'Esperit Sant": "Fundació Hospital de l'Esperit Sant",
    'Hospital de Sant Bernabé': 'Hospital Comarcal Sant Bernabé',
    'Hospital de Santa Maria': 'Hospital Universitari Santa Maria',
    'CUAP Hospital Dos de Maig': 'Hospital Dos de Maig',
    'CUAP Sant Martí': 'CAP Sant Martí - Equip Sant Martí',
    'CUAP Manso': 'CAP Manso - Equip Via Roma',
    'CUAP Cotxeres': 'CAP Centre Integral de Salut Cotxeres',
    'CUAP Horta': 'CAP Horta - Equip Barcelona 7D',
    'CUAP El Serral': 'CAP El Serral de Sant Vicenç dels Horts',
    'CUAP Sant Cugat': 'CAP Sant Cugat del Vallès',
    'CUAP Salou': 'CAP Salou',
    'CUAP MOLLERUSSA': 'CAP Mollerussa',
    'CUAP Santa Coloma de Gramenet': 'CAP Santa Coloma de Gramenet',
    'ATINT-(PSSJD)Parc Sanitari Sant Joan de Déu-Hospital': 'Hospital General. Parc Sanitari Sant Joan de Déu',
    'VENDRELL, HOSPITAL DEL': 'Hospital del Vendrell',
    'Hospital Universitari Germans Trias I Pujol': 'Hospital Universitari Germans Trias i Pujol de Badalona',
    'Parc Sanitari Sant Joan de Déu-General': 'Hospital General. Parc Sanitari Sant Joan de Déu',
    'Fundació Hospital Comarcal Sant Antoni Abat': 'Hospital Comarcal Sant Antoni Abat',
    'Hospital de Cerdanya': 'AECT Hospital de Cerdanya',
    "Hospital de La Seu d'Urgell": 'Fundació Sant Hospital',
}
# Centres that the catalogue does not list; left out until their location is known
SENSE_CATALEG = {'CUAP Sant Felix', 'CUAP Cerdanyola-Ripollet', 'CUAP Castelldefels', 'CUAP Sant Andreu de la Barca',
                 'Hospital de Barcelona', 'Fundacio Hospitalaries Martorell (P)',
                 'CAP Cornellà de Llobregat', 'CAP El Vendrell'}

def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\b(hospital|universitari|de|del|la|i|l|d|el|centre|cap|cuap)\b', ' ', re.sub(r"[^a-z0-9 ]", ' ', s))
    return ' '.join(s.split())

def tipus(nom):
    n = nom.lower()
    return 'CUAP' if 'cuap' in n else 'CAP' if n.startswith('cap ') else 'HOSPITAL'

exports = pd.concat([pd.read_excel(f) for f in sys.argv[2:-1]], ignore_index=True)
exports = exports[pd.to_numeric(exports['Incident'], errors='coerce').notna()]
tih = exports[exports['Class.Inc'] == 'TIH']
desti = exports['Destí Intervenció'].value_counts()
desti_tih = tih.drop_duplicates('Incident')['Destí Intervenció'].value_counts()
origen_tih = tih.drop_duplicates('Incident')['Origen'].value_counts()
noms = [n for n in desti.index if n != '-' and CENTRE.search(n) and desti[n] >= MIN_SERVEIS]

params = {'$select': 'nom,poblacio,categoria,latitud,longitud', '$where': "starts_with(categoria,'Salut|Centres sanitaris|')",
          '$limit': '5000'}
with urllib.request.urlopen(API + '?' + urllib.parse.urlencode(params), timeout=120) as r:
    cataleg = [c for c in json.load(r) if c.get('latitud')]
exacte = {c['nom']: c for c in cataleg}
# Hospitals are only matched against hospitals, CAP/CUAP against primary care centres
per_tipus = {
    'HOSPITAL': {norm(c['nom']): c for c in cataleg if '3. Hospitals' in c['categoria']},
    'CAP': {norm(c['nom']): c for c in cataleg if "1. Centres d'atenció primària" in c['categoria'] and not c['nom'].startswith('ASSIR')},
}
per_tipus['CUAP'] = per_tipus['CAP']

zones = Zones(sys.argv[1])
out, sense = [], []
for nom in noms:
    if nom in SENSE_CATALEG:
        sense.append(nom)
        continue
    if nom in ALIES:
        c = exacte[ALIES[nom]]
    else:
        candidats = per_tipus[tipus(nom)]
        match = difflib.get_close_matches(norm(nom), candidats, n=1, cutoff=0.85)
        if not match:
            sense.append(nom)
            continue
        c = candidats[match[0]]
    lat, lon = float(c['latitud']), float(c['longitud'])
    regio, subzona = zones.nearest(lat, lon)
    out.append(dict(nom=nom, tipus=tipus(nom), municipi=c.get('poblacio', '').title(), lat=round(lat, 6), lon=round(lon, 6),
                    regio=regio, subzona=subzona, serveis=int(desti[nom]),
                    destí_tih=int(desti_tih.get(nom, 0)), origen_tih=int(origen_tih.get(nom, 0)),
                    nom_cataleg=c['nom']))

out.sort(key=lambda d: -d['serveis'])
json.dump(out, open(sys.argv[-1], 'w'), ensure_ascii=False, indent=1)
print(len(out), 'destins localitzats;', len(sense), 'sense localitzar:', sense)
