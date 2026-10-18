"""Aggregate one or more activations exports (one row per intervention) into anonymous statistics for the game.
Only aggregated counts and times are written: no incident ids, patients, ages or diagnoses per row.

Usage: build_stats.py <export1.xlsx> [<export2.xlsx> ...] <out.json>

Triage level is not in the exports yet, so it is approximated from the resources sent:
an SVA means N1/N2, SVB only means N3 (N4/N5 get no resource and are not in the exports)."""
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

df = pd.concat([pd.read_excel(f) for f in sys.argv[1:-1]], ignore_index=True)
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
inc = inc.assign(nivell=inc['Incident'].isin(amb_sva).map({True: 'N1/N2', False: 'N3'}))
diag = inc.set_index('Incident')['Text Diag.Central']
diag = diag[diag != '-']

def origen_tipus(sigla):
    return {'CAP': 'CAP', 'CUAP': 'CUAP', 'RESI': 'Residència', 'Hosp': 'Hospital'}.get(sigla, 'Domicili / via pública')

def temps_per(g, key):
    t = g.dropna(subset=['resposta_min']).groupby(key)['resposta_min']
    return {str(k): dict(n=int(len(v)), mediana=round(v.median(), 1), p90=round(v.quantile(.9), 1))
            for k, v in t if len(v) >= MIN_COUNT}

# Derivacions: sanitary transport requested by a doctor (CAP, CUAP, residència, domicili -> hospital/CAP)
der = df[(df['Class.Inc'] == '061') & (df['Tipus Demanda'] == 'Transport sanitari')].copy()
der['origen_tipus'] = der['Sigla Origen'].map(origen_tipus)
der_inc = der.drop_duplicates('Incident')
derivacions = dict(
    incidents=int(len(der_inc)),
    per_origen=counts(der_inc['origen_tipus']),
    per_zona=counts(der_inc['zona']),
    prioritat=counts(der_inc['Prioritat'].astype('Int64').astype(str)),
    recurs=counts(der['Grup Recurs']),
    destins=counts(der['Destí Intervenció'][der['Destí Intervenció'] != '-'], top=20),
    finalitzacio=counts(der['Grup finalització']),
    temps_resposta_min=temps_per(der, 'origen_tipus'),
)

# Interhospitalaris (TIH): priority, origin and destination hospitals
tih = df[df['Class.Inc'] == 'TIH'].copy()
tih['prioritat'] = tih['Prioritat'].astype('Int64').astype(str)
tih_inc = tih.drop_duplicates('Incident')
parelles = tih[tih['Destí Intervenció'] != '-'].drop_duplicates('Incident')
interhospitalaris = dict(
    incidents=int(len(tih_inc)),
    per_prioritat=counts(tih_inc['prioritat']),
    recurs_per_prioritat={p: counts(g['Grup Recurs']) for p, g in tih.groupby('prioritat')},
    per_zona=counts(tih_inc['zona']),
    origens=counts(tih_inc['Origen'], top=20),
    destins=counts(parelles['Destí Intervenció'], top=20),
    parelles_origen_desti=counts(parelles['Origen'] + ' -> ' + parelles['Destí Intervenció'], top=20),
    diagnostics=counts(tih_inc['Text Diag.Central'][tih_inc['Text Diag.Central'] != '-'], top=15),
    temps_resposta_min=temps_per(tih, 'prioritat'),
)

temps = {}
for (z, g), s in em.dropna(subset=['resposta_min']).groupby(['zona', 'Grup Recurs'])['resposta_min']:
    if len(s) >= MIN_COUNT:
        temps.setdefault(z, {})[g] = dict(n=int(len(s)), mediana=round(s.median(), 1), p90=round(s.quantile(.9), 1))

out = dict(
    font='Export d\'activacions (agregat, anonimitzat)',
    dies=sorted(str(d) for d in df['Dia Alerta'].dt.date.unique()),
    incidents_totals=int(df['Incident'].nunique()),
    incidents_emergencia=int(len(inc)),
    tipus_demanda_totals=counts(df.drop_duplicates('Incident')['Tipus Demanda']),
    emergencies_per_zona_i_tipus={z: counts(g['Tipus Demanda']) for z, g in inc.groupby('zona')},
    emergencies_per_hora={int(h): int(n) for h, n in inc['hora'].value_counts().sort_index().items()},
    combinacio_recursos=counts(combinacio, top=12),
    percent_incidents_amb_sva=round(100 * len(amb_sva) / len(inc), 1),
    nivell_aproximat=dict(criteri='SVA activada = N1/N2; només SVB = N3', total=counts(inc['nivell']),
                          per_zona={z: counts(g['nivell']) for z, g in inc.groupby('zona')},
                          per_tipus_demanda={t: counts(g['nivell']) for t, g in inc.groupby('Tipus Demanda')}),
    diagnostics_n1_n2=counts(diag[diag.index.isin(amb_sva)], top=25),
    diagnostics_n3=counts(diag[~diag.index.isin(amb_sva)], top=25),
    temps_resposta_min=temps,
    finalitzacio=counts(em['Grup finalització']),
    trasllat=counts(inc['Traslladat']),
    derivacions=derivacions,
    interhospitalaris=interhospitalaris,
)
json.dump(out, open(sys.argv[-1], 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: out[k] for k in ('dies', 'incidents_totals', 'incidents_emergencia', 'percent_incidents_amb_sva')}),
      'derivacions', derivacions['incidents'], 'interhospitalaris', interhospitalaris['incidents'])
