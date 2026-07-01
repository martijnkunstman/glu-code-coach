// Code-toetser: draait de code van de student tegen de testgevallen van de
// opdracht, in een apart proces met een timeout. Ondersteunt Python en
// JavaScript. Geeft per testgeval pass/fail terug — NOOIT de oplossing.
//
// De student draait z'n eigen code op de eigen machine (zoals bij elke IDE),
// dus dit is bewust geen sandbox; wel met timeout en bufferlimiet als rem.

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PY_HARNESS = `import sys, json, importlib.util, traceback
student_path, fn_name, tests_path = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    spec = importlib.util.spec_from_file_location("student", student_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
except Exception as e:
    print(json.dumps({"loadError": "".join(traceback.format_exception_only(type(e), e)).strip()}))
    sys.exit(0)
fn = getattr(mod, fn_name, None)
if not callable(fn):
    print(json.dumps({"loadError": "Functie '%s' niet gevonden." % fn_name}))
    sys.exit(0)
tests = json.load(open(tests_path, encoding="utf-8"))
out = {"results": []}
for t in tests:
    r = {"args": t["args"], "expected": t.get("expected")}
    try:
        got = fn(*t["args"])
        r["got"] = got
        r["pass"] = bool(got == t.get("expected"))
    except Exception as e:
        r["error"] = "".join(traceback.format_exception_only(type(e), e)).strip()
        r["pass"] = False
    out["results"].append(r)
print(json.dumps(out, default=str, ensure_ascii=False))
`;

const JS_HARNESS = `const fs = require("fs"); const vm = require("vm");
const [,, studentPath, fnName, testsPath] = process.argv;
const code = fs.readFileSync(studentPath, "utf8");
const tests = JSON.parse(fs.readFileSync(testsPath, "utf8"));
const sandbox = { module: { exports: {} }, exports: {}, require, console: { log(){}, error(){}, warn(){}, info(){} } };
sandbox.global = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
try { vm.runInContext(code, sandbox, { timeout: 3000 }); }
catch (e) { console.log(JSON.stringify({ loadError: String((e && e.message) || e) })); process.exit(0); }
let fn = sandbox[fnName];
if (typeof fn !== "function" && sandbox.module && sandbox.module.exports) {
  fn = sandbox.module.exports[fnName] || (typeof sandbox.module.exports === "function" ? sandbox.module.exports : undefined);
}
if (typeof fn !== "function") { console.log(JSON.stringify({ loadError: "Functie '" + fnName + "' niet gevonden." })); process.exit(0); }
const out = { results: [] };
for (const t of tests) {
  const r = { args: t.args, expected: t.expected };
  try {
    const got = fn(...t.args);
    r.got = got;
    r.pass = JSON.stringify(got) === JSON.stringify(t.expected);
  } catch (e) { r.error = String((e && e.message) || e); r.pass = false; }
  out.results.push(r);
}
console.log(JSON.stringify(out));
`;

function normalizeLang(languageId) {
  const id = String(languageId || "").toLowerCase();
  if (id === "python") return "python";
  if (id === "javascript" || id === "javascriptreact" || id === "node") return "javascript";
  return id;
}

function tmpDir() {
  const d = path.join(os.tmpdir(), "coach-" + crypto.randomBytes(6).toString("hex"));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function exec(cmd, args) {
  return new Promise((resolve) => {
    // ELECTRON_RUN_AS_NODE: in de VS Code-host is process.execPath de Electron-
    // binary; deze vlag laat 'm het JS-harnasscript als kale Node draaien.
    const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" });
    execFile(cmd, args, { timeout: 8000, maxBuffer: 1024 * 1024, env }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

function summarize(results) {
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  return { total, passed, allPassed: passed === total && total > 0 };
}

async function runViaHarness(cmd, harness, ext, code, functionName, tests) {
  const dir = tmpDir();
  const student = path.join(dir, "student." + ext);
  const harnessFile = path.join(dir, "harness." + ext);
  const testsFile = path.join(dir, "tests.json");
  try {
    fs.writeFileSync(student, code, "utf8");
    fs.writeFileSync(harnessFile, harness, "utf8");
    fs.writeFileSync(testsFile, JSON.stringify(tests), "utf8");
    const { err, stdout, stderr } = await exec(cmd, [harnessFile, student, functionName, testsFile]);
    if (err && err.killed) {
      return { supported: true, error: "Je code duurde te lang (mogelijk een oneindige lus?)." };
    }
    let data;
    try {
      data = JSON.parse(stdout.trim().split("\n").pop());
    } catch {
      return { supported: true, error: (stderr || "Kon de uitvoer niet lezen.").slice(0, 600) };
    }
    if (data.loadError) return { supported: true, error: data.loadError };
    return { supported: true, results: data.results, summary: summarize(data.results) };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* opruimen mag falen */
    }
  }
}

/**
 * @returns {Promise<{supported:boolean, reason?:string, error?:string,
 *   results?:Array, summary?:{total,passed,allPassed}}>}
 */
async function runTests(languageId, code, functionName, tests, opts = {}) {
  if (!functionName || !Array.isArray(tests) || tests.length === 0) {
    return { supported: false, reason: "Deze opdracht heeft geen automatische toets." };
  }
  const lang = normalizeLang(languageId);
  if (lang === "python") {
    return runViaHarness(opts.pythonCmd || "python3", PY_HARNESS, "py", code, functionName, tests);
  }
  if (lang === "javascript") {
    return runViaHarness(opts.nodeCmd || process.execPath, JS_HARNESS, "js", code, functionName, tests);
  }
  return {
    supported: false,
    reason: "Automatisch toetsen wordt nog niet ondersteund voor '" + languageId + "'.",
  };
}

module.exports = { runTests, normalizeLang, summarize };
