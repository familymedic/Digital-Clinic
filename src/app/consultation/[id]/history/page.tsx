"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// The guided history questionnaire was retired (2026-10-06, physician: the
// questions were annoying and the doctor takes the history directly).
// This route is kept only so old bookmarks and emails don't land on a 404;
// it sends the patient to their dashboard.
export default function HistoryRetired() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return (
    <div className="mx-auto max-w-md px-4 py-12 text-sm text-slate-500 sm:px-6">
      <p>Taking you to your dashboard…</p>
      <Link href="/dashboard" className="mt-3 inline-block font-medium text-teal-700 underline underline-offset-2">
        Go to dashboard
      </Link>
    </div>
  );
}
