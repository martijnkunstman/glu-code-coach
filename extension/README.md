# GLU Code Coach — de plugin (VS Code-extensie)

Het chatpaneel dat de student in VS Code gebruikt. Het praat uitsluitend met de
[backend](../server/) (`server/`); die doet de Claude-aanroepen met één centrale
sleutel. De extensie zelf is **sleutel-vrij en dependency-vrij** (plain
JavaScript, geen `npm install` of build-stap nodig).

**Uitgangspunt:** de coach geeft *nooit* het goede antwoord. Hij werkt met vragen
en een hint-ladder.

## Kernfuncties

- 💬 **Chat** met streaming + markdown (codeblokken, lijstjes).
- 👀 **Meekijken** in de code met proactieve hints.
- 🧪 **Toets mijn code** — draait de code tegen de testgevallen (Python/JavaScript)
  en geeft pedagogische feedback, zonder de oplossing te geven.
- 💾 **Onthoudt** de gekozen opdracht + het gesprek na herladen.

## Voor de student: niets instellen

VS Code openen en gaan. Geen API-sleutel, geen terminal, geen config. Klik op het
**GLU Code Coach**-icoon in de activity bar, kies een opdracht in de dropdown en
begin. De standaard-`apiBaseUrl` wijst al naar de productie-backend.

## Ontwikkelen / lokaal testen

1. Open de **repo-root** in VS Code en druk op **F5** (opent een tweede venster;
   de launch-config in `.vscode/launch.json` wijst naar deze `extension/`-map).
2. Start de backend lokaal (zie [`server/README.md`](../server/README.md)) en zet
   `studentCoach.apiBaseUrl` op `http://localhost:3000/glu/embeddedcodingcoach`.
3. Klik op het **GLU Code Coach**-icoon.

## Bouwen (.vsix) en uitrollen

```bash
cd extension
npx @vscode/vsce package   # → glu-code-coach-<versie>.vsix
```

Rol het `.vsix` uit via de VS Code Marketplace, handmatig (*Install from VSIX…*)
of via het apparaatbeheer/Settings Sync van de school. Voor de download-pagina
van de backend kopieer je het als `server/public/coding-coach.vsix`.

> `.vsix`-bestanden staan in `.gitignore` — het zijn build-artefacten, geen
> broncode.

## Bestanden

| Bestand           | Doel                                                      |
|-------------------|-----------------------------------------------------------|
| `package.json`    | Extensie-manifest (view, icoon, instellingen, commando's) |
| `extension.js`    | Coach-logica: chat, meekijken, opdrachten, toetsen        |
| `runner.js`       | Code-toetser (Python/JavaScript) voor "Toets mijn code"   |
| `media/main.js`   | Chat-UI in de webview (markdown, dropdown, toetsblok)     |
| `media/style.css` | Styling met VS Code-themakleuren                          |
| `media/icon.svg`  | Icoon in de activity bar                                  |

## Instellingen (samenvatting)

| Setting                   | Doel                                                       |
|---------------------------|------------------------------------------------------------|
| `studentCoach.apiBaseUrl` | Basis-URL van de backend (default = productie)             |
| `studentCoach.proxyToken` | Optioneel; door beheerder uit te rollen                    |
| `studentCoach.proactive`  | Meekijken aan/uit                                          |
| `studentCoach.aiMode`     | `remote` (school-server) of `local` (Ollama)              |
| `studentCoach.pythonPath` | Python-commando voor toetsen (Windows vaak `python`)       |
| `studentCoach.assignment` | Terugval-opdracht als de backend onbereikbaar is           |

De student hoeft hier niets aan te raken; alleen `proactive` is een handige
aan/uit-knop (zit ook in het paneel).

## Hoe het werkt

- **Geen sleutel bij de student** — de extensie praat alleen met de backend;
  die doet de Claude-aanroepen met één centrale sleutel (`ANTHROPIC_API_KEY`).
- **Opdrachten** — `loadAssignments()` haalt ze op van `{apiBaseUrl}/api/assignments`
  en vult de dropdown.
- **Chat** — `streamCoach()` post de gesprekshistorie naar `/api/coach/chat` en
  leest het antwoord als stream (SSE). De systeemprompts + hint-ladder + de
  coach-only notities zitten **server-side** en verlaten de backend nooit.
- **Meekijken** — `runAnalysis()` stuurt bij elke typpauze code + opdracht naar
  `/api/coach/review`; de backend geeft één korte hint of `NONE`.
- **Toetsen** — `testActiveCode()` draait via `runner.js` de code lokaal tegen de
  testgevallen; `coachOnTest()` laat de coach het resultaat pedagogisch bespreken.
- **Persistentie** — gekozen opdracht + gesprek in `workspaceState`, hersteld na
  herladen.
