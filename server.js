// GamCECOS server: serves the game files and relays the audience vote in real time (Server-Sent Events).
// The game logic runs in the room screen (app/sala.mjs); the server only keeps, per room, the open question and the votes.
//
// Environment:
//   PORT            port to listen on (default 8080)
//   HOST            interface to listen on (default all; 127.0.0.1 behind a reverse proxy)
//   GAMCECOS_CLAU   optional password for the room screen and the data; the vote page only needs the room code
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || undefined;
const CLAU = process.env.GAMCECOS_CLAU || '';
const ROOT = __dirname;
const PUBLIC_DIRS = ['app', 'data', 'casos'];
const OBERT_SENSE_CLAU = new Set(['/app/vota.html', '/app/vota.mjs', '/app/estil.css', '/api/events', '/api/vot']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const CADUCITAT_SALA_MS = 12 * 3600 * 1000;

// Room code -> {pas, vots: Map(client -> option ids), clients: Set(responses), activa}
const sales = new Map();

function novaSala() {
  let codi;
  do codi = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]).join('');
  while (sales.has(codi));
  sales.set(codi, { pas: null, vots: new Map(), clients: new Set(), activa: Date.now() });
  return codi;
}

setInterval(() => {
  for (const [codi, s] of sales) if (Date.now() - s.activa > CADUCITAT_SALA_MS && !s.clients.size) sales.delete(codi);
}, 3600 * 1000).unref();

function recompte(sala) {
  const r = {};
  for (const o of sala.pas?.opcions || []) r[o.id] = 0;
  for (const tria of sala.vots.values()) for (const id of tria) if (id in r) r[id]++;
  return { recompte: r, votants: sala.vots.size };
}

function emet(sala, tipus, dades) {
  const msg = `event: ${tipus}\ndata: ${JSON.stringify(dades)}\n\n`;
  for (const res of sala.clients) res.write(msg);
}

function llegeixCos(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}

function json(res, codi, dades) {
  res.writeHead(codi, { 'Content-Type': TYPES['.json'] });
  res.end(JSON.stringify(dades));
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

async function api(req, res, ruta, params) {
  if (ruta === '/api/sala' && req.method === 'POST') {   // reuse the room after a reload, so phones stay connected
    const anterior = String(params.get('sala') || '').toUpperCase();
    return json(res, 200, { sala: sales.has(anterior) ? anterior : novaSala() });
  }
  if (ruta === '/api/info') {        // LAN addresses, so phones on the same network can reach the vote page
    const ips = Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
    return json(res, 200, { urls: ips.map(ip => `http://${ip}:${PORT}`) });
  }
  const sala = sales.get(String(params.get('sala') || '').toUpperCase());
  if (!sala) return json(res, 404, { error: 'Sala no trobada' });
  sala.activa = Date.now();

  if (ruta === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: pas\ndata: ${JSON.stringify(sala.pas)}\n\n`);
    res.write(`event: vots\ndata: ${JSON.stringify(recompte(sala))}\n\n`);
    sala.clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { sala.clients.delete(res); clearInterval(ping); });
    return;
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST' });
  let cos;
  try { cos = await llegeixCos(req); } catch { return json(res, 400, { error: 'JSON invàlid' }); }

  if (ruta === '/api/pas') {        // the room opens a new question for the audience
    sala.pas = cos.pas ? { ...cos.pas, obert: true } : null;
    sala.vots = new Map();
    emet(sala, 'pas', sala.pas);
    emet(sala, 'vots', recompte(sala));
    return json(res, 200, { ok: true });
  }
  if (ruta === '/api/tanca') {      // the team has decided: voting closes and the result is shown to everybody
    if (sala.pas) { sala.pas.obert = false; sala.pas.resultat = cos.resultat || null; }
    emet(sala, 'pas', sala.pas);
    return json(res, 200, { ok: true });
  }
  if (ruta === '/api/vot') {
    if (!sala.pas?.obert) return json(res, 409, { error: 'La votació està tancada' });
    const valides = new Set(sala.pas.opcions.map(o => o.id));
    const tria = [...new Set(cos.opcions || [])].filter(id => valides.has(id)).slice(0, sala.pas.max || 1);
    if (!cos.client || !tria.length) return json(res, 400, { error: 'Vot buit' });
    sala.vots.set(String(cos.client).slice(0, 64), tria);
    emet(sala, 'vots', recompte(sala));
    return json(res, 200, { ok: true });
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

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ruta = url.pathname;
  if (ruta === '/vota') { res.writeHead(302, { Location: `/app/vota.html${url.search}` }); return res.end(); }
  if (ruta === '/entra' && req.method === 'POST') {
    let cos = '';
    req.on('data', c => { cos += c; if (cos.length > 1e4) req.destroy(); });
    await new Promise(r => req.on('end', r));
    const clau = new URLSearchParams(cos).get('clau') || '';
    if (clau !== CLAU) return paginaClau(res, true);
    res.writeHead(302, { 'Set-Cookie': `gamcecos=${encodeURIComponent(clau)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`, Location: '/' });
    return res.end();
  }
  if (!OBERT_SENSE_CLAU.has(ruta) && !teClau(req)) {
    return ruta.startsWith('/api/') || ruta.startsWith('/data/') ? json(res, 401, { error: 'Cal contrasenya' }) : paginaClau(res, false);
  }
  if (ruta === '/') { res.writeHead(302, { Location: '/app/sala.html' }); return res.end(); }
  if (ruta.startsWith('/api/')) return api(req, res, ruta, url.searchParams);
  estatic(res, ruta);
}).listen(PORT, HOST, () => console.log(`GamCECOS a http://localhost:${PORT}${CLAU ? ' (amb contrasenya)' : ''}`));
