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
const PUBLIC_DIRS = ['app', 'data'];
const OBERT_SENSE_CLAU = new Set(['/app/index.html', '/app/vota.html', '/app/vota.mjs', '/app/estil.css', '/api/events', '/api/vot', '/api/punts']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const CADUCITAT_SALA_MS = 12 * 3600 * 1000;
const SEGONS_RESULTAT_VOT = 6;
const PUNTS = { optima: 3, acceptable: 2, suboptima: 1, perillosa: 0 };
const ROLS = ['public', 'uct', 'consultor', 'cap', 'tutor'];

let Guardia, dades;
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

function novaSala(config) {
  let codi;
  do codi = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]).join('');
  while (sales.has(codi));
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
  let cos = {};
  if (req.method === 'POST') {
    try { const s = await llegeixCos(req); cos = s ? JSON.parse(s) : {}; } catch { return json(res, 400, { error: 'JSON invàlid' }); }
  }
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
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    sala.clients.set(res, rol);
    envia(res, 'pas', sala.pas);
    envia(res, 'vots', recompte(sala));
    envia(res, 'classificacio', classificacio(sala));
    if (rol !== 'public') envia(res, 'vista', sala.joc.vista(rol));
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { sala.clients.delete(res); clearInterval(ping); });
    return;
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

function estatic(res, ruta) {
  const fitxer = path.normalize(path.join(ROOT, decodeURIComponent(ruta)));
  const dir = path.relative(ROOT, fitxer).split(path.sep)[0];
  if (!fitxer.startsWith(ROOT + path.sep) || !PUBLIC_DIRS.includes(dir)) return json(res, 404, { error: 'No trobat' });
  fs.readFile(fitxer, (err, buf) => {
    if (err) return json(res, 404, { error: 'No trobat' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fitxer)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const DRECERES = { '/': '/app/index.html', '/vota': '/app/vota.html', '/tutor': '/app/tutor.html', '/uct': '/app/uct.html',
  '/sala': '/app/uct.html', '/consultor': '/app/consultor.html', '/cap': '/app/cap.html', '/editor': '/app/editor.html' };

async function arrenca() {
  ({ Guardia } = await import('./joc.mjs'));
  dades = { unitats: llegeix('data/unitats.json'), centres: llegeix('data/centres.json'), dea: llegeix('data/dea.json'),
    aure: llegeix('data/resposta_aure.json'), capacitats: llegeix('data/capacitats_hospitals.json'), casos: carregaCasos() };
  http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ruta = url.pathname;
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
