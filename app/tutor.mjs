// Tutor panel: configures the shift, drives it (incidents, complications, register messages) and sees the hidden truth.
import { $, esc, connecta, accio as envia, resultatsHtml, registreHtml, missatgesHtml, ROLS } from './client.mjs';

let codi, tematiques = [], casos = [];
const oberts = new Set();   // incidents the tutor has expanded
const ordre = o => envia(codi, 'tutor', o);

async function carrega() {
  const get = f => fetch(f).then(r => (r.ok ? r.json() : Promise.reject(r.status)));
  const [cecos, tem, c, codis] = await Promise.all([get('/data/cecos.json'), get('/data/tematiques.json'), get('/api/casos'), get('/data/codis3.json')]);
  $('msg-predefinit').innerHTML += codis.missatges_tutor.map(m => `<option value="${esc(m.text)}">${esc(m.codi)} · ${esc(codis.codis[m.codi] || '')}</option>`).join('');
  $('msg-predefinit').onchange = e => {
    if (!e.target.value) return;
    $('msg-codi').value = 'R';
    const inc = vistaActual?.incidents.find(i => String(i.id) === $('msg-incident').value);
    const unitat = inc?.unitats[0]?.indicatiu;
    $('msg-text').value = `${unitat ? unitat + ' ' : ''}${e.target.value}`;
  };
  tematiques = tem;
  casos = c.casos.filter(x => x.actiu !== false);
  $('cecos').innerHTML = cecos.cecos.map(x => `<label class="casella"><input type="checkbox" name="cecos" value="${x.id}" data-zones="${esc(JSON.stringify(x.zones))}">${esc(x.nom)}</label>`).join('');
  $('tematiques').innerHTML = tematiques.map(t => {
    const n = casos.filter(x => x.tematiques?.includes(t.id)).length;
    return `<label class="casella" title="${esc(t.descripcio)}"><input type="checkbox" name="tematica" value="${t.id}">${esc(t.nom)} <span class="suau">(${n} casos)</span></label>`;
  }).join('');
  $('tematica-ara').innerHTML += tematiques.map(t => `<option value="${t.id}">${esc(t.nom)}</option>`).join('');
  $('cas-ara').innerHTML += casos.map(x => `<option value="${x.id}">${esc(x.titol)}</option>`).join('');
}

$('config').onsubmit = e => {
  e.preventDefault();
  creaGuardia().catch(err => { $('error').textContent = `No s'ha pogut crear la guàrdia: ${err.message || err}`; });
};

async function creaGuardia() {
  const f = $('config');
  const triades = [...f.querySelectorAll('[name=cecos]:checked')];
  if (!triades.length) { $('error').textContent = 'Trieu almenys una CECOS.'; return; }
  const config = {
    cecos: triades.map(c => c.value), nomCecos: triades.map(c => c.parentElement.textContent.trim()).join(' · '),
    zones: triades.flatMap(c => JSON.parse(c.dataset.zones)),
    tematiques: [...f.querySelectorAll('[name=tematica]:checked')].map(t => t.value),
    hora: f.hora.value, incidents: Number(f.incidents.value), ritme: Number(f.ritme.value) * 60,
    ocupacio: Number(f.ocupacio.value), factor: Number(f.factor.value), feedback: f.feedback.value, briefing: f.briefing.value.trim(),
    rols: [...f.querySelectorAll('[name=rol]:checked')].map(r => r.value),
  };
  const r = await fetch('/api/sala', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) });
  if (!r.ok) throw new Error(r.status === 401 ? 'cal la contrasenya' : `error ${r.status}`);
  ({ sala: codi } = await r.json());
  f.hidden = true;
  $('panell').hidden = false;
  $('codi').textContent = codi;
  $('enllac-uct').href = `/uct?sala=${codi}`;
  $('enllac-consultor').href = `/consultor?sala=${codi}`;
  $('enllac-cap').href = `/cap?sala=${codi}`;
  $('enllac-cap').hidden = !config.rols.includes('cap');
  $('zona-descobreix').innerHTML = config.zones.map(z => `<option>${esc(z)}</option>`).join('');
  $('url-vot').innerHTML = `${esc(location.host)}/vota<br>codi <b>${codi}</b>`;
  if (window.QRCode) new QRCode($('qr'), { text: `${location.origin}/vota?sala=${codi}`, width: 128, height: 128 });
  const fonts = connecta(codi, 'tutor', { vista: render });
  fonts.addEventListener('classificacio', e => {
    $('classificacio').innerHTML = JSON.parse(e.data).map(x => `<li>${esc(x.nom)} · ${x.punts}</li>`).join('') || '<li class="suau">Sense vots</li>';
  });
}

document.querySelectorAll('[data-ordre]').forEach(b => b.onclick = () => ordre({ tipus: b.dataset.ordre }));
$('descobreix').onclick = () => ordre({ tipus: 'descobreix', zona: $('zona-descobreix').value });
$('llanca').onclick = () => ordre({ tipus: 'incident', tematica: $('tematica-ara').value || null, cas: $('cas-ara').value || null });
$('envia-msg').onclick = () => {
  const text = $('msg-text').value.trim();
  if (!text) return;
  ordre({ tipus: 'missatge', incident: $('msg-incident').value, codi: $('msg-codi').value, text });
  $('msg-text').value = '';
};

let vistaActual = null;
function render(v) {
  vistaActual = v;
  const estat = { preparada: 'preparada', enmarxa: '', pausa: ' · pausa', finalitzada: ' · finalitzada' }[v.estat];
  $('rellotge').textContent = v.rellotge + estat;
  $('punts').textContent = `Equip ${v.punts.punts}/${v.punts.maxim} · ` + v.rols.map(r => `${ROLS[r]} ${v.puntsRol[r].punts}/${v.puntsRol[r].maxim}`).join(' · ');
  const triat = $('msg-incident').value;
  $('msg-incident').innerHTML = v.incidents.filter(i => i.estat !== 'tancat')
    .map(i => `<option value="${i.id}" ${String(i.id) === triat ? 'selected' : ''}>${i.numero} · ${esc(i.municipi)}</option>`).join('');
  $('trucades').innerHTML = v.trucades.map(t => `<div>${t.estat === 'activa' ? '<b>En curs</b>' : 'Sonant'} · ${t.tipus} · incident ${v.incidents.find(i => i.id === t.incident)?.numero} · ${t.espera} s</div>`).join('')
    || '<p class="suau">Cap.</p>';
  $('missatges').innerHTML = missatgesHtml(v.missatges, 'tutor');
  $('cobertura').innerHTML = v.cobertura.map(c => `<div class="zona-cob ${c.descoberta ? 'descoberta' : ''}"><span>${esc(c.zona)}</span>
    <span class="barra-cob"><span style="width:${c.pct}%"></span></span><b>${c.pct} %</b><span class="suau">SVA ${c.sva[0]}/${c.sva[1]} · SVB ${c.svb[0]}/${c.svb[1]}</span></div>`).join('');
  $('moviments').innerHTML = v.moviments.map(m => `<div>${m.hora} · ${ROLS[m.rol]}: ${esc(m.unitat)} → ${esc(m.desti)}</div>`).join('') || 'Cap moviment de cobertura.';
  $('incidents').innerHTML = [...v.incidents].reverse().map(i => {
    const nomsTem = (i.tematiques || []).map(t => tematiques.find(x => x.id === t)?.nom).filter(Boolean).join(', ');
    const pendents = [...i.pendentsUct.map(p => `UCT: ${p}`), ...i.pendentsConsultor.map(p => `Consultor: ${p}`)].join(' · ');
    return `<details class="tutor-incident" data-id="${i.id}" ${i.estat === 'obert' || oberts.has(i.id) ? 'open' : ''}><summary><span class="num">${i.numero}</span> <b>${esc(i.titol)}</b> · ${esc(i.municipi)}
        ${i.desenllac ? `<span class="etiqueta v-${i.desenllac === 'bo' ? 'optima' : 'perillosa'}">${i.desenllac === 'bo' ? 'bo' : 'dolent'}</span>` : ''}</summary>
      <div class="suau">Realitat: ${esc(i.variant)} · <b>N${i.nivellReal}</b> (equip: ${i.nivell ? 'N' + i.nivell : '—'}) · ${esc(nomsTem)}</div>
      <div class="suau">Unitats: ${i.unitats.map(u => `${u.indicatiu} (${u.fase === 'ruta' ? u.falta + ' min' : 'al lloc'})`).join(', ') || (i.senseRecurs != null ? `cap · ${i.senseRecurs} s sense recurs` : 'cap')}</div>
      ${pendents ? `<div class="suau">Pendent: ${esc(pendents)}</div>` : ''}
      ${i.resultats.length ? resultatsHtml(i.resultats) : ''}</details>`;
  }).join('') || '<p class="suau">Encara no ha entrat cap incident.</p>';
  $('incidents').querySelectorAll('details').forEach(d => d.ontoggle = () => (d.open ? oberts.add(Number(d.dataset.id)) : oberts.delete(Number(d.dataset.id))));
  if (v.cronologia) {
    $('cronologia-panell').hidden = false;
    for (const g of v.resultatsGlobals) $('cobertura').insertAdjacentHTML('beforeend', `<p><span class="etiqueta v-${g.valoracio}">${esc(g.pas)}</span> ${esc(g.feedback)}</p>`);
    $('cronologia').innerHTML = registreHtml(v.cronologia.map(r => ({ ...r, text: `[${r.numero ?? ''}] ${r.text}` })));
  }
}

carrega().catch(() => { $('error').textContent = 'Cal entrar amb la contrasenya (torneu a la pàgina inicial).'; });
