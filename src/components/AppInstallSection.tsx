"use client";

import { useEffect, useState } from "react";

// "Family Medic in your pocket" — the homepage's free-app section
// (physician, 2026-10: "the app download section wasn't shown anywhere").
//
// The "app" is the installable web app (PWA, 2026-09-30): there is no
// Play Store / App Store listing, so this section deliberately shows no
// store badges. It uses the same two browser facts InstallAppBanner
// already handles:
// - Chrome/Edge/Android fire `beforeinstallprompt` -> a working
//   "Install the app" button that opens the native install dialog.
// - iPhone Safari never offers a programmatic prompt -> plain steps
//   (Share -> Add to Home Screen).
// When no native prompt is available (e.g. desktop Firefox, or the
// browser already declined this session) the button simply reveals the
// manual steps instead of doing nothing. The section hides itself once
// the site is running as an installed app.

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function AppInstallSection() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showSteps, setShowSteps] = useState<"android" | "iphone" | null>(null);

  useEffect(() => {
    const standaloneDisplay = window.matchMedia("(display-mode: standalone)").matches;
    const iosStandaloneFlag = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(standaloneDisplay || iosStandaloneFlag);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (isStandalone) return null;

  const installClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
    } else {
      setShowSteps("android");
    }
  };

  const perks = [
    {
      t: "Join your call in one tap",
      d: (
        <>
          <rect x="3" y="6" width="13" height="12" rx="2" />
          <path d="M16 10l5-3v10l-5-3z" />
        </>
      ),
    },
    {
      t: "Opens from your home screen like any app",
      d: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
    },
    {
      t: "Free, and nothing to download from a store",
      d: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
    },
  ];

  return (
    <section id="app" className="mx-auto max-w-6xl scroll-mt-32 px-4 py-10 sm:px-6">
      <div className="overflow-hidden rounded-[32px] bg-gradient-to-br from-white via-white to-[#e6f7f3] p-7 shadow-[0_10px_30px_rgba(10,55,51,0.07)] sm:p-12">
        <div className="grid items-center gap-10 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-teal-700">Free app</span>
            <h2 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight text-ink-900 sm:text-[40px]">
              Family Medic in your pocket.
            </h2>
            <p className="mt-3 max-w-lg text-base leading-relaxed text-ink-700">
              Install it in seconds, straight from this website. No app store, no storage worries.
            </p>
            <ul className="mt-5 space-y-2.5 text-[15px] text-ink-700">
              {perks.map((p) => (
                <li key={p.t} className="flex items-center gap-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0f766e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {p.d}
                  </svg>
                  {p.t}
                </li>
              ))}
            </ul>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={installClick}
                className="flex flex-1 items-center gap-3 rounded-2xl bg-[#0a3733] px-5 py-3.5 text-left text-white transition hover:bg-[#0f4a44]"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffb454" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
                </svg>
                <span>
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-teal-200">Android &amp; computer</span>
                  <span className="block text-base font-extrabold">Install the app</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setShowSteps("iphone")}
                className="flex flex-1 items-center gap-3 rounded-2xl border-2 border-[#0a3733] bg-white px-5 py-3 text-left text-[#0a3733] transition hover:bg-teal-50"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="7" y="2" width="10" height="20" rx="2.5" />
                  <path d="M11 18h2" />
                </svg>
                <span>
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-ink-500">iPhone</span>
                  <span className="block text-base font-extrabold">Add to Home Screen</span>
                </span>
              </button>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-500" aria-live="polite">
              {showSteps === "android" &&
                "In Chrome, open the menu (⋮) and tap “Install app” or “Add to Home screen”. On a computer, use the install icon in the address bar."}
              {showSteps === "iphone" &&
                "On iPhone: open this site in Safari, tap the Share icon, then “Add to Home Screen”."}
              {showSteps === null && "iPhone: open in Safari, tap Share, then “Add to Home Screen”. Free, no app store needed."}
            </p>
          </div>

          {/* Phone preview (illustration) */}
          <div className="mx-auto w-[250px]">
            <div className="rounded-[38px] bg-[#0e1e1c] p-2.5 shadow-[0_30px_60px_rgba(0,0,0,0.35)]">
              <div className="rounded-[30px] bg-[#eaf7f2] p-4 text-ink-900">
                <div className="text-[11px] font-bold text-ink-700">Good evening</div>
                <div className="text-[17px] font-extrabold">Your next step</div>
                <div className="mt-3 rounded-[20px] bg-[#0a3733] p-3.5 text-white">
                  <span className="inline-block rounded-full bg-emerald-600 px-2 py-1 text-[9.5px] font-extrabold">CONFIRMED</span>
                  <div className="mt-2.5 text-[11px] font-semibold text-teal-200">Video consultation</div>
                  <div className="text-[17px] font-extrabold">Today, 6:30 PM</div>
                  <div className="mt-2.5 flex items-center justify-between rounded-xl bg-white/10 px-3 py-2 text-[11px]">
                    <span className="text-teal-50/80">Starts in</span>
                    <b className="text-sm">00:12:00</b>
                  </div>
                  <div className="mt-2 rounded-xl bg-[#ffb454] py-2.5 text-center text-[13px] font-extrabold text-[#3b2500]">Join call</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
