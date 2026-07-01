# GLU Code Coach

Een AI-codecoach voor studenten, gebouwd rond de **Claude API** (Anthropic).
De coach begeleidt een student stap voor stap bij een programmeeropdracht: hij
chat mee, kijkt actief mee in de code en toetst het werk — maar geeft **nooit**
het goede antwoord. Hij ontdekt het sámen met de student via vragen en een
hint-ladder.

## Twee onderdelen

Deze repository bevat twee duidelijk gescheiden delen:

| Map           | Wat                          | Draait waar                                    |
|---------------|------------------------------|------------------------------------------------|
| [`extension/`](extension/) | **De plugin** — de VS Code-extensie die de student gebruikt. | Op de laptop van de student, in VS Code.       |
| [`server/`](server/)       | **De backend** — docentdashboard + coach-API (proxy naar Claude). | Op de school-server (bijv. `app.agenticlearning.eu`). |

De twee praten met elkaar over HTTP: de plugin haalt opdrachten op bij de
backend en stuurt chat/meekijk-verzoeken door. **De Claude-sleutel zit alleen op
de backend** — de student heeft nooit een sleutel nodig.

```
┌────────────────────┐        HTTPS         ┌─────────────────────┐        ┌────────────┐
│  extension/        │  ───────────────────▶│  server/            │ ──────▶│ Claude API │
│  (VS Code, student)│  opdrachten + chat   │  (school, docent)   │  key   │ (Anthropic)│
└────────────────────┘ ◀─────────────────── └─────────────────────┘        └────────────┘
```

## Belangrijk: geen geheimen in deze repo

- De **Claude-sleutel** wordt uitsluitend via de omgevingsvariabele
  `ANTHROPIC_API_KEY` op de backend gezet — nooit in code, nooit in git.
- Ook `TEACHER_PASSWORD` en `PROXY_TOKEN` komen uit de omgeving (zie
  [`server/README.md`](server/README.md)).
- De plugin is **sleutel-vrij en dependency-vrij**: hij praat alleen met de
  backend.

Zet secrets lokaal in een `.env` (die staat in `.gitignore`) of in de
omgevingsvariabelen van je hosting.

## Snel starten (ontwikkelaar)

1. **Backend** lokaal draaien:
   ```bash
   cd server
   ANTHROPIC_API_KEY='sk-ant-…' node server.js
   # → http://localhost:3000/glu/embeddedcodingcoach/
   ```
2. **Plugin** debuggen: open deze repo-root in VS Code en druk op **F5**
   (de launch-config wijst naar `extension/`). Zet in het tweede venster
   `studentCoach.apiBaseUrl` op `http://localhost:3000/glu/embeddedcodingcoach`.

Details per onderdeel: [`extension/README.md`](extension/README.md) en
[`server/README.md`](server/README.md).

## Licentie

Zie de repository-instellingen op GitHub (LearningTour).
