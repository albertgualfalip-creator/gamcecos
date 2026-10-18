// Audience screen: shows the open question and sends this viewer's vote.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const contingut = document.getElementById('contingut');

function idClient() {
  try {
    let id = localStorage.getItem('gamcecos-client');
    if (!id) localStorage.setItem('gamcecos-client', id = crypto.randomUUID());
    return id;
  } catch {
    return window.idTemporal ||= Math.random().toString(36).slice(2);
  }
}

const sala = (new URLSearchParams(location.search).get('sala') || '').toUpperCase();
let pas = null, tria = new Set(), enviat = false;

function render() {
  if (!pas) {
    contingut.innerHTML = '<p class="suau">Esperant que l\'equip obri la següent decisió...</p>';
    return;
  }
  const max = pas.max || 1;
  let html = `<div class="suau">${esc(pas.titol)}</div><h2>${esc(pas.pregunta)}</h2>`;
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
    if (max === 1) { tria.clear(); tria.add(id); }
    else if (tria.has(id)) tria.delete(id);
    else if (tria.size < max) tria.add(id);
    render();
  });
  document.getElementById('envia')?.addEventListener('click', envia);
}

async function envia() {
  const r = await fetch(`/api/vot?sala=${sala}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client: idClient(), opcions: [...tria] }) });
  enviat = r.ok;
  render();
}

if (!sala) {
  contingut.innerHTML = `<form class="opcions" id="entra"><label>Codi de la sala <input name="sala" maxlength="4" autocapitalize="characters" required
    style="font:inherit;padding:.6rem;text-transform:uppercase"></label><button class="boto">Entrar</button></form>`;
  document.getElementById('entra').onsubmit = e => {
    e.preventDefault();
    location.search = `?sala=${encodeURIComponent(new FormData(e.target).get('sala').trim().toUpperCase())}`;
  };
}

const fonts = sala ? new EventSource(`/api/events?sala=${sala}`) : new EventTarget();
fonts.onerror = () => { if (fonts.readyState === EventSource.CLOSED) contingut.innerHTML = '<p>No s\'ha trobat la sala. Reviseu el codi.</p>'; };
fonts.addEventListener('pas', e => {
  const nou = JSON.parse(e.data);
  if (!nou || nou.id !== pas?.id || (nou.obert && !pas?.obert)) { tria = new Set(); enviat = false; }
  pas = nou;
  render();
});
