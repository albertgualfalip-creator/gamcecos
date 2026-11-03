import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Aula, CAP_MANIOBRA, textInterval } from '../aula.mjs';
import { CATEGORIA, XABCDE, SECCIONS } from '../app/motor.mjs';

const d = f => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url)));
const dades = { unitats: d('data/unitats.json'), aure: d('data/resposta_aure.json') };
const lloc = { municipi: 'Manresa', zona: 'Catalunya Central', lat: 41.7251, lon: 1.8266 };
// B: the right items are asking whether he breathes, hearing gasping and starting CPR
const CORRECTES = ['Respira? Mira si el pit es mou', 'Gasping o respiració agònica', 'Iniciar RCP si no respira o fa gasping'];
const xabcde = XABCDE.map(l => ({ lletra: l.lletra, nom: l.nom,
  items: SECCIONS.flatMap(sec => l[sec.id].map(text => ({ seccio: sec.id, text, correcte: CORRECTES.includes(text) }))) }));

test('aprenentatge: la resposta correcta per defecte són les unitats més properes segons el nivell', () => {
  const a = new Aula({ titol: 'Prova', nivell: 1, lloc, xabcde, llavor: 1 }, dades);
  assert.ok(a.unitats.length >= 5);
  assert.deepEqual(a.correctes.map(id => CATEGORIA[a.unitats.find(u => u.indicatiu === id).tipus]).sort(), ['SVA', 'SVB']);
  assert.ok(a.correctes.every(id => !a.unitats.find(u => u.indicatiu === id).ocupada));
  assert.deepEqual(new Aula({ nivell: 4, lloc, llavor: 1 }, dades).correctes, []);
});

test('aprenentatge amb veu: escolta, preguntes amb pressupost, una instrucció, nivell i recursos', () => {
  const a = new Aula({ titol: 'Prova', nivell: 1, lloc, xabcde, preguntes: 3, llavor: 1 }, dades);
  assert.match(a.respon('c1', { nom: 'Anna', xabcde: [] }), /no estan obertes/);
  a.ordre({ tipus: 'obre' });
  assert.match(a.respon('c1', { nivell: 1 }), /Primer acaba/);
  const items = a.config.xabcde.flatMap(l => l.items);
  const id = text => items.find(it => it.text === text).id;
  const de = seccio => items.filter(it => it.seccio === seccio && !it.correcte).map(it => it.id);
  // Anna activates the units while still assessing: early detection of severity
  assert.equal(a.respon('c1', { nom: 'Anna', activa: a.correctes }), null);
  assert.equal(a.respostes.get('c1').activacio.abansValoracio, true);
  assert.equal(a.respon('c1', { xabcde: CORRECTES.map(id) }), null);
  assert.equal(a.respon('c1', { nivell: 1 }), null);
  assert.equal(a.respon('c1', { recursos: a.correctes }), null);
  assert.match(a.respon('c1', { recursos: [] }), /Ja has enviat/);
  // Pau: the gasping plus two wrong signs (1 - 2 → 0), five questions (only 3 kept), two instructions (only 1 kept)
  a.respon('c2', { nom: 'Pau', xabcde: [id(CORRECTES[1]), ...de('signes').slice(0, 2), ...de('anamnesi').slice(0, 5), ...de('maniobres').slice(0, 2)] });
  const pau = a.respostes.get('c2').xabcde;
  assert.equal(pau.filter(x => items.find(it => it.id === x)?.seccio === 'anamnesi').length, 3);
  assert.equal(pau.filter(x => items.find(it => it.id === x)?.seccio === 'maniobres').length, 1);
  a.respon('c2', { nivell: 3 });
  a.respon('c2', { recursos: [] });
  // Before the results the phones never see the right answers
  const abans = a.vistaAlumne('c2');
  assert.ok(!('correcte' in abans) && abans.xabcde.every(l => l.items.every(it => !('correcte' in it))));
  a.ordre({ tipus: 'resultats' });
  const [primer, segon] = a.vistaTutor().classificacio;
  // max: 1 heard + 1 question + 2 instruction + 3 level + 3 units + 1 early detection
  assert.deepEqual([primer.nom, primer.punts, primer.maxim, primer.deteccio, primer.instruccio], ['Anna', 11, 11, 1, 2]);
  assert.deepEqual([segon.nom, segon.punts], ['Pau', 0]);
  assert.equal(a.vistaAlumne('c1').puntuacio.punts, 11);
  assert.deepEqual(a.vistaTutor().distribucio.activacio.map(x => x.nom), ['Anna']);
  assert.equal(a.vistaTutor().distribucio.xabcde[id(CORRECTES[1])], 2);
});

test('aprenentatge: «cap instrucció» és correcte quan el cas no en demana cap', () => {
  const sense = XABCDE.map(l => ({ lletra: l.lletra, nom: l.nom, items: SECCIONS.flatMap(sec => l[sec.id].map(text => ({ seccio: sec.id, text }))) }));
  const a = new Aula({ nivell: 3, lloc, xabcde: sense, llavor: 1 }, dades);
  a.ordre({ tipus: 'obre' });
  a.respon('c1', { xabcde: [CAP_MANIOBRA] });
  assert.equal(a.puntua(a.respostes.get('c1')).instruccio, 2);
});

test('aprenentatge: per defecte cada lletra té anamnesi, signes, maniobres i «no avaluable», sense cap correcte', () => {
  const a = new Aula({ lloc, llavor: 1 }, dades);
  for (const l of a.config.xabcde) assert.deepEqual([...new Set(l.items.map(it => it.seccio))], ['anamnesi', 'signes', 'maniobres', 'noavaluable'], l.lletra);
  assert.ok(a.config.xabcde.flatMap(l => l.items).every(it => !it.correcte));
  assert.ok(a.config.xabcde.find(l => l.lletra === 'A').items.some(it => /Heimlich/.test(it.text)));
});

test('aprenentatge: una gravació nova esborra les respostes i torna a preparar', () => {
  const a = new Aula({ nivell: 2, lloc, llavor: 1 }, dades);
  a.ordre({ tipus: 'obre' });
  a.respon('c1', { xabcde: [] });
  a.ordre({ tipus: 'nova', config: { titol: 'Gravació 2', nivell: 3, lloc, llavor: 2 } });
  assert.equal(a.estat, 'preparada');
  assert.equal(a.ronda, 2);
  assert.equal(a.respostes.size, 0);
  assert.equal(a.vistaAlumne('c1').resposta, null);
});

test('aprenentatge només carta: el nombre de recursos de cada tipus decideix la puntuació', () => {
  const a = new Aula({ tipus: 'carta', carta: 'ACCIDENT ENTRE UN AUTOCAR I UN TURISME, DIVERSOS FERITS', lloc, recursos: { mode: 'nombre', SVA: 2, SVB: 3, HEMS: 0 }, llavor: 3 }, dades);
  assert.equal(a.vistaAlumne('c1').carta, 'ACCIDENT ENTRE UN AUTOCAR I UN TURISME, DIVERSOS FERITS');
  assert.deepEqual(a.correcte().composicio, { SVA: 2, SVB: 3, HEMS: 0 });
  assert.ok(a.unitats.filter(u => u.cat === 'SVB').length >= 6, 'surten prou unitats per triar-ne moltes');
  a.ordre({ tipus: 'obre' });
  // No level or assessment needed: only the units
  assert.equal(a.respon('bo', { nom: 'Bo', recursos: a.correctes }), null);
  const unaDeCada = [a.correctes.find(id => a.unitats.find(u => u.indicatiu === id).cat === 'SVA'), a.correctes.find(id => a.unitats.find(u => u.indicatiu === id).cat === 'SVB')];
  a.respon('poc', { nom: 'Poc', recursos: unaDeCada });
  a.respon('res', { nom: 'Res', recursos: [] });
  const punts = nom => a.puntua([...a.respostes.values()].find(r => r.nom === nom)).punts;
  // Short of a kind (infradotat) gets no points for the units
  assert.deepEqual([punts('Bo'), punts('Poc'), punts('Res')], [3, 0, 0]);
  const t = a.vistaTutor();
  assert.deepEqual(t.distribucio.envien, { si: 2, no: 1 });
  assert.equal(t.distribucio.composicio['2 SVA + 3 SVB'], 1);
  assert.equal(t.correcte.text, '2 SVA + 3 SVB');
});

test('aprenentatge flexible: el tutor tria les pantalles i només puntuen les que hi ha', () => {
  const a = new Aula({ tipus: 'carta', fases: { nivell: true, recursos: true }, nivell: 2, lloc, llavor: 1 }, dades);
  a.ordre({ tipus: 'obre' });
  assert.equal(a.respon('c1', { nivell: 2 }), null, 'sense pantalles de XABCDE no cal valorar abans del nivell');
  assert.equal(a.respon('c1', { recursos: a.correctes }), null);
  const p = a.puntua(a.respostes.get('c1'));
  assert.deepEqual([p.punts, p.maxim], [6, 6]);
  // Only what was heard, and the activation bar as the units answer
  const b = new Aula({ fases: { escolta: true, preguntes: false, instruccio: false, nivell: false, recursos: false, activacio: true }, nivell: 1, lloc, xabcde, llavor: 1 }, dades);
  b.ordre({ tipus: 'obre' });
  b.respon('c1', { activa: b.correctes });
  b.respon('c1', { xabcde: b.config.xabcde.flatMap(l => l.items).filter(it => it.correcte).map(it => it.id) });
  assert.equal(b.respostes.get('c1').fet, true);
  const q = b.puntua(b.respostes.get('c1'));
  assert.deepEqual([q.escolta, q.preguntes, q.recursos, q.deteccio, q.punts, q.maxim], [1, 0, 3, 1, 5, 5]);
});

test('aprenentatge flexible: el tutor tria quines unitats surten, quines estan ocupades i quines són correctes', () => {
  const unitats = [{ indicatiu: 'HELI-SABADELL', estat: 'lliure' }, { indicatiu: 'C205', estat: 'ocupada' }, { indicatiu: 'C450', estat: 'lliure' }];
  const a = new Aula({ tipus: 'carta', lloc, unitats, recursos: { mode: 'manual' }, correctes: ['HELI-SABADELL', 'C205'], llavor: 1 }, dades);
  assert.deepEqual(a.unitats.map(u => u.indicatiu).sort(), ['C205', 'C450', 'HELI-SABADELL']);
  assert.equal(a.unitats.find(u => u.indicatiu === 'C205').ocupada, true);
  assert.deepEqual(a.correctes, ['HELI-SABADELL'], 'una unitat ocupada no pot ser la resposta');
  assert.equal(a.correcte().text, '1 Helicòpter');
});

test('escenari en equip: duplicitats, prioritat i recursos escassos, decidits per majoria', () => {
  const prop = { municipi: 'Manresa', zona: 'Catalunya Central', lat: 41.7251, lon: 1.8266 };
  const a = new Aula({ tipus: 'escenari', titol: 'Tarda a la Bages', lloc, equips: 2, llavor: 5, incidents: [
    { id: 'i1', carta: 'ACCIDENT DE MOTO A LA C-55, NO RESPON', lloc: prop, nivell: 1, prioritat: 1 },
    { id: 'i2', carta: 'UN CONDUCTOR AVISA D\'UN MOTORISTA A TERRA A LA C-55', lloc: prop, nivell: 1, duplicatDe: 'i1' },
    { id: 'i3', carta: 'GENT GRAN CAIGUDA A CASA, CONSCIENT', lloc: prop, nivell: 3, prioritat: 2 },
  ] }, dades);
  const heli = a.esc.unitats.find(u => u.cat === 'HEMS').indicatiu, sva = a.esc.unitats.find(u => u.cat === 'SVA' && !u.ocupada).indicatiu;
  const svb = a.esc.unitats.find(u => u.cat === 'SVB' && !u.ocupada).indicatiu;
  a.esc.incidents[0].correctes = [heli, sva];
  a.esc.incidents[2].correctes = [svb];
  // Teams last across cases; the phones never see the right answers
  for (const [c, nom, equip] of [['c1', 'Anna', 'Vermell'], ['c2', 'Pau', 'Vermell'], ['c3', 'Marc', 'Blau']]) assert.equal(a.respon(c, { nom, equip }), null);
  assert.match(a.respon('c1', { accio: { tipus: 'ordre', ordre: ['i1', 'i3', 'i2'] } }), /no estan obertes/);
  assert.ok(!JSON.stringify(a.vistaAlumne('c1')).includes('duplicatDe'));
  a.ordre({ tipus: 'obre' });
  const fa = (c, accio) => assert.equal(a.respon(c, { accio }), null);
  fa('c1', { tipus: 'duplicat', incident: 'i2', de: 'i1' });
  fa('c2', { tipus: 'ordre', ordre: ['i1', 'i3', 'i2'] });
  fa('c1', { tipus: 'assigna', unitat: heli, incident: 'i1' });
  fa('c2', { tipus: 'assigna', unitat: sva, incident: 'i1' });
  fa('c2', { tipus: 'assigna', unitat: svb, incident: 'i3' });
  fa('c1', { tipus: 'acord', si: true });
  assert.equal(a.esc.equip('Vermell').confirmat, null, 'cal la majoria de l\'equip');
  fa('c2', { tipus: 'acord', si: true });
  assert.notEqual(a.esc.equip('Vermell').confirmat, null);
  assert.match(a.respon('c1', { accio: { tipus: 'assigna', unitat: svb, incident: null } }), /ja ha confirmat/);
  // Blau misses the duplicate and sends the advanced unit to both calls of the same accident
  fa('c3', { tipus: 'assigna', unitat: sva, incident: 'i2' });
  fa('c3', { tipus: 'assigna', unitat: heli, incident: 'i1' });
  fa('c3', { tipus: 'acord', si: true });
  a.ordre({ tipus: 'resultats' });
  const [vermell, blau] = a.vistaTutor().classificacio;
  assert.equal(vermell.nom, 'Equip Vermell');
  assert.equal(vermell.punts, vermell.maxim);
  assert.ok(blau.errors.some(e => /Duplicitat de servei/.test(e)) && blau.errors.some(e => /duplicat/.test(e)));
  assert.equal(a.vistaAlumne('c3').decisio.puntuacio.punts, blau.punts);
  // A new case keeps the teams
  a.ordre({ tipus: 'nova', config: { tipus: 'carta', lloc, llavor: 2 } });
  a.ordre({ tipus: 'nova', config: { tipus: 'escenari', lloc, equips: 2, incidents: [{ carta: 'X', lloc: prop }] } });
  assert.equal(a.vistaAlumne('c3').equip, 'Blau');
});

test('aprenentatge: l\'interrogatori comença pel primer contacte (consciència i respiració)', () => {
  const a = new Aula({ lloc, llavor: 1 }, dades);
  const [primer] = a.config.xabcde;
  assert.equal(primer.lletra, '1r');
  assert.ok(primer.items.some(it => it.seccio === 'anamnesi' && /conscient/i.test(it.text)));
  assert.ok(primer.items.some(it => it.seccio === 'anamnesi' && /respira/i.test(it.text)));
  const ids = a.config.xabcde.flatMap(l => l.items.map(it => it.id));
  assert.equal(new Set(ids).size, ids.length, 'cada element té un identificador únic');
});

test('aprenentatge: el triangle pediàtric és opcional i un bloc no inclòs no arriba als alumnes', () => {
  const tep = XABCDE.find(l => l.lletra === 'TEP');
  assert.ok(tep?.opcional && tep.anamnesi.length && tep.signes.some(x => /Triangle normal/.test(x)));
  assert.ok(!new Aula({ lloc, llavor: 1 }, dades).config.xabcde.some(l => l.lletra === 'TEP'), 'per defecte, sense triangle');
  const amb = XABCDE.map(l => ({ lletra: l.lletra, nom: l.nom, ...(l.lletra === 'X' ? { ocult: true } : {}),
    items: SECCIONS.flatMap(sec => l[sec.id].map(text => ({ seccio: sec.id, text }))) }));
  const lletres = new Aula({ lloc, xabcde: amb, llavor: 1 }, dades).config.xabcde.map(l => l.lletra);
  assert.deepEqual(lletres, ['1r', 'TEP', 'A', 'B', 'C', 'D', 'E']);
});

test('recursos amb interval: dins de l\'interval, infradotat o sobredotat', () => {
  const a = new Aula({ tipus: 'carta', lloc, recursos: { mode: 'interval', SVA: [1, 2], SVB: [2, 4], HEMS: [0, 1] }, llavor: 3 }, dades);
  assert.equal(a.correcte().text, '1–2 SVA + 2–4 SVB + 0–1 Helicòpter');
  assert.equal(textInterval({ SVA: [2, 2], SVB: [0, 0], HEMS: [0, 0] }), '2 SVA');
  const de = (cat, n) => a.unitats.filter(u => !u.ocupada && u.cat === cat).slice(0, n).map(u => u.indicatiu);
  assert.equal(a.valoraUnitats([...de('SVA', 1), ...de('SVB', 3)]).punts, 3, 'dins i les més properes');
  assert.equal(a.valoraUnitats([...de('SVA', 2), ...de('SVB', 2), ...de('HEMS', 1)]).punts, 3);
  assert.equal(de('SVB', 5).length, 5, 'hi ha prou SVB lliures per passar-se');
  const massa = a.valoraUnitats([...de('SVA', 1), ...de('SVB', 5)]);
  assert.equal(massa.punts, 1);
  assert.ok(massa.avisos.some(x => /Sobredotat/.test(x)));
  const poc = a.valoraUnitats(de('SVB', 3));
  assert.equal(poc.punts, 0);
  assert.ok(poc.avisos.some(x => /Infradotat.*SVA/.test(x)));
});

test('instruccions graduades i diverses: indicada, acceptable, perillosa', () => {
  const items = [{ seccio: 'maniobres', text: 'Pressió directa', valor: 'indicada' }, { seccio: 'maniobres', text: 'Torniquet', valor: 'acceptable' },
    { seccio: 'maniobres', text: 'Treure l\'objecte clavat', valor: 'perillosa' }, { seccio: 'maniobres', text: 'Posició incorporada' }];
  const a = new Aula({ fases: { escolta: false, preguntes: false, instruccio: true, nivell: false, recursos: false, activacio: false }, instruccions: 2,
    lloc, xabcde: [{ lletra: 'X', nom: 'Hemorràgia', items }], llavor: 1 }, dades);
  const id = text => a.config.xabcde[0].items.find(it => it.text === text).id;
  a.ordre({ tipus: 'obre' });
  const punts = (c, triades) => { a.respon(c, { xabcde: triades.map(id) }); return a.puntua(a.respostes.get(c)); };
  assert.equal(punts('c1', ['Pressió directa', 'Torniquet']).instruccio, 2, 'com a màxim, els punts de les indicades');
  assert.equal(punts('c2', ['Torniquet']).instruccio, 1);
  const perill = punts('c3', ['Pressió directa', 'Treure l\'objecte clavat']);
  assert.equal(perill.instruccio, 1);
  assert.ok(perill.avisos.some(x => /perillosa/.test(x)));
  assert.equal(punts('c4', ['Posició incorporada']).instruccio, 0);
  assert.equal(a.respostes.get('c1').xabcde.length, 2, 'fins a 2 instruccions');
});

test('diversos nivells correctes', () => {
  const a = new Aula({ tipus: 'carta', fases: { nivell: true, recursos: true }, nivells: [1, 2], lloc, llavor: 1 }, dades);
  a.ordre({ tipus: 'obre' });
  for (const [c, n, esperat] of [['c1', 1, 3], ['c2', 2, 3], ['c3', 3, 1], ['c4', 5, 0]]) {
    a.respon(c, { nivell: n });
    assert.equal(a.puntua(a.respostes.get(c)).nivell, esperat, `N${n}`);
  }
});

test('aprenentatge: el tutor passa les diapositives dels resultats al projector', async () => {
  const { diapositives } = await import('../app/aula-resultats.mjs');
  const a = new Aula({ titol: 'Prova', nivell: 1, lloc, xabcde, llavor: 1, explicacio: 'Cal RCP' }, dades);
  assert.equal(a.ordre({ tipus: 'pagina', pagina: 2 }), 'Ordre no disponible ara');
  a.ordre({ tipus: 'obre' });
  a.respon('c1', { nom: 'Anna', xabcde: [] });
  a.respon('c1', { nivell: 1 });
  a.respon('c1', { recursos: a.correctes });
  a.ordre({ tipus: 'resultats' });
  assert.equal(a.vistaTutor().pagina, 0);
  a.ordre({ tipus: 'pagina', pagina: 3 });
  assert.equal(a.vistaTutor().pagina, 3);
  a.ordre({ tipus: 'pagina', pagina: -1 });
  assert.equal(a.vistaTutor().pagina, -1);
  const llista = diapositives(a.vistaTutor());
  assert.equal(llista[0].titol, '✓ La resposta');
  assert.match(llista[0].html, /Cal RCP/);
  assert.equal(llista.at(-1).titol, '🏆 Classificació');
  assert.match(llista.at(-1).html, /Anna/);
  a.ordre({ tipus: 'nova', config: { titol: 'Altre', nivell: 2, lloc, xabcde, llavor: 2 } });
  assert.equal(a.vistaTutor().pagina, 0);
});
