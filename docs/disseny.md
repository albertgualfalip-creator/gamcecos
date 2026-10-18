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

## Tipus de servei

| Servei | Exemple | Què treballa |
|---|---|---|
| **Emergències** | Malaltia en domicili, accident/traumatisme, malaltia en lloc públic | Triatge (N1-N5), consell i maniobres, recurs segons AURE |
| **Derivacions** (transport sanitari 061 a petició d'un metge) | Centres de salut fora d'hospital (CAP, CUAP), residència o domicili → hospital o CAP | Quin recurs (SVB o SVA), amb quina urgència, sense descobrir la zona |
| **Interhospitalaris (TIH)** | Hospital emissor → hospital receptor, prioritats 0-3 (guia TIH.PR.0001) | Gestió operativa: recurs adequat, origen i destí, temps, impacte en la cobertura |

Les derivacions i els interhospitalaris competeixen pels mateixos recursos que les emergències: és on el joc fa decidir *què sacrifico*.

### Interhospitalaris

Regles a `data/prioritats_tih.json` (guia TIH.PR.0001):

| Prioritat | Què és | Objectiu | Alarma |
|---|---|---|---|
| 0 | Risc vital i codis (IAM, ictus, PPT, sagnat inestable...) | Arribada a l'HE < 30 min | 10 min sense activar |
| 1 | L'HE no té mitjans però pot iniciar tractament (UCI, neurocirurgia, psiquiatria...) | < 90 min | 60 min sense activar |
| 2 | Sense llit, desescalada, retorns de codi, programats < 4 h | Ajornable a les 7-8 h si es demana després de les 22 h | 160 min sense assignar |
| 3 | Residència, reagrupament familiar, programats > 4 h | < 12 h | 600 min sense assignar |
| 4 | Entre comunitats autònomes, repatriacions | Dies | Fora del joc |

El recurs es tria per àmbit clínic (respiratori, hemodinàmic, hemorràgia, ritme, SCA, neurològic, cremats, altres) i **sempre s'assigna el més alt** (TSNU < SVB < SVAi < SVAm < QA). Decisions de joc típiques: P0 sense SVAm disponible (SVAi amb suport 3.14), P2 demanat a les 23 h (ajornar o no), qui assumeix un trasllat entre zones, alarma de P1 a 60 min.

### Hospitals de destí

`data/destins.json`: 80 destins reals dels exports (55 hospitals, 10 CUAP, 15 CAP) situats amb el catàleg d'equipaments, amb el nombre de serveis i quantes vegades són origen o destí d'un interhospitalari. Pendents de localitzar: diversos CUAP (Casernes, Pura Fernández, Gràcia, Castelldefels, Sant Andreu de la Barca, Cerdanyola-Ripollet, Cambrils, Sant Fèlix, Bages, Sant Pere) i centres privats o de salut mental (Hospital General de Catalunya, Quirón, Clínica del Vallès, Institut Pere Mata).

## Banc d'esdeveniments de guàrdia

Situacions que el dinamitzador (o la IA) pot injectar durant el torn. Llista oberta per anar ampliant:

**Problemes operatius amb unitats**
- Avaria o accident de la unitat en ruta; unitat que no respon a la ràdio.
- Unitat retinguda a la porta d'urgències (transferència lenta del pacient).
- Unitat fora de servei per neteja i desinfecció després d'un pacient infecciós.
- Dotació incompleta, relleu de torn, unitat que plega a mig servei (horari 12 h).
- Agressió a l'equip, necessitat de suport policial.
- Material esgotat o DEA de la unitat avariat.

**Centres sanitaris**
- CAP o CUAP col·lapsat que demana diversos trasllats alhora.
- CAP inundat, sense llum o evacuat: cal redistribuir pacients.
- Hospital saturat o sense TAC / hemodinàmica disponible: cal un altre destí.
- Residència amb diversos pacients afectats (brot, calor, intoxicació).

**Altres cossos i sales**
- Avís de policia (Mossos, Guàrdia Urbana): persona ferida, baralla, persona agitada.
- Bombers: incendi amb víctimes, rescat, accident de trànsit amb atrapats.
- Avisos del 112, Salvament Marítim, GRAE (rescat de muntanya), Protecció Civil.

**A quin hospital el portes**
- Codi IAM, ictus o PPT: centre útil, no el més proper.
- Pediatria, obstetrícia, cremats, psiquiatria, reimplantament.
- Hospital de referència per sector vs proximitat; distància > 30 min (valorar HEMS).

**Simultaneïtat i cobertura**
- Incident amb múltiples víctimes (IMV): accident, intoxicació col·lectiva.
- Zona sense SVA disponible: tirar d'una regió veïna o de l'helicòpter.
- Helicòpter que no pot volar (meteorologia, ocàs).
- Carretera tallada, neu, temporal: accés per terra impossible.
- Esdeveniments: concerts, festes majors, proves esportives, onada de calor.

**Comunicacions i sistemes**
- Caiguda del sistema informàtic o de telefonia: treballar en paper.
- Trucades repetides pel mateix incident, trucades abandonades, hiperfreqüentadors.
- Trucador que no parla català ni castellà, trucada de broma.

**Situacions socials i ètiques**
- Negativa al trasllat, pacient violent, menor sol.
- Violència masclista, intent autolític, persona sense llar amb fred.
- Pacient amb PIIC, MACA o adequació de l'esforç terapèutic: no RCP.

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

### Què diuen les activacions (3 exports: 11-12 d'abril, 11-12 d'agost, 1-2 d'octubre de 2026)

**Emergències (14.798 incidents)**
- **Nivell aproximat** (mentre la base de dades no tingui el triatge): SVA activada = N1/N2, només SVB = N3; N4/N5 no hi surten perquè no es mobilitza recurs. El 14 % són N1/N2.
- **Combinacions de recursos:** només SVB (9.691), SVA + SVB (820), dues SVB (746), dues SVA + SVB (426).
- **Diagnòstics més freqüents N1/N2:** dolor toràcic, dispnea, síncope, convulsions, alteració de consciència, aturada cardíaca.
- **Diagnòstics més freqüents N3:** dispnea, caigudes, mareig, dolor abdominal, traumatismes, febre. Dispnea i dolor toràcic surten als dos: ideals per decidir SVA o SVB.
- **Temps de resposta SVA (mediana):** 7,4 min Barcelona ciutat; 8-10 min àrea metropolitana i Lleida; 11-12 min Camp de Tarragona, Girona, Catalunya Central i Penedès; 15,5 min Terres de l'Ebre.

**Derivacions (3.709 incidents)**
- Origen: domicili o via pública (1.232), CAP (1.007), CUAP (822), residència (607).
- Gairebé tot amb SVB; un 9 % amb SVA.

**Interhospitalaris (711 incidents)**
- Prioritats: 0 (196), 1 (323), 2 (138), 3 (54). Prioritat 0 i 1 meitat SVA, prioritat 3 majoritàriament SVB.
- Temps de resposta (mediana): 8 min prioritat 0, 12 min prioritat 1, 19-20 min prioritats 2-3.
- Parelles més freqüents: Sant Joan de Reus → Joan XXIII, Figueres / Palamós / Blanes → Trueta, Mataró → Germans Trias, Moisès Broggi / Viladecans / Sant Joan de Déu → Bellvitge.
- Diagnòstics: codi infart (angioplàstia, IAM, IMSEST), malaltia cerebrovascular, agitació / psicosi, hemorràgia digestiva.


## Prototip jugable (primera part: alertes de pacient o entorn)

- 7 casos: veïna inconscient, menor agressiu, home amb càncer que parla malament, teleassistència sense resposta, eCall amb xoc frontal, caiguda en anticoagulat (veu passada a valorar), consum de tòxics (distractor N5).
- Passos: activació inicial → retrucada (3 preguntes) → nivell → consell / reajust → recursos al mapa.
- Registre a l'estil de la sala: `data hora | codi | usuari` (T = SITREM, L = valoració, O = coordinació, R = ràdio).
- Temps d'arribada calibrats amb les medianes reals dels exports; un 25 % d'unitats ocupades a l'atzar i horaris reals de servei.

## Fases

1. **Pilot:** mapa amb unitats, 3-4 plantilles, torns generats i revisats, equip + vots, debriefing.
2. Més plantilles, conseqüències encadenades, rànquings, historial.
3. Àudio de trucades, pacient interpretat per IA en directe, diversos equips.
