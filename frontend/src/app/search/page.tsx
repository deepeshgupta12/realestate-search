import Link from "next/link";

type EntityType =
  | "city"
  | "micromarket"
  | "locality"
  | "listing_page"
  | "locality_overview"
  | "rate_page"
  | "project"
  | "builder"
  | "developer"
  | "property_pdp"
  | string;

type EntityOut = {
  id: string;
  entity_type: EntityType;
  name: string;
  city?: string;
  city_id?: string;
  parent_name?: string;
  canonical_url: string;
  score?: number | null;
  popularity_score?: number | null;
};

type SearchResponse = {
  q: string;
  normalized_q: string;
  did_you_mean: string | null;
  groups: {
    locations: EntityOut[];
    projects: EntityOut[];
    builders: EntityOut[];
    rate_pages: EntityOut[];
    property_pdps: EntityOut[];
    [k: string]: EntityOut[];
  };
  fallbacks?: {
    relaxed_used?: boolean;
    trending?: EntityOut[];
    reason?: string | null;
  } | null;
};

type ParseResponse = {
  q: string;
  intent: "buy" | "rent" | null;
  bhk: number | null;
  locality_hint: string | null;
  max_price: number | null;
  max_rent: number | null;
  currency: string;
  ok: boolean;
};

const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/+$/, "");

function countGroups(groups: SearchResponse["groups"]): number {
  return Object.values(groups).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
}

function fmtINR(n: number): string {
  // simple formatter (keeps local dev predictable)
  return `₹${n.toLocaleString("en-IN")}`;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; city_id?: string }>;
}) {
  const sp = await searchParams;
  const rawQ = (sp.q || "").trim();
  const cityId = (sp.city_id || "").trim();

  if (!rawQ) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Search</h1>
        <p className="mt-2 opacity-70">Type a query in the search bar.</p>
      </main>
    );
  }

  // Parse constraints (best-effort)
  let parsed: ParseResponse | null = null;
  try {
    const pr = await fetch(`${API_BASE}/api/v1/search/parse?q=${encodeURIComponent(rawQ)}`, {
      cache: "no-store",
    });
    if (pr.ok) parsed = (await pr.json()) as ParseResponse;
  } catch {
    parsed = null;
  }

  // If constraint-heavy and we extracted a locality, search using that hint for better entity matches
  const effectiveQ = parsed?.locality_hint ? parsed.locality_hint : rawQ;

  let data: SearchResponse | null = null;
  try {
    const url =
      `${API_BASE}/api/v1/search?q=${encodeURIComponent(effectiveQ)}&limit=20` +
      (cityId ? `&city_id=${encodeURIComponent(cityId)}` : "");
    const r = await fetch(url, { cache: "no-store" });
    if (r.ok) data = (await r.json()) as SearchResponse;
  } catch {
    data = null;
  }

  const groups = data?.groups || {
    locations: [],
    projects: [],
    builders: [],
    rate_pages: [],
    property_pdps: [],
  };

  const total = countGroups(groups);
  const didYouMean = data?.did_you_mean && data.did_you_mean.toLowerCase() !== rawQ.toLowerCase() ? data.did_you_mean : null;

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Search results</h1>

      <div className="mt-2 text-sm opacity-80">
        Query: <span className="font-medium">{rawQ}</span>
      </div>

      {parsed?.ok ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {parsed.intent ? <span className="rounded border px-2 py-1">Intent: {parsed.intent}</span> : null}
          {parsed.bhk ? <span className="rounded border px-2 py-1">{parsed.bhk} BHK</span> : null}
          {parsed.locality_hint ? <span className="rounded border px-2 py-1">Locality: {parsed.locality_hint}</span> : null}
          {parsed.max_price ? <span className="rounded border px-2 py-1">Max Price: {fmtINR(parsed.max_price)}</span> : null}
          {parsed.max_rent ? <span className="rounded border px-2 py-1">Max Rent: {fmtINR(parsed.max_rent)}/mo</span> : null}
        </div>
      ) : null}

      {didYouMean ? (
        <div className="mt-4 rounded border p-3 text-sm">
          Did you mean{" "}
          <Link className="underline" href={`/search?q=${encodeURIComponent(didYouMean)}${cityId ? `&city_id=${encodeURIComponent(cityId)}` : ""}`}>
            {didYouMean}
          </Link>
          ?
        </div>
      ) : null}

      <div className="mt-4 text-sm opacity-70">
        {total > 0 ? `${total} results` : "No direct matches"}
      </div>

      {/* Sections */}
      <div className="mt-6 space-y-6">
        {groups.locations.length ? (
          <section>
            <h2 className="text-sm font-semibold opacity-70 mb-2">Locations</h2>
            <div className="rounded border divide-y">
              {groups.locations.map((e) => (
                <Link key={e.id} href={e.canonical_url} className="block px-4 py-3 hover:bg-black/5">
                  <div className="font-medium text-sm">{e.name}</div>
                  <div className="text-xs opacity-70">{[e.parent_name, e.city].filter(Boolean).join(" • ")}</div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {groups.projects.length ? (
          <section>
            <h2 className="text-sm font-semibold opacity-70 mb-2">Projects</h2>
            <div className="rounded border divide-y">
              {groups.projects.map((e) => (
                <Link key={e.id} href={e.canonical_url} className="block px-4 py-3 hover:bg-black/5">
                  <div className="font-medium text-sm">{e.name}</div>
                  <div className="text-xs opacity-70">{[e.parent_name, e.city].filter(Boolean).join(" • ")}</div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {groups.builders.length ? (
          <section>
            <h2 className="text-sm font-semibold opacity-70 mb-2">Builders</h2>
            <div className="rounded border divide-y">
              {groups.builders.map((e) => (
                <Link key={e.id} href={e.canonical_url} className="block px-4 py-3 hover:bg-black/5">
                  <div className="font-medium text-sm">{e.name}</div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {groups.rate_pages.length ? (
          <section>
            <h2 className="text-sm font-semibold opacity-70 mb-2">Property Rates</h2>
            <div className="rounded border divide-y">
              {groups.rate_pages.map((e) => (
                <Link key={e.id} href={e.canonical_url} className="block px-4 py-3 hover:bg-black/5">
                  <div className="font-medium text-sm">{e.name}</div>
                  <div className="text-xs opacity-70">{[e.parent_name, e.city].filter(Boolean).join(" • ")}</div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {groups.property_pdps.length ? (
          <section>
            <h2 className="text-sm font-semibold opacity-70 mb-2">Properties</h2>
            <div className="rounded border divide-y">
              {groups.property_pdps.map((e) => (
                <Link key={e.id} href={e.canonical_url} className="block px-4 py-3 hover:bg-black/5">
                  <div className="font-medium text-sm">{e.name}</div>
                  <div className="text-xs opacity-70">{[e.parent_name, e.city].filter(Boolean).join(" • ")}</div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* Fallback trending on SERP (when no results) */}
        {total === 0 && data?.fallbacks?.trending?.length ? (
          <section>
            <h2 className="text-sm font-semibold opacity-70 mb-2">Trending</h2>
            <div className="rounded border divide-y">
              {data.fallbacks.trending.map((e) => (
                <Link key={e.id} href={e.canonical_url} className="block px-4 py-3 hover:bg-black/5">
                  <div className="font-medium text-sm">{e.name}</div>
                  <div className="text-xs opacity-70">{[e.parent_name, e.city].filter(Boolean).join(" • ")}</div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
