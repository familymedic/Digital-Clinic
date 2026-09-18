import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-[var(--color-ink-border)] bg-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-brand-950 text-white">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 21s-7.5-4.6-10-9.5C.3 7.7 2.2 4 6 4c2.1 0 3.6 1.1 4.5 2.4L12 8l1.5-1.6C14.4 5.1 15.9 4 18 4c3.8 0 5.7 3.7 4 7.5-2.5 4.9-10 9.5-10 9.5z" />
                </svg>
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-extrabold tracking-tight text-ink-900">
                  Family Medic
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                  Digital Family Clinic
                </span>
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-500">
              Your family doctor, available digitally. Real physician care
              for every member of your family, real decisions.
            </p>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink-400">
              Platform
            </p>
            <ul className="mt-3 space-y-2 text-sm text-ink-700">
              <li><Link href="/how-it-works" className="hover:text-teal-700">How It Works</Link></li>
              <li><Link href="/services" className="hover:text-teal-700">Services</Link></li>
              <li><Link href="/about" className="hover:text-teal-700">About</Link></li>
              <li><Link href="/faq" className="hover:text-teal-700">FAQ</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink-400">
              Legal &amp; Contact
            </p>
            <ul className="mt-3 space-y-2 text-sm text-ink-700">
              <li><Link href="/privacy" className="hover:text-teal-700">Privacy Policy</Link></li>
              <li><Link href="/terms" className="hover:text-teal-700">Terms of Service</Link></li>
              <li><Link href="/contact" className="hover:text-teal-700">Contact</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-[var(--color-ink-border)] pt-6">
          <p className="text-xs leading-relaxed text-ink-400">
            Before your consultation, we ask about your symptoms and health
            history so your doctor can review them. Your doctor reviews
            your information and makes every clinical decision — diagnosis
            and prescriptions are never generated automatically.
          </p>
          <p className="mt-2 text-xs text-ink-400">
            © {new Date().getFullYear()} Family Medic.
          </p>
          <p className="mt-2 text-xs text-ink-400">
            <Link href="/admin/login" className="hover:text-teal-700">
              Admin Login
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
