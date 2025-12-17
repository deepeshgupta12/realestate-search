import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;
type PageProps = { searchParams: Promise<SearchParams> };

function sp1(v: string | string[] | undefined): string | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function apiBase(): string {
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    "http://127.0.0.1:8000"
  );
}

async function postClickEvent(args: {
  query_id: string;
  entity_id: string;
  entity_type: string;
  rank: number;
  url: string;
  city_id?: string | null;
  context_url?: string | null;
}) {
  try {
    await fetch(`${apiBase()}/api/v1/events/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query_id: args.query_id,
        entity_id: args.entity_id,
        entity_type: args.entity_type,
        rank: args.rank,
        url: args.url,
        city_id: args.city_id ?? null,
        context_url: args.context_url ?? null,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // best-effort logging; never block navigation
  }
}

export default async function GoPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const q = sp1(sp.q);
  const city_id = sp1(sp.city_id);
  const context_url = sp1(sp.context_url) || "/";
  const qid = sp1(sp.qid);

  // Optional: entity metadata from UI click (for logging)
  const eid = sp1(sp.eid);
  const etype = sp1(sp.etype);
  const rankStr = sp1(sp.rank);
  const rank = rankStr ? Math.max(1, Number(rankStr) || 1) : 1;

  // Support legacy direct URL navigation if ever used
  const directUrl = sp1(sp.url);

  // If no query but url exists, just go there (and optionally log click)
  if (!q && directUrl) {
    if (qid && eid && etype) {
      await postClickEvent({
        query_id: qid,
        entity_id: eid,
        entity_type: etype,
        rank,
        url: directUrl,
        city_id,
        context_url,
      });
    }
    redirect(directUrl);
  }

  const rawQ = q || "";
  const params = new URLSearchParams();
  params.set("q", rawQ);
  if (city_id) params.set("city_id", city_id);
  if (context_url) params.set("context_url", context_url);

  // Call backend resolve
  let resolved: any = null;
  try {
    const res = await fetch(`${apiBase()}/api/v1/search/resolve?${params.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      redirect(`/search?q=${encodeURIComponent(rawQ)}`);
    }
    resolved = await res.json();
  } catch {
    redirect(`/search?q=${encodeURIComponent(rawQ)}`);
  }

  const action = resolved?.action as string | undefined;
  const url = resolved?.url as string | null | undefined;

  if (action === "redirect" && url) {
    // log click (if UI supplied entity metadata)
    if (qid && eid && etype) {
      await postClickEvent({
        query_id: qid,
        entity_id: eid,
        entity_type: etype,
        rank,
        url,
        city_id,
        context_url,
      });
    }
    redirect(url);
  }

  if (action === "disambiguate") {
    const d = new URLSearchParams();
    d.set("q", rawQ);
    if (qid) d.set("qid", qid);
    if (context_url) d.set("context_url", context_url);
    // (city_id intentionally not forced here; user will pick)
    redirect(`/disambiguate?${d.toString()}`);
  }

  // Default: SERP
  if (url) redirect(url);
  redirect(`/search?q=${encodeURIComponent(rawQ)}`);
}