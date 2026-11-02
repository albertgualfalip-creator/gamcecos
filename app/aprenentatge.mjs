// Consultor training, tutor's class page: picks the prepared cases one after another (with their recording from
// the server), opens the answers, adjusts the right units and shows the results. Cases are prepared in /aula-admin.
import { $, esc, avis } from './client.mjs';
import { SECCIONS } from './motor.mjs';
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
    <span class="adreca">${esc(c.lloc?.municipi || '')} · ${c.audio ? '🔊' : 'sense gravació'}</span></button>`).join('')
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
  const config = { titol: cas.titol, carta: cas.carta, nivell: cas.nivell, lloc: cas.lloc, xabcde: cas.xabcde };
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
    ${cas.audio ? `<audio id="audio" controls preload="auto" src="/api/aula/audio?id=${encodeURIComponent(cas.id)}"></audio>` : '<p class="suau">Aquest cas no té gravació.</p>'}
    ${cas.carta ? `<p class="carta-text">${esc(cas.carta)}</p>` : ''}
    ${cas.notes ? `<p class="notes-tutor"><b>Notes:</b> ${esc(cas.notes)}</p>` : ''}`;
  clauUnitats = '';
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
  $('progres').innerHTML = [['Connectats', p.connectats], ['🚑 Activat', p.activats], ['XABCDE', p.xabcde], ['Nivell', p.nivell], ['Recursos (acabat)', p.recursos]]
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

// Horizontal bars: how many chose each option, the right one highlighted
function barres(files) {
  const total = Math.max(1, ...files.map(f => f.n));
  return `<div class="barres">${files.map(f => `<div class="barra-fila ${f.correcte ? 'correcte' : ''}">
    <span class="barra-text">${f.html ?? esc(f.text)}${f.correcte ? ' ✓' : ''}</span>
    <span class="barra"><span style="width:${(100 * f.n) / total}%" class="${f.classe || ''}"></span></span><b>${f.n}</b></div>`).join('')}</div>`;
}

// When the class detected the severity: seconds from the start of the recording to the first activation
function tempsActivacio(d) {
  const trams = [['0–15 s', 0, 15], ['15–30 s', 15, 30], ['30–60 s', 30, 60], ['1–2 min', 60, 120], ['> 2 min', 120, Infinity]];
  const files = trams.map(([text, de, fins]) => ({ text, n: d.activacio.filter(a => a.t >= de && a.t < fins).length }));
  files.push({ text: 'Sense activar durant la valoració', n: d.senseActivacio });
  const temps = d.activacio.map(a => a.t);
  const mitjana = temps.length ? temps.slice().sort((a, b) => a - b)[Math.floor(temps.length / 2)] : null;
  return `${barres(files)}${mitjana != null ? `<p class="suau">Mediana: segon ${mitjana} de la gravació. Primer: ${esc(d.activacio[0].nom)} (${d.activacio[0].t} s).</p>` : ''}`;
}

function resultats(v) {
  const d = v.distribucio, mostra = v.estat === 'resultats';
  const lletres = v.config.xabcde.map(l => `<div class="panell"><h3><span class="lletra-gran">${esc(l.lletra)}</span> ${esc(l.nom)}</h3>
    ${SECCIONS.map(sec => {
      const items = l.items.filter(it => it.seccio === sec.id && ((mostra && it.correcte) || d.xabcde[it.id]));
      return items.length ? `<div class="seccio-resultat seccio-${sec.id}"><b>${esc(sec.nom)}</b>${barres(items.map(it => ({ text: it.text, n: d.xabcde[it.id] || 0, correcte: mostra && it.correcte })))}</div>` : '';
    }).join('')}</div>`).join('');
  const nivell = barres([1, 2, 3, 4, 5].map(n => ({ html: `<span class="nivell n${n}">N${n}</span>`, n: d.nivell[n] || 0, correcte: mostra && v.config.nivell === n, classe: `n${n}` })));
  const combos = barres(Object.entries(d.combo).sort((a, b) => b[1] - a[1]).map(([text, n]) => ({ text, n, correcte: mostra && text === v.correctesCombo })));
  const unitats = barres(Object.entries(d.unitats).sort((a, b) => b[1] - a[1]).map(([id, n]) => {
    const u = v.unitats.find(x => x.indicatiu === id);
    return { text: u ? `${id} ${u.tipus} · ${u.eta} min` : 'Cap recurs', n, correcte: mostra && v.correctes.includes(id) };
  }));
  const rànquing = v.classificacio.length ? `<div class="panell"><h3>Classificació</h3><ol class="ranquing">${v.classificacio
    .map(c => `<li><b>${esc(c.nom)}</b> · ${c.punts}/${c.maxim} <span class="suau">(XABCDE ${c.xabcde}, nivell ${c.nivell}, recursos ${c.recursos}, detecció ${c.deteccio}${c.activacio != null ? ` · 🚑 ${c.activacio} s` : ''})</span></li>`).join('')}</ol></div>` : '';
  return `<div class="graella-xabcde">${lletres}</div>
    <div class="graella-xabcde">
      <div class="panell"><h3>Nivell de triatge</h3>${nivell}</div>
      <div class="panell"><h3>Tipus de resposta</h3>${combos || '<p class="suau">Encara cap.</p>'}${mostra ? `<p class="suau">Proposta: ${esc(v.correctesCombo)} (${esc(v.correctes.join(', ') || 'cap recurs')})</p>` : ''}</div>
      <div class="panell"><h3>Unitats activades</h3>${unitats || '<p class="suau">Encara cap.</p>'}</div>
      <div class="panell"><h3>🚑 Quan han activat el recurs</h3>${tempsActivacio(d)}</div>
    </div>${rànquing}`;
}

carrega().catch(() => { $('casos').innerHTML = '<p>Cal entrar amb la contrasenya (torneu a la pàgina inicial).</p>'; });
