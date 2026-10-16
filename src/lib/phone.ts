// One canonical form for mobile numbers, so "0300 1234567", "+92 300 1234567"
// and "923001234567" are all the same person when looking an appointment up.
//
// Stored form ("norm") is digits only, with the country code: Pakistani
// numbers become 92XXXXXXXXXX (12 digits). Other countries are kept as the
// digits typed (10-15 digits).

export interface NormalizedPhone {
  norm: string;
  display: string;
}

export function normalizePhone(raw: unknown): NormalizedPhone | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const hadPlus = text.startsWith("+");
  let d = text.replace(/\D/g, "");
  if (d.startsWith("00")) {
    d = d.slice(2); // 0092...
  } else if (!hadPlus && d.startsWith("0") && d.length === 11) {
    d = "92" + d.slice(1); // 03001234567
  } else if (!hadPlus && d.length === 10 && d.startsWith("3")) {
    d = "92" + d; // 3001234567
  }
  if (d.length < 10 || d.length > 15) return null;
  if (d.startsWith("92") && d.length !== 12) return null;
  return { norm: d, display: formatPhone(d) };
}

// "923001234567" -> "0300 1234567"; anything else -> "+<digits>".
export function formatPhone(norm: string): string {
  if (norm.startsWith("92") && norm.length === 12) {
    return `0${norm.slice(2, 5)} ${norm.slice(5)}`;
  }
  return `+${norm}`;
}
