"""Build the game's unit dataset from the REGISTRE ÚNIC Excel (only indicatiu, tipus, horari and base)."""
import json, re, sys
import pandas as pd

LOT_TO_REGION = {
    'ALT PIRINEU': ("Alt Pirineu i Aran", None), 'LLEIDA': ("Lleida", None),
    'CAMP DE TARRAGONA': ("Camp de Tarragona", None), 'TERRES EBRE': ("Terres de l'Ebre", None),
    'GIRONA': ("Girona", None), 'CAT CENTRAL': ("Catalunya Central", None),
    'METRO NORD': ("Barcelona", "Metro Nord"), 'METRO SUD': ("Barcelona", "Metro Sud"),
    'BARCELONA': ("Barcelona", "Barcelona ciutat"), 'PENEDÉS': ("Barcelona", "Penedès"),
}
# Approximate municipality centres, used when the Excel has no valid coordinates.
MUNICIPI_CENTRE = {
    'Artesa de Segre': (41.8946, 1.0478), 'Alcarràs': (41.5636, 0.5250), 'Tarragona': (41.1189, 1.2445),
    'Batea': (41.0947, 0.3114), 'Gandesa': (41.0527, 0.4374), "Mora d'Ebre": (41.0918, 0.6431),
    'El Prat de Llobregat': (41.3264, 2.0952), 'Sant Just Desvern': (41.3833, 2.0750),
    'Barcelona': (41.3874, 2.1686),
}
HELICOPTERS = [  # base coordinates approximate, to validate
    dict(indicatiu='HELI-SABADELL', base='Sabadell', municipi='Sabadell', region='Barcelona', subzona='Metro Nord',
         lat=41.5209, lon=2.1050, horari='24h'),
    dict(indicatiu='HELI-REUS', base='Reus', municipi='Reus', region='Camp de Tarragona', subzona=None,
         lat=41.1474, lon=1.1672, horari='09:00 - ocàs'),
    dict(indicatiu='HELI-TREMP', base='Tremp', municipi='Tremp', region='Alt Pirineu i Aran', subzona=None,
         lat=42.1660, lon=0.8950, horari='09:00 - 21:00'),
    dict(indicatiu='HELI-GIRONA', base='Girona', municipi='Girona', region='Girona', subzona=None,
         lat=41.9010, lon=2.7606, horari='09:00 - ocàs'),
]

def parse_coord(v):
    if pd.isna(v): return None
    s = str(v).strip()
    m = re.match(r"(\d+)°(\d+)'([\d.]+)\"?\s*([NSEW])", s)
    if m:
        d = int(m[1]) + int(m[2]) / 60 + float(m[3]) / 3600
        return -d if m[4] in 'SW' else d
    try: return float(s.replace(',', '.'))
    except ValueError: return None

def fix_scale(x):
    """Coordinates that lost their decimal point: Catalonia is lat 40-43, lon 0-3."""
    if x is None or abs(x) < 50: return x
    digits = re.sub(r'\D', '', f'{x:.0f}')
    return float(digits[:2] + '.' + digits[2:]) if digits[:2] in ('40', '41', '42') else float(digits[0] + '.' + digits[1:])

def in_catalonia(lat, lon):
    return lat is not None and lon is not None and 40.4 <= lat <= 42.95 and 0.1 <= lon <= 3.4

df = pd.read_excel(sys.argv[1], sheet_name='BBDD UNIFICADA', header=2)
df.columns = [str(c).strip() for c in df.columns]
df = df[df['INDICATIU CECOS'].notna()]

units, approx = {}, []
for _, r in df.iterrows():
    ind = str(r['INDICATIU CECOS']).strip()
    vehicle = str(r['TIPOLOGIA VEHICLE'])
    tip = str(r['TIPOLOGIA RECURS']).strip() if pd.notna(r['TIPOLOGIA RECURS']) else None
    if ind == '-' or re.search(r'BACKUP|LOGÍSTICA|BASE ', vehicle) or tip in (None, 'OCATT'):
        continue
    if tip == 'P': tip = 'SVB'  # E433 Horta de Sant Joan: vehicle SVB
    lat, lon = fix_scale(parse_coord(r['LATITUD'])), fix_scale(parse_coord(r['LONGITUT']))
    if lat is not None and lon is not None and lat < 5 < lon: lat, lon = lon, lat
    if ind in units and not units[ind]['coord_aproximada']: continue  # keep the first row with valid coordinates
    municipi = str(r['MUNICIPI DE BASE']).replace("''", "'").strip() if pd.notna(r['MUNICIPI DE BASE']) else None
    base = str(r['NOM BASE']).strip()
    aproximada = False
    if not in_catalonia(lat, lon):
        key = 'El Prat de Llobregat' if base.startswith('EL PRAT') else municipi
        lat, lon = MUNICIPI_CENTRE[key]
        aproximada = True
    region, subzona = LOT_TO_REGION[r['NOM LOT']]
    units[ind] = dict(indicatiu=ind, tipus=tip,
                      horari=str(r['HORARI']).strip() if pd.notna(r['HORARI']) else None,
                      base=dict(nom=base, municipi=municipi, lat=round(lat, 6), lon=round(lon, 6)),
                      regio=region, subzona=subzona, coord_aproximada=aproximada)

for h in HELICOPTERS:
    units[h['indicatiu']] = dict(indicatiu=h['indicatiu'], tipus='HELI', horari=h['horari'],
                                 base=dict(nom=h['base'], municipi=h['municipi'], lat=h['lat'], lon=h['lon']),
                                 regio=h['region'], subzona=h['subzona'], coord_aproximada=True)

out = sorted(units.values(), key=lambda u: u['indicatiu'])
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
s = pd.DataFrame(out)
print(len(out), 'unitats;', s.coord_aproximada.sum(), 'amb coordenada aproximada')
print(pd.crosstab(s.regio, s.tipus, margins=True).to_string())
print('sense horari:', s.horari.isna().sum())
