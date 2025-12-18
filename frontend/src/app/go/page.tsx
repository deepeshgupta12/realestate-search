import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  match?: any;
  candidates?: any[] | null;
  debug?: any;
};

// Prefer a server env var; fallback to localhost backend
const API_BASE =
  process.env.API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://127.0.0.1:8000";

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
  return u.pathname + (u.search ? u.search : "");
}

/** V0 mapping (seed cities). Later this should move to config/DB. */
const CITY_SLUG_TO_ID: Record<string, string> = {
  pune: "city_pune",
  noida: "city_noida",
};

function inferCityIdFromContextUrl(contextUrl: string): string | null {
  if (!contextUrl) return null;

  let path = contextUrl.trim();

  // allow clean urls OR full urls
  try {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      const u = new URL(path);
      path = u.pathname || "/";
    }
  } catch {
    // ignore
  }

  const seg = path.split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (seg.length === 0) return null;

  let citySlug: string | null = null;

  // /property-rates/<city>/...
  if (seg[0] === "property-rates" && seg[1]) citySlug = seg[1];
  // /projects/<city>/...
  else if (seg[0] === "projects" && seg[1]) citySlug = seg[1];
  // /<city>/...
  else if (!["search", "disambiguate", "go", "builders"].includes(seg[0])) citySlug = seg[0];

  if (!citySlug) return null;
  return CITY_SLUG_TO_ID[citySlug.toLowerCase()] || null;
}

async function postJson(path: string, payload: any): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[go] POST ${path} failed: ${res.status} ${res.statusText}`, txt.slice(0, 300));
    }
  } catch (e: any) {
    console.error(`[go] POST ${path} exception`, e?.message || e);
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
  } catch (e: any) {
    console.error("[go] resolve exception", e?.message || e);
    return null;
  }
}

export default async function GoPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const q = sp1(sp?.q);
  const directUrl = sp1(sp?.url);

  const context_url = sp1(sp?.context_url) || "/";
  const city_id_param = sp1(sp?.city_id) || "";

  const inferredCityId = city_id_param || inferCityIdFromContextUrl(context_url) || "";
  const city_id = inferredCityId;

  const qid = sp1(sp?.qid) || (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const entity_id = sp1(sp?.entity_id) || "";
  const entity_type = sp1(sp?.entity_type) || "";
  const rankRaw = sp1(sp?.rank) || "";
  const rank = rankRaw ? Number(rankRaw) : null;

  // 1) Direct URL redirects (SERP/disambiguate clicks) -> click event
  if (directUrl) {
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

  // 2) Query resolves -> search event + resolve
  if (!q) redirect("/");

  // Log search BEFORE resolve so recents populate naturally
  await postJson("/api/v1/events/search", {
    query_id: qid,
    raw_query: q,
    normalized_query: q,
    city_id: city_id || null,
    context_url: context_url || null,
    timestamp: new Date().toISOString(),
  });

  const rr = await getResolve({
    q,
    city_id: city_id || undefined,
    context_url: context_url || undefined,
    qid,
  });

  if (!rr || !rr.url) {
    redirect(
      withParams("/search", {
        q,
        city_id: city_id || undefined,
        qid,
        context_url,
      })
    );
  }

  if (rr.action === "serp") {
    redirect(
      withParams(rr.url, {
        qid,
        context_url,
        city_id: city_id || undefined,
      })
    );
  }

  if (rr.action === "disambiguate") {
    redirect(
      withParams("/disambiguate", {
        q,
        qid,
        context_url,
        city_id: city_id || undefined,
      })
    );
  }

  redirect(
    withParams(rr.url, {
      qid,
      context_url,
      city_id: city_id || undefined,
    })
  );
}