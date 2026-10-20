"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

// Home-page pop-up (migration 0082). An admin-uploaded flyer that opens over
// the home page a couple of seconds after it loads, with a close (X) button.
//
// Fail-soft and quiet by design:
// - It reads the public view active_site_popups. If the SQL has not been run,
//   nothing is scheduled, or anything errors, nothing at all is shown.
// - It waits for the flyer image to finish loading, so there is never an empty
//   or half-drawn box.
// - Once closed it stays closed on that phone for 24 hours (per flyer, so a
//   NEW flyer shows even if the old one was closed). Browser storage may be
//   unavailable; then it simply shows once per page load.
// - It is mounted only on the home page, so nobody mid-booking, mid-payment or
//   mid-consultation is ever interrupted.
// - Admins can open the home page with ?popup=1 to see it again regardless of
//   the 24-hour memory.

interface PopupRow {
  id: string;
  image_url: string;
  click_url: string | null;
  button_label: string | null;
}

const SHOW_AFTER_MS = 2000;
const HIDE_FOR_MS = 24 * 60 * 60 * 1000;
const KEY = (id: string) => `fm_popup_closed_${id}`;

function recentlyClosed(id: string): boolean {
  try {
    const raw = window.localStorage.getItem(KEY(id));
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < HIDE_FOR_MS;
  } catch {
    return false;
  }
}

function rememberClosed(id: string) {
  try {
    window.localStorage.setItem(KEY(id), String(Date.now()));
  } catch {
    // storage blocked: it will just show again on the next visit
  }
}

export default function HomePopup() {
  const [popup, setPopup] = useState<PopupRow | null>(null);
  const [visible, setVisible] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const { data, error } = await client
          .from("active_site_popups")
          .select("id, image_url, click_url, button_label")
          .order("created_at", { ascending: false })
          .limit(1);
        if (cancelled || error || !Array.isArray(data) || data.length === 0) return;
        const row = data[0] as PopupRow;
        const force = new URLSearchParams(window.location.search).get("popup") === "1";
        if (!force && recentlyClosed(row.id)) return;
        const started = Date.now();
        const img = new window.Image();
        img.onload = () => {
          if (cancelled) return;
          const wait = Math.max(0, SHOW_AFTER_MS - (Date.now() - started));
          timer = setTimeout(() => {
            if (cancelled) return;
            setPopup(row);
            setVisible(true);
          }, wait);
        };
        img.onerror = () => {
          // a broken image link: show nothing rather than a broken box
        };
        img.src = row.image_url;
      } catch {
        // pop-up is optional; never break the home page
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  function close() {
    if (popup) rememberClosed(popup.id);
    setVisible(false);
  }

  // Esc closes, the page behind does not scroll while open, and keyboard
  // focus starts on the close button.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (popup) rememberClosed(popup.id);
        setVisible(false);
      }
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [visible, popup]);

  if (!visible || !popup) return null;

  const link = popup.click_url;
  const internal = !!link && link.startsWith("/");
  const label = popup.button_label || "Register free";
  const buttonClass =
    "block w-full rounded-2xl bg-[#ffb454] px-4 py-3.5 text-center text-base font-extrabold text-[#3a2500] shadow-lg transition hover:bg-[#ffa62e]";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Announcement"
      data-testid="home-popup"
      onClick={close}
    >
      <div className="relative mx-auto w-fit max-w-full" onClick={(e) => e.stopPropagation()}>
        <button
          ref={closeRef}
          type="button"
          onClick={close}
          aria-label="Close"
          data-testid="home-popup-close"
          className="absolute -right-1 -top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white text-xl font-bold leading-none text-ink-900 shadow-lg ring-1 ring-black/10 transition hover:bg-slate-100"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div className="overflow-hidden rounded-3xl bg-white shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={popup.image_url} alt="Announcement" className="block max-h-[68vh] w-auto" style={{ maxWidth: "min(calc(100vw - 2rem), 420px)" }} />
        </div>
        {link && (
          <div className="mt-3">
            {internal ? (
              <Link href={link} onClick={close} className={buttonClass} data-testid="home-popup-cta">
                {label}
              </Link>
            ) : (
              <a href={link} target="_blank" rel="noopener noreferrer" onClick={close} className={buttonClass} data-testid="home-popup-cta">
                {label}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
