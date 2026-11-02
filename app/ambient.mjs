// Coordination room background, synthesised in the browser (no recordings): the hum of the room, radio
// transmissions with squelch and the end-of-transmission beep, distant voices, phones ringing and keyboards.
// Browsers only allow sound after a click, so it starts from a button.
let ctx = null, sortida = null, temporitzadors = [];

function soroll(segons, color = 'blanc') {
  const n = Math.floor(ctx.sampleRate * segons), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let ultim = 0;
  for (let i = 0; i < n; i++) {
    const b = Math.random() * 2 - 1;
    d[i] = color === 'marro' ? (ultim = (ultim + 0.02 * b) / 1.02) * 3.5 : b;
  }
  const font = ctx.createBufferSource();
  font.buffer = buf;
  return font;
}

function filtre(tipus, freq, q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = tipus; f.frequency.value = freq; f.Q.value = q;
  return f;
}

function guany(valor) { const g = ctx.createGain(); g.gain.value = valor; return g; }

function to(freq, inici, durada, volum, desti = sortida, forma = 'sine') {
  const o = ctx.createOscillator(), g = guany(0);
  o.type = forma; o.frequency.value = freq;
  g.gain.setValueAtTime(0, inici);
  g.gain.linearRampToValueAtTime(volum, inici + 0.01);
  g.gain.setValueAtTime(volum, inici + durada - 0.02);
  g.gain.linearRampToValueAtTime(0, inici + durada);
  o.connect(g).connect(desti);
  o.start(inici); o.stop(inici + durada);
}

// Speech-like murmur: telephone-band noise shaped in syllables
function veu(inici, durada, volum, desti) {
  const font = soroll(durada), banda = filtre('bandpass', 700 + Math.random() * 600, 1.4), g = guany(0);
  font.connect(banda).connect(g).connect(desti);
  let t = inici;
  while (t < inici + durada) {
    const sillaba = 0.08 + Math.random() * 0.14;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volum * (0.5 + Math.random() * 0.5), t + sillaba * 0.3);
    g.gain.linearRampToValueAtTime(0, t + sillaba);
    t += sillaba + (Math.random() < 0.15 ? 0.25 : 0.03);
  }
  font.start(inici); font.stop(inici + durada);
}

// A radio transmission: squelch, a voice through the radio band and the end-of-transmission beep
function emissora() {
  const t = ctx.currentTime + 0.05, durada = 1.2 + Math.random() * 2.5;
  const radio = filtre('bandpass', 1400, 0.9), g = guany(0.9);
  radio.connect(g).connect(sortida);
  const squelch = soroll(0.12), gs = guany(0.05);
  squelch.connect(filtre('highpass', 1800)).connect(gs).connect(sortida);
  squelch.start(t); squelch.stop(t + 0.12);
  veu(t + 0.1, durada, 0.11, radio);
  const fons = soroll(durada), gf = guany(0.012);
  fons.connect(radio); fons.connect(gf).connect(sortida);
  fons.start(t + 0.1); fons.stop(t + 0.1 + durada);
  to(1050, t + 0.15 + durada, 0.09, 0.03);
  to(1350, t + 0.25 + durada, 0.07, 0.025);
}

// A phone ringing at another desk
function telefon() {
  const t = ctx.currentTime + 0.05, lluny = filtre('lowpass', 1800), g = guany(0.35);
  lluny.connect(g).connect(sortida);
  for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
    to(440, t + i * 2.2, 1, 0.03, lluny); to(480, t + i * 2.2, 1, 0.03, lluny);
  }
}

// A few keystrokes
function teclat() {
  const t = ctx.currentTime + 0.05;
  for (let i = 0, tt = t; i < 4 + Math.random() * 12; i++, tt += 0.07 + Math.random() * 0.15) {
    const clic = soroll(0.012), g = guany(0.03);
    clic.connect(filtre('bandpass', 3000 + Math.random() * 2000, 2)).connect(g).connect(sortida);
    clic.start(tt); clic.stop(tt + 0.012);
  }
}

function repeteix(fn, min, max) {
  const seguent = () => { fn(); temporitzadors.push(setTimeout(seguent, (min + Math.random() * (max - min)) * 1000)); };
  temporitzadors.push(setTimeout(seguent, Math.random() * min * 1000));
}

export function engega(volum = 0.8) {
  if (ctx) return;
  ctx = new AudioContext();
  sortida = guany(volum);
  sortida.connect(ctx.destination);
  // Room hum and a murmur of colleagues talking far away
  const sala = soroll(4, 'marro');
  sala.loop = true;
  sala.connect(filtre('lowpass', 350)).connect(guany(0.05)).connect(sortida);
  sala.start();
  const murmuri = () => { const lluny = filtre('lowpass', 900); lluny.connect(sortida); veu(ctx.currentTime + 0.05, 1.5 + Math.random() * 3, 0.018, lluny); };
  repeteix(emissora, 5, 14);
  repeteix(telefon, 18, 40);
  repeteix(teclat, 2, 6);
  repeteix(murmuri, 3, 8);
}

export function atura() {
  for (const t of temporitzadors) clearTimeout(t);
  temporitzadors = [];
  ctx?.close();
  ctx = null;
}

export const sona = () => !!ctx;
