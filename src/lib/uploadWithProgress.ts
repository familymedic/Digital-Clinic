// Upload a FormData with a live percentage and stall detection
// (2026-10-08). fetch() can't report upload progress, and a total timeout
// is wrong for slow mobile data: a healthy-but-slow upload gets killed, a
// dead one waits too long. This uses XMLHttpRequest and only gives up when
// NOTHING has moved for `stallMs`, or after `totalMs` overall.

import { reportClientEvent } from "@/lib/telemetry";

export interface UploadResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
  error: string | null;
  stalled?: boolean;
}

export function uploadWithProgress(
  url: string,
  body: FormData,
  headers: Record<string, string>,
  opts: { onProgress?: (pct: number) => void; stallMs?: number; totalMs?: number; sizeBytes?: number } = {}
): Promise<UploadResult> {
  const stallMs = opts.stallMs ?? 45_000;
  const totalMs = opts.totalMs ?? 300_000;
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const started = Date.now();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    // eslint-disable-next-line prefer-const
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (r: UploadResult, report?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      clearTimeout(totalTimer);
      if (report) {
        reportClientEvent({
          kind: report === "timeout" ? "timeout" : "fail",
          label: url.replace(/[0-9a-f-]{36}/gi, ":id"),
          message: `upload ${opts.sizeBytes ? Math.round(opts.sizeBytes / 1024) + "KB " : ""}after ${Math.round((Date.now() - started) / 1000)}s: ${r.error ?? report}`.slice(0, 190),
          durationMs: Date.now() - started,
        });
      }
      resolve(r);
    };
    const armStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        xhr.abort();
        finish(
          { ok: false, status: 0, data: {}, stalled: true, error: "Your connection stopped moving data. Please try again on a stronger signal or Wi-Fi." },
          "timeout"
        );
      }, stallMs);
    };

    xhr.open("POST", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      armStall();
      if (e.lengthComputable) opts.onProgress?.(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* non-JSON error page */
      }
      const ok = xhr.status >= 200 && xhr.status < 300;
      const serverMsg = typeof data.error === "string" ? data.error : null;
      finish(
        {
          ok,
          status: xhr.status,
          data,
          error: ok
            ? null
            : serverMsg ??
              (xhr.status === 413
                ? "That file is too large. Please choose a smaller one (under 4MB)."
                : "The server is busy right now. Please try again in a moment."),
        },
        ok || xhr.status < 500 ? undefined : "fail"
      );
    };
    xhr.onerror = () =>
      finish(
        { ok: false, status: 0, data: {}, error: "The connection dropped while uploading. Please try again." },
        "network error"
      );
    xhr.onabort = () => {
      /* handled by the stall / total timers */
    };
    totalTimer = setTimeout(() => {
      xhr.abort();
      finish({ ok: false, status: 0, data: {}, error: "This is taking too long. Please try again on a stronger signal or Wi-Fi." }, "timeout");
    }, totalMs);
    armStall();
    xhr.send(body);
  });
}
