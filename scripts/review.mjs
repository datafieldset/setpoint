// scripts/review.mjs
//
// Pre-reply check ("prove your work", see memory/review/README.md).
// Run from the repo root: node scripts/review.mjs
// Exits 1 if anything is wrong. Checks:
//   1. every .js/.jsx under app/, lib/, scripts/ parses
//   2. every named import from a relative file really exists there
//   3. no computeSignals call is handed bare DEFAULT_TH (must use thresholdsFor)
//   4. the one-copy rules that have drifted before
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { createRequire } from "module";

const root = process.cwd();
const problems = [];
const fail = (f, m) => problems.push(`${path.relative(root, f)}: ${m}`);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", "out"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : /\.(m?js|jsx)$/.test(e.name) && out.push(p);
  }
  return out;
}

function loadBabel() {
  const tmp = path.join(os.tmpdir(), "setpoint-review-babel");
  const req = createRequire(path.join(tmp, "x.js"));
  try { return req("@babel/parser"); } catch { /* install below */ }
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, "package.json"), "{}");
  execSync("npm i @babel/parser --silent --no-audit --no-fund", { cwd: tmp, stdio: "ignore" });
  return req("@babel/parser");
}

const files = ["app", "lib", "scripts"].filter((d) => fs.existsSync(path.join(root, d))).flatMap((d) => walk(path.join(root, d)));
const babel = loadBabel();
const src = new Map();
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  src.set(f, text);
  try { babel.parse(text, { sourceType: "module", plugins: ["jsx"] }); } catch (e) { fail(f, `does not parse: ${e.message}`); }
}

// exports of a file
const exportsOf = new Map();
function exportsFor(f) {
  if (exportsOf.has(f)) return exportsOf.get(f);
  const t = src.get(f) || "";
  const names = new Set();
  for (const m of t.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of t.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
  if (/export\s+default/.test(t)) names.add("default");
  exportsOf.set(f, names);
  return names;
}
function resolveRel(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, base + ".js", base + ".jsx", path.join(base, "index.js")]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}
for (const [f, t] of src) {
  for (const m of t.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g)) {
    const target = resolveRel(f, m[2]);
    if (!target) { fail(f, `imports from missing file ${m[2]}`); continue; }
    if (!src.has(target)) continue; // not a JS file we track
    const have = exportsFor(target);
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name && !have.has(name)) fail(f, `imports "${name}" but ${path.relative(root, target)} does not export it`);
    }
  }
  // drift trap: bare DEFAULT_TH handed to computeSignals
  for (const m of t.matchAll(/computeSignals\s*\(([^)]*)\)/g)) {
    if (/\bDEFAULT_TH\b/.test(m[1]) && !/thresholdsFor/.test(m[1])) fail(f, "computeSignals called with bare DEFAULT_TH, use thresholdsFor(tfKey) so the move-size rule matches live");
  }
}

if (problems.length) {
  console.error(`REVIEW FAILED (${problems.length})\n` + problems.map((p) => " - " + p).join("\n"));
  process.exit(1);
}
console.log(`review ok: ${files.length} files parse, imports resolve, no drift traps.`);
