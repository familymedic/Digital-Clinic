import Link from "next/link";

const links = [
  { href: "/how-it-works", label: "How It Works" },
  { href: "/services", label: "Services" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export default function NavBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-700 text-sm font-bold text-white">
            +
          </span>
          <span className="text-[15px] font-semibold text-slate-900">
            Family Medicine Consult
          </span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-slate-600 transition hover:text-teal-700"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:text-teal-700 sm:inline-block"
          >
            Log in
          </Link>
          <Link
            href="/book"
            className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
          >
            Book Consultation
          </Link>
        </div>
      </div>

      {/* mobile nav */}
      <nav className="flex gap-4 overflow-x-auto border-t border-slate-100 px-4 py-2 md:hidden">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="whitespace-nowrap text-xs font-medium text-slate-600"
          >
            {l.label}
          </Link>
        ))}
        <Link href="/login" className="whitespace-nowrap text-xs font-medium text-slate-600">
          Log in
        </Link>
      </nav>
    </header>
  );
}
