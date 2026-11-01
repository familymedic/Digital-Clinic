"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";

// Admin "Contact messages" (2026-10-29, Zayn: "cant we see the msgs at Admin tab?
// so its easier to follow"). Lists what visitors and doctors send through the
// public Contact page, newest first, with one-tap reply by email or WhatsApp and
// New / Read / Archived marks. Reads straight from contact_messages through the
// admin-only policies in 0045 (0094 re-asserts them), so no patient data is
// exposed to anyone but an admin. The email copy of each message still arrives
// as before; this page is the place to follow them up.

interface Msg {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string;
  status: "new" | "read" | "archived";
  created_at: string;
}

type Filter = "new" | "read" | "archived" | "all";

const STATUS_STYLE: Record<Msg["status"], string> = {
  new: "bg-red-100 text-red-800",
  read: "bg-amber-100 text-amber-800",
  archived: "bg-slate-200 text-slate-700",
};

// Pakistani mobile -> international digits for wa.me (0300... -> 92300...).
function waNumber(phone: string): string | null {
  const d = phone.replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.startsWith("92")) return d;
  if (d.startsWith("0")) return "92" + d.slice(1);
  if (d.length === 10) return "92" + d;
  return d;
}

export default function AdminContactMessages() {
  const [rows, setRows] = useState<Msg[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("new");

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("contact_messages")
      .select("id, name, email, phone, message, status, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      setLoadError(
        /status/i.test(error.message)
          ? "The Contact messages tab needs migration 0094 to be run once in Supabase. (" + error.message + ")"
          : error.message
      );
      setRows([]);
      return;
    }
    setLoadError(null);
    setRows((data ?? []) as Msg[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: string, status: Msg["status"]) {
    if (!supabase) return;
    setUpdating(id);
    const { error } = await supabase.from("contact_messages").update({ status }).eq("id", id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, status } : r)));
  }

  const all = rows ?? [];
  const count = (s: Msg["status"]) => all.filter((r) => r.status === s).length;
  const visible = all.filter((r) => (filter === "all" ? true : r.status === filter));

  const tabs: { key: Filter; label: string }[] = [
    { key: "new", label: `New (${count("new")})` },
    { key: "read", label: `Read (${count("read")})` },
    { key: "archived", label: `Archived (${count("archived")})` },
    { key: "all", label: `All (${all.length})` },
  ];

  return (
    <AdminGuard title="Contact messages">
      {() => (
        <div>
          <PageHeader
            title="Contact messages"
            subtitle="Everything sent through the Contact page, newest first. Reply by email or WhatsApp from here."
          />
          <div className="mx-auto max-w-4xl space-y-4 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>

            <div className="flex flex-wrap gap-2 text-xs">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setFilter(t.key)}
                  className={`rounded-full px-3 py-1 font-medium ${
                    filter === t.key ? "bg-teal-700 text-white" : "bg-[#e6f1ed] text-ink-700"
                  }`}
                >
                  {t.label}
                </button>
              ))}
              <button onClick={load} className="ml-auto font-medium text-teal-700 underline underline-offset-2">
                Refresh
              </button>
            </div>

            {loadError && <p className="text-sm text-red-700">{loadError}</p>}

            {rows === null ? (
              <p className="text-sm text-ink-500">Loading…</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-ink-500">
                {filter === "new" ? "No new messages. You are all caught up." : "Nothing here yet."}
              </p>
            ) : (
              <ul className="space-y-3">
                {visible.map((r) => {
                  const wa = r.phone ? waNumber(r.phone) : null;
                  const subject = encodeURIComponent("Re: your message to Family Medic");
                  return (
                    <li
                      key={r.id}
                      className="rounded-2xl border border-[#d7e7e2] bg-white p-4 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-ink-900">{r.name || "No name given"}</div>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs font-medium text-ink-500">
                            {r.email && <span className="break-all">{r.email}</span>}
                            {r.phone && <span>{r.phone}</span>}
                          </div>
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink-700">{r.message}</p>
                          <div className="mt-1 text-xs text-ink-500">{new Date(r.created_at).toLocaleString()}</div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}
                        >
                          {r.status}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
                        {r.email && (
                          <a
                            href={`mailto:${r.email}?subject=${subject}`}
                            className="font-medium text-teal-700 underline underline-offset-2"
                          >
                            Reply by email
                          </a>
                        )}
                        {wa && (
                          <a
                            href={`https://wa.me/${wa}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-emerald-700 underline underline-offset-2"
                          >
                            WhatsApp
                          </a>
                        )}
                        {r.phone && (
                          <a href={`tel:${r.phone}`} className="font-medium text-slate-700 underline underline-offset-2">
                            Call
                          </a>
                        )}
                        {r.status !== "read" && (
                          <button
                            onClick={() => setStatus(r.id, "read")}
                            disabled={updating === r.id}
                            className="font-medium text-amber-700 underline underline-offset-2 disabled:opacity-50"
                          >
                            Mark read
                          </button>
                        )}
                        {r.status !== "archived" && (
                          <button
                            onClick={() => setStatus(r.id, "archived")}
                            disabled={updating === r.id}
                            className="font-medium text-slate-700 underline underline-offset-2 disabled:opacity-50"
                          >
                            Archive
                          </button>
                        )}
                        {r.status !== "new" && (
                          <button
                            onClick={() => setStatus(r.id, "new")}
                            disabled={updating === r.id}
                            className="font-medium text-red-700 underline underline-offset-2 disabled:opacity-50"
                          >
                            Mark as new
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
