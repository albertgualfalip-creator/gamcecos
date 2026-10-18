// Shift engine, run by the server: incidents arrive on a clock, the consultor handles a queue of calls and the
// UCT (auxiliar and coordinator) activates and manages units. Every screen gets its own view of the same game.
import {
  PUNTS, CATEGORIA, aleatori, distanciaKm, tempsArribada, enServei, entornDe, triaVariant, baralla, rolDe, faseDe,
  perVariant, avaluaDecisio, avaluaNivell, avaluaRetrucada, comboDe, avaluaCombo, avaluaUnitats, avaluaActivacio, desenllac, pitjor,
} from './app/motor.mjs';

const RADI_KM = 60;
const ESPERA_ABANDONAMENT = 120;      // real seconds before a ringing call hangs up
const SEGONS_INFORME = 120;           // simulated seconds on scene before the unit reports to the consultor
const MINUTS_TRASLLAT = 35;           // simulated minutes of transport and transfer
const MINUTS_SENSE_TRASLLAT = 8;
const SENSE_TRASLLAT = new Set(['alta', 'queda', 'confort', 'acceptar']);
const NIVELLS = [1, 2, 3, 4, 5].map(n => ({ id: String(n), text: `N${n}` }));
// A population point is covered when the nearest free unit of each kind arrives within these minutes
const LLINDARS = { urba: { SVB: 10, SVA: 15 }, suburba: { SVB: 15, SVA: 20 }, rural: { SVB: 20, SVA: 30 } };
const SEGONS_COBERTURA = 5;           // real seconds between coverage recalculations
const SEGONS_HISTORIC = 10;           // real seconds between coverage samples for the score
const REITERACIO = [
  { id: 'informa', text: "Informar del temps d'arribada i reforçar els consells" },
  { id: 'revalora', text: 'Revalorar el pacient i avisar la UCT que encara no hi ha recurs' },
  { id: 'penja', text: 'Demanar que esperi i penjar ràpid: hi ha cua' },
];

export class Guardia {
  constructor(config, dades, llavor = Date.now()) {
    this.config = { incidents: 6, ritme: 150, ocupacio: 0.25, factor: 3, hora: '19:50', feedback: 'final', rols: ['consultor', 'uct'], ...config };
    this.dades = dades;
    this.rnd = aleatori(llavor);
    this.estat = 'preparada';
    this.t = 0;              // simulated seconds since the start
    this.real = 0;           // real seconds since the start, without pauses
    this.incidents = [];
    this.trucades = [];
    this.radio = [];
    this.baralla = [];
    this.seguentArribada = 3;
    this.seq = 0;
    this.votacio = null;
    this.tancades = [];      // decisions taken, for scoring the audience (drained by the server)
    this.missatges = [];     // room communication between the consultor and the UCT
    const [hh, mm] = this.config.hora.split(':').map(Number);
    this.horaInici = hh + mm / 60;
    this.zones = this.config.zones?.length ? this.config.zones : [...new Set(dades.unitats.map(u => u.subzona || u.regio))];
    this.unitats = dades.unitats.filter(u => CATEGORIA[u.tipus]).map(u => ({ ...u, lat: u.base.lat, lon: u.base.lon, estat: 'disponible' }));
    // Population points (primary care centres) where coverage is measured
    this.puntsDemanda = dades.centres
      .filter(c => c.tipus === 'CAP' && this.zones.includes(c.subzona || c.regio) && !/^Consultori/.test(c.nom))
      .map(c => ({ lat: c.lat, lon: c.lon, zona: c.subzona || c.regio, entorn: entornDe(c.subzona || c.regio, c.municipi, dades.aure.entorn_per_zona).entorn,
      }));
    const vistes = new Set();
    this.bases = this.unitats.filter(u => this.zones.includes(u.subzona || u.regio) && !vistes.has(u.base.nom) && vistes.add(u.base.nom))
      .map(u => ({ nom: u.base.nom, municipi: u.base.municipi, zona: u.subzona || u.regio, lat: u.base.lat, lon: u.base.lon }));
    this.moviments = [];
    this.historicCobertura = [];
    this.resultatsGlobals = [];
    this.cobCache = null;
    this.cobReal = -99;
  }

  // Who does the shift supervisor's tasks when there is no supervisor in this shift
  rolCap() { return this.config.rols.includes('cap') ? 'cap' : 'uct'; }

  // ---------- clock ----------

  hora() { return (this.horaInici + this.t / 3600) % 24; }
  textHora(h = this.hora(), segons = true) {
    const s = Math.floor(h * 3600), p2 = n => String(n).padStart(2, '0');
    return `${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}${segons ? ':' + p2(s % 60) : ''}`;
  }

  inicia() {
    if (this.estat !== 'preparada') return;
    this.estat = 'enmarxa';
    const mes = new Date().getMonth();
    for (const u of this.unitats) {
      if (!enServei(u.horari, this.hora(), mes)) u.estat = 'fora de servei';
      else if (this.rnd() < this.config.ocupacio) { u.estat = 'ocupada'; u.fins = this.real + (120 + this.rnd() * 600); }
    }
  }

  tic(dt) {
    if (this.estat !== 'enmarxa') return;
    this.real += dt;
    this.t += dt * this.config.factor;
    this.actualitzaUnitats();
    this.actualitzaMoviments();
    this.actualitzaTrucades();
    if (this.real - (this.historicCobertura.at(-1)?.real ?? -99) >= SEGONS_HISTORIC) {
      this.historicCobertura.push({ real: this.real, hora: this.textHora(this.hora(), false), zones: this.cobertura().map(c => [c.zona, c.pct]) });
    }
    const automatics = this.incidents.filter(i => !i.manual).length;
    if (automatics < this.config.incidents && this.real >= this.seguentArribada) {
      this.nouIncident();
      this.seguentArribada = this.real + this.config.ritme * (0.7 + this.rnd() * 0.6);
    }
    this.actualitzaVotacio();
  }

  // ---------- incidents ----------

  nouIncident({ tematica, casId, manual = false } = {}) {
    const casos = this.dades.casos;
    let cas = casos.find(c => c.id === casId);
    if (!cas && tematica) cas = baralla(casos, [tematica], this.rnd)[0];
    if (!cas) {
      if (!this.baralla.length) this.baralla = baralla(casos, this.config.tematiques, this.rnd);
      cas = this.baralla.pop();
    }
    const variant = triaVariant(cas, this.rnd);
    const zona = this.zones[Math.floor(this.rnd() * this.zones.length)];
    const caps = this.dades.centres.filter(c => c.tipus === 'CAP' && (c.subzona || c.regio) === zona && !/^Consultori/.test(c.nom));
    const cap = caps[Math.floor(this.rnd() * caps.length)] || this.dades.centres[0];
    const municipi = cap.municipi || cap.nom.replace(/^(CAP|Consultori local)\s+/, '');
    const punt = { lat: cap.lat + (this.rnd() - 0.5) * 0.012, lon: cap.lon + (this.rnd() - 0.5) * 0.012 };
    const { entorn, pendent } = entornDe(zona, municipi, this.dades.aure.entorn_per_zona);
    const inc = {
      id: ++this.seq, numero: 261800000 + Math.floor(this.rnd() * 99999), cas, variant, zona, municipi, punt, entorn, pendent, manual,
      edat: cas.pacient.edat[0] + Math.floor(this.rnd() * (cas.pacient.edat[1] - cas.pacient.edat[0] + 1)),
      arribada: this.real, horaAlerta: this.hora(), estat: 'obert',
      decisions: {}, desbloquejat: {}, resultats: [], registre: [], unitats: new Set(), historic: new Set(),
      primeraActivacio: null, preguntes: [], transcript: [], trucadaFeta: false, informe: null, reiteracions: 0,
      dea: this.dades.dea.map(d => ({ nom: d.nom, lat: d.lat, lon: d.lon, dist: Math.round(distanciaKm(d, punt) * 1000) }))
        .filter(d => d.dist <= 400).sort((a, b) => a.dist - b.dist).slice(0, 5),
    };
    this.incidents.push(inc);
    this.registre(inc, '', 'SITREM', cas.tipus_demanda, '112');
    this.registre(inc, 'T', 'SITREM', cas.carta, '112');
    this.desbloqueja(inc, 'entrada');
    if (cas.entrada === 'veu_sanitaria') {
      this.registre(inc, 'T', 'SITREM', 'VPS', '112');
      this.novaTrucada(inc, 'consulta', `${cas.alertant}: trucada passada a valorar`);
    }
    return inc;
  }

  registre(inc, codi, usuari, text, font) {
    inc.registre.unshift({ hora: `${new Date().toLocaleDateString('ca')} ${this.textHora()}`, codi, usuari, text, font });
  }

  passos(inc, fase) { return inc.cas.passos.filter(p => faseDe(p) === fase); }

  desbloqueja(inc, fase) {
    for (const p of this.passos(inc, fase)) inc.desbloquejat[p.id] ??= this.real;
  }

  pendents(inc, rol) {
    if (inc.estat === 'tancat') return [];
    return inc.cas.passos
      .filter(p => p.tipus !== 'retrucada' && rolDe(p) === rol && inc.desbloquejat[p.id] != null && !inc.decisions[p.id])
      .filter(p => faseDe(p) !== 'trucada' || this.trucadaActiva()?.incident === inc.id && this.trucadaActiva().tipus === 'consulta')
      .filter(p => faseDe(p) !== 'lloc' || this.trucadaActiva()?.incident === inc.id && this.trucadaActiva().tipus === 'unitat')
      .map(p => this.descriptor(inc, p));
  }

  descriptor(inc, p) {
    const opcions = p.tipus === 'nivell' ? NIVELLS : p.opcions.map(o => ({ id: o.id, text: o.text }));
    return { incident: inc.id, numero: inc.numero, pas: p.id, titol: p.titol, pregunta: p.pregunta, opcions, rol: rolDe(p),
      informe: p.informe ? perVariant(p.informe, inc.variant.id) : null };
  }

  decideix(rol, { incident, pas: pasId, opcio }) {
    const inc = this.incidents.find(i => i.id === Number(incident));
    if (!inc) return 'Incident desconegut';
    const pas = inc.cas.passos.find(p => p.id === pasId);
    if (!pas || !this.pendents(inc, rol).some(d => d.pas === pasId)) return 'Aquesta decisió no està disponible';
    const v = inc.variant.id;
    const r = pas.tipus === 'nivell' ? avaluaNivell(pas, opcio, v) : avaluaDecisio(pas, opcio, v);
    if (!r.valoracio) return 'Opció desconeguda';
    if (pas.mostra_dea && inc.variant.nivell === 1) {
      r.feedback += inc.dea.length ? ` DEA més proper: ${inc.dea[0].nom} a ${inc.dea[0].dist} m.` : ' No hi ha cap DEA registrat a menys de 400 m.';
    }
    const descr = this.descriptor(inc, pas);
    const text = descr.opcions.find(o => o.id === opcio).text;
    inc.decisions[pasId] = { opcio, text, t: this.real };
    inc.resultats.push({ pas: pas.titol, rol, valoracio: r.valoracio, feedback: r.feedback, equip: text });
    this.registre(inc, rol === 'uct' ? 'O' : 'L', rol === 'uct' ? 'UCT' : 'CONSULTOR', pas.tipus === 'nivell' ? `Triatge avançat: N${opcio}` : text, rol);
    const valoracions = Object.fromEntries(descr.opcions.map(o => [o.id,
      pas.tipus === 'nivell' ? avaluaNivell(pas, o.id, v).valoracio : avaluaDecisio(pas, o.id, v).valoracio]));
    this.tancades.push({ id: `${inc.id}:${pasId}`, valoracions, resultat: { equip: text, valoracio: r.valoracio, feedback: r.feedback } });

    if (pasId === 'activacio') this.novaTrucada(inc, 'consulta', `Retrucada a ${inc.cas.alertant.toLowerCase()}`);
    if (pas.tipus === 'nivell') this.desbloqueja(inc, 'gestio');
    if (pasId === 'trasllat') this.iniciaTrasllat(inc, opcio);
    return null;
  }

  // ---------- consultor calls ----------

  novaTrucada(inc, tipus, resum) {
    if (this.trucades.some(t => t.incident === inc.id && t.tipus === tipus && ['sona', 'activa'].includes(t.estat))) return;
    this.trucades.push({ id: `T${this.trucades.length + 1}`, incident: inc.id, tipus, resum, des: this.real, estat: 'sona' });
  }

  trucadaActiva() { return this.trucades.find(t => t.estat === 'activa'); }

  despenja(id) {
    if (this.trucadaActiva()) return 'Ja teniu una trucada en curs: finalitzeu-la abans';
    const tr = this.trucades.find(t => t.id === id && t.estat === 'sona');
    if (!tr) return 'Aquesta trucada ja no hi és';
    const inc = this.incidents.find(i => i.id === tr.incident);
    tr.estat = 'activa';
    tr.espera = Math.round(this.real - tr.des);
    if (tr.tipus === 'consulta') {
      inc.esperaConsulta = tr.espera;
      this.desbloqueja(inc, 'trucada');
      this.registre(inc, 'L', 'CONSULTOR', `Parlo amb ${inc.cas.alertant.toLowerCase()}`, 'consultor');
      inc.transcript.push({ qui: 'alertant', text: this.primeraFrase(inc) });
    }
    if (tr.tipus === 'unitat') {
      this.desbloqueja(inc, 'lloc');
      inc.transcript.push({ qui: 'unitat', text: inc.informe });
    }
    if (tr.tipus === 'reiteracio') inc.transcript.push({ qui: 'alertant', text: 'Encara no ha arribat ningú! Quant falta?' });
    return null;
  }

  primeraFrase(inc) {
    if (inc.cas.entrada === 'veu_sanitaria') return inc.cas.carta.charAt(0) + inc.cas.carta.slice(1).toLowerCase();
    if (inc.cas.alertant === 'Teleassistència') return 'Teleassistència, digui. La usuària segueix sense contestar.';
    return `Sí? Soc ${inc.cas.alertant.toLowerCase()}, he trucat al 112.`;
  }

  pregunta(id) {
    const tr = this.trucadaActiva();
    if (!tr || tr.tipus !== 'consulta') return 'Cal tenir la consulta en curs';
    const inc = this.incidents.find(i => i.id === tr.incident);
    const pas = inc.cas.passos.find(p => p.tipus === 'retrucada');
    const q = pas?.preguntes.find(x => x.id === id);
    if (!q || inc.preguntes.includes(id)) return 'Pregunta no disponible';
    const resposta = perVariant(q.resposta, inc.variant.id);
    inc.preguntes.push(id);
    inc.transcript.push({ qui: 'consultor', text: q.text }, { qui: 'alertant', text: resposta });
    this.registre(inc, 'L', 'CONSULTOR', `${q.text} // ${resposta}`, 'consultor');
    return null;
  }

  penja() {
    const tr = this.trucadaActiva();
    if (!tr) return 'No hi ha cap trucada en curs';
    const inc = this.incidents.find(i => i.id === tr.incident);
    if (tr.tipus === 'consulta') {
      const falten = this.pendents(inc, 'consultor').filter(d => d.pas !== 'trasllat');
      if (falten.length) return `Abans de penjar: ${falten.map(d => d.titol.toLowerCase()).join(', ')}`;
      const pas = inc.cas.passos.find(p => p.tipus === 'retrucada');
      if (pas) {
        const r = avaluaRetrucada(pas, inc.preguntes);
        inc.resultats.push({ pas: 'Retrucada', rol: 'consultor', valoracio: r.valoracio, feedback: `${r.feedback} (${inc.preguntes.length} preguntes)`, equip: `${inc.preguntes.length} preguntes` });
      }
      const espera = tr.espera;
      const v = espera <= 20 ? 'optima' : espera <= 60 ? 'acceptable' : 'suboptima';
      inc.resultats.push({ pas: 'Resposta a la trucada', rol: 'consultor', valoracio: v, feedback: `Despenjada als ${espera} s.`, equip: `${espera} s` });
      inc.trucadaFeta = true;
      this.desbloqueja(inc, 'gestio');
    }
    if (tr.tipus === 'unitat' && !inc.decisions.trasllat) return 'Abans de penjar, decidiu el trasllat';
    if (tr.tipus === 'reiteracio') return 'Responeu la reiteració abans de penjar';
    tr.estat = 'fi';
    this.registre(inc, 'L', 'CONSULTOR', 'Finalitzo la trucada', 'consultor');
    this.comprovaTancament(inc);
    return null;
  }

  respostaReiteracio(opcio) {
    const tr = this.trucadaActiva();
    if (!tr || tr.tipus !== 'reiteracio') return 'No hi ha cap reiteració en curs';
    const inc = this.incidents.find(i => i.id === tr.incident);
    const ambRecurs = inc.unitats.size > 0;
    const v = { informa: ambRecurs ? 'optima' : 'suboptima', revalora: ambRecurs ? 'acceptable' : 'optima', penja: 'suboptima' }[opcio];
    if (!v) return 'Opció desconeguda';
    const text = REITERACIO.find(o => o.id === opcio).text;
    inc.resultats.push({ pas: 'Reiteració', rol: 'consultor', valoracio: v, equip: text,
      feedback: ambRecurs ? 'Hi ha recurs en camí: informar i reforçar consells.' : 'Encara no hi ha recurs: cal revalorar i avisar la UCT.' });
    this.registre(inc, 'L', 'CONSULTOR', `Reiteració: ${text}`, 'consultor');
    if (opcio === 'revalora') this.registre(inc, 'O', 'CONSULTOR', 'AVÍS A UCT: REITERACIÓ SENSE RECURS ASSIGNAT', 'consultor');
    tr.estat = 'fi';
    return null;
  }

  actualitzaTrucades() {
    for (const tr of this.trucades.filter(t => t.estat === 'sona' && this.real - t.des > ESPERA_ABANDONAMENT)) {
      tr.estat = 'abandonada';
      const inc = this.incidents.find(i => i.id === tr.incident);
      this.registre(inc, 'T', 'SITREM', 'TRUCADA ABANDONADA: L\'ALERTANT HA PENJAT', '112');
      inc.resultats.push({ pas: 'Trucada abandonada', rol: 'consultor', valoracio: tr.tipus === 'consulta' ? 'perillosa' : 'suboptima',
        feedback: `${ESPERA_ABANDONAMENT} s sonant sense despenjar.`, equip: 'sense resposta' });
      if (tr.tipus === 'consulta') {   // the caller phones again later
        tr.tornaA = this.real + 20;
      }
    }
    for (const tr of this.trucades.filter(t => t.tornaA && t.tornaA <= this.real)) {
      tr.tornaA = null;
      const inc = this.incidents.find(i => i.id === tr.incident);
      if (!inc.trucadaFeta) this.novaTrucada(inc, 'consulta', `Torna a trucar ${inc.cas.alertant.toLowerCase()}`);
    }
    // Repeated calls when nobody has arrived yet for urgent levels
    for (const inc of this.incidents.filter(i => i.estat === 'obert' && i.variant.nivell <= 3 && i.reiteracions < 2)) {
      const llindar = 150 + inc.reiteracions * 150;
      const alLloc = this.unitats.some(u => inc.unitats.has(u.indicatiu) && u.fase !== 'ruta') || inc.decisions.trasllat;
      if (!alLloc && this.real - inc.arribada > llindar) {
        inc.reiteracions++;
        this.registre(inc, 'T', 'SITREM', 'REITERACIÓ: L\'ALERTANT TORNA A TRUCAR, ENCARA NO HA ARRIBAT NINGÚ', '112');
        this.novaTrucada(inc, 'reiteracio', 'Reiteració: encara no ha arribat ningú');
      }
    }
  }

  // ---------- units ----------

  candidates(inc) {
    return this.unitats
      .filter(u => u.estat === 'disponible' && distanciaKm(u, inc.punt) <= (u.tipus === 'HELI' ? 200 : RADI_KM))
      .map(u => ({ indicatiu: u.indicatiu, tipus: u.tipus, eta: tempsArribada(u.tipus, u, inc.punt, inc.entorn), base: u.base.nom }))
      .sort((a, b) => a.eta - b.eta);
  }

  assigna(incident, indicatiu) {
    const inc = this.incidents.find(i => i.id === Number(incident));
    const u = this.unitats.find(x => x.indicatiu === indicatiu);
    if (!inc || inc.estat === 'tancat') return 'Incident tancat';
    if (u?.estat === 'assignada') {
      const altre = this.incidents.find(i => i.id === u.incident);
      return `${indicatiu} està activada a l'incident ${altre?.numero}: desactiveu-la allà (3.11) abans d'assignar-la aquí`;
    }
    if (!u || u.estat !== 'disponible') return 'Unitat no disponible';
    const eta = tempsArribada(u.tipus, u, inc.punt, inc.entorn);
    Object.assign(u, { estat: 'assignada', incident: inc.id, fase: 'ruta', eta, arribaT: this.t + eta * 60, moviment: null });
    inc.unitats.add(indicatiu);
    inc.historic.add(indicatiu);
    inc.primeraActivacio ??= this.real;
    this.missatgeRadio(inc, `${indicatiu} 3.35 MOBILITZACIÓ · 3.50: ${eta} MIN`);
    return null;
  }

  allibera(incident, indicatiu) {
    const inc = this.incidents.find(i => i.id === Number(incident));
    const u = this.unitats.find(x => x.indicatiu === indicatiu);
    if (!inc || !u || !inc.unitats.has(indicatiu) || inc.estat === 'tancat') return 'No es pot desactivar';
    inc.unitats.delete(indicatiu);
    inc.historic.delete(indicatiu);
    Object.assign(u, { estat: 'disponible', incident: null, fase: null });
    this.missatgeRadio(inc, `${indicatiu} 3.11 ANUL·LACIÓ DEL SERVEI`);
    return null;
  }

  missatgeRadio(inc, text) {
    if (inc) this.registre(inc, 'R', 'RSRSR', text, 'radio');
    this.radio.unshift({ hora: this.textHora(), numero: inc?.numero ?? '', text });
    this.radio.length = Math.min(this.radio.length, 12);
  }

  actualitzaUnitats() {
    const mes = new Date().getMonth();
    for (const u of this.unitats) {
      if (u.estat === 'ocupada' && u.fins <= this.real) {
        u.estat = enServei(u.horari, this.hora(), mes) ? 'disponible' : 'fora de servei';
        if (u.alliberadaDe) this.missatgeRadio(u.alliberadaDe, `${u.indicatiu} 3.6 FINALITZA EL SERVEI, OPERATIVA`);
        u.alliberadaDe = null;
      }
      if (u.estat !== 'assignada') continue;
      const inc = this.incidents.find(i => i.id === u.incident);
      if (u.fase === 'ruta' && this.t >= u.arribaT) {
        u.fase = 'lloc';
        this.missatgeRadio(inc, `${u.indicatiu} 3.4 ARRIBADA AL LLOC`);
        inc.informeT ??= this.t + SEGONS_INFORME;
      }
    }
    for (const inc of this.incidents.filter(i => i.estat === 'obert' && i.informeT != null && !i.informe && this.t >= i.informeT)) {
      const pas = inc.cas.passos.find(p => p.id === 'trasllat');
      const unitat = this.unitats.find(u => inc.unitats.has(u.indicatiu) && u.fase === 'lloc');
      if (!pas || !unitat) continue;
      inc.informe = `${unitat.indicatiu}: ${perVariant(pas.informe, inc.variant.id)}`;
      this.missatgeRadio(inc, `${unitat.indicatiu} 3.1 S DEMANA CONSULTA SANITÀRIA`);
      this.novaTrucada(inc, 'unitat', `${unitat.indicatiu} · 3.1 S: consulta sanitària des del lloc`);
    }
  }

  iniciaTrasllat(inc, opcio) {
    const o = inc.cas.passos.find(p => p.id === 'trasllat')?.opcions.find(x => x.id === opcio);
    const senseTrasllat = o?.sense_trasllat ?? SENSE_TRASLLAT.has(opcio);
    const alLloc = this.unitats.filter(u => inc.unitats.has(u.indicatiu));
    const ordre = { SVA: 0, HEMS: 1, SVB: 2 };
    const portadora = senseTrasllat ? null : [...alLloc].sort((a, b) => ordre[CATEGORIA[a.tipus]] - ordre[CATEGORIA[b.tipus]])[0];
    inc.unitatsFinals = alLloc.map(u => ({ indicatiu: u.indicatiu, tipus: u.tipus, eta: u.eta }));
    for (const u of alLloc) {
      const minuts = u === portadora ? MINUTS_TRASLLAT : MINUTS_SENSE_TRASLLAT;
      Object.assign(u, { estat: 'ocupada', fase: null, incident: null, fins: this.real + (minuts * 60) / this.config.factor, alliberadaDe: inc });
      inc.unitats.delete(u.indicatiu);
    }
    const ambSva = alLloc.some(u => CATEGORIA[u.tipus] === 'SVA');
    const assistit = portadora && CATEGORIA[portadora.tipus] !== 'SVB';
    this.missatgeRadio(inc, portadora ? `${portadora.indicatiu} ${assistit ? '3.51 TRASLLAT ASSISTIT' : '3.52 TRASLLAT NO ASSISTIT'}`
      : opcio === 'acceptar' ? '3.22 ALTA VOLUNTÀRIA / REBUIG DEL TRASLLAT' : ambSva ? '3.22 M ALTA MÈDICA IN SITU' : 'FINALITZEN L\'ASSISTÈNCIA SENSE TRASLLAT');
  }

  comprovaTancament(inc) {
    if (inc.estat === 'tancat' || !inc.trucadaFeta) return;
    const uct = this.pendents(inc, 'uct');
    // A pending repeated call does not keep the incident open: it is dropped when the incident closes
    const consulta = this.trucades.some(t => t.incident === inc.id && (t.estat === 'activa' || (t.estat === 'sona' && t.tipus !== 'reiteracio')));
    if (!uct.length && !consulta && (inc.decisions.trasllat || inc.forçaTancament)) this.tanca(inc);
  }

  finalitza(incident) {
    const inc = this.incidents.find(i => i.id === Number(incident));
    if (!inc || inc.estat === 'tancat') return 'Incident ja tancat';
    if (this.pendents(inc, 'uct').length) return 'Queden decisions de la UCT pendents';
    if (!inc.trucadaFeta) return 'El consultor encara no ha fet la valoració';
    if (inc.unitats.size) return 'Hi ha unitats activades: espereu la consulta des del lloc o desactiveu-les';
    inc.forçaTancament = true;
    this.tanca(inc);
    return null;
  }

  tanca(inc) {
    const totes = [...inc.historic].map(id => this.unitats.find(u => u.indicatiu === id));
    const finals = (inc.unitatsFinals || totes.map(u => ({ indicatiu: u.indicatiu, tipus: u.tipus, eta: u.eta ?? tempsArribada(u.tipus, u, inc.punt, inc.entorn) })));
    const disponibles = this.candidates(inc);
    const sva = disponibles.filter(u => CATEGORIA[u.tipus] === 'SVA').map(u => u.eta);
    const combo = avaluaCombo(comboDe(finals), inc.variant.nivell, inc.entorn, sva.length ? Math.min(...sva, ...finals.filter(u => CATEGORIA[u.tipus] === 'SVA').map(u => u.eta)) : null);
    const unitats = avaluaUnitats(finals, [...disponibles, ...finals]);
    const temps = avaluaActivacio(inc.variant.nivell, inc.primeraActivacio != null ? Math.round(inc.primeraActivacio - inc.arribada) : null);
    inc.resultats.push({ pas: 'Recursos', tipus: 'recursos', rol: 'uct', valoracio: pitjor(combo.valoracio, unitats.valoracio),
      feedback: [combo.feedback, unitats.feedback].filter(Boolean).join(' '), equip: finals.map(u => u.indicatiu).join(', ') || 'cap' });
    inc.resultats.push({ pas: "Temps d'activació", tipus: 'temps', rol: 'uct', valoracio: temps.valoracio, feedback: temps.feedback || 'No era temps-depenent.', equip: '' });
    inc.desenllac = desenllac(inc.resultats, inc.variant.nivell, inc.variant.desenllac?.criteri);
    inc.estat = 'tancat';
    for (const tr of this.trucades.filter(t => t.incident === inc.id && t.estat === 'sona')) tr.estat = 'fi';
    this.registre(inc, 'O', 'UCT', inc.desenllac === 'bo' ? 'INCIDENT FINALITZAT' : 'INCIDENT FINALITZAT AMB INCIDÈNCIES', 'uct');
  }

  // ---------- tutor ----------

  ordre(o) {
    if (o.tipus === 'inicia') this.inicia();
    if (o.tipus === 'pausa' && this.estat === 'enmarxa') this.estat = 'pausa';
    if (o.tipus === 'repren' && this.estat === 'pausa') this.estat = 'enmarxa';
    if (o.tipus === 'incident' && this.estat !== 'finalitzada') this.nouIncident({ tematica: o.tematica, casId: o.cas, manual: true });
    if (o.tipus === 'missatge') {
      const inc = this.incidents.find(i => i.id === Number(o.incident));
      if (inc) this.registre(inc, o.codi || 'T', o.codi === 'R' ? 'RSRSR' : 'SITREM', String(o.text || '').toUpperCase(), o.codi === 'R' ? 'radio' : '112');
    }
    if (o.tipus === 'avaria') {
      const u = this.unitats.find(x => x.estat === 'assignada' && x.fase === 'ruta')
        || this.unitats.find(x => x.estat === 'disponible' && this.zones.includes(x.subzona || x.regio));
      if (u) {
        const inc = this.incidents.find(i => i.id === u.incident);
        if (inc) { inc.unitats.delete(u.indicatiu); inc.historic.delete(u.indicatiu); this.missatgeRadio(inc, `${u.indicatiu} AVARIA MECÀNICA · NO OPERATIVA`); }
        Object.assign(u, { estat: 'avariada', incident: null, fase: null });
      }
    }
    if (o.tipus === 'pic') {
      for (const u of this.unitats) if (u.estat === 'disponible' && this.rnd() < 0.3) { u.estat = 'ocupada'; u.fins = this.real + 300 + this.rnd() * 600; }
    }
    if (o.tipus === 'descobreix') {   // complication: the free SVA of a zone get busy for a while
      for (const u of this.unitats.filter(x => x.estat === 'disponible' && CATEGORIA[x.tipus] === 'SVA' && (x.subzona || x.regio) === o.zona)) {
        Object.assign(u, { estat: 'ocupada', fins: this.real + 480, moviment: null });
      }
      this.cobCache = null;
    }
    if (o.tipus === 'final') {
      for (const inc of this.incidents.filter(i => i.estat === 'obert')) this.tanca(inc);
      this.avaluaCobertura();
      this.estat = 'finalitzada';
      this.votacio = null;
    }
    if (o.tipus === 'briefing') this.config.briefing = String(o.text || '').slice(0, 300);
    this.actualitzaVotacio();
  }

  // ---------- actions from the screens ----------

  accio(rol, a = {}) {
    if (rol === 'tutor') { this.ordre(a); return null; }
    if (!this.config.rols.includes(rol)) return 'Aquest rol no forma part d\'aquesta guàrdia';
    if (this.estat !== 'enmarxa') return this.estat === 'pausa' ? 'La guàrdia està en pausa' : 'La guàrdia no està en marxa';
    let error = 'Acció desconeguda';
    if (a.tipus === 'decideix') error = this.decideix(rol, a);
    if (rol === 'uct' && a.tipus === 'assigna') error = this.assigna(a.incident, a.unitat);
    if (rol === 'uct' && a.tipus === 'allibera') error = this.allibera(a.incident, a.unitat);
    if (rol === 'uct' && a.tipus === 'finalitza') error = this.finalitza(a.incident);
    if (rol === 'consultor' && a.tipus === 'despenja') error = this.despenja(a.trucada);
    if (rol === 'consultor' && a.tipus === 'pregunta') error = this.pregunta(a.pregunta);
    if (rol === 'consultor' && a.tipus === 'penja') error = this.penja();
    if (rol === 'consultor' && a.tipus === 'reiteracio') error = this.respostaReiteracio(a.opcio);
    if (a.tipus === 'avisa') error = this.avisa(rol, a);
    if (['uct', 'cap'].includes(rol) && a.tipus === 'mou') error = this.mou(rol, a);
    for (const inc of this.incidents) this.comprovaTancament(inc);
    this.actualitzaVotacio();
    return error;
  }

  avisa(rol, { text, incident }) {
    text = String(text || '').trim().slice(0, 200);
    if (!text) return 'Missatge buit';
    const inc = this.incidents.find(i => i.id === Number(incident));
    this.missatges.unshift({ de: rol, text, hora: this.textHora(), numero: inc?.numero ?? null });
    this.missatges.length = Math.min(this.missatges.length, 30);
    if (inc) this.registre(inc, 'O', rol === 'uct' ? 'UCT' : 'CONSULTOR', `AVÍS ${rol === 'uct' ? 'A CONSULTOR' : 'A UCT'}: ${text}`, rol);
    return null;
  }

  // Coverage: share of population points reached in time by a free SVB and a free SVA, plus free units per zone
  calculaCobertura() {
    const lliures = this.unitats.filter(u => u.estat === 'disponible' && u.tipus !== 'HELI');
    for (const p of this.puntsDemanda) {
      const llindar = LLINDARS[p.entorn] || LLINDARS.suburba;
      const millor = cat => Math.min(Infinity, ...lliures.filter(u => CATEGORIA[u.tipus] === cat && distanciaKm(u, p) <= RADI_KM)
        .map(u => tempsArribada(u.tipus, u, p, p.entorn)));
      p.svb = millor('SVB') <= llindar.SVB;
      p.sva = millor('SVA') <= llindar.SVA;
    }
    this.cobCache = this.zones.map(zona => {
      const deZona = this.unitats.filter(u => (u.subzona || u.regio) === zona && !['fora de servei', 'avariada'].includes(u.estat));
      const compta = (cat, estat) => deZona.filter(u => CATEGORIA[u.tipus] === cat && (!estat || u.estat === estat)).length;
      const punts = this.puntsDemanda.filter(p => p.zona === zona);
      const pct = punts.length ? Math.round((100 * punts.filter(p => p.svb && p.sva).length) / punts.length) : 100;
      return { zona, sva: [compta('SVA', 'disponible'), compta('SVA')], svb: [compta('SVB', 'disponible'), compta('SVB')], pct, descoberta: pct < 60 };
    });
    this.cobReal = this.real;
  }

  cobertura() {
    if (!this.cobCache || this.real - this.cobReal >= SEGONS_COBERTURA) this.calculaCobertura();
    return this.cobCache;
  }

  mapaCobertura() {
    this.cobertura();
    return this.puntsDemanda.map(p => [Math.round(p.lat * 1e4) / 1e4, Math.round(p.lon * 1e4) / 1e4, p.svb && p.sva ? 2 : p.svb || p.sva ? 1 : 0]);
  }

  // Preventive moves: a free unit drives to another base to cover a zone; it stays available on the way
  mou(rol, { unitat, desti }) {
    const u = this.unitats.find(x => x.indicatiu === unitat);
    const base = desti === 'base' ? u?.base && { nom: u.base.nom, lat: u.base.lat, lon: u.base.lon } : this.bases.find(b => b.nom === desti);
    if (!u || u.estat !== 'disponible') return 'Només es poden moure unitats lliures';
    if (!base) return 'Destinació desconeguda';
    const minuts = tempsArribada(u.tipus, u, base, 'suburba');
    u.moviment = { origen: { lat: u.lat, lon: u.lon }, desti: base, inici: this.t, arribaT: this.t + minuts * 60 };
    this.moviments.push({ rol, unitat, desti: base.nom, hora: this.textHora(), minuts });
    this.missatgeRadio(null, desti === 'base' ? `${unitat} 3.10 RETORN A BASE` : `${unitat} ES DESPLAÇA A ${base.nom.toUpperCase()} PER COBERTURA · ${minuts} MIN`);
    this.cobCache = null;
    return null;
  }

  actualitzaMoviments() {
    for (const u of this.unitats.filter(x => x.moviment)) {
      const m = u.moviment;
      const f = Math.min(1, (this.t - m.inici) / Math.max(1, m.arribaT - m.inici));
      u.lat = m.origen.lat + (m.desti.lat - m.origen.lat) * f;
      u.lon = m.origen.lon + (m.desti.lon - m.origen.lon) * f;
      if (f >= 1) {
        u.moviment = null;
        u.ubicacio = m.desti.nom === u.base.nom ? null : m.desti.nom;
        this.missatgeRadio(null, m.desti.nom === u.base.nom ? `${u.indicatiu} 3.3 OPERATIVA A BASE` : `${u.indicatiu} 3.54 OPERATIVA COBRINT ZONA FORA DE BASE: ${m.desti.nom.toUpperCase()}`);
        this.cobCache = null;
      }
    }
  }

  // Coverage score for the whole shift, given to the shift supervisor (or the UCT when there is none)
  avaluaCobertura() {
    const mostres = this.historicCobertura.flatMap(h => h.zones.map(([, pct]) => pct));
    if (!mostres.length) return;
    const mitjana = Math.round(mostres.reduce((a, b) => a + b, 0) / mostres.length);
    const descoberts = this.historicCobertura.filter(h => h.zones.some(([, pct]) => pct < 60)).length * SEGONS_HISTORIC;
    const valoracio = mitjana >= 80 ? 'optima' : mitjana >= 65 ? 'acceptable' : mitjana >= 50 ? 'suboptima' : 'perillosa';
    this.resultatsGlobals.push({ pas: 'Cobertura territorial', rol: this.rolCap(), valoracio, equip: `${this.moviments.length} moviments`,
      feedback: `Cobertura mitjana ${mitjana} %. Alguna zona per sota del 60 % durant ${Math.round(descoberts / 60)} min reals.` });
  }

  // Shift handover: what the team knows when it takes over
  briefing() {
    const cob = this.cobertura();
    const pitjor = [...cob].sort((a, b) => a.sva[0] / (a.sva[1] || 1) - b.sva[0] / (b.sva[1] || 1))[0];
    return [
      `Relleu de torn a les ${this.textHora(this.hora(), false)}. ${this.config.nomCecos || ''}`.trim(),
      ...cob.map(c => `${c.zona}: ${c.sva[0]} de ${c.sva[1]} SVA i ${c.svb[0]} de ${c.svb[1]} SVB lliures.`),
      pitjor && pitjor.sva[1] ? `Atenció: ${pitjor.zona} és la zona amb menys SVA disponibles.` : null,
      this.config.briefing || null,
    ].filter(Boolean);
  }

  // Everything that happened, in order, for the debriefing
  cronologia() {
    return this.incidents.flatMap(i => i.registre.map(r => ({ ...r, numero: i.numero })))
      .concat(this.missatges.map(m => ({ hora: m.hora, codi: 'O', usuari: m.de.toUpperCase(), text: `Missatge: ${m.text}`, font: m.de, numero: m.numero })))
      .concat(this.moviments.map(m => ({ hora: m.hora, codi: 'R', usuari: m.rol.toUpperCase(), text: `Moviment de cobertura: ${m.unitat} cap a ${m.desti}`, font: 'radio', numero: '' })))
      .sort((a, b) => a.hora.slice(-8).localeCompare(b.hora.slice(-8)));
  }

  // The audience votes the most recent decision that has become available
  actualitzaVotacio() {
    let millor = null;
    for (const inc of this.incidents) {
      for (const rol of ['uct', 'consultor']) {
        for (const d of this.pendents(inc, rol)) {
          const des = inc.desbloquejat[d.pas];
          if (!millor || des > millor.des) millor = { ...d, des, id: `${inc.id}:${d.pas}` };
        }
      }
    }
    this.votacio = millor && { id: millor.id, titol: `Incident ${millor.numero} · ${millor.titol}`, pregunta: millor.pregunta, opcions: millor.opcions, max: 1 };
  }

  // ---------- views ----------

  visible(inc) { return this.config.feedback === 'immediat' || inc.estat === 'tancat'; }

  punts(filtre = () => true) {
    const rs = this.incidents.flatMap(i => i.resultats).concat(this.resultatsGlobals).filter(filtre);
    return { punts: rs.reduce((s, r) => s + PUNTS[r.valoracio], 0), maxim: rs.length * 3 };
  }

  comu() {
    return {
      estat: this.estat, rellotge: this.textHora(), cecos: this.config.nomCecos || '', zones: this.zones, feedback: this.config.feedback,
      rols: this.config.rols,
      punts: this.punts(), puntsRol: Object.fromEntries(['uct', 'consultor', 'cap'].map(r => [r, this.punts(x => x.rol === r)])),
      // Units that are not free at their base: [state, incident, phase, lat, lon, moving]
      unitats: Object.fromEntries(this.unitats.filter(u => u.estat !== 'disponible' || u.moviment || u.ubicacio)
        .map(u => [u.indicatiu, [u.estat, u.incident ?? null, u.fase ?? null, Math.round(u.lat * 1e4) / 1e4, Math.round(u.lon * 1e4) / 1e4, !!u.moviment]])),
      resultatsGlobals: this.estat === 'finalitzada' ? this.resultatsGlobals : [],
      trucadesEnCua: this.trucades.filter(t => t.estat === 'sona').length,
      cobertura: this.cobertura(), missatges: this.missatges,
      briefing: this.estat === 'preparada' || this.real < 20 ? this.briefing() : null,
    };
  }

  vistaIncident(inc, rol) {
    const visible = this.visible(inc);
    return {
      id: inc.id, numero: inc.numero, municipi: inc.municipi, zona: inc.zona, punt: inc.punt, entorn: inc.entorn, pendent: inc.pendent,
      tipus_demanda: inc.cas.tipus_demanda, carta: inc.cas.carta, alertant: inc.cas.alertant, entrada: inc.cas.entrada,
      sexe: inc.cas.pacient.sexe, edat: inc.edat, horaAlerta: this.textHora(inc.horaAlerta), estat: inc.estat,
      senseRecurs: inc.primeraActivacio == null ? Math.round((inc.estat === 'tancat' ? inc.arribada : this.real) - inc.arribada) : null,
      unitats: [...inc.unitats].map(id => {
        const u = this.unitats.find(x => x.indicatiu === id);
        return { indicatiu: id, tipus: u.tipus, fase: u.fase, falta: u.fase === 'ruta' ? Math.max(0, Math.ceil((u.arribaT - this.t) / 60)) : 0 };
      }),
      nivell: inc.decisions.nivell ? Number(inc.decisions.nivell.opcio) : null,
      pendents: rol === 'tutor' ? [] : this.pendents(inc, rol),
      registre: inc.registre, dea: inc.dea,
      finalitzable: rol === 'uct' && inc.estat === 'obert' && inc.trucadaFeta && !inc.unitats.size && !this.pendents(inc, 'uct').length,
      candidates: rol === 'uct' && inc.estat === 'obert' ? this.candidates(inc).slice(0, 12) : [],
      resultats: visible ? inc.resultats : inc.resultats.map(r => ({ pas: r.pas, rol: r.rol, equip: r.equip })),
      desenllac: inc.estat === 'tancat' ? { tipus: inc.desenllac, text: inc.variant.desenllac?.[inc.desenllac], realitat: inc.variant.descripcio,
        nivell: inc.variant.nivell, aprenentatge: inc.cas.aprenentatge } : null,
    };
  }

  vista(rol) {
    const base = this.comu();
    if (rol === 'uct' || rol === 'cap') {
      return { ...base, rol, radio: this.radio, mapaCobertura: this.mapaCobertura(), bases: this.bases, moviments: this.moviments.slice(-10).reverse(),
        incidents: this.incidents.map(i => this.vistaIncident(i, 'uct')).map(i => (rol === 'cap' ? { ...i, pendents: [], candidates: [] } : i)) };
    }
    if (rol === 'consultor') {
      const activa = this.trucadaActiva();
      const inc = activa && this.incidents.find(i => i.id === activa.incident);
      const pas = inc?.cas.passos.find(p => p.tipus === 'retrucada');
      return {
        ...base, rol,
        cua: this.trucades.filter(t => t.estat === 'sona').map(t => {
          const i = this.incidents.find(x => x.id === t.incident);
          return { id: t.id, tipus: t.tipus, resum: t.resum, espera: Math.round(this.real - t.des), limit: ESPERA_ABANDONAMENT, numero: i.numero, municipi: i.municipi, carta: i.cas.carta };
        }),
        activa: activa && {
          id: activa.id, tipus: activa.tipus, incident: this.vistaIncident(inc, 'consultor'), transcript: inc.transcript,
          preguntes: activa.tipus === 'consulta' && pas ? pas.preguntes.map(q => ({ id: q.id, text: q.text, feta: inc.preguntes.includes(q.id) })) : [],
          fitxa: pas ? inc.preguntes.map(id => pas.preguntes.find(q => q.id === id)).filter(q => q?.fitxa)
            .map(q => ({ text: perVariant(q.fitxa, inc.variant.id), alarma: (q.alarma || []).includes(inc.variant.id) })) : [],
          reiteracio: activa.tipus === 'reiteracio' ? REITERACIO : null,
        },
        incidents: this.incidents.map(i => ({ id: i.id, numero: i.numero, municipi: i.municipi, estat: i.estat,
          nivell: i.decisions.nivell ? Number(i.decisions.nivell.opcio) : null, desenllac: i.estat === 'tancat' ? i.desenllac : null,
          resultats: this.visible(i) ? i.resultats.filter(r => r.rol === 'consultor') : [] })),
      };
    }
    if (rol === 'tutor') {
      return {
        ...base, rol, radio: this.radio,
        trucades: this.trucades.filter(t => ['sona', 'activa'].includes(t.estat)).map(t => ({ id: t.id, tipus: t.tipus, estat: t.estat, espera: Math.round(this.real - t.des), incident: t.incident })),
        incidents: this.incidents.map(i => ({
          ...this.vistaIncident(i, 'tutor'), titol: i.cas.titol, tematiques: i.cas.tematiques, variant: i.variant.descripcio, nivellReal: i.variant.nivell,
          resultats: i.resultats, pendentsUct: this.pendents(i, 'uct').map(d => d.titol), pendentsConsultor: this.pendents(i, 'consultor').map(d => d.titol),
          desenllac: i.estat === 'tancat' ? i.desenllac : null, registre: undefined,
        })),
        cronologia: this.estat === 'finalitzada' ? this.cronologia() : null,
        mapaCobertura: this.mapaCobertura(), moviments: this.moviments.slice().reverse(), historicCobertura: this.historicCobertura,
      };
    }
    return base;
  }
}
