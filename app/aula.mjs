// Student phone in the consultor training: join with the session code and a nickname. Recording cases: what was
// heard, a few key questions, the first instruction, the triage level and the units (which can be activated at any
// moment). Card-only cases: send units or not, and which and how many of each kind.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const contingut = $('contingut');

function guardat(clau, valor) {
  try { if (valor !== undefined) localStorage.setItem(clau, valor); return localStorage.getItem(clau) ?? valor; } catch { return valor; }
}
const client = guardat('gamcecos-client') || guardat('gamcecos-client', crypto.randomUUID());
let codi = (new URLSearchParams(location.search).get('codi') || '').toUpperCase();
// Preview from the case form (?prova=1): the tutor sees the case as a student, without giving a name
const prova = new URLSearchParams(location.search).has('prova');
let nom = prova ? 'Tutor (prova)' : guardat('gamcecos-nom') || '';
let vista = null, clauVista = '', ronda = null;
const CAP_MANIOBRA = 'cap';   // as in aula.mjs on the server
const NOM_CAT = { SVA: 'SVA', SVB: 'SVB', HEMS: 'Helicòpter' };
// The screens of a case, in order; each case only has the ones the tutor chose
const PANTALLES = [['escolta', 'Escolta'], ['preguntes', 'Preguntes'], ['instruccio', 'Instrucció'], ['nivell', 'Nivell'], ['recursos', 'Recursos']];
const LOCALS = ['escolta', 'preguntes', 'instruccio'];   // answered on the phone and sent together
const locals = () => LOCALS.filter(f => vista.fases[f]);
const nouEsborrany = () => ({ pas: 'escolta', escolta: new Set(), preguntes: new Set(), instruccio: null, nivell: null, recursos: null, activa: new Set(), enviant: false });
let esborrany = nouEsborrany();

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

// Countdown: only the clock changes every second, so it does not redraw the screen
let fiTemps = null, pasInformat = null;
setInterval(() => {
  const el = $('compte');
  if (fiTemps == null || vista?.estat !== 'oberta') { el.hidden = true; return; }
  const queden = Math.max(0, Math.round((fiTemps - Date.now()) / 1000));
  el.hidden = false;
  el.textContent = queden ? `⏱ ${Math.floor(queden / 60)}:${String(queden % 60).padStart(2, '0')}` : '⏱ Temps!';
  el.classList.toggle('poc', queden <= 20);
}, 500);

// Tells the tutor which screen this student is on
function informaPas(pas) {
  if (vista?.estat !== 'oberta' || pas === pasInformat) return;
  pasInformat = pas;
  fetch(`/api/aula/resposta?codi=${codi}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client, nom, pas }) }).catch(() => {});
}

function rep(v, força = false) {
  if (v.ronda !== ronda) { ronda = v.ronda; esborrany = nouEsborrany(); pasInformat = null; }
  fiTemps = v.queden != null ? Date.now() + v.queden * 1000 : null;
  const { segons, queden, ...resta } = v;
  const clau = JSON.stringify(resta);
  if (clau === clauVista && !força) return;
  clauVista = clau;
  vista = v;
  render();
}

function render() {
  barraRecurs();
  if (vista.tipus === 'escenari') return renderEscenari();
  const v = vista, r = v.resposta;
  const capçal = `<p class="marcador">${esc(nom)} · <b>${esc(v.titol)}</b></p>${v.carta ? `<p class="carta-text carta-mobil">${esc(v.carta)}</p>` : ''}`;
  if (v.estat === 'preparada') {
    contingut.innerHTML = `${capçal}<p class="xifra">${v.tipus === 'carta' ? 'Llegeix la carta del 112.' : 'Escolta la gravació.'}</p><p class="suau">Les respostes s'obriran d'aquí a un moment.</p>`;
    return;
  }
  if (v.estat === 'resultats') { contingut.innerHTML = capçal + resultats(v); return; }
  if (r?.fet) { informaPas('fet'); contingut.innerHTML = `${capçal}<p class="xifra">Resposta enviada ✓</p><p class="suau">Espera que el tutor mostri els resultats.</p>`; return; }
  if (locals().length && !r?.xabcde) {
    if (!locals().includes(esborrany.pas)) esborrany.pas = locals()[0];
    informaPas(esborrany.pas);
    return { escolta: pasEscolta, preguntes: pasPreguntes, instruccio: pasInstruccio }[esborrany.pas](capçal);
  }
  if (v.fases.nivell && !r?.nivell) { informaPas('nivell'); return pasNivell(capçal); }
  informaPas('recursos');
  return v.tipus === 'carta' ? pasCarta(capçal) : pasRecursos(capçal);
}

// Moves between the assessment screens; after the last one the assessment is sent
function seguent() {
  const ls = locals(), i = ls.indexOf(esborrany.pas);
  if (i < ls.length - 1) { esborrany.pas = ls[i + 1]; informaPas(esborrany.pas); render(); scrollTo(0, 0); return; }
  envia({ xabcde: [...esborrany.escolta, ...esborrany.preguntes, ...(esborrany.instruccio ? [esborrany.instruccio] : [])] });
}
function enrere() {
  const ls = locals(), i = ls.indexOf(esborrany.pas);
  if (i > 0) { esborrany.pas = ls[i - 1]; render(); scrollTo(0, 0); }
}
// Label of the "next" button: the name of the next screen, or sending the assessment
function etiquetaSeguent() {
  const ls = locals(), i = ls.indexOf(esborrany.pas);
  if (i < ls.length - 1) return `Següent: ${PANTALLES.find(([f]) => f === ls[i + 1])[1].toLowerCase()} →`;
  return 'Enviar la valoració';
}
const botoEnrere = () => (locals().indexOf(esborrany.pas) > 0 ? '<button class="boto secundari" id="enrere">← Enrere</button>' : '');

const passos = actual => `<div class="passos">${PANTALLES.filter(([f]) => vista.fases[f]).map(([, p], i) => (p === actual ? `<b>${i + 1} ${p}</b>` : `${i + 1} ${p}`)).join(' · ')}</div>`;
const items = seccions => vista.xabcde.map(l => ({ ...l, items: l.items.filter(it => seccions.includes(it.seccio)) })).filter(l => l.items.length);
// Redraws a step keeping the scroll, so ticking does not jump the page
const redibuixa = pas => { const y = scrollY; pas(); scrollTo(0, y); };

// Step 1: what was heard, letter by letter on one screen; "No avaluable" when the recording gives no information
function pasEscolta(capçal) {
  const sel = esborrany.escolta;
  contingut.innerHTML = `${capçal}${passos('Escolta')}<h2>Què has escoltat?</h2>
    <p class="suau">Marca el que hagis sentit a cada lletra, o «No avaluable». Marcar coses que no hi són resta punts.</p>
    ${items(['signes', 'noavaluable']).map(l => `<div class="lletra-escolta"><h3><span class="lletra-gran">${esc(l.lletra)}</span> ${esc(l.nom)}</h3>
      <div class="xips-fila">${l.items.map(it => `<button class="xip-boto ${it.seccio === 'noavaluable' ? 'xip-noaval' : ''} ${sel.has(it.id) ? 'actiu' : ''}" data-item="${esc(it.id)}">${esc(it.seccio === 'noavaluable' ? 'No avaluable' : it.text)}</button>`).join('')}</div></div>`).join('')}
    <div class="navega">${botoEnrere()}<button class="boto gran-boto" id="seguent">${etiquetaSeguent()}</button></div>`;
  contingut.querySelectorAll('[data-item]').forEach(b => b.onclick = () => { sel.has(b.dataset.item) ? sel.delete(b.dataset.item) : sel.add(b.dataset.item); redibuixa(() => pasEscolta(capçal)); });
  $('enrere')?.addEventListener('click', enrere);
  $('seguent').onclick = seguent;
}

// Step 2: only a few questions fit in the call: choose the key ones
function pasPreguntes(capçal) {
  const sel = esborrany.preguntes, max = vista.preguntes, queden = max - sel.size;
  contingut.innerHTML = `${capçal}${passos('Preguntes')}<h2>Quines preguntes faries?</h2>
    <p class="pressupost ${queden ? '' : 'esgotat'}">Pots fer <b>${max}</b> preguntes · ${queden ? `et ${queden === 1 ? 'queda' : 'queden'} <b>${queden}</b>` : 'no te\'n queden'}</p>
    ${items(['anamnesi']).map(l => `<div class="lletra-escolta"><h3><span class="lletra-gran">${esc(l.lletra)}</span> ${esc(l.nom)}</h3>
      <div class="xips">${l.items.map(it => `<button class="xip-boto ${sel.has(it.id) ? 'actiu' : ''}" data-item="${esc(it.id)}" ${!sel.has(it.id) && !queden ? 'disabled' : ''}>${esc(it.text)}</button>`).join('')}</div></div>`).join('')}
    <div class="navega">${botoEnrere()}<button class="boto gran-boto" id="seguent">${etiquetaSeguent()}</button></div>`;
  contingut.querySelectorAll('[data-item]').forEach(b => b.onclick = () => { sel.has(b.dataset.item) ? sel.delete(b.dataset.item) : sel.add(b.dataset.item); redibuixa(() => pasPreguntes(capçal)); });
  $('enrere')?.addEventListener('click', enrere);
  $('seguent').onclick = seguent;
}

// Step 3: the first instruction to the caller (one only), or none needed
function pasInstruccio(capçal) {
  const triada = esborrany.instruccio;
  contingut.innerHTML = `${capçal}${passos('Instrucció')}<h2>Quina és la primera instrucció que dones?</h2>
    <p class="suau">Només una: la més urgent.</p>
    <div class="xips"><button class="xip-boto ${triada === CAP_MANIOBRA ? 'actiu' : ''}" data-item="${CAP_MANIOBRA}">Cap: només vigilar i esperar l'ambulància</button></div>
    ${items(['maniobres']).map(l => `<div class="lletra-escolta"><h3><span class="lletra-gran">${esc(l.lletra)}</span> ${esc(l.nom)}</h3>
      <div class="xips">${l.items.map(it => `<button class="xip-boto ${triada === it.id ? 'actiu' : ''}" data-item="${esc(it.id)}">${esc(it.text)}</button>`).join('')}</div></div>`).join('')}
    <div class="navega">${botoEnrere()}<button class="boto gran-boto" id="seguent" ${triada ? '' : 'disabled'}>${etiquetaSeguent()}</button></div>`;
  contingut.querySelectorAll('[data-item]').forEach(b => b.onclick = () => { esborrany.instruccio = b.dataset.item; redibuixa(() => pasInstruccio(capçal)); });
  $('enrere')?.addEventListener('click', enrere);
  $('seguent').onclick = seguent;
}

// Step 4: triage level
function pasNivell(capçal) {
  contingut.innerHTML = `${capçal}${passos('Nivell')}
    <h2>Quin nivell de triatge hi poses?</h2>
    <div class="nivells nivells-mobil">${[1, 2, 3, 4, 5].map(n => `<button class="opcio n${n} ${esborrany.nivell === n ? 'triada' : ''}" data-n="${n}">N${n}</button>`).join('')}</div>
    <button class="boto gran-boto" id="seguent" ${esborrany.nivell ? '' : 'disabled'}>Confirmar N${esborrany.nivell || ''}</button>`;
  contingut.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { esborrany.nivell = Number(b.dataset.n); pasNivell(capçal); });
  $('seguent').onclick = () => envia({ nivell: esborrany.nivell });
}

// Fixed bar while assessing a recording: activate units as soon as the severity is clear
function barraRecurs() {
  const v = vista, r = v?.resposta;
  // Until the units screen (or the end): from then on the units are chosen there
  const aRecursos = v?.fases?.recursos && (!LOCALS.some(f => v.fases[f]) || r?.xabcde) && (!v.fases.nivell || r?.nivell);
  const visible = v?.estat === 'oberta' && v.fases?.activacio && !r?.fet && !aRecursos;
  $('barra-recurs').hidden = !visible;
  if (!visible) { $('capa-recurs').hidden = true; return; }
  const a = r?.activacio;
  $('barra-recurs').innerHTML = a
    ? `<button class="activat">🚑 Recurs activat al segon ${a.t} · ${esc(a.recursos.join(', '))} <span>Modificar</span></button>`
    : '<button>🚑 Activar recurs ara</button>';
  $('barra-recurs').querySelector('button').onclick = () => { esborrany.activa = new Set(a?.recursos || []); capaRecurs(); };
}

function capaRecurs() {
  const sel = esborrany.activa;
  $('capa-recurs').hidden = false;
  $('capa-recurs').innerHTML = `<div class="capa-contingut"><h2>Quines unitats actives ara?</h2>
    <p class="suau">Incident a ${esc(vista.municipi)}. Toca les unitats i prem «Activar» a baix: queda fet i es registra el moment.</p>
    ${llistaUnitats(sel)}</div>
    <div class="barra-accio"><button class="boto secundari" id="tanca-capa">Tancar</button>
      <button class="boto gran-boto" id="activa" ${sel.size ? '' : 'disabled'}>${sel.size ? `🚑 Activar: ${resum(sel)}` : 'Toca les unitats'}</button></div>`;
  $('capa-recurs').querySelectorAll('[data-u]').forEach(b => b.onclick = () => {
    sel.has(b.dataset.u) ? sel.delete(b.dataset.u) : sel.add(b.dataset.u);
    const y = $('capa-recurs').scrollTop;
    capaRecurs();
    $('capa-recurs').scrollTop = y;
  });
  $('tanca-capa').onclick = () => { $('capa-recurs').hidden = true; };
  $('activa').onclick = async () => { $('capa-recurs').hidden = true; await envia({ activa: [...sel] }); };
}

// "2 SVA · 3 SVB" for the units selected
function resum(sel) {
  const n = {};
  for (const id of sel) { const u = vista.unitats.find(x => x.indicatiu === id); if (u) n[u.cat] = (n[u.cat] || 0) + 1; }
  return Object.keys(NOM_CAT).filter(c => n[c]).map(c => `${n[c]} ${NOM_CAT[c]}`).join(' · ');
}

// Units with their kind well in sight: in an accident the point is how many of each kind
const llistaUnitats = sel => `<div class="opcions">${vista.unitats.map(u => `<button class="opcio unitat-mobil ${sel.has(u.indicatiu) ? 'triada' : ''}" data-u="${esc(u.indicatiu)}" ${u.ocupada ? 'disabled' : ''}>
  <span class="cat-unitat cat-${u.cat}">${NOM_CAT[u.cat]}</span> <b>${esc(u.indicatiu)}</b> <span class="suau">${esc(u.tipus)}</span>
  <span class="nvots">${u.ocupada ? 'ocupada' : `${u.eta} min`}</span><br><span class="suau">${esc(u.base)} · ${u.km} km</span></button>`).join('')}</div>`;

// Unit list with the action always in sight: a fixed bar at the bottom; one tap and it is done
function triaUnitats(capçal, titol, text, etiquetaBoto, senseRes) {
  const sel = esborrany.recursos;
  contingut.innerHTML = `${capçal}<h2>${titol}</h2><p class="suau">${text}</p>${llistaUnitats(sel)}`;
  contingut.querySelectorAll('[data-u]').forEach(b => b.onclick = () => {
    sel.has(b.dataset.u) ? sel.delete(b.dataset.u) : sel.add(b.dataset.u);
    redibuixa(() => triaUnitats(capçal, titol, text, etiquetaBoto, senseRes));
  });
  $('barra-recurs').hidden = false;
  $('barra-recurs').innerHTML = `<button class="${sel.size ? 'activa-unitats' : 'cap-recurs'}">${etiquetaBoto(sel)}</button>`;
  $('barra-recurs').querySelector('button').onclick = () => {
    if (!sel.size && senseRes && !confirm(senseRes)) return;
    envia({ recursos: [...sel] });
  };
}

// Step 5 (recording): units to send, starting from the ones activated while assessing
function pasRecursos(capçal) {
  const r = vista.resposta;
  // Units already activated with the bar: that is the answer, nothing else to confirm
  if (r.activacio && !esborrany.enviant) { esborrany.enviant = true; envia({ recursos: r.activacio.recursos }); return; }
  esborrany.recursos ??= new Set();
  triaUnitats(`${capçal}${passos('Recursos')}`, 'Quines unitats actives?',
    `Incident a ${esc(vista.municipi)}.${r.nivell ? ` Nivell triat: <span class="nivell n${r.nivell}">N${r.nivell}</span>.` : ''} Toca les que vulguis i prem el botó de baix.`,
    sel => (sel.size ? `🚑 Activar: ${resum(sel)}` : '📞 Cap recurs: consell telefònic'), 'Confirmes que no hi envies cap recurs?');
}

// Card-only case: send units or not, and which and how many of each kind
// Card-only case: straight to the units; with none ticked the button says no units are sent
function pasCarta(capçal) {
  esborrany.recursos ??= new Set();
  triaUnitats(capçal, 'Quines unitats hi envies?', `Incident a ${esc(vista.municipi)}. Toca quantes en calguin de cada tipus i prem el botó de baix.`,
    sel => (sel.size ? `🚑 Activar: ${resum(sel)}` : '📞 No hi envio cap recurs'), 'Confirmes que no hi envies cap recurs?');
}

function resultats(v) {
  const r = v.resposta, p = v.puntuacio;
  if (!r) return '<p>No has respost aquest cas.</p><p class="suau">Espera el següent.</p>';
  const ok = b => (b ? '<span class="encert">✓</span>' : '<span class="error-resp">✗</span>');
  const marcats = new Set(r.xabcde || []);
  const unitats = ids => (ids?.length ? ids.join(', ') : 'cap recurs');
  const f = v.fases;
  const meves = (f.recursos ? r.recursos : r.activacio?.recursos) || [];
  const recursos = !f.recursos && !f.activacio ? '' : `<h3>Recursos</h3>
    ${f.activacio ? `<p>${r.activacio ? `🚑 Has activat al segon <b>${r.activacio.t}</b>, ${r.activacio.abansValoracio ? 'abans d\'acabar la valoració' : 'després de la valoració'}${p.deteccio ? ' <span class="encert">+1 detecció precoç</span>' : ''}` : 'No has activat cap recurs durant la valoració.'}</p>` : ''}
    <p>Els teus: <b>${esc(meves.length ? resum(new Set(meves)) : 'cap recurs')}</b> <span class="suau">(${esc(unitats(meves))})</span><br>
    Proposta: <b>${esc(v.correcte.text)}</b> <span class="suau">(${esc(unitats(v.correcte.recursos))})</span> ${ok(p.recursos >= 2)}</p>`;
  if (!LOCALS.some(x => f[x]) && !f.nivell) return `<p class="xifra">${p.punts} / ${p.maxim} punts</p>${recursos}`;
  // Right items chosen, items chosen that did not apply, and right items missed
  const llista = seccions => {
    const totes = v.xabcde.flatMap(l => l.items.filter(it => seccions.includes(it.seccio)).map(it => ({ ...it, lletra: l.lletra })));
    const files = totes.filter(it => it.correcte || marcats.has(it.id)).map(it => {
      const marca = marcats.has(it.id);
      // Extra questions only use up the budget; extra signs and instructions are wrong
      const sobra = it.seccio === 'anamnesi' ? '<span class="falta">· no era clau</span>' : '<span class="error-resp">✗ no tocava</span>';
      const estat = it.correcte && marca ? '<span class="encert">✓</span>' : marca ? sobra : '<span class="falta">○ faltava</span>';
      return `<li>${estat} <b>${esc(it.lletra)}</b> ${esc(it.seccio === 'noavaluable' ? 'No avaluable' : it.text)}</li>`;
    });
    return files.length ? `<ul class="resultat-llista">${files.join('')}</ul>` : '<p class="suau">Res a marcar.</p>';
  };
  const capInstruccio = marcats.has(CAP_MANIOBRA);
  const capCorrecte = !v.xabcde.some(l => l.items.some(it => it.seccio === 'maniobres' && it.correcte));
  return `<p class="xifra">${p.punts} / ${p.maxim} punts</p>
    ${f.escolta ? `<h3>Escolta <span class="suau">(${p.escolta} punts)</span></h3>${llista(['signes', 'noavaluable'])}` : ''}
    ${f.preguntes ? `<h3>Preguntes <span class="suau">(${p.preguntes} punts)</span></h3>${llista(['anamnesi'])}` : ''}
    ${f.instruccio ? `<h3>Primera instrucció <span class="suau">(${p.instruccio} punts)</span></h3>${capInstruccio || capCorrecte
      ? `<p>${capInstruccio ? 'Has triat: cap instrucció' : ''} ${capCorrecte ? `· correcte: cap instrucció ${ok(capInstruccio)}` : ''}</p>` : ''}${llista(['maniobres'])}` : ''}
    ${f.nivell ? `<h3>Nivell</h3><p>El teu: ${r.nivell ? `<span class="nivell n${r.nivell}">N${r.nivell}</span>` : '—'}
      ${v.correcte.nivell ? ` · correcte: <span class="nivell n${v.correcte.nivell}">N${v.correcte.nivell}</span> ${ok(r.nivell === v.correcte.nivell)}` : ''}</p>` : ''}
    ${recursos}`;
}

// ---------- Team scenario: one shared board per team ----------

let triantPer = null;   // incident whose unit picker is open

function renderEscenari() {
  const v = vista, d = v.decisio;
  const capçal = `<p class="marcador">${esc(nom)} · <b>${esc(v.titol)}</b></p>`;
  $('barra-recurs').hidden = true;
  if (!v.equip) {
    contingut.innerHTML = `${capçal}<h2>Tria el teu equip</h2><div class="opcions">${v.equips.map(e => `<button class="opcio gran-opcio equip-${esc(e.nom)}" data-equip="${esc(e.nom)}">Equip ${esc(e.nom)} <span class="nvots">${e.membres} ${e.membres === 1 ? 'membre' : 'membres'}</span></button>`).join('')}</div>`;
    contingut.querySelectorAll('[data-equip]').forEach(b => b.onclick = () => envia({ equip: b.dataset.equip }));
    return;
  }
  const capEquip = `<div class="equip-cap equip-${esc(v.equip)}">Equip ${esc(v.equip)} <span>${esc(d.membres.join(', '))}</span></div>`;
  if (v.estat === 'preparada') { contingut.innerHTML = `${capçal}${capEquip}<p class="xifra">Prepareu-vos.</p><p class="suau">Quan s'obri l'escenari veureu diversos incidents alhora i unes poques unitats per a tots.</p>`; return; }
  if (v.estat === 'resultats') { contingut.innerHTML = capçal + capEquip + resultatsEscenari(v); return; }
  const inc = id => v.incidents.find(x => x.id === id);
  const unitatsDe = id => Object.entries(d.assignacio).filter(([, i]) => i === id).map(([u]) => v.unitats.find(x => x.indicatiu === u)).filter(Boolean);
  const lliures = v.unitats.filter(u => !u.ocupada && !d.assignacio[u.indicatiu]);
  const tancat = d.confirmat != null;
  contingut.innerHTML = `${capçal}${capEquip}
    ${d.canvi ? `<p class="canvi">✎ ${esc(d.canvi)}</p>` : ''}
    <p class="suau">Entre tots: marqueu els duplicats, ordeneu per prioritat i repartiu les unitats. Quan la majoria hi estigui d'acord, la decisió queda confirmada.</p>
    <h2>Incidents per prioritat</h2>
    ${d.ordre.map((id, k) => {
      const x = inc(id), dup = d.duplicats[id];
      return `<div class="inc-equip ${dup ? 'duplicat' : ''}">
        <div class="inc-cap"><span class="prio">${dup ? 'DUP' : k + 1}</span><b>${x.numero}</b> <span class="suau">${esc(x.municipi)}</span>
          ${tancat ? '' : `<span class="mou"><button data-amunt="${id}" ${k ? '' : 'disabled'}>▲</button><button data-avall="${id}" ${k < d.ordre.length - 1 ? '' : 'disabled'}>▼</button></span>`}</div>
        <p class="carta-text carta-mobil">${esc(x.carta)}</p>
        <label class="dup">Duplicat de <select data-dup="${id}" ${tancat ? 'disabled' : ''}><option value="">No és duplicat</option>
          ${v.incidents.filter(y => y.id !== id).map(y => `<option value="${y.id}" ${dup === y.id ? 'selected' : ''}>${y.numero} · ${esc(y.municipi)}</option>`).join('')}</select></label>
        <div class="assignades">${unitatsDe(id).map(u => `<span class="unitat-xip"><span class="cat-unitat cat-${u.cat}">${NOM_CAT[u.cat]}</span> ${esc(u.indicatiu)} <span class="suau">${u.etes[id]}'</span>
          ${tancat ? '' : `<button data-treu="${esc(u.indicatiu)}">✕</button>`}</span>`).join('') || '<span class="suau">Sense unitats</span>'}</div>
        ${tancat ? '' : `<button class="boto-petit" data-afegeix="${id}">+ Assignar unitat</button>`}</div>`;
    }).join('')}
    <h3>Unitats lliures</h3><p>${lliures.map(u => `<span class="cat-unitat cat-${u.cat}">${NOM_CAT[u.cat]}</span> ${esc(u.indicatiu)}`).join(' · ') || '<span class="suau">Totes assignades</span>'}</p>`;
  const mou = (id, pas) => { const o = [...d.ordre], i = o.indexOf(id); [o[i], o[i + pas]] = [o[i + pas], o[i]]; envia({ accio: { tipus: 'ordre', ordre: o } }); };
  contingut.querySelectorAll('[data-amunt]').forEach(b => b.onclick = () => mou(b.dataset.amunt, -1));
  contingut.querySelectorAll('[data-avall]').forEach(b => b.onclick = () => mou(b.dataset.avall, 1));
  contingut.querySelectorAll('[data-dup]').forEach(s => s.onchange = () => envia({ accio: { tipus: 'duplicat', incident: s.dataset.dup, de: s.value || null } }));
  contingut.querySelectorAll('[data-treu]').forEach(b => b.onclick = () => envia({ accio: { tipus: 'assigna', unitat: b.dataset.treu, incident: null } }));
  contingut.querySelectorAll('[data-afegeix]').forEach(b => b.onclick = () => { triantPer = b.dataset.afegeix; selectorEscenari(); });
  // Agreement bar: the decision counts when most of the team agree
  $('barra-recurs').hidden = false;
  $('barra-recurs').innerHTML = tancat ? `<button class="activat">✓ Decisió d'equip confirmada (${d.confirmat} s)</button>`
    : `<button class="${d.meuAcord ? 'activat' : 'acord'}">${d.meuAcord ? '✓ Hi estàs d\'acord' : '✋ Hi estic d\'acord'} · ${d.acords}/${d.necessaris} necessaris</button>`;
  if (!tancat) $('barra-recurs').querySelector('button').onclick = () => envia({ accio: { tipus: 'acord', si: !d.meuAcord } });
  if (triantPer) selectorEscenari();
}

// Unit picker for one incident: free units with their arrival time to it; units already elsewhere can be moved
function selectorEscenari() {
  const v = vista, d = v.decisio, x = v.incidents.find(i => i.id === triantPer);
  if (!x || v.estat !== 'oberta' || d.confirmat != null) { $('capa-recurs').hidden = true; triantPer = null; return; }
  const unitats = v.unitats.filter(u => !u.ocupada && d.assignacio[u.indicatiu] !== x.id).sort((a, b) => a.etes[x.id] - b.etes[x.id]);
  $('capa-recurs').hidden = false;
  $('capa-recurs').innerHTML = `<div class="capa-contingut"><h2>Unitat per a ${x.numero}</h2><p class="suau">${esc(x.municipi)} · temps d'arribada a aquest incident</p>
    <div class="opcions">${unitats.map(u => { const on = d.assignacio[u.indicatiu]; return `<button class="opcio unitat-mobil" data-u="${esc(u.indicatiu)}">
      <span class="cat-unitat cat-${u.cat}">${NOM_CAT[u.cat]}</span> <b>${esc(u.indicatiu)}</b> <span class="suau">${esc(u.tipus)}</span><span class="nvots">${u.etes[x.id]} min</span>
      <br><span class="suau">${esc(u.base)}${on ? ` · ara a ${v.incidents.find(i => i.id === on)?.numero}` : ''}</span></button>`; }).join('') || '<p class="suau">No queden unitats.</p>'}</div>
    <button class="boto secundari" id="tanca-capa">Tancar</button></div>`;
  $('capa-recurs').querySelectorAll('[data-u]').forEach(b => b.onclick = () => { const id = triantPer; triantPer = null; $('capa-recurs').hidden = true; envia({ accio: { tipus: 'assigna', unitat: b.dataset.u, incident: id } }); });
  $('tanca-capa').onclick = () => { triantPer = null; $('capa-recurs').hidden = true; };
}

function resultatsEscenari(v) {
  const p = v.decisio.puntuacio;
  return `<p class="xifra">${p.punts} / ${p.maxim} punts d'equip</p>
    <p>Duplicats ${p.duplicats} · Prioritat ${p.prioritat} · Recursos ${p.recursos} · Rapidesa ${p.rapidesa}</p>
    ${p.errors.length ? `<h3>A revisar</h3><ul class="resultat-llista">${p.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '<p class="encert">Cap error. Molt bé!</p>'}
    <h3>Proposta</h3><ol class="resultat-llista">${v.solucio.filter(s => !s.duplicatDe).sort((a, b) => a.ordre - b.ordre)
      .map(s => `<li><b>${s.numero}</b> ${s.nivell ? `<span class="nivell n${s.nivell}">N${s.nivell}</span>` : ''} · ${esc(s.text)} <span class="suau">(${esc(s.correctes.join(', ') || '—')})</span></li>`).join('')}</ol>
    ${v.solucio.filter(s => s.duplicatDe).map(s => `<p>🔁 <b>${s.numero}</b> era un duplicat de ${s.duplicatDe}: no calia cap recurs.</p>`).join('')}`;
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
