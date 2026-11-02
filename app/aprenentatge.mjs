// Consultor training, tutor's class page: one main button leads the class (put the case on, open the answers, show
// the results, next case), and the tutor sees what the students have to do in this case, where each of them is and
// the time left. Cases are prepared in /aula-admin.
import { $, esc, avis } from './client.mjs';
import { panellsResultats, classificacio, panellsEscenari, estatEquips } from './aula-resultats.mjs';
import { COLOR } from './territori.mjs';

let codi = null, casos = [], actual = null, vista = null, clauUnitats = '', fets = new Set();
const PANTALLES = [['escolta', '👂 Escolta', 'marquen què senten a cada lletra'], ['preguntes', '❓ Preguntes', 'trien les preguntes clau'],
  ['instruccio', '🖐 Instrucció', 'trien la primera instrucció'], ['nivell', 'Nivell', 'posen el nivell'], ['recursos', '🚑 Recursos', 'trien les unitats']];
const TIPUS = { veu: '🔊 Gravació', carta: '📄 Carta del 112', escenari: '👥 Escenari en equip' };
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

async function carrega() {
  const r = await fetch('/api/aula/casos', { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status);
  ({ casos } = await r.json());
  llistaCasos();
  boto();
}

function llistaCasos() {
  $('casos').innerHTML = casos.map((c, i) => `<button class="cas-classe ${c.id === actual?.id ? 'seleccionat' : ''} ${fets.has(c.id) && c.id !== actual?.id ? 'fet' : ''}" data-id="${esc(c.id)}">
    <span class="num-cas">${fets.has(c.id) && c.id !== actual?.id ? '✓' : i + 1}</span><span><b>${esc(c.titol)}</b><br><span class="suau">${TIPUS[c.tipus || 'veu']}${c.temps ? ` · ⏱ ${mmss(c.temps)}` : ''}</span></span></button>`).join('')
    || '<p>Encara no hi ha cap cas. <a href="/aula-admin">Prepareu-los aquí</a>.</p>';
  $('casos').querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
    const cas = casos.find(c => c.id === b.dataset.id);
    if (cas.id !== actual?.id && confirm(`Posar ara «${cas.titol}»?`)) posa(cas);
  });
}

const seguent = () => casos[casos.findIndex(c => c.id === actual?.id) + 1];

// The one button that leads the class, depending on where it is
function boto() {
  const b = $('principal'), estat = vista?.estat, cas = actual;
  let text, explica = '', accio;
  if (!casos.length) { text = 'No hi ha casos preparats'; }
  else if (!cas) { text = '▶ Començar la classe'; explica = `Es posarà el cas 1: «${casos[0].titol}». Els alumnes ja podran entrar amb el QR.`; accio = () => posa(casos[0]); }
  else if (estat === 'preparada') {
    const audio = cas.tipus === 'veu' && cas.audio;
    text = audio ? '▶ Reproduir la gravació i obrir respostes' : '▶ Obrir respostes';
    explica = `Quan tots hagin entrat. ${cas.temps ? `Tindran ${mmss(cas.temps)}.` : 'Sense límit de temps.'}`;
    accio = obre;
  } else if (estat === 'oberta') {
    const p = vista.progres, total = vista.config.tipus === 'escenari' ? vista.equips.filter(e => e.membres.length).length : p.connectats;
    text = 'Mostrar resultats';
    explica = vista.config.tipus === 'escenari' ? `${p.acabats} de ${total} equips amb acord` : `${p.acabats} de ${total} alumnes han acabat`;
    accio = () => ordre({ tipus: 'resultats' });
  } else if (estat === 'resultats') {
    const s = seguent();
    text = s ? `Cas següent: ${s.titol} ▸` : 'Fi de la classe ✓';
    explica = s ? 'Comenteu els resultats i passeu al següent cas.' : 'Heu fet tots els casos.';
    accio = s ? () => posa(s) : null;
  } else text = 'Carregant...';
  b.textContent = text;
  b.disabled = !accio;
  b.onclick = accio;
  $('explica-principal').textContent = explica;
  const pas = !cas ? 'cas' : estat;
  const ordrePassos = ['cas', 'preparada', 'oberta', 'resultats'];
  $('passos-classe').querySelectorAll('li').forEach(li => {
    const k = ordrePassos.indexOf(li.dataset.pas), ara = ordrePassos.indexOf(pas);
    li.className = k === ara ? 'actual' : k < ara ? 'fet' : '';
  });
}

async function post(ruta, cos) {
  const r = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cos) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `error ${r.status}`);
  return d;
}
const ordre = o => post(`/api/aula/ordre?codi=${codi}`, o).then(actualitza).catch(e => avis(e.message));

// The recording and the answers start together, so each activation second matches the recording second
function obre() {
  const audio = $('audio');
  if (audio) { audio.currentTime = 0; audio.play().catch(() => avis('Premeu el botó de reproducció de la gravació')); }
  ordre({ tipus: 'obre' });
}

// Puts a prepared case on: a new round for every phone, with its recording ready to play
async function posa(cas) {
  if (!cas) return;
  if (vista?.estat === 'oberta' && !confirm('Les respostes del cas actual encara són obertes. Passar al següent igualment?')) return;
  const { tipus, titol, carta, nivell, preguntes, recursos, fases, unitats, correctes, lloc, xabcde, incidents, equips, temps } = cas;
  const config = { tipus, titol, carta, nivell, preguntes, recursos, fases, unitats, correctes, lloc, xabcde, incidents, equips, temps };
  try {
    if (!codi) {
      ({ codi } = await post('/api/aula/nova', { config }));
      $('codi').textContent = codi;
      $('cap-codi').hidden = false;
      $('qr-classe').hidden = false;
      $('url-alumnes').innerHTML = `${esc(location.host)}/aula<br>codi <b class="codi">${codi}</b>`;
      if (window.QRCode) new QRCode($('qr'), { text: `${location.origin}/aula?codi=${codi}`, width: 120, height: 120 });
      $('obre-projector').href = `/projector?codi=${codi}`;
      $('obre-projector').hidden = false;
      bucle();
    } else await post(`/api/aula/ordre?codi=${codi}`, { tipus: 'nova', config });
  } catch (e) { avis(e.message); return; }
  if (actual) fets.add(actual.id);
  actual = cas;
  vista = null;
  $('cas-actual').innerHTML = `<div class="cas-actual-cap"><span class="etiqueta-tipus">${TIPUS[cas.tipus || 'veu']}</span><h2>${esc(cas.titol)}</h2>
      ${cas.nivell && cas.tipus !== 'escenari' ? `<span class="suau">Resposta: <span class="nivell n${cas.nivell}">N${cas.nivell}</span></span>` : ''}</div>
    ${cas.tipus === 'veu' ? (cas.audio ? `<audio id="audio" controls preload="auto" src="/api/aula/audio?id=${encodeURIComponent(cas.id)}"></audio>` : '<p class="avis-cas">⚠ Aquest cas no té gravació.</p>') : ''}
    ${cas.carta ? `<p class="carta-text">${esc(cas.carta)}</p>` : ''}
    ${cas.notes ? `<p class="notes-tutor"><b>Notes:</b> ${esc(cas.notes)}</p>` : ''}`;
  clauUnitats = '';
  $('resultats').innerHTML = '';
  llistaCasos();
  boto();
  actualitza();
}
$('en-directe').onchange = () => render();

async function actualitza() {
  if (!codi) return;
  try {
    const r = await fetch(`/api/aula/tutor?codi=${codi}`, { cache: 'no-store' });
    if (r.ok) { vista = await r.json(); render(); }
  } catch { /* try again on the next tick */ }
}
function bucle() { actualitza().finally(() => setTimeout(bucle, 1000)); }

// What the students have to do in this case and how many are on each screen
function queFan(v) {
  if (v.config.tipus === 'escenari') {
    return `<h3>Què han de fer</h3><p>Per equips, en un tauler compartit: marcar quins incidents són <b>duplicats</b>, ordenar-los per <b>prioritat</b> i repartir les <b>unitats</b>. Confirmen quan la majoria de l'equip hi està d'acord.</p>
      <h3>Equips</h3>${estatEquips(v)}`;
  }
  const f = v.config.fases, p = v.progres, al = p.perPas || {};
  const pantalles = PANTALLES.filter(([id]) => f[id]);
  const files = pantalles.map(([id, nom, que]) => `<div class="pas-alumnes"><b>${nom}</b><span class="suau">${que}</span><span class="n-alumnes">${al[id] || 0}</span></div>`).join('');
  return `<h3>Què han de fer els alumnes</h3><div class="pas-alumnes-llista">
    ${al.inici ? `<div class="pas-alumnes"><b>Entrant</b><span class="suau">acaben de connectar-se</span><span class="n-alumnes">${al.inici}</span></div>` : ''}
    ${files}<div class="pas-alumnes acabat"><b>✓ Han acabat</b><span class="suau"></span><span class="n-alumnes">${p.acabats}</span></div></div>
    ${f.activacio ? `<p class="suau">🚑 Poden activar recursos en qualsevol moment: ${p.activats} ho han fet.</p>` : ''}
    <p class="suau">${p.connectats} alumnes connectats.</p>`;
}

function render() {
  const v = vista;
  if (!v) return;
  boto();
  // Clock: time left with a limit, or time running
  const rel = $('rellotge-classe');
  rel.hidden = v.estat !== 'oberta';
  if (v.estat === 'oberta') {
    rel.textContent = v.queden != null ? (v.queden ? `⏱ Queden ${mmss(v.queden)}` : '⏱ Temps esgotat') : `⏱ ${mmss(v.segons || 0)}`;
    rel.classList.toggle('poc', v.queden != null && v.queden <= 20);
  }
  $('que-fan').hidden = false;
  $('que-fan').innerHTML = queFan(v);
  const escenari = v.config.tipus === 'escenari';
  $('panell-unitats').hidden = escenari || v.estat === 'resultats';
  $('caixa-directe').hidden = escenari || v.estat !== 'oberta';
  if (escenari) {
    $('resultats').innerHTML = v.estat === 'resultats' ? `<div class="graella-xabcde">${panellsEscenari(v)}</div>` : '';
    return;
  }
  $('lloc').textContent = `· incident a ${v.config.lloc.municipi}`;
  renderUnitats(v);
  const veure = v.estat === 'resultats' || (v.estat === 'oberta' && $('en-directe').checked);
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
