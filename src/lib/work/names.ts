/**
 * Listing names and company names (Edit batch A, approved 2026-10-31), pure and tested in src/lib/work/names.test.ts.
 * A listing gets a placeholder name built from its description: "00 " plus a plain description of the business
 * ("00 Industrial Filtration Distributor"), never ending in "Co" or "Company". Once the company is named (after the
 * NDA, usually) the company name shows everywhere and the listing name stays on the deal page as "Listed as".
 * The "00 " start keeps every unnamed listing together when a list is sorted by name.
 */

const PLACEHOLDER_PREFIX = "00 ";

const TRAILING_COMPANY_WORDS = /[\s,]+(co\.?|company|inc\.?|llc|l\.l\.c\.|corp\.?|corporation|ltd\.?|limited)$/i;

/** True for a placeholder name ("00 Industrial Filtration Distributor"). */
export function isPlaceholderName(name: string | null | undefined): boolean {
  return /^00\s/.test(String(name ?? "").trim());
}

/**
 * "00 Industrial Filtration Distributor" from "industrial filtration distributor co": one space between words, each word
 * capitalized (short joining words stay lower case after the first), no "Co" or "Company" at the end, no second "00 ".
 * An empty description gives "".
 */
export function buildListingName(description: string | null | undefined): string {
  let d = String(description ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^00\s+/, "")
    .replace(/[.\s]+$/, "");
  for (let i = 0; i < 3; i++) d = d.replace(TRAILING_COMPANY_WORDS, "").trim();
  if (!d || /^(co\.?|company|inc\.?|llc|corp\.?|corporation|ltd\.?|limited)$/i.test(d)) return "";
  const small = new Set(["and", "or", "of", "for", "the", "a", "an", "in", "to", "with", "on", "at", "by"]);
  const words = d.split(" ").map((w, i) => {
    if (/^[A-Z0-9&$%.,-]+$/.test(w) && w.length <= 5) return w; // "HVAC", "B2B", "CNC", "$4M"
    const lower = w.toLowerCase();
    if (i > 0 && small.has(lower.replace(/,$/, ""))) return lower;
    return w.charAt(0).toUpperCase() + w.slice(1);
  });
  return `${PLACEHOLDER_PREFIX}${words.join(" ")}`.slice(0, 200);
}

/** What every screen shows: the company name when it is set, otherwise the listing name. */
export function displayName(i: { name: string | null | undefined; companyName?: string | null }): string {
  const company = String(i.companyName ?? "").trim();
  return company || String(i.name ?? "").trim();
}

/** "Listed as 00 Industrial Filtration Distributor" under a deal's title: only when the company name is set and differs. */
export function listedAs(i: { name: string | null | undefined; companyName?: string | null }): string | null {
  const company = String(i.companyName ?? "").trim();
  const listing = String(i.name ?? "").trim();
  return company && listing && company.toLowerCase() !== listing.toLowerCase() ? listing : null;
}

/** Sort by the shown name; placeholder names ("00 ...") stay together at the top. */
export function compareNames(a: string, b: string): number {
  const pa = isPlaceholderName(a);
  const pb = isPlaceholderName(b);
  if (pa !== pb) return pa ? -1 : 1;
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

// ---------- The sign-off name (fix list item 10, approved by Bram 2026-11-06) ----------

/**
 * The name under "Thanks," in the app's emails: the first word of the Name in Settings (owner_profile.display_name),
 * so "Bram Frankel" signs "Bram". Null when no Name is set; the email then ends with "Thanks," alone.
 */
export function signOffName(displayName: unknown): string | null {
  const first = String(displayName ?? "").trim().split(/\s+/)[0] ?? "";
  return first ? first.slice(0, 60) : null;
}

/** "Thanks,\nBram", or "Thanks," with no Name set. */
export function signOff(word: string, name: string | null | undefined): string {
  return name ? `${word},\n${name}` : `${word},`;
}

/**
 * An AI-drafted email ends with "Thanks," or "Best," and no name (the prompts never name the user); the app adds the
 * Name from Settings on the next line. A body that ends any other way is left as it is.
 */
export function addSignOffName(body: string, name: string | null | undefined): string {
  const t = String(body ?? "").replace(/\s+$/, "");
  if (!name) return t;
  return /(?:^|\n)[ \t]*(?:Thanks|Best|Thank you|Best regards|Regards),[ \t]*$/i.test(t) ? `${t}\n${name}` : t;
}
