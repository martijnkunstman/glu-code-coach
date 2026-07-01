// GLU Code Coach — VS Code extensie
//
// ZERO-DREMPEL voor de student: VS Code openen en gaan. Geen API-sleutel, geen
// server starten, geen config. De school-server (apiBaseUrl) doet de Claude-
// aanroepen met één centrale sleutel; de extensie praat alleen met die server.
//
// - Chat: streaming via {apiBaseUrl}/api/coach/chat
// - Meekijken: korte review via {apiBaseUrl}/api/coach/review
// - Opdrachten: {apiBaseUrl}/api/assignments (dropdown)
// - Toets mijn code: lokaal via runner.js, feedback weer via de coach
// - Onthoudt opdracht + gesprek na herladen
//
// Didactiek staat server-side (de oplossingsnotities verlaten de server nooit).

const vscode = require("vscode");
const runner = require("./runner.js");

const STATE_KEY = "studentCoach.state";

// Voor LOKALE modus (Ollama) bouwt de extensie de prompt zelf. Deze teksten zijn
// niet geheim (generieke coach-instructies); de opdracht-context bevat NOOIT de
// coach-only oplossingsnotities (die staan alleen server-side).
const CHAT_SYSTEM =
  "Je bent een vriendelijke, geduldige programmeer-coach voor een student (mbo/hbo-niveau). " +
  "Je begeleidt de student bij het ZÉLF voltooien van een opdracht. Jullie ontdekken de oplossing samen.\n\n" +
  "HARDE REGELS — hier wijk je nooit van af:\n" +
  "- Geef NOOIT de complete of werkende oplossing, ook niet als de student er expliciet om vraagt of gefrustreerd is.\n" +
  "- Schrijf de opdracht nooit voor de student af. Kleine illustratiefragmentjes (1-2 regels die NIET de opgave oplossen) mogen.\n" +
  "- Werk Socratisch: stel eerst een gerichte wedervraag of laat de student eerst zelf proberen, vóór je een hint geeft.\n\n" +
  "WERKWIJZE: gebruik de hint-ladder stapsgewijs (begin vaag); knip op in kleine stappen; moedig aan om te draaien en te testen; koppel terug aan de leerdoelen; vier kleine stappen.\n" +
  "STIJL: kort en warm, af en toe een emoji, `backticks` voor code, markdown waar dat helpt. Sluit af met een vraag of kleine vervolgstap.";
const REVIEW_SYSTEM =
  "Je kijkt mee met de code die een student NU aan het typen is. Beoordeel of er één duidelijke, behulpzame opmerking is " +
  "(typefout in een keyword, een duidelijke bug, of een aanpak die niet bij de opdracht past).\n" +
  "REGELS: geef NOOIT de oplossing; wijs alleen de richting met een vraag/denkstap. Meld GEEN ontbrekende haakjes of half-afgemaakte regels.\n" +
  'ANTWOORD: iets nuttigs? Eén korte hint (max 2 zinnen) beginnend met "👀". Anders EXACT: NONE';
const TEST_FEEDBACK_EXTRA =
  "\n\nDe student heeft zojuist de code getoetst (zie het gespreksverloop). Bespreek kort en bemoedigend wat de MISLUKTE " +
  "gevallen onthullen en welke denkstap dat suggereert. Stel een gerichte vraag of geef hooguit de volgende hint. " +
  "Onthul NOOIT de juiste code. Bij alles geslaagd: feliciteer kort en stel eventueel een verdiepende vraag.";

function clientAssignmentBlock(a) {
  if (!a) return "";
  const goals = (a.learningGoals || []).length ? "\nLeerdoelen: " + a.learningGoals.join(", ") : "";
  const hints = (a.hints || []).length
    ? "\nHint-ladder (gebruik STAPSGEWIJS, nooit in één keer, nooit de oplossing):\n" +
      a.hints.map((h, i) => `${i + 1}. ${h}`).join("\n")
    : "";
  return (
    `HUIDIGE OPDRACHT VAN DE STUDENT:\nTitel: ${a.title}\n` +
    `Taal: ${a.language} · Niveau: ${a.level}\nOmschrijving: ${a.description}` +
    goals +
    hints
  );
}

// Taal van de coach (de student kiest dit in het ⚙️-scherm).
const LANG_DIRECTIVE = {
  nl: "\n\nBELANGRIJK: schrijf AL je antwoorden in het Nederlands.",
  en: "\n\nIMPORTANT: Write ALL your responses in English, regardless of the language of the assignment or the student's messages.",
  de: "\n\nWICHTIG: Schreibe ALLE deine Antworten auf Deutsch, unabhängig von der Sprache der Aufgabe oder der Nachrichten des Studenten.",
};
function langDir(lang) {
  return LANG_DIRECTIVE[lang] || LANG_DIRECTIVE.nl;
}

// Systeemregels die de extensie zélf in de chat/UI zet (niet de LLM).
const MSG = {
  nl: {
    noTest: "Deze opdracht heeft geen automatische toets. 🙂 Stel gerust een vraag!",
    openFile: "Open eerst je codebestand in de editor, dan kan ik je code toetsen. 📄",
    noCode: "Er staat nog (bijna) geen code in dit bestand. Begin met een eerste poging! 💪",
    coachNoBase: "⚠️ Ik kan de coach-server niet vinden. Controleer `studentCoach.apiBaseUrl`.",
    coachDown: (s) => "De coach is even niet bereikbaar (" + s + ").",
    connErr: (m) => "⚠️ Verbindingsfout met de coach: " + m,
    ollamaNoAnswer: (extra, model) =>
      "⚠️ Lokale AI (Ollama) antwoordde niet" + extra + ". Draait Ollama en is het model `" + model + "` geïnstalleerd? (`ollama pull " + model + "`)",
    ollamaUnreachable: (m) => "⚠️ Kon de lokale AI (Ollama) niet bereiken: " + m + ". Staat Ollama aan?",
    noAnswer: "(geen antwoord)",
    unsupportedLang: (id) => "🧪 Automatisch toetsen wordt nog niet ondersteund voor '" + id + "'.",
  },
  en: {
    noTest: "This assignment has no automatic test. 🙂 Feel free to ask a question!",
    openFile: "Open your code file in the editor first, then I can test your code. 📄",
    noCode: "There's (almost) no code in this file yet. Make a first attempt! 💪",
    coachNoBase: "⚠️ I can't find the coach server. Check `studentCoach.apiBaseUrl`.",
    coachDown: (s) => "The coach is temporarily unreachable (" + s + ").",
    connErr: (m) => "⚠️ Connection error with the coach: " + m,
    ollamaNoAnswer: (extra, model) =>
      "⚠️ Local AI (Ollama) didn't respond" + extra + ". Is Ollama running and is the model `" + model + "` installed? (`ollama pull " + model + "`)",
    ollamaUnreachable: (m) => "⚠️ Couldn't reach the local AI (Ollama): " + m + ". Is Ollama running?",
    noAnswer: "(no answer)",
    unsupportedLang: (id) => "🧪 Automatic testing isn't supported yet for '" + id + "'.",
  },
  de: {
    noTest: "Diese Aufgabe hat keinen automatischen Test. 🙂 Stell ruhig eine Frage!",
    openFile: "Öffne zuerst deine Code-Datei im Editor, dann kann ich deinen Code testen. 📄",
    noCode: "In dieser Datei steht noch (fast) kein Code. Mach einen ersten Versuch! 💪",
    coachNoBase: "⚠️ Ich kann den Coach-Server nicht finden. Prüfe `studentCoach.apiBaseUrl`.",
    coachDown: (s) => "Der Coach ist gerade nicht erreichbar (" + s + ").",
    connErr: (m) => "⚠️ Verbindungsfehler mit dem Coach: " + m,
    ollamaNoAnswer: (extra, model) =>
      "⚠️ Lokale KI (Ollama) hat nicht geantwortet" + extra + ". Läuft Ollama und ist das Modell `" + model + "` installiert? (`ollama pull " + model + "`)",
    ollamaUnreachable: (m) => "⚠️ Konnte die lokale KI (Ollama) nicht erreichen: " + m + ". Läuft Ollama?",
    noAnswer: "(keine Antwort)",
    unsupportedLang: (id) => "🧪 Automatisches Testen wird für '" + id + "' noch nicht unterstützt.",
  },
};
function msg(lang) {
  return MSG[lang] || MSG.nl;
}
const GREETINGS = {
  nl: (t, d) =>
    "Hoi! Ik ben je coding coach. 👋\n\n" +
    `Je werkt aan: **${t}**\n"${d}"\n\n` +
    "Ik help je het zélf op te lossen — geen kant-en-klare antwoorden, maar hints en vragen. We ontdekken het samen. 🙂\n\n" +
    "Hoe zou je deze opdracht in je eigen woorden omschrijven?",
  en: (t, d) =>
    "Hi! I'm your coding coach. 👋\n\n" +
    `You're working on: **${t}**\n"${d}"\n\n` +
    "I'll help you solve it yourself — no ready-made answers, just hints and questions. We'll figure it out together. 🙂\n\n" +
    "How would you describe this assignment in your own words?",
  de: (t, d) =>
    "Hallo! Ich bin dein Coding-Coach. 👋\n\n" +
    `Du arbeitest an: **${t}**\n"${d}"\n\n` +
    "Ich helfe dir, es selbst zu lösen — keine fertigen Antworten, sondern Hinweise und Fragen. Wir finden es gemeinsam heraus. 🙂\n\n" +
    "Wie würdest du diese Aufgabe in eigenen Worten beschreiben?",
};

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const provider = new CoachViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CoachViewProvider.viewType, provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("studentCoach.resetChat", () => provider.reset()),
    vscode.commands.registerCommand("studentCoach.testCode", () => provider.testActiveCode())
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && e.document === editor.document) provider.scheduleAnalysis(e.document);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      provider.resetObservations();
      if (editor) provider.scheduleAnalysis(editor.document, 600);
    })
  );
}

function deactivate() {}

class CoachViewProvider {
  static viewType = "studentCoach.chat";

  /** @param {vscode.ExtensionContext} context */
  constructor(context) {
    this.context = context;
    this.messages = [];
    this.transcript = [];
    this.assignments = [];
    this.currentAssignment = null;
    this.proactive = vscode.workspace.getConfiguration("studentCoach").get("proactive", true);
    this.debounce = null;
    this.lastAnalyzedCode = "";
    this.lastObservation = "";
  }

  cfg(key, fallback) {
    return vscode.workspace.getConfiguration("studentCoach").get(key, fallback);
  }
  apiBase() {
    return (this.cfg("apiBaseUrl", "") || "").replace(/\/$/, "");
  }
  proxyHeaders() {
    const h = { "content-type": "application/json" };
    const tok = this.cfg("proxyToken", "");
    if (tok) h["x-proxy-token"] = tok;
    return h;
  }
  aiMode() {
    return this.cfg("aiMode", "remote") === "local" ? "local" : "remote";
  }
  ollamaBase() {
    return (this.cfg("ollamaUrl", "http://localhost:11434") || "").replace(/\/$/, "");
  }
  ollamaModel() {
    return this.cfg("ollamaModel", "llama3.1");
  }
  language() {
    const l = this.cfg("language", "nl");
    return ["nl", "en", "de"].includes(l) ? l : "nl";
  }

  /** Stabiel, anoniem ID per plugin-installatie (voor ontwikkelmonitoring). */
  installId() {
    const KEY = "studentCoach.installId";
    let id = this.context.globalState.get(KEY);
    if (!id) {
      try {
        id = require("crypto").randomUUID();
      } catch {
        id = "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      }
      this.context.globalState.update(KEY, id);
    }
    return id;
  }
  /** Optionele, door de student zelf ingevoerde naam (voor de docent). */
  studentName() {
    return this.context.globalState.get("studentCoach.studentName", "") || "";
  }
  /** Identiteitsvelden die met elke server-call meegaan. */
  identity() {
    return { installId: this.installId(), studentName: this.studentName() };
  }

  /** Roept de lokale Ollama aan; streamt deltas via emit(); geeft de volledige tekst terug. */
  async callOllama(system, messages, emit) {
    const url = this.ollamaBase() + "/api/chat";
    const model = this.ollamaModel();
    let full = "";
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, stream: true, messages: [{ role: "system", content: system }, ...messages] }),
      });
      if (!resp.ok || !resp.body) {
        let extra = "";
        try {
          const j = await resp.json();
          if (j && j.error) extra = " (" + j.error + ")";
        } catch {}
        emit(msg(this.language()).ollamaNoAnswer(extra, model));
        return full;
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            const t = ev.message && ev.message.content;
            if (t) {
              full += t;
              emit(t);
            }
          } catch {}
        }
      }
    } catch (e) {
      emit(msg(this.language()).ollamaUnreachable(e.message));
    }
    return full;
  }

  /** Best-effort logging van een lokale (Ollama) call naar de server, voor monitoring. */
  logLocal(mode, ok) {
    const base = this.apiBase();
    if (!base) return;
    fetch(base + "/api/log", {
      method: "POST",
      headers: this.proxyHeaders(),
      body: JSON.stringify({
        model: this.ollamaModel(),
        mode,
        assignmentId: this.currentAssignment && this.currentAssignment.id,
        ok: !!ok,
        ...this.identity(),
      }),
    }).catch(() => {});
  }

  /** Stuur het resultaat van een code-toets naar de server (voor de docent-monitor).
   *  Bevat GEEN broncode — alleen de score, zodat de ontwikkeling per opdracht volgbaar is. */
  recordTestEvent(a, res) {
    const base = this.apiBase();
    if (!base) return;
    const body = {
      ...this.identity(),
      assignmentId: a && a.id,
      source: this.aiMode() === "local" ? "local" : "remote",
    };
    if (res && res.summary) {
      body.testsTotal = res.summary.total;
      body.testsPassed = res.summary.passed;
      body.ok = res.summary.passed >= res.summary.total;
    } else {
      body.ok = false;
    }
    fetch(base + "/api/event", {
      method: "POST",
      headers: this.proxyHeaders(),
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  buildLocalSystem(mode) {
    return (
      CHAT_SYSTEM +
      "\n\n" +
      clientAssignmentBlock(this.currentAssignment) +
      (mode === "test" ? TEST_FEEDBACK_EXTRA : "") +
      langDir(this.language())
    );
  }

  /** Detecteer of Ollama draait en welke modellen geïnstalleerd zijn. */
  async detectOllama() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(this.ollamaBase() + "/api/tags", { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) return { running: false, models: [] };
      const j = await r.json();
      return { running: true, models: (j.models || []).map((m) => m.name) };
    } catch {
      return { running: false, models: [] };
    }
  }

  /** @param {vscode.WebviewView} webviewView */
  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "userMessage") await this.handleUserMessage(msg.text);
      else if (msg.type === "ready") await this.onReady();
      else if (msg.type === "selectAssignment") this.selectAssignment(msg.id);
      else if (msg.type === "testCode") await this.testActiveCode();
      else if (msg.type === "setProactive") {
        this.proactive = msg.value;
        if (this.proactive && vscode.window.activeTextEditor) {
          this.scheduleAnalysis(vscode.window.activeTextEditor.document, 400);
        }
      } else if (msg.type === "openConfig") {
        const ollama = await this.detectOllama();
        this.post({
          type: "configData",
          aiMode: this.aiMode(),
          language: this.language(),
          ollamaModel: this.ollamaModel(),
          ollamaUrl: this.ollamaBase(),
          studentName: this.studentName(),
          ollama,
        });
      } else if (msg.type === "saveConfig") {
        const conf = vscode.workspace.getConfiguration("studentCoach");
        await conf.update("aiMode", msg.aiMode === "local" ? "local" : "remote", vscode.ConfigurationTarget.Global);
        if (["nl", "en", "de"].includes(msg.language)) {
          await conf.update("language", msg.language, vscode.ConfigurationTarget.Global);
        }
        if (msg.ollamaModel) await conf.update("ollamaModel", msg.ollamaModel, vscode.ConfigurationTarget.Global);
        if (typeof msg.studentName === "string") {
          await this.context.globalState.update("studentCoach.studentName", msg.studentName.trim().slice(0, 60));
        }
        this.post({ type: "aiMode", value: this.aiMode() });
        this.post({ type: "lang", value: this.language() });
      } else if (msg.type === "saveName") {
        const nm = String(msg.value || "").trim().slice(0, 60);
        if (nm) await this.context.globalState.update("studentCoach.studentName", nm);
        await this.context.globalState.update("studentCoach.nameAsked", true);
      } else if (msg.type === "skipName") {
        await this.context.globalState.update("studentCoach.nameAsked", true);
      } else if (msg.type === "reset") this.reset();
    });
  }

  post(message) {
    if (this.view) this.view.webview.postMessage(message);
  }

  // --- Opstart / herstel ---
  async onReady() {
    this.post({ type: "proactiveState", value: this.proactive });
    this.post({ type: "aiMode", value: this.aiMode() });
    this.post({ type: "lang", value: this.language() });
    const saved = this.context.workspaceState.get(STATE_KEY);
    if (saved && saved.assignmentId) this._restoreId = saved.assignmentId;
    await this.loadAssignments();

    if (
      saved &&
      saved.assignmentId === (this.currentAssignment && this.currentAssignment.id) &&
      Array.isArray(saved.messages) &&
      saved.messages.length &&
      Array.isArray(saved.transcript) &&
      saved.transcript.length
    ) {
      this.messages = saved.messages;
      this.transcript = saved.transcript;
      this.post({ type: "restore", items: this.transcript });
    } else {
      await this.openConversation();
    }
    this.postCanTest();

    // Eenmalig, vriendelijk vragen om een (nick)name zodat de docent de voortgang
    // aan een persoon kan koppelen. Niet verplicht; we vragen het maar één keer.
    if (!this.studentName() && !this.context.globalState.get("studentCoach.nameAsked")) {
      this.post({ type: "askName" });
    }
  }

  saveState() {
    this.context.workspaceState.update(STATE_KEY, {
      assignmentId: this.currentAssignment && this.currentAssignment.id,
      messages: this.messages,
      transcript: this.transcript,
    });
  }
  pushTranscript(who, text) {
    this.transcript.push({ who, text });
  }

  // --- Opdrachten ophalen ---
  async loadAssignments() {
    const base = this.apiBase();
    let items = [];
    if (base) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(base + "/api/assignments", { signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) items = await res.json();
      } catch (e) {
        console.error("Coding Coach: opdrachten ophalen mislukt:", e.message);
      }
    }
    if (!Array.isArray(items) || items.length === 0) {
      items = [
        {
          id: "lokaal",
          title: "Lokale opdracht",
          language: "overig",
          level: "beginner",
          description: this.cfg("assignment", "Geen opdracht ingesteld."),
        },
      ];
    }
    this.assignments = items;
    const preferId = (this.currentAssignment && this.currentAssignment.id) || this._restoreId;
    this.currentAssignment = items.find((a) => a.id === preferId) || items[0];
    this.post({
      type: "assignments",
      items: items.map((a) => ({ id: a.id, title: a.title, language: a.language, level: a.level })),
      currentId: this.currentAssignment.id,
    });
    this.postAssignmentCard();
  }

  postAssignmentCard() {
    const a = this.currentAssignment;
    if (a) this.post({ type: "assignment", title: a.title, text: a.description });
  }
  postCanTest() {
    const a = this.currentAssignment;
    this.post({ type: "canTest", value: !!(a && a.functionName && (a.tests || []).length) });
  }

  selectAssignment(id) {
    const a = this.assignments.find((x) => x.id === id);
    if (!a) return;
    this.currentAssignment = a;
    this.messages = [];
    this.transcript = [];
    this.resetObservations();
    this.post({ type: "clearChat" });
    this.postAssignmentCard();
    this.postCanTest();
    this.openConversation();
  }

  reset() {
    this.messages = [];
    this.transcript = [];
    this.lastObservation = "";
    this.post({ type: "clearChat" });
    this.openConversation();
  }
  resetObservations() {
    this.lastObservation = "";
    this.lastAnalyzedCode = "";
  }

  async openConversation() {
    if (this.messages.length > 0) return;
    const a = this.currentAssignment;
    const title = a ? a.title : "je opdracht";
    const desc = a ? a.description : "";
    const greeting = (GREETINGS[this.language()] || GREETINGS.nl)(title, desc);
    this.messages.push({ role: "user", content: "Ik wil aan de opdracht beginnen." });
    this.messages.push({ role: "assistant", content: greeting });
    this.pushTranscript("coach", greeting);
    this.post({ type: "coachStart" });
    this.post({ type: "coachDelta", text: greeting });
    this.post({ type: "coachEnd" });
    this.saveState();
  }

  // --- Chat via de coach-proxy ---
  async handleUserMessage(text) {
    this.messages.push({ role: "user", content: text });
    this.pushTranscript("user", text);
    await this.streamCoach("chat");
  }

  /** Streamt het coach-antwoord naar de webview, via lokaal (Ollama) of remote (server). */
  async streamCoach(mode) {
    this.post({ type: "coachStart" });
    let full = "",
      shown = "";
    const emit = (t) => {
      shown += t;
      this.post({ type: "coachDelta", text: t });
    };

    if (this.aiMode() === "local") {
      full = await this.callOllama(this.buildLocalSystem(mode), this.messages, emit);
      this.logLocal(mode, !!full.trim());
    } else {
      const base = this.apiBase();
      if (!base) {
        emit(msg(this.language()).coachNoBase);
      } else {
        try {
          const resp = await fetch(base + "/api/coach/chat", {
            method: "POST",
            headers: this.proxyHeaders(),
            body: JSON.stringify({
              assignmentId: this.currentAssignment && this.currentAssignment.id,
              messages: this.messages,
              mode,
              lang: this.language(),
              ...this.identity(),
            }),
          });
          if (!resp.ok || !resp.body) {
            let detail = msg(this.language()).coachDown(resp.status);
            try {
              const j = await resp.json();
              if (j.error) detail = j.error;
            } catch {}
            emit("⚠️ " + detail);
          } else {
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            let done = false;
            while (!done) {
              const { value, done: rdone } = await reader.read();
              if (rdone) break;
              buf += decoder.decode(value, { stream: true });
              let i;
              while ((i = buf.indexOf("\n\n")) !== -1) {
                const chunk = buf.slice(0, i);
                buf = buf.slice(i + 2);
                const line = chunk.split("\n").find((l) => l.startsWith("data:"));
                if (!line) continue;
                try {
                  const ev = JSON.parse(line.slice(5).trim());
                  if (ev.text) {
                    full += ev.text;
                    emit(ev.text);
                  } else if (ev.error) {
                    emit("\n\n⚠️ " + ev.error);
                  } else if (ev.done) {
                    done = true;
                  }
                } catch {}
              }
            }
          }
        } catch (e) {
          emit(msg(this.language()).connErr(e.message));
        }
      }
    }

    if (full.trim()) this.messages.push({ role: "assistant", content: full });
    this.pushTranscript("coach", shown || msg(this.language()).noAnswer);
    this.post({ type: "coachEnd" });
    this.saveState();
  }

  showCoachLine(text) {
    this.pushTranscript("coach", text);
    this.post({ type: "coachStart" });
    this.post({ type: "coachDelta", text });
    this.post({ type: "coachEnd" });
    this.saveState();
  }

  // --- Toets mijn code (lokaal) ---
  async testActiveCode() {
    const m = msg(this.language());
    const a = this.currentAssignment;
    if (!a || !a.functionName || !(a.tests || []).length) {
      return this.showCoachLine(m.noTest);
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return this.showCoachLine(m.openFile);
    }
    const code = editor.document.getText();
    if (code.trim().length < 3) {
      return this.showCoachLine(m.noCode);
    }
    this.post({ type: "testRunning" });
    let res;
    try {
      res = await runner.runTests(editor.document.languageId, code, a.functionName, a.tests, {
        pythonCmd: this.cfg("pythonPath", "python3"),
      });
    } catch (e) {
      res = { supported: true, error: e.message };
    }
    if (!res.supported) return this.showCoachLine(msg(this.language()).unsupportedLang(editor.document.languageId));

    const data = res.error
      ? { error: res.error, functionName: a.functionName }
      : { summary: res.summary, results: res.results, functionName: a.functionName };
    this.post({ type: "testResult", data });
    this.pushTranscript("testresult", data);
    this.saveState();
    this.recordTestEvent(a, res);

    await this.coachOnTest(a, res, code);
  }

  async coachOnTest(a, res, code) {
    let summaryText;
    if (res.error) {
      summaryText = `Ik heb mijn code laten toetsen, maar er ging iets mis bij het uitvoeren:\n${res.error}`;
    } else {
      const lines = res.results
        .map((r) => {
          const args = (r.args || []).map((x) => JSON.stringify(x)).join(", ");
          const got = r.error ? "FOUT: " + r.error : JSON.stringify(r.got);
          return `- ${a.functionName}(${args}) → verwacht ${JSON.stringify(r.expected)}, kreeg ${got} [${r.pass ? "GESLAAGD" : "MISLUKT"}]`;
        })
        .join("\n");
      summaryText = `Ik heb mijn code laten toetsen: ${res.summary.passed}/${res.summary.total} geslaagd.\n${lines}`;
    }
    const hidden =
      summaryText +
      "\n\nMijn huidige code:\n```\n" +
      code.slice(0, 3000) +
      "\n```\n\nGeef me feedback die me helpt het zélf op te lossen — niet de oplossing.";
    this.messages.push({ role: "user", content: hidden });
    await this.streamCoach("test");
  }

  // --- Meekijken via de coach-proxy ---
  scheduleAnalysis(document, delay = 1800) {
    if (!this.proactive || !this.view) return;
    if (document.uri.scheme !== "file") return;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.runAnalysis(document), delay);
  }

  async runAnalysis(document) {
    const code = document.getText();
    if (code.trim().length < 10) return;
    if (code === this.lastAnalyzedCode) return;
    this.lastAnalyzedCode = code;
    if (!this.currentAssignment) return;
    const clipped = code.slice(0, 6000);

    let out = "";
    try {
      if (this.aiMode() === "local") {
        const prompt =
          clientAssignmentBlock(this.currentAssignment) +
          `\n\nTaal van het bestand: ${document.languageId}\nCode die de student nu heeft:\n\`\`\`\n${clipped}\n\`\`\``;
        out = (await this.callOllama(REVIEW_SYSTEM + langDir(this.language()), [{ role: "user", content: prompt }], () => {})).trim();
        this.logLocal("review", true);
      } else {
        const base = this.apiBase();
        if (!base) return;
        const resp = await fetch(base + "/api/coach/review", {
          method: "POST",
          headers: this.proxyHeaders(),
          body: JSON.stringify({ assignmentId: this.currentAssignment.id, code: clipped, languageId: document.languageId, lang: this.language(), ...this.identity() }),
        });
        if (!resp.ok) return;
        out = ((await resp.json()).text || "").trim();
      }
    } catch (err) {
      console.error("Coding Coach review-fout:", err.message);
      return;
    }
    if (!out || out.toUpperCase().includes("NONE")) return;
    if (out === this.lastObservation) return;
    this.lastObservation = out;
    this.pushTranscript("observation", out);
    this.post({ type: "observation", text: out });
    this.saveState();
  }

  /** @param {vscode.Webview} webview */
  getHtml(webview) {
    const nonce = getNonce();
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "style.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js")
    );
    return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Coding Coach</title>
</head>
<body>
  <div class="header">
    <span class="title">🎓 Coding Coach</span>
    <span class="header-actions">
      <button id="watchToggle" class="toggle">👀 Meekijken</button>
      <button id="configBtn" class="toggle" title="Instellingen">⚙️</button>
    </span>
  </div>
  <div class="picker">
    <label id="assignmentLabel" for="assignmentSelect">Opdracht</label>
    <select id="assignmentSelect"></select>
  </div>
  <div id="assignment" class="assignment"></div>

  <div id="configPanel" class="configpanel" hidden>
    <h3 id="cfgHeading">Instellingen</h3>
    <label class="cfg-label" id="cfgNameLabel">Je naam (optioneel — voor je docent)</label>
    <input id="cfgName" type="text" class="cfg-input" maxlength="60" placeholder="bijv. je naam of studentnummer"
      style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--vscode-input-border,#555);background:var(--vscode-input-background);color:var(--vscode-input-foreground);margin-bottom:6px" />
    <label class="cfg-label" id="cfgLangLabel">Taal van de coach</label>
    <select id="cfgLang">
      <option value="nl">Nederlands</option>
      <option value="en">English</option>
      <option value="de">Deutsch</option>
    </select>
    <label class="cfg-label" id="cfgAiLabel">AI-tutor</label>
    <select id="cfgAiMode">
      <option value="remote">Remote — via de school-server (standaard)</option>
      <option value="local">Lokaal — via Ollama op deze laptop</option>
    </select>
    <div id="ollamaBox" hidden>
      <div id="ollamaStatus" class="ollama-status"></div>
      <label class="cfg-label" id="cfgModelLabel">Lokaal model</label>
      <select id="cfgOllamaModel"></select>
      <button id="ollamaRefresh" class="toggle">↻ Opnieuw zoeken</button>
    </div>
    <div class="cfg-actions">
      <button id="cfgSave" class="test-btn">Opslaan</button>
      <button id="cfgClose" class="toggle">Sluiten</button>
    </div>
  </div>

  <div id="messages" class="messages"></div>
  <div id="suggestions" class="suggestions"></div>
  <div id="testbar" class="testbar" hidden>
    <button id="testBtn" class="test-btn">🧪 Toets mijn code</button>
  </div>
  <div class="composer">
    <textarea id="input" rows="1" placeholder="Stel een vraag of beschrijf waar je vastloopt…"></textarea>
    <button id="send" title="Versturen">▶</button>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce() {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

module.exports = { activate, deactivate };
