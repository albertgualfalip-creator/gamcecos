// Shared code for the operational screens (UCT, consultor, tutor): joining a shift, live view, actions and sounds.
export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let audio = null;
export const desbloquejaAudio = () => { audio ??= new AudioContext(); };

// Short synthetic sounds: phone ring, radio blip and alert
export function so(tipus) {
  if (!audio) return;
  const notes = { trucada: [[880, 0], [660, .18], [880, .5], [660, .68]], radio: [[1200, 0], [900, .08]], alerta: [[520, 0], [520, .25]] }[tipus];
  const t = audio.currentTime;
  for (const [f, d] of notes) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = tipus === 'radio' ? 'square' : 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(tipus === 'radio' ? 0.05 : 0.2, t + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.15);
    o.connect(g).connect(audio.destination);
    o.start(t + d);
    o.stop(t + d + 0.17);
  }
}

export function connecta(codi, rol, { vista, pas, vots }) {
  const fonts = new EventSource(`/api/events?sala=${codi}&rol=${rol}`);
  // A lost live connection must be visible: otherwise the screen just stops changing
  let senseVista = setTimeout(() => avis(`No arriben dades de la guàrdia ${codi}. Comproveu el codi o torneu a carregar la pàgina.`), 8000);
  fonts.onerror = () => avis('Connexió perduda amb el servidor: reintentant...');
  fonts.addEventListener('vista', e => {
    clearTimeout(senseVista);
    senseVista = setTimeout(() => avis('Fa estona que no arriben dades del servidor. Torneu a carregar la pàgina.'), 15000);
    vista(JSON.parse(e.data));
  });
  if (pas) fonts.addEventListener('pas', e => pas(JSON.parse(e.data)));
  if (vots) fonts.addEventListener('vots', e => vots(JSON.parse(e.data)));
  return fonts;
}

export function accio(codi, rol, a) {
  return fetch(`/api/accio?sala=${codi}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rol, accio: a }) })
    .then(r => r.json()).then(r => { if (r.error) avis(r.error); return r; });
}

export function avis(text) {
  let el = document.getElementById('avis');
  if (!el) { el = document.createElement('div'); el.id = 'avis'; el.className = 'avis'; document.body.append(el); }
  el.textContent = text;
  el.classList.add('visible');
  clearTimeout(el.temps);
  el.temps = setTimeout(() => el.classList.remove('visible'), 3500);
}

// Entry form: asks the shift code (prefilled from ?sala=) and returns it once the shift exists
export function entrada(formulari, onEntra) {
  const parametre = new URLSearchParams(location.search).get('sala');
  if (parametre) formulari.sala.value = parametre.toUpperCase();
  formulari.onsubmit = async e => {
    e.preventDefault();
    desbloquejaAudio();
    const codi = formulari.sala.value.trim().toUpperCase();
    const r = await fetch(`/api/config?sala=${codi}`);
    if (!r.ok) { formulari.querySelector('.error').textContent = r.status === 404 ? 'No existeix cap guàrdia amb aquest codi.' : 'Cal entrar amb la contrasenya.'; return; }
    history.replaceState(null, '', `?sala=${codi}`);
    formulari.hidden = true;
    onEntra(codi, (await r.json()).config);
  };
}

export const ETIQUETA = { optima: 'Òptima', acceptable: 'Acceptable', suboptima: 'Subòptima', perillosa: 'Perillosa' };
export const ROLS = { consultor: 'Consultor', uct: 'UCT', cap: 'Cap de torn' };

export function resultatsHtml(resultats) {
  return `<table class="mini">${resultats.map(r => `<tr><td>${esc(r.pas)}<br><span class="suau">${ROLS[r.rol] || ''}</span></td><td>${esc(r.equip)}</td>
    <td>${r.valoracio ? `<span class="etiqueta v-${r.valoracio}">${ETIQUETA[r.valoracio]}</span><br><span class="suau">${esc(r.feedback)}</span>` : ''}</td></tr>`).join('')}</table>`;
}

export function desenllacHtml(d) {
  if (!d) return '';
  return `<div class="desenllac ${d.tipus}"><b>${d.tipus === 'bo' ? 'Desenllaç favorable' : 'Desenllaç desfavorable'}.</b> ${esc(d.text)}</div>
    <p class="suau">Què passava: ${esc(d.realitat)} · nivell real N${d.nivell}</p>
    <ul class="aprenentatge">${(d.aprenentatge || []).map(a => `<li>${esc(a)}</li>`).join('')}</ul>`;
}

export function coberturaHtml(cob) {
  return (cob || []).map(c => {
    const nivell = c.sva[1] ? c.sva[0] / c.sva[1] : 1;
    return `<span class="cob ${nivell < 0.34 ? 'baixa' : nivell < 0.67 ? 'mitja' : ''}" title="Unitats lliures / en servei">${esc(c.zona)} · SVA ${c.sva[0]}/${c.sva[1]} · SVB ${c.svb[0]}/${c.svb[1]}</span>`;
  }).join('');
}

export function missatgesHtml(missatges, rol) {
  return (missatges || []).map(m => `<div class="msg ${m.de === rol ? 'meu' : ''}"><span class="suau">${m.hora} · ${ROLS[m.de]}${m.numero ? ` · ${m.numero}` : ''}</span><br>${esc(m.text)}</div>`).join('')
    || '<p class="suau">Encara no hi ha missatges.</p>';
}

export function registreHtml(registre) {
  return (registre || []).map(r => `<div class="entrada font-${r.font || ''}"><div class="meta">${esc([r.hora, r.codi, r.usuari].filter(Boolean).join(' | '))}</div><div class="text">${esc(r.text)}</div></div>`).join('');
}

export function briefingHtml(vista) {
  if (vista.estat === 'preparada') {
    return `<div class="capa"><div class="panell briefing"><h2>Relleu de torn</h2>${(vista.briefing || []).map(l => `<p>${esc(l)}</p>`).join('')}
      <p class="suau">Esperant que el tutor iniciï la guàrdia...</p></div></div>`;
  }
  return '';
}
