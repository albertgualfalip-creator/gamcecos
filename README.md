# GamCECOS

Joc en equip per entrenar l'atenció no presencial i la gestió de recursos de les emergències sanitàries a Catalunya. Vegeu [docs/disseny.md](docs/disseny.md).

## Com jugar

```
npm start            # http://localhost:8080
```

La guàrdia la juguen dues posicions alhora, cadascuna des del seu ordinador:

- **Consultor** (`/consultor`): cua de trucades que sonen i s'abandonen si no es despengen, consulta sanitària en format conversa (cada pregunta, la seva resposta), fitxa de valoració amb els signes d'alarma, barra de nivell N1-N5 (es pot canviar fins a penjar), consell, reiteracions i, quan la unitat és al lloc, la resolució del servei: trasllat (assistit o no, i a quin hospital), alta in situ o rebuig.
- **UCT** (`/uct`, auxiliar i coordinació): safata d'incidents, activació i desactivació d'unitats al mapa, cobertura per zona, ràdio de les unitats (codis 3), prealerta de SVA (3.20 SEM) i avisos a altres serveis. La UCT no respon preguntes: el joc valora el que ha activat i quan.
- Es comuniquen amb un canal de sala (missatges ràpids o escrits).

El **tutor** (`/tutor`) prepara la guàrdia (CECOS, temàtiques, ritme, velocitat del rellotge, si la valoració és immediata o al final de cada incident, nota de briefing), la dirigeix (fer entrar incidents per temàtica, avaries, pics d'activitat, informació nova al registre) i veu la realitat de cada cas i totes les decisions. En acabar té la reconstrucció cronològica de la guàrdia.

L'**aprenentatge de consultors** (`/aprenentatge`) és una activitat de classe separada de la guàrdia. El tutor reprodueix una gravació des del seu ordinador (no es puja enlloc) i projecta un codi QR. **Escenaris en equip**: diversos incidents alhora que es disputen unes poques unitats (l'helicòpter, les SVA), alguns dels quals són duplicats del mateix servei. Cada alumne entra en un equip (es manté tota la sessió) i l'equip decideix entre tots, en un tauler compartit al mòbil, quins incidents són duplicats, l'ordre de prioritat i quina unitat va a cada incident; la decisió queda confirmada quan la majoria de l'equip hi està d'acord. Puntuen els duplicats detectats, la prioritat, els recursos (enviar unitats a un duplicat resta: duplicitat de servei) i el primer equip a posar-se d'acord. L'**interrogatori base** (a la pàgina de casos, «⚙ Interrogatori base») són els blocs de partida de tots els casos: primer contacte (què ha passat, consciència i respiració), el triangle d'avaluació pediàtrica (aparença, treball respiratori i circulació a la pell; bloc opcional que s'activa als casos pediàtrics) i després X, A, B, C, D, E, cadascun amb preguntes, signes, maniobres i «No avaluable». El tutor els pot reordenar, afegir, treure o reescriure; els casos nous en parteixen i els existents el poden aplicar. Quan no hi ha una sola resposta bona: les instruccions es graduen (indicada +2, acceptable +1, perillosa −1) i n'hi pot haver més d'una per alumne (diverses víctimes); els recursos es valoren amb un interval per tipus (mínim–màxim: per sota, infradotat; per sobre, sobredotat), i un cas pot acceptar més d'un nivell. Una explicació del tutor («Per què») surt als resultats. Cada cas és flexible: el tutor tria quines pantalles fan els alumnes (escolta, preguntes, instrucció, nivell, recursos i la barra d'activació), què hi ha a cada llista del XABCDE, i quines unitats surten, lliures o ocupades, i quines són la resposta correcta. Als casos sense veu, el projector pot fer sonar un ambient de sala de coordinació (emissores, telèfons, veus), generat al navegador. Els casos es preparen abans de classe a `/aula-admin`: títol, carta del 112, municipi, nivell correcte, gravació (es puja al servidor, a `aula-casos/`, fora de git i protegida per la contrasenya), notes per al tutor i els elements correctes del XABCDE, inclòs «No avaluable» quan la gravació no en dona informació. A classe (`/aprenentatge`) només cal anar posant els casos en ordre; el codi i el QR són els mateixos per a tota la sessió. Per explicar el joc abans de començar hi ha una presentació guiada (`/presentacio`, també des de la pàgina de classe): un pas per a cada part del joc amb el mòbil de l'alumne d'exemple al costat, que es pot tocar; es passa amb les fletxes del teclat i l'últim pas mostra el QR de la classe. La pantalla del projector (`/projector`) mostra la trucada en curs com al joc, el mapa amb les unitats reals, el QR i la participació. Hi ha dos tipus de cas. **Amb gravació**: cada alumne, des del mòbil (`/aula`, sense contrasenya), marca què ha escoltat a cada lletra del XABCDE (o «No avaluable»), tria unes poques preguntes clau (pressupost configurable), la primera instrucció a l'alertant, el nivell i les unitats; una barra fixa permet activar recursos en qualsevol moment i es registra el segon en què ho fa. **Només carta del 112**: sense veu, decideix si hi envia recurs i quantes unitats de cada tipus (útil per a accidents i múltiples víctimes). El tutor configura per a cada gravació els elements de cada apartat i quins són correctes, el nivell correcte i el municipi; la resposta de recursos per defecte són les unitats lliures més properes segons el nivell AURE i es pot canviar. En mostrar els resultats es projecten les respostes de tota la classe i una classificació, i cada alumne veu els seus encerts al mòbil.

La **gestió de casos** (`/editor`) permet crear casos nous (en blanc, duplicant o important un JSON), editar-los, activar-los o desactivar-los, esborrar-los o tornar a l'original. Per a cada opció i variant es marca si és òptima, acceptable, subòptima o perillosa, amb la seva explicació; també s'editen variants, preguntes, respostes, fitxa, informes de la unitat, decisions i desenllaços. Els casos editats es desen a `casos-locals/` (fora de git, no es perden en actualitzar).

Les comunicacions de ràdio segueixen el **Codi 3** del SEM (`data/codis3.json`): 3.35 mobilització, 3.50 temps estimat, 3.4 arribada, 3.1 S consulta sanitària, 3.5 dades de l'afectat, 3.51/3.52 trasllat assistit o no, 3.22 alta, 3.6 finalització, 3.11 anul·lació, 3.10 retorn a base, 3.54 cobrint zona fora de base.

El **públic** (`/vota`) vota amb un àlies la darrera decisió oberta i suma punts.

Només cal Node.js (sense dependències). El motor de la guàrdia és a `joc.mjs` i s'executa al servidor. Proves: `npm test`.

## Casos

Cada cas és un fitxer a `casos/` (llistat a `casos/index.json`) amb la carta d'entrada, variants (què passa realment), passos de decisió, preguntes de retrucada amb respostes per variant i valoració de cada opció (òptima, acceptable, subòptima, perillosa). Els casos es basen en registres reals anonimitzats: no hi ha noms ni telèfons.

## Dades

- `data/unitats.json` es genera a partir del Registre únic de bases i indicatius (només camps necessaris):
  `python3 scripts/build_units.py <REGISTRE_UNIC.xlsx> data/unitats.json`
- `data/centres.json` es descarrega del portal de dades obertes (Equipaments de Catalunya):
  `cd scripts && python3 build_centres.py ../data/unitats.json ../data/centres.json`
- `data/dea.json`: `cd scripts && python3 build_dea.py ../data/unitats.json ../data/dea.json`
- `data/estadistiques_activacions.json` (només agregats, l'Excel original no es puja):
  `python3 scripts/build_stats.py <export1.xlsx> [<export2.xlsx> ...] data/estadistiques_activacions.json`
  (el nivell de triatge s'aproxima pel recurs: SVA = N1/N2, només SVB = N3)
- `data/destins.json` (centres de destí reals dels exports, localitzats amb dades obertes):
  `cd scripts && python3 build_destins.py ../data/unitats.json <export1.xlsx> [...] ../data/destins.json`
- `data/prioritats_tih.json` prové de la guia TIH.PR.0001.
- `data/resposta_aure.json` i `data/criteris_valoracio.json` provenen de la infografia AURE.

## Instal·lar-lo en un servidor

Vegeu [docs/desplegament.md](docs/desplegament.md): Node.js o Docker, contrasenya opcional (`GAMCECOS_CLAU`) i codi de sala perquè diversos grups juguin alhora.

## Obrir el joc en un ordinador (pas a pas)

1. Instal·leu **Node.js** (versió LTS) des de https://nodejs.org.
2. Descarregueu el codi: a GitHub, trieu la branca `claude/vigilant-turing-56krps`, botó **Code → Download ZIP**, i descomprimiu-lo.
3. Obriu una terminal a la carpeta (Windows: a l'Explorador, escriviu `cmd` a la barra d'adreces i premeu Enter).
4. Escriviu `npm start` i premeu Enter. Deixeu la finestra oberta mentre jugueu.
5. Obriu el navegador a `http://localhost:8080`.
6. Els mòbils han d'estar a la **mateixa wifi** que l'ordinador i escanejar el QR de la sala. Si la xarxa no deixa connectar dispositius entre ells, es pot jugar sense vots del públic.
