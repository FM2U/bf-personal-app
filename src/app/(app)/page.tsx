import { redirect } from "next/navigation";

/**
 * The start page is Work on now (/work). Any address parameters (for example a window, ?w=...) travel along, so an
 * old link to "/" still opens its window.
 */
export default async function StartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v !== undefined) qs.set(k, v);
  }
  const q = qs.toString();
  redirect(q ? `/work?${q}` : "/work");
}
