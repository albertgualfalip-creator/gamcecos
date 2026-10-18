# GamCECOS · Document de disseny (esborrany)

Joc en equip per entrenar l'atenció no presencial i la gestió de recursos de les emergències sanitàries a Catalunya.

## Concepte

- **Modalitat:** sessió en directe, tothom alhora.
- **Equip decisor** (3-5 professionals): pren les decisions finals.
- **Públic:** vota i opina des del mòbil (QR). L'equip veu els vots abans de confirmar, però decideix l'equip.
- **Dinamitzador/a:** configura la partida, controla el rellotge, injecta incidents i condueix el debriefing.
- **Format:** un *torn simulat* sobre el mapa real. Van entrant incidents que es resolen amb **casos ramificats**; les decisions tenen conseqüències que arrosseguen a la resta del torn (recursos ocupats, pacients que empitjoren, zones sense cobertura).

## Configuració de partida

- **Zona:** regió sanitària (Alt Pirineu i Aran, Lleida, Camp de Tarragona, Terres de l'Ebre, Girona, Catalunya Central, Barcelona) i, per a Barcelona, subzona (Metro Nord, Metro Sud, Barcelona ciutat, Penedès). Els incidents només apareixen a la zona triada.
- **Data i hora del torn:** determinen quines unitats estan en servei (horaris) i si els helicòpters de dia volen (ocàs).
- **Durada i intensitat:** nombre d'incidents i ritme d'entrada.

## Focus clínic

- El joc se centra en les **emergències (N1-N2)**: són la majoria dels incidents d'un torn.
- Hi apareixen alguns **N3** i alguns **N4-N5** (consell telefònic, sense recurs) com a **distractors**: l'equip ha de saber no gastar recursos on no cal.

## Entorn de cada incident

Determina la resposta segons AURE (`entorn_per_zona` a `data/resposta_aure.json`):

| Entorn | Zones |
|---|---|
| Urbà | Barcelona ciutat |
| Suburbà | Tarragona ciutat, Metro Nord, Metro Sud |
| Rural | Alt Pirineu i Aran, Catalunya Central, Terres de l'Ebre |
| Pendent | Penedès, resta del Camp de Tarragona, Lleida, Girona |

## Tipus d'entrada

| Tipus | Què veu l'equip | Decisions |
|---|---|---|
| Alerta sense veu | Només dades (teleassistència, eCall, avís d'altra sala, fitxa recollida) | Interpretar, demanar més informació, nivell, recurs |
| Incident amb trucada | Diàleg ramificat: l'equip tria preguntes | Triatge (N1-N5), maniobres salvadores, recurs |

## Decisions i avaluació

Basades en el protocol AURE (`data/resposta_aure.json`, `data/criteris_valoracio.json`):

1. **Activació immediata** (Taula 1, categories Omega): s'han activat USVB + USVA més properes sense esperar? Si no és categoria immediata: USVB activada i USVA en **3.20 SEM** (no es llença, s'espera la valoració).
2. **Nivell de triatge** (N1-N5) segons els criteris de valoració per motiu d'alerta.
3. **Maniobres salvadores** indicades per telèfon.
4. **Recurs** segons nivell i entorn (urbà / suburbà / rural), incloent-hi HEMS i atenció primària quan es compleixen els criteris de temps d'arribada (**3.50**) calculats sobre el mapa.
5. **Moduladors** que escalen o desescalen la resposta.

Cada decisió es puntua per nivells, perquè hi pot haver més d'una resposta correcta:

- 🟢 Òptima · 🟡 Acceptable · 🟠 Subòptima (cost en temps, recursos o cobertura) · 🔴 Perillosa

Principi del protocol: *en cas de dubte, el criteri més segur*. L'infratriatge penalitza més que el sobretriatge.

## Generació de casos amb IA

- **Plantilles clíniques validades** pels professionals (motiu, signes, nivell correcte, preguntes clau, maniobres).
- **La IA genera la variació:** pacient, redacció de la trucada, ubicació, estat inicial de les unitats, coincidència d'incidents.
- **Motor de regles determinista** per avaluar: nivell segons la plantilla, recurs segons AURE i temps d'arribada calculats sobre el mapa.
- El dinamitzador genera i revisa el torn **abans** de la sessió.

## Dades

| Fitxer | Contingut |
|---|---|
| `data/unitats.json` | 509 unitats: indicatiu, tipus, horari, base (nom, municipi, coordenades), regió i subzona |
| `data/resposta_aure.json` | Activació immediata, resposta per nivell i entorn, criteris HEMS i AP, principis, moduladors, rols |
| `data/criteris_valoracio.json` | Annex 1: criteris de nivell i maniobres salvadores per motiu d'alerta |
| `data/dea.json` | 12.343 DEA fixos del registre de desfibril·ladors (per a l'ordre "DEA si disponible" en una RCP telefònica) |
| `data/estadistiques_activacions.json` | Estadístiques agregades i anonimitzades de l'export d'activacions: demanda per zona i hora, combinacions de recursos, diagnòstics amb SVA, temps de resposta |
| `data/centres.json` | 899 centres de dades obertes: 730 CAP, 99 centres d'atenció continuada (PAC/CUAP) amb horari, 70 hospitals |

### Què diuen les activacions (1-2 d'octubre de 2026, 4.835 emergències)

- **Tipus de demanda:** malaltia en domicili, accident/traumatisme i malaltia en lloc públic, en proporcions semblants.
- **Recursos:** el 14 % dels incidents tenen SVA. La combinació més habitual és només SVB; després SVA + SVB i dues SVB.
- **Diagnòstics més freqüents amb SVA:** dolor toràcic, dispnea, aturada cardíaca, convulsions, síncope, baix nivell de consciència.
- **Diagnòstics més freqüents només amb SVB:** caigudes, dispnea, dolor abdominal, mareig, febre, traumatismes lleus. Bons candidats per a distractors i per a decisions SVB vs SVA.
- **Ritme:** pic entre les 9 i les 19 h (≈ 400-500 incidents/hora a tot Catalunya), mínim a les 3-6 h.
- **Temps de resposta (mediana):** 7-10 min a l'àrea de Barcelona; 10-12 min a la Catalunya Central i Camp de Tarragona; SVA a Terres de l'Ebre ≈ 20 min (p90 > 75 min). Serviran per calibrar els temps d'arribada simulats.

## Fases

1. **Pilot:** mapa amb unitats, 3-4 plantilles, torns generats i revisats, equip + vots, debriefing.
2. Més plantilles, conseqüències encadenades, rànquings, historial.
3. Àudio de trucades, pacient interpretat per IA en directe, diversos equips.
