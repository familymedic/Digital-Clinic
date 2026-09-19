"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Health Records (2026-09-19, physician: "still cannot see space to
// upload report of check past summary"). One of these renders per
// family member on the dashboard — lets the account holder attach a
// report to that person at any time (not tied to a specific open
// consultation, unlike the message-thread attachments in
// MessageThread.tsx) and see what's already on file. Storage/RLS side
// of this lives in migrations/0042_patient_documents.sql — patients
// upload and view their own family's documents; doctors get view-only
// access once they've had a consultation with that person.
//
// Deliberately no delete/rename here, matching the migration: a
// clinical record reads as permanent, so there's nothing to wire up.

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "application/pdf"];

interface DocRow {
  id: string;
  file_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  description: string | null;
  created_at: string;
}

interface Props {
  familyMemberId: string;
  familyMemberName: string;
  accountUserId: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PatientDocuments({ familyMemberId, familyMemberName, accountUserId }: Props) {
  const [documents, setDocuments] = useState<DocRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("patient_documents")
      .select("id, file_path, file_name, content_type, size_bytes, description, created_at")
      .eq("family_member_id", familyMemberId)
      .order("created_at", { ascending: false });

    if (error) {
      setLoadError(error.message);
    } else {
      setDocuments(data as DocRow[]);
    }
  }, [familyMemberId]);

  useEffect(() => {
    load();
  }, [load]);

  function onFileChosen(f: File | null) {
    setFileError(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (!ALLOWED_TYPES.includes(f.type)) {
      setFileError("Only images (PNG/JPEG/WEBP/HEIC) or PDF files can be uploaded.");
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError("That file is larger than 10MB — please upload a smaller file.");
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function handleUpload() {
    if (!supabase || !file) return;
    setUploading(true);
    setUploadError(null);

    const path = `${familyMemberId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadErr } = await supabase.storage
      .from("patient-documents")
      .upload(path, file, { contentType: file.type });
    if (uploadErr) {
      setUploading(false);
      setUploadError(`Couldn't upload the file: ${uploadErr.message}`);
      return;
    }

    const { error: insertErr } = await supabase.from("patient_documents").insert({
      family_member_id: familyMemberId,
      uploaded_by: accountUserId,
      file_path: path,
      file_name: file.name,
      content_type: file.type,
      size_bytes: file.size,
      description: description.trim() || null,
    });

    setUploading(false);
    if (insertErr) {
      setUploadError(insertErr.message);
      return;
    }

    setDescription("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    load();
  }

  async function viewDoc(path: string) {
    if (!supabase) return;
    const { data, error } = await supabase.storage.from("patient-documents").createSignedUrl(path, 60);
    if (error || !data) {
      setUploadError(`Couldn't open that file: ${error?.message ?? "unknown error"}`);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="rounded-2xl border border-ink-border bg-white p-5 shadow-sm">
      <h3 className="text-[13.5px] font-bold text-ink-900">{familyMemberName}</h3>

      {loadError && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          Couldn&rsquo;t load documents: {loadError}
        </div>
      )}

      {!loadError && documents === null && <p className="mt-3 text-xs text-ink-400">Loading…</p>}

      {!loadError && documents && documents.length === 0 && (
        <p className="mt-3 text-xs text-ink-400">No reports uploaded yet.</p>
      )}

      {!loadError && documents && documents.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {documents.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 rounded-xl bg-[var(--background)] p-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold text-ink-900">
                  {d.description || d.file_name}
                </div>
                <div className="mt-0.5 text-[11px] text-ink-400">
                  {new Date(d.created_at).toLocaleDateString()} · {formatSize(d.size_bytes)}
                </div>
              </div>
              <button
                onClick={() => viewDoc(d.file_path)}
                className="shrink-0 text-[11.5px] font-bold text-teal-700 underline underline-offset-2"
              >
                View
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2 border-t border-ink-border pt-3.5">
        {uploadError && <p className="text-xs text-red-700">{uploadError}</p>}
        {fileError && <p className="text-xs text-red-700">{fileError}</p>}
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this report? (optional)"
          maxLength={200}
          className="w-full rounded-lg border border-ink-border px-3 py-2 text-xs"
        />
        <div className="flex items-center justify-between gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
            onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
            className="min-w-0 flex-1 text-[11px] text-ink-500"
          />
          <button
            onClick={handleUpload}
            disabled={uploading || !file}
            className="shrink-0 rounded-full bg-teal-700 px-3.5 py-2 text-[11.5px] font-bold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
