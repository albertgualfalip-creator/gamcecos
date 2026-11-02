// Consultor training: form for a case (title, place, right level and the XABCDE items with the right ones ticked),
// used by the case administration page.
import { $, esc } from './client.mjs';
import { XABCDE, SECCIONS } from './motor.mjs';

let municipis = new Map();

// Municipalities with a primary care centre, for the incident place and its real nearby units
export async function carregaMunicipis(llista) {
  const centres = await fetch('/data/centres.json').then(r => (r.ok ? r.json() : Promise.reject(r.status)));
  for (const c of centres.filter(x => x.tipus === 'CAP' && x.municipi)) {
    if (!municipis.has(c.municipi)) municipis.set(c.municipi, { municipi: c.municipi, zona: c.subzona || c.regio, lat: c.lat, lon: c.lon });
  }
  $(llista).innerHTML = [...municipis.keys()].sort((a, b) => a.localeCompare(b, 'ca')).map(m => `<option value="${esc(m)}">`).join('');
}

export const lloc = nom => municipis.get(String(nom || '').trim()) || null;

// One block per letter with the three lists (one item per line) and, under each list, the right ones ticked
export function pintaXabcde(contenidor, xabcde) {
  const perLletra = l => {
    const desat = xabcde?.find(x => x.lletra === l.lletra);
    return SECCIONS.map(sec => {
      const items = desat ? desat.items.filter(it => it.seccio === sec.id) : l[sec.id].map(text => ({ text, correcte: false }));
      return { sec, linies: items.map(it => it.text), correctes: new Set(items.filter(it => it.correcte).map(it => it.text)) };
    });
  };
  $(contenidor).innerHTML = XABCDE.map((l, i) => {
    const nom = xabcde?.find(x => x.lletra === l.lletra)?.nom || l.nom;
    return `<div class="bloc" data-lletra="${i}">
      <label><span class="lletra-gran">${esc(l.lletra)}</span> <input class="nom-lletra" value="${esc(nom)}"></label>
      ${perLletra(l).map(({ sec, linies, correctes }) => `<div class="seccio-editor seccio-${sec.id}" data-seccio="${sec.id}"><b>${esc(sec.nom)}</b>
        <textarea rows="${linies.length + 1}">${esc(linies.join('\n'))}</textarea>
        <div class="correctes-llista">${linies.map(t => `<label class="casella"><input type="checkbox" value="${esc(t)}" ${correctes.has(t) ? 'checked' : ''}>${esc(t)}</label>`).join('')}</div></div>`).join('')}</div>`;
  }).join('');
  $(contenidor).querySelectorAll('.seccio-editor').forEach(sec => { sec.querySelector('textarea').oninput = () => ompleCorrectes(sec); });
}

// Under each list, one checkbox per line: ticked = right for this recording (kept by text while editing)
function ompleCorrectes(sec) {
  const abans = new Set([...sec.querySelectorAll('input:checked')].map(c => c.value));
  const linies = sec.querySelector('textarea').value.split('\n').map(x => x.trim()).filter(Boolean);
  sec.querySelector('.correctes-llista').innerHTML = linies.map(t => `<label class="casella"><input type="checkbox" value="${esc(t)}" ${abans.has(t) ? 'checked' : ''}>${esc(t)}</label>`).join('');
}

export function llegeixXabcde(contenidor) {
  return [...$(contenidor).querySelectorAll('.bloc')].map((b, i) => ({
    lletra: XABCDE[i].lletra, nom: b.querySelector('.nom-lletra').value.trim(),
    items: [...b.querySelectorAll('.seccio-editor')].flatMap(sec => [...sec.querySelectorAll('input[type=checkbox]')]
      .map(c => ({ seccio: sec.dataset.seccio, text: c.value, correcte: c.checked }))),
  }));
}
