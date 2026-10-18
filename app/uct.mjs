// UCT screen (auxiliar and coordinator): incident tray, unit activation on the map, radio and room communication.
import { $, esc, so, connecta, accio as envia, entrada, resultatsHtml, desenllacHtml, coberturaHtml, missatgesHtml, registreHtml, briefingHtml } from './client.mjs';
import { distanciaKm, SERVEIS, CATEGORIA } from './motor.mjs';
import { COLOR, carregaUnitats, estatUnitat, nouMapa, pintaCobertura, pintaUnitats, panellMoviments } from './territori.mjs';
const ESTAT_UNITAT = { ruta: 'en ruta', lloc: 'al lloc' };
const ENTORN = { urba: 'urbà', suburba: 'suburbà', rural: 'rural' };
let resumTancat = false;
let codi, vista, seleccionat = null, unitats = [], mapa, capa, vistos = new Set(), radioVista = 0, centrat = null;
const accio = a => envia(codi, 'uct', a);

entrada($('entrada'), async (c, config) => {
  codi = c;
  unitats = await carregaUnitats();
  $('joc').hidden = false;
  $('cecos').textContent = config.nomCecos || '';
  mapa = nouMapa('mapa');
  capa = L.layerGroup().addTo(mapa);
  $('veure-cobertura').onchange = pintaMapa;
  const origen = /^(localhost|127\.)/.test(location.hostname) ? ((await fetch('/api/info').then(r => r.json())).urls[0] || location.origin) : location.origin;
  $('url-vot').innerHTML = `Públic: ${esc(origen.replace(/^https?:\/\//, ''))}/vota<br>codi <b>${codi}</b>`;
  if (window.QRCode) new QRCode($('qr'), { text: `${origen}/vota?sala=${codi}`, width: 128, height: 128 });
  connecta(codi, 'uct', { vista: rep });
});

document.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => accio({ tipus: 'avisa', text: b.dataset.msg, incident: seleccionat }));
$('form-msg').onsubmit = e => {
  e.preventDefault();
  accio({ tipus: 'avisa', text: e.target.text.value, incident: seleccionat });
  e.target.text.value = '';
};

function rep(v) {
  const nous = v.incidents.filter(i => !vistos.has(i.id));
  if (vista && nous.length) so('trucada');
  nous.forEach(i => vistos.add(i.id));
  if (vista && v.radio.length && v.radio[0].text !== vista.radio[0]?.text) so('radio');
  vista = v;
  if (!seleccionat && v.incidents.length) seleccionat = v.incidents.at(-1).id;
  $('rellotge').textContent = v.rellotge;
  $('estat').innerHTML = { pausa: '<span class="etiqueta v-perillosa">PAUSA</span>', finalitzada: '<span class="etiqueta v-acceptable">FINALITZADA</span>' }[v.estat] || '';
  $('cobertura').innerHTML = coberturaHtml(v.cobertura);
  $('cua-consultor').innerHTML = v.trucadesEnCua ? `<span class="parpelleja">${v.trucadesEnCua} trucades en cua al consultor</span>` : '';
  $('capa').innerHTML = briefingHtml(v) || (v.estat === 'finalitzada' && !resumTancat ? resum(v) : '');
  $('tanca-resum')?.addEventListener('click', () => { resumTancat = true; $('capa').innerHTML = ''; });
  renderSafata();
  renderDetall();
  $('radio').innerHTML = v.radio.map(r => `<div><span class="suau">${r.hora} · ${r.numero}</span> ${esc(r.text)}</div>`).join('') || '<p class="suau">Sense comunicacions.</p>';
  $('missatges').innerHTML = missatgesHtml(v.missatges, 'uct');
  // With a shift supervisor in the room, coverage moves are theirs; the UCT still sees the coverage
  $('panell-cobertura').hidden = v.rols.includes('cap');
  if (!v.rols.includes('cap')) panellMoviments($('moviments'), v, unitats, (unitat, desti) => accio({ tipus: 'mou', unitat, desti }));
  pintaMapa();
}

function estatIncident(i) {
  if (i.estat === 'tancat') return `<span class="etiqueta v-${i.desenllac?.tipus === 'bo' ? 'optima' : 'perillosa'}">tancat</span>`;
  if (i.senseRecurs != null && !i.unitats.length) return `<span class="${i.senseRecurs > 60 ? 'parpelleja' : 'suau'}">sense recurs ${i.senseRecurs} s</span>`;
  const enRuta = i.unitats.filter(u => u.fase === 'ruta');
  return `<span class="suau">${i.unitats.length} unitats${enRuta.length ? ` · ${Math.min(...enRuta.map(u => u.falta))} min` : ' al lloc'}</span>`;
}

function renderSafata() {
  $('safata').innerHTML = [...vista.incidents].reverse().map(i => `
    <button class="incident-fila ${i.id === seleccionat ? 'seleccionat' : ''} ${i.pendents.length ? 'nou' : ''}" data-inc="${i.id}">
      <span><span class="nivell n${i.nivell || 0}">${i.nivell ? 'N' + i.nivell : '—'}</span> <span class="num">${i.numero}</span></span>${estatIncident(i)}
      <span class="adreca">${esc(i.municipi)} · ${esc(i.tipus_demanda)}${i.pendents.length ? ' · <b>decisió pendent</b>' : ''}</span></button>`).join('')
    || '<p class="suau">Encara no ha entrat cap incident.</p>';
  $('safata').querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { seleccionat = Number(b.dataset.inc); centrat = null; renderSafata(); renderDetall(); pintaMapa(); });
}

let clauDetall = '';
function renderDetall() {
  const i = vista.incidents.find(x => x.id === seleccionat);
  if (!i) return;
  $('registre').innerHTML = registreHtml(i.registre);
  // Rebuild only when something relevant changed, so buttons do not move under the pointer every second
  const clau = JSON.stringify([i.id, i.estat, i.nivell, i.valorat, i.serveis, i.preavis, i.pendents.map(d => d.pas), i.unitats, i.candidates.map(c => c.indicatiu + c.eta + c.preavis), i.finalitzable]);
  if (clau === clauDetall) return;
  clauDetall = clau;
  const decisions = i.pendents.map(d => `<div class="decisio"><h3>${esc(d.titol)}</h3><p>${esc(d.pregunta)}</p>
    <div class="opcions">${d.opcions.map(o => `<button class="opcio" data-pas="${d.pas}" data-opcio="${o.id}">${esc(o.text)}</button>`).join('')}</div></div>`).join('');
  const assignades = i.unitats.map(u => `<button class="unitat-assignada" data-treu="${esc(u.indicatiu)}" ${i.estat === 'tancat' ? 'disabled' : ''}>
    <span class="punt" style="background:${COLOR[u.tipus]}"></span>${esc(u.indicatiu)} ${u.tipus} · ${ESTAT_UNITAT[u.fase] || ''}${u.fase === 'ruta' ? ` ${u.falta} min` : ''} ✕</button>`).join(' ');
  const prealertades = i.preavis.map(id => `<button class="unitat-assignada preavis" data-preavis="${esc(id)}" title="Anul·lar el 3.20">${esc(id)} · 3.20 ✕</button>`).join(' ');
  // Free units: click to activate; an advanced unit can also be pre-alerted (3.20 SEM) while the call is assessed
  const candidates = i.candidates.filter(u => !u.preavis || u.preavis === i.id).map(u => `<div class="candidata">
    <button class="opcio unitat" data-unitat="${esc(u.indicatiu)}"><span class="punt" style="background:${COLOR[u.tipus]}"></span><b>${esc(u.indicatiu)}</b> ${u.tipus}<span class="nvots">${u.eta} min</span></button>
    ${CATEGORIA[u.tipus] === 'SVA' ? `<button class="boto-320 ${u.preavis === i.id ? 'actiu' : ''}" data-preavis="${esc(u.indicatiu)}" title="3.20 SEM: prealertar mentre es valora">3.20</button>` : ''}</div>`).join('');
  const serveis = Object.entries(SERVEIS).map(([id, nom]) => `<button class="xip-boto ${i.serveis.includes(id) ? 'actiu' : ''}" data-servei="${id}">${esc(nom)}</button>`).join('');
  const consultor = i.nivell ? `<span class="nivell n${i.nivell}">N${i.nivell}</span> ${i.valorat ? 'valorat' : 'en valoració'}` : i.valorat ? 'valorat' : '<span class="suau">pendent de valorar pel consultor</span>';
  $('detall').innerHTML = `
    <div class="incident"><span class="num">${i.numero}</span><span class="tipus">${esc(i.tipus_demanda.toUpperCase())}</span> ${i.nivell ? `<span class="nivell n${i.nivell}">N${i.nivell}</span>` : '<span class="suau">nivell pendent</span>'}
      <div>${esc(i.municipi)}, ${esc(i.zona)} · entorn ${ENTORN[i.entorn] || ''} · alerta ${i.horaAlerta}</div></div>
    <p class="carta-text">${esc(i.carta)}</p>
    <p class="estat-consultor">Consultor: ${consultor}</p>
    ${decisions}
    ${i.estat === 'obert' ? `<h3>Recursos</h3><p><b>Activades:</b> ${assignades || '<span class="suau">cap</span>'} ${prealertades}</p><div class="unitats-llista">${candidates}</div>
      <h3>Altres serveis</h3><div class="serveis">${serveis}</div>
      ${i.finalitzable ? '<div class="accions"><button class="boto secundari" id="finalitza">Finalitzar incident sense recurs</button></div>' : ''}` : ''}
    ${i.estat === 'tancat' ? desenllacHtml(i.desenllac) + resultatsHtml(i.resultats) : ''}`;
  $('detall').querySelectorAll('[data-pas]').forEach(b => b.onclick = () => accio({ tipus: 'decideix', incident: i.id, pas: b.dataset.pas, opcio: b.dataset.opcio }));
  $('detall').querySelectorAll('[data-unitat]').forEach(b => b.onclick = () => accio({ tipus: 'assigna', incident: i.id, unitat: b.dataset.unitat }));
  $('detall').querySelectorAll('[data-treu]').forEach(b => b.onclick = () => accio({ tipus: 'allibera', incident: i.id, unitat: b.dataset.treu }));
  $('detall').querySelectorAll('[data-preavis]').forEach(b => b.onclick = () => accio({ tipus: 'preavisa', incident: i.id, unitat: b.dataset.preavis }));
  $('detall').querySelectorAll('[data-servei]').forEach(b => b.onclick = () => accio({ tipus: 'servei', incident: i.id, servei: b.dataset.servei }));
  $('finalitza')?.addEventListener('click', () => accio({ tipus: 'finalitza', incident: i.id }));
}

function pintaMapa() {
  const i = vista.incidents.find(x => x.id === seleccionat);
  if (!mapa || !i) return;
  capa.clearLayers();
  for (const altre of vista.incidents.filter(x => x.estat === 'obert')) {
    L.circleMarker([altre.punt.lat, altre.punt.lon], { radius: altre.id === i.id ? 12 : 7, color: '#ff5252', weight: 3, fillOpacity: altre.id === i.id ? 0.5 : 0.2 })
      .addTo(capa).bindTooltip(`${altre.numero} · ${esc(altre.municipi)}`, { permanent: altre.id === i.id, direction: 'top' })
      .on('click', () => { seleccionat = altre.id; centrat = null; renderSafata(); renderDetall(); pintaMapa(); });
  }
  for (const d of i.dea) L.circleMarker([d.lat, d.lon], { radius: 4, color: '#26a69a', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(capa).bindTooltip(`DEA · ${esc(d.nom)} (${d.dist} m)`);
  if ($('veure-cobertura').checked) pintaCobertura(capa, vista.mapaCobertura);
  const meves = new Set(i.unitats.map(u => u.indicatiu));
  pintaUnitats(capa, vista, unitats, {
    filtre: (u, e) => distanciaKm(e, i.punt) <= 60, destacades: meves,
    onClick: (u, e) => i.estat === 'obert' && (meves.has(u.indicatiu) ? accio({ tipus: 'allibera', incident: i.id, unitat: u.indicatiu })
      : ['disponible', 'assignada'].includes(e.estat) && accio({ tipus: 'assigna', incident: i.id, unitat: u.indicatiu })),
  });
  if (centrat !== i.id) {
    centrat = i.id;
    mapa.fitBounds([[i.punt.lat, i.punt.lon], ...i.candidates.slice(0, 5).map(c => { const e = estatUnitat(vista, unitats.find(x => x.indicatiu === c.indicatiu)); return [e.lat, e.lon]; })], { padding: [30, 30], maxZoom: 13 });
  }
}

function resum(v) {
  const bons = v.incidents.filter(i => i.desenllac?.tipus === 'bo').length;
  return `<div class="capa"><div class="panell briefing"><h2>Fi de la guàrdia</h2>
    <p class="gran">${v.punts.punts} / ${v.punts.maxim} punts d'equip</p>
    <p>UCT: ${v.puntsRol.uct.punts} / ${v.puntsRol.uct.maxim} · Consultor: ${v.puntsRol.consultor.punts} / ${v.puntsRol.consultor.maxim}</p>
    <p>${bons} de ${v.incidents.length} pacients amb desenllaç favorable.</p>
    <p class="suau">Reviseu cada incident a la safata per veure les decisions i els aprenentatges.</p>
    <button class="boto" id="tanca-resum">Tancar</button></div></div>`;
}
