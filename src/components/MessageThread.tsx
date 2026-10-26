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

// Live updates (2026-10-12): the thread quietly re-checks for new messages
// every few seconds while the page is open and visible, so neither side has
// to refresh. It pauses while the tab is hidden or the phone is offline,
// catches up immediately when the person comes back, and backs off if the
// connection is poor so it never piles up requests or fills Site health.
const POLL_MS = 5000;
const POLL_MAX_MS = 60000;

// Reply to a message (2026-10-16): swipe a message to the right (phone) or use
// the Reply button on hover (computer) to quote it, like WhatsApp. A reply is
// just a message that points at an earlier one in the same conversation
// (reply_to_id, migration 0078). If that column isn't in the database yet the
// thread quietly carries on without replies, so deploy order can't break chat.
const SWIPE_TRIGGER_PX = 56;
const SWIPE_MAX_PX = 80;
const BASE_COLS = "id, sender_role, body, attachment_path, attachment_filename, attachment_content_type, created_at";

interface Message {
  id: string;
  sender_role: "patient" | "doctor";
  body: string | null;
  attachment_path: string | null;
  attachment_filename: string | null;
  attachment_content_type?: string | null;
  created_at: string;
  reply_to_id?: string | null;
}

interface Props {
  consultationId: string;
  viewerRole: "patient" | "doctor";
  senderId: string;
  locked: boolean;
}

function snippetOf(m: Message): string {
  if (m.body && m.body.trim()) return m.body.trim();
  if (m.attachment_path && isVoiceNote(m)) return "🎤 Voice note";
  if (m.attachment_path) return `📎 ${m.attachment_filename ?? "Attachment"}`;
  return "";
}

// Voice notes (migration 0091): an audio file sent like any attachment.
function isVoiceNote(m: { attachment_content_type?: string | null }): boolean {
  return !!m.attachment_content_type && m.attachment_content_type.startsWith("audio/");
}

const MAX_VOICE_SECONDS = 120;

function voiceMime(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const options: [string, string][] = [
    ["audio/webm;codecs=opus", "webm"],
    ["audio/webm", "webm"],
    ["audio/mp4", "m4a"],
    ["audio/ogg;codecs=opus", "ogg"],
  ];
  for (const [mime, ext] of options) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
    } catch {
      /* try the next one */
    }
  }
  return null;
}

// Plays a voice note: the private file is only fetched (through a short-lived
// signed link) when the person presses play.
function VoicePlayer({ path, own }: { path: string; own: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function open() {
    if (!supabase) return;
    setErr(null);
    const { data, error } = await supabase.storage.from("consultation-attachments").createSignedUrl(path, 3600);
    if (error || !data) {
      setErr("Couldn't load the voice note. Please try again.");
      return;
    }
    setUrl(data.signedUrl);
  }
  if (url) {
    return <audio controls autoPlay src={url} className="mt-1 h-9 max-w-full" />;
  }
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={open}
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${own ? "bg-white/20 text-white" : "bg-white text-teal-800"}`}
      >
        <span aria-hidden="true">▶</span> Play voice note
      </button>
      {err && <span className="ml-2 text-xs text-red-200">{err}</span>}
    </div>
  );
}

// One chat bubble. Handles the swipe-to-reply gesture on touch screens:
// drag right past the trigger distance and let go, and the reply starts. A
// mostly-vertical drag is left alone, so scrolling the chat is never affected.
function Bubble({
  m,
  own,
  viewerRole,
  original,
  canReply,
  flash,
  onReply,
  onJump,
  onOpenAttachment,
}: {
  m: Message;
  own: boolean;
  viewerRole: "patient" | "doctor";
  original: Message | null | undefined;
  canReply: boolean;
  flash: boolean;
  onReply: (m: Message) => void;
  onJump: (id: string) => void;
  onOpenAttachment: (path: string) => void;
}) {
  const moverRef = useRef<HTMLDivElement | null>(null);
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const gestureRef = useRef<{ x: number; y: number; mode: "idle" | "swipe" | "scroll"; offset: number; armed: boolean } | null>(null);

  function setOffset(px: number, animate: boolean) {
    const mover = moverRef.current;
    if (!mover) return;
    mover.style.transition = animate ? "transform 180ms ease-out" : "none";
    mover.style.transform = px ? `translateX(${px}px)` : "";
    if (iconRef.current) {
      const p = Math.min(px / SWIPE_TRIGGER_PX, 1);
      iconRef.current.style.opacity = String(Math.max(p, 0));
      iconRef.current.style.transform = `scale(${0.6 + 0.4 * Math.max(p, 0)})`;
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    if (!canReply || e.touches.length !== 1) return;
    const t = e.touches[0];
    gestureRef.current = { x: t.clientX, y: t.clientY, mode: "idle", offset: 0, armed: false };
  }

  function onTouchMove(e: React.TouchEvent) {
    const g = gestureRef.current;
    if (!g || g.mode === "scroll") return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (g.mode === "idle") {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
        g.mode = "scroll";
        return;
      }
      if (dx > 8 && dx > Math.abs(dy) * 1.2) g.mode = "swipe";
      else return;
    }
    const offset = Math.max(0, Math.min(dx * 0.8, SWIPE_MAX_PX));
    g.offset = offset;
    setOffset(offset, false);
    if (offset >= SWIPE_TRIGGER_PX && !g.armed) {
      g.armed = true;
      try {
        navigator.vibrate?.(12);
      } catch {
        /* haptics are optional */
      }
    } else if (offset < SWIPE_TRIGGER_PX) {
      g.armed = false;
    }
  }

  function endGesture(cancelled: boolean) {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g || g.mode !== "swipe") return;
    setOffset(0, true);
    if (!cancelled && g.offset >= SWIPE_TRIGGER_PX) onReply(m);
  }

  const originalLabel = original ? (original.sender_role === viewerRole ? "You" : original.sender_role === "doctor" ? "Doctor" : "Patient") : "";

  return (
    <li
      id={`msg-${m.id}`}
      data-testid="chat-message"
      className={`group flex items-center gap-1.5 ${own ? "justify-end" : "justify-start"}`}
    >
      {own && canReply && (
        <button
          type="button"
          onClick={() => onReply(m)}
          aria-label="Reply to this message"
          className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-teal-700 opacity-0 shadow-sm ring-1 ring-[#d7e7e2] transition hover:bg-teal-50 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:inline-flex"
        >
          <ReplyIcon size={14} />
        </button>
      )}
      <div
        ref={moverRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={() => endGesture(false)}
        onTouchCancel={() => endGesture(true)}
        style={{ touchAction: canReply ? "pan-y" : undefined }}
        className="relative max-w-[80%]"
      >
        {canReply && (
          <span
            ref={iconRef}
            aria-hidden="true"
            style={{ opacity: 0 }}
            className="pointer-events-none absolute -left-10 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-[#e6f1ed] text-teal-700"
          >
            <ReplyIcon size={16} />
          </span>
        )}
        <div
          className={`rounded-lg px-3 py-2 text-sm transition-shadow duration-300 ${
            own ? "bg-teal-700 text-white" : "bg-[#e6f1ed] text-ink-900"
          } ${flash ? "ring-2 ring-amber-400" : ""}`}
        >
          <div className="text-xs font-medium opacity-70">
            {m.sender_role === "doctor" ? "Doctor" : "Patient"} · {new Date(m.created_at).toLocaleString()}
          </div>
          {m.reply_to_id && (
            <button
              type="button"
              onClick={() => original && onJump(original.id)}
              disabled={!original}
              aria-label="Show the message this replies to"
              className={`mt-1 block w-full rounded-md border-l-4 px-2 py-1 text-left text-xs ${
                own ? "border-teal-200 bg-white/15" : "border-teal-600 bg-white/60"
              }`}
            >
              {original ? (
                <>
                  <span className="block font-semibold opacity-90">{originalLabel}</span>
                  <span className="line-clamp-2 block whitespace-pre-wrap opacity-90">{snippetOf(original)}</span>
                </>
              ) : (
                <span className="italic opacity-80">Original message unavailable</span>
              )}
            </button>
          )}
          {m.body && <p className="mt-1 whitespace-pre-wrap">{m.body}</p>}
          {m.attachment_path && isVoiceNote(m) && <VoicePlayer path={m.attachment_path} own={own} />}
          {m.attachment_path && !isVoiceNote(m) && (
            <button
              onClick={() => onOpenAttachment(m.attachment_path!)}
              className={`mt-1 block text-xs underline underline-offset-2 ${own ? "text-teal-100" : "text-teal-700"}`}
            >
              📎 {m.attachment_filename ?? "Attachment"}
            </button>
          )}
        </div>
      </div>
      {!own && canReply && (
        <button
          type="button"
          onClick={() => onReply(m)}
          aria-label="Reply to this message"
          className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-teal-700 opacity-0 shadow-sm ring-1 ring-[#d7e7e2] transition hover:bg-teal-50 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:inline-flex"
        >
          <ReplyIcon size={14} />
        </button>
      )}
    </li>
  );
}

function ReplyIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 6 6v3" />
    </svg>
  );
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
  const listRef = useRef<HTMLUListElement | null>(null);
  const stickToBottomRef = useRef(true);
  const shownCountRef = useRef(0);
  const loadSeqRef = useRef(0);
  const [newBelow, setNewBelow] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyEnabled, setReplyEnabled] = useState(true);
  const [flashId, setFlashId] = useState<string | null>(null);
  const replyColumnRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Family pack consultations (migrations 0088-0091) can send voice notes and
  // show the patient the out-of-hours notice. Anything that goes wrong here
  // (no pack tables yet, no permission) simply means "not a pack": the chat is
  // exactly as before.
  const [isPack, setIsPack] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    Promise.resolve(supabase.from("family_package_claims").select("id").eq("consultation_id", consultationId).limit(1)).then(
      ({ data, error }) => {
        if (!cancelled && !error && Array.isArray(data) && data.length > 0) setIsPack(true);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [consultationId]);

  // Voice recorder
  const [rec, setRec] = useState<"idle" | "recording" | "ready">("idle");
  const [recSeconds, setRecSeconds] = useState(0);
  const [recError, setRecError] = useState<string | null>(null);
  const [recFile, setRecFile] = useState<File | null>(null);
  const [recUrl, setRecUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);

  function stopRecTimer() {
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    recTimerRef.current = null;
  }
  function releaseMic() {
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStreamRef.current = null;
  }
  function discardRecording() {
    stopRecTimer();
    releaseMic();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.onstop = null;
      try {
        recorderRef.current.stop();
      } catch {
        /* already stopped */
      }
    }
    recorderRef.current = null;
    if (recUrl) URL.revokeObjectURL(recUrl);
    setRecUrl(null);
    setRecFile(null);
    setRecSeconds(0);
    setRec("idle");
  }
  useEffect(() => {
    return () => {
      stopRecTimer();
      releaseMic();
    };
  }, []);

  async function startRecording() {
    setRecError(null);
    const fmt = voiceMime();
    if (!fmt || !navigator.mediaDevices?.getUserMedia) {
      setRecError("Voice notes aren't supported on this browser. You can still type a message.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recStreamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: fmt.mime });
      recChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stopRecTimer();
        releaseMic();
        const base = fmt.mime.split(";")[0];
        const blob = new Blob(recChunksRef.current, { type: base });
        if (blob.size === 0) {
          setRec("idle");
          return;
        }
        const f = new File([blob], `voice-note.${fmt.ext}`, { type: base });
        setRecFile(f);
        setRecUrl(URL.createObjectURL(blob));
        setRec("ready");
      };
      recorderRef.current = mr;
      mr.start();
      setRecSeconds(0);
      setRec("recording");
      recTimerRef.current = setInterval(() => {
        setRecSeconds((n) => {
          if (n + 1 >= MAX_VOICE_SECONDS) {
            try {
              mr.stop();
            } catch {
              /* already stopped */
            }
          }
          return n + 1;
        });
      }, 1000);
    } catch {
      releaseMic();
      setRecError("We couldn't use the microphone. Please allow microphone access in your browser, or type a message instead.");
    }
  }
  function stopRecording() {
    try {
      recorderRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }

  // `silent` = a background refresh: a failed check never replaces the
  // conversation with an error, it just tries again later. Returns whether
  // the check succeeded.
  const load = useCallback(
    async (silent = false): Promise<boolean> => {
      if (!supabase) return false;
      const seq = ++loadSeqRef.current;
      try {
        const fetchRows = (cols: string) =>
          supabase!
            .from("consultation_messages")
            .select(cols)
            .eq("consultation_id", consultationId)
            .order("created_at", { ascending: true });
        let { data, error } = await fetchRows(replyColumnRef.current ? `${BASE_COLS}, reply_to_id` : BASE_COLS);
        if (error && replyColumnRef.current && /reply_to_id/i.test(error.message)) {
          // Database not updated with replies yet: carry on without them.
          replyColumnRef.current = false;
          setReplyEnabled(false);
          ({ data, error } = await fetchRows(BASE_COLS));
        }

        // A newer check has started since this one — let it have the last word.
        if (seq !== loadSeqRef.current) return !error;

        if (error) {
          if (!silent) setLoadError(error.message);
          return false;
        }
        const next = data as unknown as Message[];
        setLoadError(null);
        setMessages((prev) =>
          prev &&
          prev.length === next.length &&
          prev[prev.length - 1]?.id === next[next.length - 1]?.id
            ? prev
            : next
        );
        return true;
      } catch {
        if (!silent && seq === loadSeqRef.current) setLoadError("Network problem — please try again.");
        return false;
      }
    },
    [consultationId]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Keep the thread fresh without anyone pressing refresh.
  useEffect(() => {
    if (locked) {
      // Closed conversation: nothing new can arrive. One last look picks up
      // anything sent just before it closed.
      const once = setTimeout(() => load(true), 0);
      return () => clearTimeout(once);
    }
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = POLL_MS;

    const schedule = () => {
      if (!stopped) timer = setTimeout(tick, delay);
    };
    const tick = async () => {
      timer = null;
      if (stopped || running) return;
      if (document.visibilityState !== "visible" || navigator.onLine === false) {
        schedule(); // nothing to fetch right now; look again shortly
        return;
      }
      running = true;
      const ok = await load(true);
      running = false;
      delay = ok ? POLL_MS : Math.min(delay * 2, POLL_MAX_MS);
      schedule();
    };
    const wake = () => {
      if (stopped || running || document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      delay = POLL_MS;
      tick();
    };

    schedule();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
    };
  }, [locked, load]);

  // Stay at the latest message; if the reader has scrolled up to re-read
  // something, leave them there and offer a "new message" button instead.
  useEffect(() => {
    const el = listRef.current;
    if (!el || messages === null) return;
    const before = shownCountRef.current;
    shownCountRef.current = messages.length;
    if (messages.length <= before) return;
    if (before === 0 || stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      setNewBelow(true);
    }
  }, [messages]);

  function onListScroll() {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottomRef.current = near;
    if (near) setNewBelow(false);
  }

  function jumpToLatest() {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    setNewBelow(false);
  }

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

  function startReply(m: Message) {
    setReplyTo(m);
    textareaRef.current?.focus();
  }

  function jumpTo(id: string) {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`#msg-${CSS.escape(id)}`);
    if (!list || !el) return;
    stickToBottomRef.current = false;
    list.scrollTo({ top: Math.max(0, el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2), behavior: "smooth" });
    setFlashId(id);
    setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1400);
  }

  async function sendMessage(voice?: File) {
    if (!supabase) return;
    const toSend = voice ?? file;
    if (!body.trim() && !toSend) return;
    setSending(true);
    setSendError(null);

    let attachment_path: string | null = null;
    let attachment_filename: string | null = null;
    let attachment_content_type: string | null = null;
    let attachment_size_bytes: number | null = null;

    if (toSend) {
      const path = `${consultationId}/${crypto.randomUUID()}-${toSend.name}`;
      const { error: uploadError } = await supabase.storage
        .from("consultation-attachments")
        .upload(path, toSend, { contentType: toSend.type });
      if (uploadError) {
        setSending(false);
        setSendError(`Couldn't upload the file: ${uploadError.message}`);
        return;
      }
      attachment_path = path;
      attachment_filename = toSend.name;
      attachment_content_type = toSend.type;
      attachment_size_bytes = toSend.size;
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
      ...(replyTo && replyColumnRef.current ? { reply_to_id: replyTo.id } : {}),
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
    setReplyTo(null);
    setFile(null);
    if (voice) discardRecording();
    if (fileInputRef.current) fileInputRef.current.value = "";
    stickToBottomRef.current = true;
    load(true);
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
    return <p className="text-sm text-ink-500">Loading…</p>;
  }

  return (
    <div className="space-y-3">
      {messages.length === 0 && (
        <p className="text-sm text-ink-500">No messages yet.</p>
      )}

      <ul ref={listRef} onScroll={onListScroll} className="relative max-h-96 space-y-2 overflow-y-auto">
        {messages.map((m) => (
          <Bubble
            key={m.id}
            m={m}
            own={m.sender_role === viewerRole}
            viewerRole={viewerRole}
            original={m.reply_to_id ? (messages.find((x) => x.id === m.reply_to_id) ?? null) : undefined}
            canReply={!locked && replyEnabled}
            flash={flashId === m.id}
            onReply={startReply}
            onJump={jumpTo}
            onOpenAttachment={viewAttachment}
          />
        ))}
      </ul>

      {newBelow && (
        <div className="flex justify-center">
          <button
            onClick={jumpToLatest}
            className="rounded-full bg-teal-700 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-800"
          >
            New message ↓
          </button>
        </div>
      )}

      {locked ? (
        <p className="rounded-lg border border-[#d7e7e2] bg-[#f1f8f5] p-3 text-xs text-ink-500">
          This conversation is closed — the prescription has been issued, so no further messages can
          be sent.
        </p>
      ) : (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          {sendError && <p className="text-sm text-red-700">{sendError}</p>}
          {fileError && <p className="text-sm text-red-700">{fileError}</p>}
          {replyEnabled && messages.length > 0 && !replyTo && (
            <p className="hidden text-[11px] text-ink-500 [@media(hover:none)]:block">
              Tip: swipe a message to the right to reply to it.
            </p>
          )}
          {replyTo && (
            <div className="flex items-start gap-2 rounded-xl border-l-4 border-teal-600 bg-[#f1f8f5] px-3 py-2 text-xs" data-testid="reply-preview">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-teal-800">
                  Replying to {replyTo.sender_role === viewerRole ? "yourself" : replyTo.sender_role === "doctor" ? "Doctor" : "Patient"}
                </p>
                <p className="line-clamp-2 whitespace-pre-wrap text-ink-700">{snippetOf(replyTo)}</p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                aria-label="Cancel reply"
                className="shrink-0 rounded-full px-2 py-0.5 text-sm font-bold text-ink-500 hover:bg-white"
              >
                ✕
              </button>
            </div>
          )}
          {isPack && viewerRole === "patient" && (
            <p className="rounded-lg bg-[#f1f8f5] p-2.5 text-[11.5px] leading-relaxed text-ink-600">
              You can message any time. The doctor replies during working hours, so a message sent at night is answered the next working day. This is not for emergencies: call 1122 or go to the nearest hospital.
            </p>
          )}
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && replyTo) setReplyTo(null);
            }}
            placeholder="Type a message…"
            rows={2}
            className="w-full rounded-xl border border-[#d7e7e2] px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-between gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
              onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
              className="min-w-0 flex-1 text-xs text-ink-500"
            />
            <button
              onClick={() => sendMessage()}
              disabled={sending || (!body.trim() && !file)}
              className="shrink-0 rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
          {file && !fileError && (
            <p className="text-xs text-ink-500">Attaching: {file.name}</p>
          )}
          {isPack && (
            <div className="rounded-xl border border-[#d7e7e2] bg-[#f8fbfa] p-3" data-testid="voice-recorder">
              {recError && <p className="mb-2 text-xs text-red-700">{recError}</p>}
              {rec === "idle" && (
                <button type="button" onClick={startRecording} disabled={sending} className="inline-flex items-center gap-2 rounded-full border border-teal-600 px-4 py-2 text-xs font-extrabold text-teal-800 hover:bg-teal-50 disabled:opacity-50">
                  <span aria-hidden="true">🎤</span> Record a voice note
                </button>
              )}
              {rec === "recording" && (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 text-xs font-bold text-red-700">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
                    Recording {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, "0")} / 2:00
                  </span>
                  <button type="button" onClick={stopRecording} className="rounded-full bg-teal-700 px-4 py-1.5 text-xs font-extrabold text-white hover:bg-teal-800">
                    Stop
                  </button>
                  <button type="button" onClick={discardRecording} className="text-xs font-semibold text-ink-500 underline underline-offset-2">
                    Cancel
                  </button>
                </div>
              )}
              {rec === "ready" && recFile && recUrl && (
                <div className="flex flex-wrap items-center gap-3">
                  <audio controls src={recUrl} className="h-9 max-w-full" />
                  <button type="button" onClick={() => sendMessage(recFile)} disabled={sending} className="rounded-full bg-teal-700 px-4 py-1.5 text-xs font-extrabold text-white hover:bg-teal-800 disabled:opacity-50">
                    {sending ? "Sending…" : "Send voice note"}
                  </button>
                  <button type="button" onClick={discardRecording} disabled={sending} className="text-xs font-semibold text-ink-500 underline underline-offset-2">
                    Discard
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
