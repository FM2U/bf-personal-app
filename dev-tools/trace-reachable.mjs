// LOCAL TOOL: lists source files under src/ that no remaining page, layout, route or proxy reaches through imports.
// Usage: node dev-tools/trace-reachable.mjs  (prints unreachable files; tests whose subject is gone are listed too)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "src");
const EXT = [".ts", ".tsx", ".mjs", ".js"];
const ENTRY = /^(page|layout|route|default|loading|error|not-found|template|manifest)\.(tsx?|js)$/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.includes(path.extname(p))) out.push(p);
  }
  return out;
}
function resolve(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base, ...EXT.map((x) => base + x), ...EXT.map((x) => path.join(base, "index" + x))]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}
const files = walk(SRC);
const isTest = (f) => /\.test\.(tsx?|mjs)$/.test(f);
const entries = files.filter((f) => (f.startsWith(path.join(SRC, "app")) && ENTRY.test(path.basename(f))) || f === path.join(SRC, "proxy.ts"));
const seen = new Set();
const stack = [...entries];
const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;
while (stack.length) {
  const f = stack.pop();
  if (seen.has(f)) continue;
  seen.add(f);
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(re)) {
    const r = resolve(f, m[1] || m[2] || m[3]);
    if (r && !seen.has(r)) stack.push(r);
  }
}
const dead = files.filter((f) => !isTest(f) && !seen.has(f));
// A test is dead when any file it imports from src is dead or missing.
const deadTests = files.filter(isTest).filter((t) => {
  const src = fs.readFileSync(t, "utf8");
  for (const m of src.matchAll(re)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec.startsWith("@/") && !spec.startsWith(".")) continue;
    const r = resolve(t, spec);
    if (!r || dead.includes(r)) return true;
  }
  return false;
});
for (const f of [...dead, ...deadTests]) console.log(path.relative(ROOT, f));
