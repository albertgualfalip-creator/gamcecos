// Example case for explaining the game: the phone shows any screen with made-up data and answers locally, with no
// session and no server (/aula?demo=<screen>). Used by the guided presentation.
const NA = 'No avaluable: la gravació no en dona informació';
const BLOCS = [
  { lletra: '1r', nom: 'Primer contacte: consciència i respiració', anamnesi: ['Què ha passat?', 'Està conscient? Respon si li parles o el sacseges?', 'Respira amb normalitat?'],
    signes: ['Conscient, respon', 'No respon', 'Respira amb normalitat', 'No respira o respira malament (gasping)'],
    maniobres: ['No respon i no respira bé: iniciar RCP', 'No respon però respira bé: posició lateral de seguretat'] },
  { lletra: 'B', nom: 'Respiració', anamnesi: ['Respira? Mira si el pit es mou', 'Li costa respirar? Pot dir frases senceres?'],
    signes: ['Dispnea: parla entretallada', 'Gasping o respiració agònica', 'No respira'], maniobres: ['Posició incorporada, assegut'] },
  { lletra: 'C', nom: 'Circulació', anamnesi: ['Com té la pell? Pàl·lida, suada, freda?'], signes: ['Pell pàl·lida o suada', 'Sense signes de vida'],
    maniobres: ['Anar a buscar el DEA més proper i seguir-ne les instruccions'] },
];
const CORRECTES = new Set(['1r-s2', '1r-s4', '1r-a2', '1r-a3', '1r-m1']);
const xabcde = resultats => BLOCS.map(b => ({ lletra: b.lletra, nom: b.nom, items: ['anamnesi', 'signes', 'maniobres', 'noavaluable'].flatMap(s =>
  (s === 'noavaluable' ? [NA] : b[s]).map((text, i) => ({ id: `${b.lletra}-${s[0]}${i + 1}`, seccio: s, text, ...(resultats ? { correcte: CORRECTES.has(`${b.lletra}-${s[0]}${i + 1}`) } : {}) }))) }));
const UNITATS = [
  { indicatiu: 'C205', tipus: 'SVAm', cat: 'SVA', base: 'MANRESA 1', km: 1, eta: 5 }, { indicatiu: 'C450', tipus: 'SVB', cat: 'SVB', base: 'MANRESA 2', km: 1, eta: 5 },
  { indicatiu: 'C215', tipus: 'SVAi', cat: 'SVA', base: 'MANRESA 2', km: 1, eta: 5, ocupada: true }, { indicatiu: 'C451', tipus: 'SVB', cat: 'SVB', base: 'MANRESA 3', km: 2, eta: 8 },
  { indicatiu: 'C452', tipus: 'SVB', cat: 'SVB', base: 'MANRESA 3', km: 2, eta: 8 }, { indicatiu: 'C300', tipus: 'VIR', cat: 'SVA', base: 'MANRESA 2', km: 1, eta: 9 },
  { indicatiu: 'HELI-SABADELL', tipus: 'HELI', cat: 'HEMS', base: 'Sabadell', km: 32, eta: 15 },
];
const FASES = { escolta: true, preguntes: true, instruccio: true, nivell: true, recursos: true, activacio: true };

export function vistaDemo(pas) {
  const base = { estat: 'oberta', ronda: 1, tipus: 'veu', fases: FASES, titol: 'Exemple: veïna a l\'escala', preguntes: 3, queden: 95,
    carta: 'ALERTANT, VEÍ AL LLOC, INDICA QUE LA SEVA VEÏNA S\'HA DESMAIAT A L\'ESCALA, NO RESPON.',
    xabcde: xabcde(false), unitats: UNITATS, municipi: 'Manresa', resposta: null };
  const valorat = { xabcde: ['1r-s2', '1r-a2', '1r-m1'], nivell: null, recursos: null, activacio: null, fet: false };
  switch (pas) {
    case 'espera': return { ...base, estat: 'preparada', queden: null };
    case 'nivell': return { ...base, resposta: valorat };
    case 'recursos': return { ...base, resposta: { ...valorat, nivell: 1 } };
    case 'enviat': return { ...base, resposta: { ...valorat, nivell: 1, recursos: ['C205', 'C450'], fet: true } };
    case 'resultats': return { ...base, estat: 'resultats', queden: null, xabcde: xabcde(true),
      resposta: { xabcde: ['1r-s2', '1r-s4', 'C-s1', '1r-a2', '1r-a1', '1r-m1'], nivell: 1, recursos: ['C205'], activacio: { recursos: ['C205'], t: 14, abansValoracio: true }, fet: true },
      correcte: { nivell: 1, recursos: ['C205', 'C450'], composicio: { SVA: 1, SVB: 1, HEMS: 0 }, text: '1 SVA + 1 SVB' },
      puntuacio: { escolta: 1, preguntes: 1, instruccio: 2, nivell: 3, recursos: 0, deteccio: 1, punts: 8, maxim: 13 } };
    case 'carta': return { ...base, tipus: 'carta', fases: { recursos: true }, titol: 'Exemple: accident a la C-55', queden: 60, xabcde: [],
      carta: 'ACCIDENT ENTRE UN AUTOCAR I UN TURISME A LA C-55. EL 112 INFORMA DE DIVERSOS FERITS, UN D\'ELLS ATRAPAT.' };
    case 'equip': return { estat: 'oberta', ronda: 1, tipus: 'escenari', titol: 'Exemple: tarda al Bages', fases: {}, queden: 180,
      equips: [{ nom: 'Vermell', membres: 2 }, { nom: 'Blau', membres: 3 }], equip: 'Vermell',
      incidents: [{ id: 'i1', numero: 261812506, carta: 'ACCIDENT DE MOTO A LA C-55, EL MOTORISTA NO RESPON', municipi: 'Manresa' },
        { id: 'i2', numero: 261838933, carta: 'UN CONDUCTOR AVISA D\'UN MOTORISTA A TERRA A LA C-55', municipi: 'Manresa' },
        { id: 'i3', numero: 261820167, carta: 'DONA GRAN CAIGUDA A CASA, CONSCIENT, DOLOR AL MALUC', municipi: 'Manresa' }],
      unitats: UNITATS.slice(0, 4).concat(UNITATS[6]).map(u => ({ ...u, etes: { i1: u.eta, i2: u.eta, i3: u.eta + 2 } })),
      decisio: { duplicats: { i2: 'i1' }, ordre: ['i1', 'i3', 'i2'], assignacio: { 'HELI-SABADELL': 'i1', C205: 'i1' }, acords: 1, necessaris: 2,
        membres: ['Anna', 'Pau'], canvi: 'Pau: C205 → 261812506', meuAcord: false, confirmat: null } };
    default: return base;   // escolta, preguntes, instruccio, activa
  }
}

// What an answer would do, without a server: enough to show how the screens move on
export function respostaDemo(v, { xabcde: valoracio, nivell, recursos, activa }) {
  const r = v.resposta || { xabcde: null, nivell: null, recursos: null, activacio: null, fet: false };
  if (activa) r.activacio = activa.length ? { recursos: activa, t: r.activacio?.t ?? 14, abansValoracio: !r.xabcde } : null;
  if (valoracio) r.xabcde = valoracio;
  if (nivell) r.nivell = nivell;
  if (recursos) { r.recursos = recursos; r.fet = true; }
  return { ...v, resposta: r };
}
