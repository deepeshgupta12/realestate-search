// frontend/src/app/search/page.tsx
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { EntityOut, SuggestResponse } from "@/lib/types";

type SP = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function enc(v: string): string {
  return encodeURIComponent(v);
}

function makeQid(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis as any;
  if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildGoHref(args: {
  url: string;
  qid: string;
  entity: EntityOut;
  rank: number;
  city_id?: string;
  context_url?: string;
}) {
  const { url, qid, entity, rank, city_id, context_url } = args;

  const qp: string[] = [];
  qp.push(`url=${enc(url)}`);
  qp.push(`qid=${enc(qid)}`);
  qp.push(`entity_id=${enc(entity.id)}`);
  qp.push(`entity_type=${enc(entity.entity_type)}`);
  qp.push(`rank=${enc(String(rank))}`);

  if (city_id) qp.push(`city_id=${enc(city_id)}`);
  if (context_url) qp.push(`context_url=${enc(context_url)}`);

  return `/go?${qp.join("&")}`;
}

function flattenGroups(groups: SuggestResponse["groups"]): EntityOut[] {
  const out: EntityOut[] = [];
  (groups.locations || []).forEach((x) => out.push(x));
  (groups.projects || []).forEach((x) => out.push(x));
  (groups.builders || []).forEach((x) => out.push(x));
  (groups.rate_pages || []).forEach((x) => out.push(x));
  (groups.property_pdps || []).forEach((x) => out.push(x));
  return out;
}

function buildSerpHref(args: {
  q: string;
  qid: string;
  city_id?: string;
  context_url?: string;
}) {
  const { q, qid, city_id, context_url } = args;
  const qp: string[] = [];
  qp.push(`q=${enc(q)}`);
  qp.push(`qid=${enc(qid)}`);
  if (city_id) qp.push(`city_id=${enc(city_id)}`);
  if (context_url) qp.push(`context_url=${enc(context_url)}`);
  return `/search?${qp.join("&")}`;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SP | Promise<SP>;
}) {
  const sp: SP =
    typeof (searchParams as Promise<SP>)?.then === "function"
      ? await (searchParams as Promise<SP>)
      : (searchParams as SP);

  const q = (first(sp.q) || "").trim();
  const city_id = first(sp.city_id) || undefined;
  const context_url =
    first(sp.context_url) || (q ? `/search?q=${enc(q)}` : "/search");

  const qid = first(sp.qid) || makeQid();

  if (!q) {
    return (
      <main style={{ maxWidth: 900, margin: "24px auto", padding: "0 16px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Search</h1>
        <p style={{ opacity: 0.8 }}>Type in the search bar to see results.</p>
      </main>
    );
  }

  const data = await apiGet<SuggestResponse>("/api/v1/search", {
    q,
    limit: 20,
    ...(city_id ? { city_id } : {}),
  });

  const all = flattenGroups(data.groups);
  const hasAny = all.length > 0;

  const dym =
    (data.did_you_mean || "").trim() &&
    data.did_you_mean!.trim().toLowerCase() !== q.toLowerCase()
      ? data.did_you_mean!.trim()
      : null;

  return (
    <main style={{ maxWidth: 900, margin: "24px auto", padding: "0 16px" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          Results for “{q}”
        </h1>
        <span style={{ opacity: 0.7, fontSize: 13 }}>qid: {qid}</span>
      </div>

      {dym ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border: "1px solid #eee",
            borderRadius: 8,
          }}
        >
          <span style={{ opacity: 0.85 }}>Did you mean </span>
          <Link
            href={buildSerpHref({ q: dym, qid, city_id, context_url })}
            style={{ fontWeight: 700, textDecoration: "none" }}
          >
            {dym}
          </Link>
          <span style={{ opacity: 0.85 }}>?</span>
        </div>
      ) : null}

      {!hasAny ? (
        <>
          <div style={{ marginTop: 14, padding: 12, border: "1px solid #eee" }}>
            <div style={{ fontWeight: 700 }}>No results found</div>
            <div style={{ opacity: 0.8, marginTop: 6 }}>
              Try a different spelling, or explore trending.
            </div>
          </div>

          {data.fallbacks?.trending?.length ? (
            <>
              <h2 style={{ marginTop: 18, fontSize: 16 }}>Trending</h2>
              <ul style={{ marginTop: 8 }}>
                {data.fallbacks.trending.map((e, i) => (
                  <li key={e.id} style={{ margin: "8px 0" }}>
                    <Link
                      href={buildGoHref({
                        url: e.canonical_url,
                        qid,
                        entity: e,
                        rank: i + 1,
                        city_id,
                        context_url,
                      })}
                      style={{ textDecoration: "none" }}
                    >
                      <span style={{ fontWeight: 600 }}>{e.name}</span>{" "}
                      <span style={{ opacity: 0.7 }}>
                        ({e.entity_type}
                        {e.city ? ` • ${e.city}` : ""})
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : (
        <>
          <h2 style={{ marginTop: 18, fontSize: 16 }}>All matches</h2>
          <ul style={{ marginTop: 8 }}>
            {all.map((e, i) => (
              <li key={e.id} style={{ margin: "10px 0" }}>
                <Link
                  href={buildGoHref({
                    url: e.canonical_url,
                    qid,
                    entity: e,
                    rank: i + 1,
                    city_id,
                    context_url,
                  })}
                  style={{ textDecoration: "none" }}
                >
                  <div style={{ fontWeight: 700 }}>{e.name}</div>
                  <div style={{ opacity: 0.7, fontSize: 13 }}>
                    {e.entity_type}
                    {e.city ? ` • ${e.city}` : ""}
                    {e.parent_name ? ` • ${e.parent_name}` : ""}
                    {" • "}
                    {e.canonical_url}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}