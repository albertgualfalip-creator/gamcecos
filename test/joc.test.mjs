import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Guardia } from '../joc.mjs';

const d = f => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url)));
const dades = { unitats: d('data/unitats.json'), centres: d('data/centres.json'), dea: d('data/dea.json'), aure: d('data/resposta_aure.json'),
  capacitats: d('data/capacitats_hospitals.json'),
  casos: d('casos/index.json').map(id => d(`casos/${id}.json`)) };

// Picks the hospital that fits a transfer option: the nearest one with the capability it asks for
function resolTrasllat(g, inc) {
  const acc = g.pas(inc, 'trasllat').opcions[0].accio;
  const resolucio = [acc.resolucio].flat()[0];
  if (resolucio !== 'trasllat') return { tipus: 'trasllat', resolucio };
  const h = g.vista('consultor').activa.trasllat.hospitals.find(x => x.capacitats.includes(acc.desti || 'tc'));
  return { tipus: 'trasllat', resolucio, mode: acc.mode || 'SVB', desti: h.nom };
}

function juga(casId, triaOpcio) {
  const g = new Guardia({ zones: ['Metro Nord'], incidents: 0, factor: 3 }, dades, 7);
  g.ordre({ tipus: 'inicia' });
  const inc = g.nouIncident({ casId, manual: true });
  const decideix = rol => { for (const p of g.pendents(inc, rol)) assert.equal(g.accio(rol, { tipus: 'decideix', incident: inc.id, pas: p.pas, opcio: triaOpcio(p) }), null); };
  assert.deepEqual(g.pendents(inc, 'uct'), [], 'la UCT no respon preguntes: actua');
  if (inc.variant.nivell <= 3) assert.equal(g.accio('uct', { tipus: 'assigna', incident: inc.id, unitat: g.candidates(inc)[0].indicatiu }), null);
  // The data card reaches the consultor's queue on its own
  for (let i = 0; i < 15 && !g.vista('consultor').cua.some(t => t.tipus === 'consulta'); i++) g.tic(1);
  const consulta = g.vista('consultor').cua.find(t => t.tipus === 'consulta');
  assert.equal(g.accio('consultor', { tipus: 'despenja', trucada: consulta.id }), null);
  for (const q of g.vista('consultor').activa.preguntes) g.accio('consultor', { tipus: 'pregunta', pregunta: q.id });
  assert.match(g.accio('consultor', { tipus: 'penja' }) || '', /poseu el nivell/);
  assert.equal(g.accio('consultor', { tipus: 'nivell', nivell: inc.variant.nivell }), null);
  decideix('consultor');
  assert.equal(g.accio('consultor', { tipus: 'penja' }), null);
  for (let i = 0; i < 400 && inc.estat !== 'tancat'; i++) {
    g.tic(1);
    const tr = g.vista('consultor').cua.find(t => t.tipus === 'unitat');
    if (tr) {
      g.accio('consultor', { tipus: 'despenja', trucada: tr.id });
      assert.equal(g.accio('consultor', resolTrasllat(g, inc)), null);
      g.accio('consultor', { tipus: 'penja' });
    }
    const reit = g.vista('consultor').cua.find(t => t.tipus === 'reiteracio');
    if (reit && !g.trucadaActiva()) { g.accio('consultor', { tipus: 'despenja', trucada: reit.id }); g.accio('consultor', { tipus: 'reiteracio', opcio: 'informa' }); }
  }
  if (inc.estat !== 'tancat') assert.equal(g.accio('uct', { tipus: 'finalitza', incident: inc.id }), null);
  return { g, inc };
}

// A shift with one incident of a case and a fixed variant, ready for the UCT to act
function prepara(casId, variant, zona = 'Barcelona ciutat') {
  const g = new Guardia({ zones: [zona], incidents: 0 }, dades, 13);
  g.ordre({ tipus: 'inicia' });
  const inc = g.nouIncident({ casId, manual: true });
  inc.variant = inc.cas.variants.find(v => v.id === variant);
  const millor = cat => g.candidates(inc).find(c => (cat === 'SVA' ? ['SVAm', 'SVAi', 'VIR'] : ['SVB']).includes(c.tipus)).indicatiu;
  return { g, inc, millor };
}
const resultat = (inc, titol) => inc.resultats.find(r => r.pas === titol);

test('guàrdia completa: cada cas es pot jugar fins al desenllaç', () => {
  for (const cas of dades.casos) {
    const { inc } = juga(cas.id, p => p.opcions[0].id);
    assert.equal(inc.estat, 'tancat', cas.id);
    assert.ok(['bo', 'dolent'].includes(inc.desenllac), cas.id);
    assert.ok(inc.resultats.some(r => r.pas === 'Retrucada') && inc.resultats.some(r => r.pas === 'Recursos'), cas.id);
    const ambUnitat = inc.historic.size > 0;   // without a unit on scene there is no transfer to decide
    for (const p of cas.passos.filter(x => x.tipus !== 'retrucada' && (ambUnitat || x.id !== 'trasllat'))) assert.ok(inc.decisions[p.id], `${cas.id}: ${p.id} sense valorar`);
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
  inc.decisions.activacio = inc.decisions.trasllat = inc.decisions.maniobres = { opcio: 'x' };
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

test('activació sense preguntes: es valora el que la UCT ha activat al primer minut', () => {
  const { g, inc, millor } = prepara('inconscient-veina', 'aturada');
  g.accio('uct', { tipus: 'assigna', incident: inc.id, unitat: millor('SVB') });
  g.accio('uct', { tipus: 'assigna', incident: inc.id, unitat: millor('SVA') });
  for (let i = 0; i < 61; i++) g.tic(1);
  const r = resultat(inc, 'Activació inicial');
  assert.equal(r.valoracio, 'optima');
  assert.match(r.equip, /SVA \+ SVB/);
});

test('3.20 SEM: SVB activada i SVA prealertada compten com a tal', () => {
  const { g, inc, millor } = prepara('inconscient-veina', 'hipoglucemia');
  const sva = millor('SVA');
  g.accio('uct', { tipus: 'assigna', incident: inc.id, unitat: millor('SVB') });
  assert.equal(g.accio('uct', { tipus: 'preavisa', incident: inc.id, unitat: sva }), null);
  assert.ok(g.candidates(inc).some(c => c.indicatiu === sva && c.preavis === inc.id), 'la SVA prealertada continua lliure');
  for (let i = 0; i < 61; i++) g.tic(1);
  assert.equal(inc.decisions.activacio.opcio, 'svb_320');
});

test('altres serveis: sense Mossos en un menor agressiu és perillós', () => {
  for (const [mossos, esperat] of [[false, 'perillosa'], [true, 'optima']]) {
    const { g, inc, millor } = prepara('menor-agressiu', 'agitacio_greu');
    g.accio('uct', { tipus: 'assigna', incident: inc.id, unitat: millor('SVB') });
    g.accio('uct', { tipus: 'assigna', incident: inc.id, unitat: millor('SVA') });
    if (mossos) assert.equal(g.accio('uct', { tipus: 'servei', incident: inc.id, servei: 'mossos' }), null);
    for (let i = 0; i < 61; i++) g.tic(1);
    assert.equal(resultat(inc, 'Activació inicial').valoracio, esperat);
  }
});

test('el nivell es pot canviar durant la trucada i es valora el final', () => {
  const { g, inc } = prepara('caiguda-anticoagulat', 'tce_aco');
  const consulta = g.vista('consultor').cua.find(t => t.tipus === 'consulta');
  g.accio('consultor', { tipus: 'despenja', trucada: consulta.id });
  g.accio('consultor', { tipus: 'nivell', nivell: 1 });
  g.accio('consultor', { tipus: 'nivell', nivell: 3 });
  assert.equal(g.vista('consultor').activa.nivell, 3);
  assert.equal(g.accio('consultor', { tipus: 'penja' }), null);
  assert.equal(resultat(inc, inc.cas.passos.find(p => p.tipus === 'nivell').titol).valoracio, 'optima');
});

test('trasllat: el destí ha de poder tractar el pacient', () => {
  const juga = (destiDe) => {
    const { g, inc, millor } = prepara('inconscient-veina', 'aturada');
    g.accio('uct', { tipus: 'assigna', incident: inc.id, unitat: millor('SVA') });
    inc.trucadaFeta = true;
    for (let i = 0; i < 400 && !g.vista('consultor').cua.some(t => t.tipus === 'unitat'); i++) g.tic(1);
    g.accio('consultor', { tipus: 'despenja', trucada: g.vista('consultor').cua.find(t => t.tipus === 'unitat').id });
    const hs = g.vista('consultor').activa.trasllat.hospitals;
    assert.equal(g.accio('consultor', { tipus: 'trasllat', resolucio: 'trasllat', mode: 'SVA', desti: destiDe(hs).nom }), null);
    return { r: resultat(inc, 'Trasllat') || inc.resultats.at(-1), g };
  };
  const bo = juga(hs => hs.find(h => h.capacitats.includes('hemodinamica')));
  assert.equal(bo.r.valoracio, 'optima');
  assert.match(bo.g.radio[0].text, /3\.51 TRASLLAT ASSISTIT A /);
  const dolent = juga(hs => hs.find(h => !h.capacitats.includes('hemodinamica')));
  assert.notEqual(dolent.r.valoracio, 'optima');
});

test('el públic vota també les decisions que es prenen amb accions', () => {
  const { g, inc } = prepara('inconscient-veina', 'aturada');
  g.actualitzaVotacio();
  assert.equal(g.votacio.id, `${inc.id}:activacio`);
  for (let i = 0; i < 61; i++) g.tic(1);
  assert.ok(g.tancades.some(t => t.id === `${inc.id}:activacio` && t.valoracions.immediata === 'optima'));
});
