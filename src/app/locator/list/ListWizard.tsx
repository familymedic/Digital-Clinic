"use client";

import AreaOptions from "@/components/locator/AreaOptions";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { supabase } from "@/lib/supabaseClient";
import LocationPicker from "@/components/locator/LocationPicker";
import HoursEditor, { hoursForSave } from "@/components/locator/HoursEditor";
import {
  OUTSIDE_MESSAGE,
  OWNER_KINDS,
  PROOF_MAX_BYTES,
  PROOF_MAX_FILES,
  type OpenHours,
} from "@/lib/locator";

// "List your workplace" (Locator, migrations 0095 + 0096). An owner enters the details, drops
// a pin, attaches proof, and gets a private manage link. Clinics, labs, hospitals and therapy
// centres are checked by our team before they can pay; pharmacies can pay straight away. The
// place is never public until the annual fee is paid.

const inputCls =
  "w-full rounded-2xl border border-[#cfe0da] bg-white px-4 py-3 text-sm text-ink-900 outline-none focus:border-teal-600";
const labelCls = "mb-1.5 block text-sm font-bold text-ink-900";

const ERRORS: Record<string, string> = {
  missing_fields: "Please fill in the name and the area.",
  need_location: "Please drop the pin at your door (use the button while you are there, or paste a Google Maps link).",
  outside_pilot: OUTSIDE_MESSAGE,
  consent_required: "Please tick the box to confirm you are the owner or manager.",
  need_contact: "Please add your name and a mobile number so we can reach you.",
  bad_email: "That email address does not look right.",
  bad_hours: "The opening hours do not look right. Please check the times or choose Not set.",
  duplicate: "This place looks like it is already on the locator. If it is yours, please contact us so we can link it to you.",
  slow_down: "Too many tries from this connection. Please wait a little and try again.",
  queue_full: "We have a lot waiting to be reviewed right now. Please try again in a few days.",
};

interface Fee {
  kind: string;
  label: string;
  fee_pkr: number;
  requires_verification: boolean;
}

async function shrink(file: File): Promise<File> {
  try {
    if (!file.type.startsWith("image/") || file.size < 900_000) return file;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.82));
    return blob ? new File([blob], "proof.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

const rs = (n: number) => `PKR ${n.toLocaleString("en-PK")}`;

export default function ListWizard() {
  const [step, setStep] = useState(1);
  const [fees, setFees] = useState<Fee[]>(
    OWNER_KINDS.map((k) => ({ kind: k.value, label: k.label, fee_pkr: k.fee, requires_verification: k.verify }))
  );
  const [kind, setKind] = useState("");
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [hours, setHours] = useState<OpenHours | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [registration, setRegistration] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot
  const [files, setFiles] = useState<File[]>([]);
  const [fileMsg, setFileMsg] = useState<string | null>(null);
  const [smsOn, setSmsOn] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [proof, setProof] = useState<string | null>(null);
  const [codeMsg, setCodeMsg] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<null | { token: string; requiresVerification: boolean; feePkr: number; uploaded: number; failed: number }>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Fees come from the database (the admin can change them); the built-in list is only a fallback.
  useEffect(() => {
    const db = supabase;
    if (!db) return;
    let cancelled = false;
    (async () => {
      const { data } = await db.rpc("locator_fee_list");
      if (cancelled || !Array.isArray(data) || data.length === 0) return;
      setFees((data as Fee[]).map((f) => ({ ...f, fee_pkr: Number(f.fee_pkr) })));
    })();
    fetch("/api/locator/phone/send")
      .then((r) => r.json())
      .then((j: { sms?: boolean }) => {
        if (!cancelled) setSmsOn(Boolean(j.sms));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const fee = fees.find((f) => f.kind === kind);
  const needsDocs = fee?.requires_verification ?? true;

  async function sendCode() {
    setCodeMsg(null);
    try {
      const res = await fetch("/api/locator/phone/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: ownerPhone }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (j.ok) {
        setCodeSent(true);
        setCodeMsg("We sent a 6-digit code to that number.");
      } else if (j.error === "bad_phone") setCodeMsg("Please enter a Pakistani mobile number like 0300 1234567.");
      else if (j.error === "too_soon") setCodeMsg("Please wait a minute before asking for another code.");
      else if (j.error === "too_many") setCodeMsg("Too many codes today. We will call you to confirm the number instead.");
      else {
        setSmsOn(false);
        setCodeMsg("Codes are not available right now. We will call you to confirm the number instead.");
      }
    } catch {
      setCodeMsg("Could not send the code. Please try again.");
    }
  }

  async function verifyCode() {
    setCodeMsg(null);
    try {
      const res = await fetch("/api/locator/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: ownerPhone, code }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; proof?: string };
      if (j.ok && j.proof) {
        setProof(j.proof);
        setCodeMsg("Number verified.");
      } else setCodeMsg("That code is not right (or it has expired). Please try again.");
    } catch {
      setCodeMsg("Could not check the code. Please try again.");
    }
  }

  async function addFiles(list: FileList | null) {
    setFileMsg(null);
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= PROOF_MAX_FILES) {
        setFileMsg(`You can attach up to ${PROOF_MAX_FILES} files.`);
        break;
      }
      const small = await shrink(f);
      if (small.size > PROOF_MAX_BYTES) {
        setFileMsg("One file is too large (the limit is about 3.5 MB). Please send a smaller photo or PDF.");
        continue;
      }
      if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(small.type)) {
        setFileMsg("Only photos (JPG, PNG, WebP) and PDFs can be attached.");
        continue;
      }
      next.push(small);
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = "";
  }

  function canGo(s: number): string | null {
    if (s === 1 && !kind) return "Please choose what you are listing.";
    if (s === 2) {
      if (name.trim().length < 2) return "Please enter the name.";
      if (!area) return "Please choose the area.";
    }
    if (s === 3 && !coords) return "Please drop the pin at your door first.";
    return null;
  }

  function next() {
    const problem = canGo(step);
    if (problem) {
      setMsg(problem);
      setState("error");
      return;
    }
    setState("idle");
    setMsg("");
    setStep(step + 1);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!coords) return;
    if (files.length === 0) {
      setMsg(needsDocs ? "Please attach at least one document or photo (licence, registration or signboard)." : "Please attach a photo of your shop signboard.");
      setState("error");
      return;
    }
    setState("sending");
    setMsg("");
    try {
      const res = await fetch("/api/locator/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind, name, area, address, phone, notes, hours: hoursForSave(hours),
          lat: coords.lat, lng: coords.lng,
          ownerName, ownerPhone, ownerEmail, registration,
          phoneProof: proof, consent, website,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; token?: string; requiresVerification?: boolean; feePkr?: number;
      };
      if (!res.ok || !j.ok || !j.token) {
        setMsg(ERRORS[j.error ?? ""] ?? "Something went wrong. Please try again.");
        setState("error");
        return;
      }
      try {
        window.localStorage.setItem("fm_locator_link", j.token);
      } catch {
        // storage can be blocked; the page shows the link anyway
      }
      let uploaded = 0;
      let failed = 0;
      for (const f of files) {
        const fd = new FormData();
        fd.append("token", j.token);
        fd.append("file", f);
        try {
          const up = await fetch("/api/locator/proof", { method: "POST", body: fd });
          if (up.ok) uploaded += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      setDone({ token: j.token, requiresVerification: Boolean(j.requiresVerification), feePkr: Number(j.feePkr ?? 0), uploaded, failed });
    } catch {
      setMsg("Something went wrong. Please check your connection and try again.");
      setState("error");
    }
  }

  /* -------------------------------------------------------------- done */
  if (done) {
    return <Done info={done} name={name} />;
  }

  const steps = ["Type", "Details", "Pin", "You"];
  return (
    <div>
      <PageHeader
        title="List your workplace"
        subtitle="Get found by families near you. Drop a pin, verify, and pay a small annual fee to go live."
      />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Link href="/locator" className="text-sm font-medium text-teal-700 underline underline-offset-2">
          ← Back to the locator
        </Link>

        <ol className="mt-5 flex items-center gap-2" aria-label="Steps">
          {steps.map((s, i) => (
            <li
              key={s}
              className={`flex-1 rounded-full px-3 py-2 text-center text-xs font-extrabold ${
                step === i + 1 ? "bg-teal-700 text-white" : step > i + 1 ? "bg-teal-50 text-teal-800" : "bg-[#e6f1ed] text-ink-500"
              }`}
            >
              {i + 1} · {s}
            </li>
          ))}
        </ol>

        <form onSubmit={submit} className="mt-5 space-y-5 rounded-3xl border border-[#d7e7e2] bg-white p-5 sm:p-7">
          {step === 1 && (
            <div>
              <span className={labelCls}>What are you listing?</span>
              <div className="grid gap-2 sm:grid-cols-2">
                {fees.map((f) => (
                  <button
                    type="button"
                    key={f.kind}
                    onClick={() => setKind(f.kind)}
                    aria-pressed={kind === f.kind}
                    data-testid={`list-kind-${f.kind}`}
                    className={`rounded-2xl border p-3.5 text-left transition ${
                      kind === f.kind ? "border-teal-700 bg-teal-50" : "border-[#d7e7e2] bg-white hover:border-teal-600"
                    }`}
                  >
                    <span className="block text-sm font-extrabold text-ink-900">{f.label}</span>
                    <span className="mt-0.5 block text-xs font-semibold text-ink-500">
                      {rs(f.fee_pkr)} a year · {f.requires_verification ? "documents checked first" : "no document check"}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-ink-500">
                Autism-Aware Places (barbers, restaurants, shops, parks) are free:{" "}
                <Link href="/locator/suggest?tab=autism" className="font-bold text-teal-800 underline">
                  suggest one here
                </Link>
                .
              </p>
            </div>
          )}

          {step === 2 && (
            <>
              <div>
                <label className={labelCls} htmlFor="wname">Name of your {fee?.label.toLowerCase() ?? "workplace"}</label>
                <input id="wname" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={inputCls} data-testid="list-name" />
              </div>
              <div>
                <label className={labelCls} htmlFor="warea">Area</label>
                <select id="warea" value={area} onChange={(e) => setArea(e.target.value)} className={inputCls} data-testid="list-area">
                  <option value="">Choose the area…</option>
                  <AreaOptions withOther />
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="waddr">Address (optional)</label>
                <input id="waddr" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={240} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="wphone">Phone shown to the public (optional)</label>
                <input id="wphone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="wnotes">Timings or details (optional)</label>
                <input id="wnotes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={400} placeholder="e.g. Evening OPD 5 to 9 pm, open on Sundays" className={inputCls} />
              </div>
              <div>
                <span className={labelCls}>Opening hours (optional)</span>
                <p className="mb-2 text-xs text-ink-500">Families see &ldquo;Open now&rdquo; or &ldquo;Closed now&rdquo; next to your name.</p>
                <HoursEditor value={hours} onChange={setHours} idPrefix="list-hours" />
              </div>
            </>
          )}

          {step === 3 && (
            <div>
              <span className={labelCls}>Drop the pin at your door</span>
              <p className="mb-3 text-sm text-ink-700">
                This is what makes &ldquo;Directions&rdquo; take people to the right door. Stand at your {fee?.label.toLowerCase() ?? "workplace"} and tap the button, or paste a Google Maps link.
              </p>
              <LocationPicker
                value={coords}
                onPick={setCoords}
                ids={{ gps: "list-use-here", paste: "list-paste", ok: "list-pin-ok" }}
              />
            </div>
          )}

          {step === 4 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls} htmlFor="oname">Your name</label>
                  <input id="oname" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} maxLength={80} className={inputCls} data-testid="list-owner-name" />
                </div>
                <div>
                  <label className={labelCls} htmlFor="ophone">Your mobile</label>
                  <input id="ophone" value={ownerPhone} onChange={(e) => { setOwnerPhone(e.target.value); setProof(null); setCodeSent(false); }} maxLength={30} inputMode="tel" placeholder="0300 1234567" className={inputCls} data-testid="list-owner-phone" />
                </div>
              </div>
              {smsOn && (
                <div className="rounded-2xl bg-[#f3f9f7] p-3.5 text-sm">
                  {proof ? (
                    <p className="font-bold text-teal-800">✓ Number verified</p>
                  ) : (
                    <>
                      <p className="font-semibold text-ink-700">Verify your number with a 6-digit code (it helps us approve you faster).</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={sendCode} className="min-h-10 rounded-full border border-teal-700 px-4 text-sm font-extrabold text-teal-800 hover:bg-teal-50">
                          {codeSent ? "Send again" : "Send code"}
                        </button>
                        {codeSent && (
                          <>
                            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="000000" aria-label="6-digit code" className="w-28 rounded-xl border border-[#cfe0da] bg-white px-3 py-2 text-sm" />
                            <button type="button" onClick={verifyCode} className="min-h-10 rounded-full bg-teal-700 px-4 text-sm font-extrabold text-white">Check</button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                  {codeMsg && <p className="mt-2 text-xs font-semibold text-ink-700">{codeMsg}</p>}
                </div>
              )}
              <div>
                <label className={labelCls} htmlFor="oemail">Email (optional)</label>
                <input id="oemail" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} maxLength={120} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="oreg">
                  {needsDocs ? "Registration or licence numbers (PMDC, SHCC, AHPC, DRAP… as they apply)" : "Drug licence number (optional)"}
                </label>
                <input id="oreg" value={registration} onChange={(e) => setRegistration(e.target.value)} maxLength={300} className={inputCls} />
              </div>
              <div>
                <span className={labelCls}>
                  {needsDocs ? "Attach your documents and a signboard photo" : "Attach a photo of your shop signboard"}
                </span>
                <p className="mb-2 text-xs text-ink-500">
                  {needsDocs
                    ? "A registration or licence certificate, and a photo of the signboard at your door. Photos and PDFs, up to " + PROOF_MAX_FILES + " files. Only our team can open them."
                    : "A clear photo of the shop signboard. Only our team can open it."}
                </p>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(e) => addFiles(e.target.files)} className="block w-full text-sm" data-testid="list-files" />
                {files.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-ink-700">
                    {files.map((f, i) => (
                      <li key={i} className="flex items-center justify-between rounded-xl bg-[#f3f9f7] px-3 py-1.5">
                        <span className="truncate">{f.name} · {(f.size / 1024).toFixed(0)} KB</span>
                        <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="font-bold text-red-700">Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
                {fileMsg && <p className="mt-2 text-sm font-semibold text-amber-800">{fileMsg}</p>}
              </div>
              <label className="flex items-start gap-3 rounded-2xl bg-[#f3f9f7] p-3.5 text-sm text-ink-700">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required className="mt-1 h-4 w-4" data-testid="list-consent" />
                <span>
                  I am the owner or an authorised manager of this place and I agree to it being listed on the Family Medic Locator after it is checked and the annual fee is paid. The information and documents I gave are true.
                </span>
              </label>
              <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" name="website" />
              <p className="text-sm text-ink-700">
                Annual fee: <strong>{rs(fee?.fee_pkr ?? 0)}</strong>.{" "}
                {needsDocs ? "You pay after our team has checked your documents." : "You can pay right after you submit."}
              </p>
            </>
          )}

          {state === "error" && msg && <p className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-800">{msg}</p>}

          <div className="flex items-center justify-between gap-3">
            {step > 1 ? (
              <button type="button" onClick={() => { setStep(step - 1); setState("idle"); setMsg(""); }} className="min-h-11 rounded-full border border-[#cfe0da] px-5 text-sm font-extrabold text-ink-700">
                Back
              </button>
            ) : <span />}
            {step < 4 ? (
              <button type="button" onClick={next} data-testid="list-next" className="min-h-11 rounded-full bg-teal-700 px-7 text-sm font-extrabold text-white hover:bg-teal-800">
                Next
              </button>
            ) : (
              <button type="submit" disabled={state === "sending"} data-testid="list-submit" className="min-h-11 rounded-full bg-teal-700 px-7 text-sm font-extrabold text-white hover:bg-teal-800 disabled:opacity-60">
                {state === "sending" ? "Sending…" : "Submit"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function Done({ info, name }: { info: { token: string; requiresVerification: boolean; feePkr: number; uploaded: number; failed: number }; name: string }) {
  const [copied, setCopied] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payMsg, setPayMsg] = useState("");
  const link = typeof window !== "undefined" ? `${window.location.origin}/locator/manage/${info.token}` : `/locator/manage/${info.token}`;

  async function pay() {
    setPaying(true);
    setPayMsg("");
    try {
      const res = await fetch("/api/locator/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: info.token }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; checkoutUrl?: string; error?: string };
      if (j.ok && j.checkoutUrl) {
        window.location.href = j.checkoutUrl;
        return;
      }
      setPayMsg(
        j.error === "payments_unavailable"
          ? "Online payment is not available right now. Save your link: we will contact you to take payment."
          : "Could not start the payment. Please try again from your page in a minute."
      );
    } catch {
      setPayMsg("Could not start the payment. Please try again from your page in a minute.");
    }
    setPaying(false);
  }

  return (
    <div>
      <PageHeader title="Thank you" subtitle={`${name} is with our team.`} />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <div className="rounded-3xl border border-[#d7e7e2] bg-white p-6 text-sm text-ink-700">
          <p className="text-base font-extrabold text-ink-900">We have received your application.</p>
          {info.failed > 0 && (
            <p className="mt-2 rounded-2xl bg-amber-50 p-3 font-semibold text-amber-900">
              {info.uploaded} file(s) uploaded, {info.failed} did not go through. Open your page below and we will ask for them again, or send them to us on WhatsApp.
            </p>
          )}
          {info.requiresVerification ? (
            <p className="mt-2">
              Our team will check your documents and pin, usually within 1 to 3 working days. Once approved, the &ldquo;Pay&rdquo; button on your page switches on
              ({`PKR ${info.feePkr.toLocaleString("en-PK")}`} a year) and you go live as soon as you have paid.
            </p>
          ) : (
            <>
              <p className="mt-2">
                No document check is needed for a pharmacy. Pay the annual fee ({`PKR ${info.feePkr.toLocaleString("en-PK")}`}) and your pharmacy appears on the locator straight away.
              </p>
              <button onClick={pay} disabled={paying} data-testid="list-pay" className="mt-4 min-h-11 rounded-full bg-[#ffb454] px-6 text-sm font-extrabold text-[#3b2500] hover:bg-[#ffc272] disabled:opacity-60">
                {paying ? "Opening payment…" : `Pay PKR ${info.feePkr.toLocaleString("en-PK")} now`}
              </button>
              {payMsg && <p className="mt-2 font-semibold text-amber-800">{payMsg}</p>}
            </>
          )}
          <div className="mt-5 rounded-2xl bg-[#f3f9f7] p-4">
            <p className="font-extrabold text-ink-900">Save your private link</p>
            <p className="mt-1 text-xs">It is the only way back to your page: your status and payment. Anyone with this link can see it, so keep it to yourself.</p>
            <p className="mt-2 break-all rounded-xl bg-white p-2 text-xs font-mono" data-testid="list-manage-link">{link}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
                className="min-h-10 rounded-full border border-teal-700 px-4 text-sm font-extrabold text-teal-800"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              <Link href={`/locator/manage/${info.token}`} className="inline-flex min-h-10 items-center rounded-full bg-teal-700 px-4 text-sm font-extrabold text-white">
                Open my page
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
