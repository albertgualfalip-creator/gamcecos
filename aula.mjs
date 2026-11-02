// Consultor training ("Aprenentatge consultors"): separate from the shift game; it only shares the real units, the
// travel times and the scoring scale. Each case has a recording or only the 112 data card, and the tutor chooses
// which screens the students go through (fases):
//  - escolta: what was heard, per XABCDE letter (or "not assessable")
//  - preguntes: a few key questions (a budget)
//  - instruccio: the first life-saving instruction (one, or none needed)
//  - nivell: the triage level
//  - recursos: which units to send and how many of each kind
//  - activacio: a bar to activate units at any moment; the second of the first activation shows when they saw the severity
// The tutor can also choose which units the students see, which are busy and which are the right answer.
import { CATEGORIA, distanciaKm, tempsArribada, entornDe, aleatori, XABCDE, SECCIONS } from './app/motor.mjs';
import { Escenari, EQUIPS } from './escenari.mjs';

// AURE response per level, as units of each kind (used when the case does not set the numbers)
const RESPOSTA = { 1: { SVA: 1, SVB: 1 }, 2: { SVA: 1, SVB: 1 }, 3: { SVB: 1 }, 4: {}, 5: {} };
const CATS = ['SVA', 'SVB', 'HEMS'];
export const NOM_CAT = { SVA: 'SVA', SVB: 'SVB', HEMS: 'Helicòpter' };
export const FASES = ['escolta', 'preguntes', 'instruccio', 'nivell', 'recursos', 'activacio'];
const FASES_XABCDE = ['escolta', 'preguntes', 'instruccio'];
const PER_DEFECTE = {
  veu: { escolta: true, preguntes: true, instruccio: true, nivell: true, recursos: true, activacio: true },
  carta: { escolta: false, preguntes: false, instruccio: false, nivell: false, recursos: true, activacio: false },
};
const OCUPACIO = 0.2;
const MAX_UNITATS = 12;
export const CAP_MANIOBRA = 'cap';   // "no instruction needed: watch and wait" in the instruction step

// "2 SVA + 3 SVB" from a count per kind
export function textComposicio(n) {
  const parts = CATS.filter(c => n[c]).map(c => `${n[c]} ${NOM_CAT[c]}`);
  return parts.length ? parts.join(' + ') : 'Cap recurs';
}

const llocValid = l => (l && Number.isFinite(l.lat) && Number.isFinite(l.lon) ? l : { municipi: 'Barcelona', zona: 'Barcelona ciutat', lat: 41.3874, lon: 2.1686 });

// Real units around a place, nearest first, with how many of each kind; used for the students' list and for the
// tutor to choose the units of a case
export function unitatsProperes(dades, llocCas, quantes = { SVB: 10, SVA: 6, HEMS: 3 }) {
  const lloc = llocValid(llocCas);
  const entorn = lloc.entorn || entornDe(lloc.zona, lloc.municipi, dades.aure.entorn_per_zona).entorn;
  const totes = dades.unitats.filter(u => CATEGORIA[u.tipus])
    .map(u => ({ indicatiu: u.indicatiu, tipus: u.tipus, cat: CATEGORIA[u.tipus], base: u.base.nom, lat: u.base.lat, lon: u.base.lon,
      km: Math.round(distanciaKm(u.base, lloc)), eta: tempsArribada(u.tipus, u.base, lloc, entorn) }))
    .filter(u => u.km <= (u.tipus === 'HELI' ? 150 : 60))
    .sort((a, b) => a.eta - b.eta);
  return CATS.flatMap(cat => totes.filter(u => u.cat === cat).slice(0, quantes[cat] || 0)).sort((a, b) => a.eta - b.eta);
}

export class Aula {
  constructor(config, dades) {
    this.dades = dades;
    this.estat = 'preparada';   // preparada → oberta (answering) → resultats
    this.ronda = 0;
    this.historia = [];         // cases already played in this session, for the incident tray on the projector
    this.respostes = new Map();
    // Teams last the whole session: client -> team, client -> nickname
    this.equipDe = new Map();
    this.noms = new Map();
    this.configura(config);
  }

  // A new round (or the first one): case data, location and the units the students will see
  configura(c = {}) {
    if (this.config) this.historia.unshift({ numero: this.numero, titol: this.config.titol, municipi: this.config.lloc.municipi, nivell: this.config.nivell });
    const llavor = c.llavor ?? Date.now();
    this.respostes = new Map();
    this.estat = 'preparada';
    this.obertaT = null;
    this.ronda++;
    this.numero = 261800000 + Math.floor(aleatori(llavor + 1)() * 99999);   // incident number shown on the projector
    this.temps = Math.max(0, Math.min(1800, Math.round(Number(c.temps) || 0)));   // seconds to answer, 0 = no limit
    if (c.tipus === 'escenari') {
      const lloc = llocValid(c.lloc);
      const equips = Math.max(2, Math.min(EQUIPS.length, Math.round(Number(c.equips) || 4)));
      this.config = { tipus: 'escenari', titol: String(c.titol || 'Escenari').slice(0, 80), carta: '', fases: {}, xabcde: [], nivell: null, preguntes: 3,
        equips: EQUIPS.slice(0, equips), lloc: { ...lloc, entorn: entornDe(lloc.zona, lloc.municipi, this.dades.aure.entorn_per_zona).entorn } };
      this.esc = new Escenari(c, this.dades, llavor, this.config.lloc);
      this.unitats = [];
      this.correctes = [];
      return;
    }
    this.esc = null;
    const tipus = c.tipus === 'carta' ? 'carta' : 'veu';
    const fases = Object.fromEntries(FASES.map(f => [f, typeof c.fases?.[f] === 'boolean' ? c.fases[f] : PER_DEFECTE[tipus][f]]));
    if (!FASES.some(f => fases[f] && f !== 'activacio')) fases.recursos = true;   // at least one screen
    const ambXabcde = FASES_XABCDE.some(f => fases[f]);
    // Each letter: items in the sections (what to ask, what is heard, what to instruct, not assessable); the tutor
    // marks the right ones. Accepts {items: [...]} or the default {anamnesi, signes, maniobres, noavaluable}
    const xabcde = !ambXabcde ? [] : (Array.isArray(c.xabcde) && c.xabcde.length ? c.xabcde : XABCDE).map((l, i) => {
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
    const lloc = llocValid(c.lloc);
    const entorn = entornDe(lloc.zona, lloc.municipi, this.dades.aure.entorn_per_zona).entorn;
    this.config = {
      tipus, fases, titol: String(c.titol || 'Cas').slice(0, 80), carta: String(c.carta || '').trim().slice(0, 1000), xabcde, nivell,
      preguntes: Math.max(1, Math.min(6, Math.round(Number(c.preguntes) || 3))), lloc: { ...lloc, entorn },
    };
    // Units: the ones the tutor chose (free or busy), or the nearest with some busy at random
    const triades = Array.isArray(c.unitats) ? c.unitats.filter(u => ['lliure', 'ocupada'].includes(u?.estat)) : [];
    const mode = c.recursos?.mode;
    const nombre = mode === 'nombre'
      ? Object.fromEntries(CATS.map(k => [k, Math.max(0, Math.min(8, Math.round(Number(c.recursos[k]) || 0)))]))
      : { SVA: 0, SVB: 0, HEMS: 0, ...(RESPOSTA[nivell] || {}) };
    if (triades.length) {
      const estat = new Map(triades.map(u => [u.indicatiu, u.estat]));
      this.unitats = unitatsProperes(this.dades, this.config.lloc, { SVB: 99, SVA: 99, HEMS: 99 })
        .filter(u => estat.has(u.indicatiu)).map(u => ({ ...u, ocupada: estat.get(u.indicatiu) === 'ocupada' }));
    } else {
      const rnd = aleatori(llavor);
      const quantes = { SVB: Math.max(6, nombre.SVB + 3), SVA: Math.max(4, nombre.SVA + 2), HEMS: Math.max(1, nombre.HEMS + 1) };
      this.unitats = unitatsProperes(this.dades, this.config.lloc, quantes).map((u, i) => ({ ...u, ocupada: i > 0 && rnd() < OCUPACIO }));
    }
    const lliure = id => this.unitats.some(u => u.indicatiu === id && !u.ocupada);
    // Right units: the ones the tutor ticked ("manual", empty = no units), or the nearest per kind
    this.correctes = mode === 'manual' || (!mode && Array.isArray(c.correctes)) ? (c.correctes || []).filter(lliure) : this.mesProperes(nombre);
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

  // Time since the answers opened and, with a limit, the time left (it does not close the answers by itself)
  rellotge() {
    const segons = this.obertaT && this.estat === 'oberta' ? this.segons() : null;
    return { segons, temps: this.temps, queden: this.temps && segons != null ? Math.max(0, this.temps - segons) : null };
  }

  lliures(ids) {
    const lliures = new Set(this.unitats.filter(u => !u.ocupada).map(u => u.indicatiu));
    return [...new Set(ids)].filter(id => lliures.has(id)).slice(0, MAX_UNITATS);
  }

  // The last screen of the case: the answer is complete when it arrives
  darrera() {
    const { fases } = this.config;
    return fases.recursos ? 'recursos' : fases.nivell ? 'nivell' : 'xabcde';
  }

  // A student's answer arrives in steps: the assessment screens (all as "xabcde" item ids), the level and the units,
  // each one only if the case has it
  respon(client, { nom, xabcde, nivell, recursos, activa, equip, accio, pas }) {
    if (!client) return 'Falta el client';
    if (nom) this.noms.set(client, String(nom).slice(0, 24));
    if (this.esc) return this.responEscenari(client, { equip, accio });
    if (this.estat !== 'oberta') return 'Les respostes no estan obertes';
    // The screen a student is on, so the tutor can see where the class is
    if (typeof pas === 'string' && !xabcde && nivell == null && !recursos && !activa) {
      const r = this.respostes.get(client) || { nom: this.noms.get(client) || 'Anònim', xabcde: null, nivell: null, recursos: null };
      r.pas = pas.slice(0, 20);
      this.respostes.set(client, r);
      return null;
    }
    const { fases } = this.config;
    const ambXabcde = FASES_XABCDE.some(f => fases[f]);
    const r = this.respostes.get(client) || { nom: 'Anònim', xabcde: null, nivell: null, recursos: null };
    if (r.fet) return 'Ja has enviat la resposta';
    if (nom) r.nom = String(nom).slice(0, 24);
    if (Array.isArray(activa) && fases.activacio) {
      const ids = this.lliures(activa);
      // The first activation is the one that counts; later ones only change the units
      r.activacio = r.activacio?.t != null && ids.length ? { ...r.activacio, recursos: ids }
        : ids.length ? { recursos: ids, t: this.segons(), abansValoracio: !r.xabcde } : null;
    }
    if (Array.isArray(xabcde) && ambXabcde) {
      const items = new Map(this.config.xabcde.flatMap(l => l.items).map(it => [it.id, it]));
      const triats = [...new Set(xabcde)];
      const de = seccio => triats.filter(id => items.get(id)?.seccio === seccio);
      // Within budget: a few questions and a single instruction (or none needed)
      r.xabcde = [...(fases.escolta ? [...de('signes'), ...de('noavaluable')] : []), ...(fases.preguntes ? de('anamnesi').slice(0, this.config.preguntes) : []),
        ...(!fases.instruccio ? [] : triats.includes(CAP_MANIOBRA) ? [CAP_MANIOBRA] : de('maniobres').slice(0, 1))];
      if (this.darrera() === 'xabcde') r.fet = true;
    }
    if (nivell != null && fases.nivell) {
      if (ambXabcde && !r.xabcde) return 'Primer acaba la valoració';
      if (![1, 2, 3, 4, 5].includes(Number(nivell))) return 'Nivell desconegut';
      r.nivell = Number(nivell);
      if (this.darrera() === 'nivell') r.fet = true;
    }
    if (recursos && fases.recursos) {
      if (fases.nivell && !r.nivell) return 'Primer tria el nivell';
      if (!fases.nivell && ambXabcde && !r.xabcde) return 'Primer acaba la valoració';
      r.recursos = this.lliures(recursos);
      r.fet = true;
    }
    if (r.fet) r.temps = this.segons();
    this.respostes.set(client, r);
    return null;
  }

  // Team scenario: joining a team (any time) and changes to the team's shared board (while answers are open)
  responEscenari(client, { equip, accio }) {
    if (equip) {
      if (!this.config.equips.includes(equip)) return 'Equip desconegut';
      this.equipDe.set(client, equip);
      return null;
    }
    const nom = this.equipDe.get(client);
    if (!nom || !this.config.equips.includes(nom)) return 'Tria primer el teu equip';
    if (this.estat !== 'oberta') return 'Les respostes no estan obertes';
    return this.esc.accio(nom, this.membres(nom), { client, nom: this.noms.get(client) || 'Algú' }, accio || {}, this.segons());
  }

  membres(nom) { return [...this.equipDe].filter(([, e]) => e === nom).map(([c]) => c); }

  // The first team to agree gets the speed point
  primerEquip() {
    return [...this.esc.equips.values()].filter(e => e.confirmat != null).sort((a, b) => a.confirmat - b.confirmat)[0]?.nom;
  }

  vistaEquip(nom, resultats) {
    const eq = this.esc.equip(nom);
    return { nom, ...this.esc.decisio(eq, this.noms, this.membres(nom)), ...(resultats ? { puntuacio: this.esc.puntua(eq, this.primerEquip() === nom) } : {}) };
  }

  // Points, only for the screens of the case: heard and "not assessable" items +1 right / -1 not applicable (never
  // below zero), +1 per key question in the budget, +2 for the right first instruction, 3 for the exact level (1 if
  // one off), up to 3 for the units (2 for the right number of each kind, 1 if only the kinds are right; +1 for
  // exactly the proposed ones) and, when the case needs units, +1 for activating them before finishing the assessment
  puntua(r) {
    const { xabcde, nivell, fases, preguntes } = this.config;
    const detall = { escolta: 0, preguntes: 0, instruccio: 0, nivell: 0, recursos: 0, deteccio: 0 };
    const items = xabcde.flatMap(l => l.items);
    const marcats = new Set(r.xabcde || []);
    const de = seccions => items.filter(it => seccions.includes(it.seccio));
    const maniobresBones = de(['maniobres']).filter(it => it.correcte);
    const calRecurs = this.correctes.length > 0;
    let maxim = 0;
    if (fases.escolta) {
      detall.escolta = Math.max(0, de(['signes', 'noavaluable']).filter(it => marcats.has(it.id)).reduce((s, it) => s + (it.correcte ? 1 : -1), 0));
      maxim += de(['signes', 'noavaluable']).filter(it => it.correcte).length;
    }
    if (fases.preguntes) {
      detall.preguntes = de(['anamnesi']).filter(it => it.correcte && marcats.has(it.id)).length;
      maxim += Math.min(preguntes, de(['anamnesi']).filter(it => it.correcte).length);
    }
    if (fases.instruccio) {
      if (r.xabcde && (maniobresBones.some(it => marcats.has(it.id)) || (!maniobresBones.length && marcats.has(CAP_MANIOBRA)))) detall.instruccio = 2;
      maxim += 2;
    }
    if (fases.nivell && nivell) {
      if (r.nivell) detall.nivell = r.nivell === nivell ? 3 : Math.abs(r.nivell - nivell) === 1 ? 1 : 0;
      maxim += 3;
    }
    // Without a units screen, the units activated with the bar are the answer
    const unitats = fases.recursos ? r.recursos : fases.activacio ? r.activacio?.recursos || (r.fet ? [] : null) : null;
    if (fases.recursos || fases.activacio) {
      if (unitats) {
        const meva = this.composicio(unitats), bona = this.composicio(this.correctes);
        if (CATS.every(c => meva[c] === bona[c])) detall.recursos += 2;
        else if (CATS.every(c => !meva[c] === !bona[c])) detall.recursos += 1;
        if (unitats.length === this.correctes.length && unitats.every(id => this.correctes.includes(id))) detall.recursos += 1;
      }
      maxim += 3;
    }
    if (fases.activacio && calRecurs) {
      if (r.activacio?.abansValoracio) detall.deteccio = 1;
      maxim += 1;
    }
    return { ...detall, punts: Object.values(detall).reduce((a, b) => a + b, 0), maxim };
  }

  correcte() {
    const n = this.composicio(this.correctes);
    return { nivell: this.config.nivell, recursos: this.correctes, composicio: n, text: textComposicio(n) };
  }

  // What a student's phone sees: never the right answers before the results
  vistaAlumne(client) {
    if (this.esc) {
      const resultats = this.estat === 'resultats', meu = this.equipDe.get(client);
      const equip = this.config.equips.includes(meu) ? meu : null;
      return { estat: this.estat, ronda: this.ronda, tipus: 'escenari', titol: this.config.titol, fases: {}, ...this.rellotge(),
        equips: this.config.equips.map(e => ({ nom: e, membres: this.membres(e).length })), equip, ...this.esc.publics(),
        decisio: equip ? { ...this.vistaEquip(equip, resultats), meuAcord: this.esc.equip(equip).acords.has(client) } : null,
        ...(resultats ? { solucio: this.esc.solucio() } : {}) };
    }
    const r = this.respostes.get(client);
    const resultats = this.estat === 'resultats';
    const { tipus, fases, titol, carta, preguntes } = this.config;
    return {
      estat: this.estat, ronda: this.ronda, tipus, fases, titol, carta, preguntes, ...this.rellotge(),
      xabcde: this.config.xabcde.map(l => ({ lletra: l.lletra, nom: l.nom,
        items: l.items.map(({ id, seccio, text, correcte }) => ({ id, seccio, text, ...(resultats ? { correcte } : {}) })) })),
      unitats: this.unitats.map(({ indicatiu, tipus: t, cat, base, km, eta, ocupada }) => ({ indicatiu, tipus: t, cat, base, km, eta, ocupada })),
      municipi: this.config.lloc.municipi,
      resposta: r ? { xabcde: r.xabcde, nivell: r.nivell, recursos: r.recursos, activacio: r.activacio || null, fet: !!r.fet } : null,
      ...(resultats ? { correcte: this.correcte(), puntuacio: r ? this.puntua(r) : null } : {}),
    };
  }

  // Tutor and projector: progress, answer distribution and ranking
  vistaTutor() {
    if (this.esc) {
      const resultats = this.estat === 'resultats';
      const equips = this.config.equips.map(e => this.vistaEquip(e, resultats));
      return {
        estat: this.estat, ronda: this.ronda, numero: this.numero, config: this.config, historia: this.historia.slice(0, 8), ...this.rellotge(),
        correctes: [], correcte: { text: '' }, ...this.esc.publics(), unitats: this.esc.unitats, solucio: this.esc.solucio(), equips,
        progres: { connectats: this.equipDe.size, acabats: equips.filter(e => e.confirmat != null).length, equips: equips.length },
        classificacio: resultats ? equips.map(e => ({ nom: `Equip ${e.nom}`, membres: e.membres.length, temps: e.confirmat, ...e.puntuacio }))
          .filter(e => e.membres).sort((a, b) => b.punts - a.punts || (a.temps ?? 1e9) - (b.temps ?? 1e9)) : [],
      };
    }
    const rs = [...this.respostes.values()];
    const compta = (llista, clau) => llista.reduce((m, x) => { const k = clau(x); if (k != null) m[k] = (m[k] || 0) + 1; return m; }, {});
    const fets = rs.filter(r => r.recursos);
    return {
      estat: this.estat, ronda: this.ronda, numero: this.numero, config: this.config, unitats: this.unitats, correctes: this.correctes,
      correcte: this.correcte(), historia: this.historia.slice(0, 8), ...this.rellotge(),
      progres: { connectats: rs.length, activats: rs.filter(r => r.activacio).length, xabcde: rs.filter(r => r.xabcde).length,
        nivell: rs.filter(r => r.nivell).length, recursos: fets.length, acabats: rs.filter(r => r.fet).length,
        perPas: rs.filter(r => !r.fet).reduce((m, r) => { const p = r.pas || 'inici'; m[p] = (m[p] || 0) + 1; return m; }, {}) },
      distribucio: {
        xabcde: compta(rs.flatMap(r => r.xabcde || []), id => id),
        nivell: compta(rs, r => r.nivell),
        unitats: compta(fets.flatMap(r => (r.recursos.length ? r.recursos : ['cap'])), x => x),
        composicio: compta(fets, r => textComposicio(this.composicio(r.recursos))),
        envien: { si: fets.filter(r => r.recursos.length).length, no: fets.filter(r => !r.recursos.length).length },
        // Seconds from opening the answers (and starting the recording) to the first activation, and to the final answer
        activacio: rs.filter(r => r.activacio).map(r => ({ nom: r.nom, t: r.activacio.t, abansValoracio: r.activacio.abansValoracio })).sort((a, b) => a.t - b.t),
        senseActivacio: rs.filter(r => !r.activacio).length,
        temps: rs.filter(r => r.fet).map(r => ({ nom: r.nom, t: r.temps })).sort((a, b) => a.t - b.t),
      },
      classificacio: this.estat === 'resultats'
        ? rs.map(r => ({ nom: r.nom, activacio: r.activacio?.t ?? null, temps: r.temps ?? null, ...this.puntua(r) })).sort((a, b) => b.punts - a.punts || (a.temps ?? 1e9) - (b.temps ?? 1e9)).slice(0, 15) : [],
    };
  }
}
