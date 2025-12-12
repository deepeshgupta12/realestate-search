import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import { apiGet } from "@/lib/api";
import type { SearchResponse, SearchEntity } from "@/lib/types";

type SearchParamsShape = { q?: string; city_id?: string };
type Props = {
  searchParams: Promise<SearchParamsShape> | SearchParamsShape;
};

function Section({
  title,
  items,
  q,
}: {
  title: string;
  items: SearchEntity[];
  q: string;
}) {
  if (!items?.length) return null;

  return (
    <div style={{ marginTop: 18 }}>
      <h3 style={{ margin: "0 0 10px 0" }}>{title}</h3>
      <div style={{ display: "grid", gap: 12 }}>
        {items.map((it) => (
          <div
            key={`${it.entity_type}:${it.id}`}
            style={{
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 10,
              padding: 14,
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <div style={{ fontWeight: 600 }}>{it.name}</div>
            <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>
              {it.entity_type}
              {it.city ? ` • ${it.city}` : ""}
              {it.parent_name ? ` • ${it.parent_name}` : ""}
            </div>
            <div style={{ marginTop: 10 }}>
              <Link
                href={`/go?url=${encodeURIComponent(it.canonical_url)}&q=${encodeURIComponent(
                  q
                )}`}
                style={{ opacity: 0.9 }}
              >
                URL: {it.canonical_url}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await Promise.resolve(searchParams as SearchParamsShape);

  const q = (sp?.q ?? "").trim();
  const city_id = (sp?.city_id ?? "").trim();

  // Always show the search bar (even if q is empty)
  if (!q) {
    return (
      <main style={{ maxWidth: 980, margin: "0 auto", padding: "48px 20px" }}>
        <h1 style={{ marginBottom: 8 }}>Search</h1>
        <p style={{ opacity: 0.75, marginTop: 0 }}>
          Type a query to see results.
        </p>
        <div style={{ marginTop: 18 }}>
          <SearchBar />
        </div>
      </main>
    );
  }

  const data = await apiGet<SearchResponse>("/api/v1/search", {
    q,
    ...(city_id ? { city_id } : {}),
  });

  const groups = data.groups || {
    locations: [],
    projects: [],
    builders: [],
    rate_pages: [],
    property_pdps: [],
  };

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "48px 20px" }}>
      <div style={{ marginBottom: 18 }}>
        <SearchBar initialQuery={q} initialCityId={city_id} />
      </div>

      <div style={{ opacity: 0.75, marginBottom: 10 }}>
        Query: <b>{data.q}</b>
      </div>

      {data.did_you_mean ? (
        <div style={{ marginBottom: 16 }}>
          Did you mean{" "}
          <Link href={`/search?q=${encodeURIComponent(data.did_you_mean)}`}>
            {data.did_you_mean}
          </Link>
          ?
        </div>
      ) : null}

      <div style={{ opacity: 0.8, marginBottom: 18 }}>
        Results:{" "}
        {[
          groups.locations?.length || 0,
          groups.projects?.length || 0,
          groups.builders?.length || 0,
          groups.rate_pages?.length || 0,
          groups.property_pdps?.length || 0,
        ].reduce((a, b) => a + b, 0)}
      </div>

      <Section title="Locations" items={groups.locations || []} q={q} />
      <Section title="Projects" items={groups.projects || []} q={q} />
      <Section title="Builders" items={groups.builders || []} q={q} />
      <Section title="Property Rates" items={groups.rate_pages || []} q={q} />
      <Section title="Properties" items={groups.property_pdps || []} q={q} />

      {data.fallbacks?.relaxed_used ? (
        <div style={{ marginTop: 24, opacity: 0.8 }}>
          Tried relaxed matching. Reason: {data.fallbacks.reason}
        </div>
      ) : null}
    </main>
  );
}
