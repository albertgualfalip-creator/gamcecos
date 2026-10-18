import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  enServei, tempsArribada, avaluaCombo, avaluaUnitats, avaluaRetrucada, avaluaNivell, avaluaDecisio, comboDe, entornDe, perVariant,
} from '../app/motor.mjs';

const casos = JSON.parse(readFileSync(new URL('../casos/index.json', import.meta.url)))
  .map(id => JSON.parse(readFileSync(new URL(`../casos/${id}.json`, import.meta.url))));

test('horaris: torns de 24 h, diürns, nocturns i fins a l\'ocàs', () => {
  assert.equal(enServei('08:00 - 07:59', 3), true);
  assert.equal(enServei(null, 3), true);
  assert.equal(enServei('07:00 - 22:59', 23.5), false);
  assert.equal(enServei('07:00 - 22:59', 12), true);
  assert.equal(enServei('19:00 - 07:00', 2), true);
  assert.equal(enServei('19:00 - 07:00', 12), false);
  assert.equal(enServei('09:00 - ocàs', 20, 0), false);
  assert.equal(enServei('09:00 - ocàs', 20, 6), true);
});

test('temps d\'arribada creix amb la distància i l\'helicòpter és més ràpid a llarga distància', () => {
  const a = { lat: 41.39, lon: 2.17 };
  const prop = tempsArribada('SVB', { lat: 41.40, lon: 2.17 }, a, 'urba');
  const lluny = tempsArribada('SVB', { lat: 41.70, lon: 2.17 }, a, 'rural');
  assert.ok(prop < lluny);
  assert.ok(tempsArribada('HELI', { lat: 42.4, lon: 1.0 }, a, 'rural') < tempsArribada('SVAm', { lat: 42.4, lon: 1.0 }, a, 'rural'));
});

test('resposta AURE per nivell i HEMS quan la SVA tarda més de 20 min fora d\'entorn urbà', () => {
  assert.equal(avaluaCombo('sva_svb', 1, 'urba', 8).valoracio, 'optima');
  assert.equal(avaluaCombo('svb', 1, 'urba', 8).valoracio, 'perillosa');
  assert.equal(avaluaCombo('sva_svb', 3, 'urba', 8).valoracio, 'suboptima');
  assert.equal(avaluaCombo('cap', 4, 'urba', 8).valoracio, 'optima');
  assert.equal(avaluaCombo('sva_svb_hems', 1, 'rural', 35).valoracio, 'optima');
  assert.equal(avaluaCombo('sva_svb', 1, 'rural', 35).valoracio, 'acceptable');
  assert.equal(avaluaCombo('sva_svb_hems', 1, 'urba', 35).valoracio, 'suboptima');
});

test('unitats: penalitza triar una unitat molt més lluny que la més ràpida disponible', () => {
  const disp = [{ indicatiu: 'A', tipus: 'SVB', eta: 5 }, { indicatiu: 'B', tipus: 'SVB', eta: 15 }];
  assert.equal(avaluaUnitats([disp[0]], disp).valoracio, 'optima');
  assert.equal(avaluaUnitats([disp[1]], disp).valoracio, 'suboptima');
  assert.equal(comboDe([{ tipus: 'VIR' }, { tipus: 'SVB' }]), 'sva_svb');
  assert.equal(comboDe([]), 'cap');
});

test('entorn: Tarragona ciutat i zones pendents', () => {
  const ez = { 'Tarragona ciutat': 'suburba', 'Barcelona ciutat': 'urba', Girona: null };
  assert.deepEqual(entornDe('Camp de Tarragona', 'Tarragona', ez), { entorn: 'suburba', pendent: false });
  assert.deepEqual(entornDe('Girona', 'Girona', ez), { entorn: 'suburba', pendent: true });
});

test('tots els casos són coherents: cada variant té valoració i resposta a cada pas', () => {
  const valides = new Set(['optima', 'acceptable', 'suboptima', 'perillosa']);
  for (const cas of casos) {
    for (const v of cas.variants) {
      assert.ok(v.nivell >= 1 && v.nivell <= 5, `${cas.id}: nivell`);
      for (const pas of cas.passos) {
        if (pas.tipus === 'decisio') for (const o of pas.opcions) {
          assert.ok(valides.has(avaluaDecisio(pas, o.id, v.id).valoracio), `${cas.id}/${pas.id}/${o.id}/${v.id}`);
          assert.ok(avaluaDecisio(pas, o.id, v.id).feedback, `${cas.id}/${pas.id}/${o.id}/${v.id} feedback`);
        }
        if (pas.tipus === 'nivell') for (const n of [1, 2, 3, 4, 5]) {
          assert.ok(valides.has(avaluaNivell(pas, n, v.id).valoracio), `${cas.id}/nivell ${n}/${v.id}`);
          assert.equal(avaluaNivell(pas, v.nivell, v.id).valoracio, 'optima', `${cas.id}: el nivell real ha de ser òptim`);
        }
        if (pas.tipus === 'retrucada') {
          assert.ok(pas.preguntes.some(q => q.clau), `${cas.id}: cal alguna pregunta clau`);
          for (const q of pas.preguntes) assert.ok(perVariant(q.resposta, v.id), `${cas.id}/${q.id}/${v.id} resposta`);
          assert.equal(avaluaRetrucada(pas, pas.preguntes.filter(q => q.clau).map(q => q.id)).valoracio, 'optima');
        }
      }
    }
  }
});
