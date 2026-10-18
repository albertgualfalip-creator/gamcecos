// GamCECOS server: serves the game files and relays the audience vote in real time (Server-Sent Events).
// The game logic runs in the room screen (app/sala.js); the server only keeps the open question and the votes.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const PUBLIC_DIRS = ['app', 'data', 'casos'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

let pas = null;          // {id, titol, pregunta, opcions:[{id,text}], max, obert}
let vots = new Map();    // client id -> [option ids]
const clients = new Set();

function recompte() {
  const r = {};
  for (const o of pas?.opcions || []) r[o.id] = 0;
  for (const tria of vots.values()) for (const id of tria) if (id in r) r[id]++;
  return { recompte: r, votants: vots.size };
}

function emet(tipus, dades) {
  const msg = `event: ${tipus}\ndata: ${JSON.stringify(dades)}\n\n`;
  for (const res of clients) res.write(msg);
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

async function api(req, res, ruta) {
  if (ruta === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`event: pas\ndata: ${JSON.stringify(pas)}\n\n`);
    res.write(`event: vots\ndata: ${JSON.stringify(recompte())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clients.delete(res); clearInterval(ping); });
    return;
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST' });
  let cos;
  try { cos = await llegeixCos(req); } catch { return json(res, 400, { error: 'JSON invàlid' }); }

  if (ruta === '/api/pas') {        // the room opens a new question for the audience
    pas = cos.pas ? { ...cos.pas, obert: true } : null;
    vots = new Map();
    emet('pas', pas);
    emet('vots', recompte());
    return json(res, 200, { ok: true });
  }
  if (ruta === '/api/tanca') {      // the team has decided: voting closes and the result is shown to everybody
    if (pas) { pas.obert = false; pas.resultat = cos.resultat || null; }
    emet('pas', pas);
    return json(res, 200, { ok: true });
  }
  if (ruta === '/api/vot') {
    if (!pas?.obert) return json(res, 409, { error: 'La votació està tancada' });
    const valides = new Set(pas.opcions.map(o => o.id));
    const tria = [...new Set(cos.opcions || [])].filter(id => valides.has(id)).slice(0, pas.max || 1);
    if (!cos.client || !tria.length) return json(res, 400, { error: 'Vot buit' });
    vots.set(String(cos.client).slice(0, 64), tria);
    emet('vots', recompte());
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

http.createServer((req, res) => {
  const ruta = new URL(req.url, 'http://x').pathname;
  if (ruta === '/') { res.writeHead(302, { Location: '/app/sala.html' }); return res.end(); }
  if (ruta === '/vota') { res.writeHead(302, { Location: '/app/vota.html' }); return res.end(); }
  if (ruta.startsWith('/api/')) return api(req, res, ruta);
  estatic(res, ruta);
}).listen(PORT, () => console.log(`GamCECOS a http://localhost:${PORT} (públic: /vota)`));
