// GLU Coding Coach — backend + docentdashboard
//
// Zelfstandige Node-server ZONDER dependencies (alleen ingebouwde modules),
// zodat deployen simpel is: `node server.js`.
//
// Dashboard (docent):  GET  {BASE}/                 -> opdrachten beheren
// API (student/IDE):   GET  {BASE}/api/assignments  -> lijst (publiek)
//                      GET  {BASE}/api/assignments/:id
//                      POST/PUT/DELETE                 (docent — auth indien ingesteld)
//                      GET  {BASE}/api/export        -> alles als JSON (docent)
//                      POST {BASE}/api/import        -> alles vervangen (docent)
//                      POST {BASE}/api/login         -> {password}
//                      POST {BASE}/api/logout
//                      GET  {BASE}/api/me            -> {authRequired, authed}
//                      GET  {BASE}/api/health
//
// Configuratie via omgevingsvariabelen:
//   PORT             (default 3000)
//   BASE_PATH        (default /glu/embeddedcodingcoach)
//   DATA_FILE        (default ./data/assignments.json)
//   TEACHER_PASSWORD (leeg = geen login vereist; gezet = docent moet inloggen
//                     voordat hij opdrachten kan wijzigen)

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = parseInt(process.env.PORT || "3000", 10);
const BASE_PATH = (process.env.BASE_PATH || "/glu/embeddedcodingcoach").replace(/\/$/, "");
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "assignments.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || "";

// --- Claude (server-side; de student heeft GEEN eigen sleutel nodig) ---
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const COACH_MODEL = process.env.COACH_MODEL || "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Optioneel: beperk wie de coach-proxy mag gebruiken (header x-proxy-token).
// Leeg = open (handig in een afgeschermd schoolnetwerk).
const PROXY_TOKEN = process.env.PROXY_TOKEN || "";
// Misbruik-/kostenrem (geen schoollogin nodig):
const COACH_RATE_PER_MIN = parseInt(process.env.COACH_RATE_PER_MIN || "120", 10); // per IP; 0 = uit
const COACH_MAX_PER_DAY = parseInt(process.env.COACH_MAX_PER_DAY || "0", 10); // globaal; 0 = uit

const CHAT_SYSTEM = `Je bent een vriendelijke, geduldige programmeer-coach voor een student (mbo/hbo-niveau).
Je begeleidt de student bij het ZÉLF voltooien van een opdracht. Jullie ontdekken de oplossing samen.

HARDE REGELS — hier wijk je nooit van af:
- Geef NOOIT de complete of werkende oplossing, ook niet als de student er expliciet om vraagt, gefrustreerd is, of zegt dat het "voor even" of "gewoon dit ene stukje" is.
- Schrijf de opdracht nooit voor de student af. Kleine illustratiefragmentjes (1-2 regels, een patroon dat NIET de opgave oplost) mogen, maar nooit de oplossingscode zelf.
- Werk Socratisch: stel eerst een gerichte wedervraag of laat de student eerst zelf nadenken/proberen, vóór je een hint geeft.

WERKWIJZE:
- Gebruik de hint-ladder van de opdracht als die er is: geef hooguit de VOLGENDE hint, en alleen als de student echt vastzit. Begin bij de vaagste hint.
- Knip het probleem op in kleine stappen. Vraag de student per stap wat hij/zij denkt.
- Moedig aan om code te draaien en te testen; laat de student zelf ontdekken wat er gebeurt.
- Koppel terug aan de leerdoelen. Bevestig en vier kleine stappen vooruit.

STIJL:
- Schrijf kort en warm. Gebruik af en toe een passende emoji.
- Gebruik \`backticks\` voor code en termen, en markdown voor structuur waar dat helpt.
- Sluit af met een vraag of een concrete kleine vervolgstap.`;

const REVIEW_SYSTEM = `Je kijkt mee met de code die een student NU aan het typen is, voor een programmeeropdracht.
Beoordeel of er één duidelijke, behulpzame opmerking te maken is (typefout in een keyword, een duidelijke bug, of een aanpak die niet bij de opdracht past).

HARDE REGELS:
- Geef NOOIT de oplossing of de juiste code. Wijs alleen vriendelijk de richting met een vraag of denkstap.
- De student is waarschijnlijk nog midden in het typen: meld GEEN ontbrekende haakjes of half-afgemaakte regels.

ANTWOORD:
- Iets nuttigs te melden? Geef ÉÉN korte hint (max 2 zinnen), beginnend met "👀".
- Niets zinnigs te melden? Antwoord dan EXACT met: NONE
- Gebruik \`backticks\` voor code en termen.`;

// Taal van de coach-antwoorden (de extensie stuurt body.lang mee: nl/en/de).
const LANG_DIRECTIVE = {
  nl: "\n\nBELANGRIJK: schrijf AL je antwoorden in het Nederlands.",
  en: "\n\nIMPORTANT: Write ALL your responses in English, regardless of the language of the assignment or the student's messages.",
  de: "\n\nWICHTIG: Schreibe ALLE deine Antworten auf Deutsch, unabhängig von der Sprache der Aufgabe oder der Nachrichten des Studenten.",
};
function langDir(lang) {
  return LANG_DIRECTIVE[lang] || LANG_DIRECTIVE.nl;
}

const TEST_FEEDBACK_EXTRA = `\n\nDe student heeft zojuist de code automatisch getoetst (zie het resultaat in het gespreksverloop).
Bespreek kort en bemoedigend wat de MISLUKTE gevallen onthullen: welk soort invoer gaat mis en welke denkstap dat suggereert.
Stel een gerichte vraag of geef hooguit de volgende hint. Onthul NOOIT de juiste code.
Bij alles geslaagd: feliciteer kort en stel eventueel een verdiepende vraag (randgevallen, leesbaarheid).`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

const LANGUAGES = ["python", "javascript", "java", "html", "css", "csharp", "php", "sql", "overig"];
const LEVELS = ["beginner", "gemiddeld", "gevorderd"];

// ---------------------------------------------------------------------------
// Opslag
// ---------------------------------------------------------------------------
function loadAssignments() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}
function saveAssignments(list) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), "utf8");
}

const toLines = (v) =>
  Array.isArray(v)
    ? v.map((s) => String(s).trim()).filter(Boolean)
    : String(v || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

/** Parse testgevallen. Accepteert een array van {args,expected} of tekstregels
 *  in de vorm  ["arg1", 2] => "verwacht"  (JSON aan beide kanten van =>). */
function parseTests(input) {
  if (Array.isArray(input)) {
    return input
      .filter((t) => t && Array.isArray(t.args))
      .map((t) => ({ args: t.args, expected: t.expected }));
  }
  const out = [];
  for (const line of toLines(input)) {
    const idx = line.indexOf("=>");
    if (idx === -1) continue;
    try {
      const args = JSON.parse(line.slice(0, idx).trim());
      const expected = JSON.parse(line.slice(idx + 2).trim());
      if (Array.isArray(args)) out.push({ args, expected });
    } catch {
      /* ongeldige regel overslaan */
    }
  }
  return out;
}

function sanitize(input, existing) {
  const now = new Date().toISOString();
  return {
    id: existing ? existing.id : crypto.randomUUID(),
    title: String(input.title || "").trim() || "Naamloze opdracht",
    language: LANGUAGES.includes(input.language) ? input.language : "python",
    level: LEVELS.includes(input.level) ? input.level : "beginner",
    description: String(input.description || "").trim(),
    learningGoals: toLines(input.learningGoals),
    hints: toLines(input.hints),
    starterCode: String(input.starterCode || ""),
    // Coach-only: nooit naar de student gestuurd, alleen om de coach te sturen.
    solutionNotes: String(input.solutionNotes || "").trim(),
    functionName: String(input.functionName || "").trim(),
    tests: parseTests(input.tests),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
}

/** Wat de student/IDE mag zien: ZONDER solutionNotes. */
function publicView(a) {
  const { solutionNotes, ...rest } = a;
  return rest;
}

/** Didactische context per opdracht — inclusief coach-only notities. Deze blijft
 *  op de server: de oplossingsnotities verlaten de server nooit. */
function assignmentBlock(a) {
  if (!a) return "";
  const goals = (a.learningGoals || []).length ? "\nLeerdoelen: " + a.learningGoals.join(", ") : "";
  const hints = (a.hints || []).length
    ? "\nHint-ladder (gebruik STAPSGEWIJS, nooit in één keer, nooit de oplossing):\n" +
      a.hints.map((h, i) => `${i + 1}. ${h}`).join("\n")
    : "";
  const notes = a.solutionNotes
    ? "\n\nINTERNE OPLOSSINGSNOTITIES (alleen voor jou als coach — deel ze NOOIT en onthul de oplossing niet; gebruik ze enkel om betere hints en vragen te kiezen):\n" +
      a.solutionNotes
    : "";
  return (
    `HUIDIGE OPDRACHT VAN DE STUDENT:\n` +
    `Titel: ${a.title}\n` +
    `Taal: ${a.language} · Niveau: ${a.level}\n` +
    `Omschrijving: ${a.description}` +
    goals +
    hints +
    notes
  );
}

// ---------------------------------------------------------------------------
// Claude-aanroep (server-side). Vereist Node 18+ (global fetch).
// ---------------------------------------------------------------------------
async function anthropic(body) {
  return fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** Eén niet-streamend antwoord; geeft de platte tekst terug. */
async function anthropicText(system, messages, maxTokens) {
  const r = await anthropic({ model: COACH_MODEL, max_tokens: maxTokens, system, messages });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error("Anthropic review-fout", r.status, t.slice(0, 300));
    throw new Error("De coach is even niet beschikbaar (" + r.status + ").");
  }
  const data = await r.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Streamt het antwoord als simpele SSE naar de client: data:{"text":"…"} / data:{"done":true}. */
async function anthropicStream(res, system, messages, maxTokens) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  const emit = (obj) => res.write("data: " + JSON.stringify(obj) + "\n\n");

  let upstream;
  try {
    upstream = await anthropic({ model: COACH_MODEL, max_tokens: maxTokens, system, messages, stream: true });
  } catch (e) {
    emit({ error: "Kon de coach niet bereiken: " + e.message });
    return res.end();
  }
  if (!upstream.ok || !upstream.body) {
    const t = await upstream.text().catch(() => "");
    console.error("Anthropic chat-fout", upstream.status, t.slice(0, 300));
    emit({ error: "De coach is even niet beschikbaar (" + upstream.status + "). Probeer het zo opnieuw." });
    emit({ done: true });
    return res.end();
  }

  // Anthropic SSE parsen en alleen tekst-delta's doorsturen.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") {
            emit({ text: ev.delta.text });
          } else if (ev.type === "error") {
            emit({ error: (ev.error && ev.error.message) || "onbekende fout" });
          }
        } catch {
          /* onvolledige regel; negeren */
        }
      }
    }
  } catch (e) {
    emit({ error: "Streamfout: " + e.message });
  }
  emit({ done: true });
  res.end();
}

// ---------------------------------------------------------------------------
// Auth (optioneel; alleen actief als TEACHER_PASSWORD gezet is)
// ---------------------------------------------------------------------------
const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  crypto.createHash("sha256").update("glu-coach::" + TEACHER_PASSWORD).digest("hex");

function expectedToken() {
  return crypto.createHmac("sha256", AUTH_SECRET).update("docent").digest("hex");
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isAuthed(req) {
  if (!TEACHER_PASSWORD) return true; // geen wachtwoord ingesteld => open
  const tok = parseCookies(req).coach_auth || "";
  const exp = expectedToken();
  return tok.length === exp.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(exp));
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function send(res, status, body, type, extraHeaders) {
  const headers = Object.assign(
    {
      "Content-Type": type || "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-proxy-token",
    },
    extraHeaders || {}
  );
  res.writeHead(status, headers);
  res.end(body);
}
function sendJson(res, status, obj, extraHeaders) {
  send(res, status, JSON.stringify(obj), "application/json; charset=utf-8", extraHeaders);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 4e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve(null);
      }
    });
  });
}
function serveStatic(res, urlPath) {
  let rel = urlPath === "" || urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Verboden", "text/plain");
  fs.readFile(filePath, (err, content) => {
    if (err) return send(res, 404, "Niet gevonden", "text/plain");
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, content, MIME[ext] || "application/octet-stream");
  });
}
function cookieHeader(value, maxAge) {
  const parts = [
    `coach_auth=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    `Path=${BASE_PATH || "/"}`,
    `Max-Age=${maxAge}`,
  ];
  return { "Set-Cookie": parts.join("; ") };
}

// ---------------------------------------------------------------------------
// Misbruik-/kostenrem voor de coach-endpoints (in-memory; reset bij herstart).
// Let op: achter NAT delen studenten één IP — houd de burst-limiet ruim.
// ---------------------------------------------------------------------------
const rl = { ipHits: new Map(), day: "", dayCount: 0 };
function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.socket.remoteAddress || "onbekend";
}
function checkCoachLimits(req) {
  const now = Date.now();
  if (COACH_MAX_PER_DAY > 0) {
    const today = new Date(now).toISOString().slice(0, 10);
    if (rl.day !== today) {
      rl.day = today;
      rl.dayCount = 0;
    }
    if (rl.dayCount >= COACH_MAX_PER_DAY) {
      return { ok: false, code: 429, msg: "De coach heeft vandaag het maximum aantal vragen bereikt. Probeer het morgen weer." };
    }
  }
  if (COACH_RATE_PER_MIN > 0) {
    const ip = clientIp(req);
    const arr = (rl.ipHits.get(ip) || []).filter((t) => now - t < 60000);
    if (arr.length >= COACH_RATE_PER_MIN) {
      return { ok: false, code: 429, msg: "Even rustig aan 🙂 Te veel vragen achter elkaar. Wacht een halve minuut en probeer opnieuw." };
    }
    arr.push(now);
    rl.ipHits.set(ip, arr);
  }
  if (COACH_MAX_PER_DAY > 0) rl.dayCount++;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(parsed.pathname);

  if (req.method === "OPTIONS") return send(res, 204, "");

  if (pathname === "/" || pathname === "") {
    res.writeHead(302, { Location: BASE_PATH + "/" });
    return res.end();
  }
  if (pathname !== BASE_PATH && !pathname.startsWith(BASE_PATH + "/")) {
    return send(res, 404, "Niet gevonden", "text/plain");
  }
  let sub = pathname.slice(BASE_PATH.length);
  if (sub === "") {
    res.writeHead(302, { Location: BASE_PATH + "/" });
    return res.end();
  }

  // ---- API ----
  if (sub.startsWith("/api/")) {
    const apiPath = sub.slice("/api".length);

    if (apiPath === "/health") {
      return sendJson(res, 200, {
        ok: true,
        base: BASE_PATH,
        count: loadAssignments().length,
        coachReady: !!ANTHROPIC_API_KEY,
      });
    }

    // --- Coach-proxy: de server praat met Claude, de student heeft GEEN sleutel nodig ---
    if (apiPath === "/coach/chat" || apiPath === "/coach/review") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "POST verwacht" });
      if (PROXY_TOKEN && req.headers["x-proxy-token"] !== PROXY_TOKEN) {
        return sendJson(res, 401, { error: "Geen toegang tot de coach" });
      }
      const lim = checkCoachLimits(req);
      if (!lim.ok) return sendJson(res, lim.code, { error: lim.msg });
      if (!ANTHROPIC_API_KEY) {
        return sendJson(res, 503, {
          error: "De coach is nog niet geconfigureerd (ANTHROPIC_API_KEY ontbreekt op de server).",
        });
      }
      const body = await readBody(req);
      if (!body) return sendJson(res, 400, { error: "Ongeldige JSON" });
      const a = loadAssignments().find((x) => x.id === body.assignmentId) || null;

      if (apiPath === "/coach/chat") {
        if (!Array.isArray(body.messages) || !body.messages.length) {
          return sendJson(res, 400, { error: "messages ontbreekt" });
        }
        if (JSON.stringify(body.messages).length > 200000) {
          return sendJson(res, 413, { error: "Je gesprek is te groot geworden. Klik op 'Gesprek opnieuw beginnen'." });
        }
        const system =
          CHAT_SYSTEM +
          "\n\n" +
          assignmentBlock(a) +
          (body.mode === "test" ? TEST_FEEDBACK_EXTRA : "") +
          langDir(body.lang);
        return anthropicStream(res, system, body.messages, 1024);
      }
      // /coach/review (niet-streamend, kort)
      const prompt =
        assignmentBlock(a) +
        `\n\nTaal van het bestand: ${body.languageId || "onbekend"}\n` +
        "Code die de student nu heeft:\n```\n" +
        String(body.code || "").slice(0, 6000) +
        "\n```";
      try {
        const text = await anthropicText(REVIEW_SYSTEM + langDir(body.lang), [{ role: "user", content: prompt }], 150);
        return sendJson(res, 200, { text });
      } catch (e) {
        return sendJson(res, 502, { error: e.message });
      }
    }
    if (apiPath === "/me") {
      return sendJson(res, 200, { authRequired: !!TEACHER_PASSWORD, authed: isAuthed(req) });
    }
    if (apiPath === "/login" && req.method === "POST") {
      const body = await readBody(req);
      if (!TEACHER_PASSWORD) return sendJson(res, 200, { ok: true, authed: true });
      if (body && String(body.password) === TEACHER_PASSWORD) {
        return sendJson(res, 200, { ok: true, authed: true }, cookieHeader(expectedToken(), 60 * 60 * 12));
      }
      return sendJson(res, 401, { error: "Onjuist wachtwoord" });
    }
    if (apiPath === "/logout" && req.method === "POST") {
      return sendJson(res, 200, { ok: true }, cookieHeader("", 0));
    }

    // Export / import (docent)
    if (apiPath === "/export" && req.method === "GET") {
      if (!isAuthed(req)) return sendJson(res, 401, { error: "Niet ingelogd" });
      return sendJson(res, 200, loadAssignments());
    }
    if (apiPath === "/import" && req.method === "POST") {
      if (!isAuthed(req)) return sendJson(res, 401, { error: "Niet ingelogd" });
      const body = await readBody(req);
      const arr = Array.isArray(body) ? body : Array.isArray(body && body.assignments) ? body.assignments : null;
      if (!arr) return sendJson(res, 400, { error: "Verwacht een JSON-array van opdrachten" });
      const cleaned = arr.map((a) => sanitize(a));
      saveAssignments(cleaned);
      return sendJson(res, 200, { ok: true, count: cleaned.length });
    }

    const m = apiPath.match(/^\/assignments(?:\/([^/]+))?$/);
    if (m) {
      const id = m[1];
      let list = loadAssignments();

      // Lezen is publiek (de IDE heeft titel/omschrijving/hints/tests nodig).
      // Coach-only 'solutionNotes' worden ALTIJD weggelaten — de coach krijgt die
      // server-side via de proxy, dus ze verlaten de server nooit.
      if (req.method === "GET" && !id) return sendJson(res, 200, list.map(publicView));
      if (req.method === "GET" && id) {
        const item = list.find((a) => a.id === id);
        return item ? sendJson(res, 200, publicView(item)) : sendJson(res, 404, { error: "Niet gevonden" });
      }

      // Schrijven vereist (indien ingesteld) docent-login.
      if (["POST", "PUT", "DELETE"].includes(req.method) && !isAuthed(req)) {
        return sendJson(res, 401, { error: "Niet ingelogd" });
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        if (!body) return sendJson(res, 400, { error: "Ongeldige JSON" });
        const item = sanitize(body);
        list.push(item);
        saveAssignments(list);
        return sendJson(res, 201, item);
      }
      if (req.method === "PUT" && id) {
        const body = await readBody(req);
        if (!body) return sendJson(res, 400, { error: "Ongeldige JSON" });
        const idx = list.findIndex((a) => a.id === id);
        if (idx === -1) return sendJson(res, 404, { error: "Niet gevonden" });
        list[idx] = sanitize(body, list[idx]);
        saveAssignments(list);
        return sendJson(res, 200, list[idx]);
      }
      if (req.method === "DELETE" && id) {
        saveAssignments(list.filter((a) => a.id !== id));
        return sendJson(res, 200, { ok: true });
      }
    }
    return sendJson(res, 404, { error: "Onbekend API-pad" });
  }

  // ---- Statisch dashboard / install-pagina ----
  if (req.method === "GET" && (sub === "/install" || sub === "/install/")) {
    return serveStatic(res, "/install.html");
  }
  if (req.method === "GET") return serveStatic(res, sub);
  return send(res, 405, "Methode niet toegestaan", "text/plain");
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`GLU Coding Coach draait op http://localhost:${PORT}${BASE_PATH}/`);
  if (TEACHER_PASSWORD) console.log("Docent-login is ingeschakeld (TEACHER_PASSWORD gezet).");
  console.log(
    ANTHROPIC_API_KEY
      ? `Coach actief (model ${COACH_MODEL})${PROXY_TOKEN ? ", proxy-token vereist" : ""}.`
      : "LET OP: ANTHROPIC_API_KEY niet gezet — de coach-chat werkt nog niet."
  );
  console.log(
    "Limieten: " +
      (COACH_RATE_PER_MIN ? COACH_RATE_PER_MIN + "/min per IP" : "geen burst-limiet") +
      ", " +
      (COACH_MAX_PER_DAY ? COACH_MAX_PER_DAY + "/dag globaal" : "geen daglimiet") +
      (PROXY_TOKEN ? ", proxy-token aan" : "") +
      "."
  );
});
