// Student phone in the consultor training: join with the session code and a nickname, then, while answers are
// open, mark the XABCDE findings, set the triage level and choose which units to activate.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const COLOR = { SVAm: '#e53935', SVAi: '#fb8c00', VIR: '#ab47bc', SVB: '#42a5f5', 'SVB-P': '#90caf9', HELI: '#66bb6a' };   // as in territori.mjs
const contingut = $('contingut');

function guardat(clau, valor) {
  try { if (valor !== undefined) localStorage.setItem(clau, valor); return localStorage.getItem(clau) ?? valor; } catch { return valor; }
}
const client = guardat('gamcecos-client') || guardat('gamcecos-client', crypto.randomUUID());
let codi = (new URLSearchParams(location.search).get('codi') || '').toUpperCase();
let nom = guardat('gamcecos-nom') || '';
let vista = null, clauVista = '', ronda = null;
let esborrany = { xabcde: {}, nivell: null, recursos: new Set() };

async function envia(dades) {
  const r = await fetch(`/api/aula/resposta?codi=${codi}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client, nom, ...dades }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { alert(d.error || 'No s\'ha pogut enviar'); return; }
  rep(d, true);
}

async function pregunta() {
  try {
    const r = await fetch(`/api/aula/estat?codi=${codi}&client=${client}`, { cache: 'no-store' });
    if (r.status === 404) { contingut.innerHTML = '<p>No existeix cap sessió amb aquest codi.</p><p><a href="/aula">Torna-ho a provar</a></p>'; return; }
    rep(await r.json());
  } catch { /* network glitch: try again */ }
  setTimeout(pregunta, 1500);
}

function rep(v, força = false) {
  if (v.ronda !== ronda) { ronda = v.ronda; esborrany = { xabcde: {}, nivell: null, recursos: new Set() }; }
  const clau = JSON.stringify(v);
  if (clau === clauVista && !força) return;
  clauVista = clau;
  vista = v;
  render();
}

function render() {
  const v = vista, r = v.resposta;
  const capçal = `<p class="marcador">${esc(nom)} · <b>${esc(v.titol)}</b></p>`;
  if (v.estat === 'preparada') { contingut.innerHTML = `${capçal}<p class="xifra">Escolta la gravació.</p><p class="suau">Les respostes s'obriran d'aquí a un moment.</p>`; return; }
  if (v.estat === 'resultats') { contingut.innerHTML = capçal + resultats(v); return; }
  if (!r?.xabcde) return pasXabcde(capçal);
  if (!r.nivell) return pasNivell(capçal);
  if (!r.recursos) return pasRecursos(capçal);
  contingut.innerHTML = `${capçal}<p class="xifra">Resposta enviada ✓</p><p class="suau">Espera que el tutor mostri els resultats.</p>`;
}

// Step 1: one finding per letter
function pasXabcde(capçal) {
  const complet = vista.xabcde.every(l => esborrany.xabcde[l.lletra] != null);
  contingut.innerHTML = `${capçal}<div class="passos"><b>1 XABCDE</b> · 2 Nivell · 3 Recursos</div>
    ${vista.xabcde.map(l => `<div class="lletra"><h2><span class="lletra-gran">${esc(l.lletra)}</span> ${esc(l.nom)}</h2>
      <div class="opcions">${l.opcions.map((o, i) => `<button class="opcio ${esborrany.xabcde[l.lletra] === i ? 'triada' : ''}" data-lletra="${esc(l.lletra)}" data-i="${i}">${esc(o)}</button>`).join('')}</div></div>`).join('')}
    <button class="boto gran-boto" id="seguent" ${complet ? '' : 'disabled'}>Següent: nivell de triatge</button>`;
  contingut.querySelectorAll('[data-lletra]').forEach(b => b.onclick = () => {
    esborrany.xabcde[b.dataset.lletra] = Number(b.dataset.i);
    const y = scrollY;
    pasXabcde(capçal);
    scrollTo(0, y);
  });
  $('seguent').onclick = () => envia({ xabcde: esborrany.xabcde });
}

// Step 2: triage level
function pasNivell(capçal) {
  contingut.innerHTML = `${capçal}<div class="passos">1 XABCDE · <b>2 Nivell</b> · 3 Recursos</div>
    <h2>Quin nivell de triatge hi poses?</h2>
    <div class="nivells nivells-mobil">${[1, 2, 3, 4, 5].map(n => `<button class="opcio n${n} ${esborrany.nivell === n ? 'triada' : ''}" data-n="${n}">N${n}</button>`).join('')}</div>
    <button class="boto gran-boto" id="seguent" ${esborrany.nivell ? '' : 'disabled'}>Confirmar N${esborrany.nivell || ''}</button>`;
  contingut.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { esborrany.nivell = Number(b.dataset.n); pasNivell(capçal); });
  $('seguent').onclick = () => envia({ nivell: esborrany.nivell });
}

// Step 3: units to activate (none means telephone advice)
function pasRecursos(capçal) {
  const sel = esborrany.recursos;
  contingut.innerHTML = `${capçal}<div class="passos">1 XABCDE · 2 Nivell · <b>3 Recursos</b></div>
    <h2>Quines unitats actives?</h2><p class="suau">Incident a ${esc(vista.municipi)}. Nivell triat: <span class="nivell n${vista.resposta.nivell}">N${vista.resposta.nivell}</span>. Pots triar-ne més d'una.</p>
    <div class="opcions">${vista.unitats.map(u => `<button class="opcio unitat-mobil ${sel.has(u.indicatiu) ? 'triada' : ''}" data-u="${esc(u.indicatiu)}" ${u.ocupada ? 'disabled' : ''}>
      <span class="punt" style="background:${COLOR[u.tipus] || '#888'}"></span><b>${esc(u.indicatiu)}</b> ${esc(u.tipus)}
      <span class="nvots">${u.ocupada ? 'ocupada' : `${u.eta} min`}</span><br><span class="suau">${esc(u.base)} · ${u.km} km</span></button>`).join('')}</div>
    <button class="boto gran-boto" id="seguent">${sel.size ? `Activar ${sel.size} unitat${sel.size > 1 ? 's' : ''}` : 'Cap recurs: consell telefònic'}</button>`;
  contingut.querySelectorAll('[data-u]').forEach(b => b.onclick = () => {
    sel.has(b.dataset.u) ? sel.delete(b.dataset.u) : sel.add(b.dataset.u);
    const y = scrollY;
    pasRecursos(capçal);
    scrollTo(0, y);
  });
  $('seguent').onclick = () => envia({ recursos: [...sel] });
}

function resultats(v) {
  const r = v.resposta, p = v.puntuacio;
  if (!r) return '<p>No has respost aquesta gravació.</p><p class="suau">Espera la següent.</p>';
  const ok = b => (b ? '<span class="encert">✓</span>' : '<span class="error-resp">✗</span>');
  const files = v.xabcde.map(l => {
    const meva = r.xabcde?.[l.lletra];
    return `<tr><td><b>${esc(l.lletra)}</b></td><td>${meva != null ? esc(l.opcions[meva]) : '—'}</td>
      <td>${l.correcta == null ? '<span class="suau">no puntua</span>' : `${ok(meva === l.correcta)} ${meva === l.correcta ? '' : esc(l.opcions[l.correcta])}`}</td></tr>`;
  }).join('');
  const unitats = ids => (ids?.length ? ids.join(', ') : 'cap recurs');
  return `<p class="xifra">${p.punts} / ${p.maxim} punts</p>
    <h3>XABCDE</h3><table class="mini resultat-aula">${files}</table>
    <h3>Nivell</h3><p>El teu: ${r.nivell ? `<span class="nivell n${r.nivell}">N${r.nivell}</span>` : '—'}
      ${v.correcte.nivell ? ` · correcte: <span class="nivell n${v.correcte.nivell}">N${v.correcte.nivell}</span> ${ok(r.nivell === v.correcte.nivell)}` : ''}</p>
    <h3>Recursos</h3><p>Els teus: ${esc(unitats(r.recursos))}<br>Proposta: <b>${esc(v.correcte.combo)}</b> · ${esc(unitats(v.correcte.recursos))} ${ok(p.recursos === 3)}</p>`;
}

function entra() {
  contingut.innerHTML = `<form class="opcions" id="entra">
    <label>Codi de la sessió <input name="codi" maxlength="4" value="${esc(codi)}" autocapitalize="characters" required style="text-transform:uppercase"></label>
    <label>El teu nom o àlies <input name="nom" maxlength="24" value="${esc(nom)}" required></label>
    <button class="boto gran-boto">Entrar</button></form>`;
  $('entra').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    nom = guardat('gamcecos-nom', f.get('nom').trim());
    codi = f.get('codi').trim().toUpperCase();
    history.replaceState(null, '', `?codi=${codi}`);
    pregunta();
  };
}

if (codi && nom) pregunta(); else entra();
