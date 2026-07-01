// Docentdashboard — praat met de API onder dezelfde basis-URL.
(function () {
  const API = "api"; // relatief; pagina draait op {BASE}/
  const $ = (id) => document.getElementById(id);
  const listEl = $("list");
  const form = $("form");
  const statusEl = $("status");
  let assignments = [];
  let currentId = null;
  let authRequired = false;

  function toast(msg, isErr) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (isErr ? " err" : "");
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2600);
  }
  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = "status" + (cls ? " " + cls : "");
  }
  function esc(s) {
    return String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  // ---- testgevallen <-> tekst ----
  function testsToText(tests) {
    return (tests || [])
      .map((t) => JSON.stringify(t.args) + " => " + JSON.stringify(t.expected))
      .join("\n");
  }
  function parseTestsText(text) {
    const out = [];
    let bad = 0;
    String(text || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => {
        const i = line.indexOf("=>");
        if (i === -1) return bad++;
        try {
          const args = JSON.parse(line.slice(0, i).trim());
          const expected = JSON.parse(line.slice(i + 2).trim());
          if (Array.isArray(args)) out.push({ args, expected });
          else bad++;
        } catch {
          bad++;
        }
      });
    return { out, bad };
  }
  function updateTestCount() {
    const { out, bad } = parseTestsText($("tests").value);
    const el = $("testCount");
    el.textContent = out.length + (bad ? "  (" + bad + " ongeldig)" : "");
    el.className = "test-count" + (bad ? " bad" : "");
  }

  // ---- auth ----
  async function checkAuth() {
    try {
      const me = await (await fetch(`${API}/me`)).json();
      authRequired = me.authRequired;
      $("logoutBtn").hidden = !authRequired;
      if (authRequired && !me.authed) {
        showLogin();
        return false;
      }
    } catch {
      /* server onbereikbaar — load() toont de fout */
    }
    $("loginOverlay").hidden = true;
    return true;
  }
  function showLogin() {
    $("loginOverlay").hidden = false;
    setTimeout(() => $("loginPassword").focus(), 50);
  }
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("loginError").hidden = true;
    try {
      const res = await fetch(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: $("loginPassword").value }),
      });
      if (!res.ok) throw new Error();
      $("loginOverlay").hidden = true;
      await load();
      toast("Ingelogd ✓");
    } catch {
      $("loginError").hidden = false;
    }
  });
  $("logoutBtn").addEventListener("click", async () => {
    await fetch(`${API}/logout`, { method: "POST" });
    location.reload();
  });

  // ---- laden (volledige data incl. coach-notities via /export) ----
  async function load() {
    try {
      const res = await fetch(`${API}/export`);
      if (res.status === 401) {
        showLogin();
        return;
      }
      if (!res.ok) throw new Error(res.status);
      assignments = await res.json();
      setStatus(assignments.length + " opdracht" + (assignments.length === 1 ? "" : "en"), "ok");
      render();
    } catch {
      setStatus("API onbereikbaar", "err");
      listEl.innerHTML = '<div class="empty">Kan de opdrachten niet laden.<br>Draait de server?</div>';
    }
  }

  function render() {
    const q = ($("search").value || "").toLowerCase();
    const filtered = assignments.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        (a.description || "").toLowerCase().includes(q) ||
        a.language.includes(q)
    );
    if (filtered.length === 0) {
      listEl.innerHTML =
        '<div class="empty">' +
        (assignments.length ? "Geen resultaten." : "Nog geen opdrachten.<br>Maak er één aan →") +
        "</div>";
      return;
    }
    listEl.innerHTML = filtered
      .map(
        (a) => `
      <div class="card ${a.id === currentId ? "active" : ""}" data-id="${a.id}">
        <h3>${esc(a.title)}</h3>
        <div class="badges">
          <span class="badge lang">${esc(a.language)}</span>
          <span class="badge level">${esc(a.level)}</span>
          ${a.hints && a.hints.length ? `<span class="badge">${a.hints.length} hints</span>` : ""}
          ${a.tests && a.tests.length ? `<span class="badge">${a.tests.length} tests</span>` : ""}
        </div>
        <p class="preview">${esc(a.description)}</p>
      </div>`
      )
      .join("");
    listEl.querySelectorAll(".card").forEach((c) => {
      c.onclick = () => edit(c.dataset.id);
    });
  }

  function fillForm(a) {
    $("title").value = a.title || "";
    $("language").value = a.language || "python";
    $("level").value = a.level || "beginner";
    $("description").value = a.description || "";
    $("learningGoals").value = (a.learningGoals || []).join("\n");
    $("hints").value = (a.hints || []).join("\n");
    $("functionName").value = a.functionName || "";
    $("tests").value = testsToText(a.tests);
    $("starterCode").value = a.starterCode || "";
    $("solutionNotes").value = a.solutionNotes || "";
    updateTestCount();
  }

  function edit(id) {
    const a = assignments.find((x) => x.id === id);
    if (!a) return;
    currentId = id;
    fillForm(a);
    $("editorTitle").textContent = "Opdracht bewerken";
    $("editorMeta").textContent = "Laatst gewijzigd: " + new Date(a.updatedAt).toLocaleString("nl-NL");
    $("deleteBtn").hidden = false;
    $("duplicateBtn").hidden = false;
    render();
    document.querySelector(".editor-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function newAssignment() {
    currentId = null;
    form.reset();
    updateTestCount();
    $("editorTitle").textContent = "Nieuwe opdracht";
    $("editorMeta").textContent = "";
    $("deleteBtn").hidden = true;
    $("duplicateBtn").hidden = true;
    render();
    $("title").focus();
  }

  function collect() {
    return {
      title: $("title").value,
      language: $("language").value,
      level: $("level").value,
      description: $("description").value,
      learningGoals: $("learningGoals").value,
      hints: $("hints").value,
      functionName: $("functionName").value,
      tests: $("tests").value, // server parseert de tekstregels
      starterCode: $("starterCode").value,
      solutionNotes: $("solutionNotes").value,
    };
  }

  async function save(body, asNew) {
    const url = asNew || !currentId ? API + "/assignments" : `${API}/assignments/${currentId}`;
    const method = asNew || !currentId ? "POST" : "PUT";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      showLogin();
      throw new Error("auth");
    }
    if (!res.ok) throw new Error(res.status);
    return { saved: await res.json(), created: method === "POST" };
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = collect();
    if (!body.title.trim()) return toast("Geef de opdracht een titel.", true);
    try {
      const { saved, created } = await save(body);
      currentId = saved.id;
      await load();
      edit(saved.id);
      toast(created ? "Opdracht aangemaakt ✓" : "Opgeslagen ✓");
    } catch (err) {
      if (err.message !== "auth") toast("Opslaan mislukt.", true);
    }
  });

  $("duplicateBtn").addEventListener("click", async () => {
    const body = collect();
    body.title = (body.title || "Opdracht") + " (kopie)";
    try {
      const { saved } = await save(body, true);
      await load();
      edit(saved.id);
      toast("Gedupliceerd ✓");
    } catch (err) {
      if (err.message !== "auth") toast("Dupliceren mislukt.", true);
    }
  });

  $("deleteBtn").addEventListener("click", async () => {
    if (!currentId) return;
    if (!confirm("Deze opdracht verwijderen?")) return;
    try {
      const res = await fetch(`${API}/assignments/${currentId}`, { method: "DELETE" });
      if (res.status === 401) return showLogin();
      if (!res.ok) throw new Error();
      await load();
      newAssignment();
      toast("Verwijderd");
    } catch {
      toast("Verwijderen mislukt.", true);
    }
  });

  // ---- export / import ----
  $("exportBtn").addEventListener("click", async () => {
    try {
      const res = await fetch(`${API}/export`);
      if (res.status === 401) return showLogin();
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "coding-coach-opdrachten.json";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast("Export mislukt.", true);
    }
  });
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!confirm("Hiermee worden ALLE huidige opdrachten vervangen door de import. Doorgaan?")) return;
      const res = await fetch(`${API}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.status === 401) return showLogin();
      if (!res.ok) throw new Error();
      await load();
      newAssignment();
      toast("Geïmporteerd ✓");
    } catch {
      toast("Import mislukt — geldig JSON-bestand?", true);
    } finally {
      e.target.value = "";
    }
  });

  $("newBtn").addEventListener("click", newAssignment);
  $("cancelBtn").addEventListener("click", newAssignment);
  $("search").addEventListener("input", render);
  $("tests").addEventListener("input", updateTestCount);

  (async () => {
    if (await checkAuth()) load();
  })();
})();
