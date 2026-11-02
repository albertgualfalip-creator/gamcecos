// Consultor training, tutor's class page: picks the prepared cases one after another (with their recording from
// the server), opens the answers, adjusts the right units and shows the results. Cases are prepared in /aula-admin.
import { $, esc, avis } from './client.mjs';
import { panellsResultats, classificacio, panellsEscenari, estatEquips } from './aula-resultats.mjs';
import { COLOR } from './territori.mjs';

let codi = null, casos = [], actual = null, vista = null, clauUnitats = '';

async function carrega() {
  const r = await fetch('/api/aula/casos', { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status);
  ({ casos } = await r.json());
  llistaCasos();
}

function llistaCasos() {
  $('casos').innerHTML = casos.map((c, i) => `<button class="incident-fila ${c.id === actual?.id ? 'seleccionat' : ''}" data-id="${esc(c.id)}">
    <span><b>${i + 1}.</b> ${esc(c.titol)}</span><span>${c.nivell ? `<span class="nivell n${c.nivell}">N${c.nivell}</span>` : ''}</span>
    <span class="adreca">${esc(c.lloc?.municipi || '')} · ${c.tipus === 'escenari' ? `👥 escenari en equip · ${c.incidents?.length || 0} incidents` : c.tipus === 'carta' ? '📄 només carta' : c.audio ? '🔊' : 'sense gravació'}</span></button>`).join('')
    || '<p>Encara no hi ha cap cas preparat. <a href="/aula-admin">Prepareu-los aquí</a>.</p>';
  $('casos').querySelectorAll('[data-id]').forEach(b => b.onclick = () => posa(casos.find(c => c.id === b.dataset.id)));
  const i = casos.findIndex(c => c.id === actual?.id);
  const seguent = casos[i + 1];
  $('seguent').disabled = !seguent;
  $('seguent').textContent = !actual ? 'Començar amb el primer cas' : seguent ? `Cas següent: ${seguent.titol} ▸` : 'No hi ha més casos';
}
$('seguent').onclick = () => posa(casos[casos.findIndex(c => c.id === actual?.id) + 1]);

async function post(ruta, cos) {
  const r = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cos) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `error ${r.status}`);
  return d;
}
const ordre = o => post(`/api/aula/ordre?codi=${codi}`, o).then(actualitza).catch(e => avis(e.message));

// Puts a prepared case on: a new round for every phone, with its recording ready to play
async function posa(cas) {
  if (!cas) return;
  if (vista?.estat === 'oberta' && !confirm('Les respostes del cas actual encara són obertes. Passar al següent igualment?')) return;
  const { tipus, titol, carta, nivell, preguntes, recursos, fases, unitats, correctes, lloc, xabcde, incidents, equips } = cas;
  const config = { tipus, titol, carta, nivell, preguntes, recursos, fases, unitats, correctes, lloc, xabcde, incidents, equips };
  try {
    if (!codi) {
      ({ codi } = await post('/api/aula/nova', { config }));
      $('codi').textContent = codi;
      $('cap-codi').hidden = false;
      $('url-alumnes').innerHTML = `${esc(location.host)}/aula<br>codi <b class="codi">${codi}</b>`;
      if (window.QRCode) new QRCode($('qr'), { text: `${location.origin}/aula?codi=${codi}`, width: 120, height: 120 });
      $('obre-projector').href = `/projector?codi=${codi}`;
      bucle();
    } else await post(`/api/aula/ordre?codi=${codi}`, { tipus: 'nova', config });
  } catch (e) { avis(e.message); return; }
  actual = cas;
  $('directe').hidden = false;
  $('cas-actual').innerHTML = `<h2>${esc(cas.titol)} ${cas.nivell ? `<span class="nivell n${cas.nivell}">N${cas.nivell}</span>` : ''}</h2>
    ${cas.tipus === 'escenari' ? `<p class="suau">👥 Escenari en equip: ${cas.incidents?.length || 0} incidents alhora. Cada equip decideix entre tots duplicats, prioritat i unitats.</p>`
      : cas.tipus === 'carta' ? '<p class="suau">📄 Cas només amb carta del 112: els alumnes decideixen si envien recurs i quins.</p>'
      : cas.audio ? `<audio id="audio" controls preload="auto" src="/api/aula/audio?id=${encodeURIComponent(cas.id)}"></audio>` : '<p class="suau">Aquest cas no té gravació.</p>'}
    ${cas.carta ? `<p class="carta-text">${esc(cas.carta)}</p>` : ''}
    ${cas.notes ? `<p class="notes-tutor"><b>Notes:</b> ${esc(cas.notes)}</p>` : ''}`;
  clauUnitats = '';
  $('obre').textContent = cas.tipus === 'carta' || !cas.audio ? 'Obrir respostes' : '▶ Reproduir i obrir respostes';
  llistaCasos();
  actualitza();
}
$('en-directe').onchange = () => render();
// The recording and the answers start together, so each activation second matches the recording second
$('obre').onclick = () => {
  const audio = $('audio');
  if (audio) { audio.currentTime = 0; audio.play().catch(() => avis('Premeu el botó de reproducció de la gravació')); }
  ordre({ tipus: 'obre' });
};
$('mostra').onclick = () => ordre({ tipus: 'resultats' });

async function actualitza() {
  if (!codi) return;
  try {
    const r = await fetch(`/api/aula/tutor?codi=${codi}`, { cache: 'no-store' });
    if (r.ok) { vista = await r.json(); render(); }
  } catch { /* try again on the next tick */ }
}
function bucle() { actualitza().finally(() => setTimeout(bucle, 1000)); }

const ESTAT = { preparada: 'Preparada: obriu les respostes quan vulgueu', oberta: 'Respostes obertes', resultats: 'Resultats' };

function render() {
  const v = vista;
  if (!v) return;
  $('estat-ronda').textContent = `${v.config.titol} · ${ESTAT[v.estat]}`;
  $('obre').disabled = v.estat !== 'preparada';
  $('mostra').disabled = v.estat !== 'oberta';
  const p = v.progres;
  const f = v.config.fases;
  // Team scenario: teams instead of single answers, and no list of right units to adjust here
  $('panell-unitats').hidden = v.config.tipus === 'escenari';
  if (v.config.tipus === 'escenari') {
    $('progres').innerHTML = `<div><span class="xifra">${p.connectats}</span><span class="suau">Alumnes</span></div>
      <div><span class="xifra">${p.acabats}</span><span class="suau">Equips amb acord</span></div>`;
    $('resultats').innerHTML = v.estat === 'resultats' ? `<div class="graella-xabcde">${panellsEscenari(v)}</div>`
      : `<div class="panell"><h3>Equips</h3>${estatEquips(v)}</div>`;
    return;
  }
  $('progres').innerHTML = [['Connectats', p.connectats], f.activacio && ['🚑 Activat', p.activats], ['escolta', 'preguntes', 'instruccio'].some(x => f[x]) && ['Valoració', p.xabcde],
    f.nivell && ['Nivell', p.nivell], ['Han acabat', p.acabats]].filter(Boolean)
    .map(([t, n]) => `<div><span class="xifra">${n}</span><span class="suau">${t}</span></div>`).join('');
  $('lloc').textContent = `· incident a ${v.config.lloc.municipi}`;
  renderUnitats(v);
  const veure = v.estat === 'resultats' || $('en-directe').checked;
  $('resultats').innerHTML = veure ? resultats(v) : '';
}

function renderUnitats(v) {
  const clau = JSON.stringify([v.ronda, v.estat, v.correctes]);
  if (clau === clauUnitats) return;
  clauUnitats = clau;
  const bloquejat = v.estat === 'resultats';
  $('unitats').innerHTML = v.unitats.map(u => `<label class="opcio unitat ${v.correctes.includes(u.indicatiu) ? 'triada' : ''}">
    <input type="checkbox" data-u="${esc(u.indicatiu)}" ${v.correctes.includes(u.indicatiu) ? 'checked' : ''} ${u.ocupada || bloquejat ? 'disabled' : ''}>
    <span class="punt" style="background:${COLOR[u.tipus] || '#888'}"></span><b>${esc(u.indicatiu)}</b> ${esc(u.tipus)}
    <span class="nvots">${u.ocupada ? 'ocupada' : `${u.eta} min`}</span></label>`).join('');
  $('unitats').querySelectorAll('[data-u]').forEach(c => c.onchange = () => {
    ordre({ tipus: 'correctes', correctes: [...$('unitats').querySelectorAll('[data-u]:checked')].map(x => x.dataset.u) });
  });
}

function resultats(v) {
  const mostra = v.estat === 'resultats';
  return `<div class="graella-xabcde">${panellsResultats(v, mostra)}</div>${classificacio(v, true)}`;
}

carrega().catch(() => { $('casos').innerHTML = '<p>Cal entrar amb la contrasenya (torneu a la pàgina inicial).</p>'; });
