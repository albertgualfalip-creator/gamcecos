import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Aula } from '../aula.mjs';
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

test('aprenentatge: els alumnes responen per passos i la puntuació compara amb la resposta', () => {
  const a = new Aula({ titol: 'Prova', nivell: 1, lloc, xabcde, llavor: 1 }, dades);
  assert.match(a.respon('c1', { nom: 'Anna', xabcde: {} }), /no estan obertes/);
  a.ordre({ tipus: 'obre' });
  assert.match(a.respon('c1', { nivell: 1 }), /Primer marca/);
  const items = a.config.xabcde.flatMap(l => l.items);
  const bones = items.filter(it => it.correcte).map(it => it.id);
  assert.equal(bones.length, 3);
  assert.equal(a.respon('c1', { nom: 'Anna', xabcde: bones }), null);
  assert.equal(a.respon('c1', { nivell: 1 }), null);
  assert.equal(a.respon('c1', { recursos: a.correctes }), null);
  assert.match(a.respon('c1', { recursos: [] }), /Ja has enviat/);
  // Pau finds the gasping but also ticks two instructions that did not apply: 1 - 2 → 0
  const sobrants = items.filter(it => !it.correcte).slice(0, 2).map(it => it.id);
  a.respon('c2', { nom: 'Pau', xabcde: [bones[1], ...sobrants] });
  a.respon('c2', { nivell: 3 });
  a.respon('c2', { recursos: [] });
  // Before the results the phones never see the right answers
  const abans = a.vistaAlumne('c2');
  assert.ok(!('correcte' in abans) && abans.xabcde.every(l => l.items.every(it => !('correcte' in it))));
  a.ordre({ tipus: 'resultats' });
  const [primer, segon] = a.vistaTutor().classificacio;
  assert.deepEqual([primer.nom, primer.punts, primer.maxim], ['Anna', 9, 9]);
  assert.deepEqual([segon.nom, segon.xabcde, segon.nivell, segon.recursos], ['Pau', 0, 0, 0]);
  assert.equal(a.vistaAlumne('c1').puntuacio.punts, 9);
  assert.equal(a.vistaTutor().distribucio.xabcde[bones[1]], 2);
  assert.equal(a.vistaTutor().distribucio.nivell[1], 1);
});

test('aprenentatge: per defecte cada lletra té anamnesi, signes i maniobres, sense cap correcte', () => {
  const a = new Aula({ lloc, llavor: 1 }, dades);
  for (const l of a.config.xabcde) assert.deepEqual([...new Set(l.items.map(it => it.seccio))], ['anamnesi', 'signes', 'maniobres'], l.lletra);
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
