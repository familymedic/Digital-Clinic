"use client";

import { useEffect, useRef, useState } from "react";
import { prepareDocumentUpload } from "@/lib/compressImage";
import { uploadWithProgress } from "@/lib/uploadWithProgress";

// Uploads the PMDC certificate for an existing doctor application
// (2026-10-08): live percentage, automatic retry on a dropped connection,
// a manual Retry button, and the application is never at risk because the
// details were already saved in the previous step.

export default function CertificateUploader({
  getToken,
  initialFile = null,
  autoStart = false,
  onDone,
}: {
  getToken: () => Promise<string>;
  initialFile?: File | null;
  autoStart?: boolean;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(initialFile);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function run(f: File | null) {
    if (!f) {
      setError("Please choose your certificate first.");
      return;
    }
    setBusy(true);
    setError(null);
    setPct(null);
    setNote("Preparing your certificate…");
    try {
      const prepared = await prepareDocumentUpload(f);
      if (!prepared.file) {
        setError(prepared.error ?? "Please choose a different file.");
        return;
      }
      const upload = prepared.file;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const token = await getToken();
        const form = new FormData();
        form.set("certificate", upload);
        setNote(
          (attempt > 1 ? `Connection hiccup — trying again (${attempt}/3). ` : "") +
            `Uploading ${Math.max(1, Math.round(upload.size / 1024))} KB — please keep this page open.`
        );
        setPct(0);
        const r = await uploadWithProgress(
          "/api/doctors/register/certificate",
          form,
          { Authorization: `Bearer ${token}` },
          { onProgress: setPct, sizeBytes: upload.size }
        );
        if (r.ok) {
          setNote(null);
          onDone();
          return;
        }
        // A clear "no" from the server (wrong file, already reviewed...) won't improve on retry.
        if (r.status >= 400 && r.status < 500) {
          setError(r.error ?? "Couldn't upload your certificate.");
          return;
        }
        if (attempt === 3) {
          setError(
            `${r.error ?? "The upload didn't finish."} Your application details are saved — tap Try again, ideally on Wi-Fi or a stronger signal.`
          );
          return;
        }
        await new Promise((res) => setTimeout(res, 2000));
      }
    } catch {
      setError("Something went wrong. Your application details are saved — please tap Try again.");
    } finally {
      setBusy(false);
      setNote(null);
    }
  }

  useEffect(() => {
    if (!autoStart || !initialFile || started.current) return;
    started.current = true;
    (async () => {
      await run(initialFile);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      {!busy && (
        <div>
          <label className="block text-sm font-medium text-slate-900" htmlFor="cert-file">
            PMDC certificate (photo or PDF)
          </label>
          <input
            id="cert-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">A phone photo is fine — it is shrunk automatically so it uploads quickly.</p>
        </div>
      )}
      {busy && (
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="h-2 rounded-full bg-teal-600 transition-all" style={{ width: `${pct ?? 5}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-600">
            {pct != null ? `${pct}% — ` : ""}
            {note}
          </p>
        </div>
      )}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!busy && (
        <button
          type="button"
          onClick={() => run(file)}
          className="rounded-md bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800"
        >
          {error ? "Try again" : "Upload certificate"}
        </button>
      )}
    </div>
  );
}
