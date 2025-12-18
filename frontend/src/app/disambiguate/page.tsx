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
  fallbacks?: any;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

function sp1(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return (v[0] || "").trim();
  return (v || "").trim();
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

export default async function DisambiguatePage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const q = sp1(sp?.q);
  const qid = sp1(sp?.qid);
  const city_id = sp1(sp?.city_id);
  const context_url = sp1(sp?.context_url) || "/";

  if (!q) {
    return (
      <main className="page">
        <h1 className="h1">Disambiguate</h1>
        <p className="sub">Missing query.</p>
        <SearchBar initialQ="" initialCityId={city_id} />
      </main>
    );
  }

  // We intentionally call suggest (not resolve) so we don't double-log "search"
  const data = await apiGet<SuggestResponse>("/api/v1/search/suggest", {
    q,
    limit: "20",
    city_id: city_id || undefined,
  });

  // Candidates for disambiguation: in practice, this is almost always locations
  const candidates: SuggestItem[] = data.groups.locations.length
    ? data.groups.locations
    : [
        ...data.groups.projects,
        ...data.groups.builders,
        ...data.groups.rate_pages,
        ...data.groups.property_pdps,
      ];

  return (
    <main className="page">
      <SearchBar initialQ={q} initialCityId={city_id} />

      <div className="serpMeta">
        Multiple matches for <strong>{q}</strong>. Pick the right one.
      </div>

      {candidates.length === 0 ? (
        <div className="card">
          <div style={{ fontWeight: 700 }}>No candidates found</div>
          <div style={{ color: "rgba(255,255,255,0.65)", marginTop: 6 }}>
            Try searching again.
          </div>
        </div>
      ) : (
        <section>
          <div className="groupTitle">Choose one</div>

          {candidates.map((it, idx) => {
            const rank = idx + 1;
            const goHref =
              `/go?url=${encodeURIComponent(it.canonical_url)}` +
              `&qid=${encodeURIComponent(qid || "")}` +
              `&q=${encodeURIComponent(q)}` +
              `&entity_id=${encodeURIComponent(it.id)}` +
              `&entity_type=${encodeURIComponent(it.entity_type)}` +
              `&rank=${encodeURIComponent(String(rank))}` +
              `&city_id=${encodeURIComponent((it.city_id || city_id || "").toString())}` +
              `&context_url=${encodeURIComponent(context_url)}`;

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
      )}
    </main>
  );
}