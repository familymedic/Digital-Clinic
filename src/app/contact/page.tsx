"use client";

import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

// Real contact form (2026-09-23, corrected same day), replacing the
// "coming in a future phase" placeholder. No login required on purpose
// — a prospective patient asking a general question shouldn't have to
// register first. Physician's explicit choice: no separate admin page
// for this — the message plus however the sender wants to be reached
// (email or phone) goes straight to the physician's own inbox via the
// same notification trigger this app already uses for safety-event
// alerts (see supabase/migrations/0045_contact_messages.sql).

export default function Contact() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setError(null);

    if (!email.trim() && !phone.trim()) {
      setError("Please leave either an email address or a phone number so we can get back to you.");
      return;
    }

    setSubmitting(true);
    const { error: insertError } = await supabase.from("contact_messages").insert({
      name: name.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      message: message.trim(),
    });

    setSubmitting(false);
    if (insertError) {
      setError("Something went wrong sending your message. Please try again in a moment.");
      return;
    }
    setSubmitted(true);
  }

  return (
    <div>
      <PageHeader
        title="Contact"
        subtitle="Have a question before booking, or something else on your mind? Send us a message with your email or phone number and we'll get back to you."
      />
      <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        {!isDatabaseConfigured ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so this form can&rsquo;t be submitted here.
          </div>
        ) : submitted ? (
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-6 text-sm text-teal-900">
            Thanks — your message has been sent. We&rsquo;ll get back to you soon.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div>
              <label className="text-xs font-semibold text-slate-600">Your name (optional)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Full name"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-slate-600">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Phone number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="03xx-xxxxxxx"
                />
              </div>
            </div>
            <p className="text-xs text-slate-400">Please leave at least one of the two above so we can reach you.</p>
            <div>
              <label className="text-xs font-semibold text-slate-600">Message</label>
              <textarea
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="How can we help?"
              />
            </div>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-50"
            >
              {submitting ? "Sending…" : "Send message"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
