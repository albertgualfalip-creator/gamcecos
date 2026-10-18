// Shared map pieces for the UCT and the shift supervisor: units at their current position, coverage of the
// population points and preventive moves between bases.
import { esc } from './client.mjs';
import { CATEGORIA } from './motor.mjs';

export const COLOR = { SVAm: '#e53935', SVAi: '#fb8c00', VIR: '#ab47bc', SVB: '#42a5f5', 'SVB-P': '#90caf9', HELI: '#66bb6a' };
const COLOR_COBERTURA = ['#ff5252', '#ffb300', '#00c853'];   // none, only one kind, both SVA and SVB in time

export async function carregaUnitats() {
  return (await fetch('/data/unitats.json').then(r => r.json())).filter(u => CATEGORIA[u.tipus]);
}

// Current state and position of a unit (the view only lists units that are not free at their base)
export function estatUnitat(vista, u) {
  const [estat = 'disponible', incident = null, fase = null, lat = u.base.lat, lon = u.base.lon, movent = false] = vista.unitats[u.indicatiu] || [];
  return { estat, incident, fase, lat, lon, movent };
}

export function nouMapa(id) {
  const mapa = L.map(id).setView([41.7, 1.8], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(mapa);
  return mapa;
}

export function pintaCobertura(capa, punts) {
  for (const [lat, lon, nivell] of punts || []) {
    L.circle([lat, lon], { radius: 1300, stroke: false, fillColor: COLOR_COBERTURA[nivell], fillOpacity: 0.28, interactive: false }).addTo(capa);
  }
}

export function pintaUnitats(capa, vista, unitats, { filtre = () => true, destacades = new Set(), onClick } = {}) {
  for (const u of unitats) {
    const e = estatUnitat(vista, u);
    if (!filtre(u, e)) continue;
    const lliure = e.estat === 'disponible';
    const marca = L.circleMarker([e.lat, e.lon], {
      radius: u.tipus === 'HELI' ? 10 : 7, color: destacades.has(u.indicatiu) ? '#fff' : e.movent ? '#ffeb3b' : '#0b1220',
      weight: destacades.has(u.indicatiu) || e.movent ? 3 : 1, dashArray: e.movent ? '3' : null,
      fillColor: COLOR[u.tipus], fillOpacity: lliure || destacades.has(u.indicatiu) ? 0.95 : 0.15,
    }).addTo(capa).bindTooltip(`<b>${esc(u.indicatiu)}</b> · ${u.tipus} · ${e.movent ? 'desplaçant-se' : e.estat}`
      + `${e.incident ? ` a l'incident ${vista.incidents.find(i => i.id === e.incident)?.numero ?? ''}` : ''}<br>${esc(u.base.nom)}`);
    if (onClick) marca.on('click', () => onClick(u, e));
  }
}

// Panel to move a free unit to another base of the shift's zones
export function panellMoviments(contenidor, vista, unitats, mou) {
  const ordre = { SVA: 0, SVB: 1 };
  const lliures = unitats.filter(u => vista.zones.includes(u.subzona || u.regio) && estatUnitat(vista, u).estat === 'disponible' && u.tipus !== 'HELI')
    .sort((a, b) => ordre[CATEGORIA[a.tipus]] - ordre[CATEGORIA[b.tipus]] || a.indicatiu.localeCompare(b.indicatiu));
  const pitjor = [...vista.cobertura].sort((a, b) => a.pct - b.pct)[0];
  const triadaU = contenidor.querySelector('#mou-unitat')?.value;
  const triadaB = contenidor.querySelector('#mou-base')?.value || vista.bases.find(b => b.zona === pitjor?.zona)?.nom;
  const zonaDe = u => u.subzona || u.regio;
  // Rebuild only when something changed, so an open drop-down is not closed every second
  const clau = JSON.stringify([lliures.map(u => u.indicatiu), vista.cobertura, vista.moviments?.length]);
  if (contenidor.dataset.clau === clau) return;
  contenidor.dataset.clau = clau;
  contenidor.innerHTML = `
    <div class="cobertura-zones">${vista.cobertura.map(c => `<div class="zona-cob ${c.descoberta ? 'descoberta' : ''}">
      <span>${esc(c.zona)}</span><span class="barra-cob"><span style="width:${c.pct}%"></span></span><b>${c.pct} %</b></div>`).join('')}</div>
    <div class="fila">
      <label>Unitat lliure <select id="mou-unitat">${lliures.map(u => `<option value="${esc(u.indicatiu)}" ${u.indicatiu === triadaU ? 'selected' : ''}>${esc(u.indicatiu)} ${u.tipus} · ${esc(u.base.nom)}${vista.zones.length > 1 ? ` (${esc(zonaDe(u))})` : ''}</option>`).join('')}</select></label>
      <label>Cap a <select id="mou-base"><option value="base">La seva base</option>${vista.bases.map(b => `<option value="${esc(b.nom)}" ${b.nom === triadaB ? 'selected' : ''}>${esc(b.nom)} (${esc(b.zona)})</option>`).join('')}</select></label>
    </div>
    <button class="boto" id="mou">Desplaçar per cobertura</button>
    <div class="suau moviments">${(vista.moviments || []).map(m => `<div>${m.hora} · ${esc(m.unitat)} → ${esc(m.desti)} (${m.minuts} min)</div>`).join('')}</div>`;
  contenidor.querySelector('#mou').onclick = () => mou(contenidor.querySelector('#mou-unitat').value, contenidor.querySelector('#mou-base').value);
}
