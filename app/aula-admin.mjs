// Consultor training, case administration: prepare each case in advance (place, right level, XABCDE answers)
// and upload its recording to the server, so that in class the tutor only has to pick it.
import { $, esc, avis } from './client.mjs';
import { carregaMunicipis, lloc, pintaXabcde, llegeixXabcde } from './aula-editor.mjs';

let casos = [], actual = null, canvis = false;
const FASES = ['escolta', 'preguntes', 'instruccio', 'nivell', 'recursos', 'activacio'];
const PER_DEFECTE = { veu: FASES, carta: ['recursos'], escenari: [] };
const NOM_CAT = { SVA: 'SVA', SVB: 'SVB', HEMS: 'Helicòpter' };
// Units chosen by the tutor: candidates around the place and, per unit, whether it appears (and how) and if it is right
let candidates = [], estatUnitat = new Map(), correctes = new Set(), llocCandidates = '';
// Team scenario: its incidents (carta, municipi, level, priority, duplicate of, right units)
let incidents = [];
// Some systems give no type for audio files: take it from the extension
const PER_EXTENSIO = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', webm: 'audio/webm', aac: 'audio/aac', flac: 'audio/flac' };
const tipusAudio = f => (f.type && f.type !== 'application/octet-stream' ? f.type : PER_EXTENSIO[f.name.split('.').pop().toLowerCase()] || 'audio/mpeg');

async function carrega(id) {
  const r = await fetch('/api/aula/casos', { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status);
  ({ casos } = await r.json());
  llista();
  const triat = casos.find(c => c.id === id);
  if (triat) obre(triat);
}

function llista() {
  $('llista').innerHTML = casos.map((c, i) => `<button class="incident-fila ${c.id === actual?.id ? 'seleccionat' : ''}" data-id="${esc(c.id)}">
    <span><b>${i + 1}.</b> ${esc(c.titol)}</span><span>${c.nivell ? `<span class="nivell n${c.nivell}">N${c.nivell}</span>` : ''}</span>
    <span class="adreca">${esc(c.lloc?.municipi || 'sense municipi')} · ${c.tipus === 'escenari' ? `👥 escenari en equip · ${c.incidents?.length || 0} incidents` : c.tipus === 'carta' ? '📄 només carta' : c.audio ? '🔊 amb gravació' : '<b>sense gravació</b>'}</span></button>`).join('')
    || '<p class="suau">Encara no hi ha cap cas. Creeu-ne un amb «+ Cas nou».</p>';
  $('llista').querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
    if (canvis && !confirm('Hi ha canvis sense desar. Voleu canviar de cas igualment?')) return;
    obre(casos.find(c => c.id === b.dataset.id));
  });
}

function obre(c) {
  actual = c;
  canvis = false;
  const f = $('formulari');
  f.hidden = false;
  $('titol-form').textContent = c.id ? c.titol : 'Cas nou';
  f.titol.value = c.titol || '';
  f.municipi.value = c.lloc?.municipi || '';
  f.nivell.value = c.nivell || '';
  f.ordre.value = c.ordre && c.ordre < 999 ? c.ordre : '';
  f.notes.value = c.notes || '';
  f.tipus.value = c.tipus || 'veu';
  f.preguntes.value = c.preguntes || 3;
  const fases = c.fases || Object.fromEntries(FASES.map(x => [x, PER_DEFECTE[c.tipus || 'veu'].includes(x)]));
  for (const x of FASES) f[`f-${x}`].checked = !!fases[x];
  f['mode-recursos'].value = ['auto', 'nombre'].includes(c.recursos?.mode) ? c.recursos.mode : c.tipus === 'carta' ? 'nombre' : 'auto';
  for (const k of ['SVA', 'SVB', 'HEMS']) f[k].value = c.recursos?.[k] || 0;
  // Units chosen by the tutor, kept by call sign
  estatUnitat = new Map((c.unitats || []).map(u => [u.indicatiu, u.estat]));
  correctes = new Set(c.correctes || []);
  f['mode-unitats'].value = c.unitats?.length || c.tipus === 'escenari' ? 'tria' : 'auto';
  f.equips.value = c.equips || 4;
  incidents = structuredClone(c.incidents || []).map(x => ({ ...x, municipi: x.lloc?.municipi || '' }));
  candidates = [];
  llocCandidates = '';
  mostraCamps();
  f.carta.value = c.carta || '';
  f.audio.value = '';
  $('audio-actual').innerHTML = c.audio
    ? `<audio controls preload="none" src="/api/aula/audio?id=${encodeURIComponent(c.id)}&v=${Date.now()}"></audio>`
    : 'Encara no hi ha cap gravació.';
  $('esborra').hidden = $('duplica').hidden = !c.id;
  $('estat-desat').textContent = c.id ? '' : 'Cas nou: deseu-lo per guardar-lo.';
  pintaXabcde('xabcde', c.xabcde?.length ? c.xabcde : null);
  llista();
}

// Shows only what applies: the recording for voice cases, the XABCDE lists if an assessment screen is on, and either
// the units chosen by the tutor or the automatic right answer
function mostraCamps() {
  const f = $('formulari'), escenari = f.tipus.value === 'escenari', carta = f.tipus.value === 'carta' || escenari;
  if (escenari) f['mode-unitats'].value = 'tria';
  f.querySelectorAll('.nomes-veu').forEach(el => { el.hidden = carta; });
  f.querySelectorAll('.no-escenari').forEach(el => { el.hidden = escenari; });
  $('seccio-escenari').hidden = !escenari;
  if (escenari) pintaIncidents();
  $('seccio-xabcde').hidden = escenari || !['escolta', 'preguntes', 'instruccio'].some(x => f[`f-${x}`].checked);
  const tria = f['mode-unitats'].value === 'tria';
  $('editor-unitats').hidden = !tria;
  $('resposta-auto').hidden = tria;
  $('nombre-recursos').hidden = f['mode-recursos'].value !== 'nombre';
  if (tria) carregaCandidates();
}

$('formulari').onchange = e => {
  const f = $('formulari');
  // A new kind of case starts with its usual screens
  if (e.target.name === 'tipus') for (const x of FASES) f[`f-${x}`].checked = PER_DEFECTE[f.tipus.value].includes(x);
  if (e.target.name === 'tipus' && f.tipus.value === 'carta' && f['mode-recursos'].value === 'auto' && !f.nivell.value) f['mode-recursos'].value = 'nombre';
  mostraCamps();
};

async function carregaCandidates() {
  const llocTriat = lloc($('formulari').municipi.value);
  if (!llocTriat) { $('taula-unitats').innerHTML = '<p class="suau">Trieu primer el municipi.</p>'; return; }
  if (llocCandidates !== llocTriat.municipi) {
    llocCandidates = llocTriat.municipi;
    const r = await fetch('/api/aula/unitats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lloc: llocTriat }) });
    ({ unitats: candidates } = await r.json());
    // First time: the usual list (the nearest of each kind) free, the rest hidden
    if (!estatUnitat.size) {
      const quantes = { SVB: 6, SVA: 4, HEMS: 1 }, vistes = {};
      for (const u of candidates) if ((vistes[u.cat] = (vistes[u.cat] || 0) + 1) <= quantes[u.cat]) estatUnitat.set(u.indicatiu, 'lliure');
    }
  }
  pintaUnitats();
}

// One card per incident; the right units are chosen among the free units of the list
function pintaIncidents() {
  const lliures = candidates.filter(u => estatUnitat.get(u.indicatiu) === 'lliure');
  $('incidents-escenari').innerHTML = incidents.map((x, i) => `<div class="bloc incident-editor" data-i="${i}">
    <div class="fila"><b>Incident ${i + 1}</b>
      <label>Municipi <input data-camp="municipi" list="municipis" value="${esc(x.municipi || '')}"></label>
      <label>Nivell <select data-camp="nivell"><option value="">—</option>${[1, 2, 3, 4, 5].map(n => `<option ${Number(x.nivell) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Prioritat <input data-camp="prioritat" type="number" min="1" max="8" class="petit" value="${x.prioritat || ''}"></label>
      <label>Duplicat de <select data-camp="duplicatDe"><option value="">No és duplicat</option>${incidents.map((y, j) => (j === i ? '' : `<option value="${esc(y.id)}" ${x.duplicatDe === y.id ? 'selected' : ''}>Incident ${j + 1}</option>`)).join('')}</select></label>
      <button class="boto-petit" type="button" data-treu-incident="${i}">✕</button></div>
    <label>Carta del 112 <textarea data-camp="carta" rows="2">${esc(x.carta || '')}</textarea></label>
    <div class="correctes-escenari ${x.duplicatDe ? 'apagada' : ''}"><span class="suau">${x.duplicatDe ? 'Duplicat: no ha de rebre cap unitat' : 'Unitats correctes:'}</span>
      ${x.duplicatDe ? '' : lliures.map(u => `<label class="casella"><input type="checkbox" data-correcta-inc="${esc(u.indicatiu)}" ${(x.correctes || []).includes(u.indicatiu) ? 'checked' : ''}>
        <span class="cat-unitat cat-${u.cat}">${NOM_CAT[u.cat]}</span> ${esc(u.indicatiu)}</label>`).join('') || '<span class="suau">Trieu abans les unitats lliures a la llista de sota.</span>'}</div></div>`).join('')
    || '<p class="suau">Encara no hi ha cap incident.</p>';
  $('incidents-escenari').querySelectorAll('.incident-editor').forEach(el => {
    const x = incidents[Number(el.dataset.i)];
    el.querySelectorAll('[data-camp]').forEach(c => {
      c.oninput = c.onchange = e => {
        e.stopPropagation();
        x[c.dataset.camp] = c.value;
        canvis = true;
        if (c.dataset.camp === 'duplicatDe') pintaIncidents();
      };
    });
    el.querySelectorAll('[data-correcta-inc]').forEach(c => c.onchange = e => {
      e.stopPropagation();
      const set = new Set(x.correctes || []);
      c.checked ? set.add(c.dataset.correctaInc) : set.delete(c.dataset.correctaInc);
      x.correctes = [...set];
      canvis = true;
    });
  });
  $('incidents-escenari').querySelectorAll('[data-treu-incident]').forEach(b => b.onclick = () => {
    const [treta] = incidents.splice(Number(b.dataset.treuIncident), 1);
    for (const x of incidents) if (x.duplicatDe === treta.id) x.duplicatDe = '';
    canvis = true;
    pintaIncidents();
  });
}
$('afegeix-incident').onclick = () => {
  if (incidents.length >= 8) { avis('Com a màxim 8 incidents'); return; }
  let n = incidents.length + 1;
  while (incidents.some(x => x.id === `i${n}`)) n++;
  incidents.push({ id: `i${n}`, carta: '', municipi: $('formulari').municipi.value, nivell: '', prioritat: incidents.length + 1, duplicatDe: '', correctes: [] });
  canvis = true;
  pintaIncidents();
};

function pintaUnitats() {
  const escenari = $('formulari').tipus.value === 'escenari';
  $('taula-unitats').innerHTML = `<table class="mini ${escenari ? 'sense-correcta' : ''}"><tr><th>Unitat</th><th>Base</th><th>Arribada</th><th>Surt a la llista</th><th>Correcta</th></tr>
    ${candidates.map(u => {
      const estat = estatUnitat.get(u.indicatiu) || 'no';
      return `<tr class="${estat === 'no' ? 'apagada' : ''}"><td><span class="cat-unitat cat-${u.cat}">${NOM_CAT[u.cat]}</span> <b>${esc(u.indicatiu)}</b> <span class="suau">${esc(u.tipus)}</span></td>
        <td>${esc(u.base)} <span class="suau">· ${u.km} km</span></td><td>${u.eta} min</td>
        <td><select data-estat="${esc(u.indicatiu)}">${[['no', 'No surt'], ['lliure', 'Lliure'], ['ocupada', 'Ocupada']].map(([v, t]) => `<option value="${v}" ${v === estat ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><input type="checkbox" data-correcta="${esc(u.indicatiu)}" ${correctes.has(u.indicatiu) ? 'checked' : ''} ${estat === 'lliure' ? '' : 'disabled'}></td></tr>`;
    }).join('')}</table>
    ${escenari ? '<p class="suau">Les unitats correctes es marquen a cada incident.</p>' : `<p class="suau">Resposta correcta: <b>${esc(resumCorrectes())}</b></p>`}`;
  if (escenari) pintaIncidents();
  $('taula-unitats').querySelectorAll('[data-estat]').forEach(el => el.onchange = e => {
    e.stopPropagation();
    el.value === 'no' ? estatUnitat.delete(el.dataset.estat) : estatUnitat.set(el.dataset.estat, el.value);
    if (el.value !== 'lliure') correctes.delete(el.dataset.estat);
    canvis = true;
    pintaUnitats();
  });
  $('taula-unitats').querySelectorAll('[data-correcta]').forEach(el => el.onchange = e => {
    e.stopPropagation();
    el.checked ? correctes.add(el.dataset.correcta) : correctes.delete(el.dataset.correcta);
    canvis = true;
    pintaUnitats();
  });
}

function resumCorrectes() {
  const n = {};
  for (const id of correctes) { const u = candidates.find(x => x.indicatiu === id); if (u) n[u.cat] = (n[u.cat] || 0) + 1; }
  return Object.keys(NOM_CAT).filter(c => n[c]).map(c => `${n[c]} ${NOM_CAT[c]}`).join(' + ') || 'cap recurs';
}

$('formulari').municipi.addEventListener('change', () => { if ($('formulari')['mode-unitats'].value === 'tria') carregaCandidates(); });
$('restaura-xabcde').onclick = () => { if (confirm('Substituir les llistes del XABCDE per les de per defecte?')) { pintaXabcde('xabcde', null); canvis = true; } };

$('formulari').oninput = () => { canvis = true; $('estat-desat').textContent = 'Canvis sense desar'; };
$('nou').onclick = () => { if (!canvis || confirm('Hi ha canvis sense desar. Continuar?')) obre({ ordre: casos.length + 1 }); };
$('duplica').onclick = () => obre({ ...actual, id: null, titol: `${actual.titol} (còpia)`, audio: null, ordre: casos.length + 1 });

$('formulari').onsubmit = async e => {
  e.preventDefault();
  const f = $('formulari');
  const llocTriat = lloc(f.municipi.value);
  if (!llocTriat) { avis('Trieu un municipi de la llista'); return; }
  const mode = f['mode-recursos'].value, tria = f['mode-unitats'].value === 'tria';
  const fases = Object.fromEntries(FASES.map(x => [x, f[`f-${x}`].checked]));
  if (f.tipus.value !== 'escenari' && !FASES.some(x => x !== 'activacio' && fases[x])) { avis('Trieu almenys una pantalla per als alumnes'); return; }
  if (tria && !estatUnitat.size) { avis('Trieu almenys una unitat que surti a la llista'); return; }
  const escenari = f.tipus.value === 'escenari';
  if (escenari) {
    if (incidents.length < 2) { avis('Un escenari necessita almenys 2 incidents'); return; }
    const sense = incidents.findIndex(x => !lloc(x.municipi) || !String(x.carta || '').trim());
    if (sense >= 0) { avis(`A l'incident ${sense + 1} li falta la carta o un municipi de la llista`); return; }
  }
  const cas = { id: actual.id, tipus: f.tipus.value, preguntes: Number(f.preguntes.value) || 3, fases, equips: Number(f.equips.value) || 4,
    incidents: escenari ? incidents.map(({ id, carta, municipi, nivell, prioritat, duplicatDe, correctes: bones }) => ({ id, carta, lloc: lloc(municipi), nivell: Number(nivell) || null,
      prioritat: Number(prioritat) || null, duplicatDe: duplicatDe || null, correctes: duplicatDe ? [] : (bones || []).filter(u => estatUnitat.get(u) === 'lliure') })) : undefined,
    unitats: tria ? [...estatUnitat].map(([indicatiu, estat]) => ({ indicatiu, estat })) : [],
    correctes: tria ? [...correctes].filter(id => estatUnitat.get(id) === 'lliure') : [],
    recursos: tria ? { mode: 'manual' } : mode === 'nombre' ? { mode, SVA: Number(f.SVA.value), SVB: Number(f.SVB.value), HEMS: Number(f.HEMS.value) } : { mode },
    titol: f.titol.value, carta: f.carta.value, lloc: llocTriat, nivell: f.nivell.value ? Number(f.nivell.value) : null,
    ordre: f.ordre.value ? Number(f.ordre.value) : undefined, notes: f.notes.value, xabcde: llegeixXabcde('xabcde') };
  $('estat-desat').textContent = 'Desant...';
  try {
    let r = await fetch('/api/aula/casos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cas }) });
    let d = await r.json();
    if (!r.ok) throw new Error(d.error);
    const fitxer = f.audio.files[0];
    if (fitxer) {
      $('estat-desat').textContent = `Pujant la gravació (${Math.round(fitxer.size / 1024)} kB)...`;
      r = await fetch(`/api/aula/audio?id=${encodeURIComponent(d.cas.id)}`, { method: 'POST', headers: { 'Content-Type': tipusAudio(fitxer) }, body: fitxer });
      d = await r.json();
      if (!r.ok) throw new Error(d.error);
    }
    canvis = false;
    await carrega(d.cas.id);
    $('estat-desat').textContent = 'Desat ✓';
  } catch (err) { $('estat-desat').textContent = `No s'ha desat: ${err.message}`; }
};

$('esborra').onclick = async () => {
  if (!confirm(`Esborrar el cas «${actual.titol}» i la seva gravació?`)) return;
  const r = await fetch('/api/aula/casos/esborra', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: actual.id }) });
  if (!r.ok) { avis((await r.json()).error); return; }
  actual = null;
  canvis = false;
  $('formulari').hidden = true;
  await carrega();
};

window.addEventListener('beforeunload', e => { if (canvis) e.preventDefault(); });
Promise.all([carregaMunicipis('municipis'), carrega()])
  .catch(() => { $('error').textContent = 'Cal entrar amb la contrasenya (torneu a la pàgina inicial).'; });
