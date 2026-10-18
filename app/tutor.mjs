// Tutor panel: configures the shift (CECOS, themes, pace), drives it with orders and sees what the team cannot see.
import { ETIQUETA, ROLS } from './motor.mjs';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let codiSala, tematiques = [], casos = [];

async function carrega() {
  const get = f => fetch(f).then(r => (r.ok ? r.json() : Promise.reject(r.status)));
  const [cecos, tem, index] = await Promise.all([get('/data/cecos.json'), get('/data/tematiques.json'), get('/casos/index.json')]);
  tematiques = tem;
  casos = await Promise.all(index.map(id => get(`/casos/${id}.json`)));
  $('cecos').innerHTML = cecos.cecos.map(c => `<label class="casella"><input type="checkbox" name="cecos" value="${c.id}" data-zones="${esc(JSON.stringify(c.zones))}">${esc(c.nom)}</label>`).join('');
  $('tematiques').innerHTML = tematiques.map(t => {
    const n = casos.filter(c => c.tematiques?.includes(t.id)).length;
    return `<label class="casella" title="${esc(t.descripcio)}"><input type="checkbox" name="tematica" value="${t.id}">${esc(t.nom)} <span class="suau">(${n} casos)</span></label>`;
  }).join('');
  $('tematica-ara').innerHTML += tematiques.map(t => `<option value="${t.id}">${esc(t.nom)}</option>`).join('');
  $('cas-ara').innerHTML += casos.map(c => `<option value="${c.id}">${esc(c.titol)}</option>`).join('');
}

$('config').onsubmit = e => {
  e.preventDefault();
  creaGuardia().catch(err => { $('error').textContent = `No s'ha pogut crear la guàrdia: ${err.message || err}`; });
};

async function creaGuardia() {
  const f = $('config');
  const triades = [...f.querySelectorAll('[name=cecos]:checked')];
  if (!triades.length) { $('error').textContent = 'Trieu almenys una CECOS.'; return; }
  const config = {
    cecos: triades.map(c => c.value),
    nomCecos: triades.map(c => c.parentElement.textContent.trim()).join(' · '),
    zones: triades.flatMap(c => JSON.parse(c.dataset.zones)),
    tematiques: [...f.querySelectorAll('[name=tematica]:checked')].map(t => t.value),
    hora: f.hora.value, incidents: Number(f.incidents.value), ritme: Number(f.ritme.value) * 60,
    ocupacio: Number(f.ocupacio.value), factor: Number(f.factor.value),
  };
  const r = await fetch('/api/sala', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) });
  if (!r.ok) { $('error').textContent = 'No s\'ha pogut crear la guàrdia (contrasenya?).'; return; }
  ({ sala: codiSala } = await r.json());
  f.hidden = true;
  $('panell').hidden = false;
  $('codi').textContent = codiSala;
  $('enllac-sala').href = `/sala?sala=${codiSala}`;
  const vot = `${location.origin}/vota?sala=${codiSala}`;
  $('url-vot').innerHTML = `${esc(location.host)}/vota<br>codi <b>${codiSala}</b>`;
  if (window.QRCode) new QRCode($('qr'), { text: vot, width: 128, height: 128 });
  escolta();
}

const ordre = o => fetch(`/api/ordre?sala=${codiSala}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ordre: o }) });
document.querySelectorAll('[data-ordre]').forEach(b => b.onclick = () => ordre({ tipus: b.dataset.ordre }));
$('llanca').onclick = () => ordre({ tipus: 'incident', tematica: $('tematica-ara').value || null, cas: $('cas-ara').value || null });
$('envia-msg').onclick = () => {
  const text = $('msg-text').value.trim();
  if (!text) return;
  ordre({ tipus: 'missatge', incident: $('msg-incident').value, codi: $('msg-codi').value, text: text.toUpperCase() });
  $('msg-text').value = '';
};

function escolta() {
  const fonts = new EventSource(`/api/events?sala=${codiSala}&rol=tutor`);
  fonts.addEventListener('estat', e => renderEstat(JSON.parse(e.data)));
  fonts.addEventListener('classificacio', e => {
    const c = JSON.parse(e.data);
    $('classificacio').innerHTML = c.map(x => `<li>${esc(x.nom)} · ${x.punts}</li>`).join('') || '<li class="suau">Sense vots</li>';
  });
}

function renderEstat(estat) {
  if (!estat) return;
  $('rellotge').textContent = estat.rellotge + (estat.pausat ? ' · pausa' : '') + (estat.finalitzat ? ' · finalitzada' : '');
  $('punts').textContent = `Equip: ${estat.punts} / ${estat.maxim}`;
  const triat = $('msg-incident').value;
  $('msg-incident').innerHTML = estat.incidents.filter(i => i.estat !== 'tancat')
    .map(i => `<option value="${i.id}" ${String(i.id) === triat ? 'selected' : ''}>${i.numero} · ${esc(i.municipi)}</option>`).join('');
  $('incidents').innerHTML = [...estat.incidents].reverse().map(i => {
    const nomsTem = (i.tematiques || []).map(t => tematiques.find(x => x.id === t)?.nom).filter(Boolean).join(', ');
    return `<div class="tutor-incident">
      <div><span class="num">${i.numero}</span> <b>${esc(i.titol)}</b> · ${esc(i.municipi)} (${esc(i.zona)})
        ${i.desenllac ? `<span class="etiqueta v-${i.desenllac === 'bo' ? 'optima' : 'perillosa'}">${i.desenllac === 'bo' ? 'Desenllaç bo' : 'Desenllaç dolent'}</span>` : `<span class="suau">${i.estat} · ${i.pas ? 'decidint: ' + esc(i.pas) : 'tancant'}</span>`}</div>
      <div class="suau">Realitat: ${esc(i.variant)} · <b>N${i.nivell}</b> · Temàtiques: ${esc(nomsTem)}</div>
      <div class="suau">Unitats: ${i.unitats.join(', ') || (i.estat === 'tancat' ? 'cap' : `cap · ${i.segons} s sense recurs`)}</div>
      ${i.resultats.length ? `<table class="mini">${i.resultats.map(r => `<tr><td>${esc(r.pas)}</td><td class="suau">${ROLS[r.rol] || ''}</td>
        <td>${esc(r.equip)}</td><td><span class="etiqueta v-${r.valoracio}">${ETIQUETA[r.valoracio]}</span></td></tr>`).join('')}</table>` : ''}
    </div>`;
  }).join('') || '<p class="suau">Encara no ha entrat cap incident.</p>';
}

carrega().catch(() => { $('error').textContent = 'Cal entrar amb la contrasenya (torneu a la pàgina inicial).'; });
