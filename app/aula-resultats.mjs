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
    .filter(it => (mostra && (it.correcte || it.valor)) || d[it.id])
    .sort((a, b) => (mostra ? b.correcte - a.correcte : 0) || (d[b.id] || 0) - (d[a.id] || 0))
    // Graded instructions show how right they were: acceptable or dangerous
    .map(it => ({ html: `<b>${esc(it.lletra)}</b> ${esc(it.seccio === 'noavaluable' ? 'No avaluable' : it.text)}${mostra && it.valor === 'acceptable' ? ' <span class="acceptable-resp">≈ acceptable</span>'
      : mostra && it.valor === 'perillosa' ? ' <span class="error-resp">⚠ perillosa</span>' : ''}`, n: d[it.id] || 0, correcte: mostra && it.correcte }));
}

// One panel per question of the case; "mostra" marks the right answers (only once the results are shown)
export function panellsResultats(v, mostra) {
  const d = v.distribucio, buit = '<p class="suau">Encara cap resposta.</p>';
  const panell = (titol, cos) => `<div class="panell"><h3>${titol}</h3>${cos || buit}</div>`;
  const composicio = barres(Object.entries(d.composicio).sort((a, b) => b[1] - a[1]).map(([text, n]) => ({ text, n, correcte: mostra && !!d.composicioDins?.[text] })));
  const unitats = barres(Object.entries(d.unitats).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => {
    const u = v.unitats.find(x => x.indicatiu === id);
    return { text: u ? `${id} ${u.tipus} · ${u.eta} min` : 'Cap recurs', n, correcte: mostra && v.correctes.includes(id) };
  }));
  const proposta = mostra ? `<p class="suau">Correcte: <b>${esc(v.correcte.text)}</b> · les més properes: ${esc(v.correctes.join(', ') || 'cap recurs')}</p>` : '';
  const f = v.config.fases, calRecurs = v.correctes.length > 0;
  const capCorrecte = !v.config.xabcde.some(l => l.items.some(it => it.seccio === 'maniobres' && it.correcte));
  const instruccions = itemsTriats(v, ['maniobres'], mostra);
  if (d.xabcde[CAP_MANIOBRA] || (mostra && capCorrecte)) instruccions.unshift({ text: 'Cap: només vigilar', n: d.xabcde[CAP_MANIOBRA] || 0, correcte: mostra && capCorrecte });
  return [
    f.escolta && panell('👂 Què han escoltat', barres(itemsTriats(v, ['signes', 'noavaluable'], mostra))),
    f.preguntes && panell(`❓ Preguntes (${v.config.preguntes} per alumne)`, barres(itemsTriats(v, ['anamnesi'], mostra))),
    f.instruccio && panell((v.config.instruccions || 1) > 1 ? `🖐 Instruccions (fins a ${v.config.instruccions})` : '🖐 Primera instrucció', barres(instruccions)),
    f.nivell && panell('Nivell de triatge', barres([1, 2, 3, 4, 5].map(n => ({ html: `<span class="nivell n${n}">N${n}</span>`, n: d.nivell[n] || 0,
      correcte: mostra && (v.config.nivells?.length ? v.config.nivells.includes(n) : v.config.nivell === n), classe: `n${n}` })))),
    mostra && v.config.explicacio && panell('💬 Per què', `<p>${esc(v.config.explicacio)}</p>`),
    f.recursos && v.config.tipus === 'carta' && panell('Hi envien recurs?', barres([{ text: 'Sí', n: d.envien.si, correcte: mostra && calRecurs }, { text: 'No', n: d.envien.no, correcte: mostra && !calRecurs }])),
    f.recursos && panell('🚑 Quants de cada tipus', Object.keys(d.composicio).length ? composicio + proposta : ''),
    f.recursos && panell('Unitats més triades', Object.keys(d.unitats).length ? unitats : ''),
    f.activacio && panell('🚑 Quan han activat el recurs', tempsActivacio(d)),
    !f.activacio && panell('⏱ Temps per respondre', d.temps.length ? trams(d.temps.map(x => x.t)) : ''),
  ].filter(Boolean).join('');
}

export function classificacio(v, detall) {
  if (!v.classificacio.length) return '';
  const f = v.config.fases;
  const parts = c => [f.escolta && `escolta ${c.escolta}`, f.preguntes && `preguntes ${c.preguntes}`, f.instruccio && `instrucció ${c.instruccio}`,
    f.nivell && `nivell ${c.nivell}`, (f.recursos || f.activacio) && `recursos ${c.recursos}`, f.activacio && `detecció ${c.deteccio}`,
    c.activacio != null && `🚑 ${c.activacio} s`, c.temps != null && `⏱ ${c.temps} s`].filter(Boolean).join(', ');
  return `<div class="panell"><h3>Classificació</h3><ol class="ranquing">${v.classificacio.map(c => `<li><b>${esc(c.nom)}</b> · ${c.punts}/${c.maxim}
    ${detall ? `<span class="suau">(${parts(c)})</span>` : ''}</li>`).join('')}</ol></div>`;
}

// Team scenario: the teams' scores with what each has to review, and the proposed solution
export function panellsEscenari(v) {
  const files = v.classificacio.map((c, i) => `<tr><td>${i + 1}</td><td><b>${esc(c.nom)}</b></td><td>${c.duplicats}</td><td>${c.prioritat}</td><td>${c.recursos}</td><td>${c.rapidesa}</td>
    <td><b>${c.punts}</b>/${c.maxim}</td><td>${c.temps != null ? `${c.temps} s` : '—'}</td></tr>`).join('');
  const errors = v.classificacio.filter(c => c.errors.length).map(c => `<p><b>${esc(c.nom)}</b></p><ul class="resultat-llista">${c.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`).join('');
  const solucio = v.solucio.filter(s => !s.duplicatDe).sort((a, b) => a.ordre - b.ordre)
    .map(s => `<li><b>${s.numero}</b> ${s.nivell ? `<span class="nivell n${s.nivell}">N${s.nivell}</span>` : ''} · ${esc(s.text)} <span class="suau">(${esc(s.correctes.join(', ') || '—')})</span></li>`).join('');
  const duplicats = v.solucio.filter(s => s.duplicatDe).map(s => `<p>🔁 <b>${s.numero}</b> és el mateix servei que ${s.duplicatDe}: cap recurs.</p>`).join('');
  return `<div class="panell"><h3>🏆 Equips</h3><table class="mini taula-equips"><tr><th></th><th>Equip</th><th>Duplicats</th><th>Prioritat</th><th>Recursos</th><th>Rapidesa</th><th>Total</th><th>Acord</th></tr>${files}</table></div>
    <div class="panell"><h3>✓ Proposta</h3><ol class="resultat-llista">${solucio}</ol>${duplicats}</div>
    ${errors ? `<div class="panell"><h3>A revisar</h3>${errors}</div>` : ''}`;
}

// Live state of the teams while they decide, without showing their answers
export function estatEquips(v) {
  return v.equips.filter(e => e.membres.length).map(e => `<div class="equip-estat equip-${esc(e.nom)}"><b>Equip ${esc(e.nom)}</b> <span class="suau">${e.membres.length} membres</span>
    <span>${e.confirmat != null ? `✓ Acord als ${e.confirmat} s` : `Decidint · ${e.acords}/${e.necessaris} d'acord`}</span></div>`).join('')
    || '<p class="suau">Encara no hi ha cap equip.</p>';
}
