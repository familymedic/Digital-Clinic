export default function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="border-b border-slate-100 bg-white">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h1>
        {subtitle && (
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
