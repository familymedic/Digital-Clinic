"use client";

import { DAY_KEYS, DAY_LABEL, cleanHours, type DayKey, type OpenHours, type TimeRange } from "@/lib/locator";

// Opening hours editor (Locator). "Not set", "Open 24 hours", or times per day with an optional
// second shift (for a lunch break). Quick buttons copy one day's times to Mon to Sat or to all
// seven days. The parent holds the value; it is cleaned before it is saved.

const timeCls = "rounded-xl border border-[#cfe0da] bg-white px-2.5 py-2 text-sm text-ink-900 outline-none focus:border-teal-600";

type Mode = "none" | "always" | "times";

export default function HoursEditor({
  value,
  onChange,
  idPrefix = "hours",
}: {
  value: OpenHours | null;
  onChange: (v: OpenHours | null) => void;
  idPrefix?: string;
}) {
  const mode: Mode = !value ? "none" : value.always ? "always" : "times";
  const days = value?.days ?? {};

  function setMode(m: Mode) {
    if (m === "none") onChange(null);
    else if (m === "always") onChange({ always: true });
    else onChange({ days: value?.days && Object.keys(value.days).length ? value.days : { mon: [["09:00", "17:00"]] } });
  }

  function setDay(d: DayKey, ranges: TimeRange[]) {
    const next = { ...days };
    if (ranges.length) next[d] = ranges;
    else delete next[d];
    onChange({ days: next });
  }

  function copyFrom(src: DayKey, targets: DayKey[]) {
    const r = days[src];
    if (!r?.length) return;
    const next = { ...days };
    for (const t of targets) next[t] = r.map((x) => [x[0], x[1]] as TimeRange);
    onChange({ days: next });
  }

  const firstOpen = DAY_KEYS.find((d) => (days[d] ?? []).length > 0);

  return (
    <div data-testid={`${idPrefix}-editor`}>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Opening hours">
        {(
          [
            ["none", "Not set"],
            ["always", "Open 24 hours"],
            ["times", "Set the times"],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            data-testid={`${idPrefix}-mode-${m}`}
            className={`min-h-10 rounded-full border px-4 text-sm font-bold ${mode === m ? "border-teal-700 bg-teal-700 text-white" : "border-[#cfe0da] bg-white text-ink-900"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "times" && (
        <div className="mt-3 space-y-2">
          {firstOpen && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-700">
              <span className="font-semibold">Copy {DAY_LABEL[firstOpen]}&apos;s times to:</span>
              <button type="button" data-testid={`${idPrefix}-copy-mon-sat`} onClick={() => copyFrom(firstOpen, ["mon", "tue", "wed", "thu", "fri", "sat"])} className="rounded-full border border-[#cfe0da] bg-white px-3 py-1.5 font-bold text-teal-800">
                Mon to Sat
              </button>
              <button type="button" data-testid={`${idPrefix}-copy-all`} onClick={() => copyFrom(firstOpen, DAY_KEYS)} className="rounded-full border border-[#cfe0da] bg-white px-3 py-1.5 font-bold text-teal-800">
                All 7 days
              </button>
            </div>
          )}
          {DAY_KEYS.map((d) => {
            const ranges = days[d] ?? [];
            const open = ranges.length > 0;
            return (
              <div key={d} className="flex flex-wrap items-center gap-2 rounded-2xl bg-[#f3f9f7] px-3 py-2.5" data-testid={`${idPrefix}-day-${d}`}>
                <label className="flex w-28 items-center gap-2 text-sm font-bold text-ink-900">
                  <input
                    type="checkbox"
                    checked={open}
                    onChange={(e) => setDay(d, e.target.checked ? [["09:00", "17:00"]] : [])}
                    data-testid={`${idPrefix}-open-${d}`}
                    className="h-4 w-4 accent-teal-700"
                  />
                  {DAY_LABEL[d]}
                </label>
                {!open && <span className="text-sm text-ink-500">Closed</span>}
                {ranges.map((r, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <input
                      type="time"
                      value={r[0]}
                      onChange={(e) => setDay(d, ranges.map((x, j) => (j === i ? [e.target.value, x[1]] : x)) as TimeRange[])}
                      className={timeCls}
                      aria-label={`${DAY_LABEL[d]} opens`}
                      data-testid={`${idPrefix}-from-${d}-${i}`}
                    />
                    <span className="text-xs text-ink-500">to</span>
                    <input
                      type="time"
                      value={r[1]}
                      onChange={(e) => setDay(d, ranges.map((x, j) => (j === i ? [x[0], e.target.value] : x)) as TimeRange[])}
                      className={timeCls}
                      aria-label={`${DAY_LABEL[d]} closes`}
                      data-testid={`${idPrefix}-to-${d}-${i}`}
                    />
                    {i === 1 && (
                      <button type="button" onClick={() => setDay(d, ranges.slice(0, 1))} className="text-xs font-bold text-red-700 underline">
                        remove
                      </button>
                    )}
                  </span>
                ))}
                {open && ranges.length === 1 && (
                  <button type="button" onClick={() => setDay(d, [...ranges, ["17:00", "21:00"]])} className="text-xs font-bold text-teal-800 underline" data-testid={`${idPrefix}-add-${d}`}>
                    + second shift
                  </button>
                )}
              </div>
            );
          })}
          <p className="text-xs text-ink-500">A closing time earlier than the opening time means it closes after midnight.</p>
        </div>
      )}
    </div>
  );
}

// Ready-to-save form of the editor's value.
export function hoursForSave(v: OpenHours | null): OpenHours | null {
  return cleanHours(v);
}
