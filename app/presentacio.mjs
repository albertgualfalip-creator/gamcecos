// Guided presentation to explain the game to the class before playing: one step per part of the game, with the real
// student phone showing an example of that screen (/aula?demo=<screen>). Arrow keys or buttons to move.
import { $, esc } from './client.mjs';

const PASSOS = [
  { titol: 'Sou consultors de la CECOS', mobil: 'entrada', text: [
    'Arribarà una alerta: una trucada gravada o una carta de dades del 112.',
    'Com a la sala: escolteu, valoreu, decidiu el nivell i activeu els recursos.',
    'Cadascú respon al seu mòbil. Al final veurem què ha fet la classe i què calia fer.'] },
  { titol: 'Entreu amb el mòbil', mobil: 'entrada', text: [
    'Escanegeu el QR del projector (o entreu a la web i poseu el codi).',
    'Poseu el vostre nom o un àlies: sortirà a la classificació.',
    'Ho feu una sola vegada: els casos següents us arriben sols.'] },
  { titol: 'Esperem el cas', mobil: 'espera', text: [
    'Quan el tutor posa el cas, veieu el títol i la carta del 112.',
    'Si és una gravació, sonarà quan s\'obrin les respostes: escolteu-la bé.'] },
  { titol: '👂 Què heu escoltat?', mobil: 'escolta', text: [
    'Per blocs: primer contacte (consciència i respiració) i després X, A, B, C, D, E.',
    'Marqueu el que hàgiu sentit. Si la gravació no en diu res, «No avaluable».',
    'Compte: marcar coses que no hi són resta punts.'] },
  { titol: '❓ Quines preguntes faríeu?', mobil: 'preguntes', text: [
    'En una trucada no hi ha temps per preguntar-ho tot: només en podeu triar unes poques.',
    'Trieu les preguntes clau, les que canvien la decisió.'] },
  { titol: '🖐 La primera instrucció', mobil: 'instruccio', text: [
    'Què li dieu a l\'alertant primer? Només una: la més urgent.',
    'Si no cal cap maniobra, «Cap: només vigilar».'] },
  { titol: '🚑 Activar recurs en qualsevol moment', mobil: 'activa', text: [
    'El botó vermell de baix hi és sempre: quan veieu que és greu, activeu sense esperar a acabar.',
    'Es registra el segon en què activeu: si calia recurs i ho feu abans d\'acabar la valoració, punt extra.'] },
  { titol: 'El nivell', mobil: 'nivell', text: ['Poseu el nivell de triatge, de N1 (el més greu) a N5.'] },
  { titol: 'Les unitats', mobil: 'recursos', text: [
    'Cada unitat porta el tipus (SVA, SVB, Helicòpter) i el temps d\'arribada. Les grises estan ocupades.',
    'Toqueu les que vulgueu i premeu el botó de baix: queda fet.',
    'Si ja les havíeu activat amb el botó vermell, no cal tornar-ho a fer.'] },
  { titol: '⏱ El temps', mobil: 'enviat', text: [
    'A dalt del mòbil teniu el temps que queda.',
    'Quan acabeu, espereu: el tutor mostrarà els resultats per a tothom.'] },
  { titol: 'Els resultats', mobil: 'resultats', text: [
    '✓ el que heu encertat, ✗ el que sobrava, ○ el que faltava.',
    'Veureu el nivell i les unitats que calien, i els vostres punts.',
    'Al projector, què ha respost tota la classe: és el moment de comentar-ho.'] },
  { titol: '📄 Casos només amb la carta del 112', mobil: 'carta', text: [
    'Sense veu: només les dades del 112, amb el soroll de la sala de fons.',
    'Decidiu si hi envieu recurs i quantes unitats de cada tipus: en un accident potser en calen diverses.'] },
  { titol: '👥 Escenaris en equip', mobil: 'equip', text: [
    'Diversos incidents alhora i poques unitats per a tots.',
    'Per equips, en un tauler compartit: quines trucades són el mateix incident (duplicats), quin va primer i quina unitat va a cada lloc.',
    'Quan la majoria de l\'equip hi està d\'acord, la decisió queda confirmada.'] },
  { titol: 'Som-hi!', mobil: 'entrada', final: true, text: ['Entreu ara amb el mòbil: comencem amb el primer cas.'] },
];

const codi = (new URLSearchParams(location.search).get('codi') || '').toUpperCase();
let pas = 0, qrFet = false;

function mostra(i) {
  pas = Math.max(0, Math.min(PASSOS.length - 1, i));
  const p = PASSOS[pas];
  $('numero').textContent = `${pas + 1} / ${PASSOS.length}`;
  $('titol').textContent = p.titol;
  $('explica').innerHTML = `<ul>${p.text.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
  $('mobil').src = `/aula?demo=${p.mobil}`;
  $('punts').innerHTML = PASSOS.map((_, k) => `<button class="${k === pas ? 'actiu' : ''}" data-pas="${k}" title="${esc(PASSOS[k].titol)}"></button>`).join('');
  $('punts').querySelectorAll('[data-pas]').forEach(b => b.onclick = () => mostra(Number(b.dataset.pas)));
  $('enrere').disabled = pas === 0;
  $('seguent').disabled = pas === PASSOS.length - 1;
  // Last step: the code of the class to join, if the presentation was opened from it
  $('qr-final').hidden = !(p.final && codi);
  if (p.final && codi && !qrFet) {
    qrFet = true;
    $('url').textContent = `${location.host}/aula`;
    $('codi').textContent = codi;
    if (window.QRCode) new QRCode($('qr'), { text: `${location.origin}/aula?codi=${codi}`, width: 200, height: 200 });
  }
}

$('enrere').onclick = () => mostra(pas - 1);
$('seguent').onclick = () => mostra(pas + 1);
function tecla(clau, e) {
  if (['ArrowRight', 'PageDown', ' '].includes(clau)) { e?.preventDefault(); mostra(pas + 1); }
  if (['ArrowLeft', 'PageUp'].includes(clau)) { e?.preventDefault(); mostra(pas - 1); }
}
document.addEventListener('keydown', e => tecla(e.key, e));
// Keys pressed while the example phone has the focus
window.addEventListener('message', e => { if (e.origin === location.origin && e.data?.tecla) tecla(e.data.tecla); });
mostra(0);
