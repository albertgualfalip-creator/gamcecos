// Consultor training, projector screen: what the class sees, in the style of the shift game. The incoming call,
// the real units on the map, the code to join from the phones, live progress and, at the end, the results.
import { $, esc } from './client.mjs';
import { SECCIONS } from './motor.mjs';
import { COLOR, nouMapa } from './territori.mjs';

const codi = (new URLSearchParams(location.search).get('codi') || '').toUpperCase();
let mapa, capa, rondaMapa = null, clauMapa = '', qrFet = false;

setInterval(() => { $('rellotge').textContent = new Date().toLocaleTimeString('ca'); }, 1000);

async function bucle() {
  try {
    const r = await fetch(`/api/aula/tutor?codi=${codi}`, { cache: 'no-store' });
    if (r.ok) render(await r.json());
    else if (r.status === 404) $('trucada').innerHTML = '<h2>No existeix cap sessió amb aquest codi</h2>';
  } catch { /* try again */ }
  setTimeout(bucle, 1000);
}

function barres(files) {
  const total = Math.max(1, ...files.map(f => f.n));
  return `<div class="barres">${files.map(f => `<div class="barra-fila ${f.correcte ? 'correcte' : ''}">
    <span class="barra-text">${f.html ?? esc(f.text)}${f.correcte ? ' ✓' : ''}</span>
    <span class="barra"><span style="width:${(100 * f.n) / total}%" class="${f.classe || ''}"></span></span><b>${f.n}</b></div>`).join('')}</div>`;
}

function render(v) {
  const resultats = v.estat === 'resultats';
  $('estat').innerHTML = { preparada: '<span class="etiqueta v-acceptable">ESCOLTEU LA TRUCADA</span>', oberta: '<span class="etiqueta v-optima">RESPONEU AL MÒBIL</span>',
    resultats: '<span class="etiqueta v-suboptima">RESULTATS</span>' }[v.estat];
  $('codi').textContent = codi;
  if (!qrFet) {
    qrFet = true;
    $('url').textContent = `${location.host}/aula`;
    $('codi-gran').textContent = codi;
    if (window.QRCode) new QRCode($('qr'), { text: `${location.origin}/aula?codi=${codi}`, width: 220, height: 220 });
  }
  // The call, as the consultor sees it in the game
  $('trucada').innerHTML = `<div class="cap-trucada">${resultats ? '<span class="etiqueta v-suboptima">FINALITZADA</span>' : '<span class="en-linia">EN LÍNIA</span>'}
      <b class="num-gran">${v.numero}</b></div>
    <div class="suau titol-cas">${esc(v.config.titol)} · ${esc(v.config.lloc.municipi)}</div>
    ${v.config.carta ? `<div class="carta-text">${esc(v.config.carta)}</div>` : ''}
    ${resultats ? '' : '<div class="ona">' + Array.from({ length: 24 }, (_, i) => `<span style="animation-delay:${(i % 6) * 0.12}s"></span>`).join('') + '</div>'}
    ${resultats && v.config.nivell ? `<p class="nivell-final">Nivell correcte <span class="nivell n${v.config.nivell}">N${v.config.nivell}</span> · ${esc(v.correctesCombo)}</p>` : ''}`;
  pintaMapa(v);
  const p = v.progres, base = Math.max(1, p.connectats);
  const progres = `<div class="panell"><h3>Participació</h3><p class="xifra">${p.connectats} <span class="suau">connectats</span></p>
    ${barres([['XABCDE', p.xabcde], ['Nivell de triatge', p.nivell], ['Recursos (acabat)', p.recursos]].map(([text, n]) => ({ text: `${text} · ${Math.round((100 * n) / base)} %`, n })))}</div>`;
  const d = v.distribucio;
  $('lateral').innerHTML = !resultats ? progres : `
    <div class="panell"><h3>Nivell de triatge</h3>${barres([1, 2, 3, 4, 5].map(n => ({ html: `<span class="nivell n${n}">N${n}</span>`, n: d.nivell[n] || 0, correcte: v.config.nivell === n, classe: `n${n}` })))}</div>
    <div class="panell"><h3>Tipus de resposta</h3>${barres(Object.entries(d.combo).sort((a, b) => b[1] - a[1]).map(([text, n]) => ({ text, n, correcte: text === v.correctesCombo })))}</div>
    <div class="panell"><h3>Classificació</h3><ol class="ranquing">${v.classificacio.slice(0, 8).map(c => `<li><b>${esc(c.nom)}</b> · ${c.punts}/${c.maxim}</li>`).join('')}</ol></div>`;
  // XABCDE results: only what someone ticked or what was right, the right ones first
  $('resultats-xabcde').innerHTML = !resultats ? '' : v.config.xabcde.map(l => {
    const seccions = SECCIONS.map(sec => {
      const items = l.items.filter(it => it.seccio === sec.id && (it.correcte || d.xabcde[it.id]))
        .sort((a, b) => b.correcte - a.correcte || (d.xabcde[b.id] || 0) - (d.xabcde[a.id] || 0));
      return items.length ? `<div class="seccio-resultat seccio-${sec.id}"><b>${esc(sec.nom)}</b>${barres(items.map(it => ({ text: it.text, n: d.xabcde[it.id] || 0, correcte: it.correcte })))}</div>` : '';
    }).join('');
    return seccions ? `<div class="panell"><h3><span class="lletra-gran">${esc(l.lletra)}</span> ${esc(l.nom)}</h3>${seccions}</div>` : '';
  }).join('');
}

// Incident and the units the students can choose; on the results the right ones stand out
function pintaMapa(v) {
  const resultats = v.estat === 'resultats';
  const clau = JSON.stringify([v.ronda, resultats, v.correctes]);
  if (clau === clauMapa) return;
  clauMapa = clau;
  if (!mapa) { mapa = nouMapa('mapa'); capa = L.layerGroup().addTo(mapa); }
  capa.clearLayers();
  const { lloc } = v.config;
  L.circleMarker([lloc.lat, lloc.lon], { radius: 14, color: '#ff5252', weight: 4, fillOpacity: 0.5 }).addTo(capa)
    .bindTooltip(`${v.numero} · ${esc(lloc.municipi)}`, { permanent: true, direction: 'top' });
  // Units sharing a base are spread around it so that every one can be seen
  const perBase = {};
  for (const u of v.unitats) {
    const correcta = resultats && v.correctes.includes(u.indicatiu);
    const clauBase = `${u.lat},${u.lon}`, n = (perBase[clauBase] = (perBase[clauBase] ?? -1) + 1);
    const angle = n * 2.4, r = n ? 0.012 : 0;
    L.circleMarker([u.lat + r * Math.sin(angle), u.lon + r * 1.3 * Math.cos(angle)], { radius: correcta ? 11 : 7, color: correcta ? '#00e676' : u.ocupada ? '#555' : '#fff', weight: correcta ? 4 : 2,
      fillColor: u.ocupada ? '#777' : COLOR[u.tipus] || '#888', fillOpacity: 0.95 })
      .addTo(capa).bindTooltip(`${esc(u.indicatiu)} ${esc(u.tipus)} · ${u.ocupada ? 'ocupada' : `${u.eta} min`}`, { permanent: correcta, direction: 'right' });
  }
  if (rondaMapa !== v.ronda) {
    rondaMapa = v.ronda;
    mapa.fitBounds([[lloc.lat, lloc.lon], ...v.unitats.filter(u => u.tipus !== 'HELI').map(u => [u.lat, u.lon])], { padding: [40, 40], maxZoom: 13 });
  }
}

if (codi) bucle(); else $('trucada').innerHTML = '<h2>Obriu aquesta pantalla des de la pàgina del tutor</h2>';
