import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import { apiGet } from "@/lib/api";
import type { SuggestItem, SuggestResponse } from "@/lib/types";

type ParseResponse = {
  q: string;
  intent: string | null;
  bhk: number | null;
  locality_hint: string | null;
  max_price: number | null;
  max_rent: number | null;
  currency: string;
  ok: boolean;
};

type SearchParams = { q?: string; city_id?: string };
type Props = { searchParams: SearchParams | Promise<SearchParams> };

function labelFor(e: SuggestItem): string {
  switch (e.entity_type) {
    case "builder":
      return "BLD";
    case "city":
      return "CITY";
    case "project":
      return "PRJ";
    case "micromarket":
      return "MM";
    case "locality":
      return "LOC";
    case "rate_page":
      return "RATE";
    case "property_pdp":
      return "PROP";
    default:
      return "RES";
  }
}

function metaFor(e: SuggestItem): string {
  const bits: string[] = [];
  if (e.entity_type) bits.push(e.entity_type);
  if (e.city) bits.push(e.city);
  if (e.parent_name) bits.push(e.parent_name);
  return bits.join(" • ");
}

function goHref(canonicalUrl: string, q: string) {
  const sp = new URLSearchParams();
  sp.set("url", canonicalUrl);
  if (q) sp.set("q", q);
  return `/go?${sp.toString()}`;
}

function ResultCard({ e, q }: { e: SuggestItem; q: string }) {
  return (
    <Link className="resultCard" href={goHref(e.canonical_url, q)}>
      <div className="tag">{labelFor(e)}</div>
      <div>
        <div className="resultTitle">{e.name}</div>
        <div className="resultMeta">{metaFor(e)}</div>
        <div className="resultMeta">URL: {e.canonical_url}</div>
      </div>
    </Link>
  );
}

export default async function SearchPage(props: Props) {
  const sp = await props.searchParams;

  const rawQ = (sp?.q ?? "").toString().trim();
  const city_id = (sp?.city_id ?? "").toString().trim();

  return (
    <div className="appShell">
      <main className="page">
        <div className="hero">
          <h1 className="title">Search results</h1>
          <div className="sub">Type a query to see results.</div>
        </div>

        <SearchBar initialQ={rawQ} initialCityId={city_id} />

        {!rawQ ? null : (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="kv">
              <div>Query</div>
              <div style={{ opacity: 0.9 }}>{rawQ}</div>
            </div>

            {(() => {
              // 1) Parse query
              // (server-side so /search can also behave like a SERP for constraint queries)
              return null;
            })()}
          </div>
        )}

        {rawQ ? (
          <ResultsBlock q={rawQ} cityId={city_id} />
        ) : null}
      </main>
    </div>
  );
}

async function ResultsBlock({ q, cityId }: { q: string; cityId: string }) {
  const parse = await apiGet<ParseResponse>("/api/v1/search/parse", { q });
  const effectiveQ = (parse?.locality_hint || q).trim();

  const data = await apiGet<SuggestResponse>("/api/v1/search", {
    q: effectiveQ,
    city_id: cityId || undefined,
    limit: 10,
  });

  const groups = data?.groups || {
    locations: [],
    projects: [],
    builders: [],
    rate_pages: [],
    property_pdps: [],
  };

  const total =
    (groups.locations?.length || 0) +
    (groups.projects?.length || 0) +
    (groups.builders?.length || 0) +
    (groups.rate_pages?.length || 0) +
    (groups.property_pdps?.length || 0);

  const trending = data?.fallbacks?.trending || [];
  const showTrending = total === 0 && trending.length > 0;

  return (
    <>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="kv">
          <div>Effective query</div>
          <div style={{ opacity: 0.9 }}>{effectiveQ}</div>
        </div>
        <div className="kv">
          <div>Results</div>
          <div style={{ opacity: 0.9 }}>{total}</div>
        </div>
        {data?.did_you_mean ? (
          <div className="hint" style={{ marginTop: 10 }}>
            Did you mean{" "}
            <Link className="link" href={`/search?q=${encodeURIComponent(data.did_you_mean)}`}>
              {data.did_you_mean}
            </Link>
            ?
          </div>
        ) : null}
      </div>

      {total === 0 ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="sectionTitle">No results found</div>
          <div className="sub" style={{ marginTop: 6 }}>
            Try a different spelling or choose from trending.
          </div>

          {showTrending ? (
            <div style={{ marginTop: 12 }}>
              <div className="sectionTitle" style={{ fontSize: 13, opacity: 0.75 }}>
                Trending
              </div>

              <div className="pillRow" style={{ marginTop: 10 }}>
                {trending.map((e) => (
                  <Link
                    key={e.id}
                    className="pill"
                    href={goHref(e.canonical_url, "")}
                    title={metaFor(e)}
                  >
                    {e.name}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {groups.locations?.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="sectionTitle">Locations</div>
          <div style={{ marginTop: 10 }}>
            {groups.locations.map((e) => (
              <ResultCard key={e.id} e={e} q={q} />
            ))}
          </div>
        </div>
      ) : null}

      {groups.projects?.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="sectionTitle">Projects</div>
          <div style={{ marginTop: 10 }}>
            {groups.projects.map((e) => (
              <ResultCard key={e.id} e={e} q={q} />
            ))}
          </div>
        </div>
      ) : null}

      {groups.builders?.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="sectionTitle">Builders</div>
          <div style={{ marginTop: 10 }}>
            {groups.builders.map((e) => (
              <ResultCard key={e.id} e={e} q={q} />
            ))}
          </div>
        </div>
      ) : null}

      {groups.rate_pages?.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="sectionTitle">Property Rates</div>
          <div style={{ marginTop: 10 }}>
            {groups.rate_pages.map((e) => (
              <ResultCard key={e.id} e={e} q={q} />
            ))}
          </div>
        </div>
      ) : null}

      {groups.property_pdps?.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="sectionTitle">Properties</div>
          <div style={{ marginTop: 10 }}>
            {groups.property_pdps.map((e) => (
              <ResultCard key={e.id} e={e} q={q} />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
