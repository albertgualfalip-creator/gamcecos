"""Aggregate an activations export (one row per intervention) into anonymous statistics for the game.
Only aggregated counts and times are written: no incident ids, patients, ages or diagnoses per row."""
import json, sys
import pandas as pd

ZONA = {  # Regió Sanitària of the export -> (regio, subzona) used by the game
    'ALT PIRINEU I ARAN': ('Alt Pirineu i Aran', None), 'LLEIDA': ('Lleida', None),
    'CAMP DE TARRAGONA': ('Camp de Tarragona', None), "TERRES DE L'EBRE": ("Terres de l'Ebre", None),
    'GIRONA': ('Girona', None), 'CATALUNYA CENTRAL': ('Catalunya Central', None),
    'BARCELONA CIUTAT': ('Barcelona', 'Barcelona ciutat'), 'BARCELONA METROPOLITANA NORD': ('Barcelona', 'Metro Nord'),
    'BARCELONA METROPOLITANA SUD': ('Barcelona', 'Metro Sud'), 'PENEDÈS': ('Barcelona', 'Penedès'),
}
MIN_COUNT = 5  # categories rarer than this are dropped from the output

def zona(r):
    regio, sub = ZONA[r]
    return sub or regio

def counts(s, top=None):
    v = s.value_counts()
    v = v[v >= MIN_COUNT]
    return {str(k): int(n) for k, n in (v.head(top) if top else v).items()}

df = pd.read_excel(sys.argv[1])
df = df[pd.to_numeric(df['Incident'], errors='coerce').notna() & df['Regió Sanitària'].isin(ZONA)].copy()
df = df[df['Incident'] != 10000]
df['zona'] = df['Regió Sanitària'].map(zona)
df['hora'] = df['Hora Alerta'].astype(str).str[:2].astype(int)
df['resposta_min'] = pd.to_numeric(df['Temps resposta intervenció (seg.)'], errors='coerce') / 60

# Emergencies: 061 incidents excluding sanitary transport, interhospital transfers and specialist consults
em = df[(df['Class.Inc'] == '061') & df['Tipus Demanda'].isin(
    ['Malaltia en Domicili', 'Accident/Traumatisme', 'Malaltia en lloc públic'])]
inc = em.drop_duplicates('Incident')
activats = em[em['Grup finalització'] != 'Cancel·lat previ activació']
combinacio = activats.groupby('Incident')['Grup Recurs'].agg(lambda s: ' + '.join(sorted(s)))
amb_sva = activats[activats['Grup Recurs'].str.startswith('SVA')]['Incident'].unique()
diag = inc.set_index('Incident')['Text Diag.Central']
diag = diag[diag != '-']

temps = {}
for (z, g), s in em.dropna(subset=['resposta_min']).groupby(['zona', 'Grup Recurs'])['resposta_min']:
    if len(s) >= MIN_COUNT:
        temps.setdefault(z, {})[g] = dict(n=int(len(s)), mediana=round(s.median(), 1), p90=round(s.quantile(.9), 1))

out = dict(
    font='Export d\'activacions (agregat, anonimitzat)',
    periode=[str(df['Dia Alerta'].min().date()), str(df['Dia Alerta'].max().date())],
    incidents_totals=int(df['Incident'].nunique()),
    incidents_emergencia=int(len(inc)),
    tipus_demanda_totals=counts(df.drop_duplicates('Incident')['Tipus Demanda']),
    emergencies_per_zona_i_tipus={z: counts(g['Tipus Demanda']) for z, g in inc.groupby('zona')},
    emergencies_per_hora={int(h): int(n) for h, n in inc['hora'].value_counts().sort_index().items()},
    combinacio_recursos=counts(combinacio, top=12),
    percent_incidents_amb_sva=round(100 * len(amb_sva) / len(inc), 1),
    diagnostics_amb_sva=counts(diag[diag.index.isin(amb_sva)], top=25),
    diagnostics_nomes_svb=counts(diag[~diag.index.isin(amb_sva)], top=25),
    temps_resposta_min=temps,
    finalitzacio=counts(em['Grup finalització']),
    trasllat=counts(inc['Traslladat']),
)
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: out[k] for k in ('periode', 'incidents_totals', 'incidents_emergencia', 'percent_incidents_amb_sva')}))
