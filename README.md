# GamCECOS

Joc en equip per entrenar l'atenció no presencial i la gestió de recursos de les emergències sanitàries a Catalunya. Vegeu [docs/disseny.md](docs/disseny.md).

## Dades

- `data/unitats.json` es genera a partir del Registre únic de bases i indicatius (només camps necessaris):
  `python3 scripts/build_units.py <REGISTRE_UNIC.xlsx> data/unitats.json`
- `data/resposta_aure.json` i `data/criteris_valoracio.json` provenen de la infografia AURE.
