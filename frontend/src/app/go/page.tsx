import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams: Promise<SearchParams>;
};

type ResolveResponse = {
  action: "redirect" | "serp" | "disambiguate";
  query: string;
  normalized_query: string;
  url: string | null;
  reason: string;
  // optional fields (safe if backend includes them)
  match?: any;
  candidates?: any[] | null;
  debug?: any;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

function sp1(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return (v[0] || "").trim();
  return (v || "").trim();
}

function withParams(baseUrl: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(baseUrl, "http://local");
  for (const [k, val] of Object.entries(params)) {
    if (val === undefined || val === null || String(val).trim() === "") continue;
    if (!u.searchParams.has(k)) u.searchParams.set(k, String(val));
  }
  const out = u.pathname + (u.search ? u.search : "");
  return out;
}

async function postJson(path: string, payload: any): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    // Don’t block navigation if logging fails
    if (!res.ok) {
      // swallow
    }
  } catch {
    // swallow
  }
}

async function getResolve(params: Record<string, string | undefined>): Promise<ResolveResponse | null> {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && v.trim()) usp.set(k, v);
  }

  const url = `${API_BASE}/api/v1/search/resolve?${usp.toString()}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as ResolveResponse;
  } catch {
    return null;
  }
}

export default async function GoPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const q = sp1(sp?.q);
  const directUrl = sp1(sp?.url);

  const city_id = sp1(sp?.city_id) || "";
  const context_url = sp1(sp?.context_url) || "/";

  // click logging inputs (optional)
  const qid = sp1(sp?.qid) || (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const entity_id = sp1(sp?.entity_id) || "";
  const entity_type = sp1(sp?.entity_type) || "";
  const rankRaw = sp1(sp?.rank) || "";
  const rank = rankRaw ? Number(rankRaw) : null;

  // Case 1: Direct URL redirect (used by SERP/disambiguate cards)
  if (directUrl) {
    // log click if we have enough info
    if (entity_id && entity_type && rank !== null) {
      await postJson("/api/v1/events/click", {
        query_id: qid,
        entity_id,
        entity_type,
        rank,
        url: directUrl,
        city_id: city_id || null,
        context_url: context_url || null,
        timestamp: new Date().toISOString(),
      });
    }

    redirect(directUrl);
  }

  // Case 2: resolve query -> redirect to entity / serp / disambiguate
  if (!q) redirect("/");

  const rr = await getResolve({
    q,
    city_id: city_id || undefined,
    context_url: context_url || undefined,
    qid, // backend may ignore; safe
  });

  // If backend fails, fallback to SERP
  if (!rr || !rr.url) {
    const fallback = withParams("/search", {
      q,
      city_id: city_id || undefined,
      qid,
      context_url,
    });
    redirect(fallback);
  }

  // Ensure qid + context_url survive the redirect (important for click logging later)
  if (rr.action === "serp") {
    const serpUrl = withParams(rr.url, {
      qid,
      context_url,
      city_id: city_id || undefined,
    });
    redirect(serpUrl);
  }

  if (rr.action === "disambiguate") {
    const disUrl = withParams("/disambiguate", {
      q,
      qid,
      context_url,
      city_id: city_id || undefined,
    });
    redirect(disUrl);
  }

  // redirect action
  const redUrl = withParams(rr.url, {
    qid,
    context_url,
    city_id: city_id || undefined,
  });
  redirect(redUrl);
}