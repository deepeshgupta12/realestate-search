import SearchBar from "@/components/SearchBar";

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams: Promise<SearchParams>;
};

type SuggestItem = {
  id: string;
  entity_type: string;
  name: string;
  city?: string;
  city_id?: string;
  parent_name?: string;
  canonical_url: string;
  score?: number | null;
  popularity_score?: number | null;
};

type SuggestResponse = {
  q: string;
  normalized_q: string;
  did_you_mean: string | null;
  groups: {
    locations: SuggestItem[];
    projects: SuggestItem[];
    builders: SuggestItem[];
    rate_pages: SuggestItem[];
    property_pdps: SuggestItem[];
  };
  fallbacks?: {
    relaxed_used: boolean;
    trending: SuggestItem[];
    reason: string | null;
  };
};

const API_BASE =
  process.env.API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://localhost:8000";

function sp1(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return (v[0] || "").trim();
  return (v || "").trim();
}

function enc(v: string): string {
  return encodeURIComponent(v);
}

async function apiGet<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && v.trim()) usp.set(k, v);
  }
  const url = `${API_BASE}${path}?${usp.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

function groupToSections(r: SuggestResponse): Array<{ title: string; items: SuggestItem[] }> {
  const s: Array<{ title: string; items: SuggestItem[] }> = [];
  if (r.groups.locations.length) s.push({ title: "Locations", items: r.groups.locations });
  if (r.groups.projects.length) s.push({ title: "Projects", items: r.groups.projects });
  if (r.groups.builders.length) s.push({ title: "Builders", items: r.groups.builders });
  if (r.groups.rate_pages.length) s.push({ title: "Property Rates", items: r.groups.rate_pages });
  if (r.groups.property_pdps.length) s.push({ title: "Properties", items: r.groups.property_pdps });
  return s;
}

function sumTotal(r: SuggestResponse): number {
  return (
    r.groups.locations.length +
    r.groups.projects.length +
    r.groups.builders.length +
    r.groups.rate_pages.length +
    r.groups.property_pdps.length
  );
}

export default async function SearchPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const q = sp1(sp?.q);
  const city_id = sp1(sp?.city_id);
  const qid = sp1(sp?.qid);
  const context_url = sp1(sp?.context_url) || "/";

  const defaultCityId = city_id ? city_id : null;

  if (!q) {
    return (
      <main className="page">
        <h1 className="h1">Search</h1>
        <p className="sub">Type a query to see results.</p>
        <SearchBar contextUrl={context_url} defaultCityId={defaultCityId} />
      </main>
    );
  }

  const data = await apiGet<SuggestResponse>("/api/v1/search", {
    q,
    city_id: city_id || undefined,
    limit: "20",
  });

  const sections = groupToSections(data);
  const total = sumTotal(data);

  const didYouMeanHref = data.did_you_mean
    ? `/go?q=${enc(data.did_you_mean)}` +
      (city_id ? `&city_id=${enc(city_id)}` : "") +
      `&context_url=${enc(context_url)}`
    : null;

  const relaxedUsed = Boolean(data.fallbacks?.relaxed_used);
  const fallbackReason = data.fallbacks?.reason || null;
  const trendingFallback = data.fallbacks?.trending || [];
  const showTrendingFallback = total === 0 && trendingFallback.length > 0;

  return (
    <main className="page">
      <SearchBar contextUrl={context_url} defaultCityId={defaultCityId} />

      <div className="serpMeta">
        Query: <strong>{q}</strong>
        <br />
        Results: <strong>{total}</strong>

        {data.did_you_mean && didYouMeanHref ? (
          <>
            <br />
            Did you mean:{" "}
            <a className="link" href={didYouMeanHref}>
              <strong>{data.did_you_mean}</strong>
            </a>
          </>
        ) : null}
      </div>

      {relaxedUsed ? (
        <div className="card" style={{ borderColor: "rgba(255,255,255,0.18)" }}>
          <div style={{ fontWeight: 700 }}>Showing broader matches</div>
          <div style={{ color: "rgba(255,255,255,0.65)", marginTop: 6 }}>
            We expanded your query to find more relevant results.
            {fallbackReason ? ` (${fallbackReason})` : ""}
          </div>
        </div>
      ) : null}

      {total === 0 ? (
        <div className="card">
          <div style={{ fontWeight: 700 }}>No results found</div>
          <div style={{ color: "rgba(255,255,255,0.65)", marginTop: 6 }}>
            Try a different query{data.did_you_mean ? " or use the suggestion above" : ""}.
            {fallbackReason ? ` (${fallbackReason})` : ""}
          </div>
        </div>
      ) : (
        sections.map((sec) => (
          <section key={sec.title}>
            <div className="groupTitle">{sec.title}</div>
            {sec.items.map((it, idx) => {
              const rank = idx + 1;

              const goHref =
                `/go?url=${enc(it.canonical_url)}` +
                (qid ? `&qid=${enc(qid)}` : "") +
                `&q=${enc(q)}` +
                `&entity_id=${enc(it.id)}` +
                `&entity_type=${enc(it.entity_type)}` +
                `&rank=${enc(String(rank))}` +
                `&city_id=${enc((it.city_id || city_id || "").toString())}` +
                `&context_url=${enc(context_url)}`;

              return (
                <div key={it.id} className="resultCard">
                  <div style={{ fontWeight: 700 }}>{it.name}</div>
                  <div style={{ color: "rgba(255,255,255,0.60)", fontSize: 12, marginTop: 4 }}>
                    {it.entity_type}
                    {it.city ? ` • ${it.city}` : ""}
                    {it.parent_name ? ` • ${it.parent_name}` : ""}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <a className="link" href={goHref}>
                      Go to {it.canonical_url}
                    </a>
                  </div>
                </div>
              );
            })}
          </section>
        ))
      )}

      {showTrendingFallback ? (
        <>
          <div className="groupTitle">Trending searches</div>

          {trendingFallback.map((it, idx) => {
            const rank = idx + 1;

            const goHref =
              `/go?url=${enc(it.canonical_url)}` +
              (qid ? `&qid=${enc(qid)}` : "") +
              `&q=${enc(it.name)}` +
              `&entity_id=${enc(it.id)}` +
              `&entity_type=${enc(it.entity_type)}` +
              `&rank=${enc(String(rank))}` +
              `&city_id=${enc((it.city_id || city_id || "").toString())}` +
              `&context_url=${enc(context_url)}`;

            return (
              <div key={`${it.id}_${idx}`} className="resultCard">
                <div style={{ fontWeight: 700 }}>{it.name}</div>
                <div style={{ color: "rgba(255,255,255,0.60)", fontSize: 12, marginTop: 4 }}>
                  {it.entity_type}
                  {it.city ? ` • ${it.city}` : ""}
                  {it.parent_name ? ` • ${it.parent_name}` : ""}
                </div>
                <div style={{ marginTop: 8, fontSize: 13 }}>
                  <a className="link" href={goHref}>
                    Go to {it.canonical_url}
                  </a>
                </div>
              </div>
            );
          })}
        </>
      ) : null}
    </main>
  );
}