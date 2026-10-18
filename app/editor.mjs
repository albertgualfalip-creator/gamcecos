// Case management for tutors: create, duplicate, import, edit, activate/deactivate, delete or restore cases.
// Every option is marked optimal, acceptable, suboptimal or dangerous per variant, with its feedback.
import { $, esc } from './client.mjs';
import { rolDe, ROLS, RECURSOS, SERVEIS, MODES, CAPACITATS, esImplicit } from './motor.mjs';

const VALORS = [['optima', 'Òptima'], ['acceptable', 'Acceptable'], ['suboptima', 'Subòptima'], ['perillosa', 'Perillosa']];
const ORIGEN = { original: 'original', editat: 'editat', nou: 'nou' };
// Decisions that can be added to a case; the id decides when it appears in the shift
const PASSOS_OPCIONALS = {
  maniobres: { titol: 'Consell i maniobres', pregunta: "Què li indiqueu a l'alertant mentre arriben les unitats?", descripcio: 'Consultor, durant la trucada' },
  consell: { titol: 'Consell telefònic', pregunta: "Quin consell doneu a l'alertant?", descripcio: 'Consultor, durant la trucada' },
  reajust: { titol: 'Reajust de la resposta', pregunta: 'Amb tota la informació, com quedarà la resposta?', descripcio: 'UCT, després de la valoració' },
  acces: { titol: 'Accés i altres cossos', pregunta: 'Com es resol l\'accés o quins altres cossos cal activar?', descripcio: 'UCT, després de la valoració' },
};
const NUCLI = ['activacio', 'retrucada', 'nivell', 'trasllat'];
// Steps the team plays with actions: each option says which actions it stands for
const AMB_ACCIONS = ['activacio', 'reajust', 'acces', 'trasllat'];
const RESOLUCIO = { trasllat: 'Trasllat', alta: 'Sense trasllat (alta in situ)', rebuig: 'Rebuig del trasllat', 'alta,rebuig': 'Sense trasllat o rebuig' };

let casos = [], tematiques = [], cas = null, nou = false, canvis = false;

async function carrega(id) {
  const get = f => fetch(f).then(r => (r.ok ? r.json() : Promise.reject(r.status)));
  [{ casos }, tematiques] = await Promise.all([get('/api/casos'), get('/data/tematiques.json')]);
  if ($('filtre-tematica').options.length === 1) $('filtre-tematica').innerHTML += tematiques.map(t => `<option value="${t.id}">${esc(t.nom)}</option>`).join('');
  llista();
  if (id || casos[0]) obre(id || casos[0].id);
}

function llista() {
  const text = $('cerca').value.toLowerCase(), tem = $('filtre-tematica').value;
  const visibles = casos.filter(c => (!tem || c.tematiques?.includes(tem)) && (!text || `${c.titol} ${c.carta}`.toLowerCase().includes(text)));
  $('llista').innerHTML = visibles.map(c => `<button class="incident-fila ${c.id === cas?.id ? 'seleccionat' : ''} ${c.actiu === false ? 'inactiu' : ''}" data-id="${c.id}">
    <span>${esc(c.titol)}</span><span class="suau">${ORIGEN[c.origen] || ''}${c.actiu === false ? ' · desactivat' : ''}</span>
    <span class="adreca">${c.variants.length} variants · ${(c.tematiques || []).length} temàtiques</span></button>`).join('') || '<p class="suau">Cap cas amb aquest filtre.</p>';
  $('llista').querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
    if (canvis && !confirm('Hi ha canvis sense desar. Voleu canviar de cas igualment?')) return;
    obre(b.dataset.id);
  });
}
$('cerca').oninput = llista;
$('filtre-tematica').onchange = llista;

// ---------- normalisation: values that depend on the variant are edited as {variant: value} ----------

function perVariants(valor, variants, defecte = '') {
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) return valor;
  return Object.fromEntries(variants.map(v => [v.id, valor ?? defecte]));
}

function normalitza(c) {
  const vs = c.variants;
  c.tematiques ??= [];
  c.aprenentatge ??= [];
  for (const v of vs) v.desenllac ??= { bo: '', dolent: '' };
  for (const p of c.passos) {
    if (p.tipus === 'decisio') for (const o of p.opcions) { o.valoracio = perVariants(o.valoracio, vs, 'acceptable'); o.feedback = perVariants(o.feedback, vs); }
    if (p.tipus === 'nivell') { p.feedback = perVariants(p.feedback, vs); p.valoracio ??= {}; for (const v of vs) p.valoracio[v.id] ??= nivellsPerDefecte(v.nivell); }
    if (p.tipus === 'retrucada') for (const q of p.preguntes) { q.resposta = perVariants(q.resposta, vs); q.fitxa = perVariants(q.fitxa, vs); q.alarma ??= []; }
    if (p.id === 'trasllat') p.informe = perVariants(p.informe, vs);
  }
  return c;
}

function nivellsPerDefecte(real) {
  return Object.fromEntries([1, 2, 3, 4, 5].map(n => [n, n === real ? 'optima' : Math.abs(n - real) === 1 ? (n < real ? 'acceptable' : 'suboptima') : 'perillosa']));
}

function obre(id) {
  cas = normalitza(structuredClone(casos.find(c => c.id === id)));
  nou = false;
  canvis = false;
  $('estat-desat').textContent = '';
  llista();
  render();
}

// ---------- new cases ----------

const opcio = (id, text, variants, valoracio, accio) => ({ id, text, valoracio: Object.fromEntries(variants.map(v => [v.id, valoracio])), feedback: Object.fromEntries(variants.map(v => [v.id, ''])), ...(accio ? { accio } : {}) });

function casEnBlanc(id) {
  const variants = [
    { id: 'greu', pes: 0.5, nivell: 1, descripcio: 'Què passa realment en la versió greu', desenllac: { bo: '', dolent: '' } },
    { id: 'lleu', pes: 0.5, nivell: 3, descripcio: 'Què passa realment en la versió lleu', desenllac: { bo: '', dolent: '' } },
  ];
  return normalitza({
    id, titol: 'Cas nou', tipus_servei: 'emergencia', entrada: 'carta_112', tipus_demanda: 'Malaltia en domicili',
    carta: 'TEXT DE LA CARTA DEL 112 TAL COM ARRIBA A LA SALA.', alertant: 'Familiar', pacient: { edat: [40, 80], sexe: 'Home' },
    tematiques: [], variants, actiu: true, aprenentatge: [],
    passos: [
      { id: 'activacio', tipus: 'decisio', titol: 'Activació inicial', pregunta: 'Entra la carta del 112. Què feu?', opcions: [
        opcio('immediata', 'Activar USVB + USVA de forma immediata i retrucar', variants, 'acceptable', { recursos: 'sva_svb' }),
        opcio('svb_320', 'Activar USVB, USVA en 3.20 SEM i passar a valorar', variants, 'acceptable', { recursos: 'svb_320' }),
        opcio('valorar', 'Passar a valorar sense activar', variants, 'acceptable', { recursos: 'cap' })] },
      { id: 'retrucada', tipus: 'retrucada', titol: 'Retrucada', pregunta: 'Pregunteu el que necessiteu: cada pregunta allarga la trucada.', preguntes: [
        { id: 'p1', text: 'Primera pregunta clau', clau: true, resposta: { greu: '', lleu: '' }, fitxa: { greu: '', lleu: '' }, alarma: [] }] },
      { id: 'nivell', tipus: 'nivell', titol: 'Nivell de triatge', pregunta: 'Quin nivell hi poseu?',
        valoracio: { greu: nivellsPerDefecte(1), lleu: nivellsPerDefecte(3) }, feedback: { greu: '', lleu: '' } },
      { id: 'trasllat', tipus: 'decisio', titol: 'Trasllat', pregunta: 'La unitat demana consulta. Què hi indiqueu?',
        informe: { greu: '3.4 AL LLOC. 3.5: ', lleu: '3.4 AL LLOC. 3.5: ' }, opcions: [
          opcio('sva', 'Trasllat amb SVA a hospital útil', variants, 'acceptable', { resolucio: 'trasllat', mode: 'SVA' }),
          opcio('svb', "Trasllat amb SVB a l'hospital de referència", variants, 'acceptable', { resolucio: 'trasllat', mode: 'SVB' }),
          opcio('alta', 'Alta in situ amb pautes de reconsulta', variants, 'acceptable', { resolucio: ['alta', 'rebuig'] })] },
    ],
  });
}

function demanaId(proposta) {
  const id = prompt('Identificador del cas (minúscules, números i guions, sense espais):', proposta);
  if (!id) return null;
  if (!/^[a-z0-9-]{3,40}$/.test(id)) { alert('Identificador invàlid: només minúscules, números i guions (3 a 40 caràcters).'); return null; }
  if (casos.some(c => c.id === id)) { alert('Ja existeix un cas amb aquest identificador.'); return null; }
  return id;
}

function comencaNou(c) {
  cas = c;
  nou = true;
  canvis = true;
  llista();
  render();
  $('estat-desat').textContent = 'Cas nou: deseu-lo per guardar-lo';
}

$('nou').onclick = () => { const id = demanaId('cas-nou'); if (id) comencaNou(casEnBlanc(id)); };
$('importa').onchange = async e => {
  const fitxer = e.target.files[0];
  e.target.value = '';
  if (!fitxer) return;
  try {
    const c = JSON.parse(await fitxer.text());
    if (!c.variants || !c.passos) throw new Error('no és un cas de GamCECOS');
    const id = casos.some(x => x.id === c.id) ? demanaId(`${c.id}-importat`) : c.id;
    if (id) comencaNou(normalitza({ ...c, id, origen: undefined }));
  } catch (err) { alert(`No s'ha pogut importar: ${err.message}`); }
};

// ---------- form ----------

const camp = (ruta, valor, attrs = '') => `<input data-ruta="${ruta}" value="${esc(valor)}" ${attrs}>`;
const text = (ruta, valor, files = 2) => `<textarea data-ruta="${ruta}" rows="${files}">${esc(valor)}</textarea>`;
const selector = (ruta, valor) => `<select data-ruta="${ruta}" class="val-${valor}">${VALORS.map(([v, t]) => `<option value="${v}" ${v === valor ? 'selected' : ''}>${t}</option>`).join('')}</select>`;

function render() {
  const c = cas, vs = c.variants;
  const original = c.origen === 'editat' || c.origen === 'original';
  const capVariants = vs.map(v => `<th>${esc(v.id)} <span class="nivell n${v.nivell}">N${v.nivell}</span></th>`).join('');
  let html = `<div class="barra-cas">
      <h2>${esc(c.titol)} ${c.actiu === false ? '<span class="etiqueta v-suboptima">desactivat</span>' : ''}</h2>
      <div class="accions">
        <button class="boto" id="desa">Desar</button>
        <button class="boto secundari" id="duplica">Duplicar</button>
        <button class="boto secundari" id="descarrega">Descarregar JSON</button>
        ${nou ? '' : `<button class="boto secundari" id="activa">${c.actiu === false ? 'Activar' : 'Desactivar'}</button>`}
        ${!nou && c.origen === 'editat' ? '<button class="boto secundari" id="esborra">Restaurar l\'original</button>' : ''}
        ${!nou && c.origen === 'nou' ? '<button class="boto perill" id="esborra">Esborrar el cas</button>' : ''}
      </div>
      <p class="suau">${nou ? 'Cas nou, encara no desat.' : c.origen === 'original' ? 'Cas original del repositori: en desar-lo es crea una versió editada (es pot restaurar).' : c.origen === 'editat' ? 'Versió editada d\'un cas original.' : 'Cas creat a l\'editor.'}
        Un cas desactivat no surt a les guàrdies.</p>
    </div>
  <h3>Dades generals</h3>
  <div class="fila">
    <label>Identificador ${camp('id', c.id, 'readonly')}</label>
    <label>Títol (només el veu el tutor) ${camp('titol', c.titol)}</label>
    <label>Alertant ${camp('alertant', c.alertant)}</label>
  </div>
  <div class="fila">
    <label>Tipus de demanda ${camp('tipus_demanda', c.tipus_demanda)}</label>
    <label>Entrada <select data-ruta="entrada"><option value="carta_112" ${c.entrada === 'carta_112' ? 'selected' : ''}>Carta de dades del 112</option><option value="veu_sanitaria" ${c.entrada === 'veu_sanitaria' ? 'selected' : ''}>Veu passada a valorar (VPS)</option></select></label>
    <label>Sexe <select data-ruta="pacient.sexe">${['Home', 'Dona'].map(x => `<option ${x === c.pacient.sexe ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <label>Edat mínima ${camp('pacient.edat.0', c.pacient.edat[0], 'type="number" data-num')}</label>
    <label>Edat màxima ${camp('pacient.edat.1', c.pacient.edat[1], 'type="number" data-num')}</label>
  </div>
  <label>Carta d'entrada (el que veu la sala) ${text('carta', c.carta)}</label>
  <fieldset><legend>Temàtiques</legend><div class="caselles">${tematiques.map(t => `<label class="casella"><input type="checkbox" data-tematica="${t.id}" ${c.tematiques.includes(t.id) ? 'checked' : ''}>${esc(t.nom)}</label>`).join('')}</div></fieldset>

  <h3>Variants: què passa realment <span class="suau">(a cada guàrdia se'n tria una a l'atzar segons la probabilitat)</span></h3>
  ${vs.map((v, i) => `<div class="bloc"><div class="fila">
      <label>Variant <b>${esc(v.id)}</b> ${text(`variants.${i}.descripcio`, v.descripcio)}</label>
      <label>Nivell real <select data-ruta="variants.${i}.nivell" data-num>${[1, 2, 3, 4, 5].map(n => `<option ${n === v.nivell ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Probabilitat ${camp(`variants.${i}.pes`, v.pes, 'type="number" step="0.05" min="0" max="1" data-num')}</label>
      ${vs.length > 1 ? `<button class="boto-petit" data-treu-variant="${esc(v.id)}">✕ Treure variant</button>` : ''}
    </div><div class="fila">
      <label>Desenllaç favorable ${text(`variants.${i}.desenllac.bo`, v.desenllac.bo)}</label>
      <label>Desenllaç desfavorable ${text(`variants.${i}.desenllac.dolent`, v.desenllac.dolent)}</label>
      <label>També és desfavorable si... <select data-ruta="variants.${i}.desenllac.criteri"><option value="">només per decisions perilloses o tard</option><option value="sobrerecurs" ${v.desenllac.criteri === 'sobrerecurs' ? 'selected' : ''}>s'envien més recursos dels necessaris</option></select></label>
    </div></div>`).join('')}
  <button class="boto-petit" id="afegeix-variant">+ Afegir variant</button>`;

  c.passos.forEach((p, pi) => {
    const rol = rolDe(p);
    html += `<div class="bloc-pas"><h3>${esc(p.titol)} <span class="rol rol-${rol}">${ROLS[rol]}</span>
      ${NUCLI.includes(p.id) ? '' : `<button class="boto-petit" data-treu-pas="${pi}">✕ Treure decisió</button>`}</h3>`;
    if (p.tipus !== 'retrucada') html += `<div class="fila"><label>Títol ${camp(`passos.${pi}.titol`, p.titol)}</label><label>Pregunta ${camp(`passos.${pi}.pregunta`, p.pregunta)}</label></div>`;
    if (p.id === 'trasllat') html += `<table class="taula-editor"><tr><th>Informe de la unitat al lloc</th>${capVariants}</tr><tr><td class="suau">Text que rep el consultor</td>${vs.map(v => `<td>${text(`passos.${pi}.informe.${v.id}`, p.informe[v.id], 3)}</td>`).join('')}</tr></table>`;
    if (p.tipus === 'decisio' && AMB_ACCIONS.includes(p.id)) {
      html += esImplicit(p)
        ? '<p class="suau">L\'equip no veu aquesta pregunta: actua (activa unitats, avisa altres serveis, tria el destí) i el joc compara el que ha fet amb aquestes opcions. El text només el veu el públic quan vota.</p>'
        : '<p class="suau">Alguna opció no té les accions definides: mentre sigui així, l\'equip veurà aquesta decisió com una pregunta.</p>';
    }
    if (p.tipus === 'decisio') {
      html += `<table class="taula-editor"><tr><th>Opció</th>${capVariants}<th></th></tr>
        ${p.opcions.map((o, oi) => `<tr><td>${text(`passos.${pi}.opcions.${oi}.text`, o.text)}${AMB_ACCIONS.includes(p.id) ? accioHtml(p, pi, o, oi) : ''}</td>
          ${vs.map(v => `<td>${selector(`passos.${pi}.opcions.${oi}.valoracio.${v.id}`, o.valoracio[v.id])}${text(`passos.${pi}.opcions.${oi}.feedback.${v.id}`, o.feedback[v.id])}</td>`).join('')}
          <td><button class="boto-petit" data-treu="passos.${pi}.opcions.${oi}">✕</button></td></tr>`).join('')}</table>
        <button class="boto-petit" data-afegeix-opcio="${pi}">+ Afegir opció</button>`;
    }
    if (p.tipus === 'nivell') {
      html += `<table class="taula-editor"><tr><th>Nivell</th>${capVariants}</tr>
        ${[1, 2, 3, 4, 5].map(n => `<tr><td><span class="nivell n${n}">N${n}</span></td>${vs.map(v => `<td>${selector(`passos.${pi}.valoracio.${v.id}.${n}`, p.valoracio[v.id][n])}</td>`).join('')}</tr>`).join('')}
        <tr><td>Explicació</td>${vs.map(v => `<td>${text(`passos.${pi}.feedback.${v.id}`, p.feedback[v.id])}</td>`).join('')}</tr></table>`;
    }
    if (p.tipus === 'retrucada') {
      html += `<p class="suau">Les preguntes clau compten per a la valoració de la retrucada. El resum surt a la fitxa del consultor; si és un signe d'alarma, en vermell.</p>
        <table class="taula-editor"><tr><th>Pregunta</th>${capVariants}<th></th></tr>
        ${p.preguntes.map((q, qi) => `<tr><td>${text(`passos.${pi}.preguntes.${qi}.text`, q.text)}
            <label class="casella"><input type="checkbox" data-clau="${pi}.${qi}" ${q.clau ? 'checked' : ''}>Pregunta clau</label></td>
          ${vs.map(v => `<td>${text(`passos.${pi}.preguntes.${qi}.resposta.${v.id}`, q.resposta[v.id])}
            <input data-ruta="passos.${pi}.preguntes.${qi}.fitxa.${v.id}" value="${esc(q.fitxa[v.id])}" placeholder="Resum a la fitxa">
            <label class="casella"><input type="checkbox" data-alarma="${pi}.${qi}.${v.id}" ${q.alarma.includes(v.id) ? 'checked' : ''}>Signe d'alarma</label></td>`).join('')}
          <td><button class="boto-petit" data-treu="passos.${pi}.preguntes.${qi}">✕</button></td></tr>`).join('')}</table>
        <button class="boto-petit" data-afegeix-pregunta="${pi}">+ Afegir pregunta</button>`;
    }
    html += '</div>';
  });
  const disponibles = Object.entries(PASSOS_OPCIONALS).filter(([id]) => !c.passos.some(p => p.id === id));
  if (disponibles.length) {
    html += `<div class="fila afegeix-pas"><label>Afegir una decisió <select id="nou-pas">${disponibles.map(([id, d]) => `<option value="${id}">${esc(d.titol)} · ${esc(d.descripcio)}</option>`).join('')}</select></label>
      <button class="boto-petit" id="afegeix-pas">+ Afegir</button></div>`;
  }
  html += `<h3>Aprenentatges (un per línia)</h3><textarea id="aprenentatge" rows="4">${esc(c.aprenentatge.join('\n'))}</textarea>`;
  $('formulari').innerHTML = html;
  lliga();
}

// Which team actions an option stands for: resources and services (UCT) or how the on-scene call ends (transfer)
function accioHtml(p, pi, o, oi) {
  const a = o.accio;
  const sel = (camp, valors, actual, buit = 'Indiferent') => `<select data-accio="${pi}.${oi}.${camp}"><option value="">${buit}</option>${Object.entries(valors)
    .map(([v, t]) => `<option value="${v}" ${String(actual ?? '') === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  if (!a) return `<div class="accio-editor"><button class="boto-petit" data-accio-nova="${pi}.${oi}">+ Definir les accions</button></div>`;
  if (p.id === 'trasllat') {
    return `<div class="accio-editor"><label>Resolució ${sel('resolucio', RESOLUCIO, [a.resolucio].flat().join(','), '—')}</label>
      <label>Tipus ${sel('mode', MODES, a.mode)}</label><label>Destí ha de tenir ${sel('desti', CAPACITATS, a.desti)}</label></div>`;
  }
  return `<div class="accio-editor"><label>Recursos ${sel('recursos', RECURSOS, a.recursos)}</label>
    ${Object.entries(SERVEIS).map(([id, nom]) => `<label>${esc(nom)} ${sel(`serveis.${id}`, { true: 'Sí', false: 'No' }, a.serveis?.[id])}</label>`).join('')}</div>`;
}

function posa(ruta, valor) {
  const parts = ruta.split('.');
  let o = cas;
  for (const p of parts.slice(0, -1)) o = o[p];
  o[parts.at(-1)] = valor;
  modificat();
}

function modificat() {
  canvis = true;
  $('estat-desat').textContent = 'Canvis sense desar';
}

// Adding or removing a variant touches every value that depends on the variant
function afegeixVariant(id) {
  const nivell = 2;
  cas.variants.push({ id, pes: 0.2, nivell, descripcio: '', desenllac: { bo: '', dolent: '' } });
  for (const p of cas.passos) {
    if (p.tipus === 'decisio') for (const o of p.opcions) { o.valoracio[id] = 'acceptable'; o.feedback[id] = ''; }
    if (p.tipus === 'nivell') { p.valoracio[id] = nivellsPerDefecte(nivell); p.feedback[id] = ''; }
    if (p.tipus === 'retrucada') for (const q of p.preguntes) { q.resposta[id] = ''; q.fitxa[id] = ''; }
    if (p.informe) p.informe[id] = '3.4 AL LLOC. 3.5: ';
  }
}

function treuVariant(id) {
  cas.variants = cas.variants.filter(v => v.id !== id);
  for (const p of cas.passos) {
    if (p.tipus === 'decisio') for (const o of p.opcions) { delete o.valoracio[id]; delete o.feedback[id]; }
    if (p.tipus === 'nivell') { delete p.valoracio[id]; delete p.feedback[id]; }
    if (p.tipus === 'retrucada') for (const q of p.preguntes) { delete q.resposta[id]; delete q.fitxa[id]; q.alarma = q.alarma.filter(x => x !== id); }
    if (p.informe) delete p.informe[id];
  }
}

function lliga() {
  const f = $('formulari');
  const torna = () => { modificat(); render(); };
  f.querySelectorAll('[data-ruta]').forEach(el => el.oninput = () => {
    posa(el.dataset.ruta, el.hasAttribute('data-num') ? Number(el.value) : el.value);
    if (el.tagName === 'SELECT' && el.className.startsWith('val-')) el.className = `val-${el.value}`;
  });
  f.querySelectorAll('select[data-ruta$=".nivell"]').forEach(el => el.onchange = () => {   // a new real level resets the level table of that variant
    const v = cas.variants[Number(el.dataset.ruta.split('.')[1])];
    const pas = cas.passos.find(p => p.tipus === 'nivell');
    if (pas && confirm('Voleu ajustar també les valoracions del nivell de triatge per a aquest nivell real?')) pas.valoracio[v.id] = nivellsPerDefecte(v.nivell);
    render();
  });
  f.querySelectorAll('[data-tematica]').forEach(el => el.onchange = () => {
    const t = new Set(cas.tematiques);
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
    modificat();
  });
  f.querySelectorAll('[data-accio]').forEach(el => el.onchange = () => {
    const [pi, oi, camp, servei] = el.dataset.accio.split('.');
    const o = cas.passos[pi].opcions[oi];
    const a = o.accio;
    if (camp === 'serveis') {
      a.serveis ??= {};
      if (el.value) a.serveis[servei] = el.value === 'true'; else delete a.serveis[servei];
      if (!Object.keys(a.serveis).length) delete a.serveis;
    } else if (!el.value) delete a[camp];
    else a[camp] = camp === 'resolucio' && el.value.includes(',') ? el.value.split(',') : el.value;
    delete o.sense_trasllat;
    modificat();
  });
  f.querySelectorAll('[data-accio-nova]').forEach(el => el.onclick = () => {
    const [pi, oi] = el.dataset.accioNova.split('.').map(Number);
    cas.passos[pi].opcions[oi].accio = cas.passos[pi].id === 'trasllat' ? { resolucio: 'trasllat' } : {};
    torna();
  });
  f.querySelectorAll('[data-treu]').forEach(el => el.onclick = () => {
    const parts = el.dataset.treu.split('.');
    let o = cas;
    for (const p of parts.slice(0, -1)) o = o[p];
    if (o.length <= 1) { alert('Ha de quedar almenys un element.'); return; }
    o.splice(Number(parts.at(-1)), 1);
    torna();
  });
  f.querySelectorAll('[data-afegeix-opcio]').forEach(el => el.onclick = () => {
    const pas = cas.passos[el.dataset.afegeixOpcio];
    const accio = AMB_ACCIONS.includes(pas.id) ? (pas.id === 'trasllat' ? { resolucio: 'trasllat' } : {}) : undefined;
    pas.opcions.push(opcio(`opcio${Date.now() % 100000}`, 'Nova opció', cas.variants, 'acceptable', accio));
    torna();
  });
  f.querySelectorAll('[data-afegeix-pregunta]').forEach(el => el.onclick = () => {
    cas.passos[el.dataset.afegeixPregunta].preguntes.push({ id: `pregunta${Date.now() % 100000}`, text: 'Nova pregunta', clau: false,
      resposta: perVariants('', cas.variants), fitxa: perVariants('', cas.variants), alarma: [] });
    torna();
  });
  f.querySelectorAll('[data-treu-pas]').forEach(el => el.onclick = () => { cas.passos.splice(Number(el.dataset.treuPas), 1); torna(); });
  f.querySelectorAll('[data-treu-variant]').forEach(el => el.onclick = () => {
    if (confirm(`Treure la variant ${el.dataset.treuVariant} i totes les seves respostes i valoracions?`)) { treuVariant(el.dataset.treuVariant); torna(); }
  });
  $('afegeix-variant').onclick = () => {
    const id = prompt('Nom curt de la variant (minúscules, sense espais):', 'variant');
    if (!id || !/^[a-z0-9_]{2,30}$/.test(id) || cas.variants.some(v => v.id === id)) { if (id) alert('Nom invàlid o repetit.'); return; }
    afegeixVariant(id);
    torna();
  };
  $('afegeix-pas')?.addEventListener('click', () => {
    const id = $('nou-pas').value, d = PASSOS_OPCIONALS[id];
    const pas = { id, tipus: 'decisio', titol: d.titol, pregunta: d.pregunta, opcions: [opcio('opcio1', 'Primera opció', cas.variants, 'acceptable', AMB_ACCIONS.includes(id) ? {} : undefined)] };
    const abansDe = cas.passos.findIndex(p => p.id === 'trasllat');
    cas.passos.splice(abansDe < 0 ? cas.passos.length : abansDe, 0, pas);
    torna();
  });
  $('aprenentatge').oninput = e => posa('aprenentatge', e.target.value.split('\n').map(s => s.trim()).filter(Boolean));
  $('desa').onclick = () => desa();
  $('duplica').onclick = () => {
    const id = demanaId(`${cas.id}-2`);
    if (id) comencaNou({ ...structuredClone(cas), id, titol: `${cas.titol} (còpia)`, origen: undefined });
  };
  $('descarrega').onclick = () => {
    const a = document.createElement('a');
    const { origen, ...net } = cas;
    a.href = URL.createObjectURL(new Blob([JSON.stringify(net, null, 1)], { type: 'application/json' }));
    a.download = `${cas.id}.json`;
    a.click();
  };
  $('activa')?.addEventListener('click', () => { cas.actiu = cas.actiu === false; desa(); });
  $('esborra')?.addEventListener('click', async () => {
    const restaura = cas.origen === 'editat';
    if (!confirm(restaura ? 'Es perdran els canvis i es tornarà a la versió original. Continuar?' : 'S\'esborrarà el cas definitivament. Continuar?')) return;
    const r = await fetch('/api/casos/esborra', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: cas.id }) });
    if (!r.ok) { $('estat-desat').textContent = (await r.json()).error; return; }
    canvis = false;
    await carrega(restaura ? cas.id : null);
    $('estat-desat').textContent = restaura ? 'Restaurat l\'original.' : 'Cas esborrat.';
  });
}

async function desa() {
  const r = await fetch('/api/casos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cas, nou }) });
  const d = await r.json();
  if (!r.ok) { $('estat-desat').textContent = `No s'ha desat: ${d.error}`; return; }
  canvis = false;
  await carrega(cas.id);
  $('estat-desat').textContent = 'Desat. Les guàrdies noves ja el fan servir.';
}

window.addEventListener('beforeunload', e => { if (canvis) e.preventDefault(); });
carrega().catch(() => { $('formulari').innerHTML = '<p>Cal entrar amb la contrasenya (torneu a la pàgina inicial).</p>'; });
