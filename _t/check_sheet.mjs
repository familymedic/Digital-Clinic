// Usage: node _t/check_sheet.mjs file.xlsx ... (reads a sheet exactly like the admin upload does; OUT=rows.json also writes the rows)
import { createRequire } from "module";
const require = createRequire("/tmp/claude-0/-home-claude/d3923746-7049-5612-99aa-eca692805ba3/scratchpad/repo/");
const ts = require("typescript"), fs = require("fs"), path = require("path"), os = require("os");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v-"));
for (const f of ["locator","vaccination"]) fs.writeFileSync(path.join(dir,f+".js"), ts.transpileModule(fs.readFileSync(`src/lib/${f}.ts`,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText);
const V = require(path.join(dir,"vaccination.js"));
const { readSheet } = await import("read-excel-file/node");
for (const f of process.argv.slice(2)) {
  const t = V.parseTable(await readSheet(f));
  console.log(f, "rows", t.rows.length, "ignored", t.unmatchedHeaders, "missing", t.missingRequired, "warnings", t.rows.filter(r=>r.warnings.length).length, "nopin", t.rows.filter(r=>r.payload.lat==null).length);
  if (f.includes("KC_clean") && process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(t.rows.map(r=>V.toRpcRow(r.payload))));
}
