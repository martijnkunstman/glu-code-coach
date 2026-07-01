# GLU Coding Coach — server + docentdashboard

Een zelfstandige Node-server (**zonder dependencies**) die twee dingen doet:

1. **Docentdashboard** — een webpagina om programmeeropdrachten in te voeren,
   te bewerken en te verwijderen.
2. **API** — waar de VS Code-extensie (de coach) de opdrachten ophaalt.

Bedoeld om te draaien onder `app.agenticlearning.eu/glu/embeddedcodingcoach`.

## Snel starten (lokaal)

```bash
cd server
node server.js
# -> draait op http://localhost:3000/glu/embeddedcodingcoach/
```

Open die URL in je browser voor het dashboard.

## Configuratie (omgevingsvariabelen)

> **Vereist Node 18+** (de server gebruikt ingebouwde `fetch` om met Claude te praten).

| Variabele           | Default                     | Betekenis                                           |
|---------------------|-----------------------------|-----------------------------------------------------|
| `ANTHROPIC_API_KEY` | *(leeg)*                    | **De centrale Claude-sleutel.** Hiermee doet de server de coach-aanroepen, zodat studenten géén eigen sleutel nodig hebben. Zonder deze sleutel werkt de chat niet. |
| `COACH_MODEL`       | `claude-sonnet-4-6`         | Welk Claude-model de coach gebruikt                 |
| `PORT`              | `3000`                      | Poort waarop de server luistert                     |
| `BASE_PATH`         | `/glu/embeddedcodingcoach`  | Pad waaronder alles draait                          |
| `DATA_FILE`         | `./data/assignments.json`   | JSON-bestand met de opdrachten                      |
| `TEACHER_PASSWORD`  | *(leeg)*                    | Leeg = iedereen mag bewerken. Gezet = docent moet inloggen om te wijzigen |
| `PROXY_TOKEN`       | *(leeg)*                    | Leeg = coach open. Gezet = de IDE moet `x-proxy-token` meesturen (door beheerder uit te rollen) |
| `COACH_RATE_PER_MIN`| `120`                       | Burst-limiet per IP per minuut op de coach-endpoints (`0` = uit). Houd ruim i.v.m. NAT (hele klas = 1 IP). |
| `COACH_MAX_PER_DAY` | `0` (uit)                   | Globaal daglimiet op coach-aanvragen — een kostenplafond. Zet op bijv. aantal-studenten × 50. |

Voorbeeld (productie):
`ANTHROPIC_API_KEY='sk-ant-…' TEACHER_PASSWORD='kiesietssterks' node server.js`

## Coach-proxy — waarom de student geen sleutel nodig heeft

De server praat zelf met Claude; de IDE praat alleen met de server:

| Methode | Pad                  | Doel                                                        |
|---------|----------------------|-------------------------------------------------------------|
| `POST`  | `/api/coach/chat`    | Streamt (SSE) het coach-antwoord. Body: `{assignmentId, messages, mode}` |
| `POST`  | `/api/coach/review`  | Korte meekijk-hint. Body: `{assignmentId, code, languageId}` → `{text}` |

De systeemprompts en de **coach-only `solutionNotes`** zitten server-side en
worden in de prompt verwerkt — ze verlaten de server dus nooit. De student heeft
geen API-sleutel en hoeft niets te configureren.

## Beveiliging

- **Docent-login** (`TEACHER_PASSWORD`): zonder wachtwoord is alles open (handig lokaal).
  Met wachtwoord moet de docent inloggen in het dashboard; lézen van opdrachten
  blijft publiek (de IDE heeft dat nodig), alleen wijzigen vereist login.
- **Oplossingsnotities (`solutionNotes`) blijven op de server**: omdat de server
  zelf met Claude praat, worden de notities server-side in de prompt verwerkt en
  via de publieke `/api/assignments` weggelaten. Ze bereiken de student dus nooit.
- **Coach afschermen** (`PROXY_TOKEN`): zet dit om misbruik van het coach-endpoint
  tegen te gaan; een beheerder rolt hetzelfde token uit via de IDE-instelling
  `studentCoach.proxyToken`.
- **Misbruik-/kostenrem**: `COACH_RATE_PER_MIN` (burst per IP) en `COACH_MAX_PER_DAY`
  (globaal kostenplafond) begrenzen de schade als iemand het endpoint hamert.

> Eerlijk: de student-extensie is leesbare JS, dus wélk endpoint wordt aangeroepen is
> zichtbaar. De **sleutel** krijgt een student nooit (die staat alleen server-side),
> maar het *endpoint* is zonder login niet 100% af te schermen — de knoppen hierboven
> begrenzen de kosten/snelheid.

## Install-pagina (deel-link voor studenten)

`{BASE}/install` (of `{BASE}/install.html`) toont een nette pagina met een
download-knop voor `coding-coach.vsix` plus de installatiestappen. Productie:
`https://app.agenticlearning.eu/glu/embeddedcodingcoach/install`. Het bestand
`coding-coach.vsix` staat in `public/` en wordt mee-gedeployed.

## API

Alle paden staan onder `BASE_PATH`. CORS staat aan, zodat de VS Code-extensie
(andere origin) de opdrachten kan ophalen.

| Methode  | Pad                        | Doel                          |
|----------|----------------------------|-------------------------------|
| `GET`    | `/api/health`              | Statuscheck                   |
| `GET`    | `/api/assignments`         | Alle opdrachten               |
| `GET`    | `/api/assignments/:id`     | Eén opdracht                  |
| `POST`   | `/api/assignments`         | Nieuwe opdracht aanmaken      |
| `PUT`    | `/api/assignments/:id`     | Opdracht bijwerken            |
| `DELETE` | `/api/assignments/:id`     | Opdracht verwijderen          |

Extra (docent): `GET /api/export` (alle opdrachten, incl. notities) en
`POST /api/import` (alles vervangen). In het dashboard via de knoppen Export/Import.

### Opdracht-model

```json
{
  "id": "uuid",
  "title": "Palindroomchecker",
  "language": "python",
  "level": "beginner",
  "description": "Schrijf een functie die ...",
  "learningGoals": ["functies", "strings"],
  "hints": ["Wat betekent het begrip?", "Hoe draai je een tekst om?"],
  "starterCode": "def is_palindroom(tekst):\n    pass",
  "solutionNotes": "Coach-only: aanpak en veelgemaakte fouten (nooit naar de student).",
  "functionName": "is_palindroom",
  "tests": [{ "args": ["racecar"], "expected": true }],
  "createdAt": "...",
  "updatedAt": "..."
}
```

`learningGoals` en `hints` mogen bij `POST`/`PUT` ook als string met regels
worden gestuurd (één per regel); de server splitst ze automatisch. `tests` mag
ook als tekstregels in de vorm `["racecar"] => true` (JSON aan beide kanten).

> **`functionName` + `tests`** maken automatisch toetsen mogelijk: de student
> klikt in de IDE op **🧪 Toets mijn code**, waarna de extensie de functie tegen
> de testgevallen draait (Python/JavaScript) en de coach er pedagogische feedback
> op geeft — zonder de oplossing te verklappen.

> **hints = hint-ladder.** Zet ze van vaag naar concreter. De coach geeft ze
> stapsgewijs en geeft nooit de oplossing — zie de pedagogische regels in de
> extensie.

## Deployen naar app.agenticlearning.eu/glu/embeddedcodingcoach

De server is bewust dependency-vrij, dus deployen = bestanden kopiëren + `node`
draaien. Twee gangbare manieren:

**A. Direct met een reverse proxy (nginx/Apache)**
Draai de server op een interne poort en stuur het pad door:

```nginx
location /glu/embeddedcodingcoach/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}
```

(De server kent zijn eigen `BASE_PATH`, dus geen pad-herschrijving nodig.)

**B. Met een procesmanager** zoals `pm2` of een `systemd`-service, zodat hij
blijft draaien en herstart na een crash:

```bash
pm2 start server.js --name coding-coach
pm2 save
```

Zorg dat `DATA_FILE` op een schijflocatie staat die behouden blijft.

## De extensie hierop laten wijzen

In VS Code-instellingen: **studentCoach.apiBaseUrl**
- Productie: `https://app.agenticlearning.eu/glu/embeddedcodingcoach`
- Lokaal testen: `http://localhost:3000/glu/embeddedcodingcoach`

Is de API onbereikbaar, dan valt de extensie terug op de lokale instelling
`studentCoach.assignment`, zodat de coach altijd blijft werken.
