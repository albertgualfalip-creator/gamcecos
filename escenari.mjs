// Team scenario of the consultor training: several incidents at once competing for scarce units (the helicopter,
// the advanced units), some of them duplicate calls for the same service. Each team decides together, from their
// phones and on one shared board: which incidents are duplicates, the priority order and which unit goes where.
// The decision counts when most of the team agree with it.
import { tempsArribada, entornDe, aleatori } from './app/motor.mjs';
import { unitatsProperes, textComposicio } from './aula.mjs';

export const EQUIPS = ['Vermell', 'Blau', 'Verd', 'Groc', 'Lila', 'Taronja'];
const CATS = ['SVA', 'SVB', 'HEMS'];
const MAX_INCIDENTS = 8;

const composicio = (unitats, ids) => {
  const n = { SVA: 0, SVB: 0, HEMS: 0 };
  for (const id of ids) { const u = unitats.find(x => x.indicatiu === id); if (u) n[u.cat]++; }
  return n;
};

export class Escenari {
  constructor(c, dades, llavor, llocBase) {
    const rnd = aleatori(llavor);
    const lloc = l => (l && Number.isFinite(l.lat) ? { ...l, entorn: entornDe(l.zona, l.municipi, dades.aure.entorn_per_zona).entorn } : { ...llocBase });
    const fonts = (Array.isArray(c.incidents) ? c.incidents : []).slice(0, MAX_INCIDENTS);
    this.incidents = fonts.map((x, i) => ({
      id: /^[a-z0-9]{1,12}$/.test(x.id || '') ? x.id : `i${i + 1}`,
      numero: 261800000 + Math.floor(rnd() * 99999),
      carta: String(x.carta || '').trim().slice(0, 600), lloc: lloc(x.lloc),
      nivell: [1, 2, 3, 4, 5].includes(Number(x.nivell)) ? Number(x.nivell) : null,
      prioritat: Number.isFinite(Number(x.prioritat)) && x.prioritat !== '' && x.prioritat != null ? Number(x.prioritat) : null,
      duplicatDe: x.duplicatDe || null, correctes: Array.isArray(x.correctes) ? x.correctes : [],
    }));
    const ids = new Set(this.incidents.map(x => x.id));
    for (const inc of this.incidents) if (!ids.has(inc.duplicatDe) || inc.duplicatDe === inc.id) inc.duplicatDe = null;
    // Shared units: the ones the tutor chose (free or busy) or the nearest few, with the arrival time to each incident
    const triades = Array.isArray(c.unitats) ? c.unitats.filter(u => ['lliure', 'ocupada'].includes(u?.estat)) : [];
    const estat = new Map(triades.map(u => [u.indicatiu, u.estat]));
    const base = triades.length ? unitatsProperes(dades, llocBase, { SVB: 99, SVA: 99, HEMS: 99 }).filter(u => estat.has(u.indicatiu))
      : unitatsProperes(dades, llocBase, { SVB: 4, SVA: 2, HEMS: 1 });
    this.unitats = base.map(u => ({ ...u, ocupada: estat.get(u.indicatiu) === 'ocupada',
      etes: Object.fromEntries(this.incidents.map(inc => [inc.id, tempsArribada(u.tipus, u, inc.lloc, inc.lloc.entorn)])) }));
    const lliure = id => this.unitats.some(u => u.indicatiu === id && !u.ocupada);
    for (const inc of this.incidents) inc.correctes = inc.duplicatDe ? [] : inc.correctes.filter(lliure);
    // Right order: the incidents that are not duplicates, by the priority set (or the level)
    this.ordreCorrecte = this.incidents.filter(x => !x.duplicatDe)
      .sort((a, b) => (a.prioritat ?? a.nivell ?? 9) - (b.prioritat ?? b.nivell ?? 9)).map(x => x.id);
    this.equips = new Map();
  }

  equip(nom) {
    if (!this.equips.has(nom)) {
      this.equips.set(nom, { nom, duplicats: {}, ordre: this.incidents.map(x => x.id), assignacio: {}, acords: new Set(), confirmat: null, canvi: null });
    }
    return this.equips.get(nom);
  }

  // A change to the shared board; any change asks the team to agree again
  accio(nomEquip, membres, qui, a, segons) {
    const eq = this.equip(nomEquip);
    if (eq.confirmat != null) return 'L\'equip ja ha confirmat la decisió';
    const inc = id => this.incidents.find(x => x.id === id);
    if (a.tipus === 'acord') {
      a.si ? eq.acords.add(qui.client) : eq.acords.delete(qui.client);
      const actius = [...eq.acords].filter(c => membres.includes(c));
      if (membres.length && actius.length > membres.length / 2) eq.confirmat = segons;
      return null;
    }
    if (a.tipus === 'duplicat') {
      if (!inc(a.incident) || (a.de && (!inc(a.de) || a.de === a.incident))) return 'Incident desconegut';
      if (a.de) eq.duplicats[a.incident] = a.de; else delete eq.duplicats[a.incident];
      eq.canvi = `${qui.nom}: ${a.de ? `${inc(a.incident).numero} és duplicat de ${inc(a.de).numero}` : `${inc(a.incident).numero} no és duplicat`}`;
    } else if (a.tipus === 'ordre') {
      const ordre = Array.isArray(a.ordre) ? a.ordre : [];
      if (ordre.length !== this.incidents.length || !this.incidents.every(x => ordre.includes(x.id))) return 'Ordre invàlid';
      eq.ordre = ordre;
      eq.canvi = `${qui.nom} ha canviat la prioritat`;
    } else if (a.tipus === 'assigna') {
      const u = this.unitats.find(x => x.indicatiu === a.unitat);
      if (!u || u.ocupada) return 'Unitat no disponible';
      if (a.incident && !inc(a.incident)) return 'Incident desconegut';
      if (a.incident) eq.assignacio[u.indicatiu] = a.incident; else delete eq.assignacio[u.indicatiu];
      eq.canvi = `${qui.nom}: ${u.indicatiu} ${a.incident ? `→ ${inc(a.incident).numero}` : 'retirada'}`;
    } else return 'Acció desconeguda';
    eq.acords.clear();
    return null;
  }

  assignades(eq, id) { return Object.entries(eq.assignacio).filter(([, i]) => i === id).map(([u]) => u); }

  // Points: duplicates right (1 per incident), priority order (up to 4, by pairs in the right order), units (per real
  // incident 2 for the right number of each kind, 1 if only the kinds; -1 for every duplicate that got units:
  // a duplicated service), and 1 for the first team to agree
  puntua(eq, primer) {
    const errors = [];
    const detall = { duplicats: 0, prioritat: 0, recursos: 0, rapidesa: 0 };
    for (const inc of this.incidents) {
      const seu = eq.duplicats[inc.id] || null;
      const bo = inc.duplicatDe ? seu && this.mateix(seu, inc.duplicatDe) : !seu;
      if (bo) detall.duplicats++;
      else errors.push(inc.duplicatDe ? `No heu vist que ${inc.numero} és un duplicat de ${this.num(inc.duplicatDe)}` : `${inc.numero} no era cap duplicat`);
    }
    const ordre = eq.ordre.filter(id => this.ordreCorrecte.includes(id));
    const C = this.ordreCorrecte, parells = (C.length * (C.length - 1)) / 2;
    if (parells) {
      let bons = 0;
      for (let i = 0; i < ordre.length; i++) for (let j = i + 1; j < ordre.length; j++) if (C.indexOf(ordre[i]) < C.indexOf(ordre[j])) bons++;
      detall.prioritat = Math.round((4 * bons) / parells);
      if (ordre[0] !== C[0]) errors.push(`La primera prioritat era ${this.num(C[0])}`);
    }
    let recursos = 0;
    for (const inc of this.incidents) {
      const seves = this.assignades(eq, inc.id);
      if (inc.duplicatDe) {
        if (seves.length) { recursos--; errors.push(`Duplicitat de servei: heu enviat ${seves.join(', ')} a ${inc.numero}, que és el mateix incident que ${this.num(inc.duplicatDe)}`); }
        continue;
      }
      const meva = composicio(this.unitats, seves), bona = composicio(this.unitats, inc.correctes);
      if (CATS.every(k => meva[k] === bona[k])) recursos += 2;
      else if (CATS.every(k => !meva[k] === !bona[k])) { recursos += 1; errors.push(`${inc.numero}: calia ${textComposicio(bona)} (heu enviat ${textComposicio(meva)})`); }
      else errors.push(`${inc.numero}: calia ${textComposicio(bona)} (heu enviat ${textComposicio(meva)})`);
    }
    detall.recursos = Math.max(0, recursos);
    if (primer && eq.confirmat != null) detall.rapidesa = 1;
    const maxim = this.incidents.length + (parells ? 4 : 0) + 2 * this.ordreCorrecte.length + 1;
    return { ...detall, punts: Object.values(detall).reduce((a, b) => a + b, 0), maxim, errors };
  }

  // Two incidents are the same service when one leads to the other through the duplicate links
  mateix(a, b) {
    const arrel = id => { let x = id; for (let i = 0; i < 10 && this.incidents.find(y => y.id === x)?.duplicatDe; i++) x = this.incidents.find(y => y.id === x).duplicatDe; return x; };
    return arrel(a) === arrel(b);
  }

  num(id) { return this.incidents.find(x => x.id === id)?.numero; }

  // The incidents and units as the students see them (no right answers)
  publics() {
    return {
      incidents: this.incidents.map(({ id, numero, carta, lloc }) => ({ id, numero, carta, municipi: lloc.municipi, lat: lloc.lat, lon: lloc.lon })),
      unitats: this.unitats.map(({ indicatiu, tipus, cat, base, ocupada, etes }) => ({ indicatiu, tipus, cat, base, ocupada, etes })),
    };
  }

  decisio(eq, noms, membres) {
    return { duplicats: eq.duplicats, ordre: eq.ordre, assignacio: eq.assignacio, confirmat: eq.confirmat, canvi: eq.canvi,
      acords: [...eq.acords].filter(c => membres.includes(c)).length, necessaris: Math.floor(membres.length / 2) + 1,
      membres: membres.map(c => noms.get(c) || 'Anònim') };
  }

  solucio() {
    return this.incidents.map(inc => ({ id: inc.id, numero: inc.numero, nivell: inc.nivell, duplicatDe: inc.duplicatDe ? this.num(inc.duplicatDe) : null,
      ordre: this.ordreCorrecte.indexOf(inc.id) + 1 || null, correctes: inc.correctes, text: textComposicio(composicio(this.unitats, inc.correctes)) }));
  }
}

