"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/monitoredFetch";

// A saved appointment link (sent to themselves by the patient after paying).
// Opening it signs the patient in to their own booking and takes them
// straight to it. The page address is replaced as soon as the sign-in has
// worked, so the link isn't left sitting in the browser's history.
export default function OpenAppointment() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [failure, setError] = useState<string | null>(null);
  const started = useRef(false);
  const error = !isDatabaseConfigured || !supabase ? "The database isn't connected yet." : failure;

  useEffect(() => {
    if (started.current) return;
    if (!isDatabaseConfigured || !supabase) return;
    started.current = true;
    const client = supabase;
    (async () => {
      const result = await apiFetch<{ email?: string; password?: string; next?: string; error?: string }>(
        "/api/access/redeem",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: params.token }),
        }
      );
      const data = result.data;
      if (!result.ok || !data?.email || !data?.password) {
        setError(result.error ?? data?.error ?? "This link isn't valid any more.");
        return;
      }
      const { error: signInError } = await client.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (signInError) {
        setError("We couldn't open your appointment. Please try again.");
        return;
      }
      router.replace(data.next ?? "/dashboard");
    })();
  }, [params.token, router]);

  return (
    <div>
      <PageHeader title="Opening your appointment" />
      <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
        {!error ? (
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-6 text-sm text-sky-900">
            <p className="flex items-center gap-3 font-medium">
              <span
                aria-hidden="true"
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-sky-300 border-t-sky-700"
              />
              Please wait a moment&hellip;
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
            <Link
              href="/find-appointment"
              className="inline-flex w-full items-center justify-center rounded-full bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
            >
              Find my appointment
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
