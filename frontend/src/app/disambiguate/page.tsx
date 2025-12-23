import Link from "next/link";

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
  canonical_url?: string;
  score?: number;
  popularity_score?: number;
};

type SuggestLiteResponse = {
  ok: boolean;
  items: SuggestItem[];
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

function sp1(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return (v[0] || "").trim();
  return (v || "").trim();
}

async function apiGet<T>(path: string, params: Record<string, string | null | undefined>): Promise<T> {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    if (String(v).trim() === "") continue;
    usp.set(k, String(v));
  }
  const url = `${API_BASE}${path}?${usp.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

function labelForItem(it: SuggestItem): string {
  const parts: string[] = [];
  const parent = (it.parent_name || "").trim();
  const city = (it.city || "").trim();
  if (parent) parts.push(parent);
  if (city && city.toLowerCase() !== parent.toLowerCase()) parts.push(city);
  return parts.join(", ");
}

export default async function DisambiguatePage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const q = sp1(sp?.q);
  const city_id = sp1(sp?.city_id) || undefined;

  if (!q) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
        <h1>Disambiguate</h1>
        <p>Missing query.</p>
        <Link href="/">Back</Link>
      </main>
    );
  }

  const data = await apiGet<SuggestLiteResponse>("/api/v1/search/suggest", { q, city_id, limit: "20" });

  const items = data.items || [];

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto", maxWidth: 900 }}>
      <h1 style={{ marginBottom: 8 }}>Choose what you meant</h1>
      <p style={{ marginTop: 0, opacity: 0.75 }}>
        Query: <b>{q}</b>
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
        {items.length ? (
          items.map((it, idx) => (
            <Link
              key={`${it.id}-${idx}`}
              href={it.canonical_url || `/go?q=${encodeURIComponent(q)}${city_id ? `&city_id=${encodeURIComponent(city_id)}` : ""}`}
              style={{
                textDecoration: "none",
                color: "inherit",
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 12,
                padding: "12px 14px",
                background: "white",
              }}
            >
              <div style={{ fontWeight: 650 }}>{it.name}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {it.entity_type}
                {labelForItem(it) ? ` • ${labelForItem(it)}` : ""}
              </div>
            </Link>
          ))
        ) : (
          <div style={{ opacity: 0.75 }}>No candidates found. Try searching again.</div>
        )}

        <Link href={`/search?q=${encodeURIComponent(q)}${city_id ? `&city_id=${encodeURIComponent(city_id)}` : ""}`} style={{ marginTop: 12 }}>
          Go to SERP
        </Link>
      </div>
    </main>
  );
}
