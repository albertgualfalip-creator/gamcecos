import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Guardia } from '../joc.mjs';

const d = f => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url)));
const dades = { unitats: d('data/unitats.json'), centres: d('data/centres.json'), dea: d('data/dea.json'), aure: d('data/resposta_aure.json'),
  casos: d('casos/index.json').map(id => d(`casos/${id}.json`)) };

function juga(casId, triaOpcio) {
  const g = new Guardia({ zones: ['Metro Nord'], incidents: 0, factor: 3 }, dades, 7);
  g.ordre({ tipus: 'inicia' });
  const inc = g.nouIncident({ casId, manual: true });
  const decideix = rol => { for (const p of g.pendents(inc, rol)) assert.equal(g.accio(rol, { tipus: 'decideix', incident: inc.id, pas: p.pas, opcio: triaOpcio(p) }), null); };
  decideix('uct');
  if (inc.variant.nivell <= 3) assert.equal(g.accio('uct', { tipus: 'assigna', incident: inc.id, unitat: g.candidates(inc)[0].indicatiu }), null);
  const consulta = g.vista('consultor').cua.find(t => t.tipus === 'consulta');
  assert.equal(g.accio('consultor', { tipus: 'despenja', trucada: consulta.id }), null);
  for (const q of g.vista('consultor').activa.preguntes) g.accio('consultor', { tipus: 'pregunta', pregunta: q.id });
  assert.match(g.accio('consultor', { tipus: 'penja' }) || '', /Abans de penjar/);
  decideix('consultor');
  assert.equal(g.accio('consultor', { tipus: 'penja' }), null);
  decideix('uct');
  for (let i = 0; i < 400 && inc.estat !== 'tancat'; i++) {
    g.tic(1);
    const tr = g.vista('consultor').cua.find(t => t.tipus === 'unitat');
    if (tr) {
      g.accio('consultor', { tipus: 'despenja', trucada: tr.id });
      decideix('consultor');
      g.accio('consultor', { tipus: 'penja' });
    }
    const reit = g.vista('consultor').cua.find(t => t.tipus === 'reiteracio');
    if (reit && !g.trucadaActiva()) { g.accio('consultor', { tipus: 'despenja', trucada: reit.id }); g.accio('consultor', { tipus: 'reiteracio', opcio: 'informa' }); }
  }
  if (inc.estat !== 'tancat') assert.equal(g.accio('uct', { tipus: 'finalitza', incident: inc.id }), null);
  return { g, inc };
}

test('guàrdia completa: cada cas es pot jugar fins al desenllaç', () => {
  for (const cas of dades.casos) {
    const { inc } = juga(cas.id, p => p.opcions[0].id);
    assert.equal(inc.estat, 'tancat', cas.id);
    assert.ok(['bo', 'dolent'].includes(inc.desenllac), cas.id);
    assert.ok(inc.resultats.some(r => r.pas === 'Retrucada') && inc.resultats.some(r => r.pas === 'Recursos'), cas.id);
  }
});

test('les vistes no ensenyen la realitat del cas a l\'equip', () => {
  const { g } = juga('inconscient-veina', p => p.opcions[0].id);
  const text = JSON.stringify([g.vista('uct').incidents.map(i => ({ ...i, desenllac: null })), g.vista('consultor').cua]);
  assert.ok(!text.includes('gasping') && !text.includes('hipoglucemia'));
  assert.ok(JSON.stringify(g.vista('tutor')).includes('nivellReal'));
});

test('una trucada que sona massa estona s\'abandona i penalitza', () => {
  const g = new Guardia({ zones: ['Girona'], incidents: 0 }, dades, 3);
  g.ordre({ tipus: 'inicia' });
  const inc = g.nouIncident({ casId: 'caiguda-anticoagulat', manual: true });
  for (let i = 0; i < 130; i++) g.tic(1);
  assert.ok(inc.resultats.some(r => r.pas === 'Trucada abandonada'));
});

test('una reiteració pendent no impedeix tancar l\'incident', () => {
  const g = new Guardia({ zones: ['Metro Sud'], incidents: 0 }, dades, 11);
  g.ordre({ tipus: 'inicia' });
  const inc = g.nouIncident({ casId: 'inconscient-veina', manual: true });
  g.novaTrucada(inc, 'reiteracio', 'prova');
  inc.trucadaFeta = true;
  inc.decisions.activacio = inc.decisions.trasllat = { opcio: 'x' };
  g.comprovaTancament(inc);
  assert.equal(inc.estat, 'tancat');
  assert.ok(!g.trucades.some(t => t.incident === inc.id && t.estat === 'sona'));
});

test('cobertura: descobrir una zona la fa baixar i un moviment la torna a pujar', () => {
  const g = new Guardia({ zones: ['Barcelona ciutat'], incidents: 0, factor: 6 }, dades, 5);
  g.ordre({ tipus: 'inicia' });
  const inicial = g.cobertura()[0].pct;
  g.ordre({ tipus: 'descobreix', zona: 'Barcelona ciutat' });
  const descoberta = g.cobertura()[0].pct;
  assert.ok(descoberta < inicial);
  const desti = g.bases[0];
  const u = g.unitats.filter(x => x.estat === 'disponible' && x.tipus === 'SVAm' && !g.zones.includes(x.subzona || x.regio))
    .sort((a, b) => Math.hypot(a.lat - desti.lat, a.lon - desti.lon) - Math.hypot(b.lat - desti.lat, b.lon - desti.lon))[0];
  assert.equal(g.mou('uct', { unitat: u.indicatiu, desti: g.bases[0].nom }), null);
  for (let i = 0; i < 600 && u.moviment; i++) g.tic(1);
  assert.equal(u.moviment, null);
  assert.equal(u.ubicacio, g.bases[0].nom);
  g.ordre({ tipus: 'final' });
  assert.ok(g.resultatsGlobals.some(r => r.pas === 'Cobertura territorial' && r.rol === 'uct'));
});

test('una unitat activada en un incident no surt al següent fins que es desactiva', () => {
  const g = new Guardia({ zones: ['Barcelona ciutat'], incidents: 0 }, dades, 21);
  g.ordre({ tipus: 'inicia' });
  const a = g.nouIncident({ casId: 'inconscient-veina', manual: true });
  const b = g.nouIncident({ casId: 'consum-toxics', manual: true });
  const u = g.candidates(a)[0].indicatiu;
  assert.equal(g.accio('uct', { tipus: 'assigna', incident: a.id, unitat: u }), null);
  assert.ok(!g.candidates(b).some(c => c.indicatiu === u));
  assert.match(g.accio('uct', { tipus: 'assigna', incident: b.id, unitat: u }), /desactiveu-la/);
  assert.equal(g.accio('uct', { tipus: 'allibera', incident: a.id, unitat: u }), null);
  assert.equal(g.accio('uct', { tipus: 'assigna', incident: b.id, unitat: u }), null);
});
