// Consultor training ("Aprenentatge consultors"): separate from the shift game; it only shares the real units, the
// travel times and the scoring scale. Two kinds of case:
//  - veu: the tutor plays a recording and every student, on their phone, marks what they heard (per XABCDE letter),
//    picks a few key questions (a budget), the first life-saving instruction, the triage level and the units.
//  - carta: only the 112 data card, no voice; students decide whether to send units, which and how many of each kind.
// In both, units can be activated at any moment: the second of the first activation shows when they saw the severity.
import { CATEGORIA, distanciaKm, tempsArribada, entornDe, aleatori, XABCDE, SECCIONS } from './app/motor.mjs';

// AURE response per level, as units of each kind (used when the case does not set the numbers)
const RESPOSTA = { 1: { SVA: 1, SVB: 1 }, 2: { SVA: 1, SVB: 1 }, 3: { SVB: 1 }, 4: {}, 5: {} };
const CATS = ['SVA', 'SVB', 'HEMS'];
export const NOM_CAT = { SVA: 'SVA', SVB: 'SVB', HEMS: 'Helicòpter' };
const OCUPACIO = 0.2;
const MAX_UNITATS = 12;
export const CAP_MANIOBRA = 'cap';   // "no instruction needed: watch and wait" in the instruction step

// "2 SVA + 3 SVB" from a count per kind
export function textComposicio(n) {
  const parts = CATS.filter(c => n[c]).map(c => `${n[c]} ${NOM_CAT[c]}`);
  return parts.length ? parts.join(' + ') : 'Cap recurs';
}

export class Aula {
  constructor(config, dades) {
    this.dades = dades;
    this.estat = 'preparada';   // preparada → oberta (answering) → resultats
    this.ronda = 0;
    this.respostes = new Map();
    this.configura(config);
  }

  // A new round (or the first one): case data, location and the units the students will see
  configura(c = {}) {
    const tipus = c.tipus === 'carta' ? 'carta' : 'veu';
    // Each letter: items in the sections (what to ask, what is heard, what to instruct, not assessable); the tutor
    // marks the right ones. Accepts {items: [...]} or the default {anamnesi, signes, maniobres, noavaluable}
    const xabcde = tipus === 'carta' ? [] : (Array.isArray(c.xabcde) && c.xabcde.length ? c.xabcde : XABCDE).map((l, i) => {
      const lletra = String(l.lletra || XABCDE[i]?.lletra || '?').slice(0, 2);
      const fonts = Array.isArray(l.items) ? l.items : SECCIONS.flatMap(sec => (l[sec.id] || []).map(text => ({ seccio: sec.id, text })));
      const comptes = {};
      const items = fonts.filter(it => SECCIONS.some(sec => sec.id === it.seccio) && String(it.text || '').trim()).slice(0, 30).map(it => {
        comptes[it.seccio] = (comptes[it.seccio] || 0) + 1;
        return { id: `${lletra}-${it.seccio[0]}${comptes[it.seccio]}`, seccio: it.seccio, text: String(it.text).trim().slice(0, 120), correcte: it.correcte === true };
      });
      return { lletra, nom: String(l.nom || XABCDE[i]?.nom || '').slice(0, 40), items };
    }).filter(l => l.items.length);
    const nivell = [1, 2, 3, 4, 5].includes(Number(c.nivell)) ? Number(c.nivell) : null;
    const lloc = c.lloc && Number.isFinite(c.lloc.lat) && Number.isFinite(c.lloc.lon) ? c.lloc : { municipi: 'Barcelona', zona: 'Barcelona ciutat', lat: 41.3874, lon: 2.1686 };
    const entorn = entornDe(lloc.zona, lloc.municipi, this.dades.aure.entorn_per_zona).entorn;
    // Right response: units of each kind set by the case, or the AURE response for the level
    const nombre = c.recursos?.mode === 'nombre'
      ? Object.fromEntries(CATS.map(k => [k, Math.max(0, Math.min(8, Math.round(Number(c.recursos[k]) || 0)))]))
      : { SVA: 0, SVB: 0, HEMS: 0, ...(RESPOSTA[nivell] || {}) };
    this.config = {
      tipus, titol: String(c.titol || 'Cas').slice(0, 80), carta: String(c.carta || '').trim().slice(0, 1000), xabcde, nivell,
      preguntes: Math.max(1, Math.min(6, Math.round(Number(c.preguntes) || 3))), lloc: { ...lloc, entorn },
    };
    const llavor = c.llavor ?? Date.now();
    this.numero = 261800000 + Math.floor(aleatori(llavor + 1)() * 99999);   // incident number shown on the projector
    this.unitats = this.unitatsProperes(llavor, nombre);
    this.correctes = Array.isArray(c.correctes) ? c.correctes.filter(id => this.unitats.some(u => u.indicatiu === id && !u.ocupada))
      : this.mesProperes(nombre);
    this.respostes = new Map();
    this.estat = 'preparada';
    this.obertaT = null;
    this.ronda++;
  }

  // Nearest real units of each kind, some of them busy, like the list the UCT sees; more of a kind when the case needs more
  unitatsProperes(llavor, nombre) {
    const rnd = aleatori(llavor);
    const { lloc } = this.config;
    const totes = this.dades.unitats.filter(u => CATEGORIA[u.tipus])
      .map(u => ({ indicatiu: u.indicatiu, tipus: u.tipus, cat: CATEGORIA[u.tipus], base: u.base.nom, lat: u.base.lat, lon: u.base.lon,
        km: distanciaKm(u.base, lloc), eta: tempsArribada(u.tipus, u.base, lloc, lloc.entorn) }))
      .filter(u => u.km <= (u.tipus === 'HELI' ? 150 : 60))
      .sort((a, b) => a.eta - b.eta);
    const quantes = { SVB: Math.max(6, nombre.SVB + 3), SVA: Math.max(4, nombre.SVA + 2), HEMS: Math.max(1, nombre.HEMS + 1) };
    return CATS.flatMap(cat => totes.filter(u => u.cat === cat).slice(0, quantes[cat]))
      .map((u, i) => ({ ...u, km: Math.round(u.km), ocupada: i > 0 && rnd() < OCUPACIO }))
      .sort((a, b) => a.eta - b.eta);
  }

  // Default right answer: the nearest free units of each kind, as many as the response asks (or all that are free)
  mesProperes(nombre) {
    return CATS.flatMap(cat => this.unitats.filter(u => !u.ocupada && u.cat === cat).slice(0, nombre[cat] || 0).map(u => u.indicatiu));
  }

  composicio(ids) {
    const n = { SVA: 0, SVB: 0, HEMS: 0 };
    for (const id of ids || []) { const u = this.unitats.find(x => x.indicatiu === id); if (u) n[u.cat]++; }
    return n;
  }

  ordre({ tipus, config, correctes }) {
    if (tipus === 'obre' && this.estat === 'preparada') { this.estat = 'oberta'; this.obertaT = Date.now(); }
    else if (tipus === 'resultats' && this.estat === 'oberta') this.estat = 'resultats';
    else if (tipus === 'nova') this.configura(config);
    else if (tipus === 'correctes' && Array.isArray(correctes)) {
      this.correctes = correctes.filter(id => this.unitats.some(u => u.indicatiu === id && !u.ocupada));
    } else return 'Ordre no disponible ara';
    return null;
  }

  segons() { return Math.round((Date.now() - (this.obertaT || Date.now())) / 1000); }

  lliures(ids) {
    const lliures = new Set(this.unitats.filter(u => !u.ocupada).map(u => u.indicatiu));
    return [...new Set(ids)].filter(id => lliures.has(id)).slice(0, MAX_UNITATS);
  }

  // A student's answer arrives in steps. Voice cases: what they heard, the key questions and the first instruction
  // (all as "xabcde" item ids), then the level, then the units. Card cases: only the units.
  respon(client, { nom, xabcde, nivell, recursos, activa }) {
    if (this.estat !== 'oberta') return 'Les respostes no estan obertes';
    if (!client) return 'Falta el client';
    const carta = this.config.tipus === 'carta';
    const r = this.respostes.get(client) || { nom: 'Anònim', xabcde: null, nivell: null, recursos: null };
    if (r.recursos) return 'Ja has enviat la resposta';
    if (nom) r.nom = String(nom).slice(0, 24);
    if (Array.isArray(activa)) {
      const ids = this.lliures(activa);
      // The first activation is the one that counts; later ones only change the units
      r.activacio = r.activacio?.t != null && ids.length ? { ...r.activacio, recursos: ids }
        : ids.length ? { recursos: ids, t: this.segons(), abansValoracio: !r.xabcde } : null;
    }
    if (Array.isArray(xabcde) && !carta) {
      const items = new Map(this.config.xabcde.flatMap(l => l.items).map(it => [it.id, it]));
      const triats = [...new Set(xabcde)];
      const de = seccio => triats.filter(id => items.get(id)?.seccio === seccio);
      // Within budget: a few questions and a single instruction (or none needed)
      r.xabcde = [...de('signes'), ...de('noavaluable'), ...de('anamnesi').slice(0, this.config.preguntes),
        ...(triats.includes(CAP_MANIOBRA) ? [CAP_MANIOBRA] : de('maniobres').slice(0, 1))];
    }
    if (nivell != null) {
      if (!r.xabcde) return 'Primer acaba la valoració';
      if (![1, 2, 3, 4, 5].includes(Number(nivell))) return 'Nivell desconegut';
      r.nivell = Number(nivell);
    }
    if (recursos) {
      if (!carta && !r.nivell) return 'Primer tria el nivell';
      r.recursos = this.lliures(recursos);
      r.temps = this.segons();
    }
    this.respostes.set(client, r);
    return null;
  }

  // Points (voice cases): heard and "not assessable" items +1 right / -1 not applicable (never below zero), +1 per key
  // question in the budget, +2 for the right first instruction, 3 for the exact level (1 if one off). All cases: up to
  // 3 for the units (2 for the right number of each kind, 1 if only the kinds are right; +1 for the nearest ones) and,
  // when the case needs units, +1 for activating them before finishing the assessment
  puntua(r) {
    const { xabcde, nivell, tipus, preguntes } = this.config;
    const carta = tipus === 'carta';
    const detall = { escolta: 0, preguntes: 0, instruccio: 0, nivell: 0, recursos: 0, deteccio: 0 };
    const items = xabcde.flatMap(l => l.items);
    const marcats = new Set(r.xabcde || []);
    const de = seccions => items.filter(it => seccions.includes(it.seccio));
    detall.escolta = Math.max(0, de(['signes', 'noavaluable']).filter(it => marcats.has(it.id)).reduce((s, it) => s + (it.correcte ? 1 : -1), 0));
    detall.preguntes = de(['anamnesi']).filter(it => it.correcte && marcats.has(it.id)).length;
    const maniobresBones = de(['maniobres']).filter(it => it.correcte);
    if (r.xabcde && (maniobresBones.some(it => marcats.has(it.id)) || (!maniobresBones.length && marcats.has(CAP_MANIOBRA)))) detall.instruccio = 2;
    if (!carta && nivell && r.nivell) detall.nivell = r.nivell === nivell ? 3 : Math.abs(r.nivell - nivell) === 1 ? 1 : 0;
    if (r.recursos) {
      const meva = this.composicio(r.recursos), bona = this.composicio(this.correctes);
      if (CATS.every(c => meva[c] === bona[c])) detall.recursos += 2;
      else if (CATS.every(c => !meva[c] === !bona[c])) detall.recursos += 1;
      if (r.recursos.length === this.correctes.length && r.recursos.every(id => this.correctes.includes(id))) detall.recursos += 1;
    }
    const calRecurs = this.correctes.length > 0;
    if (!carta && calRecurs && r.activacio?.abansValoracio) detall.deteccio = 1;
    const maxim = carta ? 3 : de(['signes', 'noavaluable']).filter(it => it.correcte).length
      + Math.min(preguntes, de(['anamnesi']).filter(it => it.correcte).length) + 2 + (nivell ? 3 : 0) + 3 + (calRecurs ? 1 : 0);
    return { ...detall, punts: Object.values(detall).reduce((a, b) => a + b, 0), maxim };
  }

  correcte() {
    const n = this.composicio(this.correctes);
    return { nivell: this.config.nivell, recursos: this.correctes, composicio: n, text: textComposicio(n) };
  }

  // What a student's phone sees: never the right answers before the results
  vistaAlumne(client) {
    const r = this.respostes.get(client);
    const resultats = this.estat === 'resultats';
    return {
      estat: this.estat, ronda: this.ronda, tipus: this.config.tipus, titol: this.config.titol, carta: this.config.carta, preguntes: this.config.preguntes,
      xabcde: this.config.xabcde.map(l => ({ lletra: l.lletra, nom: l.nom,
        items: l.items.map(({ id, seccio, text, correcte }) => ({ id, seccio, text, ...(resultats ? { correcte } : {}) })) })),
      unitats: this.unitats.map(({ indicatiu, tipus, cat, base, km, eta, ocupada }) => ({ indicatiu, tipus, cat, base, km, eta, ocupada })),
      municipi: this.config.lloc.municipi,
      resposta: r ? { xabcde: r.xabcde, nivell: r.nivell, recursos: r.recursos, activacio: r.activacio || null } : null,
      ...(resultats ? { correcte: this.correcte(), puntuacio: r ? this.puntua(r) : null } : {}),
    };
  }

  // Tutor and projector: progress, answer distribution and ranking
  vistaTutor() {
    const rs = [...this.respostes.values()];
    const compta = (llista, clau) => llista.reduce((m, x) => { const k = clau(x); if (k != null) m[k] = (m[k] || 0) + 1; return m; }, {});
    const fets = rs.filter(r => r.recursos);
    const correcte = this.correcte();
    return {
      estat: this.estat, ronda: this.ronda, numero: this.numero, config: this.config, unitats: this.unitats, correctes: this.correctes,
      correcte,
      progres: { connectats: rs.length, activats: rs.filter(r => r.activacio).length, xabcde: rs.filter(r => r.xabcde).length,
        nivell: rs.filter(r => r.nivell).length, recursos: fets.length },
      distribucio: {
        xabcde: compta(rs.flatMap(r => r.xabcde || []), id => id),
        nivell: compta(rs, r => r.nivell),
        unitats: compta(fets.flatMap(r => (r.recursos.length ? r.recursos : ['cap'])), x => x),
        composicio: compta(fets, r => textComposicio(this.composicio(r.recursos))),
        envien: { si: fets.filter(r => r.recursos.length).length, no: fets.filter(r => !r.recursos.length).length },
        // Seconds from opening the answers (and starting the recording) to the first activation, and to the final answer
        activacio: rs.filter(r => r.activacio).map(r => ({ nom: r.nom, t: r.activacio.t, abansValoracio: r.activacio.abansValoracio })).sort((a, b) => a.t - b.t),
        senseActivacio: rs.filter(r => !r.activacio).length,
        temps: fets.map(r => ({ nom: r.nom, t: r.temps })).sort((a, b) => a.t - b.t),
      },
      classificacio: this.estat === 'resultats'
        ? rs.map(r => ({ nom: r.nom, activacio: r.activacio?.t ?? null, temps: r.temps ?? null, ...this.puntua(r) })).sort((a, b) => b.punts - a.punts || (a.temps ?? 1e9) - (b.temps ?? 1e9)).slice(0, 15) : [],
    };
  }
}
