// Consultor training, projector screen: what the class sees, made to look like the coordination centre software.
// Incident tray, incident record, 112 information, resources table, map and status bar; at the end, the results.
// Card-only cases can have a background of the coordination room (radios, phones, voices) from a button.
import { $, esc } from './client.mjs';
import { barres, panellsResultats, classificacio } from './aula-resultats.mjs';
import { COLOR, nouMapa } from './territori.mjs';
import { engega, atura, sona } from './ambient.mjs';

const codi = (new URLSearchParams(location.search).get('codi') || '').toUpperCase();
const NOM_CAT = { SVA: 'SVA', SVB: 'SVB', HEMS: 'HELI' };
const ESTAT = { preparada: ['PENDENT', 'pendent'], oberta: ['EN VALORACIÓ', 'valoracio'], resultats: ['TANCAT', 'tancat'] };
let mapa, capa, rondaMapa = null, clauMapa = '', qrFet = false, ronda = null, horaAlerta = '', vista = null, ambientVolgut = false;
const hora = (d = new Date()) => d.toLocaleTimeString('ca', { hour12: false });
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

setInterval(() => { $('rellotge').textContent = hora(); }, 1000);

async function bucle() {
  try {
    const r = await fetch(`/api/aula/tutor?codi=${codi}`, { cache: 'no-store' });
    if (r.ok) render(await r.json());
    else if (r.status === 404) $('fitxa').innerHTML = '<p>No existeix cap sessió amb aquest codi.</p>';
  } catch { /* try again */ }
  setTimeout(bucle, 1000);
}

// Background of the room only in card-only cases, while the class is answering
function ambient() {
  const toca = ambientVolgut && vista?.config.tipus === 'carta' && vista.estat !== 'resultats';
  if (toca && !sona()) engega();
  if (!toca && sona()) atura();
  $('ambient').textContent = ambientVolgut ? '🔊 So de sala' : '🔇 So de sala';
  $('ambient').classList.toggle('actiu', ambientVolgut);
}
$('ambient').onclick = () => { ambientVolgut = !ambientVolgut; ambient(); };

function render(v) {
  vista = v;
  const resultats = v.estat === 'resultats', { config: c } = v;
  if (v.ronda !== ronda) { ronda = v.ronda; horaAlerta = hora(); }
  $('codi').textContent = codi;
  if (!qrFet) {
    qrFet = true;
    $('url').textContent = `${location.host}/aula`;
    $('codi-gran').textContent = codi;
    if (window.QRCode) new QRCode($('qr'), { text: `${location.origin}/aula?codi=${codi}`, width: 160, height: 160 });
  }
  const [estat, classe] = ESTAT[v.estat];
  $('estat-incident').innerHTML = `<span class="cecos-estat-inc ${classe}">${estat}</span>`;
  // Tray: the current incident and the ones already played in the session
  $('safata').innerHTML = `<tr><th>Núm.</th><th>Hora</th><th>Municipi</th><th>Pr.</th></tr>
    <tr class="actual ${v.estat === 'oberta' ? 'parpelleig-suau' : ''}"><td>${v.numero}</td><td>${horaAlerta.slice(0, 5)}</td><td>${esc(c.lloc.municipi)}</td>
      <td>${resultats && c.nivell ? `<span class="nivell n${c.nivell}">N${c.nivell}</span>` : '—'}</td></tr>
    ${v.historia.map(h => `<tr class="passat"><td>${h.numero}</td><td></td><td>${esc(h.municipi)}</td><td>${h.nivell ? `<span class="nivell n${h.nivell}">N${h.nivell}</span>` : ''}</td></tr>`).join('')}`;
  const camp = (etiqueta, valor, ample = '') => `<div class="cecos-camp ${ample}"><label>${etiqueta}</label><div>${valor}</div></div>`;
  $('fitxa').innerHTML = [
    camp('Núm. incident', `<b class="cecos-num">${v.numero}</b>`), camp('Hora alerta', horaAlerta),
    camp('Entrada', c.tipus === 'carta' ? 'Dades 112 (sense veu)' : 'Trucada sanitària (VPS)'),
    camp('Temps', v.segons != null && !resultats ? mmss(v.segons) : '—'),
    camp('Municipi', esc(c.lloc.municipi)), camp('Zona', esc(c.lloc.zona || '')), camp('Entorn', esc({ urba: 'Urbà', suburba: 'Suburbà', rural: 'Rural' }[c.lloc.entorn] || '')),
    camp('Prioritat', resultats && c.nivell && c.fases.nivell ? `<span class="nivell n${c.nivell}">N${c.nivell}</span>` : '—'),
    camp('Tipus', esc(c.titol), 'ample'),
  ].join('');
  // 112 information as the card arrives, and the call while it is on
  $('titol-112').innerHTML = c.tipus === 'carta' ? 'Informació 112 · SITREM' : `Informació 112 · <span class="en-linia">${resultats ? 'FINALITZADA' : 'TRUCADA EN CURS'}</span>`;
  $('info112').innerHTML = `${c.carta ? `<div class="cecos-linia"><span class="suau">${horaAlerta} · T · SITREM</span><br>${esc(c.carta)}</div>` : '<p class="suau">Sense carta.</p>'}
    ${c.tipus !== 'carta' && !resultats ? '<div class="ona">' + Array.from({ length: 32 }, (_, i) => `<span style="animation-delay:${(i % 8) * 0.1}s"></span>`).join('') + '</div>' : ''}
    ${resultats ? `<div class="cecos-linia proposta"><span class="suau">PROPOSTA</span><br>${c.nivell && c.fases.nivell ? `Nivell N${c.nivell} · ` : ''}${esc(v.correcte.text)}</div>` : ''}`;
  // Resources table: kind, base, state and arrival time; the right ones stand out on the results
  $('recursos').innerHTML = `<tr><th>Indicatiu</th><th>Tipus</th><th>Base</th><th>Estat</th><th>ETA</th></tr>
    ${v.unitats.map(u => {
      const bona = resultats && v.correctes.includes(u.indicatiu);
      return `<tr class="${u.ocupada ? 'ocupada' : ''} ${bona ? 'bona' : ''}"><td><span class="punt" style="background:${COLOR[u.tipus] || '#888'}"></span><b>${esc(u.indicatiu)}</b></td>
        <td><span class="cat-unitat cat-${u.cat}">${NOM_CAT[u.cat]}</span> ${esc(u.tipus)}</td><td>${esc(u.base)}</td>
        <td>${bona ? '<span class="cecos-estat-u proposta">PROPOSTA ✓</span>' : u.ocupada ? '<span class="cecos-estat-u ocupat">OCUPAT</span>' : '<span class="cecos-estat-u lliure">DISPONIBLE</span>'}</td>
        <td>${u.ocupada ? '—' : `${u.eta}'`}</td></tr>`;
    }).join('')}`;
  const p = v.progres, base = Math.max(1, p.connectats), f = c.fases;
  const etapes = [f.activacio && ['🚑 Recurs activat', p.activats], ['escolta', 'preguntes', 'instruccio'].some(x => f[x]) && ['Valoració', p.xabcde],
    f.nivell && ['Nivell de triatge', p.nivell], ['Han acabat', p.acabats]].filter(Boolean);
  $('lateral').innerHTML = resultats ? classificacio(v, false)
    : `<div class="cecos-titol">Participació · ${p.connectats} connectats</div>${barres(etapes.map(([text, n]) => ({ text: `${text} · ${Math.round((100 * n) / base)} %`, n })))}`;
  $('peu').innerHTML = `<span>● CONNECTAT</span><span>Sessió ${codi}</span><span>Incident ${v.numero}</span><span>${p.connectats} operadors connectats</span>
    <span>${p.acabats} respostes</span><span>${v.segons != null ? `Temps ${mmss(v.segons)}` : 'Esperant'}</span>`;
  // On the results the map gives way to the class answers
  $('panell-mapa').hidden = resultats;
  $('resultats').hidden = !resultats;
  $('resultats').innerHTML = resultats ? panellsResultats(v, true) : '';
  if (!resultats) pintaMapa(v);
  ambient();
}

// Incident and the units the students can choose
function pintaMapa(v) {
  const clau = JSON.stringify([v.ronda, v.unitats.length]);
  if (clau === clauMapa) return;
  clauMapa = clau;
  if (!mapa) { mapa = nouMapa('mapa'); capa = L.layerGroup().addTo(mapa); }
  setTimeout(() => mapa.invalidateSize(), 50);
  capa.clearLayers();
  const { lloc } = v.config;
  L.circleMarker([lloc.lat, lloc.lon], { radius: 14, color: '#ff5252', weight: 4, fillOpacity: 0.5 }).addTo(capa)
    .bindTooltip(`${v.numero} · ${esc(lloc.municipi)}`, { permanent: true, direction: 'top' });
  // Units sharing a base are spread around it so that every one can be seen
  const perBase = {};
  for (const u of v.unitats) {
    const clauBase = `${u.lat},${u.lon}`, n = (perBase[clauBase] = (perBase[clauBase] ?? -1) + 1);
    const angle = n * 2.4, r = n ? 0.012 : 0;
    L.circleMarker([u.lat + r * Math.sin(angle), u.lon + r * 1.3 * Math.cos(angle)], { radius: 7, color: u.ocupada ? '#555' : '#fff', weight: 2,
      fillColor: u.ocupada ? '#777' : COLOR[u.tipus] || '#888', fillOpacity: 0.95 })
      .addTo(capa).bindTooltip(`${esc(u.indicatiu)} ${esc(u.tipus)} · ${u.ocupada ? 'ocupada' : `${u.eta} min`}`, { direction: 'right' });
  }
  if (rondaMapa !== v.ronda) {
    rondaMapa = v.ronda;
    mapa.fitBounds([[lloc.lat, lloc.lon], ...v.unitats.filter(u => u.tipus !== 'HELI').map(u => [u.lat, u.lon])], { padding: [30, 30], maxZoom: 13 });
  }
}

if (codi) bucle(); else $('fitxa').innerHTML = '<p>Obriu aquesta pantalla des de la pàgina del tutor.</p>';
