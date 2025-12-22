import Link from "next/link";

type EntityType =
  | "city"
  | "locality"
  | "micromarket"
  | "project"
  | "rate_page"
  | "locality_overview"
  | "developer"
  | "builder"
  | "other";

type SuggestItem = {
  id: string;
  entity_type: EntityType | string;
  name: string;
  city_id?: string | null;
  city?: string | null;
  parent_name?: string | null;
  canonical_url?: string | null;
  score?: number | null;
  popularity_score?: number | null;
};

type SuggestResponse = {
  ok: boolean;
  items: SuggestItem[];
};

const API_BASE = process.env.NEXT_PUBLIC_API_V1_BASE || "http://localhost:8000/api/v1";

async function apiGet<T>(path: string, params: Record<string, string | undefined>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") usp.set(k, v);
  }
  const url = `${API_BASE}${path}?${usp.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

function groupCandidates(items: SuggestItem[]) {
  const locations: SuggestItem[] = [];
  const projects: SuggestItem[] = [];
  const pages: SuggestItem[] = [];
  const others: SuggestItem[] = [];

  for (const it of items) {
    const t = String(it.entity_type || "");
    if (t === "project") projects.push(it);
    else if (t === "city" || t === "locality" || t === "micromarket") locations.push(it);
    else if (t.endsWith("_page") || t === "locality_overview") pages.push(it);
    else others.push(it);
  }

  return { locations, projects, pages, others };
}

export default async function DisambiguatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const q = typeof sp.q === "string" ? sp.q : "";
  const context_url = typeof sp.context_url === "string" ? sp.context_url : "/";
  const city_id = typeof sp.city_id === "string" ? sp.city_id : undefined;

  if (!q.trim()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
        <h1 style={{ marginBottom: 8 }}>Disambiguate</h1>
        <p style={{ marginTop: 0 }}>Missing query.</p>
        <Link href={`/search?q=&context_url=${encodeURIComponent(context_url)}`}>Go to SERP</Link>
      </main>
    );
  }

  let data: SuggestResponse | null = null;
  let err: string | null = null;

  try {
    data = await apiGet<SuggestResponse>("/search/suggest", {
      q,
      limit: "20",
      city_id,
      context_url,
    });
  } catch (e: any) {
    err = e?.message || String(e);
  }

  const items = data?.ok ? data.items || [] : [];
  const groups = groupCandidates(items);

  const candidates =
    groups.locations.length > 0
      ? groups.locations
      : groups.projects.length > 0
        ? groups.projects
        : groups.pages.length > 0
          ? groups.pages
          : groups.others;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
      <h1 style={{ marginBottom: 8 }}>Pick one match</h1>

      <p style={{ marginTop: 0 }}>
        Query: <b>{q}</b> (context: <code>{context_url}</code>)
      </p>

      {err ? (
        <div style={{ padding: 12, border: "1px solid #333", borderRadius: 8, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Error</div>
          <div style={{ opacity: 0.9 }}>{err}</div>
        </div>
      ) : null}

      {candidates.length === 0 ? (
        <div>
          <div style={{ marginBottom: 8 }}>No candidates found.</div>
          <Link
            href={`/search?q=${encodeURIComponent(q)}&context_url=${encodeURIComponent(
              context_url
            )}&city_id=${encodeURIComponent(city_id || "")}`}
          >
            Go to SERP
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10, maxWidth: 760 }}>
          {candidates.map((c) => {
            const href =
              c.canonical_url && c.canonical_url.startsWith("/")
                ? c.canonical_url
                : `/search?q=${encodeURIComponent(q)}&context_url=${encodeURIComponent(
                    context_url
                  )}&city_id=${encodeURIComponent(city_id || "")}`;

            const meta = [c.city || "", c.parent_name || "", String(c.entity_type || "")]
              .filter(Boolean)
              .join(" · ");

            return (
              <Link
                key={`${c.entity_type}:${c.id}`}
                href={href}
                style={{
                  padding: "12px 14px",
                  border: "1px solid #2a2a2a",
                  borderRadius: 10,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div style={{ fontWeight: 650 }}>{c.name}</div>
                {meta ? <div style={{ opacity: 0.75, fontSize: 13, marginTop: 4 }}>{meta}</div> : null}
                {c.canonical_url ? (
                  <div style={{ opacity: 0.7, fontSize: 12, marginTop: 6 }}>
                    <code>{c.canonical_url}</code>
                  </div>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}