// Game engine: pure functions for case generation, travel times and scoring (no DOM).

export const PUNTS = { optima: 3, acceptable: 2, suboptima: 1, perillosa: 0 };
export const ORDRE = ['perillosa', 'suboptima', 'acceptable', 'optima'];
export const ETIQUETA = { optima: 'Òptima', acceptable: 'Acceptable', suboptima: 'Subòptima', perillosa: 'Perillosa' };

// Unit types grouped by the role they play in the response
export const CATEGORIA = { SVAm: 'SVA', SVAi: 'SVA', VIR: 'SVA', SVB: 'SVB', 'SVB-P': 'SVB', HELI: 'HEMS' };

export const COMBOS = [
  { id: 'cap', text: 'Cap recurs: consell telefònic o atenció primària' },
  { id: 'svb', text: 'Només SVB' },
  { id: 'sva_svb', text: 'SVA + SVB' },
  { id: 'sva_svb_hems', text: 'SVA + SVB + helicòpter' },
];

// Approximate sunset (decimal hour, local time) per month in Catalonia, for "09:00 - ocàs" schedules
const OCAS = [17.7, 18.3, 19.4, 20.6, 21.1, 21.5, 21.4, 20.9, 20.1, 19.2, 17.6, 17.4];

export function pitjor(a, b) {
  return ORDRE.indexOf(a) <= ORDRE.indexOf(b) ? a : b;
}

// Seeded random generator so a session can be replayed with the same case
export function aleatori(llavor) {
  let s = llavor >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function distanciaKm(a, b) {
  const R = 6371, rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Estimated arrival time in minutes (calibrated against real medians): activation + road distance (1.35 x straight line) at urban then road speed
export function tempsArribada(tipus, origen, desti, entorn) {
  const d = distanciaKm(origen, desti);
  if (tipus === 'HELI') return Math.round(6 + (d / 220) * 60);
  const km = d * 1.35;
  const urba = entorn === 'urba' ? 28 : 38;
  const via = entorn === 'urba' ? 50 : 90;
  const min = 3 + (Math.min(km, 5) / urba) * 60 + (Math.max(km - 5, 0) / via) * 60;
  return Math.round(min);
}

function hores(s) {
  const [h, m] = s.split(':').map(Number);
  return h + m / 60;
}

// Whether a unit is on duty at a given decimal hour; units without schedule are treated as 24 h
export function enServei(horari, hora, mes = 9) {
  if (!horari || /24\s*h/i.test(horari)) return true;
  const m = horari.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}|ocàs)/);
  if (!m) return true;
  const ini = hores(m[1]);
  const fi = m[2] === 'ocàs' ? OCAS[mes] : hores(m[2]);
  const durada = (fi - ini + 24) % 24;
  if (durada < 0.1 || durada > 23.9) return true;  // "08:00 - 07:59" style 24 h shifts
  return ini < fi ? hora >= ini && hora < fi : hora >= ini || hora < fi;
}

export function entornDe(zona, municipi, entornPerZona) {
  if (/^tarragona$/i.test(municipi || '')) return { entorn: entornPerZona['Tarragona ciutat'], pendent: false };
  const e = entornPerZona[zona];
  return e ? { entorn: e, pendent: false } : { entorn: 'suburba', pendent: true };
}

export function triaVariant(cas, rnd) {
  const total = cas.variants.reduce((s, v) => s + v.pes, 0);
  let x = rnd() * total;
  for (const v of cas.variants) if ((x -= v.pes) <= 0) return v;
  return cas.variants.at(-1);
}

// A value that may depend on the variant: a plain value or an object keyed by variant id
export function perVariant(valor, variant) {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor[variant] : valor;
}

export function avaluaDecisio(pas, opcioId, variant) {
  const o = pas.opcions.find(x => x.id === opcioId);
  return { valoracio: perVariant(o.valoracio, variant), feedback: perVariant(o.feedback, variant) };
}

export function avaluaNivell(pas, nivell, variant) {
  return { valoracio: pas.valoracio[variant][String(nivell)], feedback: perVariant(pas.feedback, variant) };
}

export function avaluaRetrucada(pas, triades) {
  const claus = pas.preguntes.filter(p => p.clau);
  const falten = claus.filter(p => !triades.includes(p.id));
  const valoracio = falten.length === 0 ? 'optima' : falten.length === 1 ? 'acceptable' : 'suboptima';
  const feedback = falten.length === 0
    ? 'Heu fet totes les preguntes clau.'
    : `Pregunta clau que no heu fet: ${falten.map(p => `"${p.text}"`).join(' · ')}`;
  return { valoracio, feedback };
}

// Combination of resource categories implied by the selected units
export function comboDe(unitats) {
  const cats = new Set(unitats.map(u => CATEGORIA[u.tipus]).filter(Boolean));
  if (!cats.size) return 'cap';
  if (cats.has('HEMS')) return 'sva_svb_hems';
  if (cats.has('SVA')) return 'sva_svb';
  return 'svb';
}

// Response required by AURE for the real level of the case, and whether HEMS should be considered
export function avaluaCombo(combo, nivell, entorn, millorSva) {
  const hemsIndicat = entorn !== 'urba' && millorSva != null && millorSva > 20;
  const taula = {
    1: { cap: 'perillosa', svb: 'perillosa', sva_svb: hemsIndicat ? 'acceptable' : 'optima', sva_svb_hems: hemsIndicat ? 'optima' : 'suboptima' },
    2: { cap: 'perillosa', svb: 'suboptima', sva_svb: hemsIndicat ? 'acceptable' : 'optima', sva_svb_hems: hemsIndicat ? 'optima' : 'suboptima' },
    3: { cap: 'suboptima', svb: 'optima', sva_svb: 'suboptima', sva_svb_hems: 'suboptima' },
    4: { cap: 'optima', svb: 'suboptima', sva_svb: 'suboptima', sva_svb_hems: 'suboptima' },
    5: { cap: 'optima', svb: 'suboptima', sva_svb: 'suboptima', sva_svb_hems: 'suboptima' },
  };
  const resposta = { 1: 'SVA + SVB', 2: 'SVA + SVB', 3: 'SVB', 4: 'consell telefònic, sense recurs', 5: 'consell telefònic, sense recurs' };
  let feedback = `Nivell real N${nivell}: la resposta AURE és ${resposta[nivell]}.`;
  if (hemsIndicat && nivell <= 2) feedback += ` La SVA més propera tarda ${millorSva} min (> 20 min fora d'entorn urbà): cal valorar l'helicòpter.`;
  return { valoracio: taula[nivell][combo], feedback };
}

// Compare each chosen unit with the fastest available unit of the same category
export function avaluaUnitats(seleccionades, disponibles) {
  let valoracio = 'optima';
  const notes = [];
  for (const cat of new Set(seleccionades.map(u => CATEGORIA[u.tipus]).filter(Boolean))) {
    const triada = Math.min(...seleccionades.filter(u => CATEGORIA[u.tipus] === cat).map(u => u.eta));
    const millor = disponibles.filter(u => CATEGORIA[u.tipus] === cat).sort((a, b) => a.eta - b.eta)[0];
    if (!millor) continue;
    const dif = triada - millor.eta;
    const v = dif <= 3 ? 'optima' : dif <= 8 ? 'acceptable' : 'suboptima';
    valoracio = pitjor(valoracio, v);
    if (dif > 3) notes.push(`${cat}: la ${millor.indicatiu} arribava en ${millor.eta} min (la vostra, ${triada} min).`);
  }
  return { valoracio, feedback: notes.join(' ') };
}

export function majoria(recompte) {
  const entrades = Object.entries(recompte || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return entrades.length ? entrades[0][0] : null;
}

// Two positions play together: the consultor (calls and clinical decisions) and the UCT
// (auxiliar and coordinator: activation, resources and operational decisions)
export const ROLS = { consultor: 'Consultor', uct: 'UCT', cap: 'Cap de torn' };
export function rolDe(pas) {
  if (pas.rol) return pas.rol;
  return ['activacio', 'reajust', 'acces'].includes(pas.id) ? 'uct' : 'consultor';
}

// When a decision becomes available: at the alert, during the call, after the call (management) or when a unit is on scene
export function faseDe(pas) {
  if (pas.id === 'activacio') return 'entrada';
  if (pas.id === 'trasllat') return 'lloc';
  if (['retrucada', 'nivell', 'maniobres', 'consell'].includes(pas.id) || pas.tipus === 'retrucada' || pas.tipus === 'nivell') return 'trucada';
  return 'gestio';
}

// Shuffled queue of cases for the selected themes (all cases if none selected); reshuffled when exhausted
export function baralla(casos, tematiques, rnd) {
  const valids = tematiques?.length ? casos.filter(c => c.tematiques?.some(t => tematiques.includes(t))) : casos;
  const llista = [...(valids.length ? valids : casos)];
  for (let i = llista.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [llista[i], llista[j]] = [llista[j], llista[i]];
  }
  return llista;
}

// Seconds from the alert to the first unit assigned, for time-dependent levels
export function avaluaActivacio(nivell, segons) {
  if (nivell > 2) return { valoracio: 'optima', feedback: '' };
  if (segons == null) return { valoracio: 'perillosa', feedback: 'Cap unitat activada en un incident N1/N2.' };
  const valoracio = segons <= 90 ? 'optima' : segons <= 180 ? 'acceptable' : 'suboptima';
  return { valoracio, feedback: `Primera unitat activada als ${segons} s de l'alerta${segons > 90 ? ' (objectiu: menys de 90 s en N1/N2)' : ''}.` };
}

// Outcome: bad when any decision was dangerous, the response to a time-dependent case was late or, for
// variants whose risk is wasting resources ("sobrerecurs"), when more resources than needed were sent
export function desenllac(resultats, nivell, criteri) {
  const greu = resultats.some(r => r.valoracio === 'perillosa');
  const tard = nivell <= 2 && resultats.some(r => r.tipus === 'temps' && r.valoracio === 'suboptima');
  const sobrerecurs = criteri === 'sobrerecurs' && resultats.some(r => r.tipus === 'recursos' && ['suboptima', 'perillosa'].includes(r.valoracio));
  return greu || tard || sobrerecurs ? 'dolent' : 'bo';
}
