import { redirect } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";

export const dynamic = "force-dynamic";

type ResolveResponse = {
  action: "redirect" | "serp" | "disambiguate";
  query: string;
  normalized_query: string;
  url: string | null;
  match?: any | null;
  candidates?: any[] | null;
  reason?: string | null;
};

function sp1(v: string | string[] | undefined | null): string {
  if (!v) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

function ensureLeadingSlash(u: string): string {
  if (!u) return "/";
  return u.startsWith("/") ? u : `/${u}`;
}

function appendParam(baseUrl: string, key: string, value: string): string {
  if (!value) return baseUrl;
  const hasQ = baseUrl.includes("?");
  const sep = hasQ ? "&" : "?";
  return `${baseUrl}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function uuid(): string {
  // Node 18+ supports crypto.randomUUID()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `qid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

type PageProps = {
  // Next 15 can pass searchParams as Promise (sync-dynamic-apis)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  searchParams: any;
};

export default async function GoPage({ searchParams }: PageProps) {
  const sp = await Promise.resolve(searchParams);

  const q = sp1(sp.q);
  const url = sp1(sp.url);

  const from_q = sp1(sp.from_q);
  const entity_id = sp1(sp.entity_id);
  const entity_type = sp1(sp.entity_type);
  const rankStr = sp1(sp.rank);

  const city_id = sp1(sp.city_id) || null;
  const context_url = sp1(sp.context_url) || "/";

  // --- CLICK MODE: /go?url=/pune/baner&entity_id=...&entity_type=...&rank=1 ---
  if (url) {
    // Optional click logging (only if we have enough metadata)
    if (entity_id && entity_type) {
      const qid = sp1(sp.qid) || uuid();
      const rank = rankStr ? Number(rankStr) : 1;

      await apiPost("/events/click", {
        query_id: qid,
        entity_id,
        entity_type,
        rank: Number.isFinite(rank) ? rank : 1,
        url: ensureLeadingSlash(url),
        city_id,
        context_url,
        timestamp: new Date().toISOString(),
      });
    }

    redirect(ensureLeadingSlash(url));
  }

  // --- SEARCH MODE: /go?q=baner ---
  if (!q) {
    redirect("/");
  }

  const qid = uuid();

  const resolvePath =
    `/search/resolve?q=${encodeURIComponent(q)}` +
    (city_id ? `&city_id=${encodeURIComponent(city_id)}` : "") +
    `&context_url=${encodeURIComponent(context_url)}`;

  const res = await apiGet<ResolveResponse>(resolvePath);

  // log search (always)
  await apiPost("/events/search", {
    query_id: qid,
    raw_query: q,
    normalized_query: res?.normalized_query || q.trim().toLowerCase(),
    city_id,
    context_url,
    timestamp: new Date().toISOString(),
  });

  // Redirect decisions
  if (res.action === "redirect" && res.url) {
    redirect(ensureLeadingSlash(res.url));
  }

  if (res.action === "disambiguate") {
    let target = `/disambiguate?q=${encodeURIComponent(q)}&qid=${encodeURIComponent(qid)}`;
    if (city_id) target = appendParam(target, "city_id", city_id);
    target = appendParam(target, "context_url", context_url);
    redirect(target);
  }

  // SERP fallback
  let serp = res.url ? ensureLeadingSlash(res.url) : `/search?q=${encodeURIComponent(q)}`;
  serp = appendParam(serp, "qid", qid);
  if (city_id) serp = appendParam(serp, "city_id", city_id);
  serp = appendParam(serp, "context_url", context_url);
  redirect(serp);
}