// Consultor training, tutor and projector screen: prepares each recording (XABCDE answers, right level,
// incident place), shows the code for the phones, opens the answers and projects the results.
import { $, esc, avis } from './client.mjs';
import { XABCDE } from './motor.mjs';
import { COLOR } from './territori.mjs';

let codi = null, municipis = new Map(), vista = null, clauUnitats = '';

async function carrega() {
  $('xabcde').innerHTML = XABCDE.map((l, i) => `<div class="bloc" data-lletra="${i}">
    <div class="fila"><label><span class="lletra-gran">${esc(l.lletra)}</span> <input class="nom-lletra" value="${esc(l.nom)}"></label>
      <label>Correcta <select class="correcta"></select></label></div>
    <textarea class="opcions-lletra" rows="4">${esc(l.opcions.join('\n'))}</textarea></div>`).join('');
  $('xabcde').querySelectorAll('.bloc').forEach(b => { omplCorrecta(b); b.querySelector('textarea').oninput = () => omplCorrecta(b); });
  const centres = await fetch('/data/centres.json').then(r => (r.ok ? r.json() : Promise.reject(r.status)));
  for (const c of centres.filter(x => x.tipus === 'CAP' && x.municipi)) {
    if (!municipis.has(c.municipi)) municipis.set(c.municipi, { municipi: c.municipi, zona: c.subzona || c.regio, lat: c.lat, lon: c.lon });
  }
  $('municipis').innerHTML = [...municipis.keys()].sort((a, b) => a.localeCompare(b, 'ca')).map(m => `<option value="${esc(m)}">`).join('');
}

// The "right answer" selector follows the options typed for that letter
function omplCorrecta(bloc) {
  const sel = bloc.querySelector('.correcta'), abans = sel.value;
  const opcions = bloc.querySelector('textarea').value.split('\n').map(s => s.trim()).filter(Boolean);
  sel.innerHTML = '<option value="">No puntuar</option>' + opcions.map((o, i) => `<option value="${i}">${esc(o)}</option>`).join('');
  if (abans !== '' && Number(abans) < opcions.length) sel.value = abans;
}

function llegeixConfig() {
  const f = $('config');
  const lloc = municipis.get(f.municipi.value.trim());
  if (!lloc) throw new Error('Trieu un municipi de la llista');
  const xabcde = [...$('xabcde').querySelectorAll('.bloc')].map((b, i) => ({
    lletra: XABCDE[i].lletra, nom: b.querySelector('.nom-lletra').value.trim(),
    opcions: b.querySelector('textarea').value.split('\n').map(s => s.trim()).filter(Boolean),
    correcta: b.querySelector('.correcta').value === '' ? null : Number(b.querySelector('.correcta').value),
  }));
  return { titol: f.titol.value.trim(), nivell: f.nivell.value ? Number(f.nivell.value) : null, lloc, xabcde };
}

async function post(ruta, cos) {
  const r = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cos) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `error ${r.status}`);
  return d;
}
const ordre = o => post(`/api/aula/ordre?codi=${codi}`, o).then(actualitza).catch(e => avis(e.message));

$('config').onsubmit = async e => {
  e.preventDefault();
  try {
    const config = llegeixConfig();
    if (!codi) {
      ({ codi } = await post('/api/aula/nova', { config }));
      $('codi').textContent = codi;
      $('cap-codi').hidden = false;
      const url = `${location.origin}/aula?codi=${codi}`;
      $('url-alumnes').innerHTML = `${esc(location.host)}/aula<br>codi <b class="codi">${codi}</b>`;
      if (window.QRCode) new QRCode($('qr'), { text: url, width: 180, height: 180 });
      bucle();
    } else await post(`/api/aula/ordre?codi=${codi}`, { tipus: 'nova', config });
    $('config').hidden = true;
    $('directe').hidden = false;
    clauUnitats = '';
    actualitza();
  } catch (err) { $('error').textContent = err.message; }
};
$('obre').onclick = () => ordre({ tipus: 'obre' });
$('mostra').onclick = () => ordre({ tipus: 'resultats' });
$('nova').onclick = () => {
  const f = $('config');
  f.titol.value = f.titol.value.replace(/(\d+)\s*$/, (_, n) => String(Number(n) + 1));
  f.hidden = false;
  $('directe').hidden = true;
  f.scrollIntoView({ behavior: 'smooth' });
};
$('en-directe').onchange = () => render();
$('fitxer-audio').onchange = e => {
  const fitxer = e.target.files[0];
  if (!fitxer) return;
  $('audio').src = URL.createObjectURL(fitxer);
  $('audio').hidden = false;
};

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
  $('progres').innerHTML = [['Connectats', p.connectats], ['XABCDE', p.xabcde], ['Nivell', p.nivell], ['Recursos (acabat)', p.recursos]]
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

function resultats(v) {
  const d = v.distribucio, mostra = v.estat === 'resultats';
  const lletres = v.config.xabcde.map(l => `<div class="panell"><h3><span class="lletra-gran">${esc(l.lletra)}</span> ${esc(l.nom)}</h3>
    ${barres(l.opcions.map((o, i) => ({ text: o, n: d.xabcde[l.lletra]?.[i] || 0, correcte: mostra && l.correcta === i })))}</div>`).join('');
  const nivell = barres([1, 2, 3, 4, 5].map(n => ({ html: `<span class="nivell n${n}">N${n}</span>`, n: d.nivell[n] || 0, correcte: mostra && v.config.nivell === n, classe: `n${n}` })));
  const combos = barres(Object.entries(d.combo).sort((a, b) => b[1] - a[1]).map(([text, n]) => ({ text, n, correcte: mostra && text === v.correctesCombo })));
  const unitats = barres(Object.entries(d.unitats).sort((a, b) => b[1] - a[1]).map(([id, n]) => {
    const u = v.unitats.find(x => x.indicatiu === id);
    return { text: u ? `${id} ${u.tipus} · ${u.eta} min` : 'Cap recurs', n, correcte: mostra && v.correctes.includes(id) };
  }));
  const rànquing = v.classificacio.length ? `<div class="panell"><h3>Classificació</h3><ol class="ranquing">${v.classificacio
    .map(c => `<li><b>${esc(c.nom)}</b> · ${c.punts}/${c.maxim} <span class="suau">(XABCDE ${c.xabcde}, nivell ${c.nivell}, recursos ${c.recursos})</span></li>`).join('')}</ol></div>` : '';
  return `<div class="graella-xabcde">${lletres}</div>
    <div class="graella-xabcde">
      <div class="panell"><h3>Nivell de triatge</h3>${nivell}</div>
      <div class="panell"><h3>Tipus de resposta</h3>${combos || '<p class="suau">Encara cap.</p>'}${mostra ? `<p class="suau">Proposta: ${esc(v.correctesCombo)} (${esc(v.correctes.join(', ') || 'cap recurs')})</p>` : ''}</div>
      <div class="panell"><h3>Unitats activades</h3>${unitats || '<p class="suau">Encara cap.</p>'}</div>
    </div>${rànquing}`;
}

carrega().catch(() => { $('error').textContent = 'Cal entrar amb la contrasenya (torneu a la pàgina inicial).'; });
