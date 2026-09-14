import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-700 text-xs font-bold text-white">
                +
              </span>
              <span className="text-sm font-semibold text-slate-900">
                Digital Family Clinic
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-slate-500">
              Your family doctor, available digitally. Real physician care
              for every member of your family, real decisions.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Platform
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li><Link href="/how-it-works" className="hover:text-teal-700">How It Works</Link></li>
              <li><Link href="/services" className="hover:text-teal-700">Services</Link></li>
              <li><Link href="/about" className="hover:text-teal-700">About</Link></li>
              <li><Link href="/faq" className="hover:text-teal-700">FAQ</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Legal &amp; Contact
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li><Link href="/privacy" className="hover:text-teal-700">Privacy Policy</Link></li>
              <li><Link href="/terms" className="hover:text-teal-700">Terms of Service</Link></li>
              <li><Link href="/contact" className="hover:text-teal-700">Contact</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-slate-100 pt-6">
          <p className="text-xs leading-relaxed text-slate-400">
            Before your consultation, we ask about your symptoms and health
            history so your doctor can review them. Your doctor reviews
            your information and makes every clinical decision — diagnosis
            and prescriptions are never generated automatically.
          </p>
          <p className="mt-2 text-xs text-slate-400">
            © {new Date().getFullYear()} Digital Family Clinic. Draft
            site — Phase 1, not yet in production.
          </p>
        </div>
      </div>
    </footer>
  );
}
