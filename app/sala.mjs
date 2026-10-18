// Room screen: runs the case, shows the map and the audience votes, and scores the team's decisions.
import {
  PUNTS, ETIQUETA, COMBOS, CATEGORIA, aleatori, distanciaKm, tempsArribada, enServei, entornDe, triaVariant,
  avaluaDecisio, avaluaNivell, avaluaRetrucada, comboDe, avaluaCombo, avaluaUnitats, majoria, pitjor,
} from './motor.mjs';

const COLOR = { SVAm: '#c62828', SVAi: '#ef6c00', VIR: '#8e24aa', SVB: '#1e66c9', 'SVB-P': '#64a0e8', HELI: '#2e7d32', SLS: '#757575', ECO: '#6d4c41' };
const RADI_UNITATS_KM = 60;
const PROPORCIO_OCUPADES = 0.25;
const ENTORN = { urba: 'Urbà', suburba: 'Suburbà', rural: 'Rural' };
const NIVELLS = [1, 2, 3, 4, 5].map(n => ({ id: String(n), text: `N${n}` }));

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let dades, partida, recompte = {}, votants = 0, mapa, capaUnitats, codiSala;

const api = (ruta, cos) => fetch(`${ruta}?sala=${codiSala}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cos ?? {}),
});

// One room code per screen; kept across reloads so the audience does not need to scan again
async function obreSala() {
  let anterior = '';
  try { anterior = sessionStorage.getItem('gamcecos-sala') || ''; } catch {}
  ({ sala: codiSala } = await fetch(`/api/sala?sala=${anterior}`, { method: 'POST' }).then(r => r.json()));
  try { sessionStorage.setItem('gamcecos-sala', codiSala); } catch {}
  const fonts = new EventSource(`/api/events?sala=${codiSala}`);
  fonts.addEventListener('vots', e => {
    const d = JSON.parse(e.data);
    recompte = d.recompte;
    votants = d.votants;
    if (partida && !partida.tancat && $('pas').querySelector('.opcions')) renderPas();
  });
}

async function carrega() {
  const get = f => fetch(f).then(r => r.json());
  const [unitats, centres, dea, aure, index] = await Promise.all([
    get('/data/unitats.json'), get('/data/centres.json'), get('/data/dea.json'), get('/data/resposta_aure.json'), get('/casos/index.json'),
  ]);
  const casos = await Promise.all(index.map(id => get(`/casos/${id}.json`)));
  dades = { unitats, centres, dea, aure, casos };

  const zones = [...new Set(unitats.map(u => u.subzona || u.regio))].sort();
  $('zona').innerHTML = zones.map(z => `<option>${esc(z)}</option>`).join('');
  $('cas').innerHTML += casos.map(c => `<option value="${c.id}">${esc(c.titol)}</option>`).join('');
  $('comencar').onclick = comenca;
}

function zonaDe(x) { return x.subzona || x.regio; }

function comenca() {
  const rnd = aleatori(Date.now());
  const zona = $('zona').value;
  const [hh, mm] = $('hora').value.split(':').map(Number);
  const hora = hh + mm / 60;
  const cas = dades.casos.find(c => c.id === $('cas').value) || dades.casos[Math.floor(rnd() * dades.casos.length)];
  const variant = triaVariant(cas, rnd);

  // The incident happens near a primary care centre of the zone: that is where people live
  const caps = dades.centres.filter(c => c.tipus === 'CAP' && zonaDe(c) === zona && !/^Consultori/.test(c.nom));
  const cap = caps[Math.floor(rnd() * caps.length)];
  const municipi = cap.municipi || cap.nom.replace(/^(CAP|Consultori local)\s+/, '');
  const punt = { lat: cap.lat + (rnd() - 0.5) * 0.012, lon: cap.lon + (rnd() - 0.5) * 0.012 };
  const { entorn, pendent } = entornDe(zona, municipi, dades.aure.entorn_per_zona);
  const mes = new Date().getMonth();

  const unitats = dades.unitats
    .map(u => ({ ...u, lat: u.base.lat, lon: u.base.lon }))
    .filter(u => CATEGORIA[u.tipus] && distanciaKm(u, punt) <= (u.tipus === 'HELI' ? 200 : RADI_UNITATS_KM))
    .map(u => {
      const estat = !enServei(u.horari, hora, mes) ? 'fora de servei' : rnd() < PROPORCIO_OCUPADES ? 'ocupada' : 'disponible';
      return { ...u, estat, eta: tempsArribada(u.tipus, u, punt, entorn) };
    });
  const perBase = {};
  for (const u of unitats) {
    const k = `${u.lat},${u.lon}`;
    const i = (perBase[k] = (perBase[k] ?? -1) + 1);
    if (i) { u.lat += 0.0012 * Math.cos(i * 2.1); u.lon += 0.0016 * Math.sin(i * 2.1); }
  }
  const deaProper = dades.dea
    .map(d => ({ ...d, dist: Math.round(distanciaKm(d, punt) * 1000) }))
    .filter(d => d.dist <= 400).sort((a, b) => a.dist - b.dist);

  const edat = cas.pacient.edat[0] + Math.floor(rnd() * (cas.pacient.edat[1] - cas.pacient.edat[0] + 1));
  partida = { cas, variant, zona, hora, punt, municipi, entorn, pendent, unitats, deaProper, edat,
    numero: 261800000 + Math.floor(rnd() * 99999), rellotge: 0, pas: 0, resultats: [], tria: new Set(), seleccio: new Set() };

  $('config').hidden = true;
  $('joc').hidden = false;
  $('titol-cas').textContent = cas.titol;
  $('estat-zona').textContent = zona;
  mostraQr();
  mostraIncident();
  iniciaMapa();
  iniciaPas();
}

async function mostraQr() {
  let origen = location.origin;
  if (/^(localhost|127\.)/.test(location.hostname)) {
    const info = await fetch('/api/info').then(r => r.json()).catch(() => ({ urls: [] }));
    origen = info.urls[0] || origen;
  }
  const url = `${origen}/vota?sala=${codiSala}`;
  $('url-vot').textContent = `${origen.replace(/^https?:\/\//, '')}/vota · sala ${codiSala}`;
  $('qr').innerHTML = '';
  if (window.QRCode) new QRCode($('qr'), { text: url, width: 128, height: 128 });
}

function horaText(minuts) {
  const s = Math.round(partida.hora * 3600 + minuts * 60 + 19);
  const p2 = n => String(n).padStart(2, '0');
  const data = new Date().toLocaleDateString('ca', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${data} ${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
}

// Log entry in the incident register, newest first, as in the room software: "date | role | user"
function registre(codi, usuari, text) {
  partida.rellotge += 0.5;
  const meta = [horaText(partida.rellotge), codi, usuari].filter(Boolean).join(' | ');
  $('registre').insertAdjacentHTML('afterbegin',
    `<div class="entrada nova"><div class="meta">${esc(meta)}</div><div class="text">${esc(text)}</div></div>`);
}

function mostraIncident() {
  const p = partida;
  $('incident').innerHTML = `<span class="num">${p.numero}</span><span class="tipus">EMERGÈNCIA</span>
    <div>${esc(p.municipi)}, ${esc(p.zona)} · ${p.punt.lat.toFixed(6)}, ${p.punt.lon.toFixed(6)}</div>`;
  const camps = [
    ['Tipus alertant', p.cas.entrada === 'veu_sanitaria' ? 'Central 112 · veu (VPS)' : 'Central 112 · carta de dades'], ['Alertant', p.cas.alertant],
    ['Hora alerta', horaText(0).slice(0, -3)], ['Tipus de demanda', p.cas.tipus_demanda.toUpperCase()],
    ['Afectat', `${p.cas.pacient.sexe} · ${p.edat} anys (aprox.)`], ['Entorn', ENTORN[p.entorn] + (p.pendent ? ' (pendent de definir)' : '')],
  ];
  $('camps').innerHTML = camps.map(([l, v]) => `<div class="camp"><label>${l}</label><div>${esc(v)}</div></div>`).join('');
  $('registre').innerHTML = '';
  registre('', 'SITREM', p.cas.tipus_demanda);
  registre('T', 'SITREM', p.cas.carta);
  if (p.cas.entrada === 'veu_sanitaria') registre('T', 'SITREM', 'VPS');
}

function iniciaMapa() {
  if (!mapa) {
    mapa = L.map('mapa');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(mapa);
    const llegenda = L.control({ position: 'bottomleft' });
    llegenda.onAdd = () => {
      const d = L.DomUtil.create('div', 'panell llegenda');
      d.innerHTML = Object.entries(COLOR).filter(([t]) => CATEGORIA[t]).map(([t, c]) => `<span style="--c:${c}">${t}</span>`).join('')
        + '<span style="--c:#ffffff;outline:2px solid #0b8f6a;border-radius:50%">DEA</span>';
      return d;
    };
    llegenda.addTo(mapa);
  }
  if (capaUnitats) capaUnitats.remove();
  capaUnitats = L.layerGroup().addTo(mapa);
  const p = partida;
  L.marker([p.punt.lat, p.punt.lon], { title: 'Incident' }).addTo(capaUnitats).bindTooltip('Incident', { permanent: true, direction: 'top' });
  for (const d of p.deaProper) {
    L.circleMarker([d.lat, d.lon], { radius: 4, color: '#0b8f6a', weight: 2, fillColor: '#ffffff', fillOpacity: 1 }).addTo(capaUnitats)
      .bindTooltip(`DEA · ${esc(d.nom)} (${d.dist} m)`);
  }
  pintaUnitats();
  const properes = p.unitats.filter(u => u.estat === 'disponible').sort((a, b) => a.eta - b.eta).slice(0, 8);
  mapa.fitBounds([[p.punt.lat, p.punt.lon], ...properes.map(u => [u.lat, u.lon])], { padding: [40, 40] });
}

function pintaUnitats() {
  capaUnitats.eachLayer(l => l.options.unitat && capaUnitats.removeLayer(l));
  for (const u of partida.unitats) {
    const triada = partida.seleccio.has(u.indicatiu);
    const disponible = u.estat === 'disponible';
    L.circleMarker([u.lat, u.lon], {
      unitat: u.indicatiu, radius: u.tipus === 'HELI' ? 10 : 7,
      color: triada ? '#000' : '#fff', weight: triada ? 4 : 1,
      fillColor: COLOR[u.tipus], fillOpacity: disponible ? 0.95 : 0.2,
    }).addTo(capaUnitats)
      .bindTooltip(`<b>${esc(u.indicatiu)}</b> · ${u.tipus} · ${disponible ? `${u.eta} min` : u.estat}<br>${esc(u.base.nom)}`)
      .on('click', () => commutaUnitat(u));
  }
}

function commutaUnitat(u) {
  const pas = partida.cas.passos[partida.pas];
  if (pas?.tipus !== 'recurs' || partida.tancat || u.estat !== 'disponible') return;
  partida.seleccio.has(u.indicatiu) ? partida.seleccio.delete(u.indicatiu) : partida.seleccio.add(u.indicatiu);
  pintaUnitats();
  renderPas();
}

// Options shown to the team and the audience for the current step
function opcionsDe(pas) {
  if (pas.tipus === 'decisio') return pas.opcions.map(o => ({ id: o.id, text: o.text }));
  if (pas.tipus === 'retrucada') return pas.preguntes.map(q => ({ id: q.id, text: q.text }));
  if (pas.tipus === 'nivell') return NIVELLS;
  if (pas.tipus === 'recurs') return COMBOS;
  return [];
}

function iniciaPas() {
  const pas = partida.cas.passos[partida.pas];
  partida.tria = new Set();
  partida.seleccio = new Set();
  partida.tancat = false;
  recompte = {};
  votants = 0;
  api('/api/pas', { pas: { id: `${partida.cas.id}:${pas.id}`, titol: pas.titol, pregunta: pas.pregunta, opcions: opcionsDe(pas), max: pas.max || 1 } });
  if (mapa) pintaUnitats();
  renderPas();
}

function renderPas() {
  const p = partida, pas = p.cas.passos[p.pas];
  const opcions = opcionsDe(pas);
  const max = Math.max(1, ...Object.values(recompte));
  const resultat = p.tancat ? p.resultats.at(-1) : null;
  let html = `<div class="suau">Pas ${p.pas + 1} de ${p.cas.passos.length} · ${esc(pas.titol)}</div><h2>${esc(pas.pregunta)}</h2>`;

  if (pas.tipus === 'recurs') {
    const triades = p.unitats.filter(u => p.seleccio.has(u.indicatiu));
    const properes = p.unitats.filter(u => u.estat === 'disponible').sort((a, b) => a.eta - b.eta).slice(0, 12);
    html += `<p class="suau">Assigneu unitats des de la llista o clicant-les al mapa. El públic vota la combinació.</p>
      <div class="unitats-llista">${properes.map(u => `<button class="opcio unitat ${p.seleccio.has(u.indicatiu) ? 'triada' : ''}" data-unitat="${esc(u.indicatiu)}" ${p.tancat ? 'disabled' : ''}>
        <span class="punt" style="background:${COLOR[u.tipus]}"></span><b>${esc(u.indicatiu)}</b> ${u.tipus}<span class="nvots">${u.eta} min</span></button>`).join('')}</div>
      <p><b>Assignades:</b> ${triades.map(u => `${esc(u.indicatiu)} (${u.tipus}, ${u.eta} min)`).join(', ') || '<span class="suau">cap</span>'}</p>`;
  }
  html += `<div class="opcions">${opcions.map(o => {
    const n = recompte[o.id] || 0;
    const classe = ['opcio', p.tria.has(o.id) ? 'triada' : '', resultat && pas.tipus === 'recurs' && o.id === resultat.comboEquip ? 'triada' : ''].join(' ');
    const desactiva = p.tancat || pas.tipus === 'recurs' ? 'disabled' : '';
    return `<button class="${classe}" data-id="${o.id}" ${desactiva}><span class="nvots">${n} vots</span>${esc(o.text)}<span class="vots" style="width:${(n / max) * 100}%"></span></button>`;
  }).join('')}</div>
  <div class="suau" style="margin-top:.4rem">${votants === 1 ? '1 persona ha votat' : `${votants} persones han votat`}</div>`;

  if (!p.tancat) {
    const pot = pas.tipus === 'recurs' ? true : p.tria.size > 0;
    html += `<div class="accions"><button class="boto" id="confirma" ${pot ? '' : 'disabled'}>Confirmar decisió de l'equip</button></div>`;
  } else {
    html += `<div class="retroaccio" style="border-color:var(--${resultat.valoracio})">
      <span class="etiqueta v-${resultat.valoracio}">${ETIQUETA[resultat.valoracio]}</span>
      <p>${esc(resultat.feedback)}</p>
      <p class="suau">Equip: ${esc(resultat.equip)} · Públic: ${esc(resultat.public || 'sense vots')}</p></div>
      <div class="accions"><button class="boto" id="seguent">${p.pas + 1 < p.cas.passos.length ? 'Pas següent' : 'Veure resum'}</button></div>`;
  }
  $('pas').innerHTML = html;
  $('pas').querySelectorAll('.opcio[data-id]').forEach(b => b.onclick = () => triaOpcio(b.dataset.id));
  $('pas').querySelectorAll('[data-unitat]').forEach(b => b.onclick = () => commutaUnitat(p.unitats.find(u => u.indicatiu === b.dataset.unitat)));
  $('confirma')?.addEventListener('click', confirma);
  $('seguent')?.addEventListener('click', seguent);
  $('puntuacio').textContent = `Punts: ${p.resultats.reduce((s, r) => s + PUNTS[r.valoracio], 0)} / ${p.resultats.length * 3}`;
}

function triaOpcio(id) {
  const pas = partida.cas.passos[partida.pas];
  const t = partida.tria;
  if ((pas.max || 1) === 1) { t.clear(); t.add(id); }
  else if (t.has(id)) t.delete(id);
  else if (t.size < pas.max) t.add(id);
  renderPas();
}

function textOpcions(pas, ids) {
  const opcions = opcionsDe(pas);
  return ids.map(id => opcions.find(o => o.id === id)?.text).filter(Boolean).join(' · ');
}

function confirma() {
  const p = partida, pas = p.cas.passos[p.pas], v = p.variant.id;
  const triats = [...p.tria];
  let r;
  if (pas.tipus === 'decisio') {
    r = avaluaDecisio(pas, triats[0], v);
    registre('O', 'EQUIP', textOpcions(pas, triats));
    if (pas.mostra_dea && p.variant.nivell === 1) {
      r.feedback += p.deaProper.length
        ? ` DEA més proper: ${p.deaProper[0].nom} a ${p.deaProper[0].dist} m.`
        : ' No hi ha cap DEA registrat a menys de 400 m.';
    }
  } else if (pas.tipus === 'nivell') {
    r = avaluaNivell(pas, triats[0], v);
    registre('L', 'EQUIP', `Triatge avançat: N${triats[0]}`);
  } else if (pas.tipus === 'retrucada') {
    r = avaluaRetrucada(pas, triats);
    for (const q of pas.preguntes.filter(q => triats.includes(q.id))) registre('L', 'EQUIP', `${q.text} // ${q.resposta[v]}`);
  } else if (pas.tipus === 'recurs') {
    r = avaluaRecurs();
  }
  const pub = majoria(recompte);
  const resultat = {
    pas: pas.titol, valoracio: r.valoracio, feedback: r.feedback,
    equip: pas.tipus === 'recurs' ? r.equip : textOpcions(pas, triats),
    public: pub ? textOpcions(pas, [pub]) : null,
    coincideix: pas.tipus === 'recurs' ? pub === r.comboEquip : triats.includes(pub),
    comboEquip: r.comboEquip,
  };
  p.resultats.push(resultat);
  p.tancat = true;
  api('/api/tanca', { resultat: { equip: resultat.equip, valoracio: resultat.valoracio, etiqueta: ETIQUETA[resultat.valoracio], feedback: resultat.feedback } });
  renderPas();
}

function avaluaRecurs() {
  const p = partida;
  const triades = p.unitats.filter(u => p.seleccio.has(u.indicatiu));
  const disponibles = p.unitats.filter(u => u.estat === 'disponible');
  const sva = disponibles.filter(u => CATEGORIA[u.tipus] === 'SVA').map(u => u.eta);
  const combo = comboDe(triades);
  const c = avaluaCombo(combo, p.variant.nivell, p.entorn, sva.length ? Math.min(...sva) : null);
  const u = avaluaUnitats(triades, disponibles);
  for (const t of triades) registre('R', 'RSRSR', `${t.indicatiu} activada · arribada estimada ${t.eta} min`);
  return {
    valoracio: pitjor(c.valoracio, u.valoracio),
    feedback: [c.feedback, u.feedback].filter(Boolean).join(' '),
    comboEquip: combo,
    equip: triades.length ? triades.map(t => `${t.indicatiu} (${t.tipus})`).join(', ') : 'cap recurs',
  };
}

function seguent() {
  partida.pas++;
  if (partida.pas < partida.cas.passos.length) return iniciaPas();
  api('/api/pas', { pas: null });
  resum();
}

function resum() {
  const p = partida;
  const punts = p.resultats.reduce((s, r) => s + PUNTS[r.valoracio], 0);
  const coincidencies = p.resultats.filter(r => r.coincideix).length;
  $('pas').innerHTML = `<h2>Resum del cas</h2>
    <p><b>Què passava:</b> ${esc(p.variant.descripcio)} (nivell real N${p.variant.nivell}).</p>
    <p>Punts de l'equip: <b>${punts} / ${p.resultats.length * 3}</b> · L'equip i el públic han coincidit en ${coincidencies} de ${p.resultats.length} decisions.</p>
    <div class="resum"><table><tr><th>Decisió</th><th>Equip</th><th>Públic</th><th>Valoració</th></tr>
    ${p.resultats.map(r => `<tr><td>${esc(r.pas)}</td><td>${esc(r.equip)}</td><td>${esc(r.public || '—')}</td>
      <td><span class="etiqueta v-${r.valoracio}">${ETIQUETA[r.valoracio]}</span></td></tr>`).join('')}</table></div>
    <h3 style="margin-top:1rem">Aprenentatges</h3><ul>${p.cas.aprenentatge.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
    <div class="accions"><button class="boto" id="nova">Nova partida</button></div>`;
  $('nova').onclick = () => location.reload();
}

obreSala().then(carrega);
