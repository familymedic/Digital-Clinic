"use client";

import { useEffect, useState } from "react";

// The browser's own "install" event — not in TypeScript's built-in DOM
// types yet, so it's declared here. Chrome/Edge/Android fire this when
// the site meets the installability bar (manifest + service worker,
// both added 2026-09-30); we intercept it so we can show our own
// branded button instead of relying on a patient noticing the small
// icon in the address bar.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "fm_install_banner_dismissed";

// A visible, on-page "Install app" banner (2026-09-30, physician:
// "its showing install on the web address bar cant we put this on
// main page as option to install app?") — most patients will never
// notice the small install icon Chrome puts in the address bar on its
// own, so this surfaces the same action as a real button on the
// homepage instead.
//
// Two real platform differences handled here:
// - Android/Chrome/Edge fire `beforeinstallprompt`, which lets us show
//   a working "Install App" button that triggers the native install
//   dialog directly.
// - iOS Safari never fires that event at all (a real, permanent iOS
//   limitation — Apple does not offer a programmatic install prompt),
//   so there is nothing to "click install" on. For iPhone visitors we
//   instead show the manual steps (Share -> Add to Home Screen).
//
// Hides itself entirely once the app is already installed (running in
// standalone display mode), and remembers a "Not now" dismissal per
// browser via localStorage so it doesn't nag every visit.
export default function InstallAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    const standaloneDisplay = window.matchMedia("(display-mode: standalone)").matches;
    const iosStandaloneFlag =
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(standaloneDisplay || iosStandaloneFlag);

    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      // Private browsing or storage blocked — just don't persist the
      // dismissal; the banner can show again next visit, which is a
      // fine fallback, not an error.
    }

    const ua = window.navigator.userAgent;
    setIsIOS(/iPhone|iPad|iPod/.test(ua));

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Nothing to do if storage isn't available — dismissal just
      // won't be remembered for next visit.
    }
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  // Nothing to show: not mounted yet (avoids a server/client mismatch
  // flash), already installed, dismissed, or on a browser that offers
  // neither the native prompt nor is iOS (e.g. desktop Firefox, which
  // doesn't support installable PWAs at all — showing instructions
  // there would just be confusing).
  if (!mounted || isStandalone || dismissed) return null;
  if (!deferredPrompt && !isIOS) return null;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="mt-6 flex flex-col items-start gap-3 rounded-2xl border border-teal-100 bg-teal-50 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 sm:items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-teal-700 shadow-sm">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <path d="M7 10l5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-bold text-ink-900">Install Family Medic on your phone</p>
            <p className="mt-0.5 text-xs text-ink-600">
              {isIOS && !deferredPrompt ? (
                <>Tap the Share icon below, then &ldquo;Add to Home Screen&rdquo; — one-tap access, no app store needed.</>
              ) : (
                "Add it to your home screen for one-tap access — no app store, no cost."
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-stretch sm:self-auto">
          {deferredPrompt && (
            <button
              type="button"
              onClick={handleInstallClick}
              className="rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-teal-800"
            >
              Install App
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="rounded-full border border-ink-border bg-white px-3 py-2 text-xs font-semibold text-ink-600 transition hover:border-teal-700 hover:text-teal-700"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
