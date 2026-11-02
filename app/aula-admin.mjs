// Consultor training, case administration: prepare each case in advance (place, right level, XABCDE answers)
// and upload its recording to the server, so that in class the tutor only has to pick it.
import { $, esc, avis } from './client.mjs';
import { carregaMunicipis, lloc, pintaXabcde, llegeixXabcde } from './aula-editor.mjs';

let casos = [], actual = null, canvis = false;
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
    <span class="adreca">${esc(c.lloc?.municipi || 'sense municipi')} · ${c.audio ? '🔊 amb gravació' : '<b>sense gravació</b>'}</span></button>`).join('')
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

$('formulari').oninput = () => { canvis = true; $('estat-desat').textContent = 'Canvis sense desar'; };
$('nou').onclick = () => { if (!canvis || confirm('Hi ha canvis sense desar. Continuar?')) obre({ ordre: casos.length + 1 }); };
$('duplica').onclick = () => obre({ ...actual, id: null, titol: `${actual.titol} (còpia)`, audio: null, ordre: casos.length + 1 });

$('formulari').onsubmit = async e => {
  e.preventDefault();
  const f = $('formulari');
  const llocTriat = lloc(f.municipi.value);
  if (!llocTriat) { avis('Trieu un municipi de la llista'); return; }
  const cas = { id: actual.id, titol: f.titol.value, carta: f.carta.value, lloc: llocTriat, nivell: f.nivell.value ? Number(f.nivell.value) : null,
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
