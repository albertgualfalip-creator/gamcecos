// Consultor training: the base questioning, outside the cases. Blocks (first contact, X, A, B, C, D, E...) with what
// to ask, what can be heard, the instructions and "not assessable"; the tutor reorders, adds, removes and rewrites them.
// New cases start from it, and an existing case can take it again.
import { $, esc, avis } from './client.mjs';
import { XABCDE, SECCIONS } from './motor.mjs';

let blocs = [];

const copia = l => l.map(b => ({ lletra: b.lletra, nom: b.nom, ...Object.fromEntries(SECCIONS.map(s => [s.id, [...(b[s.id] || [])]])) }));

export async function obreInterrogatori(contenidor) {
  const r = await fetch('/api/aula/interrogatori', { cache: 'no-store' }).then(x => x.json()).catch(() => ({}));
  blocs = copia(r.blocs?.length ? r.blocs : XABCDE);
  dibuixa(contenidor);
}

function mou(llista, i, pas) {
  if (i + pas < 0 || i + pas >= llista.length) return;
  [llista[i], llista[i + pas]] = [llista[i + pas], llista[i]];
}

function dibuixa(contenidor) {
  const fletxes = (dades, i, n) => `<span class="mou-item"><button type="button" data-${dades}="${i}.-1" ${i ? '' : 'disabled'}>▲</button><button type="button" data-${dades}="${i}.1" ${i < n - 1 ? '' : 'disabled'}>▼</button></span>`;
  $(contenidor).innerHTML = blocs.map((b, i) => `<div class="bloc-interrogatori" data-b="${i}">
      <div class="bloc-cap">${fletxes('mou-bloc', i, blocs.length)}
        <input class="lletra-input" data-camp="lletra" value="${esc(b.lletra)}" maxlength="4" title="Lletra o etiqueta curta">
        <input class="nom-input" data-camp="nom" value="${esc(b.nom)}" maxlength="60" placeholder="Nom del bloc">
        <button type="button" class="boto-petit" data-treu-bloc="${i}">✕ Treure el bloc</button></div>
      ${SECCIONS.map(s => `<div class="seccio-aula seccio-${s.id}"><b>${esc(s.nom)}</b> <span class="suau">${esc(s.pregunta)}</span>
        ${(b[s.id] || []).map((text, j) => `<div class="item-interrogatori">${fletxes(`mou-item-${s.id}`, j, b[s.id].length)}
          <input data-item="${s.id}.${j}" value="${esc(text)}" maxlength="120"><button type="button" class="boto-petit" data-treu-item="${s.id}.${j}">✕</button></div>`).join('')}
        <button type="button" class="boto-petit" data-afegeix-item="${s.id}">+ Afegir</button></div>`).join('')}</div>`).join('')
    + '<button type="button" class="boto secundari" id="afegeix-bloc">+ Afegir un bloc</button>';
  const arrel = $(contenidor);
  arrel.querySelectorAll('.bloc-interrogatori').forEach(el => {
    const b = blocs[Number(el.dataset.b)];
    el.querySelectorAll('[data-camp]').forEach(c => { c.oninput = () => { b[c.dataset.camp] = c.value; }; });
    el.querySelectorAll('[data-item]').forEach(c => { c.oninput = () => { const [s, j] = c.dataset.item.split('.'); b[s][Number(j)] = c.value; }; });
    el.querySelectorAll('[data-treu-item]').forEach(c => c.onclick = () => { const [s, j] = c.dataset.treuItem.split('.'); b[s].splice(Number(j), 1); dibuixa(contenidor); });
    el.querySelectorAll('[data-afegeix-item]').forEach(c => c.onclick = () => {
      b[c.dataset.afegeixItem].push('');
      dibuixa(contenidor);
      const nous = $(contenidor).querySelectorAll(`.bloc-interrogatori[data-b="${el.dataset.b}"] [data-item^="${c.dataset.afegeixItem}."]`);
      nous[nous.length - 1]?.focus();
    });
    for (const s of SECCIONS) {
      el.querySelectorAll(`[data-mou-item-${s.id}]`).forEach(c => c.onclick = () => {
        const [j, pas] = c.dataset[`mouItem${s.id[0].toUpperCase()}${s.id.slice(1)}`].split('.').map(Number);
        mou(b[s.id], j, pas);
        dibuixa(contenidor);
      });
    }
  });
  arrel.querySelectorAll('[data-mou-bloc]').forEach(c => c.onclick = () => { const [i, pas] = c.dataset.mouBloc.split('.').map(Number); mou(blocs, i, pas); dibuixa(contenidor); });
  arrel.querySelectorAll('[data-treu-bloc]').forEach(c => c.onclick = () => {
    if (confirm(`Treure el bloc «${blocs[Number(c.dataset.treuBloc)].nom}»?`)) { blocs.splice(Number(c.dataset.treuBloc), 1); dibuixa(contenidor); }
  });
  $('afegeix-bloc').onclick = () => { blocs.push({ lletra: '?', nom: 'Bloc nou', anamnesi: [''], signes: [], maniobres: [], noavaluable: ['No avaluable: la gravació no en dona informació'] }); dibuixa(contenidor); };
}

export async function desaInterrogatori() {
  const net = blocs.map(b => ({ ...b, ...Object.fromEntries(SECCIONS.map(s => [s.id, b[s.id].map(x => x.trim()).filter(Boolean)])) }));
  const r = await fetch('/api/aula/interrogatori', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocs: net }) });
  const d = await r.json();
  if (!r.ok) { avis(d.error); return false; }
  blocs = copia(d.blocs);
  return true;
}

export function restauraInterrogatori(contenidor) {
  blocs = copia(XABCDE);
  dibuixa(contenidor);
}
