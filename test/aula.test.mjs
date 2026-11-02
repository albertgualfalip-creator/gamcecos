import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Aula } from '../aula.mjs';
import { CATEGORIA, XABCDE } from '../app/motor.mjs';

const d = f => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url)));
const dades = { unitats: d('data/unitats.json'), aure: d('data/resposta_aure.json') };
const lloc = { municipi: 'Manresa', zona: 'Catalunya Central', lat: 41.7251, lon: 1.8266 };
const xabcde = XABCDE.map((l, i) => ({ ...l, correcta: i === 2 ? 2 : 0 }));   // B: no respira

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
  const bones = Object.fromEntries(xabcde.map(l => [l.lletra, l.correcta]));
  assert.equal(a.respon('c1', { nom: 'Anna', xabcde: bones }), null);
  assert.equal(a.respon('c1', { nivell: 1 }), null);
  assert.equal(a.respon('c1', { recursos: a.correctes }), null);
  assert.match(a.respon('c1', { recursos: [] }), /Ja has enviat/);
  a.respon('c2', { nom: 'Pau', xabcde: { ...bones, B: 0 } });
  a.respon('c2', { nivell: 3 });
  a.respon('c2', { recursos: [] });
  // Before the results the phones never see the right answers
  const abans = a.vistaAlumne('c2');
  assert.ok(!('correcte' in abans) && abans.xabcde.every(l => !('correcta' in l)));
  a.ordre({ tipus: 'resultats' });
  const [primer, segon] = a.vistaTutor().classificacio;
  assert.deepEqual([primer.nom, primer.punts, primer.maxim], ['Anna', 12, 12]);
  assert.deepEqual([segon.nom, segon.xabcde, segon.nivell, segon.recursos], ['Pau', 5, 0, 0]);
  assert.equal(a.vistaAlumne('c1').puntuacio.punts, 12);
  assert.equal(a.vistaTutor().distribucio.nivell[1], 1);
});

test('aprenentatge: una gravació nova esborra les respostes i torna a preparar', () => {
  const a = new Aula({ nivell: 2, lloc, llavor: 1 }, dades);
  a.ordre({ tipus: 'obre' });
  a.respon('c1', { xabcde: { X: 0 } });
  a.ordre({ tipus: 'nova', config: { titol: 'Gravació 2', nivell: 3, lloc, llavor: 2 } });
  assert.equal(a.estat, 'preparada');
  assert.equal(a.ronda, 2);
  assert.equal(a.respostes.size, 0);
  assert.equal(a.vistaAlumne('c1').resposta, null);
});
