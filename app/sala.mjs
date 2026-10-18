// Team screen: runs the shift. Incidents arrive on a clock, the team works them in parallel (consultor and
// coordination on the decisions, resource manager on the map) and every decision is scored.
import {
  PUNTS, ETIQUETA, CATEGORIA, ROLS, aleatori, distanciaKm, tempsArribada, enServei, entornDe, triaVariant, baralla, rolDe,
  avaluaDecisio, avaluaNivell, avaluaRetrucada, comboDe, avaluaCombo, avaluaUnitats, avaluaActivacio, desenllac, majoria, pitjor,
} from './motor.mjs';

const COLOR = { SVAm: '#c62828', SVAi: '#ef6c00', VIR: '#8e24aa', SVB: '#1e66c9', 'SVB-P': '#64a0e8', HELI: '#2e7d32' };
const ENTORN = { urba: 'Urbà', suburba: 'Suburbà', rural: 'Rural' };
const NIVELLS = [1, 2, 3, 4, 5].map(n => ({ id: String(n), text: `N${n}` }));
const RADI_KM = 60;
const MINUTS_ASSISTENCIA = 35;   // simulated minutes a unit stays busy on scene, transport and transfer

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rnd = aleatori(Date.now());

let codiSala, config, dades, joc = null, recompte = {}, votants = 0, classificacio = [], mapa, capa, audio;

const api = (ruta, cos) => fetch(`${ruta}?sala=${codiSala}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cos ?? {}),
});

// ---------- Entry ----------

const parametre = new URLSearchParams(location.search).get('sala');
if (parametre) $('entrada').sala.value = parametre.toUpperCase();
$('entrada').onsubmit = async e => {
  e.preventDefault();
  audio = new AudioContext();   // unlocked by this click, used for the incoming call ring
  codiSala = $('entrada').sala.value.trim().toUpperCase();
  const r = await fetch(`/api/config?sala=${codiSala}`);
  if (!r.ok) { $('error-entrada').textContent = r.status === 404 ? 'No existeix cap guàrdia amb aquest codi.' : 'Cal entrar amb la contrasenya.'; return; }
  ({ config } = await r.json());
  history.replaceState(null, '', `?sala=${codiSala}`);
  await carrega();
  $('entrada').hidden = true;
  $('joc').hidden = false;
  $('cecos').textContent = config.nomCecos || '';
  mostraQr();
  iniciaMapa();
  escolta();
};

async function carrega() {
  const get = f => fetch(f).then(r => r.json());
  const [unitats, centres, dea, aure, index] = await Promise.all([
    get('/data/unitats.json'), get('/data/centres.json'), get('/data/dea.json'), get('/data/resposta_aure.json'), get('/casos/index.json'),
  ]);
  const casos = await Promise.all(index.map(id => get(`/casos/${id}.json`)));
  dades = { unitats, centres, dea, aure, casos };
}

function escolta() {
  const fonts = new EventSource(`/api/events?sala=${codiSala}&rol=sala`);
  fonts.addEventListener('vots', e => {
    ({ recompte, votants } = JSON.parse(e.data));
    const inc = actiu();
    if (inc && !inc.pasTancat && !joc.finalitzat) renderPas();
  });
  fonts.addEventListener('classificacio', e => { classificacio = JSON.parse(e.data); });
  fonts.addEventListener('ordre', e => ordre(JSON.parse(e.data)));
}

async function mostraQr() {
  let origen = location.origin;
  if (/^(localhost|127\.)/.test(location.hostname)) {
    const info = await fetch('/api/info').then(r => r.json()).catch(() => ({ urls: [] }));
    origen = info.urls[0] || origen;
  }
  $('url-vot').textContent = `${origen.replace(/^https?:\/\//, '')}/vota · codi ${codiSala}`;
  $('qr').innerHTML = '';
  if (window.QRCode) new QRCode($('qr'), { text: `${origen}/vota?sala=${codiSala}`, width: 128, height: 128 });
}

// ---------- Shift clock ----------

function iniciaGuardia() {
  if (joc) return;
  const [hh, mm] = (config.hora || '19:50').split(':').map(Number);
  const zones = config.zones?.length ? config.zones : [...new Set(dades.unitats.map(u => u.subzona || u.regio))];
  const unitats = dades.unitats.map(u => ({ ...u, lat: u.base.lat, lon: u.base.lon }));
  separaBases(unitats);
  joc = {
    inici: Date.now(), pausa: null, pausat: 0, horaInici: hh + mm / 60, factor: config.factor || 3,
    zones, unitats, incidents: [], seleccionat: null, baralla: [], seguentArribada: Date.now() + 3000,
    finalitzat: false,
  };
  // Units already busy with other services when the shift starts
  for (const u of unitats) {
    if (!enServei(u.horari, horaSim(), mesActual())) u.estat = 'fora de servei';
    else if (rnd() < (config.ocupacio ?? 0.25)) { u.estat = 'ocupada'; u.fins = Date.now() + (2 + rnd() * 10) * 60000; }
    else u.estat = 'disponible';
  }
  $('cua').innerHTML = '';
  setInterval(tic, 1000);
  tic();
}

const mesActual = () => new Date().getMonth();
function ara() { return (joc.pausa ?? Date.now()) - joc.pausat; }
function segonsReals() { return Math.floor((ara() - joc.inici) / 1000); }
function horaSim() {
  if (!joc) return 0;
  return (joc.horaInici + (segonsReals() * joc.factor) / 3600) % 24;
}
function textHora(h = horaSim(), ambSegons = false) {
  const s = Math.floor(h * 3600);
  const p2 = n => String(n).padStart(2, '0');
  return `${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}${ambSegons ? ':' + p2(s % 60) : ''}`;
}

function tic() {
  if (!joc || joc.pausa) return;
  $('rellotge').textContent = textHora(horaSim(), true);
  const ms = Date.now();
  for (const u of joc.unitats) {
    if (u.estat === 'ocupada' && u.fins <= ms) {
      u.estat = enServei(u.horari, horaSim(), mesActual()) ? 'disponible' : 'fora de servei';
      if (u.estat === 'disponible' && u.incidentTancat) registre(u.incidentTancat, 'R', 'RSRSR', `${u.indicatiu} 3.6 DISPONIBLE`);
      u.incidentTancat = null;
    }
  }
  const automatics = joc.incidents.filter(i => !i.manual).length;
  if (!joc.finalitzat && automatics < (config.incidents || 6) && ms >= joc.seguentArribada) {
    nouIncident();
    joc.seguentArribada = ms + (config.ritme || 150) * 1000 * (0.7 + rnd() * 0.6);
  }
  renderCua();
  renderGestor();
  renderDisponibles();
  enviaEstat();
}

function separaBases(unitats) {
  const perBase = {};
  for (const u of unitats) {
    const k = `${u.lat},${u.lon}`;
    const i = (perBase[k] = (perBase[k] ?? -1) + 1);
    if (i) { u.lat += 0.0012 * Math.cos(i * 2.1); u.lon += 0.0016 * Math.sin(i * 2.1); }
  }
}

// ---------- Incidents ----------

function nouIncident({ tematica, casId, manual = false } = {}) {
  let cas = dades.casos.find(c => c.id === casId);
  if (!cas && tematica) cas = baralla(dades.casos, [tematica], rnd)[0];
  if (!cas) {
    if (!joc.baralla.length) joc.baralla = baralla(dades.casos, config.tematiques, rnd);
    cas = joc.baralla.pop();
  }
  const variant = triaVariant(cas, rnd);
  const zona = joc.zones[Math.floor(rnd() * joc.zones.length)];
  const caps = dades.centres.filter(c => c.tipus === 'CAP' && (c.subzona || c.regio) === zona && !/^Consultori/.test(c.nom));
  const cap = caps[Math.floor(rnd() * caps.length)];
  const municipi = cap.municipi || cap.nom.replace(/^(CAP|Consultori local)\s+/, '');
  const punt = { lat: cap.lat + (rnd() - 0.5) * 0.012, lon: cap.lon + (rnd() - 0.5) * 0.012 };
  const { entorn, pendent } = entornDe(zona, municipi, dades.aure.entorn_per_zona);
  const inc = {
    id: joc.incidents.length + 1, numero: 261800000 + Math.floor(rnd() * 99999), cas, variant, zona, municipi, punt, entorn, pendent,
    edat: cas.pacient.edat[0] + Math.floor(rnd() * (cas.pacient.edat[1] - cas.pacient.edat[0] + 1)),
    arribada: ara(), horaAlerta: horaSim(), pas: 0, tria: new Set(), pasTancat: false, resultats: [], unitats: new Set(),
    primeraActivacio: null, registre: [], estat: 'pendent', manual,
    dea: dades.dea.map(d => ({ ...d, dist: Math.round(distanciaKm(d, punt) * 1000) })).filter(d => d.dist <= 400).sort((a, b) => a.dist - b.dist),
  };
  joc.incidents.push(inc);
  registre(inc, '', 'SITREM', cas.tipus_demanda);
  registre(inc, 'T', 'SITREM', cas.carta);
  if (cas.entrada === 'veu_sanitaria') registre(inc, 'T', 'SITREM', 'VPS');
  sona();
  if (!joc.seleccionat) selecciona(inc.id);
  else renderCua();
}

function actiu() { return joc?.incidents.find(i => i.id === joc.seleccionat); }

function registre(inc, codi, usuari, text) {
  inc.registre.unshift({ meta: [`${new Date().toLocaleDateString('ca')} ${textHora(horaSim(), true)}`, codi, usuari].filter(Boolean).join(' | '), text });
  if (inc.id === joc.seleccionat) renderRegistre();
}

function selecciona(id) {
  if (joc.finalitzat) return;
  joc.seleccionat = id;
  const inc = actiu();
  if (inc.estat === 'pendent') inc.estat = 'obert';
  renderCua();
  renderIncident();
  renderRegistre();
  pintaMapa(true);
  renderGestor();
  if (inc.estat !== 'tancat') obreVotacio();
  else renderPas();
}

function sona() {
  if (!audio) return;
  const t = audio.currentTime;
  for (let i = 0; i < 2; i++) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880 - i * 220;
    g.gain.setValueAtTime(0.0001, t + i * 0.35);
    g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.35 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.35 + 0.3);
    o.connect(g).connect(audio.destination);
    o.start(t + i * 0.35);
    o.stop(t + i * 0.35 + 0.32);
  }
}

// ---------- Rendering ----------

function segonsSenseRecurs(inc) {
  const fi = inc.primeraActivacio ?? (inc.estat === 'tancat' ? inc.tancament : ara());
  return Math.floor((fi - inc.arribada) / 1000);
}

function renderCua() {
  if (!joc) return;
  $('comptador').textContent = `(${joc.incidents.filter(i => i.estat !== 'tancat').length} oberts)`;
  $('cua').innerHTML = [...joc.incidents].reverse().map(inc => {
    const s = segonsSenseRecurs(inc);
    const alerta = inc.estat !== 'tancat' && !inc.primeraActivacio && s > 60;
    const estat = inc.estat === 'tancat'
      ? `<span class="etiqueta v-${inc.desenllac === 'bo' ? 'optima' : 'perillosa'}">${inc.desenllac === 'bo' ? 'Resolt' : 'Mal desenllaç'}</span>`
      : inc.primeraActivacio ? `<span class="suau">${inc.unitats.size} unitats</span>` : `<span class="${alerta ? 'parpelleja' : 'suau'}">sense recurs ${s} s</span>`;
    return `<button class="incident-fila ${inc.id === joc.seleccionat ? 'seleccionat' : ''} ${inc.estat === 'pendent' ? 'nou' : ''}" data-inc="${inc.id}">
      <span><span class="num">${inc.numero}</span> EMERGÈNCIA</span>${estat}
      <span class="adreca">${esc(inc.municipi)} · ${esc(inc.cas.tipus_demanda)}</span></button>`;
  }).join('') || '<p class="suau">Encara no ha entrat cap incident.</p>';
  $('cua').querySelectorAll('[data-inc]').forEach(b => b.onclick = () => selecciona(Number(b.dataset.inc)));
}

function renderRegistre() {
  const inc = actiu();
  $('registre').innerHTML = (inc?.registre || []).map(r =>
    `<div class="entrada"><div class="meta">${esc(r.meta)}</div><div class="text">${esc(r.text)}</div></div>`).join('');
}

function renderIncident() {
  const inc = actiu();
  if (!inc) return;
  const camps = [
    ['Tipus alertant', inc.cas.entrada === 'veu_sanitaria' ? 'Central 112 · veu (VPS)' : 'Central 112 · carta de dades'],
    ['Alertant', inc.cas.alertant], ['Hora alerta', textHora(inc.horaAlerta, true)], ['Tipus de demanda', inc.cas.tipus_demanda.toUpperCase()],
    ['Afectat', `${inc.cas.pacient.sexe} · ${inc.edat} anys (aprox.)`], ['Entorn', ENTORN[inc.entorn] + (inc.pendent ? ' (pendent)' : '')],
  ];
  $('incident').innerHTML = `<div class="incident"><span class="num">${inc.numero}</span><span class="tipus">EMERGÈNCIA</span>
    <div>${esc(inc.municipi)}, ${esc(inc.zona)}</div></div>
    <div class="camps">${camps.map(([l, v]) => `<div class="camp"><label>${l}</label><div>${esc(v)}</div></div>`).join('')}</div>`;
}

function opcionsDe(pas) {
  if (pas.tipus === 'decisio') return pas.opcions.map(o => ({ id: o.id, text: o.text }));
  if (pas.tipus === 'retrucada') return pas.preguntes.map(q => ({ id: q.id, text: q.text }));
  if (pas.tipus === 'nivell') return NIVELLS;
  return [];
}

function obreVotacio() {
  const inc = actiu();
  const pas = inc.cas.passos[inc.pas];
  recompte = {}; votants = 0;
  if (pas && !inc.pasTancat) {
    api('/api/pas', { pas: { id: `${inc.id}:${pas.id}`, titol: `Incident ${inc.numero} · ${pas.titol}`, pregunta: pas.pregunta, opcions: opcionsDe(pas), max: pas.max || 1 } });
  }
  renderPas();
}

function renderPas() {
  const inc = actiu();
  if (!inc) return;
  if (inc.estat === 'tancat') return renderTancament(inc);
  const pas = inc.cas.passos[inc.pas];
  if (!pas) {
    $('pas').innerHTML = `<h2>Totes les decisions preses</h2>
      <p class="suau">Quan el gestor tingui les unitats definitives assignades, tanqueu l'incident per veure què li passa al pacient.</p>
      <div class="accions"><button class="boto" id="tanca-inc">Tancar incident</button></div>`;
    $('tanca-inc').onclick = () => tancaIncident(inc);
    return;
  }
  const rol = rolDe(pas);
  const opcions = opcionsDe(pas);
  const max = Math.max(1, ...Object.values(recompte));
  const resultat = inc.pasTancat ? inc.resultats.at(-1) : null;
  let html = `<div class="cap-pas"><span class="rol rol-${rol}">${ROLS[rol]}</span><span class="suau">Decisió ${inc.pas + 1} de ${inc.cas.passos.length}</span></div>
    <h2>${esc(pas.pregunta)}</h2>${pas.max > 1 ? `<p class="suau">Trieu fins a ${pas.max}.</p>` : ''}
    <div class="opcions">${opcions.map(o => {
      const n = recompte[o.id] || 0;
      return `<button class="opcio ${inc.tria.has(o.id) ? 'triada' : ''}" data-id="${o.id}" ${inc.pasTancat ? 'disabled' : ''}>
        <span class="nvots">${n}</span>${esc(o.text)}<span class="vots" style="width:${(n / max) * 100}%"></span></button>`;
    }).join('')}</div>
    <div class="suau" style="margin-top:.4rem">${votants === 1 ? '1 vot del públic' : `${votants} vots del públic`}</div>`;
  if (!inc.pasTancat) {
    html += `<div class="accions"><button class="boto" id="confirma" ${inc.tria.size ? '' : 'disabled'}>Confirmar (${ROLS[rol]})</button></div>`;
  } else {
    html += `<div class="retroaccio" style="border-color:var(--${resultat.valoracio})">
      <span class="etiqueta v-${resultat.valoracio}">${ETIQUETA[resultat.valoracio]}</span> <p>${esc(resultat.feedback)}</p>
      <p class="suau">Públic: ${esc(resultat.public || 'sense vots')}</p></div>
      <div class="accions"><button class="boto" id="seguent">Següent</button></div>`;
  }
  $('pas').innerHTML = html;
  $('pas').querySelectorAll('.opcio[data-id]').forEach(b => b.onclick = () => {
    const t = inc.tria, id = b.dataset.id;
    if ((pas.max || 1) === 1) { t.clear(); t.add(id); } else if (t.has(id)) t.delete(id); else if (t.size < pas.max) t.add(id);
    renderPas();
  });
  $('confirma')?.addEventListener('click', () => confirma(inc));
  $('seguent')?.addEventListener('click', () => { inc.pas++; inc.pasTancat = false; inc.tria = new Set(); obreVotacio(); });
  renderPunts();
}

function textOpcions(pas, ids) {
  const opcions = opcionsDe(pas);
  return ids.map(id => opcions.find(o => o.id === id)?.text).filter(Boolean).join(' · ');
}

function confirma(inc) {
  const pas = inc.cas.passos[inc.pas], v = inc.variant.id, triats = [...inc.tria];
  let r, valoracions = {};
  if (pas.tipus === 'decisio') {
    r = avaluaDecisio(pas, triats[0], v);
    if (pas.mostra_dea && inc.variant.nivell === 1) {
      r.feedback += inc.dea.length ? ` DEA més proper: ${inc.dea[0].nom} a ${inc.dea[0].dist} m.` : ' No hi ha cap DEA registrat a menys de 400 m.';
    }
    for (const o of pas.opcions) valoracions[o.id] = avaluaDecisio(pas, o.id, v).valoracio;
    registre(inc, 'O', 'EQUIP', textOpcions(pas, triats));
  } else if (pas.tipus === 'nivell') {
    r = avaluaNivell(pas, triats[0], v);
    for (const n of NIVELLS) valoracions[n.id] = avaluaNivell(pas, n.id, v).valoracio;
    registre(inc, 'L', 'EQUIP', `Triatge avançat: N${triats[0]}`);
  } else if (pas.tipus === 'retrucada') {
    r = avaluaRetrucada(pas, triats);
    for (const q of pas.preguntes) valoracions[q.id] = q.clau ? 'optima' : 'suboptima';
    for (const q of pas.preguntes.filter(q => triats.includes(q.id))) registre(inc, 'L', 'EQUIP', `${q.text} // ${q.resposta[v]}`);
  }
  const pub = majoria(recompte);
  inc.resultats.push({ pas: pas.titol, rol: rolDe(pas), valoracio: r.valoracio, feedback: r.feedback, equip: textOpcions(pas, triats),
    public: pub ? textOpcions(pas, [pub]) : null, coincideix: triats.includes(pub) });
  inc.pasTancat = true;
  api('/api/tanca', { valoracions, resultat: { equip: textOpcions(pas, triats), valoracio: r.valoracio, etiqueta: ETIQUETA[r.valoracio], feedback: r.feedback } });
  renderPas();
}

function tancaIncident(inc) {
  const assignades = joc.unitats.filter(u => inc.unitats.has(u.indicatiu)).map(u => ({ ...u, eta: tempsArribada(u.tipus, u, inc.punt, inc.entorn) }));
  const disponibles = candidates(inc);
  const sva = disponibles.filter(u => CATEGORIA[u.tipus] === 'SVA').map(u => u.eta);
  const combo = avaluaCombo(comboDe(assignades), inc.variant.nivell, inc.entorn, sva.length ? Math.min(...sva) : null);
  const unitats = avaluaUnitats(assignades, [...disponibles, ...assignades]);
  const temps = avaluaActivacio(inc.variant.nivell, inc.primeraActivacio ? Math.round((inc.primeraActivacio - inc.arribada) / 1000) : null);
  inc.resultats.push({ pas: 'Recursos', tipus: 'recursos', rol: 'gestor', valoracio: pitjor(combo.valoracio, unitats.valoracio), feedback: [combo.feedback, unitats.feedback].filter(Boolean).join(' '),
    equip: assignades.map(u => u.indicatiu).join(', ') || 'cap', public: null });
  inc.resultats.push({ pas: "Temps d'activació", tipus: 'temps', rol: 'gestor', valoracio: temps.valoracio, feedback: temps.feedback || 'No era temps-depenent.', equip: '', public: null });
  inc.desenllac = desenllac(inc.resultats, inc.variant.nivell, inc.variant.desenllac.criteri);
  inc.estat = 'tancat';
  inc.tancament = ara();
  // Units stay busy with the patient for a while (simulated minutes scaled to real time)
  for (const a of assignades) {
    const u = joc.unitats.find(x => x.indicatiu === a.indicatiu);
    u.eta = a.eta;
    u.estat = 'ocupada';
    u.fins = Date.now() + ((u.eta + MINUTS_ASSISTENCIA) * 60000) / joc.factor;
    u.incidentTancat = inc;
  }
  registre(inc, 'R', 'RSRSR', inc.desenllac === 'bo' ? 'INCIDENT FINALITZAT' : 'INCIDENT FINALITZAT AMB INCIDÈNCIES');
  api('/api/pas', { pas: null });
  renderTancament(inc);
  renderCua();
  pintaMapa();
}

function renderTancament(inc) {
  const punts = inc.resultats.reduce((s, r) => s + PUNTS[r.valoracio], 0);
  $('pas').innerHTML = `<h2>${inc.desenllac === 'bo' ? 'Desenllaç favorable' : 'Desenllaç desfavorable'}</h2>
    <p class="desenllac ${inc.desenllac}">${esc(inc.variant.desenllac[inc.desenllac])}</p>
    <p class="suau">Què passava: ${esc(inc.variant.descripcio)} · nivell real N${inc.variant.nivell} · ${punts} / ${inc.resultats.length * 3} punts</p>
    <div class="resum"><table><tr><th>Decisió</th><th>Equip</th><th>Valoració</th></tr>
    ${inc.resultats.map(r => `<tr><td>${esc(r.pas)}<br><span class="suau">${ROLS[r.rol]}</span></td><td>${esc(r.equip)}</td>
      <td><span class="etiqueta v-${r.valoracio}">${ETIQUETA[r.valoracio]}</span><br><span class="suau">${esc(r.feedback)}</span></td></tr>`).join('')}</table></div>
    <h3 style="margin-top:.8rem">Aprenentatges</h3><ul>${inc.cas.aprenentatge.map(a => `<li>${esc(a)}</li>`).join('')}</ul>`;
  renderPunts();
}

function renderPunts() {
  if (!joc) return;
  const tots = joc.incidents.flatMap(i => i.resultats);
  $('puntuacio').textContent = `Punts: ${tots.reduce((s, r) => s + PUNTS[r.valoracio], 0)} / ${tots.length * 3}`;
}

function renderDisponibles() {
  const disp = joc.unitats.filter(u => u.estat === 'disponible' && joc.zones.includes(u.subzona || u.regio));
  const n = cat => disp.filter(u => CATEGORIA[u.tipus] === cat).length;
  $('disponibles').textContent = `Disponibles a la zona: ${n('SVA')} SVA · ${n('SVB')} SVB`;
}

// ---------- Resource manager (map + unit list) ----------

function candidates(inc) {
  return joc.unitats
    .filter(u => u.estat === 'disponible' && CATEGORIA[u.tipus] && distanciaKm(u, inc.punt) <= (u.tipus === 'HELI' ? 200 : RADI_KM))
    .map(u => ({ ...u, eta: tempsArribada(u.tipus, u, inc.punt, inc.entorn) }));
}

function renderGestor() {
  const inc = actiu();
  if (!inc) { $('gestor').innerHTML = ''; return; }
  const assignades = joc.unitats.filter(u => inc.unitats.has(u.indicatiu));
  const s = segonsSenseRecurs(inc);
  const obert = inc.estat !== 'tancat';
  const properes = obert ? candidates(inc).sort((a, b) => a.eta - b.eta).slice(0, 10) : [];
  const clau = JSON.stringify([obert, [...inc.unitats], properes.map(u => u.indicatiu + u.eta)]);
  const temps = obert && !inc.primeraActivacio ? `<span class="${s > 60 ? 'parpelleja' : ''}">Sense recurs: ${s} s</span>` : '';
  if ($('gestor').dataset.clau === clau) { $('temps-recurs') && ($('temps-recurs').innerHTML = temps); return; }
  $('gestor').dataset.clau = clau;
  $('gestor').innerHTML = `<div class="cap-pas"><span class="rol rol-gestor">${ROLS.gestor}</span><span id="temps-recurs">${temps}</span></div>
    <p><b>Assignades:</b> ${assignades.map(u => `<button class="unitat-assignada" data-treu="${esc(u.indicatiu)}" ${obert ? '' : 'disabled'}>
      <span class="punt" style="background:${COLOR[u.tipus]}"></span>${esc(u.indicatiu)} ${u.tipus}${obert ? ' ✕' : ''}</button>`).join(' ') || '<span class="suau">cap</span>'}</p>
    ${obert ? `<div class="unitats-llista">${properes.map(u => `<button class="opcio unitat" data-unitat="${esc(u.indicatiu)}">
      <span class="punt" style="background:${COLOR[u.tipus]}"></span><b>${esc(u.indicatiu)}</b> ${u.tipus}<span class="nvots">${u.eta} min</span></button>`).join('')}</div>` : ''}`;
  $('gestor').querySelectorAll('[data-unitat]').forEach(b => b.onclick = () => assigna(inc, b.dataset.unitat));
  $('gestor').querySelectorAll('[data-treu]').forEach(b => b.onclick = () => allibera(inc, b.dataset.treu));
}

function assigna(inc, indicatiu) {
  const u = joc.unitats.find(x => x.indicatiu === indicatiu);
  if (!u || u.estat !== 'disponible' || inc.estat === 'tancat') return;
  u.estat = 'assignada';
  u.incident = inc.id;
  inc.unitats.add(indicatiu);
  inc.primeraActivacio ??= ara();
  registre(inc, 'R', 'RSRSR', `${indicatiu} ACTIVADA · ARRIBADA ESTIMADA ${tempsArribada(u.tipus, u, inc.punt, inc.entorn)} MIN`);
  renderGestor();
  renderCua();
  pintaMapa();
}

function allibera(inc, indicatiu) {
  const u = joc.unitats.find(x => x.indicatiu === indicatiu);
  if (!u || inc.estat === 'tancat') return;
  u.estat = 'disponible';
  u.incident = null;
  inc.unitats.delete(indicatiu);
  registre(inc, 'R', 'RSRSR', `${indicatiu} DESACTIVADA`);
  renderGestor();
  pintaMapa();
}

function iniciaMapa() {
  mapa = L.map('mapa');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(mapa);
  capa = L.layerGroup().addTo(mapa);
  mapa.setView([41.7, 1.8], 8);
}

function pintaMapa(centra = false) {
  const inc = actiu();
  if (!mapa || !inc) return;
  capa.clearLayers();
  for (const altre of joc.incidents.filter(i => i.estat !== 'tancat')) {
    L.circleMarker([altre.punt.lat, altre.punt.lon], { radius: altre.id === inc.id ? 11 : 7, color: '#d93636', weight: 3, fillOpacity: altre.id === inc.id ? 0.6 : 0.2 })
      .addTo(capa).bindTooltip(`${altre.numero} · ${esc(altre.municipi)}`, { permanent: altre.id === inc.id, direction: 'top' })
      .on('click', () => selecciona(altre.id));
  }
  for (const d of inc.dea) {
    L.circleMarker([d.lat, d.lon], { radius: 4, color: '#0b8f6a', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(capa).bindTooltip(`DEA · ${esc(d.nom)} (${d.dist} m)`);
  }
  for (const u of joc.unitats) {
    if (!CATEGORIA[u.tipus] || distanciaKm(u, inc.punt) > RADI_KM) continue;
    const meva = inc.unitats.has(u.indicatiu);
    const disponible = u.estat === 'disponible';
    L.circleMarker([u.lat, u.lon], {
      radius: u.tipus === 'HELI' ? 10 : 7, color: meva ? '#000' : '#fff', weight: meva ? 4 : 1,
      fillColor: COLOR[u.tipus], fillOpacity: disponible || meva ? 0.95 : 0.2,
    }).addTo(capa).bindTooltip(`<b>${esc(u.indicatiu)}</b> · ${u.tipus} · ${disponible ? `${tempsArribada(u.tipus, u, inc.punt, inc.entorn)} min` : u.estat}`)
      .on('click', () => (meva ? allibera(inc, u.indicatiu) : assigna(inc, u.indicatiu)));
  }
  if (centra) {
    const properes = candidates(inc).sort((a, b) => a.eta - b.eta).slice(0, 6);
    mapa.fitBounds([[inc.punt.lat, inc.punt.lon], ...properes.map(u => [u.lat, u.lon])], { padding: [30, 30], maxZoom: 13 });
  }
}

// ---------- Tutor orders and live state ----------

function ordre(o) {
  if (!o) return;
  if (o.tipus === 'inicia') return iniciaGuardia();
  if (!joc) return;
  if (o.tipus === 'pausa' && !joc.pausa) { joc.pausa = Date.now(); $('pausa').hidden = false; }
  if (o.tipus === 'repren' && joc.pausa) { joc.pausat += Date.now() - joc.pausa; joc.pausa = null; $('pausa').hidden = true; }
  if (o.tipus === 'incident') nouIncident({ tematica: o.tematica, casId: o.cas, manual: true });
  if (o.tipus === 'missatge') {
    const inc = joc.incidents.find(i => i.id === Number(o.incident)) || actiu();
    if (inc) { registre(inc, o.codi || 'T', o.codi === 'R' ? 'RSRSR' : 'SITREM', o.text); sona(); }
  }
  if (o.tipus === 'avaria') {
    const inc = actiu();
    const u = joc.unitats.find(x => inc?.unitats.has(x.indicatiu)) || (inc && candidates(inc).sort((a, b) => a.eta - b.eta)[0]);
    if (u) {
      const real = joc.unitats.find(x => x.indicatiu === u.indicatiu);
      if (inc.unitats.delete(real.indicatiu)) registre(inc, 'R', 'RSRSR', `${real.indicatiu} AVARIA MECÀNICA · NO OPERATIVA`);
      real.estat = 'avariada';
      sona();
    }
  }
  if (o.tipus === 'pic') {
    for (const u of joc.unitats) if (u.estat === 'disponible' && rnd() < 0.3) { u.estat = 'ocupada'; u.fins = Date.now() + (5 + rnd() * 10) * 60000; }
  }
  if (o.tipus === 'final') finalitza();
  renderGestor();
  pintaMapa();
  tic();
  enviaEstat(true);
}

function finalitza() {
  joc.finalitzat = true;
  const tots = joc.incidents.flatMap(i => i.resultats);
  const bons = joc.incidents.filter(i => i.desenllac === 'bo').length;
  const tancats = joc.incidents.filter(i => i.estat === 'tancat').length;
  $('pas').innerHTML = `<h2>Fi de la guàrdia</h2>
    <p><b>${tots.reduce((s, r) => s + PUNTS[r.valoracio], 0)} / ${tots.length * 3}</b> punts · ${bons} de ${tancats} pacients amb desenllaç favorable.</p>
    ${Object.entries(ROLS).map(([id, nom]) => {
      const rs = tots.filter(r => r.rol === id);
      return `<p>${nom}: ${rs.reduce((s, r) => s + PUNTS[r.valoracio], 0)} / ${rs.length * 3}</p>`;
    }).join('')}
    <h3>Classificació del públic</h3><ol>${classificacio.map(c => `<li>${esc(c.nom)} · ${c.punts}</li>`).join('') || '<li class="suau">Sense vots</li>'}</ol>`;
  api('/api/pas', { pas: null });
}

let ultimEstat = '', ultimEnviament = 0;
function enviaEstat(ara = false) {
  const estat = {
    rellotge: textHora(horaSim()), pausat: !!joc.pausa, finalitzat: joc.finalitzat,
    punts: joc.incidents.flatMap(i => i.resultats).reduce((s, r) => s + PUNTS[r.valoracio], 0),
    maxim: joc.incidents.flatMap(i => i.resultats).length * 3,
    incidents: joc.incidents.map(i => ({
      id: i.id, numero: i.numero, titol: i.cas.titol, tematiques: i.cas.tematiques, variant: i.variant.descripcio, nivell: i.variant.nivell,
      municipi: i.municipi, zona: i.zona, estat: i.estat, pas: i.cas.passos[i.pas]?.titol || null, segons: segonsSenseRecurs(i),
      unitats: [...i.unitats], desenllac: i.desenllac || null,
      resultats: i.resultats.map(r => ({ pas: r.pas, rol: r.rol, valoracio: r.valoracio, equip: r.equip, public: r.public })),
    })),
  };
  const text = JSON.stringify(estat);
  if (text !== ultimEstat && (ara || Date.now() - ultimEnviament > 3000)) {
    ultimEstat = text;
    ultimEnviament = Date.now();
    api('/api/estat', { estat });
  }
}
