// Recruiting flyers for the Family Medic Locator (English + Roman Urdu), A4, PNG + PDF.
// Run: node _t/make_flyers.cjs <fontsDir> <outDir>
const { chromium } = require("playwright");
const qrcode = require("qrcode-generator");
const fs = require("fs");
const path = require("path");
const fonts = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
fs.mkdirSync(out, { recursive: true });

function qrSvg(text, px) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let rects = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) rects += `<rect x="${c}" y="${r}" width="1.02" height="1.02"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges" fill="#072927">${rects}</svg>`;
}

const URL_LIST = "https://thefamilymedic.com/locator/list";
const copy = {
  en: {
    kicker: "FAMILY MEDIC LOCATOR · KARACHI",
    h1a: "Is your clinic, pharmacy",
    h1b: "or therapy centre",
    h1c: "easy to find?",
    sub: "Families near you search the Family Medic Locator for doctors, pharmacies, labs, therapy and rehab. List yours and be one tap away.",
    points: [
      ["Be found nearby", "Your workplace appears on a numbered map within 2, 3 and 5 km of people who are looking right now."],
      ["Directions, Call, Book", "One tap takes patients to your door in Google Maps, or straight to your phone."],
      ["Checked and trusted", "Clinics, labs and therapy centres show “Documents checked by Family Medic” after we verify them."],
      ["Your own poster", "You get a private page to track your listing and renew, plus a ready poster with a QR code for your counter."],
    ],
    how: "How to list: scan the code · enter your details · drop a pin at your door · attach your documents · pay a small annual fee.",
    scan: "Scan to list your workplace",
    foot: "Autism-aware barbers, restaurants and shops can be suggested for free.",
    foot2: "No sign-up needed for families · Locations are never saved",
    dir: "ltr",
  },
  ur: {
    kicker: "فیملی میڈک لوکیٹر · کراچی",
    h1a: "کیا آپ کا کلینک، فارمیسی",
    h1b: "یا تھراپی سینٹر",
    h1c: "آسانی سے ڈھونڈا جا سکتا ہے؟",
    sub: "",
    points: [],
    how: "",
    scan: "",
    foot: "",
    foot2: "",
    dir: "ltr",
  },
};

// Roman Urdu (Urdu written in English letters), as the owner's audience reads it.
copy.ur = {
  kicker: "FAMILY MEDIC LOCATOR · KARACHI",
  h1a: "Kya aap ka clinic, pharmacy",
  h1b: "ya therapy centre",
  h1c: "aasani se mil jata hai?",
  sub: "Aap ke qareeb ke khandan Family Medic Locator par doctors, pharmacies, labs aur therapy ya rehab talash karte hain. Apna naam list karwayen aur sirf aik tap door rahen.",
  points: [
    ["Qareeb mein nazar aayen", "Aap ka kaarobar numbered map par 2, 3 aur 5 km ke andar un logon ko nazar aata hai jo abhi talash kar rahe hain."],
    ["Directions, Call, Book", "Aik tap par mareez Google Maps mein aap ke darwaze tak ya seedha aap ke phone tak pohanch jata hai."],
    ["Check shuda aur bharosay mand", "Clinic, lab aur therapy centre ke documents check hone ke baad “Documents checked by Family Medic” likha aata hai."],
    ["Apna poster", "Aap ko private page milta hai jahan listing ki halat dekh kar renew kar sakte hain, aur counter ke liye QR code wala tayyar poster bhi."],
  ],
  how: "List karwane ka tareeqa: code scan karein · details likhein · darwaze par pin lagayen · documents attach karein · chhoti si saalana fees ada karein.",
  scan: "Apna kaarobar list karne ke liye scan karein",
  foot: "Autism-aware barber, restaurant aur dukaanen mufat suggest ki ja sakti hain.",
  foot2: "Khandanon ke liye sign-up ki zaroorat nahi · Location kabhi save nahi hoti",
  dir: "ltr",
};

function html(c) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:PJS;font-weight:600;src:url(file://${fonts}/plus-jakarta-sans-latin-600-normal.woff2)}
@font-face{font-family:PJS;font-weight:700;src:url(file://${fonts}/plus-jakarta-sans-latin-700-normal.woff2)}
@font-face{font-family:PJS;font-weight:800;src:url(file://${fonts}/plus-jakarta-sans-latin-800-normal.woff2)}
*{box-sizing:border-box}html,body{margin:0}
body{width:794px;height:1123px;font-family:PJS,system-ui,sans-serif;color:#0b2b27;background:#f3f9f7;position:relative;overflow:hidden}
.hero{background:radial-gradient(520px 300px at 92% -10%,rgba(45,212,191,.38),transparent 62%),linear-gradient(180deg,#0a3733,#072927);padding:46px 52px 120px;border-radius:0 0 54px 54px;position:relative;overflow:hidden}
.rings{position:absolute;right:-60px;top:-70px;width:420px;height:420px}
.bar{width:54px;height:9px;border-radius:5px;background:#ffb454}
.brand{margin-top:16px;font-weight:800;font-size:22px;color:#fff}
.kicker{margin-top:30px;font-weight:700;font-size:13px;letter-spacing:.16em;color:#c9ece5}
h1{margin:12px 0 0;font-size:45px;line-height:1.08;font-weight:800;color:#fff;letter-spacing:-.01em}
h1 span{color:#ffb454}
.sub{margin:16px 0 0;max-width:600px;font-size:17px;line-height:1.5;color:#d6f1ec}
.cards{margin:-70px 40px 0;display:grid;grid-template-columns:1fr 1fr;gap:14px;position:relative}
.card{background:#fff;border:1px solid #d7e7e2;border-radius:24px;padding:18px 20px;box-shadow:0 20px 34px -26px rgba(7,41,39,.6)}
.card b{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:800}
.card b i{flex:none;width:30px;height:30px;border-radius:50%;background:#0f766e;color:#fff;font-style:normal;display:grid;place-items:center;font-size:15px}
.card p{margin:8px 0 0;font-size:13.5px;line-height:1.48;color:#3e5752}
.how{margin:22px 40px 0;font-weight:700;font-size:14.5px;line-height:1.5;color:#0b4f49}
.bottom{position:absolute;left:40px;right:40px;bottom:36px;display:flex;align-items:center;gap:26px;background:#fff6e8;border-radius:28px;padding:22px 26px}
.qr{flex:none;background:#fff;border-radius:18px;padding:12px;border:1px solid #f1dcb4}
.bt{flex:1}
.bt .scan{font-size:20px;font-weight:800;line-height:1.2}
.bt .url{margin-top:6px;font-size:15px;font-weight:800;color:#0f766e}
.bt .f{margin-top:10px;font-size:12.5px;line-height:1.45;color:#5a4a2a}
</style></head><body>
<div class="hero">
<svg class="rings" viewBox="0 0 420 420" aria-hidden="true"><g fill="none" stroke="rgba(255,255,255,.14)" stroke-width="3" stroke-dasharray="12 10"><circle cx="250" cy="170" r="90"/><circle cx="250" cy="170" r="150"/><circle cx="250" cy="170" r="210"/></g><circle cx="250" cy="170" r="12" fill="#ffb454"/><g fill="#2dd4bf"><circle cx="190" cy="120" r="9"/><circle cx="320" cy="140" r="9"/><circle cx="290" cy="250" r="9"/><circle cx="180" cy="230" r="9"/></g></svg>
<div class="bar"></div><div class="brand">Family Medic</div>
<div class="kicker">${c.kicker}</div>
<h1>${c.h1a}<br>${c.h1b}<br><span>${c.h1c}</span></h1>
<p class="sub">${c.sub}</p>
</div>
<div class="cards">${c.points.map((p, i) => `<div class="card"><b><i>${i + 1}</i>${p[0]}</b><p>${p[1]}</p></div>`).join("")}</div>
<div class="how">${c.how}</div>
<div class="bottom"><div class="qr">${qrSvg(URL_LIST, 150)}</div><div class="bt"><div class="scan">${c.scan}</div><div class="url">thefamilymedic.com/locator/list</div><div class="f">${c.foot}<br>${c.foot2}</div></div></div>
</body></html>`;
}

(async () => {
  const browser = await chromium.launch();
  for (const lang of ["en", "ur"]) {
    const name = lang === "en" ? "locator-flyer-english" : "locator-flyer-roman-urdu";
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
    await page.setContent(html(copy[lang]), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    await page.pdf({ path: path.join(out, `${name}.pdf`), width: "794px", height: "1123px", printBackground: true, pageRanges: "1" });
    await page.close();
  }
  await browser.close();
})();
