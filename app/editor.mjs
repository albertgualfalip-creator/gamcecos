// Case editor for tutors: every option can be marked optimal, acceptable, suboptimal or dangerous per variant,
// with its feedback; questions, answers, findings sheet, unit reports and outcomes can be edited too.
import { $, esc } from './client.mjs';

const VALORS = [['optima', 'Òptima'], ['acceptable', 'Acceptable'], ['suboptima', 'Subòptima'], ['perillosa', 'Perillosa']];
let casos = [], tematiques = [], cas = null, canvis = false;

async function carrega(id) {
  const get = f => fetch(f).then(r => (r.ok ? r.json() : Promise.reject(r.status)));
  [{ casos }, tematiques] = await Promise.all([get('/api/casos'), get('/data/tematiques.json')]);
  llista();
  obre(id || casos[0]?.id);
}

function llista() {
  $('llista').innerHTML = casos.map(c => `<button class="incident-fila ${c.id === cas?.id ? 'seleccionat' : ''}" data-id="${c.id}">
    <span>${esc(c.titol)}</span>${c.local ? '<span class="suau">editat</span>' : ''}<span class="adreca">${esc(c.id)}</span></button>`).join('');
  $('llista').querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
    if (canvis && !confirm('Hi ha canvis sense desar. Voleu canviar de cas igualment?')) return;
    obre(b.dataset.id);
  });
}

// Plain values that may depend on the variant are stored as {variant: value} while editing
function perVariants(valor, variants) {
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) return valor;
  return Object.fromEntries(variants.map(v => [v.id, valor ?? '']));
}

function normalitza(c) {
  const vs = c.variants;
  for (const v of vs) v.desenllac ??= { bo: '', dolent: '' };
  for (const p of c.passos) {
    if (p.tipus === 'decisio') for (const o of p.opcions) { o.valoracio = perVariants(o.valoracio, vs); o.feedback = perVariants(o.feedback, vs); }
    if (p.tipus === 'nivell') { p.feedback = perVariants(p.feedback, vs); for (const v of vs) p.valoracio[v.id] ??= { 1: 'perillosa', 2: 'perillosa', 3: 'perillosa', 4: 'perillosa', 5: 'perillosa' }; }
    if (p.tipus === 'retrucada') for (const q of p.preguntes) { q.resposta = perVariants(q.resposta, vs); q.fitxa = perVariants(q.fitxa, vs); q.alarma ??= []; }
    if (p.informe !== undefined) p.informe = perVariants(p.informe, vs);
  }
  return c;
}

function obre(id) {
  cas = normalitza(structuredClone(casos.find(c => c.id === id)));
  canvis = false;
  $('estat-desat').textContent = '';
  llista();
  render();
}

const camp = (ruta, valor, attrs = '') => `<input data-ruta="${ruta}" value="${esc(valor)}" ${attrs}>`;
const text = (ruta, valor, files = 2) => `<textarea data-ruta="${ruta}" rows="${files}">${esc(valor)}</textarea>`;
const selector = (ruta, valor) => `<select data-ruta="${ruta}" class="val-${valor}">${VALORS.map(([v, t]) => `<option value="${v}" ${v === valor ? 'selected' : ''}>${t}</option>`).join('')}</select>`;

function render() {
  const c = cas, vs = c.variants;
  const capVariants = vs.map(v => `<th>${esc(v.id)} <span class="suau">N${v.nivell}</span></th>`).join('');
  let html = `<h2>${esc(c.titol)}</h2>
  <div class="fila">
    <label>Identificador ${camp('id', c.id, c.local || casos.some(x => x.id === c.id) ? 'readonly' : '')}</label>
    <label>Títol (només el veu el tutor) ${camp('titol', c.titol)}</label>
    <label>Alertant ${camp('alertant', c.alertant)}</label>
  </div>
  <div class="fila">
    <label>Tipus de demanda ${camp('tipus_demanda', c.tipus_demanda)}</label>
    <label>Entrada <select data-ruta="entrada"><option value="carta_112" ${c.entrada === 'carta_112' ? 'selected' : ''}>Carta de dades del 112</option><option value="veu_sanitaria" ${c.entrada === 'veu_sanitaria' ? 'selected' : ''}>Veu passada a valorar (VPS)</option></select></label>
    <label>Edat mínima ${camp('pacient.edat.0', c.pacient.edat[0], 'type="number"')}</label>
    <label>Edat màxima ${camp('pacient.edat.1', c.pacient.edat[1], 'type="number"')}</label>
  </div>
  <label>Carta d'entrada ${text('carta', c.carta)}</label>
  <fieldset><legend>Temàtiques</legend><div class="caselles">${tematiques.map(t => `<label class="casella"><input type="checkbox" data-tematica="${t.id}" ${c.tematiques?.includes(t.id) ? 'checked' : ''}>${esc(t.nom)}</label>`).join('')}</div></fieldset>

  <h3>Variants: què passa realment</h3>
  ${vs.map((v, i) => `<div class="bloc"><div class="fila">
      <label>Variant <b>${esc(v.id)}</b> ${text(`variants.${i}.descripcio`, v.descripcio)}</label>
      <label>Nivell real <select data-ruta="variants.${i}.nivell" data-num>${[1, 2, 3, 4, 5].map(n => `<option ${n === v.nivell ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Probabilitat ${camp(`variants.${i}.pes`, v.pes, 'type="number" step="0.05" min="0" max="1" data-num')}</label>
    </div><div class="fila">
      <label>Desenllaç favorable ${text(`variants.${i}.desenllac.bo`, v.desenllac.bo)}</label>
      <label>Desenllaç desfavorable ${text(`variants.${i}.desenllac.dolent`, v.desenllac.dolent)}</label>
      <label>També és desfavorable si... <select data-ruta="variants.${i}.desenllac.criteri"><option value="">només per decisions perilloses o tard</option><option value="sobrerecurs" ${v.desenllac.criteri === 'sobrerecurs' ? 'selected' : ''}>s'envien més recursos dels necessaris</option></select></label>
    </div></div>`).join('')}`;

  c.passos.forEach((p, pi) => {
    html += `<h3>${esc(p.titol)} <span class="suau">(${p.tipus === 'retrucada' ? 'preguntes de la trucada' : p.tipus === 'nivell' ? 'nivell de triatge' : p.id === 'trasllat' ? 'consulta de la unitat al lloc' : 'decisió'})</span></h3>`;
    if (p.tipus !== 'retrucada') html += `<label>Pregunta ${camp(`passos.${pi}.pregunta`, p.pregunta)}</label>`;
    if (p.informe) html += `<table class="taula-editor"><tr><th>Informe de la unitat</th>${capVariants}</tr><tr><td></td>${vs.map(v => `<td>${text(`passos.${pi}.informe.${v.id}`, p.informe[v.id], 3)}</td>`).join('')}</tr></table>`;
    if (p.tipus === 'decisio') {
      html += `<table class="taula-editor"><tr><th>Opció</th>${capVariants}<th></th></tr>
        ${p.opcions.map((o, oi) => `<tr><td>${text(`passos.${pi}.opcions.${oi}.text`, o.text)}</td>
          ${vs.map(v => `<td>${selector(`passos.${pi}.opcions.${oi}.valoracio.${v.id}`, o.valoracio[v.id])}${text(`passos.${pi}.opcions.${oi}.feedback.${v.id}`, o.feedback[v.id])}</td>`).join('')}
          <td><button class="boto-petit" data-treu="passos.${pi}.opcions.${oi}">✕</button></td></tr>`).join('')}</table>
        <button class="boto-petit" data-afegeix-opcio="${pi}">+ Afegir opció</button>`;
    }
    if (p.tipus === 'nivell') {
      html += `<table class="taula-editor"><tr><th>Nivell</th>${capVariants}</tr>
        ${[1, 2, 3, 4, 5].map(n => `<tr><td>N${n}</td>${vs.map(v => `<td>${selector(`passos.${pi}.valoracio.${v.id}.${n}`, p.valoracio[v.id][n])}</td>`).join('')}</tr>`).join('')}
        <tr><td>Explicació</td>${vs.map(v => `<td>${text(`passos.${pi}.feedback.${v.id}`, p.feedback[v.id])}</td>`).join('')}</tr></table>`;
    }
    if (p.tipus === 'retrucada') {
      html += `<table class="taula-editor"><tr><th>Pregunta</th>${capVariants}<th></th></tr>
        ${p.preguntes.map((q, qi) => `<tr><td>${text(`passos.${pi}.preguntes.${qi}.text`, q.text)}
            <label class="casella"><input type="checkbox" data-clau="${pi}.${qi}" ${q.clau ? 'checked' : ''}>Pregunta clau</label></td>
          ${vs.map(v => `<td>${text(`passos.${pi}.preguntes.${qi}.resposta.${v.id}`, q.resposta[v.id])}
            <input data-ruta="passos.${pi}.preguntes.${qi}.fitxa.${v.id}" value="${esc(q.fitxa[v.id])}" placeholder="Resum a la fitxa">
            <label class="casella"><input type="checkbox" data-alarma="${pi}.${qi}.${v.id}" ${q.alarma.includes(v.id) ? 'checked' : ''}>Signe d'alarma</label></td>`).join('')}
          <td><button class="boto-petit" data-treu="passos.${pi}.preguntes.${qi}">✕</button></td></tr>`).join('')}</table>
        <button class="boto-petit" data-afegeix-pregunta="${pi}">+ Afegir pregunta</button>`;
    }
  });
  html += `<h3>Aprenentatges (un per línia)</h3><textarea id="aprenentatge" rows="4">${esc((c.aprenentatge || []).join('\n'))}</textarea>
    <div class="accions"><button class="boto" id="desa">Desar el cas</button><button class="boto secundari" id="descarrega">Descarregar JSON</button></div>`;
  $('formulari').innerHTML = html;
  lliga();
}

function posa(ruta, valor) {
  const parts = ruta.split('.');
  let o = cas;
  for (const p of parts.slice(0, -1)) o = o[p];
  o[parts.at(-1)] = valor;
  canvis = true;
  $('estat-desat').textContent = 'Canvis sense desar';
}

function lliga() {
  const f = $('formulari');
  f.querySelectorAll('[data-ruta]').forEach(el => el.oninput = () => {
    posa(el.dataset.ruta, el.hasAttribute('data-num') || el.type === 'number' ? Number(el.value) : el.value);
    if (el.tagName === 'SELECT') el.className = `val-${el.value}`;
  });
  f.querySelectorAll('[data-tematica]').forEach(el => el.onchange = () => {
    const t = new Set(cas.tematiques || []);
    el.checked ? t.add(el.dataset.tematica) : t.delete(el.dataset.tematica);
    posa('tematiques', [...t]);
  });
  f.querySelectorAll('[data-clau]').forEach(el => el.onchange = () => {
    const [pi, qi] = el.dataset.clau.split('.').map(Number);
    posa(`passos.${pi}.preguntes.${qi}.clau`, el.checked);
  });
  f.querySelectorAll('[data-alarma]').forEach(el => el.onchange = () => {
    const [pi, qi, v] = el.dataset.alarma.split('.');
    const q = cas.passos[pi].preguntes[qi];
    q.alarma = el.checked ? [...new Set([...q.alarma, v])] : q.alarma.filter(x => x !== v);
    posa(`passos.${pi}.preguntes.${qi}.alarma`, q.alarma);
  });
  f.querySelectorAll('[data-treu]').forEach(el => el.onclick = () => {
    const parts = el.dataset.treu.split('.');
    let o = cas;
    for (const p of parts.slice(0, -1)) o = o[p];
    o.splice(Number(parts.at(-1)), 1);
    canvis = true;
    render();
  });
  f.querySelectorAll('[data-afegeix-opcio]').forEach(el => el.onclick = () => {
    const p = cas.passos[el.dataset.afegeixOpcio];
    p.opcions.push({ id: `opcio${Date.now() % 100000}`, text: 'Nova opció',
      valoracio: Object.fromEntries(cas.variants.map(v => [v.id, 'acceptable'])), feedback: Object.fromEntries(cas.variants.map(v => [v.id, ''])) });
    canvis = true;
    render();
  });
  f.querySelectorAll('[data-afegeix-pregunta]').forEach(el => el.onclick = () => {
    const p = cas.passos[el.dataset.afegeixPregunta];
    p.preguntes.push({ id: `pregunta${Date.now() % 100000}`, text: 'Nova pregunta', clau: false,
      resposta: Object.fromEntries(cas.variants.map(v => [v.id, ''])), fitxa: Object.fromEntries(cas.variants.map(v => [v.id, ''])), alarma: [] });
    canvis = true;
    render();
  });
  $('aprenentatge').oninput = e => posa('aprenentatge', e.target.value.split('\n').map(s => s.trim()).filter(Boolean));
  $('desa').onclick = desa;
  $('descarrega').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cas, null, 1)], { type: 'application/json' }));
    a.download = `${cas.id}.json`;
    a.click();
  };
}

async function desa() {
  const r = await fetch('/api/casos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cas }) });
  const d = await r.json();
  if (!r.ok) { $('estat-desat').textContent = `No s'ha desat: ${d.error}`; return; }
  canvis = false;
  await carrega(cas.id);
  $('estat-desat').textContent = 'Desat. Les guàrdies noves ja fan servir aquesta versió.';
}

$('nou').onclick = () => {
  if (!cas) return;
  const id = prompt('Identificador del cas nou (minúscules, números i guions):', `${cas.id}-2`);
  if (!id) return;
  cas = { ...structuredClone(cas), id, titol: `${cas.titol} (còpia)`, local: false };
  canvis = true;
  render();
  $('estat-desat').textContent = 'Cas nou: deseu-lo per guardar-lo';
};

carrega().catch(() => { $('formulari').innerHTML = '<p>Cal entrar amb la contrasenya (torneu a la pàgina inicial).</p>'; });
