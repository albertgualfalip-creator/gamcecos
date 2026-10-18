// GamCECOS server: serves the game and relays, per room, the messages between the tutor panel, the team
// screen and the audience (Server-Sent Events). The game logic runs in the team screen (app/sala.mjs).
//
// Environment:
//   PORT            port to listen on (default 8080)
//   HOST            interface to listen on (default all; 127.0.0.1 behind a reverse proxy)
//   GAMCECOS_CLAU   optional password for the tutor and team screens and the data; the audience only needs the room code
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
const OBERT_SENSE_CLAU = new Set(['/app/index.html', '/app/vota.html', '/app/vota.mjs', '/app/estil.css', '/api/events', '/api/vot', '/api/punts']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const CADUCITAT_SALA_MS = 12 * 3600 * 1000;
const PUNTS = { optima: 3, acceptable: 2, suboptima: 1, perillosa: 0 };
// Which events each kind of client receives: the audience never gets the case truth or the tutor orders
const EVENTS_PER_ROL = { public: ['pas', 'vots', 'classificacio'], sala: ['pas', 'vots', 'ordre', 'classificacio'], tutor: ['pas', 'vots', 'estat', 'classificacio'] };

// Room code -> {config, estat, pas, vots, noms, punts, clients: Map(response -> rol), activa}
const sales = new Map();

function novaSala(config) {
  let codi;
  do codi = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]).join('');
  while (sales.has(codi));
  sales.set(codi, { config, estat: null, pas: null, vots: new Map(), noms: new Map(), punts: new Map(), clients: new Map(), activa: Date.now() });
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

function classificacio(sala) {
  return [...sala.punts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([client, punts]) => ({ nom: sala.noms.get(client) || 'Anònim', punts }));
}

function emet(sala, tipus, dades) {
  const msg = `event: ${tipus}\ndata: ${JSON.stringify(dades)}\n\n`;
  for (const [res, rol] of sala.clients) if (EVENTS_PER_ROL[rol].includes(tipus)) res.write(msg);
}

function llegeixCos(req, max = 2e5) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > max) req.destroy(); });
    req.on('end', () => resolve(s));
    req.on('error', reject);
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
  const autoritzat = teClau(req);
  if (ruta === '/api/info') {        // LAN addresses, so phones on the same network can reach the vote page
    const ips = Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
    return json(res, 200, { urls: ips.map(ip => `http://${ip}:${PORT}`) });
  }
  let cos = {};
  if (req.method === 'POST') {
    try { const s = await llegeixCos(req); cos = s ? JSON.parse(s) : {}; } catch { return json(res, 400, { error: 'JSON invàlid' }); }
  }
  if (ruta === '/api/sala' && req.method === 'POST') {   // the tutor creates the shift with its configuration
    if (!autoritzat) return json(res, 401, { error: 'Cal contrasenya' });
    return json(res, 200, { sala: novaSala(cos.config || {}) });
  }

  const sala = sales.get(String(params.get('sala') || '').toUpperCase());
  if (!sala) return json(res, 404, { error: 'Sala no trobada' });
  sala.activa = Date.now();
  const client = String(cos.client || params.get('client') || '').slice(0, 64);

  if (ruta === '/api/events') {
    const rol = EVENTS_PER_ROL[params.get('rol')] ? params.get('rol') : 'public';
    if (rol !== 'public' && !autoritzat) return json(res, 401, { error: 'Cal contrasenya' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    sala.clients.set(res, rol);
    const inicial = { pas: sala.pas, vots: recompte(sala), classificacio: classificacio(sala), estat: sala.estat };
    for (const [tipus, dades] of Object.entries(inicial)) if (EVENTS_PER_ROL[rol].includes(tipus)) res.write(`event: ${tipus}\ndata: ${JSON.stringify(dades)}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { sala.clients.delete(res); clearInterval(ping); });
    return;
  }
  if (ruta === '/api/punts') {
    const ordre = [...sala.punts.entries()].sort((a, b) => b[1] - a[1]).findIndex(([c]) => c === client);
    return json(res, 200, { punts: sala.punts.get(client) || 0, posicio: ordre + 1, total: sala.punts.size });
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

  // Everything below comes from the tutor or the team screen
  if (!autoritzat) return json(res, 401, { error: 'Cal contrasenya' });
  if (ruta === '/api/config') return json(res, 200, { config: sala.config });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST' });
  if (ruta === '/api/ordre') { emet(sala, 'ordre', cos.ordre); return json(res, 200, { ok: true }); }
  if (ruta === '/api/estat') { sala.estat = cos.estat; emet(sala, 'estat', sala.estat); return json(res, 200, { ok: true }); }
  if (ruta === '/api/pas') {
    sala.pas = cos.pas ? { ...cos.pas, obert: true } : null;
    sala.vots = new Map();
    emet(sala, 'pas', sala.pas);
    emet(sala, 'vots', recompte(sala));
    return json(res, 200, { ok: true });
  }
  if (ruta === '/api/tanca') {      // the team has decided: score the audience and show the result to everybody
    if (sala.pas) {
      const valoracions = cos.valoracions || {};
      for (const [c, tria] of sala.vots) {
        const guanyats = tria.reduce((s, id) => s + (PUNTS[valoracions[id]] ?? 0), 0);
        sala.punts.set(c, (sala.punts.get(c) || 0) + guanyats);
      }
      sala.pas.obert = false;
      sala.pas.resultat = cos.resultat || null;
    }
    emet(sala, 'pas', sala.pas);
    emet(sala, 'classificacio', classificacio(sala));
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
  const dreceres = { '/': '/app/index.html', '/vota': '/app/vota.html', '/tutor': '/app/tutor.html', '/sala': '/app/sala.html' };
  if (dreceres[ruta]) { res.writeHead(302, { Location: dreceres[ruta] + url.search }); return res.end(); }
  if (ruta === '/entra' && req.method === 'POST') {
    const clau = new URLSearchParams(await llegeixCos(req, 1e4)).get('clau') || '';
    if (clau !== CLAU) return paginaClau(res, true);
    res.writeHead(302, { 'Set-Cookie': `gamcecos=${encodeURIComponent(clau)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`, Location: '/' });
    return res.end();
  }
  if (ruta.startsWith('/api/')) return api(req, res, ruta, url.searchParams);
  if (!OBERT_SENSE_CLAU.has(ruta) && !teClau(req)) {
    return ruta.startsWith('/data/') || ruta.startsWith('/casos/') ? json(res, 401, { error: 'Cal contrasenya' }) : paginaClau(res, false);
  }
  estatic(res, ruta);
}).listen(PORT, HOST, () => console.log(`GamCECOS a http://localhost:${PORT}${CLAU ? ' (amb contrasenya)' : ''}`));
