// Consultor training ("Aprenentatge consultors"): the tutor plays a recording and every student, on their
// phone, marks the XABCDE findings, sets the triage level and chooses which units to activate. Separate from
// the shift game: it only shares the real units, the travel times and the scoring scale.
import { CATEGORIA, distanciaKm, tempsArribada, entornDe, aleatori, comboDe, RECURSOS, XABCDE } from './app/motor.mjs';

// AURE response per level: which kinds of unit the nearest available ones should be
const RESPOSTA = { 1: ['SVA', 'SVB'], 2: ['SVA', 'SVB'], 3: ['SVB'], 4: [], 5: [] };
const OCUPACIO = 0.2;

export class Aula {
  constructor(config, dades) {
    this.dades = dades;
    this.estat = 'preparada';   // preparada → oberta (answering) → resultats
    this.ronda = 0;
    this.respostes = new Map(); // client -> {nom, xabcde: {X: index}, nivell, recursos: [indicatiu] | [], fet}
    this.configura(config);
  }

  // A new round (or the first one): case data, location and the units the students will see
  configura(c = {}) {
    const xabcde = (Array.isArray(c.xabcde) && c.xabcde.length ? c.xabcde : XABCDE).map((l, i) => {
      const opcions = (l.opcions || []).map(o => String(o).trim().slice(0, 80)).filter(Boolean).slice(0, 6);
      const correcta = Number.isInteger(l.correcta) && l.correcta >= 0 && l.correcta < opcions.length ? l.correcta : null;
      return { lletra: String(l.lletra || XABCDE[i]?.lletra || '?').slice(0, 2), nom: String(l.nom || XABCDE[i]?.nom || '').slice(0, 40), opcions, correcta };
    }).filter(l => l.opcions.length);
    const nivell = [1, 2, 3, 4, 5].includes(Number(c.nivell)) ? Number(c.nivell) : null;
    const lloc = c.lloc && Number.isFinite(c.lloc.lat) && Number.isFinite(c.lloc.lon) ? c.lloc : { municipi: 'Barcelona', zona: 'Barcelona ciutat', lat: 41.3874, lon: 2.1686 };
    const entorn = entornDe(lloc.zona, lloc.municipi, this.dades.aure.entorn_per_zona).entorn;
    this.config = { titol: String(c.titol || 'Gravació').slice(0, 80), xabcde, nivell, lloc: { ...lloc, entorn } };
    this.unitats = this.unitatsProperes(c.llavor ?? Date.now());
    this.correctes = Array.isArray(c.correctes) ? c.correctes.filter(id => this.unitats.some(u => u.indicatiu === id && !u.ocupada)) : this.recursosAure();
    this.respostes = new Map();
    this.estat = 'preparada';
    this.ronda++;
  }

  // Nearest real units of each kind, some of them busy, like the list the UCT sees
  unitatsProperes(llavor) {
    const rnd = aleatori(llavor);
    const { lloc } = this.config;
    const totes = this.dades.unitats.filter(u => CATEGORIA[u.tipus])
      .map(u => ({ indicatiu: u.indicatiu, tipus: u.tipus, base: u.base.nom, km: distanciaKm(u.base, lloc),
        eta: tempsArribada(u.tipus, u.base, lloc, lloc.entorn) }))
      .filter(u => u.km <= (u.tipus === 'HELI' ? 150 : 60))
      .sort((a, b) => a.eta - b.eta);
    const per = cat => totes.filter(u => CATEGORIA[u.tipus] === cat);
    return [...per('SVB').slice(0, 6), ...per('SVA').slice(0, 4), ...per('HEMS').slice(0, 1)]
      .map((u, i) => ({ ...u, km: Math.round(u.km), ocupada: i > 0 && rnd() < OCUPACIO }))
      .sort((a, b) => a.eta - b.eta);
  }

  // Default right answer: the nearest free unit of each kind the AURE response asks for
  recursosAure() {
    const cats = RESPOSTA[this.config.nivell] || [];
    return cats.map(cat => this.unitats.find(u => !u.ocupada && CATEGORIA[u.tipus] === cat)?.indicatiu).filter(Boolean);
  }

  ordre({ tipus, config, correctes }) {
    if (tipus === 'obre' && this.estat === 'preparada') this.estat = 'oberta';
    else if (tipus === 'resultats' && this.estat === 'oberta') this.estat = 'resultats';
    else if (tipus === 'nova') this.configura(config);
    else if (tipus === 'correctes' && Array.isArray(correctes)) {
      this.correctes = correctes.filter(id => this.unitats.some(u => u.indicatiu === id && !u.ocupada));
    } else return 'Ordre no disponible ara';
    return null;
  }

  // A student's answer arrives in steps: XABCDE, then the level, then the units
  respon(client, { nom, xabcde, nivell, recursos }) {
    if (this.estat !== 'oberta') return 'Les respostes no estan obertes';
    if (!client) return 'Falta el client';
    const r = this.respostes.get(client) || { nom: 'Anònim', xabcde: null, nivell: null, recursos: null };
    if (r.recursos) return 'Ja has enviat la resposta';
    if (nom) r.nom = String(nom).slice(0, 24);
    if (xabcde && typeof xabcde === 'object') {
      r.xabcde = Object.fromEntries(this.config.xabcde.map(l => [l.lletra, Number.isInteger(xabcde[l.lletra]) && xabcde[l.lletra] < l.opcions.length ? xabcde[l.lletra] : null]));
    }
    if (nivell != null) {
      if (!r.xabcde) return 'Primer marca el XABCDE';
      if (![1, 2, 3, 4, 5].includes(Number(nivell))) return 'Nivell desconegut';
      r.nivell = Number(nivell);
    }
    if (recursos) {
      if (!r.nivell) return 'Primer tria el nivell';
      const lliures = new Set(this.unitats.filter(u => !u.ocupada).map(u => u.indicatiu));
      r.recursos = [...new Set(recursos)].filter(id => lliures.has(id)).slice(0, 4);
      r.t = Date.now();
    }
    this.respostes.set(client, r);
    return null;
  }

  // Points: one per XABCDE letter right, 3 for the exact level (1 if one level off), and up to 3 for the units
  puntua(r) {
    const { xabcde, nivell } = this.config;
    const detall = { xabcde: 0, nivell: 0, recursos: 0 };
    for (const l of xabcde) if (l.correcta != null && r.xabcde?.[l.lletra] === l.correcta) detall.xabcde++;
    if (nivell && r.nivell) detall.nivell = r.nivell === nivell ? 3 : Math.abs(r.nivell - nivell) === 1 ? 1 : 0;
    if (r.recursos) {
      const tipus = ids => ids.map(id => this.unitats.find(u => u.indicatiu === id)).filter(Boolean);
      if (comboDe(tipus(r.recursos)) === comboDe(tipus(this.correctes))) detall.recursos += 2;
      if (r.recursos.length === this.correctes.length && r.recursos.every(id => this.correctes.includes(id))) detall.recursos += 1;
    }
    const maxim = xabcde.filter(l => l.correcta != null).length + (nivell ? 3 : 0) + 3;
    return { ...detall, punts: detall.xabcde + detall.nivell + detall.recursos, maxim };
  }

  combo(ids) { return comboDe(ids.map(id => this.unitats.find(u => u.indicatiu === id)).filter(Boolean)); }

  // What a student's phone sees: never the right answers before the results
  vistaAlumne(client) {
    const r = this.respostes.get(client);
    const resultats = this.estat === 'resultats';
    return {
      estat: this.estat, ronda: this.ronda, titol: this.config.titol,
      xabcde: this.config.xabcde.map(l => ({ lletra: l.lletra, nom: l.nom, opcions: l.opcions, ...(resultats ? { correcta: l.correcta } : {}) })),
      unitats: this.unitats.map(({ indicatiu, tipus, base, km, eta, ocupada }) => ({ indicatiu, tipus, base, km, eta, ocupada })),
      municipi: this.config.lloc.municipi,
      resposta: r ? { xabcde: r.xabcde, nivell: r.nivell, recursos: r.recursos } : null,
      ...(resultats ? { correcte: { nivell: this.config.nivell, recursos: this.correctes, combo: RECURSOS[this.combo(this.correctes)] },
        puntuacio: r ? this.puntua(r) : null } : {}),
    };
  }

  // Tutor and projector: progress, answer distribution and ranking
  vistaTutor() {
    const rs = [...this.respostes.values()];
    const compta = (llista, clau) => llista.reduce((m, x) => { const k = clau(x); if (k != null) m[k] = (m[k] || 0) + 1; return m; }, {});
    const fets = rs.filter(r => r.recursos);
    return {
      estat: this.estat, ronda: this.ronda, config: this.config, unitats: this.unitats, correctes: this.correctes,
      correctesCombo: RECURSOS[this.combo(this.correctes)],
      progres: { connectats: rs.length, xabcde: rs.filter(r => r.xabcde).length, nivell: rs.filter(r => r.nivell).length, recursos: fets.length },
      distribucio: {
        xabcde: Object.fromEntries(this.config.xabcde.map(l => [l.lletra, compta(rs.filter(r => r.xabcde), r => r.xabcde[l.lletra])])),
        nivell: compta(rs, r => r.nivell),
        unitats: compta(fets.flatMap(r => (r.recursos.length ? r.recursos : ['cap'])), x => x),
        combo: compta(fets, r => RECURSOS[this.combo(r.recursos)]),
      },
      classificacio: this.estat === 'resultats'
        ? rs.map(r => ({ nom: r.nom, ...this.puntua(r) })).sort((a, b) => b.punts - a.punts).slice(0, 15) : [],
    };
  }
}
