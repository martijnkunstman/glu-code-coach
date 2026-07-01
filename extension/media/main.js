// Webview-kant van de chat. Draait in de sandbox van de WebviewView.
(function () {
  const vscode = acquireVsCodeApi();

  const messagesEl = document.getElementById("messages");
  const assignmentEl = document.getElementById("assignment");
  const suggestionsEl = document.getElementById("suggestions");
  const inputEl = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const watchToggle = document.getElementById("watchToggle");
  const assignmentSelect = document.getElementById("assignmentSelect");
  const testbar = document.getElementById("testbar");
  const testBtn = document.getElementById("testBtn");
  const configBtn = document.getElementById("configBtn");
  const configPanel = document.getElementById("configPanel");
  const cfgAiMode = document.getElementById("cfgAiMode");
  const cfgLang = document.getElementById("cfgLang");
  const cfgName = document.getElementById("cfgName");
  const ollamaBox = document.getElementById("ollamaBox");
  const ollamaStatus = document.getElementById("ollamaStatus");
  const cfgOllamaModel = document.getElementById("cfgOllamaModel");
  const ollamaRefresh = document.getElementById("ollamaRefresh");
  const cfgSave = document.getElementById("cfgSave");
  const cfgClose = document.getElementById("cfgClose");

  const SUGGESTIONS = {
    nl: ["Ik weet niet waar ik moet beginnen", "Ik loop vast", "Ik krijg een foutmelding", "Volgens mij ben ik klaar"],
    en: ["I don't know where to start", "I'm stuck", "I'm getting an error", "I think I'm done"],
    de: ["Ich weiß nicht, wo ich anfangen soll", "Ich komme nicht weiter", "Ich bekomme eine Fehlermeldung", "Ich glaube, ich bin fertig"],
  };

  // Statische interface-teksten. De chat-inhoud zelf komt meertalig van de coach.
  const UI = {
    nl: {
      watchTitle: "Meekijken met je code aan/uit",
      configTitle: "Instellingen",
      assignmentLabel: "Opdracht",
      cfgHeading: "Instellingen",
      cfgNameLabel: "Je naam (optioneel — voor je docent)",
      cfgNamePlaceholder: "bijv. je naam of studentnummer",
      nameCardTitle: "Welkom! 👋 Hoe mag je docent je noemen?",
      nameCardBody: "Vul je naam of een nickname in, zodat je docent jouw voortgang kan volgen. Niet verplicht — je kunt dit later aanpassen bij ⚙️.",
      nameCardSave: "Opslaan",
      nameCardSkip: "Liever niet",
      cfgLangLabel: "Taal van de coach",
      cfgAiLabel: "AI-tutor",
      cfgRemote: "Remote — via de school-server (standaard)",
      cfgLocal: "Lokaal — via Ollama op deze laptop",
      cfgModelLabel: "Lokaal model",
      ollamaRefresh: "↻ Opnieuw zoeken",
      save: "Opslaan",
      close: "Sluiten",
      placeholder: "Stel een vraag of beschrijf waar je vastloopt…",
      testBtn: "🧪 Toets mijn code",
      sendTitle: "Versturen",
      watchOn: "👀 Meekijken: aan",
      watchOff: "👀 Meekijken: uit",
      ollamaOk: (n) => "✓ Ollama gevonden — " + n + " model(len) beschikbaar.",
      ollamaBad:
        "✗ Ollama niet gevonden. Installeer het via <strong>ollama.com</strong> en start het, en haal een model op met <code>ollama pull llama3.1</code>.",
      notInstalled: " (niet geïnstalleerd)",
      assignmentFallback: "Opdracht",
      testFailRun: "🧪 Toets kon niet draaien",
      testHead: (p, t) => `🧪 ${p}/${t} testgevallen geslaagd`,
      testTop: " — top! 🎉",
      expected: "verwacht",
      gotWord: "kreeg",
      errWord: "fout: ",
    },
    en: {
      watchTitle: "Toggle watching your code on/off",
      configTitle: "Settings",
      assignmentLabel: "Assignment",
      cfgHeading: "Settings",
      cfgNameLabel: "Your name (optional — for your teacher)",
      cfgNamePlaceholder: "e.g. your name or student number",
      nameCardTitle: "Welcome! 👋 What should your teacher call you?",
      nameCardBody: "Enter your name or a nickname so your teacher can follow your progress. Not required — you can change it later under ⚙️.",
      nameCardSave: "Save",
      nameCardSkip: "Rather not",
      cfgLangLabel: "Coach language",
      cfgAiLabel: "AI tutor",
      cfgRemote: "Remote — via the school server (default)",
      cfgLocal: "Local — via Ollama on this laptop",
      cfgModelLabel: "Local model",
      ollamaRefresh: "↻ Search again",
      save: "Save",
      close: "Close",
      placeholder: "Ask a question or describe where you're stuck…",
      testBtn: "🧪 Test my code",
      sendTitle: "Send",
      watchOn: "👀 Watching: on",
      watchOff: "👀 Watching: off",
      ollamaOk: (n) => "✓ Ollama found — " + n + " model(s) available.",
      ollamaBad:
        "✗ Ollama not found. Install it from <strong>ollama.com</strong> and start it, then pull a model with <code>ollama pull llama3.1</code>.",
      notInstalled: " (not installed)",
      assignmentFallback: "Assignment",
      testFailRun: "🧪 Test couldn't run",
      testHead: (p, t) => `🧪 ${p}/${t} test cases passed`,
      testTop: " — great! 🎉",
      expected: "expected",
      gotWord: "got",
      errWord: "error: ",
    },
    de: {
      watchTitle: "Mitlesen deines Codes ein/aus",
      configTitle: "Einstellungen",
      assignmentLabel: "Aufgabe",
      cfgHeading: "Einstellungen",
      cfgNameLabel: "Dein Name (optional — für deine Lehrkraft)",
      cfgNamePlaceholder: "z. B. dein Name oder deine Nummer",
      nameCardTitle: "Willkommen! 👋 Wie soll dich deine Lehrkraft nennen?",
      nameCardBody: "Gib deinen Namen oder einen Spitznamen ein, damit deine Lehrkraft deinen Fortschritt verfolgen kann. Nicht verpflichtend — du kannst es später unter ⚙️ ändern.",
      nameCardSave: "Speichern",
      nameCardSkip: "Lieber nicht",
      cfgLangLabel: "Sprache des Coaches",
      cfgAiLabel: "KI-Tutor",
      cfgRemote: "Remote — über den Schulserver (Standard)",
      cfgLocal: "Lokal — über Ollama auf diesem Laptop",
      cfgModelLabel: "Lokales Modell",
      ollamaRefresh: "↻ Erneut suchen",
      save: "Speichern",
      close: "Schließen",
      placeholder: "Stelle eine Frage oder beschreibe, wo du nicht weiterkommst…",
      testBtn: "🧪 Code testen",
      sendTitle: "Senden",
      watchOn: "👀 Mitlesen: ein",
      watchOff: "👀 Mitlesen: aus",
      ollamaOk: (n) => "✓ Ollama gefunden — " + n + " Modell(e) verfügbar.",
      ollamaBad:
        "✗ Ollama nicht gefunden. Installiere es über <strong>ollama.com</strong> und starte es, und hole ein Modell mit <code>ollama pull llama3.1</code>.",
      notInstalled: " (nicht installiert)",
      assignmentFallback: "Aufgabe",
      testFailRun: "🧪 Test konnte nicht ausgeführt werden",
      testHead: (p, t) => `🧪 ${p}/${t} Testfälle bestanden`,
      testTop: " — super! 🎉",
      expected: "erwartet",
      gotWord: "erhalten",
      errWord: "Fehler: ",
    },
  };
  let currentLang = "nl";
  function t() {
    return UI[currentLang] || UI.nl;
  }

  // Zet alle statische interface-teksten in de gekozen taal.
  function applyLang() {
    const s = t();
    const set = (id, prop, val) => {
      const el = document.getElementById(id);
      if (el) el[prop] = val;
    };
    set("watchToggle", "title", s.watchTitle);
    set("configBtn", "title", s.configTitle);
    set("assignmentLabel", "textContent", s.assignmentLabel);
    set("cfgHeading", "textContent", s.cfgHeading);
    set("cfgNameLabel", "textContent", s.cfgNameLabel);
    set("cfgName", "placeholder", s.cfgNamePlaceholder);
    set("cfgLangLabel", "textContent", s.cfgLangLabel);
    set("cfgAiLabel", "textContent", s.cfgAiLabel);
    set("cfgModelLabel", "textContent", s.cfgModelLabel);
    set("ollamaRefresh", "textContent", s.ollamaRefresh);
    set("cfgSave", "textContent", s.save);
    set("cfgClose", "textContent", s.close);
    set("testBtn", "textContent", s.testBtn);
    set("send", "title", s.sendTitle);
    set("input", "placeholder", s.placeholder);
    if (cfgAiMode.options.length >= 2) {
      cfgAiMode.options[0].textContent = s.cfgRemote;
      cfgAiMode.options[1].textContent = s.cfgLocal;
    }
    renderToggle();
    renderOllamaBox();
  }

  const SENT = "\u0000"; // sentinel voor codeblok-placeholders (komt niet in tekst voor)

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  // Mini-markdown: codeblokken, inline code, vet/cursief, lijsten, regels.
  function renderMarkdown(src) {
    let text = escapeHtml(src);
    const blocks = [];
    const stash = (code) => {
      blocks.push('<pre class="codeblock"><code>' + code.replace(/\n$/, "") + "</code></pre>");
      return SENT + (blocks.length - 1) + SENT;
    };
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => stash(code));
    const open = text.indexOf("```"); // niet-gesloten codeblok (tijdens streamen)
    if (open !== -1) {
      const placeholder = stash(text.slice(open + 3).replace(/^\w*\n?/, ""));
      text = text.slice(0, open) + placeholder;
    }
    text = text
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

    const lines = text.split("\n");
    let html = "",
      inUl = false,
      inOl = false;
    const close = () => {
      if (inUl) (html += "</ul>"), (inUl = false);
      if (inOl) (html += "</ol>"), (inOl = false);
    };
    for (const line of lines) {
      if (/^\s*[-*]\s+/.test(line)) {
        if (!inUl) (close(), (html += "<ul>"), (inUl = true));
        html += "<li>" + line.replace(/^\s*[-*]\s+/, "") + "</li>";
      } else if (/^\s*\d+\.\s+/.test(line)) {
        if (!inOl) (close(), (html += "<ol>"), (inOl = true));
        html += "<li>" + line.replace(/^\s*\d+\.\s+/, "") + "</li>";
      } else if (line.trim() === "") {
        close();
      } else if (line.indexOf(SENT) > -1) {
        close();
        html += line;
      } else {
        close();
        html += line + "<br>";
      }
    }
    close();
    html = html
      .replace(new RegExp(SENT + "(\\d+)" + SENT, "g"), (m, i) => blocks[+i])
      .replace(/(<br>)+$/g, "");
    return html;
  }

  function addBubble(text, who) {
    const el = document.createElement("div");
    el.className = "bubble " + who;
    el.innerHTML =
      who.indexOf("user") > -1 ? escapeHtml(text).replace(/\n/g, "<br>") : renderMarkdown(text);
    messagesEl.appendChild(el);
    scrollDown();
    return el;
  }

  function renderTestResult(data) {
    const el = document.createElement("div");
    el.className = "bubble testcard";
    if (data.error) {
      el.innerHTML =
        '<div class="test-head bad">' + t().testFailRun + "</div>" +
        '<pre class="codeblock"><code>' + escapeHtml(data.error) + "</code></pre>";
      messagesEl.appendChild(el);
      scrollDown();
      return el;
    }
    const s = data.summary || { passed: 0, total: 0 };
    const ok = s.passed === s.total && s.total > 0;
    let rows = "";
    (data.results || []).forEach((r) => {
      const args = (r.args || []).map((x) => JSON.stringify(x)).join(", ");
      const call = escapeHtml(data.functionName + "(" + args + ")");
      if (r.pass) {
        rows +=
          `<div class="test-row pass"><span class="ic">✓</span><code>${call}</code> → <code>${escapeHtml(JSON.stringify(r.got))}</code></div>`;
      } else {
        const got = r.error ? t().errWord + r.error : JSON.stringify(r.got);
        rows +=
          `<div class="test-row fail"><span class="ic">✗</span><code>${call}</code>` +
          `<div class="test-detail">${t().expected} <code>${escapeHtml(JSON.stringify(r.expected))}</code>, ${t().gotWord} <code>${escapeHtml(got)}</code></div></div>`;
      }
    });
    el.innerHTML =
      `<div class="test-head ${ok ? "good" : "bad"}">${t().testHead(s.passed, s.total)}${ok ? t().testTop : ""}</div>` +
      rows;
    messagesEl.appendChild(el);
    scrollDown();
    return el;
  }

  function scrollDown() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    const el = document.createElement("div");
    el.className = "bubble coach typing";
    el.dataset.typing = "1";
    el.innerHTML = "<span></span><span></span><span></span>";
    messagesEl.appendChild(el);
    scrollDown();
    return el;
  }
  function removeTyping() {
    messagesEl.querySelectorAll('[data-typing="1"]').forEach((t) => t.remove());
  }

  function renderSuggestions() {
    suggestionsEl.innerHTML = "";
    (SUGGESTIONS[currentLang] || SUGGESTIONS.nl).forEach((s) => {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = s;
      chip.onclick = () => send(s);
      suggestionsEl.appendChild(chip);
    });
  }

  // ---- versturen ----
  let waiting = false;
  function setWaiting(v) {
    waiting = v;
    sendBtn.disabled = v;
    testBtn.disabled = v;
  }
  function send(text) {
    text = (text || inputEl.value).trim();
    if (!text || waiting) return;
    addBubble(text, "user");
    inputEl.value = "";
    inputEl.style.height = "auto";
    setWaiting(true);
    showTyping();
    vscode.postMessage({ type: "userMessage", text });
  }

  sendBtn.addEventListener("click", () => send());
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  });

  testBtn.addEventListener("click", () => {
    if (waiting) return;
    setWaiting(true);
    vscode.postMessage({ type: "testCode" });
  });

  // ---- meekijken aan/uit ----
  let proactive = true;
  function renderToggle() {
    watchToggle.classList.toggle("on", proactive);
    watchToggle.textContent = proactive ? t().watchOn : t().watchOff;
  }
  watchToggle.addEventListener("click", () => {
    proactive = !proactive;
    renderToggle();
    vscode.postMessage({ type: "setProactive", value: proactive });
  });

  // ---- opdracht-keuze ----
  assignmentSelect.addEventListener("change", () => {
    vscode.postMessage({ type: "selectAssignment", id: assignmentSelect.value });
  });
  // ---- instellingen-scherm ----
  let lastOllama = { running: false, models: [] };
  function showConfig(open) {
    configPanel.hidden = !open;
    [messagesEl, suggestionsEl, testbar, document.querySelector(".composer")].forEach((el) => {
      if (el) el.style.display = open ? "none" : "";
    });
    if (open) vscode.postMessage({ type: "openConfig" });
  }
  function renderOllamaBox() {
    const local = cfgAiMode.value === "local";
    ollamaBox.hidden = !local;
    if (!local) return;
    if (lastOllama.running) {
      ollamaStatus.className = "ollama-status ok";
      ollamaStatus.textContent = t().ollamaOk(lastOllama.models.length || 0);
    } else {
      ollamaStatus.className = "ollama-status bad";
      ollamaStatus.innerHTML = t().ollamaBad;
    }
  }
  configBtn.addEventListener("click", () => showConfig(true));
  cfgClose.addEventListener("click", () => showConfig(false));
  cfgAiMode.addEventListener("change", renderOllamaBox);
  ollamaRefresh.addEventListener("click", () => vscode.postMessage({ type: "openConfig" }));
  cfgSave.addEventListener("click", () => {
    vscode.postMessage({
      type: "saveConfig",
      aiMode: cfgAiMode.value,
      language: cfgLang.value,
      ollamaModel: cfgOllamaModel.value || undefined,
      studentName: cfgName ? cfgName.value : undefined,
    });
    showConfig(false);
  });
  // Eenmalige, vriendelijke onboarding-kaart die om een (nick)name vraagt.
  let nameCardEl = null;
  function showNameCard() {
    if (nameCardEl) return;
    const s = t();
    const card = document.createElement("div");
    nameCardEl = card;
    card.className = "name-card";
    card.setAttribute("style",
      "margin:8px 0;padding:14px 16px;border:1px solid var(--vscode-focusBorder,#0e7490);border-radius:10px;" +
      "background:var(--vscode-editorWidget-background,rgba(14,116,144,.08))");
    const title = document.createElement("div");
    title.setAttribute("style", "font-weight:600;margin-bottom:4px");
    title.textContent = s.nameCardTitle;
    const body = document.createElement("div");
    body.setAttribute("style", "font-size:12.5px;opacity:.85;margin-bottom:10px;line-height:1.4");
    body.textContent = s.nameCardBody;
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 60;
    input.placeholder = s.cfgNamePlaceholder;
    input.setAttribute("style",
      "width:100%;box-sizing:border-box;padding:7px 9px;border-radius:6px;margin-bottom:8px;" +
      "border:1px solid var(--vscode-input-border,#555);background:var(--vscode-input-background);color:var(--vscode-input-foreground)");
    const row = document.createElement("div");
    row.setAttribute("style", "display:flex;gap:8px;align-items:stretch");
    const save = document.createElement("button");
    save.className = "test-btn";
    save.textContent = s.nameCardSave;
    save.setAttribute("style", "flex:1;width:auto;margin:0");
    const skip = document.createElement("button");
    skip.className = "toggle";
    skip.textContent = s.nameCardSkip;
    skip.setAttribute("style", "flex:0 0 auto;white-space:nowrap");
    row.appendChild(save);
    row.appendChild(skip);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(input);
    card.appendChild(row);
    messagesEl.parentNode.insertBefore(card, messagesEl);
    input.focus();

    const close = () => { if (nameCardEl) { nameCardEl.remove(); nameCardEl = null; } };
    const doSave = () => {
      const v = input.value.trim().slice(0, 60);
      vscode.postMessage({ type: "saveName", value: v });
      if (cfgName) cfgName.value = v;
      close();
    };
    save.addEventListener("click", doSave);
    skip.addEventListener("click", () => { vscode.postMessage({ type: "skipName" }); close(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSave(); } });
  }

  function renderAssignments(items, currentId) {
    assignmentSelect.innerHTML = "";
    items.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.title + (a.language ? "  ·  " + a.language : "");
      if (a.id === currentId) opt.selected = true;
      assignmentSelect.appendChild(opt);
    });
  }

  // ---- streaming-antwoord ----
  let streamEl = null;
  let streamText = "";

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "coachStart") {
      removeTyping();
      streamText = "";
      streamEl = addBubble("", "coach");
      setWaiting(true);
    } else if (msg.type === "coachDelta") {
      if (!streamEl) {
        removeTyping();
        streamEl = addBubble("", "coach");
      }
      streamText += msg.text;
      streamEl.innerHTML = renderMarkdown(streamText);
      scrollDown();
    } else if (msg.type === "coachEnd") {
      streamEl = null;
      setWaiting(false);
    } else if (msg.type === "observation") {
      addBubble(msg.text, "coach observation");
    } else if (msg.type === "testRunning") {
      removeTyping();
      const t = showTyping();
      t.dataset.testrun = "1";
    } else if (msg.type === "testResult") {
      messagesEl.querySelectorAll('[data-testrun="1"]').forEach((x) => x.remove());
      renderTestResult(msg.data);
    } else if (msg.type === "canTest") {
      testbar.hidden = !msg.value;
    } else if (msg.type === "clearChat") {
      messagesEl.innerHTML = "";
    } else if (msg.type === "restore") {
      messagesEl.innerHTML = "";
      (msg.items || []).forEach((it) => {
        if (it.who === "coach") addBubble(it.text, "coach");
        else if (it.who === "user") addBubble(it.text, "user");
        else if (it.who === "observation") addBubble(it.text, "coach observation");
        else if (it.who === "testresult") renderTestResult(it.text);
      });
    } else if (msg.type === "assignments") {
      renderAssignments(msg.items, msg.currentId);
    } else if (msg.type === "assignment") {
      assignmentEl.innerHTML =
        '<span class="assignment-title">' +
        escapeHtml(msg.title || t().assignmentFallback) +
        "</span>" +
        renderMarkdown(msg.text || "");
    } else if (msg.type === "proactiveState") {
      proactive = msg.value;
      renderToggle();
    } else if (msg.type === "aiMode") {
      // keuze zit in het instellingenscherm; geen actie nodig in de hoofd-UI
    } else if (msg.type === "lang") {
      currentLang = ["nl", "en", "de"].includes(msg.value) ? msg.value : "nl";
      renderSuggestions();
      applyLang();
    } else if (msg.type === "askName") {
      showNameCard();
    } else if (msg.type === "configData") {
      cfgAiMode.value = msg.aiMode === "local" ? "local" : "remote";
      cfgLang.value = ["nl", "en", "de"].includes(msg.language) ? msg.language : "nl";
      if (cfgName) cfgName.value = msg.studentName || "";
      currentLang = cfgLang.value;
      renderSuggestions();
      applyLang();
      lastOllama = msg.ollama || { running: false, models: [] };
      const models = (lastOllama.models || []).slice();
      cfgOllamaModel.innerHTML = "";
      const list = models.length ? models : msg.ollamaModel ? [msg.ollamaModel] : [];
      list.forEach((m) => {
        const o = document.createElement("option");
        o.value = m;
        o.textContent = m;
        if (m === msg.ollamaModel) o.selected = true;
        cfgOllamaModel.appendChild(o);
      });
      if (msg.ollamaModel && !list.includes(msg.ollamaModel)) {
        const o = document.createElement("option");
        o.value = msg.ollamaModel;
        o.textContent = msg.ollamaModel + t().notInstalled;
        o.selected = true;
        cfgOllamaModel.appendChild(o);
      }
      renderOllamaBox();
    }
  });

  renderSuggestions();
  applyLang();
  vscode.postMessage({ type: "ready" });
})();
