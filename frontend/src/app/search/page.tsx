import SearchBar from "@/components/SearchBar";
import { apiGet } from "@/lib/api";
import type { SuggestResponse, SuggestItem } from "@/lib/types";

function groupToSections(r: SuggestResponse): Array<{ title: string; items: SuggestItem[] }> {
  const s: Array<{ title: string; items: SuggestItem[] }> = [];
  if (r.groups.locations.length) s.push({ title: "Locations", items: r.groups.locations });
  if (r.groups.projects.length) s.push({ title: "Projects", items: r.groups.projects });
  if (r.groups.builders.length) s.push({ title: "Builders", items: r.groups.builders });
  if (r.groups.rate_pages.length) s.push({ title: "Property Rates", items: r.groups.rate_pages });
  if (r.groups.property_pdps.length) s.push({ title: "Properties", items: r.groups.property_pdps });
  return s;
}

export default async function SearchPage({
  searchParams,
}: {
  // Next 16 can treat this as async in some cases; normalize with Promise.resolve
  searchParams: any;
}) {
  const sp = await Promise.resolve(searchParams);
  const q = String(sp?.q || "").trim();
  const city_id = String(sp?.city_id || "").trim();

  if (!q) {
    return (
      <main className="page">
        <h1 className="h1">Search</h1>
        <p className="sub">Type a query to see results.</p>
        <SearchBar initialQ="" initialCityId={city_id} />
      </main>
    );
  }

  const data = await apiGet<SuggestResponse>("/api/v1/search", {
    q,
    city_id: city_id || undefined,
  });

  const sections = groupToSections(data);
  const total =
    data.groups.locations.length +
    data.groups.projects.length +
    data.groups.builders.length +
    data.groups.rate_pages.length +
    data.groups.property_pdps.length;

  return (
    <main className="page">
      <SearchBar initialQ={q} initialCityId={city_id} />

      <div className="serpMeta">
        Query: <strong>{q}</strong>
        <br />
        Results: <strong>{total}</strong>
        {data.did_you_mean ? (
          <>
            <br />
            Did you mean: <strong>{data.did_you_mean}</strong>
          </>
        ) : null}
      </div>

      {total === 0 ? (
        <div className="card">
          <div style={{ fontWeight: 700 }}>No results found</div>
          <div style={{ color: "rgba(255,255,255,0.65)", marginTop: 6 }}>
            Try a different query.
          </div>
        </div>
      ) : (
        sections.map((sec) => (
          <section key={sec.title}>
            <div className="groupTitle">{sec.title}</div>
            {sec.items.map((it) => (
              <div key={it.id} className="resultCard">
                <div style={{ fontWeight: 700 }}>{it.name}</div>
                <div style={{ color: "rgba(255,255,255,0.60)", fontSize: 12, marginTop: 4 }}>
                  {(it.entity_type || "")}
                  {it.city ? ` • ${it.city}` : ""}
                  {it.parent_name ? ` • ${it.parent_name}` : ""}
                </div>
                <div style={{ marginTop: 8, fontSize: 13 }}>
                  URL:{" "}
                  <a className="link" href={`/go?url=${encodeURIComponent(it.canonical_url)}&q=${encodeURIComponent(q)}`}>
                    {it.canonical_url}
                  </a>
                </div>
              </div>
            ))}
          </section>
        ))
      )}

      {data.fallbacks?.trending?.length ? (
        <>
          <div className="groupTitle">Trending</div>
          {data.fallbacks.trending.map((it) => (
            <div key={it.id} className="resultCard">
              <div style={{ fontWeight: 700 }}>{it.name}</div>
              <div style={{ color: "rgba(255,255,255,0.60)", fontSize: 12, marginTop: 4 }}>
                {it.entity_type}
                {it.city ? ` • ${it.city}` : ""}
                {it.parent_name ? ` • ${it.parent_name}` : ""}
              </div>
              <div style={{ marginTop: 8, fontSize: 13 }}>
                URL:{" "}
                <a className="link" href={`/go?url=${encodeURIComponent(it.canonical_url)}&q=${encodeURIComponent(it.name)}`}>
                  {it.canonical_url}
                </a>
              </div>
            </div>
          ))}
        </>
      ) : null}
    </main>
  );
}