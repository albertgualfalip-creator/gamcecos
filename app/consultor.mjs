// Consultor screen: call queue, live call as a conversation, findings sheet, clinical decisions and room communication.
import { $, esc, so, connecta, accio as envia, entrada, resultatsHtml, desenllacHtml, missatgesHtml, briefingHtml } from './client.mjs';

const QUI = { alertant: 'Alertant', consultor: 'Vós', unitat: 'Unitat' };
let codi, vista, sonant = new Set(), resumTancat = false, claveTrucada = '';
const accio = a => envia(codi, 'consultor', a);

entrada($('entrada'), c => {
  codi = c;
  $('joc').hidden = false;
  connecta(codi, 'consultor', { vista: rep });
});

document.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => accio({ tipus: 'avisa', text: b.dataset.msg, incident: vista?.activa?.incident.id }));
$('form-msg').onsubmit = e => {
  e.preventDefault();
  accio({ tipus: 'avisa', text: e.target.text.value, incident: vista?.activa?.incident.id });
  e.target.text.value = '';
};

function rep(v) {
  const ara = new Set(v.cua.map(t => t.id));
  if ([...ara].some(id => !sonant.has(id))) so('trucada');
  sonant = ara;
  vista = v;
  $('rellotge').textContent = v.rellotge;
  $('estat').innerHTML = { pausa: '<span class="etiqueta v-perillosa">PAUSA</span>', finalitzada: '<span class="etiqueta v-acceptable">FINALITZADA</span>' }[v.estat] || '';
  $('resum-cua').innerHTML = v.cua.length ? `<span class="parpelleja">${v.cua.length} trucades esperant</span>` : '<span class="suau">Cap trucada en espera</span>';
  renderCua();
  renderTrucada();
  renderFitxa();
  $('meus').innerHTML = v.incidents.filter(i => i.nivell || i.estat === 'tancat').reverse().map(i => `<details class="meu-inc"><summary>
      <span class="nivell n${i.nivell || 0}">${i.nivell ? 'N' + i.nivell : '—'}</span> ${i.numero} · ${esc(i.municipi)}
      ${i.desenllac ? `<span class="etiqueta v-${i.desenllac === 'bo' ? 'optima' : 'perillosa'}">${i.desenllac === 'bo' ? 'bo' : 'dolent'}</span>` : ''}</summary>
      ${i.resultats.length ? resultatsHtml(i.resultats) : '<p class="suau">Les valoracions es veuen quan es tanca l\'incident.</p>'}</details>`).join('')
    || '<p class="suau">Encara cap.</p>';
  $('missatges').innerHTML = missatgesHtml(v.missatges, 'consultor');
  $('capa').innerHTML = briefingHtml(v) || (v.estat === 'finalitzada' && !resumTancat ? resum(v) : '');
  $('tanca-resum')?.addEventListener('click', () => { resumTancat = true; $('capa').innerHTML = ''; });
}

function renderCua() {
  const tipus = { consulta: 'Consulta', reiteracio: 'Reiteració', unitat: 'Unitat al lloc' };
  $('cua').innerHTML = vista.cua.map(t => `<div class="trucada-cua ${t.tipus}">
      <div><b>${tipus[t.tipus]}</b> · ${t.numero} · ${esc(t.municipi)}</div>
      <div class="suau">${esc(t.resum)}</div>
      <div class="espera"><span style="width:${Math.min(100, (t.espera / t.limit) * 100)}%"></span></div>
      <div class="fila-cua"><span class="${t.espera > 60 ? 'parpelleja' : 'suau'}">${t.espera} s esperant</span>
      <button class="boto" data-despenja="${t.id}" ${vista.activa ? 'disabled' : ''}>Despenjar</button></div></div>`).join('')
    || '<p class="suau">Cap trucada.</p>';
  $('cua').querySelectorAll('[data-despenja]').forEach(b => b.onclick = () => accio({ tipus: 'despenja', trucada: b.dataset.despenja }));
}

function renderTrucada() {
  const a = vista.activa;
  if (!a) {
    claveTrucada = '';
    $('trucada').innerHTML = `<div class="sense-trucada"><h2>Sense trucada en curs</h2><p class="suau">Despengeu la següent trucada de la cua.</p></div>`;
    return;
  }
  const inc = a.incident;
  // Only rebuild when something changed, so the conversation does not jump while reading
  const clau = JSON.stringify([a.id, a.transcript.length, a.preguntes.map(p => p.feta), inc.pendents.map(d => d.pas)]);
  if (clau === claveTrucada) return;
  claveTrucada = clau;
  const bombolles = a.transcript.map(m => `<div class="bombolla ${m.qui}"><span class="qui">${QUI[m.qui]}</span>${esc(m.text)}</div>`).join('');
  const preguntes = a.preguntes.filter(p => !p.feta).map(p => `<button class="pregunta" data-pregunta="${p.id}">${esc(p.text)}</button>`).join('');
  const decisions = inc.pendents.map(d => `<div class="decisio"><h3>${esc(d.titol)}</h3>${d.pas === 'trasllat' ? '' : `<p>${esc(d.pregunta)}</p>`}
      <div class="${d.pas === 'nivell' ? 'nivells' : 'opcions'}">${d.opcions.map(o => `<button class="opcio ${d.pas === 'nivell' ? 'n' + o.id : ''}" data-pas="${d.pas}" data-opcio="${o.id}">${esc(o.text)}</button>`).join('')}</div></div>`).join('');
  const reiteracio = a.reiteracio ? `<div class="decisio"><h3>Resposta a la reiteració</h3><div class="opcions">${a.reiteracio.map(o => `<button class="opcio" data-reiteracio="${o.id}">${esc(o.text)}</button>`).join('')}</div></div>` : '';
  $('trucada').innerHTML = `
    <div class="cap-trucada"><span class="en-linia">EN LÍNIA</span> <b>${inc.numero}</b> · ${esc(inc.municipi)} · ${esc(inc.alertant)} · ${esc(inc.sexe)} ${inc.edat} anys</div>
    <p class="carta-text">${esc(inc.carta)}</p>
    <div class="conversa" id="conversa">${bombolles}</div>
    ${preguntes ? `<h3>Preguntar</h3><div class="preguntes">${preguntes}</div>` : ''}
    ${decisions}${reiteracio}
    ${a.reiteracio ? '' : '<div class="accions"><button class="boto secundari" id="penja">Penjar</button></div>'}`;
  $('conversa').scrollTop = $('conversa').scrollHeight;
  $('trucada').querySelectorAll('[data-pregunta]').forEach(b => b.onclick = () => accio({ tipus: 'pregunta', pregunta: b.dataset.pregunta }));
  $('trucada').querySelectorAll('[data-pas]').forEach(b => b.onclick = () => accio({ tipus: 'decideix', incident: inc.id, pas: b.dataset.pas, opcio: b.dataset.opcio }));
  $('trucada').querySelectorAll('[data-reiteracio]').forEach(b => b.onclick = () => accio({ tipus: 'reiteracio', opcio: b.dataset.reiteracio }));
  $('penja')?.addEventListener('click', () => accio({ tipus: 'penja' }));
}

function renderFitxa() {
  const f = vista.activa?.fitxa || [];
  $('fitxa').innerHTML = f.length
    ? f.map(x => `<span class="xip ${x.alarma ? 'alarma' : ''}">${x.alarma ? '⚠ ' : ''}${esc(x.text)}</span>`).join('')
    : '<p class="suau">Les respostes clau apareixeran aquí a mesura que pregunteu.</p>';
}

function resum(v) {
  const meus = v.incidents.filter(i => i.estat === 'tancat');
  return `<div class="capa"><div class="panell briefing"><h2>Fi de la guàrdia</h2>
    <p class="gran">Consultor: ${v.puntsRol.consultor.punts} / ${v.puntsRol.consultor.maxim}</p>
    <p>Equip: ${v.punts.punts} / ${v.punts.maxim} · ${meus.filter(i => i.desenllac === 'bo').length} de ${meus.length} desenllaços favorables</p>
    <button class="boto" id="tanca-resum">Tancar</button></div></div>`;
}
