// Consultor training, cases of the class: create and edit them in advance (recording, 112 card or team scenario),
// in the order they will be played, so that in class the tutor only has to put them on.
import { $, esc, avis } from './client.mjs';
import { carregaMunicipis, lloc, pintaXabcde, llegeixXabcde, seccionsVisibles, carregaInterrogatori, aplicaInterrogatori } from './aula-editor.mjs';
import { obreInterrogatori, desaInterrogatori, restauraInterrogatori } from './aula-interrogatori.mjs';

const FASES = ['escolta', 'preguntes', 'instruccio', 'nivell', 'recursos', 'activacio'];
const PER_DEFECTE = { veu: FASES, carta: ['recursos'], escenari: [] };
const TIPUS = { veu: '🔊 Gravació', carta: '📄 Carta del 112', escenari: '👥 Escenari en equip' };
const NOM_CAT = { SVA: 'SVA', SVB: 'SVB', HEMS: 'Helicòpter' };
// The XABCDE sections each screen uses
const SECCIONS_FASE = { escolta: ['signes', 'noavaluable'], preguntes: ['anamnesi'], instruccio: ['maniobres'] };
const EXPLICA = {
  escolta: 'marquen què han sentit a cada lletra', preguntes: 'trien unes poques preguntes clau', instruccio: 'trien la primera instrucció a l\'alertant',
  nivell: 'posen el nivell', recursos: 'trien les unitats', activacio: 'poden activar recursos en qualsevol moment i es registra quan',
};
// Some systems give no type for audio files: take it from the extension
const PER_EXTENSIO = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', webm: 'audio/webm', aac: 'audio/aac', flac: 'audio/flac' };
const tipusAudio = f => (f.type && f.type !== 'application/octet-stream' ? f.type : PER_EXTENSIO[f.name.split('.').pop().toLowerCase()] || 'audio/mpeg');

let casos = [], actual = null, canvis = false, fases = {};
let audioNou = null, urlAudioNou = null;   // recording chosen or dropped, uploaded when the case is saved
// Units chosen by the tutor: candidates around the place and, per unit, whether it appears (and how) and if it is right
let candidates = [], estatUnitat = new Map(), correctes = new Set(), llocCandidates = '';
// Team scenario: its incidents (carta, municipi, level, priority, duplicate of, right units)
let incidents = [];
const f = $('formulari');
const tipus = () => f.tipus.value;
const modificat = () => { canvis = true; $('estat-desat').textContent = 'Canvis sense desar'; };

// ---------- list of cases, in class order ----------

async function carrega(id) {
  const r = await fetch('/api/aula/casos', { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status);
  ({ casos } = await r.json());
  llista();
  const triat = casos.find(c => c.id === id);
  if (triat) obre(triat);
}

const avisos = c => ((c.tipus || 'veu') === 'veu' && !c.audio ? '⚠ falta la gravació' : c.tipus === 'escenari' && (c.incidents?.length || 0) < 2 ? '⚠ calen incidents' : '');

function llista() {
  $('llista').innerHTML = casos.map((c, i) => `<div class="cas-fila ${c.id === actual?.id ? 'seleccionat' : ''}">
    <div class="mou-cas"><button data-puja="${i}" ${i ? '' : 'disabled'} title="Abans">▲</button><button data-baixa="${i}" ${i < casos.length - 1 ? '' : 'disabled'} title="Després">▼</button></div>
    <button class="cas-obre" data-id="${esc(c.id)}"><span class="num-cas">${i + 1}</span>
      <span><b>${esc(c.titol)}</b><br><span class="suau">${TIPUS[c.tipus || 'veu']} · ${esc(c.lloc?.municipi || '')}${c.temps ? ` · ⏱ ${Math.floor(c.temps / 60)}:${String(c.temps % 60).padStart(2, '0')}` : ''}</span> <span class="avis-cas">${avisos(c)}</span></span></button></div>`).join('')
    || '<p class="suau">Encara no hi ha cap cas.</p>';
  $('llista').querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
    if (canvis && !confirm('Hi ha canvis sense desar. Voleu canviar de cas igualment?')) return;
    obre(casos.find(c => c.id === b.dataset.id));
  });
  $('llista').querySelectorAll('[data-puja]').forEach(b => b.onclick = () => mou(Number(b.dataset.puja), -1));
  $('llista').querySelectorAll('[data-baixa]').forEach(b => b.onclick = () => mou(Number(b.dataset.baixa), 1));
}

// Moves a case up or down and saves the new order of every case
async function mou(i, pas) {
  const ordre = [...casos];
  [ordre[i], ordre[i + pas]] = [ordre[i + pas], ordre[i]];
  casos = ordre;
  llista();
  await Promise.all(ordre.map((c, k) => (c.ordre === k + 1 ? null
    : fetch('/api/aula/casos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cas: { ...c, ordre: k + 1 } }) }))));
  if (!canvis) await carrega(actual?.id);
}

// ---------- new case: first its kind ----------

$('nou').onclick = () => {
  if (canvis && !confirm('Hi ha canvis sense desar. Continuar?')) return;
  actual = null;
  canvis = false;
  $('editor-interrogatori').hidden = true;
  $('benvinguda').hidden = true;
  f.hidden = true;
  $('tria-tipus').hidden = false;
  llista();
};
document.querySelectorAll('[data-tipus]').forEach(b => b.onclick = () => {
  $('tria-tipus').hidden = true;
  obre({ tipus: b.dataset.tipus, ordre: casos.length + 1 });
  f.titol.focus();
});

// ---------- form ----------

function obre(c) {
  actual = c;
  canvis = false;
  $('editor-interrogatori').hidden = true;
  $('benvinguda').hidden = true;
  $('tria-tipus').hidden = true;
  f.hidden = false;
  f.tipus.value = c.tipus || 'veu';
  $('etiqueta-tipus').textContent = TIPUS[tipus()];
  $('titol-form').textContent = c.id ? c.titol : 'Cas nou';
  f.titol.value = c.titol || '';
  f.municipi.value = c.lloc?.municipi || '';
  f.nivell.value = c.nivell || '';
  f.carta.value = c.carta || '';
  f.notes.value = c.notes || '';
  f.temps.value = c.temps || '';
  f.preguntes.value = c.preguntes || 3;
  f.equips.value = c.equips || 4;
  f.audio.value = '';
  posaAudioNou(null);
  fases = { ...(c.fases || Object.fromEntries(FASES.map(x => [x, PER_DEFECTE[tipus()].includes(x)]))) };
  f['mode-recursos'].value = ['auto', 'nombre'].includes(c.recursos?.mode) ? c.recursos.mode : tipus() === 'carta' ? 'nombre' : 'auto';
  for (const k of ['SVA', 'SVB', 'HEMS']) f[k].value = c.recursos?.[k] || 0;
  estatUnitat = new Map((c.unitats || []).map(u => [u.indicatiu, u.estat]));
  correctes = new Set(c.correctes || []);
  f.querySelector(`[name=mode-unitats][value=${c.unitats?.length || tipus() === 'escenari' ? 'tria' : 'auto'}]`).checked = true;
  incidents = structuredClone(c.incidents || []).map(x => ({ ...x, municipi: x.lloc?.municipi || '' }));
  candidates = [];
  llocCandidates = '';
  $('esborra').hidden = $('duplica').hidden = !c.id;
  pintaXabcde('xabcde', c.xabcde?.length ? c.xabcde : null, modificat);
  if (tipus() === 'escenari' && !incidents.length) { afegeixIncident(); afegeixIncident(); }
  canvis = false;
  $('estat-desat').textContent = c.id ? '' : 'Cas nou: deseu-lo per guardar-lo';
  mostraCamps();
  llista();
}

// Shows only what applies to the kind of case and the screens chosen
function mostraCamps() {
  const t = tipus(), escenari = t === 'escenari';
  f.querySelectorAll('.nomes-veu').forEach(el => { el.hidden = t !== 'veu'; });
  f.querySelectorAll('.nomes-sol').forEach(el => { el.hidden = escenari; });
  f.querySelectorAll('.nomes-escenari').forEach(el => { el.hidden = !escenari; });
  $('titol-pas1').textContent = escenari ? 'L\'escenari' : 'Què passa';
  $('etiqueta-municipi').textContent = escenari ? 'Zona de les unitats (municipi)' : 'Municipi de l\'incident';
  f.querySelectorAll('[data-fase]').forEach(b => b.classList.toggle('actiu', !!fases[b.dataset.fase]));
  const triades = FASES.filter(x => fases[x]);
  $('explica-fases').textContent = triades.length ? `Els alumnes ${triades.map(x => EXPLICA[x]).join(', ')}.` : 'Trieu almenys una pantalla.';
  $('camp-preguntes').hidden = !fases.preguntes;
  const ambXabcde = Object.keys(SECCIONS_FASE).filter(x => fases[x]);
  $('pas-xabcde').hidden = escenari || !ambXabcde.length;
  seccionsVisibles(ambXabcde.flatMap(x => SECCIONS_FASE[x]));
  $('num-unitats').textContent = escenari ? '2' : ambXabcde.length ? '4' : '3';
  const tria = escenari || f.querySelector('[name=mode-unitats]:checked').value === 'tria';
  $('editor-unitats').hidden = !tria;
  $('resposta-auto').hidden = escenari || tria;
  $('nombre-recursos').hidden = f['mode-recursos'].value !== 'nombre';
  $('explica-unitats').textContent = escenari ? 'Les unitats que comparteixen tots els incidents: poques, perquè hagin de prioritzar. Les correctes es marquen a cada incident.'
    : 'Trieu si cada unitat surt a la llista i si és lliure o ocupada, i marqueu les correctes (cap = no cal recurs).';
  if (tria) carregaCandidates();
  if (escenari) pintaIncidents();
}

f.querySelectorAll('[data-fase]').forEach(b => b.onclick = () => { fases[b.dataset.fase] = !fases[b.dataset.fase]; modificat(); mostraCamps(); });
f.addEventListener('change', e => { if (['mode-unitats', 'mode-recursos'].includes(e.target.name)) mostraCamps(); });
f.addEventListener('input', modificat);
f.municipi.addEventListener('change', () => { if (!$('editor-unitats').hidden) carregaCandidates(); });
// ---------- recording: drop the file or choose it, and listen to it before and after saving ----------

function posaAudioNou(fitxer) {
  if (urlAudioNou) URL.revokeObjectURL(urlAudioNou);
  audioNou = fitxer;
  urlAudioNou = fitxer ? URL.createObjectURL(fitxer) : null;
  const desada = actual?.audio ? `/api/aula/audio?id=${encodeURIComponent(actual.id)}&v=${Date.now()}` : null;
  $('audio-actual').innerHTML = fitxer
    ? `<audio controls preload="metadata" src="${urlAudioNou}"></audio><span class="nova-gravacio">Nova: ${esc(fitxer.name)} · es pujarà en desar</span>
       <button type="button" class="boto-petit" id="descarta-audio">✕ Descartar</button>`
    : desada ? `<audio controls preload="metadata" src="${desada}"></audio><span class="suau">Gravació desada</span>` : '<span class="suau">Encara no n\'hi ha cap.</span>';
  $('text-zona').textContent = fitxer || desada ? '🎙 Arrossegueu-hi un altre fitxer per substituir-la, o feu clic' : '🎙 Arrossegueu aquí el fitxer de la gravació, o feu clic per triar-lo';
  $('descarta-audio')?.addEventListener('click', () => { f.audio.value = ''; posaAudioNou(null); });
}

function triaAudio(fitxer) {
  if (!fitxer) return;
  if (!/^audio\//.test(fitxer.type) && !PER_EXTENSIO[fitxer.name.split('.').pop().toLowerCase()]) { avis('Això no sembla un fitxer d\'àudio (mp3, wav, m4a, ogg...)'); return; }
  if (fitxer.size > 40 * 1024 * 1024) { avis('L\'àudio és massa gran (màxim 40 MB)'); return; }
  posaAudioNou(fitxer);
  modificat();
}

f.audio.onchange = () => triaAudio(f.audio.files[0]);
const zona = $('zona-audio');
zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('sobre'); });
zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
zona.addEventListener('drop', e => { e.preventDefault(); zona.classList.remove('sobre'); triaAudio(e.dataTransfer.files[0]); });
// A file dropped anywhere else must not make the browser leave the page
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

// ---------- units chosen by the tutor ----------

async function carregaCandidates() {
  const llocTriat = lloc(f.municipi.value);
  if (!llocTriat) { $('taula-unitats').innerHTML = '<p class="suau">Trieu primer el municipi.</p>'; return; }
  // Same place and already drawn: nothing to redraw (it would steal the click from the field being edited)
  if (llocCandidates === llocTriat.municipi && $('taula-unitats').querySelector('table')) return;
  if (llocCandidates !== llocTriat.municipi) {
    llocCandidates = llocTriat.municipi;
    const r = await fetch('/api/aula/unitats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lloc: llocTriat }) });
    ({ unitats: candidates } = await r.json());
    // First time: the usual list (the nearest of each kind) free, the rest hidden
    if (!estatUnitat.size) {
      const quantes = tipus() === 'escenari' ? { SVB: 3, SVA: 2, HEMS: 1 } : { SVB: 6, SVA: 4, HEMS: 1 }, vistes = {};
      for (const u of candidates) if ((vistes[u.cat] = (vistes[u.cat] || 0) + 1) <= quantes[u.cat]) estatUnitat.set(u.indicatiu, 'lliure');
    }
  }
  pintaUnitats();
}

function pintaUnitats() {
  const escenari = tipus() === 'escenari';
  $('taula-unitats').innerHTML = `<table class="mini ${escenari ? 'sense-correcta' : ''}"><tr><th>Unitat</th><th>Base</th><th>Arribada</th><th>A la llista</th><th>Correcta</th></tr>
    ${candidates.map(u => {
      const estat = estatUnitat.get(u.indicatiu) || 'no';
      return `<tr class="${estat === 'no' ? 'apagada' : ''}"><td><span class="cat-unitat cat-${u.cat}">${NOM_CAT[u.cat]}</span> <b>${esc(u.indicatiu)}</b> <span class="suau">${esc(u.tipus)}</span></td>
        <td>${esc(u.base)} <span class="suau">· ${u.km} km</span></td><td>${u.eta} min</td>
        <td><select data-estat="${esc(u.indicatiu)}">${[['no', 'No surt'], ['lliure', 'Lliure'], ['ocupada', 'Ocupada']].map(([v, t]) => `<option value="${v}" ${v === estat ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><input type="checkbox" data-correcta="${esc(u.indicatiu)}" ${correctes.has(u.indicatiu) ? 'checked' : ''} ${estat === 'lliure' ? '' : 'disabled'}></td></tr>`;
    }).join('')}</table>
    ${escenari ? '' : `<p>Resposta correcta: <b>${esc(resumCorrectes())}</b></p>`}`;
  $('taula-unitats').querySelectorAll('[data-estat]').forEach(el => el.onchange = e => {
    e.stopPropagation();
    el.value === 'no' ? estatUnitat.delete(el.dataset.estat) : estatUnitat.set(el.dataset.estat, el.value);
    if (el.value !== 'lliure') correctes.delete(el.dataset.estat);
    modificat();
    pintaUnitats();
  });
  $('taula-unitats').querySelectorAll('[data-correcta]').forEach(el => el.onchange = e => {
    e.stopPropagation();
    el.checked ? correctes.add(el.dataset.correcta) : correctes.delete(el.dataset.correcta);
    modificat();
    pintaUnitats();
  });
  if (escenari) pintaIncidents();
}

function resumCorrectes() {
  const n = {};
  for (const id of correctes) { const u = candidates.find(x => x.indicatiu === id); if (u) n[u.cat] = (n[u.cat] || 0) + 1; }
  return Object.keys(NOM_CAT).filter(c => n[c]).map(c => `${n[c]} ${NOM_CAT[c]}`).join(' + ') || 'cap recurs';
}

// ---------- team scenario: incidents ----------

function afegeixIncident() {
  if (incidents.length >= 8) { avis('Com a màxim 8 incidents'); return; }
  let n = incidents.length + 1;
  while (incidents.some(x => x.id === `i${n}`)) n++;
  incidents.push({ id: `i${n}`, carta: '', municipi: f.municipi.value, nivell: '', prioritat: incidents.length + 1, duplicatDe: '', correctes: [] });
  modificat();
}
$('afegeix-incident').onclick = () => { afegeixIncident(); pintaIncidents(); };

function pintaIncidents() {
  // Redrawing must not take the cursor away from the field being typed in
  const enFocus = document.activeElement?.closest?.('.incident-editor') && document.activeElement.dataset.camp
    ? { i: document.activeElement.closest('.incident-editor').dataset.i, camp: document.activeElement.dataset.camp, pos: document.activeElement.selectionStart } : null;
  const lliures = candidates.filter(u => estatUnitat.get(u.indicatiu) === 'lliure');
  $('incidents-escenari').innerHTML = incidents.map((x, i) => `<div class="incident-editor" data-i="${i}">
    <div class="inc-editor-cap"><b>Incident ${i + 1}</b><button class="boto-petit" type="button" data-treu-incident="${i}">✕ Treure</button></div>
    <label>Carta del 112 <textarea data-camp="carta" rows="2" placeholder="Què diu el 112 d'aquest incident">${esc(x.carta || '')}</textarea></label>
    <div class="fila">
      <label>Municipi <input data-camp="municipi" list="municipis" value="${esc(x.municipi || '')}"></label>
      <label>Nivell <select data-camp="nivell"><option value="">—</option>${[1, 2, 3, 4, 5].map(n => `<option ${Number(x.nivell) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>És el mateix servei que... <select data-camp="duplicatDe"><option value="">No, és un incident diferent</option>${incidents.map((y, j) => (j === i ? '' : `<option value="${esc(y.id)}" ${x.duplicatDe === y.id ? 'selected' : ''}>Incident ${j + 1}</option>`)).join('')}</select></label>
      ${x.duplicatDe ? '' : `<label>Prioritat <input data-camp="prioritat" type="number" min="1" max="8" class="petit" value="${x.prioritat || ''}"></label>`}
    </div>
    <div class="correctes-escenari">${x.duplicatDe ? '<span class="suau">🔁 Duplicat: no ha de rebre cap unitat.</span>'
      : `<span class="suau">Unitats correctes:</span> ${lliures.map(u => `<button type="button" class="xip-boto ${(x.correctes || []).includes(u.indicatiu) ? 'correcte' : ''}" data-correcta-inc="${esc(u.indicatiu)}">
        <span class="cat-unitat cat-${u.cat}">${NOM_CAT[u.cat]}</span> ${esc(u.indicatiu)}</button>`).join('') || '<span class="suau">Trieu abans les unitats lliures (pas 2).</span>'}`}</div></div>`).join('');
  $('incidents-escenari').querySelectorAll('.incident-editor').forEach(el => {
    const x = incidents[Number(el.dataset.i)];
    el.querySelectorAll('[data-camp]').forEach(c => {
      c.oninput = c.onchange = e => {
        e.stopPropagation();
        x[c.dataset.camp] = c.value;
        modificat();
        if (c.dataset.camp === 'duplicatDe' && e.type === 'change') pintaIncidents();
      };
    });
    el.querySelectorAll('[data-correcta-inc]').forEach(b => b.onclick = () => {
      const set = new Set(x.correctes || []);
      set.has(b.dataset.correctaInc) ? set.delete(b.dataset.correctaInc) : set.add(b.dataset.correctaInc);
      x.correctes = [...set];
      modificat();
      pintaIncidents();
    });
  });
  if (enFocus) {
    const el = $('incidents-escenari').querySelector(`.incident-editor[data-i="${enFocus.i}"] [data-camp="${enFocus.camp}"]`);
    el?.focus();
    try { if (enFocus.pos != null) el.setSelectionRange(enFocus.pos, enFocus.pos); } catch { /* selects have no caret */ }
  }
  $('incidents-escenari').querySelectorAll('[data-treu-incident]').forEach(b => b.onclick = () => {
    const [treta] = incidents.splice(Number(b.dataset.treuIncident), 1);
    for (const x of incidents) if (x.duplicatDe === treta.id) x.duplicatDe = '';
    modificat();
    pintaIncidents();
  });
}

// ---------- save, duplicate, delete ----------

function cas() {
  const t = tipus(), escenari = t === 'escenari';
  const tria = escenari || f.querySelector('[name=mode-unitats]:checked').value === 'tria';
  const mode = f['mode-recursos'].value;
  return {
    id: actual.id, tipus: t, titol: f.titol.value, lloc: lloc(f.municipi.value), carta: escenari ? '' : f.carta.value, notes: f.notes.value,
    nivell: !escenari && f.nivell.value ? Number(f.nivell.value) : null, preguntes: Number(f.preguntes.value) || 3, ordre: actual.ordre,
    temps: Number(f.temps.value) || 0, fases: escenari ? {} : { ...fases }, equips: Number(f.equips.value) || 4, xabcde: escenari ? [] : llegeixXabcde(),
    unitats: tria ? [...estatUnitat].map(([indicatiu, estat]) => ({ indicatiu, estat })) : [],
    correctes: tria && !escenari ? [...correctes].filter(id => estatUnitat.get(id) === 'lliure') : [],
    recursos: tria ? { mode: 'manual' } : mode === 'nombre' ? { mode, SVA: Number(f.SVA.value), SVB: Number(f.SVB.value), HEMS: Number(f.HEMS.value) } : { mode },
    incidents: escenari ? incidents.map(({ id, carta, municipi, nivell, prioritat, duplicatDe, correctes: bones }) => ({ id, carta, lloc: lloc(municipi), nivell: Number(nivell) || null,
      prioritat: Number(prioritat) || null, duplicatDe: duplicatDe || null, correctes: duplicatDe ? [] : (bones || []).filter(u => estatUnitat.get(u) === 'lliure') })) : undefined,
  };
}

function valida(c) {
  if (!c.titol.trim()) return 'Poseu un títol';
  if (!c.lloc) return 'Trieu un municipi de la llista';
  if (c.tipus !== 'escenari' && !FASES.some(x => x !== 'activacio' && fases[x])) return 'Trieu almenys una pantalla per als alumnes (pas 2)';
  if (c.unitats.length === 0 && (c.tipus === 'escenari' || c.recursos.mode === 'manual')) return 'Trieu almenys una unitat que surti a la llista';
  if (c.tipus === 'escenari') {
    if (c.incidents.length < 2) return 'Un escenari necessita almenys 2 incidents';
    const i = c.incidents.findIndex(x => !x.lloc || !x.carta.trim());
    if (i >= 0) return `A l'incident ${i + 1} li falta la carta o un municipi de la llista`;
  }
  return null;
}

f.onsubmit = async e => {
  e.preventDefault();
  const c = cas(), error = valida(c);
  if (error) { avis(error); return; }
  $('estat-desat').textContent = 'Desant...';
  try {
    let r = await fetch('/api/aula/casos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cas: c }) });
    let d = await r.json();
    if (!r.ok) throw new Error(d.error);
    const fitxer = audioNou;
    if (fitxer && c.tipus === 'veu') {
      $('estat-desat').textContent = `Pujant la gravació (${Math.round(fitxer.size / 1024)} kB)...`;
      r = await fetch(`/api/aula/audio?id=${encodeURIComponent(d.cas.id)}`, { method: 'POST', headers: { 'Content-Type': tipusAudio(fitxer) }, body: fitxer });
      d = await r.json();
      if (!r.ok) throw new Error(d.error);
    }
    canvis = false;
    audioNou = null;
    await carrega(d.cas.id);
    $('estat-desat').textContent = 'Desat ✓';
  } catch (err) { $('estat-desat').textContent = `No s'ha desat: ${err.message}`; }
};

$('duplica').onclick = () => { const c = cas(); obre({ ...c, id: null, titol: `${c.titol} (còpia)`, audio: null, ordre: casos.length + 1 }); modificat(); };

$('esborra').onclick = async () => {
  if (!confirm(`Esborrar el cas «${actual.titol}»${actual.audio ? ' i la seva gravació' : ''}?`)) return;
  const r = await fetch('/api/aula/casos/esborra', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: actual.id }) });
  if (!r.ok) { avis((await r.json()).error); return; }
  actual = null;
  canvis = false;
  f.hidden = true;
  $('benvinguda').hidden = false;
  await carrega();
};

// ---------- base questioning, outside the cases ----------

$('obre-interrogatori').onclick = async () => {
  if (canvis && !confirm('Hi ha canvis sense desar al cas. Continuar?')) return;
  canvis = false;
  actual = null;
  f.hidden = true;
  $('tria-tipus').hidden = true;
  $('benvinguda').hidden = true;
  $('editor-interrogatori').hidden = false;
  llista();
  await obreInterrogatori('blocs-interrogatori');
};
$('desa-interrogatori').onclick = async () => {
  if (await desaInterrogatori()) { await carregaInterrogatori(); avis('Interrogatori base desat: els casos nous el faran servir'); }
};
$('restaura-interrogatori').onclick = () => { if (confirm('Tornar a l\'interrogatori de per defecte? (No es desa fins que premeu «Desar».)')) restauraInterrogatori('blocs-interrogatori'); };
$('tanca-interrogatori').onclick = () => { $('editor-interrogatori').hidden = true; $('benvinguda').hidden = false; };
$('aplica-interrogatori').onclick = () => {
  if (confirm('Substituir les llistes d\'aquest cas per l\'interrogatori base? Es mantenen com a correctes els elements amb el mateix text.')) aplicaInterrogatori();
};

// ---------- preview: the case as a student sees it, from the form as it is now ----------

let codiProva = null;
async function obreProva() {
  const c = cas();
  if (!c.lloc) { avis('Trieu primer el municipi'); return; }
  const config = { ...c, temps: c.temps };
  try {
    const r = await fetch('/api/aula/nova', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) });
    ({ codi: codiProva } = await r.json());
    await fetch(`/api/aula/ordre?codi=${codiProva}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipus: 'obre' }) });
  } catch { avis('No s\'ha pogut obrir la prova'); return; }
  $('mobil-prova').src = `/aula?codi=${codiProva}&prova=1`;
  $('prova-projector').href = `/projector?codi=${codiProva}`;
  $('capa-prova').hidden = false;
}
$('previsualitza').onclick = obreProva;
$('prova-reinicia').onclick = obreProva;
$('prova-resultats').onclick = () => fetch(`/api/aula/ordre?codi=${codiProva}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipus: 'resultats' }) });
$('prova-tanca').onclick = () => { $('capa-prova').hidden = true; $('mobil-prova').src = 'about:blank'; };

window.addEventListener('beforeunload', e => { if (canvis) e.preventDefault(); });
Promise.all([carregaMunicipis('municipis'), carregaInterrogatori(), carrega()])
  .catch(() => { $('error').textContent = 'Cal entrar amb la contrasenya (torneu a la pàgina inicial).'; });
