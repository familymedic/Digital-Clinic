"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import PosterMaker from "@/components/locator/PosterMaker";
import { CATEGORY_LABEL, kindLabel } from "@/lib/locator";
import { fmtDate, rs, waNumber, type Fee, type Place } from "./types";

// One place in the admin lists, with every action an admin needs on it: verify / reject,
// record a payment (cash, JazzCash, bank, complimentary) with a receipt number, make the
// owner's private link, feature, view stats, poster, edit, hide, delete.

const btn = "rounded-full px-3.5 py-1.5 text-xs font-bold";
const inputCls = "w-full rounded-xl border border-[#cfe0da] bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-teal-600";

export default function PlaceCard(props: {
  p: Place;
  fees: Fee[];
  busy: boolean;
  onStatus: (id: string, status: Place["status"]) => void;
  onEdit: (p: Place) => void;
  onDelete: (p: Place) => void;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const { p } = props;
  const fee = props.fees.find((f) => f.kind === p.kind);
  const paid = p.paid_until ? new Date(p.paid_until) > new Date() : false;
  const needsCheck = p.verification_status === "pending";
  const [panel, setPanel] = useState<null | "verify" | "reject" | "pay" | "link" | "poster" | "stats">(null);
  const [notes, setNotes] = useState(p.verification_notes ?? "");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(String(fee?.fee_pkr ?? 1000));
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [months, setMonths] = useState("12");
  const [receipt, setReceipt] = useState<{ no: number; until: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [proofLinks, setProofLinks] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);

  async function openProof(path: string) {
    try {
      const sess = await supabase?.auth.getSession();
      const token = sess?.data.session?.access_token;
      const res = await fetch("/api/admin/locator/proof", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ path }),
      });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (j.url) {
        setProofLinks((m) => ({ ...m, [path]: j.url as string }));
        window.open(j.url, "_blank", "noopener,noreferrer");
      } else props.onError(j.error ?? "Could not open that file.");
    } catch {
      props.onError("Could not open that file.");
    }
  }

  async function decide(decision: "verified" | "rejected") {
    if (!supabase) return;
    setWorking(true);
    const { error } = await supabase.rpc("locator_admin_verify", {
      p_place: p.id,
      p_decision: decision,
      p_notes: notes,
      p_reason: decision === "rejected" ? reason : null,
    });
    setWorking(false);
    if (error) return props.onError(error.message);
    setPanel(null);
    props.onChanged();
  }

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setWorking(true);
    const { data, error } = await supabase.rpc("locator_admin_record_payment", {
      p_place: p.id,
      p_amount: Math.round(Number(amount)),
      p_method: method,
      p_reference: reference,
      p_note: null,
      p_months: Math.round(Number(months)),
    });
    setWorking(false);
    if (error) return props.onError(error.message);
    const r = data as { receipt_no: number; paid_until: string };
    setReceipt({ no: r.receipt_no, until: r.paid_until });
    props.onChanged();
  }

  async function makeLink() {
    if (!supabase) return;
    if (p.manage_token_hash && !window.confirm("This place already has a private link. Making a new one stops the old link from working. Continue?")) return;
    setWorking(true);
    const { data, error } = await supabase.rpc("locator_admin_make_link", { p_place: p.id });
    setWorking(false);
    if (error) return props.onError(error.message);
    setLink(`${window.location.origin}/locator/manage/${data as string}`);
    setPanel("link");
    props.onChanged();
  }

  async function loadStats() {
    if (!supabase) return;
    setPanel("stats");
    const { data, error } = await supabase.rpc("locator_admin_place_stats", { p_place: p.id });
    if (error) return props.onError(error.message);
    setStats((data ?? {}) as Record<string, number>);
  }

  async function feature(days: number | null) {
    if (!supabase) return;
    const { error } = await supabase
      .from("locator_places")
      .update({ featured_until: days ? new Date(Date.now() + days * 86400000).toISOString() : null })
      .eq("id", p.id);
    if (error) return props.onError(error.message);
    props.onChanged();
  }

  const ownerWa = p.owner_phone ? waNumber(p.owner_phone) : null;
  const subWa = p.submitted_by_phone ? waNumber(p.submitted_by_phone) : null;
  const featuredNow = Boolean(p.featured_until && new Date(p.featured_until) > new Date());
  const waText = link
    ? encodeURIComponent(
        `Assalam o Alaikum ${p.owner_name ?? ""}, your listing for ${p.name} on the Family Medic Locator is set up. See its status and pay or renew here: ${link}`
      )
    : "";

  return (
    <li className="rounded-2xl border border-[#d7e7e2] bg-white p-4" data-testid="admin-place">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-ink-900">{p.name}</div>
          <div className="text-xs text-ink-500">
            {CATEGORY_LABEL[p.category]} · {kindLabel(p.kind)} · {p.area}
            {p.source === "public" && " · suggested by a visitor"}
            {p.source === "owner" && " · applied by the owner"}
            {p.source === "admin" && " · added by admin"}
            {p.source === "doctor" && " · added by the doctor from their dashboard"}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-bold">
            {p.category !== "autism" && (
              <span className={`rounded-full px-2.5 py-0.5 ${paid ? "bg-teal-50 text-teal-800" : p.paid_until ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
                {paid ? `Paid until ${fmtDate(p.paid_until as string)}` : p.paid_until ? `Expired ${fmtDate(p.paid_until)}` : "Not paid"}
              </span>
            )}
            {p.verification_status !== "not_required" && (
              <span
                className={`rounded-full px-2.5 py-0.5 ${
                  p.verification_status === "verified" ? "bg-teal-50 text-teal-800" : p.verification_status === "rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
                }`}
              >
                Documents: {p.verification_status}
              </span>
            )}
            {p.owner_phone && (
              <span className={`rounded-full px-2.5 py-0.5 ${p.phone_verified ? "bg-teal-50 text-teal-800" : "bg-[#eef3f1] text-ink-600"}`}>
                {p.phone_verified ? "Phone code verified" : "Phone not verified"}
              </span>
            )}
            {featuredNow && <span className="rounded-full bg-[#fff0d6] px-2.5 py-0.5 text-[#8a5200]">Featured until {fmtDate(p.featured_until as string)}</span>}
          </div>
        </div>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-bold text-teal-700 underline"
        >
          Check pin on map
        </a>
      </div>

      {(p.address || p.phone || p.notes) && <p className="mt-2 text-sm text-ink-700">{[p.address, p.phone, p.notes].filter(Boolean).join(" · ")}</p>}

      {(p.owner_name || p.owner_phone || p.registration_numbers || p.proof_paths.length > 0) && (
        <div className="mt-2 space-y-1 rounded-xl bg-[#f3f9f7] px-3 py-2 text-xs text-ink-700">
          <p>
            Owner: <strong>{p.owner_name ?? "—"}</strong> {p.owner_phone ? `(${p.owner_phone})` : ""} {p.owner_email ? `· ${p.owner_email}` : ""}{" "}
            {ownerWa && (
              <a href={`https://wa.me/${ownerWa}`} target="_blank" rel="noopener noreferrer" className="font-bold text-teal-700 underline">
                WhatsApp
              </a>
            )}
          </p>
          {p.registration_numbers && <p>Registration / licence: {p.registration_numbers}</p>}
          {p.proof_paths.length > 0 && (
            <p className="flex flex-wrap items-center gap-2">
              Files:
              {p.proof_paths.map((path, i) => (
                <button key={path} onClick={() => openProof(path)} className="rounded-full border border-teal-700 px-2.5 py-0.5 font-bold text-teal-800 hover:bg-teal-50">
                  {proofLinks[path] ? "Open again" : `File ${i + 1}`}
                </button>
              ))}
            </p>
          )}
          {p.verification_notes && <p>Notes: {p.verification_notes}</p>}
          {p.rejection_reason && <p className="text-red-700">Rejected: {p.rejection_reason}</p>}
        </div>
      )}
      {p.source === "public" && (p.submitted_by_name || p.submitted_by_phone) && (
        <p className="mt-2 rounded-xl bg-[#f3f9f7] px-3 py-2 text-xs text-ink-700">
          Sent by {p.submitted_by_name ?? "unknown"} {p.submitted_by_phone ? `(${p.submitted_by_phone})` : ""}. Owner agreement ticked.{" "}
          {subWa && (
            <a href={`https://wa.me/${subWa}`} target="_blank" rel="noopener noreferrer" className="font-bold text-teal-700 underline">
              WhatsApp to confirm
            </a>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {needsCheck && (
          <>
            <button onClick={() => setPanel(panel === "verify" ? null : "verify")} className={`${btn} bg-teal-700 text-white hover:bg-teal-800`}>
              Documents OK: verify
            </button>
            <button onClick={() => setPanel(panel === "reject" ? null : "reject")} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50`}>
              Reject
            </button>
          </>
        )}
        {p.status === "pending" && p.source === "public" && (
          <button disabled={props.busy} onClick={() => props.onStatus(p.id, "approved")} className={`${btn} bg-teal-700 text-white hover:bg-teal-800`}>
            Approve
          </button>
        )}
        {p.category !== "autism" && p.status !== "pending" && (
          <button onClick={() => setPanel(panel === "pay" ? null : "pay")} data-testid="admin-record-payment" className={`${btn} bg-[#ffb454] text-[#3b2500] hover:bg-[#ffc272]`}>
            {paid ? "Renew / record payment" : "Record payment"}
          </button>
        )}
        {p.category !== "autism" && (
          <button onClick={makeLink} disabled={working} className={`${btn} border border-teal-700 text-teal-800 hover:bg-teal-50`}>
            Owner link
          </button>
        )}
        {p.category !== "autism" && (
          <button onClick={() => feature(featuredNow ? null : 30)} className={`${btn} border border-[#cfe0da] text-ink-700 hover:bg-[#f3f9f7]`}>
            {featuredNow ? "Remove featured" : "Feature 30 days"}
          </button>
        )}
        <button onClick={() => setPanel(panel === "poster" ? null : "poster")} className={`${btn} border border-[#cfe0da] text-ink-700 hover:bg-[#f3f9f7]`}>
          Poster
        </button>
        <button onClick={loadStats} className={`${btn} border border-[#cfe0da] text-ink-700 hover:bg-[#f3f9f7]`}>
          30-day stats
        </button>
        {p.status === "approved" && (
          <button disabled={props.busy} onClick={() => props.onStatus(p.id, "hidden")} className={`${btn} border border-amber-400 text-amber-800 hover:bg-amber-50`}>
            Hide
          </button>
        )}
        {p.status === "hidden" && (
          <button disabled={props.busy} onClick={() => props.onStatus(p.id, "approved")} className={`${btn} bg-teal-700 text-white hover:bg-teal-800`}>
            Show again
          </button>
        )}
        {p.status === "pending" && p.source !== "owner" && (
          <button disabled={props.busy} onClick={() => props.onStatus(p.id, "hidden")} className={`${btn} border border-amber-400 text-amber-800 hover:bg-amber-50`}>
            Reject (hide)
          </button>
        )}
        <button onClick={() => props.onEdit(p)} className={`${btn} border border-[#cfe0da] text-ink-700 hover:bg-[#f3f9f7]`}>
          Edit
        </button>
        <button disabled={props.busy} onClick={() => props.onDelete(p)} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50`}>
          Delete
        </button>
      </div>

      {panel === "verify" && (
        <div className="mt-3 space-y-2 rounded-2xl bg-[#f3f9f7] p-3">
          <p className="text-xs font-bold text-ink-900">Checked the licence/registration, the signboard photo and that the pin matches? Add a note for your records (optional).</p>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={600} placeholder="e.g. PMDC 12345 checked on pmdc.pk, signboard matches" className={inputCls} />
          <button disabled={working} onClick={() => decide("verified")} className={`${btn} bg-teal-700 text-white`}>
            {working ? "Saving…" : "Mark as verified"}
          </button>
        </div>
      )}
      {panel === "reject" && (
        <div className="mt-3 space-y-2 rounded-2xl bg-red-50 p-3">
          <p className="text-xs font-bold text-red-900">The owner will see this reason on their page.</p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Licence photo is unreadable. Please send a clearer one." className={inputCls} />
          <button disabled={working || reason.trim().length < 3} onClick={() => decide("rejected")} className={`${btn} bg-red-700 text-white disabled:opacity-60`}>
            Reject application
          </button>
        </div>
      )}
      {panel === "pay" && (
        <form onSubmit={recordPayment} className="mt-3 space-y-2 rounded-2xl bg-[#fff8ec] p-3">
          {receipt ? (
            <div className="text-sm" data-testid="admin-receipt">
              <p className="font-extrabold text-ink-900">Recorded. Receipt no. {receipt.no}</p>
              <p className="text-xs text-ink-700">
                {p.name} · {rs(Number(amount))} ({method}) · live until {fmtDate(receipt.until)}
              </p>
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard?.writeText(
                    `Family Medic Locator receipt no. ${receipt.no}\n${p.name}\nAmount: ${rs(Number(amount))} (${method}${reference ? ", ref " + reference : ""})\nListed until: ${fmtDate(receipt.until)}\nThank you.`
                  )
                }
                className={`${btn} mt-2 border border-teal-700 text-teal-800`}
              >
                Copy receipt text
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs font-bold text-ink-900">Record money you received directly. The listing goes live (or is extended) straight away and gets a receipt number.</p>
              <div className="grid gap-2 sm:grid-cols-4">
                <label className="text-xs font-semibold">
                  Amount (PKR)
                  <input required value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" className={inputCls} />
                </label>
                <label className="text-xs font-semibold">
                  Method
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
                    <option value="cash">Cash</option>
                    <option value="jazzcash">JazzCash</option>
                    <option value="easypaisa">Easypaisa</option>
                    <option value="bank">Bank transfer</option>
                    <option value="complimentary">Complimentary (free)</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="text-xs font-semibold">
                  Months
                  <input required value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" className={inputCls} />
                </label>
                <label className="text-xs font-semibold">
                  Reference
                  <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="txn id / note" className={inputCls} />
                </label>
              </div>
              <button disabled={working} className={`${btn} bg-teal-700 text-white`}>
                {working ? "Saving…" : "Record payment"}
              </button>
            </>
          )}
        </form>
      )}
      {panel === "link" && link && (
        <div className="mt-3 space-y-2 rounded-2xl bg-[#f3f9f7] p-3 text-xs">
          <p className="font-bold text-ink-900">Send this private link to the owner. It shows their status and lets them pay. Statistics stay with you only.</p>
          <p className="break-all rounded-xl bg-white p-2 font-mono" data-testid="admin-owner-link">{link}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => navigator.clipboard?.writeText(link)} className={`${btn} border border-teal-700 text-teal-800`}>
              Copy link
            </button>
            {ownerWa && (
              <a href={`https://wa.me/${ownerWa}?text=${waText}`} target="_blank" rel="noopener noreferrer" className={`${btn} bg-teal-700 text-white`}>
                Send on WhatsApp
              </a>
            )}
          </div>
        </div>
      )}
      {panel === "poster" && (
        <div className="mt-3 rounded-2xl bg-[#f3f9f7] p-3">
          <PosterMaker name={p.name} kindLabel={kindLabel(p.kind)} area={p.area} verified={p.verification_status === "verified"} />
        </div>
      )}
      {panel === "stats" && (
        <div className="mt-3 rounded-2xl bg-[#f3f9f7] p-3 text-xs text-ink-700">
          {stats === null ? (
            "Loading…"
          ) : (
            <>
              Last 30 days: appeared in <strong>{stats.shown ?? 0}</strong> searches · Directions <strong>{stats.directions ?? 0}</strong> · Call{" "}
              <strong>{stats.call ?? 0}</strong> · Book <strong>{stats.book ?? 0}</strong>
            </>
          )}
        </div>
      )}
    </li>
  );
}
