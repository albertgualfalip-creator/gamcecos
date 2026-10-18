// Shift supervisor screen: territory coverage, preventive unit moves, overview of incidents and room communication.
import { $, esc, so, connecta, accio as envia, entrada, coberturaHtml, missatgesHtml, briefingHtml } from './client.mjs';
import { distanciaKm } from './motor.mjs';
import { carregaUnitats, nouMapa, pintaCobertura, pintaUnitats, panellMoviments } from './territori.mjs';

let codi, vista, unitats = [], mapa, capa, centrat = false, resumTancat = false;
const accio = a => envia(codi, 'cap', a);

entrada($('entrada'), async (c, config) => {
  codi = c;
  unitats = await carregaUnitats();
  $('joc').hidden = false;
  $('cecos').textContent = config.nomCecos || '';
  mapa = nouMapa('mapa');
  capa = L.layerGroup().addTo(mapa);
  connecta(codi, 'cap', { vista: rep });
});

document.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => accio({ tipus: 'avisa', text: b.dataset.msg }));
$('form-msg').onsubmit = e => {
  e.preventDefault();
  accio({ tipus: 'avisa', text: e.target.text.value });
  e.target.text.value = '';
};

function rep(v) {
  const abans = vista?.cobertura?.filter(c => c.descoberta).length || 0;
  if (vista && v.cobertura.filter(c => c.descoberta).length > abans) so('alerta');
  vista = v;
  $('rellotge').textContent = v.rellotge;
  $('estat').innerHTML = { pausa: '<span class="etiqueta v-perillosa">PAUSA</span>', finalitzada: '<span class="etiqueta v-acceptable">FINALITZADA</span>' }[v.estat] || '';
  const oberts = v.incidents.filter(i => i.estat === 'obert');
  $('indicadors').innerHTML = `${coberturaHtml(v.cobertura)} <span>${oberts.length} incidents oberts</span>
    ${v.trucadesEnCua ? `<span class="parpelleja">${v.trucadesEnCua} trucades en cua</span>` : ''}`;
  panellMoviments($('moviments'), v, unitats, (unitat, desti) => accio({ tipus: 'mou', unitat, desti }));
  $('incidents').innerHTML = oberts.map(i => `<div class="resum-inc"><span class="nivell n${i.nivell || 0}">${i.nivell ? 'N' + i.nivell : '—'}</span>
      <b>${i.numero}</b> · ${esc(i.municipi)} · ${i.unitats.length ? i.unitats.map(u => `${u.indicatiu}${u.fase === 'ruta' ? ` ${u.falta}'` : ''}`).join(', ') : `<span class="${i.senseRecurs > 60 ? 'parpelleja' : ''}">sense recurs ${i.senseRecurs ?? ''} s</span>`}</div>`).join('')
    || '<p class="suau">Cap incident obert.</p>';
  $('radio').innerHTML = v.radio.map(r => `<div><span class="suau">${r.hora}${r.numero ? ' · ' + r.numero : ''}</span> ${esc(r.text)}</div>`).join('') || '<p class="suau">Sense comunicacions.</p>';
  $('missatges').innerHTML = missatgesHtml(v.missatges, 'cap');
  $('capa').innerHTML = briefingHtml(v) || (v.estat === 'finalitzada' && !resumTancat ? resum(v) : '');
  $('tanca-resum')?.addEventListener('click', () => { resumTancat = true; $('capa').innerHTML = ''; });
  pinta();
}

function pinta() {
  capa.clearLayers();
  pintaCobertura(capa, vista.mapaCobertura);
  for (const i of vista.incidents.filter(x => x.estat === 'obert')) {
    L.circleMarker([i.punt.lat, i.punt.lon], { radius: 9, color: '#ff5252', weight: 3, fillOpacity: 0.4 }).addTo(capa).bindTooltip(`${i.numero} · ${esc(i.municipi)}`);
  }
  const punts = vista.mapaCobertura.map(([lat, lon]) => ({ lat, lon }));
  pintaUnitats(capa, vista, unitats, {
    filtre: (u, e) => punts.some(p => distanciaKm(p, e) <= 25),
    onClick: (u, e) => { if (e.estat === 'disponible') { const s = $('mou-unitat'); if (s) s.value = u.indicatiu; } },
  });
  if (!centrat && punts.length) {
    centrat = true;
    mapa.fitBounds(punts.map(p => [p.lat, p.lon]), { padding: [20, 20] });
  }
}

function resum(v) {
  const g = (v.resultatsGlobals || []).find(r => r.pas === 'Cobertura territorial');
  return `<div class="capa"><div class="panell briefing"><h2>Fi de la guàrdia</h2>
    <p class="gran">Equip: ${v.punts.punts} / ${v.punts.maxim}</p>
    ${g ? `<p><span class="etiqueta v-${g.valoracio}">${esc(g.pas)}</span> ${esc(g.feedback)}</p>` : ''}
    <p>${v.incidents.filter(i => i.desenllac?.tipus === 'bo').length} de ${v.incidents.length} pacients amb desenllaç favorable.</p>
    <button class="boto" id="tanca-resum">Tancar</button></div></div>`;
}
