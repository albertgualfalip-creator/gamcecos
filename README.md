# GamCECOS

Joc en equip per entrenar l'atenció no presencial i la gestió de recursos de les emergències sanitàries a Catalunya. Vegeu [docs/disseny.md](docs/disseny.md).

## Com jugar

```
npm start            # http://localhost:8080
```

1. **Tutor** (`/tutor`): tria les CECOS, les temàtiques a treballar, l'hora del torn, el nombre d'incidents i el ritme. Crea la guàrdia i obté un codi de 4 lletres.
2. **Equip** (`/sala`, al projector): entra amb el codi. Quan el tutor inicia la guàrdia, els incidents van entrant a l'atzar (segons les temàtiques) amb so i rellotge. Cada decisió porta el rol que la pren: **gestor de recursos** (activa i allibera unitats al mapa), **consultor** (retrucada, nivell, consell) i **coordinació** (reajustos). En tancar cada incident es veu el desenllaç del pacient.
3. **Públic** (`/vota`, amb el QR): vota cada decisió amb un àlies i suma punts; hi ha classificació.
4. El **tutor** veu el que l'equip no veu (què passa realment i el nivell real), llança incidents d'una temàtica concreta, injecta complicacions (avaria d'una unitat, pic d'activitat), afegeix informació al registre d'un incident, pausa i finalitza.

Només cal Node.js (sense dependències). Leaflet i el generador de QR van inclosos a `app/vendor/`. Proves: `npm test`.

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
