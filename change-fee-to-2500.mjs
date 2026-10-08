// Run from your project root:  node change-fee-to-2500.mjs
// Only replaces the text "PKR 5,000" with "PKR 2,500" in YOUR existing files
// (no whole files are overwritten, so it works whatever chunks you have applied),
// and bumps the agreement version tag so doctors re-accept the updated agreement.
import fs from "node:fs";
import path from "node:path";

const roots = ["src"];
let changed = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(p); }
    else if (/\.(ts|tsx)$/.test(e.name)) {
      let s = fs.readFileSync(p, "utf8");
      let t = s.replace(/PKR 5,000/g, "PKR 2,500");
      if (p.endsWith("engagementAgreement.ts")) {
        t = t.replace(/ENGAGEMENT_AGREEMENT_VERSION = "[^"]*"/, 'ENGAGEMENT_AGREEMENT_VERSION = "2026-10-08-v3"');
      }
      if (t !== s) { fs.writeFileSync(p, t); changed.push(p); }
    }
  }
}
if (!fs.existsSync("src")) { console.error("Run this from the project root (the folder containing src)."); process.exit(1); }
roots.forEach(walk);
console.log(changed.length + " file(s) updated:\n" + changed.join("\n"));
