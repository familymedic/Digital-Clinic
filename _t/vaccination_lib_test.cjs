// Unit test for src/lib/vaccination.ts (no browser, no database). Run from the repo root:
//   node _t/vaccination_lib_test.cjs
const ts = require("typescript");
const fs = require("fs");
const path = require("path");
const os = require("os");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vacc-"));
for (const f of ["locator", "vaccination"]) {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "lib", f + ".ts"), "utf8");
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  fs.writeFileSync(path.join(dir, f + ".js"), out);
}
const V = require(path.join(dir, "vaccination.js"));
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log("FAIL", name, "\n  got ", JSON.stringify(got), "\n  want", JSON.stringify(want)); }
};
// times
eq("t 9am", V.parseTime("9am"), "09:00");
eq("t 2:30 pm", V.parseTime("2:30 PM"), "14:30");
eq("t 09:00", V.parseTime("09:00"), "09:00");
eq("t 14:00", V.parseTime("14:00"), "14:00");
eq("t 12 pm", V.parseTime("12 pm"), "12:00");
eq("t 12 am", V.parseTime("12 am"), "00:00");
eq("t 9.30 a.m.", V.parseTime("9.30 a.m."), "09:30");
eq("t excel fraction", V.parseTime(0.375), "09:00");
eq("t excel date cell", V.parseTime(new Date(Date.UTC(1899, 11, 30, 14, 15))), "14:15");
eq("t noon", V.parseTime("noon"), "12:00");
eq("t garbage", V.parseTime("morning"), null);
eq("t 25:00", V.parseTime("25:00"), null);
eq("range", V.splitRange("9am to 2pm"), ["9am", "2pm"]);
eq("range dash", V.splitRange("09:00 - 14:00"), ["09:00", "14:00"]);
// days
eq("d Mon-Sat", V.parseDays("Mon-Sat"), ["mon", "tue", "wed", "thu", "fri", "sat"]);
eq("d Monday to Friday", V.parseDays("Monday to Friday"), ["mon", "tue", "wed", "thu", "fri"]);
eq("d list", V.parseDays("Mon, Wed, Fri"), ["mon", "wed", "fri"]);
eq("d daily", V.parseDays("Daily"), ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
eq("d wrap Sat-Mon", V.parseDays("Sat-Mon"), ["mon", "sat", "sun"]);
eq("d mixed", V.parseDays("Mon-Fri & Sat"), ["mon", "tue", "wed", "thu", "fri", "sat"]);
eq("d garbage", V.parseDays("whenever"), null);
// headers
eq("h centre_name", V.fieldForHeader("Centre Name"), "name");
eq("h town_or_uc", V.fieldForHeader("town_or_uc"), "area");
eq("h Latitude", V.fieldForHeader("Latitude"), "lat");
eq("h google_maps_link", V.fieldForHeader("google_maps_link"), "maps");
eq("h unknown", V.fieldForHeader("Remarks"), null);
// a whole sheet in the template's column order
const table = [
  ["centre_name", "district", "town_or_uc", "address", "latitude", "longitude", "google_maps_link", "opening_time", "closing_time", "days_open", "vaccines_or_age_groups", "centre_phone", "centre_type", "source_note", "last_verified_date", "Remarks"],
  ["Example row: delete me", "Karachi Central", "Nazimabad", "", 24.9136, 67.0301, "", "09:00", "14:00", "Mon-Sat", "Routine EPI", "", "", "", "", ""],
  ["Health Centre A", "Karachi Central", "Nazimabad", "Block 2", 24.9136, 67.0301, "", "9am", "2pm", "Mon-Sat", "Routine EPI, birth to 15 months", "021-111", "EPI fixed centre", "District list", "2026-11-20", "x"],
  ["Health Centre B", "Karachi Central", "North Nazimabad", "", "", "", "https://www.google.com/maps/place/B/@24.9300,67.0400,17z", "", "", "", "", "", "", "", "", ""],
  ["Health Centre C", "Karachi Central", "Liaquatabad", "", "", "", "https://maps.app.goo.gl/abc123", "08:00", "13:00", "Mon-Fri", "", "", "", "", "20/11/2026", ""],
  ["Health Centre D", "Karachi Central", "Gulberg", "", 67.0801, 24.9201, "", "9", "2", "Mon-Sat", "", "", "", "", "", ""],
  ["Health Centre E", "Karachi Central", "Saddar", "", "", "", "", "9am", "2pm", "Mon-Sat", "", "", "", "", "", ""],
  ["Health Centre F", "Karachi Central", "Saddar", "", 24.86, 67.01, "", "9am", "2pm", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
];
const sh = V.parseTable(table);
eq("sheet header line", sh.headerLine, 1);
eq("sheet rows (example row skipped, blank row skipped)", sh.rows.length, 6);
eq("sheet unmatched header", sh.unmatchedHeaders, ["Remarks"]);
const byName = Object.fromEntries(sh.rows.map((r) => [r.payload.name, r]));
const A = byName["Health Centre A"];
eq("A pin", [A.payload.lat, A.payload.lng], [24.9136, 67.0301]);
eq("A hours mon", A.payload.hours.days.mon, [["09:00", "14:00"]]);
eq("A hours has no sunday", A.payload.hours.days.sun, undefined);
eq("A type kept in notes", A.payload.notes, "EPI fixed centre");
eq("A date", A.payload.last_verified, "2026-11-20");
eq("B pin from long maps link", [byName["Health Centre B"].payload.lat, byName["Health Centre B"].payload.lng], [24.93, 67.04]);
eq("C short link needs resolving", byName["Health Centre C"].needsResolve, "https://maps.app.goo.gl/abc123");
eq("C date dd/mm/yyyy", byName["Health Centre C"].payload.last_verified, "2026-11-20");
eq("D swapped pin corrected", [byName["Health Centre D"].payload.lat, byName["Health Centre D"].payload.lng], [24.9201, 67.0801]);
eq("D 9 to 2 read as afternoon", byName["Health Centre D"].payload.hours.days.mon, [["09:00", "14:00"]]);
eq("D warned twice", byName["Health Centre D"].warnings.length, 2);
eq("E has no pin and nothing to resolve", [byName["Health Centre E"].payload.lat, byName["Health Centre E"].needsResolve], [null, null]);
eq("F no days -> no hours, warned", [byName["Health Centre F"].payload.hours, byName["Health Centre F"].warnings], [null, ["No days given, hours left out"]]);
// sheet with a timings column and different headers
const t2 = V.parseTable([["Name", "UC", "Latitude", "Longitude", "Timings", "Days"], ["Centre X", "UC 4", "24.9", "67.1", "8:30 am - 1:30 pm", "Monday to Saturday"], ["Centre Y", "UC 5", "24.91", "67.11", "24 hours", ""]]);
eq("t2 timings range", t2.rows[0].payload.hours.days.sat, [["08:30", "13:30"]]);
eq("t2 24 hours", t2.rows[1].payload.hours, { always: true });
eq("t2 no missing-column complaint", t2.missingRequired, []);
// bad sheets
eq("no header row", V.parseTable([["foo", "bar"], [1, 2]]).missingRequired.length, 1);
eq("no location column complaint", V.parseTable([["Name", "Area"], ["A", "B"]]).missingRequired.length, 1);
// csv
const csv = V.parseCsv('centre_name,town_or_uc,address\n"Centre, One",Gulshan,"Plot ""5"""\r\n\r\nCentre Two,Saddar,\n');
eq("csv quotes and blank lines", csv, [["centre_name", "town_or_uc", "address"], ["Centre, One", "Gulshan", 'Plot "5"'], ["Centre Two", "Saddar", ""]]);
(async () => {
  // a real .xlsx made in Excel-style: title row above the headers, real time cells, a date cell
  const { readSheet } = await import("read-excel-file/node");
  const table = await readSheet(path.join(__dirname, "fixtures", "vaccination-sample.xlsx"));
  const x = V.parseTable(table);
  eq("xlsx header found below the title row", x.headerLine, 3);
  eq("xlsx 3 rows", x.rows.length, 3);
  eq("xlsx time cells", x.rows[0].payload.hours.days.mon, [["09:00", "14:00"]]);
  eq("xlsx date cell", x.rows[0].payload.last_verified, "2026-11-20");
  eq("xlsx text times", x.rows[1].payload.hours.days.fri, [["08:30", "13:30"]]);
  eq("xlsx link-only pin", [x.rows[2].payload.lat, x.rows[2].payload.lng], [24.93, 67.05]);
  eq("xlsx days list", Object.keys(x.rows[2].payload.hours.days), ["mon", "wed", "fri"]);
  // the real Karachi Central sheet (49 centres; separate town and UC columns, Friday has its own times)
  const kc = V.parseTable(await readSheet(path.join(__dirname, "fixtures", "karachi-central-49-original.xlsx")));
  eq("KC: 49 rows, nothing ignored, nothing missing", [kc.rows.length, kc.unmatchedHeaders.length, kc.missingRequired.length], [49, 0, 0]);
  eq("KC: every row has a pin and a name, no warnings", kc.rows.filter((r) => r.payload.lat == null || !r.payload.name || r.warnings.length).length, 0);
  eq("KC: area is UC then town", kc.rows[0].payload.area, "Azizabad-6, Gulberg");
  eq("KC: Friday has its own hours, other days the usual ones", [kc.rows[0].payload.hours.days.fri, kc.rows[0].payload.hours.days.sat, Object.keys(kc.rows[0].payload.hours.days).length], [[["09:00", "12:30"]], [["09:00", "14:00"]], 6]);
  eq("KC: no Sunday", kc.rows[0].payload.hours.days.sun, undefined);
  // Friday edge cases
  const fr = (extra) => V.parseRow({ name: "A", area: "B", lat: 24.9, lng: 67.0, open: "09:00", close: "14:00", days: "Mon-Sat", ...extra }, 2);
  eq("Friday only one time -> warning, usual times", [fr({ friopen: "09:00" }).warnings.length, fr({ friopen: "09:00" }).payload.hours.days.fri], [1, [["09:00", "14:00"]]]);
  eq("Friday not in days -> warning, ignored", [fr({ days: "Mon-Thu", friopen: "09:00", friclose: "12:30" }).warnings.length, fr({ days: "Mon-Thu", friopen: "09:00", friclose: "12:30" }).payload.hours.days.fri], [1, undefined]);
  eq("Friday 9am to 12:30 pm text", fr({ friopen: "9 AM", friclose: "12:30 PM" }).payload.hours.days.fri, [["09:00", "12:30"]]);
  eq("UC alone is the area", V.parseRow({ name: "A", uc: "Hyderi-7", lat: 24.9, lng: 67 }, 2).payload.area, "Hyderi-7");
  // vaccines offered + service fee
  for (const [t, w] of [["Government", "government"], ["govt", "government"], ["Government vaccine", "government"], ["Private", "private"], ["Private vaccines", "private"], ["Both", "both"], ["Government & Private", "both"], ["Govt and private", "both"], ["", null], ["Free", null], ["maybe", null]])
    eq("vaccine type: " + JSON.stringify(t), V.parseVaccineType(t), w);
  for (const [t, w] of [["Yes", true], ["yes", true], ["Y", true], [true, true], ["No", false], ["", false], [null, false], ["maybe", false]]) eq("service fee: " + JSON.stringify(t), V.parseYes(t), w);
  const vt = (extra, col = true) => V.parseRow({ name: "A", area: "B", lat: 24.9, lng: 67.0, ...extra }, 2, { vtypeColumn: col });
  eq("no vaccines-offered column: key left out (database says government)", [vt({}, false).payload.vaccine_type, "vaccine_type" in V.toRpcRow(vt({}, false).payload)], [undefined, false]);
  eq("column present, cell Private", V.toRpcRow(vt({ vtype: "Private" }).payload).vaccine_type, "private");
  eq("column present, cell empty -> null (database reports the row)", V.toRpcRow(vt({}).payload).vaccine_type, null);
  eq("column present, unreadable -> null + warning", [vt({ vtype: "cheap" }).payload.vaccine_type, vt({ vtype: "cheap" }).warnings.length], [null, 1]);
  eq("service fee yes / empty", [vt({ vtype: "Both", fee: "Yes" }).payload.service_fee, vt({ vtype: "Both" }).payload.service_fee], [true, false]);
  eq("service fee goes to the database as a boolean", V.toRpcRow(vt({ vtype: "Both", fee: "yes" }).payload).service_fee, true);
  eq("KC original sheet: no column, flagged as defaulted", [kc.vtypeDefaulted, kc.rows[0].payload.vaccine_type], [true, undefined]);
  const kc2 = V.parseTable(await readSheet(path.join(__dirname, "fixtures", "karachi-central-49-clean.xlsx")));
  eq("KC clean sheet: 49 rows, all Government, not defaulted, no warnings", [kc2.rows.length, kc2.rows.every((r) => r.payload.vaccine_type === "government"), kc2.vtypeDefaulted, kc2.rows.filter((r) => r.warnings.length).length], [49, true, false, 0]);
  eq("KC clean sheet: service fee empty for all (nothing claimed)", kc2.rows.filter((r) => r.payload.service_fee).length, 0);
  const pv = V.parseTable(await readSheet(path.join(__dirname, "fixtures", "private-vaccine-centres-aku-ziauddin.xlsx")));
  eq("private-vaccine sheet: 5 rows, all Private, no pin yet (the upload will say so)", [pv.rows.length, pv.rows.every((r) => r.payload.vaccine_type === "private"), pv.rows.every((r) => r.payload.lat == null && !r.needsResolve)], [5, true, true]);
  eq("Ziauddin: daily 9 to 9 including Friday", [Object.keys(pv.rows[0].payload.hours.days).length, pv.rows[0].payload.hours.days.fri], [7, [["09:00", "21:00"]]]);
  eq("AKU Clifton: no hours claimed", pv.rows[4].payload.hours, null);
  // our own downloadable template: every header recognised, the example row skipped
  const tpl = V.parseTable(await readSheet(path.join(__dirname, "..", "public", "templates", "vaccination-centres-template.xlsx")));
  eq("template: every column recognised, none ignored (20 incl. vaccines offered and service fee)", [tpl.matched.length, tpl.unmatchedHeaders.length, tpl.missingRequired.length], [20, 0, 0]);
  eq("template: example row is skipped", tpl.rows.length, 0);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
