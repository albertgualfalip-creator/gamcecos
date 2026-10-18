# GamCECOS

Joc en equip per entrenar l'atenció no presencial i la gestió de recursos de les emergències sanitàries a Catalunya. Vegeu [docs/disseny.md](docs/disseny.md).

## Com jugar

```
npm start            # http://localhost:8080
```

- **Sala** (`/`): pantalla per al projector i l'equip. Es tria la zona, l'hora del torn i el cas.
- **Públic** (`/vota`, amb el QR de la sala): cada participant vota des del mòbil; l'equip veu els vots abans de confirmar.
- Només cal Node.js (sense dependències). Leaflet i el generador de QR van inclosos a `app/vendor/`, així funciona en xarxes on els CDN estan bloquejats. El fons del mapa (OpenStreetMap) sí que necessita internet.
- Proves: `npm test`.

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
