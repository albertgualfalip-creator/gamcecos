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
