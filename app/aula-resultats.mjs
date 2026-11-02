// Consultor training: the class results, shared by the projector and the tutor's class page.
import { esc } from './client.mjs';

const CAP_MANIOBRA = 'cap';   // as in aula.mjs on the server

// Horizontal bars: how many chose each option, the right ones highlighted
export function barres(files) {
  const total = Math.max(1, ...files.map(f => f.n));
  return `<div class="barres">${files.map(f => `<div class="barra-fila ${f.correcte ? 'correcte' : ''}">
    <span class="barra-text">${f.html ?? esc(f.text)}${f.correcte ? ' ✓' : ''}</span>
    <span class="barra"><span style="width:${(100 * f.n) / total}%" class="${f.classe || ''}"></span></span><b>${f.n}</b></div>`).join('')}</div>`;
}

// Seconds from the start into bands, with the median
function trams(temps, senseText, sense) {
  const bandes = [['0–15 s', 0, 15], ['15–30 s', 15, 30], ['30–60 s', 30, 60], ['1–2 min', 60, 120], ['> 2 min', 120, Infinity]];
  const files = bandes.map(([text, de, fins]) => ({ text, n: temps.filter(t => t >= de && t < fins).length }));
  if (senseText) files.push({ text: senseText, n: sense });
  const ordenats = temps.slice().sort((a, b) => a - b);
  return `${barres(files)}${ordenats.length ? `<p class="suau">Mediana: ${ordenats[Math.floor(ordenats.length / 2)]} s</p>` : ''}`;
}

export const tempsActivacio = d => trams(d.activacio.map(a => a.t), 'Sense activar durant la valoració', d.senseActivacio);

// The items of some sections that someone chose or that were right, the right ones first
function itemsTriats(v, seccions, mostra) {
  const d = v.distribucio.xabcde;
  return v.config.xabcde.flatMap(l => l.items.filter(it => seccions.includes(it.seccio)).map(it => ({ ...it, lletra: l.lletra })))
    .filter(it => (mostra && it.correcte) || d[it.id])
    .sort((a, b) => (mostra ? b.correcte - a.correcte : 0) || (d[b.id] || 0) - (d[a.id] || 0))
    .map(it => ({ html: `<b>${esc(it.lletra)}</b> ${esc(it.seccio === 'noavaluable' ? 'No avaluable' : it.text)}`, n: d[it.id] || 0, correcte: mostra && it.correcte }));
}

// One panel per question of the case; "mostra" marks the right answers (only once the results are shown)
export function panellsResultats(v, mostra) {
  const d = v.distribucio, buit = '<p class="suau">Encara cap resposta.</p>';
  const panell = (titol, cos) => `<div class="panell"><h3>${titol}</h3>${cos || buit}</div>`;
  const composicio = barres(Object.entries(d.composicio).sort((a, b) => b[1] - a[1]).map(([text, n]) => ({ text, n, correcte: mostra && text === v.correcte.text })));
  const unitats = barres(Object.entries(d.unitats).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => {
    const u = v.unitats.find(x => x.indicatiu === id);
    return { text: u ? `${id} ${u.tipus} · ${u.eta} min` : 'Cap recurs', n, correcte: mostra && v.correctes.includes(id) };
  }));
  const proposta = mostra ? `<p class="suau">Proposta: <b>${esc(v.correcte.text)}</b> (${esc(v.correctes.join(', ') || 'cap recurs')})</p>` : '';
  if (v.config.tipus === 'carta') {
    const calRecurs = v.correctes.length > 0;
    return [
      panell('Hi envien recurs?', barres([{ text: 'Sí', n: d.envien.si, correcte: mostra && calRecurs }, { text: 'No', n: d.envien.no, correcte: mostra && !calRecurs }])),
      panell('Quants de cada tipus', Object.keys(d.composicio).length ? composicio + proposta : ''),
      panell('Unitats més triades', Object.keys(d.unitats).length ? unitats : ''),
      panell('⏱ Temps per decidir', d.temps.length ? trams(d.temps.map(x => x.t)) : ''),
    ].join('');
  }
  const capCorrecte = !v.config.xabcde.some(l => l.items.some(it => it.seccio === 'maniobres' && it.correcte));
  const instruccions = itemsTriats(v, ['maniobres'], mostra);
  if (d.xabcde[CAP_MANIOBRA] || (mostra && capCorrecte)) instruccions.unshift({ text: 'Cap: només vigilar', n: d.xabcde[CAP_MANIOBRA] || 0, correcte: mostra && capCorrecte });
  return [
    panell('👂 Què han escoltat', barres(itemsTriats(v, ['signes', 'noavaluable'], mostra))),
    panell(`❓ Preguntes (${v.config.preguntes} per alumne)`, barres(itemsTriats(v, ['anamnesi'], mostra))),
    panell('🖐 Primera instrucció', barres(instruccions)),
    panell('Nivell de triatge', barres([1, 2, 3, 4, 5].map(n => ({ html: `<span class="nivell n${n}">N${n}</span>`, n: d.nivell[n] || 0, correcte: mostra && v.config.nivell === n, classe: `n${n}` })))),
    panell('🚑 Recursos', Object.keys(d.composicio).length ? composicio + proposta : ''),
    panell('🚑 Quan han activat el recurs', tempsActivacio(d)),
  ].join('');
}

export function classificacio(v, detall) {
  if (!v.classificacio.length) return '';
  const carta = v.config.tipus === 'carta';
  return `<div class="panell"><h3>Classificació</h3><ol class="ranquing">${v.classificacio.map(c => `<li><b>${esc(c.nom)}</b> · ${c.punts}/${c.maxim}
    ${detall ? `<span class="suau">(${carta ? `recursos ${c.recursos} · ${c.temps} s` : `escolta ${c.escolta}, preguntes ${c.preguntes}, instrucció ${c.instruccio}, nivell ${c.nivell}, recursos ${c.recursos}, detecció ${c.deteccio}${c.activacio != null ? ` · 🚑 ${c.activacio} s` : ''}`})</span>` : ''}</li>`).join('')}</ol></div>`;
}
