// Consultor training: pieces of the case form. The XABCDE answers are chips to tap (green = right for this case);
// the texts of each letter can be edited when needed.
import { $, esc } from './client.mjs';
import { XABCDE, SECCIONS } from './motor.mjs';

let municipis = new Map();
let base = XABCDE;              // base questioning: the tutor's own (server) or the default one
let model = [];                 // [{lletra, nom, items: [{seccio, text, correcte}]}]
let editant = new Set();        // letters whose texts are being edited
let visibles = SECCIONS.map(s => s.id);
let contenidorActual = null, enCanvi = () => {};

// Municipalities with a primary care centre, for the incident place and its real nearby units
export async function carregaMunicipis(llista) {
  const centres = await fetch('/data/centres.json').then(r => (r.ok ? r.json() : Promise.reject(r.status)));
  for (const c of centres.filter(x => x.tipus === 'CAP' && x.municipi)) {
    if (!municipis.has(c.municipi)) municipis.set(c.municipi, { municipi: c.municipi, zona: c.subzona || c.regio, lat: c.lat, lon: c.lon });
  }
  $(llista).innerHTML = [...municipis.keys()].sort((a, b) => a.localeCompare(b, 'ca')).map(m => `<option value="${esc(m)}">`).join('');
}

export const lloc = nom => municipis.get(String(nom || '').trim()) || null;

// The tutor's base questioning, if there is one saved on the server
export async function carregaInterrogatori() {
  const r = await fetch('/api/aula/interrogatori', { cache: 'no-store' }).then(x => x.json()).catch(() => ({}));
  base = r.blocs?.length ? r.blocs : XABCDE;
  return base;
}

const deBase = () => base.map(l => ({ lletra: l.lletra, nom: l.nom,
  items: SECCIONS.flatMap(s => (l[s.id] || []).map(text => ({ seccio: s.id, text, correcte: false }))) }));

// Loads the lists of a case (or the base questioning for a new one) into the editor, in their order
export function pintaXabcde(contenidor, xabcde, canvi = () => {}) {
  contenidorActual = contenidor;
  enCanvi = canvi;
  editant = new Set();
  model = xabcde?.length
    ? xabcde.map(l => ({ lletra: l.lletra, nom: l.nom, items: l.items.map(it => ({ seccio: it.seccio, text: it.text, correcte: !!it.correcte })) }))
    : deBase();
  dibuixa();
}

// Replaces the lists of the case with the base questioning, keeping as right the items with the same text
export function aplicaInterrogatori() {
  const bons = new Set(model.flatMap(l => l.items.filter(it => it.correcte).map(it => `${it.seccio}|${it.text}`)));
  model = deBase().map(l => ({ ...l, items: l.items.map(it => ({ ...it, correcte: bons.has(`${it.seccio}|${it.text}`) })) }));
  editant = new Set();
  enCanvi();
  dibuixa();
}

// Only the sections of the screens the case has are shown (the others are kept as they are)
export function seccionsVisibles(ids) {
  visibles = ids;
  if (contenidorActual) dibuixa();
}

function dibuixa() {
  const seccions = SECCIONS.filter(s => visibles.includes(s.id));
  $(contenidorActual).innerHTML = model.map((l, i) => {
    if (editant.has(i)) {
      return `<div class="lletra-editor editant" data-l="${i}"><div class="lletra-cap"><span class="lletra-gran">${esc(l.lletra)}</span>
        <input class="nom-lletra" value="${esc(l.nom)}"><button type="button" class="boto-petit" data-fet="${i}">✓ Fet</button></div>
        ${SECCIONS.map(s => `<label class="seccio-editor seccio-${s.id}">${esc(s.nom)} <span class="suau">(una per línia)</span>
          <textarea data-seccio="${s.id}" rows="${Math.max(2, l.items.filter(it => it.seccio === s.id).length + 1)}">${esc(l.items.filter(it => it.seccio === s.id).map(it => it.text).join('\n'))}</textarea></label>`).join('')}</div>`;
    }
    const n = l.items.filter(it => it.correcte && visibles.includes(it.seccio)).length;
    return `<div class="lletra-editor" data-l="${i}"><div class="lletra-cap"><span class="lletra-gran">${esc(l.lletra)}</span> <b>${esc(l.nom)}</b>
        <span class="suau">${n ? `${n} correct${n === 1 ? 'e' : 'es'}` : ''}</span><button type="button" class="boto-petit" data-edita="${i}">✎ Textos</button></div>
      ${seccions.map(s => {
        const items = l.items.map((it, j) => ({ ...it, j })).filter(it => it.seccio === s.id);
        return items.length ? `<div class="seccio-aula seccio-${s.id}"><span class="suau">${esc(s.nom)}</span><div class="xips-fila">${items.map(it =>
          `<button type="button" class="xip-boto ${it.correcte ? 'correcte' : ''}" data-xip="${i}.${it.j}">${it.correcte ? '✓ ' : ''}${esc(it.seccio === 'noavaluable' ? 'No avaluable' : it.text)}</button>`).join('')}</div></div>` : '';
      }).join('')}</div>`;
  }).join('');
  const arrel = $(contenidorActual);
  arrel.querySelectorAll('[data-xip]').forEach(b => b.onclick = () => {
    const [i, j] = b.dataset.xip.split('.').map(Number);
    model[i].items[j].correcte = !model[i].items[j].correcte;
    enCanvi();
    dibuixa();
  });
  arrel.querySelectorAll('[data-edita]').forEach(b => b.onclick = () => { editant.add(Number(b.dataset.edita)); dibuixa(); });
  arrel.querySelectorAll('[data-fet]').forEach(b => b.onclick = () => { desaTextos(Number(b.dataset.fet)); editant.delete(Number(b.dataset.fet)); dibuixa(); });
  arrel.querySelectorAll('.editant textarea, .editant .nom-lletra').forEach(el => { el.oninput = enCanvi; });
}

// Texts edited by hand: new lines become items; the right ones are kept by their text
function desaTextos(i) {
  const bloc = $(contenidorActual).querySelector(`.lletra-editor[data-l="${i}"]`);
  if (!bloc) return;
  const bons = new Set(model[i].items.filter(it => it.correcte).map(it => `${it.seccio}|${it.text}`));
  model[i].nom = bloc.querySelector('.nom-lletra').value.trim() || model[i].nom;
  model[i].items = [...bloc.querySelectorAll('textarea')].flatMap(t => t.value.split('\n').map(x => x.trim()).filter(Boolean)
    .map(text => ({ seccio: t.dataset.seccio, text, correcte: bons.has(`${t.dataset.seccio}|${text}`) })));
}

export function llegeixXabcde() {
  for (const i of editant) desaTextos(i);
  return model.map(l => ({ lletra: l.lletra, nom: l.nom, items: l.items }));
}
