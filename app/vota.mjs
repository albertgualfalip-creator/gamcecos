// Audience screen: joins a room with its code and a nickname, votes the open decision and collects points.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const contingut = document.getElementById('contingut');

function guardat(clau, valor) {
  try {
    if (valor !== undefined) localStorage.setItem(clau, valor);
    return localStorage.getItem(clau);
  } catch {
    return (window.memoria ||= {})[clau] = valor ?? window.memoria?.[clau] ?? null;
  }
}
const client = guardat('gamcecos-client') || guardat('gamcecos-client', crypto.randomUUID());
const sala = (new URLSearchParams(location.search).get('sala') || '').toUpperCase();
let nom = guardat('gamcecos-nom') || '';
let pas = null, tria = new Set(), enviat = false, punts = null;

function render() {
  const marcador = punts ? `<p class="marcador">${esc(nom)} · <b>${punts.punts} punts</b>${punts.posicio ? ` · posició ${punts.posicio} de ${punts.total}` : ''}</p>` : '';
  if (!pas) {
    contingut.innerHTML = `${marcador}<p class="suau">Esperant la següent decisió de l'equip...</p>`;
    return;
  }
  const max = pas.max || 1;
  let html = `${marcador}<div class="suau">${esc(pas.titol)}</div><h2>${esc(pas.pregunta)}</h2>`;
  if (max > 1) html += `<p class="suau">Pots triar fins a ${max} opcions.</p>`;
  html += `<div class="opcions">${pas.opcions.map(o =>
    `<button class="opcio ${tria.has(o.id) ? 'triada' : ''}" data-id="${o.id}" ${pas.obert ? '' : 'disabled'}>${esc(o.text)}</button>`).join('')}</div>`;
  if (pas.obert) {
    html += `<div class="accions"><button class="boto" id="envia" ${tria.size ? '' : 'disabled'}>${enviat ? 'Canviar el vot' : 'Enviar vot'}</button></div>`;
    if (enviat) html += '<p class="suau">Vot enviat. Pots canviar-lo fins que l\'equip decideixi.</p>';
  } else if (pas.resultat) {
    const r = pas.resultat;
    html += `<div class="retroaccio" style="border-color:var(--${r.valoracio})">
      <p>L'equip ha decidit: <b>${esc(r.equip)}</b></p>
      <span class="etiqueta v-${r.valoracio}">${esc(r.etiqueta)}</span><p>${esc(r.feedback)}</p></div>`;
  }
  contingut.innerHTML = html;
  contingut.querySelectorAll('.opcio').forEach(b => b.onclick = () => {
    const id = b.dataset.id;
    if (max === 1) { tria.clear(); tria.add(id); } else if (tria.has(id)) tria.delete(id); else if (tria.size < max) tria.add(id);
    render();
  });
  document.getElementById('envia')?.addEventListener('click', envia);
}

async function envia() {
  const r = await fetch(`/api/vot?sala=${sala}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client, nom, opcions: [...tria] }) });
  enviat = r.ok;
  render();
}

async function actualitzaPunts() {
  punts = await fetch(`/api/punts?sala=${sala}&client=${client}`).then(r => r.json()).catch(() => punts);
  render();
}

function entra() {
  const fonts = new EventSource(`/api/events?sala=${sala}&rol=public`);
  fonts.onerror = () => { if (fonts.readyState === EventSource.CLOSED) contingut.innerHTML = '<p>No s\'ha trobat la sala. Reviseu el codi.</p>'; };
  fonts.addEventListener('pas', e => {
    const nou = JSON.parse(e.data);
    if (!nou || nou.id !== pas?.id || (nou.obert && !pas?.obert)) { tria = new Set(); enviat = false; }
    pas = nou;
    render();
  });
  fonts.addEventListener('classificacio', actualitzaPunts);
  actualitzaPunts();
}

if (!sala || !nom) {
  contingut.innerHTML = `<form class="opcions" id="entra">
    <label>Codi de la sala <input name="sala" maxlength="4" value="${esc(sala)}" autocapitalize="characters" required style="text-transform:uppercase"></label>
    <label>El teu àlies <input name="nom" maxlength="24" value="${esc(nom)}" required></label>
    <button class="boto">Entrar</button></form>`;
  document.getElementById('entra').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    guardat('gamcecos-nom', f.get('nom').trim());
    location.search = `?sala=${encodeURIComponent(f.get('sala').trim().toUpperCase())}`;
  };
} else {
  entra();
}
