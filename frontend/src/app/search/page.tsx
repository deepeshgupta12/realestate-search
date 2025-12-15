import Link from "next/link";
import type { SuggestResponse } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; city_id?: string; qid?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q || "").trim();
  const city_id = (sp.city_id || "").trim();
  const qid = (sp.qid || "").trim();

  if (!q) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-semibold">Search</h1>
        <p className="mt-2 text-gray-600">Missing query. Try /search?q=baner</p>
      </main>
    );
  }

  const u = new URL(`${API_BASE}/api/v1/search`);
  u.searchParams.set("q", q);
  u.searchParams.set("limit", "20");
  if (city_id) u.searchParams.set("city_id", city_id);

  const res = await fetch(u.toString(), { cache: "no-store" });
  const data = (await res.json()) as SuggestResponse;

  const sections = [
    { key: "locations", title: "Locations", items: data.groups.locations },
    { key: "projects", title: "Projects", items: data.groups.projects },
    { key: "builders", title: "Builders", items: data.groups.builders },
    { key: "rate_pages", title: "Property Rates", items: data.groups.rate_pages },
    { key: "property_pdps", title: "Properties", items: data.groups.property_pdps },
  ].filter((s) => s.items.length > 0);

  function goHref(args: {
    url: string;
    entity_id?: string;
    entity_type?: string;
    rank: number;
  }) {
    const go = new URL("http://example.com/go");
    go.searchParams.set("url", args.url);
    if (qid) go.searchParams.set("qid", qid);
    go.searchParams.set("rank", String(args.rank));
    if (args.entity_id) go.searchParams.set("entity_id", args.entity_id);
    if (args.entity_type) go.searchParams.set("entity_type", args.entity_type);
    if (city_id) go.searchParams.set("city_id", city_id);
    go.searchParams.set("context_url", `/search?q=${encodeURIComponent(q)}`);
    return go.pathname + "?" + go.searchParams.toString();
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Results for “{q}”</h1>

      {data.did_you_mean ? (
        <p className="mt-2 text-sm text-gray-600">
          Did you mean: <span className="font-medium">{data.did_you_mean}</span>
        </p>
      ) : null}

      {sections.length === 0 ? (
        <div className="mt-6 rounded border border-gray-200 p-4">
          <p className="text-gray-700">No results found.</p>

          {data.fallbacks?.trending?.length ? (
            <>
              <p className="mt-3 text-sm font-semibold text-gray-600">Trending</p>
              <ul className="mt-2 space-y-2">
                {data.fallbacks.trending.map((t, i) => (
                  <li key={t.id} className="rounded border border-gray-100 p-3">
                    <Link
                      href={goHref({
                        url: t.canonical_url,
                        entity_id: t.id,
                        entity_type: t.entity_type,
                        rank: i + 1,
                      })}
                      className="text-sm font-medium hover:underline"
                    >
                      {t.name}
                    </Link>
                    <div className="mt-1 text-xs text-gray-500">
                      {t.entity_type}
                      {t.city ? ` · ${t.city}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {sections.map((sec) => (
            <section key={sec.key}>
              <h2 className="text-sm font-semibold text-gray-600">{sec.title}</h2>
              <ul className="mt-2 space-y-2">
                {sec.items.map((it, idx) => (
                  <li key={it.id} className="rounded border border-gray-100 p-3">
                    <Link
                      href={goHref({
                        url: it.canonical_url,
                        entity_id: it.id,
                        entity_type: it.entity_type,
                        rank: idx + 1,
                      })}
                      className="text-sm font-medium hover:underline"
                    >
                      {it.name}
                    </Link>
                    <div className="mt-1 text-xs text-gray-500">
                      {it.entity_type}
                      {it.parent_name ? ` · ${it.parent_name}` : ""}
                      {it.city ? ` · ${it.city}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}