"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Phase 8 add-on: the ongoing message thread for text-mode
// consultations (Section 8/14). Shared between the patient's page and
// the doctor's clinical workspace — same component, `viewerRole` picks
// which side "you" are. Locks (no more sending, either side) once the
// consultation's prescription has been issued, mirroring how the
// assessment itself locks on issue (0018) — enforced for real by the
// database (0022), this prop just drives the UI so a rejected send
// isn't the first the person hears of it.

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "application/pdf"];

interface Message {
  id: string;
  sender_role: "patient" | "doctor";
  body: string | null;
  attachment_path: string | null;
  attachment_filename: string | null;
  created_at: string;
}

interface Props {
  consultationId: string;
  viewerRole: "patient" | "doctor";
  senderId: string;
  locked: boolean;
}

export default function MessageThread({ consultationId, viewerRole, senderId, locked }: Props) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("consultation_messages")
      .select("id, sender_role, body, attachment_path, attachment_filename, created_at")
      .eq("consultation_id", consultationId)
      .order("created_at", { ascending: true });

    if (error) {
      setLoadError(error.message);
    } else {
      setMessages(data as Message[]);
    }
  }, [consultationId]);

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
      setFileError("Only images (PNG/JPEG/WEBP/HEIC) or PDF files can be attached.");
      setFile(null);
      return;
    }
    if (f.size > MAX_ATTACHMENT_BYTES) {
      setFileError("That file is larger than 10MB — please attach a smaller file.");
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function sendMessage() {
    if (!supabase) return;
    if (!body.trim() && !file) return;
    setSending(true);
    setSendError(null);

    let attachment_path: string | null = null;
    let attachment_filename: string | null = null;
    let attachment_content_type: string | null = null;
    let attachment_size_bytes: number | null = null;

    if (file) {
      const path = `${consultationId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("consultation-attachments")
        .upload(path, file, { contentType: file.type });
      if (uploadError) {
        setSending(false);
        setSendError(`Couldn't upload the file: ${uploadError.message}`);
        return;
      }
      attachment_path = path;
      attachment_filename = file.name;
      attachment_content_type = file.type;
      attachment_size_bytes = file.size;
    }

    const { error: insertError } = await supabase.from("consultation_messages").insert({
      consultation_id: consultationId,
      sender_role: viewerRole,
      sender_id: senderId,
      body: body.trim() || null,
      attachment_path,
      attachment_filename,
      attachment_content_type,
      attachment_size_bytes,
    });

    setSending(false);
    if (insertError) {
      setSendError(
        insertError.message.includes("row-level security")
          ? "This conversation is closed — a prescription has already been issued."
          : insertError.message
      );
      return;
    }

    setBody("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    load();
  }

  async function viewAttachment(path: string) {
    if (!supabase) return;
    const { data, error } = await supabase.storage
      .from("consultation-attachments")
      .createSignedUrl(path, 60);
    if (error || !data) {
      setSendError(`Couldn't open that file: ${error?.message ?? "unknown error"}`);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  if (loadError) {
    return <p className="text-sm text-red-700">Couldn&rsquo;t load messages: {loadError}</p>;
  }

  if (messages === null) {
    return <p className="text-sm text-slate-400">Loading…</p>;
  }

  return (
    <div className="space-y-3">
      {messages.length === 0 && (
        <p className="text-sm text-slate-400">No messages yet.</p>
      )}

      <ul className="max-h-96 space-y-2 overflow-y-auto">
        {messages.map((m) => {
          const own = m.sender_role === viewerRole;
          return (
            <li key={m.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  own ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-800"
                }`}
              >
                <div className="text-xs font-medium opacity-70">
                  {m.sender_role === "doctor" ? "Doctor" : "Patient"} ·{" "}
                  {new Date(m.created_at).toLocaleString()}
                </div>
                {m.body && <p className="mt-1 whitespace-pre-wrap">{m.body}</p>}
                {m.attachment_path && (
                  <button
                    onClick={() => viewAttachment(m.attachment_path!)}
                    className={`mt-1 block text-xs underline underline-offset-2 ${
                      own ? "text-teal-100" : "text-teal-700"
                    }`}
                  >
                    📎 {m.attachment_filename ?? "Attachment"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {locked ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
          This conversation is closed — the prescription has been issued, so no further messages can
          be sent.
        </p>
      ) : (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          {sendError && <p className="text-sm text-red-700">{sendError}</p>}
          {fileError && <p className="text-sm text-red-700">{fileError}</p>}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type a message…"
            rows={2}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-between gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
              onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
              className="text-xs text-slate-500"
            />
            <button
              onClick={sendMessage}
              disabled={sending || (!body.trim() && !file)}
              className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
          {file && !fileError && (
            <p className="text-xs text-slate-400">Attaching: {file.name}</p>
          )}
        </div>
      )}
    </div>
  );
}
