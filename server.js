// GamCECOS server: serves the game and runs each shift (joc.mjs). Every screen (tutor, UCT, consultor, audience)
// receives its own view of the shift through Server-Sent Events and sends its actions to /api/accio.
//
// Environment:
//   PORT            port to listen on (default 8080)
//   HOST            interface to listen on (default all; 127.0.0.1 behind a reverse proxy)
//   GAMCECOS_CLAU   optional password for the tutor, UCT and consultor screens; the audience only needs the room code
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || undefined;
const CLAU = process.env.GAMCECOS_CLAU || '';
const ROOT = __dirname;
const DIR_CASOS_LOCALS = path.join(ROOT, 'casos-locals');   // cases edited from the editor; not tracked by git
const DIR_AULA = path.join(ROOT, 'aula-casos');               // prepared training cases and their recordings; not tracked by git
const MAX_AUDIO = 40 * 1024 * 1024;
const TIPUS_AUDIO = { 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/ogg': '.ogg',
  'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/flac': '.flac' };
const PUBLIC_DIRS = ['app', 'data'];
const OBERT_SENSE_CLAU = new Set(['/app/index.html', '/app/vota.html', '/app/vota.mjs', '/app/client.mjs', '/app/estil.css', '/api/events', '/api/estat', '/api/vot', '/api/punts',
  '/app/aula.html', '/app/aula.mjs', '/app/aula-demo.mjs', '/api/aula/estat', '/api/aula/resposta']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const CADUCITAT_SALA_MS = 12 * 3600 * 1000;
const SEGONS_RESULTAT_VOT = 6;
const PUNTS = { optima: 3, acceptable: 2, suboptima: 1, perillosa: 0 };
const ROLS = ['public', 'uct', 'consultor', 'cap', 'tutor'];

let Guardia, Aula, unitatsProperes, dades;
const llegeix = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

function carregaCasos() {
  const ids = llegeix('casos/index.json');
  const locals = fs.existsSync(DIR_CASOS_LOCALS) ? fs.readdirSync(DIR_CASOS_LOCALS).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : [];
  return [...new Set([...ids, ...locals])].map(id => {
    const local = path.join(DIR_CASOS_LOCALS, `${id}.json`);
    // origen: "original" (from the repository), "editat" (local version of an original) or "nou" (only local)
    if (!fs.existsSync(local)) return { ...llegeix(`casos/${id}.json`), origen: 'original' };
    return { ...JSON.parse(fs.readFileSync(local, 'utf8')), origen: ids.includes(id) ? 'editat' : 'nou' };
  });
}

// Room code -> {joc, pas, pasTancat, vots, noms, punts, clients: Map(response -> rol), activa}
const sales = new Map();
// Consultor training sessions (aula.mjs): code -> {aula, activa}
const aules = new Map();

function nouCodi(ocupats) {
  let codi;
  do codi = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]).join('');
  while (ocupats.has(codi));
  return codi;
}

function novaSala(config) {
  const codi = nouCodi(sales);
  sales.set(codi, { joc: new Guardia(config, dades), pas: null, pasTancat: 0, vots: new Map(), noms: new Map(), punts: new Map(), clients: new Map(), activa: Date.now() });
  return codi;
}

function recompte(sala) {
  const r = {};
  for (const o of sala.pas?.opcions || []) r[o.id] = 0;
  for (const tria of sala.vots.values()) for (const id of tria) if (id in r) r[id]++;
  return { recompte: r, votants: sala.vots.size };
}

function classificacio(sala) {
  return [...sala.punts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, punts]) => ({ nom: sala.noms.get(c) || 'Anònim', punts }));
}

function envia(res, tipus, dades) { res.write(`event: ${tipus}\ndata: ${JSON.stringify(dades)}\n\n`); }

function emet(sala, tipus, dades) { for (const res of sala.clients.keys()) envia(res, tipus, dades); }

function emetVistes(sala) {
  const vistes = {};
  for (const [res, rol] of sala.clients) {
    if (rol === 'public') continue;
    envia(res, 'vista', (vistes[rol] ??= sala.joc.vista(rol)));
  }
}

// Audience vote: follows the latest decision available in the shift and scores it when the team decides
function actualitzaVot(sala) {
  const { joc } = sala;
  for (const t of joc.tancades.splice(0)) {
    if (t.id !== sala.pas?.id || !sala.pas.obert) continue;
    for (const [c, tria] of sala.vots) sala.punts.set(c, (sala.punts.get(c) || 0) + tria.reduce((s, id) => s + (PUNTS[t.valoracions[id]] ?? 0), 0));
    const visible = joc.config.feedback === 'immediat';
    sala.pas = { ...sala.pas, obert: false, resultat: { equip: t.resultat.equip, ...(visible ? { valoracio: t.resultat.valoracio, feedback: t.resultat.feedback } : {}) } };
    sala.pasTancat = Date.now();
    emet(sala, 'pas', sala.pas);
    emet(sala, 'classificacio', classificacio(sala));
  }
  const nova = joc.votacio;
  const potCanviar = !sala.pas || sala.pas.obert || Date.now() - sala.pasTancat > SEGONS_RESULTAT_VOT * 1000;
  if (nova && nova.id !== sala.pas?.id && potCanviar) {
    sala.pas = { ...nova, obert: true };
    sala.vots = new Map();
    emet(sala, 'pas', sala.pas);
    emet(sala, 'vots', recompte(sala));
  }
}

setInterval(() => {
  for (const [codi, a] of aules) if (Date.now() - a.activa > CADUCITAT_SALA_MS) aules.delete(codi);
  for (const [codi, sala] of sales) {
    if (Date.now() - sala.activa > CADUCITAT_SALA_MS && !sala.clients.size) { sales.delete(codi); continue; }
    sala.joc.tic(1);
    actualitzaVot(sala);
    emetVistes(sala);
  }
}, 1000).unref();

function llegeixCos(req, max = 5e5) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > max) req.destroy(); });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

function json(res, codi, d) {
  res.writeHead(codi, { 'Content-Type': TYPES['.json'] });
  res.end(JSON.stringify(d));
}

function teClau(req) {
  if (!CLAU) return true;
  const galeta = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith('gamcecos='));
  const valor = Buffer.from(decodeURIComponent(galeta?.slice(9) || ''));
  const esperat = Buffer.from(CLAU);
  return valor.length === esperat.length && crypto.timingSafeEqual(valor, esperat);
}

function paginaClau(res, error) {
  res.writeHead(error ? 401 : 200, { 'Content-Type': TYPES['.html'] });
  res.end(`<!doctype html><html lang="ca"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>GamCECOS</title><link rel="stylesheet" href="/app/estil.css"></head><body>
<form class="formulari panell" method="post" action="/entra"><h1>GamCECOS</h1>
<label>Contrasenya <input type="password" name="clau" autofocus></label>
${error ? '<p style="color:var(--perillosa)">Contrasenya incorrecta</p>' : ''}<button class="boto">Entrar</button></form></body></html>`);
}

function validaCas(c) {
  if (!c || !/^[a-z0-9-]{3,40}$/.test(c.id || '')) return 'Identificador invàlid (minúscules, números i guions)';
  if (!c.titol || !c.carta || !Array.isArray(c.variants) || !c.variants.length || !Array.isArray(c.passos)) return 'Falten camps obligatoris';
  for (const v of c.variants) if (!v.id || !(v.nivell >= 1 && v.nivell <= 5)) return `Variant ${v.id || '?'} sense nivell`;
  for (const p of c.passos) {
    if (p.tipus === 'decisio') for (const o of p.opcions || []) for (const v of c.variants) {
      const val = typeof o.valoracio === 'object' ? o.valoracio[v.id] : o.valoracio;
      if (!PUNTS.hasOwnProperty(val)) return `Falta la valoració de "${o.text}" per a la variant ${v.id}`;
    }
    if (p.tipus === 'nivell') for (const v of c.variants) for (const n of [1, 2, 3, 4, 5]) {
      if (!PUNTS.hasOwnProperty(p.valoracio?.[v.id]?.[n])) return `Falta la valoració del nivell N${n} per a la variant ${v.id}`;
    }
  }
  return null;
}

async function api(req, res, ruta, params) {
  const autoritzat = teClau(req);
  if (ruta === '/api/info') {        // LAN addresses, so phones on the same network can reach the vote page
    const ips = Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
    return json(res, 200, { urls: ips.map(ip => `http://${ip}:${PORT}`) });
  }
  // Recordings travel as raw bytes, not JSON
  if (ruta === '/api/aula/audio' && req.method === 'POST') return autoritzat ? pujaAudio(req, res, params) : json(res, 401, { error: 'Cal contrasenya' });
  if (ruta === '/api/aula/audio') return autoritzat ? serveixAudio(req, res, params) : json(res, 401, { error: 'Cal contrasenya' });
  let cos = {};
  if (req.method === 'POST') {
    try { const s = await llegeixCos(req); cos = s ? JSON.parse(s) : {}; } catch { return json(res, 400, { error: 'JSON invàlid' }); }
  }
  if (ruta.startsWith('/api/aula/casos')) return autoritzat ? casosAula(req, res, ruta, cos) : json(res, 401, { error: 'Cal contrasenya' });
  if (ruta === '/api/aula/interrogatori') return autoritzat ? interrogatori(req, res, cos) : json(res, 401, { error: 'Cal contrasenya' });
  // Units around the place of a case, for the tutor to choose which appear, which are busy and which are right
  if (ruta === '/api/aula/unitats' && req.method === 'POST') return autoritzat ? json(res, 200, { unitats: unitatsProperes(dades, cos.lloc) }) : json(res, 401, { error: 'Cal contrasenya' });
  if (ruta.startsWith('/api/aula/')) return apiAula(req, res, ruta, params, cos, autoritzat);
  if (['/api/sala', '/api/casos', '/api/casos/esborra'].includes(ruta) && !autoritzat) return json(res, 401, { error: 'Cal contrasenya' });
  if (ruta === '/api/sala' && req.method === 'POST') return json(res, 200, { sala: novaSala(cos.config || {}) });
  if (ruta === '/api/casos' && req.method === 'GET') return json(res, 200, { casos: dades.casos });
  if (ruta === '/api/casos/esborra' && req.method === 'POST') {   // delete a local case, or go back to the original
    const fitxer = path.join(DIR_CASOS_LOCALS, `${String(cos.id || '').replace(/[^a-z0-9-]/g, '')}.json`);
    if (!fs.existsSync(fitxer)) return json(res, 404, { error: 'Aquest cas no té cap versió local' });
    fs.unlinkSync(fitxer);
    dades.casos = carregaCasos();
    return json(res, 200, { ok: true });
  }
  if (ruta === '/api/casos' && req.method === 'POST') {   // save a case edited by the tutor
    const error = validaCas(cos.cas);
    if (error) return json(res, 400, { error });
    const { origen, local, ...cas } = cos.cas;
    if (cos.nou && dades.casos.some(c => c.id === cas.id)) return json(res, 409, { error: `Ja existeix un cas amb l'identificador ${cas.id}` });
    fs.mkdirSync(DIR_CASOS_LOCALS, { recursive: true });
    fs.writeFileSync(path.join(DIR_CASOS_LOCALS, `${cas.id}.json`), JSON.stringify(cas, null, 1));
    dades.casos = carregaCasos();
    return json(res, 200, { ok: true });
  }

  const sala = sales.get(String(params.get('sala') || '').toUpperCase());
  if (!sala) return json(res, 404, { error: 'Sala no trobada' });
  sala.activa = Date.now();
  const client = String(cos.client || params.get('client') || '').slice(0, 64);

  if (ruta === '/api/events') {
    const rol = ROLS.includes(params.get('rol')) ? params.get('rol') : 'public';
    if (rol !== 'public' && !autoritzat) return json(res, 401, { error: 'Cal contrasenya' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`:${' '.repeat(2048)}\n\n`);   // padding: some proxies hold the stream until they have a few KB
    sala.clients.set(res, rol);
    envia(res, 'pas', sala.pas);
    envia(res, 'vots', recompte(sala));
    envia(res, 'classificacio', classificacio(sala));
    if (rol !== 'public') envia(res, 'vista', sala.joc.vista(rol));
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { sala.clients.delete(res); clearInterval(ping); });
    return;
  }
  // Same data as the event stream, for screens whose stream is held back on the way (they ask every second)
  if (ruta === '/api/estat') {
    const rol = ROLS.includes(params.get('rol')) ? params.get('rol') : 'public';
    if (rol !== 'public' && !autoritzat) return json(res, 401, { error: 'Cal contrasenya' });
    return json(res, 200, { pas: sala.pas, vots: recompte(sala), classificacio: classificacio(sala), ...(rol !== 'public' ? { vista: sala.joc.vista(rol) } : {}) });
  }
  if (ruta === '/api/punts') {
    const pos = [...sala.punts.entries()].sort((a, b) => b[1] - a[1]).findIndex(([c]) => c === client);
    return json(res, 200, { punts: sala.punts.get(client) || 0, posicio: pos + 1, total: sala.punts.size });
  }
  if (ruta === '/api/vot' && req.method === 'POST') {
    if (!sala.pas?.obert) return json(res, 409, { error: 'La votació està tancada' });
    const valides = new Set(sala.pas.opcions.map(o => o.id));
    const tria = [...new Set(cos.opcions || [])].filter(id => valides.has(id)).slice(0, sala.pas.max || 1);
    if (!client || !tria.length) return json(res, 400, { error: 'Vot buit' });
    sala.vots.set(client, tria);
    if (cos.nom) sala.noms.set(client, String(cos.nom).slice(0, 24));
    emet(sala, 'vots', recompte(sala));
    return json(res, 200, { ok: true });
  }

  if (!autoritzat) return json(res, 401, { error: 'Cal contrasenya' });
  if (ruta === '/api/config') return json(res, 200, { config: sala.joc.config });
  if (ruta === '/api/accio' && req.method === 'POST') {
    if (!['uct', 'consultor', 'cap', 'tutor'].includes(cos.rol)) return json(res, 400, { error: 'Rol desconegut' });
    const error = sala.joc.accio(cos.rol, cos.accio || {});
    actualitzaVot(sala);
    emetVistes(sala);
    return json(res, error ? 409 : 200, error ? { error } : { ok: true });
  }
  json(res, 404, { error: 'No trobat' });
}

// ---------- Prepared training cases: aula-casos/<id>.json and the recording aula-casos/<id>.<ext> ----------

// The base questioning (blocks and their items) new cases start from; editable by the tutor
const FITXER_INTERROGATORI = 'interrogatori.json';
const SECCIONS_INTERROGATORI = ['anamnesi', 'signes', 'maniobres', 'noavaluable'];

function interrogatori(req, res, cos) {
  const fitxer = path.join(DIR_AULA, FITXER_INTERROGATORI);
  if (req.method === 'GET') {
    try { return json(res, 200, JSON.parse(fs.readFileSync(fitxer, 'utf8'))); } catch { return json(res, 200, { blocs: null }); }
  }
  const textos = l => (Array.isArray(l) ? l.map(x => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 15) : []);
  const blocs = (Array.isArray(cos.blocs) ? cos.blocs : []).slice(0, 12).map(b => ({
    lletra: String(b?.lletra || '?').trim().slice(0, 4), nom: String(b?.nom || '').trim().slice(0, 60), opcional: b?.opcional === true,
    ...Object.fromEntries(SECCIONS_INTERROGATORI.map(sec => [sec, textos(b?.[sec])])),
  })).filter(b => SECCIONS_INTERROGATORI.some(sec => b[sec].length));
  if (!blocs.length) return json(res, 400, { error: 'L\'interrogatori ha de tenir almenys un bloc amb contingut' });
  try {
    fs.mkdirSync(DIR_AULA, { recursive: true });
    fs.writeFileSync(fitxer, JSON.stringify({ blocs }, null, 1));
  } catch (e) { return errorDisc(res, e); }
  return json(res, 200, { blocs });
}

const idCasAula = id => (/^[a-z0-9-]{3,60}$/.test(String(id || '')) ? String(id) : null);

function llegeixCasosAula() {
  if (!fs.existsSync(DIR_AULA)) return [];
  return fs.readdirSync(DIR_AULA).filter(f => f.endsWith('.json') && f !== FITXER_INTERROGATORI).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(DIR_AULA, f), 'utf8')); } catch { return null; }
  }).filter(Boolean).sort((a, b) => (a.ordre ?? 999) - (b.ordre ?? 999) || String(a.titol).localeCompare(String(b.titol), 'ca'));
}

// The service may run as a user without write access to the folder: say how to fix it instead of failing silently
function errorDisc(res, e) {
  const permis = e.code === 'EACCES' || e.code === 'EPERM';
  return json(res, 500, { error: permis ? `El servidor no pot escriure a ${DIR_AULA}. Al VPS: sudo install -d -o gamcecos -g gamcecos ${DIR_AULA}` : e.message });
}

function casosAula(req, res, ruta, cos) {
  if (ruta === '/api/aula/casos' && req.method === 'GET') return json(res, 200, { casos: llegeixCasosAula() });
  if (ruta === '/api/aula/casos' && req.method === 'POST') {
    const c = cos.cas || {};
    if (!String(c.titol || '').trim()) return json(res, 400, { error: 'Falta el títol' });
    const base = String(c.titol).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cas';
    const id = idCasAula(c.id) || `${base}-${crypto.randomBytes(2).toString('hex')}`;
    const anterior = llegeixCasosAula().find(x => x.id === id);
    const mode = ['nombre', 'manual'].includes(c.recursos?.mode) ? c.recursos.mode : 'auto';
    const recursos = mode === 'nombre' ? { mode, SVA: Number(c.recursos.SVA) || 0, SVB: Number(c.recursos.SVB) || 0, HEMS: Number(c.recursos.HEMS) || 0 } : { mode };
    const fases = c.fases && typeof c.fases === 'object' ? Object.fromEntries(Object.entries(c.fases).filter(([, v]) => typeof v === 'boolean')) : undefined;
    const unitats = Array.isArray(c.unitats) ? c.unitats.filter(u => u && /^[\w-]{1,30}$/.test(u.indicatiu) && ['lliure', 'ocupada'].includes(u.estat))
      .map(u => ({ indicatiu: u.indicatiu, estat: u.estat })).slice(0, 40) : undefined;
    const correctes = Array.isArray(c.correctes) ? c.correctes.filter(id => typeof id === 'string').slice(0, 20) : undefined;
    // Team scenario: several incidents (with their place, level, priority, duplicate link and right units)
    const incidents = Array.isArray(c.incidents) ? c.incidents.slice(0, 8).map((x, i) => ({
      id: /^[a-z0-9]{1,12}$/.test(x?.id || '') ? x.id : `i${i + 1}`, carta: String(x?.carta || '').slice(0, 600), lloc: x?.lloc || null,
      nivell: Number(x?.nivell) || null, prioritat: Number(x?.prioritat) || null, duplicatDe: typeof x?.duplicatDe === 'string' ? x.duplicatDe : null,
      correctes: Array.isArray(x?.correctes) ? x.correctes.filter(id => typeof id === 'string').slice(0, 10) : [],
    })) : undefined;
    const cas = { id, tipus: ['carta', 'escenari'].includes(c.tipus) ? c.tipus : 'veu', incidents, equips: Number(c.equips) || 4, titol: String(c.titol).trim().slice(0, 80), carta: String(c.carta || '').trim().slice(0, 1000),
      nivell: c.nivell ?? null, preguntes: Number(c.preguntes) || 3, temps: Math.max(0, Math.min(1800, Number(c.temps) || 0)), recursos, fases, unitats, correctes, lloc: c.lloc || null, xabcde: c.xabcde || [],
      notes: String(c.notes || '').slice(0, 2000), ordre: Number.isFinite(c.ordre) ? c.ordre : anterior?.ordre ?? 999, audio: anterior?.audio || null };
    try {
      fs.mkdirSync(DIR_AULA, { recursive: true });
      fs.writeFileSync(path.join(DIR_AULA, `${id}.json`), JSON.stringify(cas, null, 1));
    } catch (e) { return errorDisc(res, e); }
    return json(res, 200, { cas });
  }
  if (ruta === '/api/aula/casos/esborra' && req.method === 'POST') {
    const id = idCasAula(cos.id);
    const cas = id && llegeixCasosAula().find(x => x.id === id);
    if (!cas) return json(res, 404, { error: 'Cas desconegut' });
    try {
      fs.unlinkSync(path.join(DIR_AULA, `${id}.json`));
      if (cas.audio) fs.rmSync(path.join(DIR_AULA, cas.audio), { force: true });
    } catch (e) { return errorDisc(res, e); }
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: 'No trobat' });
}

function pujaAudio(req, res, params) {
  const id = idCasAula(params.get('id'));
  const cas = id && llegeixCasosAula().find(x => x.id === id);
  const ext = TIPUS_AUDIO[String(req.headers['content-type'] || '').split(';')[0].trim()];
  if (!cas) return json(res, 404, { error: 'Deseu el cas abans de pujar l\'àudio' });
  if (!ext) return json(res, 415, { error: 'Format d\'àudio no admès (mp3, wav, ogg, m4a, webm, aac, flac)' });
  const parts = [];
  let mida = 0;
  req.on('data', c => { mida += c.length; if (mida > MAX_AUDIO) { json(res, 413, { error: 'L\'àudio és massa gran (màxim 40 MB)' }); req.destroy(); } else parts.push(c); });
  req.on('end', () => {
    if (mida > MAX_AUDIO) return;
    try {
      if (cas.audio) fs.rmSync(path.join(DIR_AULA, cas.audio), { force: true });
      cas.audio = `${id}${ext}`;
      fs.writeFileSync(path.join(DIR_AULA, cas.audio), Buffer.concat(parts));
      fs.writeFileSync(path.join(DIR_AULA, `${id}.json`), JSON.stringify(cas, null, 1));
    } catch (e) { return errorDisc(res, e); }
    json(res, 200, { cas });
  });
}

// Streams a recording, with byte ranges so the player can jump back and forth
function serveixAudio(req, res, params) {
  const id = idCasAula(params.get('id'));
  const cas = id && llegeixCasosAula().find(x => x.id === id);
  if (!cas?.audio) return json(res, 404, { error: 'Aquest cas no té àudio' });
  const fitxer = path.join(DIR_AULA, cas.audio);
  let mida;
  try { mida = fs.statSync(fitxer).size; } catch { return json(res, 404, { error: 'Falta el fitxer d\'àudio' }); }
  const tipus = Object.entries(TIPUS_AUDIO).find(([, e]) => e === path.extname(fitxer))?.[0] || 'application/octet-stream';
  const rang = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (rang && (rang[1] || rang[2])) {
    const inici = rang[1] ? Number(rang[1]) : Math.max(0, mida - Number(rang[2]));
    const fi = rang[1] && rang[2] ? Math.min(Number(rang[2]), mida - 1) : mida - 1;
    if (inici >= mida || inici > fi) { res.writeHead(416, { 'Content-Range': `bytes */${mida}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': tipus, 'Content-Length': fi - inici + 1, 'Content-Range': `bytes ${inici}-${fi}/${mida}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(fitxer, { start: inici, end: fi }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': tipus, 'Content-Length': mida, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  fs.createReadStream(fitxer).pipe(res);
}

// Consultor training: the tutor creates and drives the session; students answer from their phones without password
function apiAula(req, res, ruta, params, cos, autoritzat) {
  const delTutor = ['/api/aula/nova', '/api/aula/ordre', '/api/aula/tutor'].includes(ruta);
  if (delTutor && !autoritzat) return json(res, 401, { error: 'Cal contrasenya' });
  if (ruta === '/api/aula/nova' && req.method === 'POST') {
    const codi = nouCodi(aules);
    aules.set(codi, { aula: new Aula(cos.config || {}, dades), activa: Date.now() });
    return json(res, 200, { codi });
  }
  const entrada = aules.get(String(params.get('codi') || '').toUpperCase());
  if (!entrada) return json(res, 404, { error: 'No existeix cap sessió amb aquest codi' });
  entrada.activa = Date.now();
  const { aula } = entrada;
  if (ruta === '/api/aula/tutor') return json(res, 200, aula.vistaTutor());
  if (ruta === '/api/aula/estat') return json(res, 200, aula.vistaAlumne(String(params.get('client') || '').slice(0, 64)));
  if (ruta === '/api/aula/ordre' && req.method === 'POST') {
    const error = aula.ordre(cos);
    return json(res, error ? 409 : 200, error ? { error } : { ok: true });
  }
  if (ruta === '/api/aula/resposta' && req.method === 'POST') {
    const error = aula.respon(String(cos.client || '').slice(0, 64), cos);
    return json(res, error ? 409 : 200, error ? { error } : aula.vistaAlumne(String(cos.client || '').slice(0, 64)));
  }
  json(res, 404, { error: 'No trobat' });
}

function estatic(res, ruta) {
  const fitxer = path.normalize(path.join(ROOT, decodeURIComponent(ruta)));
  const dir = path.relative(ROOT, fitxer).split(path.sep)[0];
  if (!fitxer.startsWith(ROOT + path.sep) || !PUBLIC_DIRS.includes(dir)) return json(res, 404, { error: 'No trobat' });
  fs.stat(fitxer, (err, info) => {
    if (err || !info.isFile()) return json(res, 404, { error: 'No trobat' });
    // Browsers must revalidate every file, so an update never mixes old and new scripts
    const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
    const capçaleres = { 'Cache-Control': 'no-cache', ETag: etag };
    if (res.req.headers['if-none-match'] === etag) { res.writeHead(304, capçaleres); return res.end(); }
    fs.readFile(fitxer, (err2, buf) => {
      if (err2) return json(res, 404, { error: 'No trobat' });
      res.writeHead(200, { ...capçaleres, 'Content-Type': TYPES[path.extname(fitxer)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
}

const DRECERES = { '/': '/app/index.html', '/vota': '/app/vota.html', '/tutor': '/app/tutor.html', '/uct': '/app/uct.html',
  '/sala': '/app/uct.html', '/consultor': '/app/consultor.html', '/cap': '/app/cap.html', '/editor': '/app/editor.html',
  '/aprenentatge': '/app/aprenentatge.html', '/aula': '/app/aula.html', '/projector': '/app/projector.html', '/aula-admin': '/app/aula-admin.html',
  '/presentacio': '/app/presentacio.html' };

async function arrenca() {
  ({ Guardia } = await import('./joc.mjs'));
  ({ Aula, unitatsProperes } = await import('./aula.mjs'));
  dades = { unitats: llegeix('data/unitats.json'), centres: llegeix('data/centres.json'), dea: llegeix('data/dea.json'),
    aure: llegeix('data/resposta_aure.json'), capacitats: llegeix('data/capacitats_hospitals.json'), casos: carregaCasos() };
  http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ruta = url.pathname;
    if (ruta === '/favicon.ico') { res.writeHead(204); return res.end(); }   // no icon: avoids a 404 in the browser console
    if (DRECERES[ruta]) { res.writeHead(302, { Location: DRECERES[ruta] + url.search }); return res.end(); }
    if (ruta === '/entra' && req.method === 'POST') {
      const clau = new URLSearchParams(await llegeixCos(req, 1e4)).get('clau') || '';
      if (clau !== CLAU) return paginaClau(res, true);
      res.writeHead(302, { 'Set-Cookie': `gamcecos=${encodeURIComponent(clau)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`, Location: '/' });
      return res.end();
    }
    if (ruta.startsWith('/api/')) return api(req, res, ruta, url.searchParams).catch(e => json(res, 500, { error: e.message }));
    if (!OBERT_SENSE_CLAU.has(ruta) && !teClau(req)) {
      return ruta.startsWith('/data/') ? json(res, 401, { error: 'Cal contrasenya' }) : paginaClau(res, false);
    }
    estatic(res, ruta);
  }).listen(PORT, HOST, () => console.log(`GamCECOS a http://localhost:${PORT}${CLAU ? ' (amb contrasenya)' : ''}`));
}

arrenca();
