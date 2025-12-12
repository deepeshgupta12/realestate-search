// frontend/src/app/search/page.tsx
import { apiGet } from "@/lib/api";

type Entity = {
  id: string;
  entity_type: string;
  name: string;
  city?: string;
  city_id?: string;
  parent_name?: string;
  canonical_url: string;
  score?: number;
  popularity_score?: number;
};

type SearchResponse = {
  q: string;
  normalized_q: string;
  did_you_mean: string | null;
  groups: {
    locations: Entity[];
    projects: Entity[];
    builders: Entity[];
    rate_pages: Entity[];
    property_pdps: Entity[];
  };
  fallbacks: {
    relaxed_used: boolean;
    trending: Entity[];
    reason: string | null;
  };
};

type ParseResponse = {
  q: string;
  intent: string | null;
  bhk: number | null;
  locality_hint: string | null;
  max_price: number | null;
  max_rent: number | null;
  currency: string | null;
  ok: boolean;
};

function isPromise<T>(v: unknown): v is Promise<T> {
  return !!v && typeof v === "object" && "then" in v && typeof (v as any).then === "function";
}

function Section({ title, items }: { title: string; items: Entity[] }) {
  if (!items?.length) return null;

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 space-y-3">
        {items.map((e) => (
          <div key={e.id} className="border border-white/15 rounded-lg p-4 bg-white/5">
            <div className="font-medium">{e.name}</div>
            <div className="text-sm opacity-70">
              {e.entity_type}
              {e.city ? ` • ${e.city}` : ""}
              {e.parent_name ? ` • ${e.parent_name}` : ""}
            </div>
            <div className="text-sm mt-2 opacity-80">URL: {e.canonical_url}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  // Next 16 may pass this as a Promise
  searchParams:
    | Promise<{ q?: string; city_id?: string }>
    | { q?: string; city_id?: string };
}) {
  const sp = isPromise<{ q?: string; city_id?: string }>(searchParams)
    ? await searchParams
    : searchParams;

  const q = (sp.q || "").trim();
  const city_id = (sp.city_id || "").trim();

  if (!q) {
    return (
      <main className="min-h-screen bg-[#0b0c0f] text-white">
        <div className="max-w-5xl mx-auto px-6 pt-10">
          <div className="opacity-70">Missing q</div>
        </div>
      </main>
    );
  }

  const [search, parse] = await Promise.all([
    apiGet<SearchResponse>("/api/v1/search", { q, city_id: city_id || null }),
    apiGet<ParseResponse>("/api/v1/search/parse", { q }),
  ]);

  const total =
    (search.groups.locations?.length || 0) +
    (search.groups.projects?.length || 0) +
    (search.groups.builders?.length || 0) +
    (search.groups.rate_pages?.length || 0) +
    (search.groups.property_pdps?.length || 0);

  const chips: string[] = [];
  if (parse?.ok) {
    if (parse.bhk) chips.push(`${parse.bhk} BHK`);
    if (parse.locality_hint) chips.push(`Locality: ${parse.locality_hint}`);
    if (parse.max_price) chips.push(`Max Price: ₹${parse.max_price.toLocaleString("en-IN")}`);
    if (parse.max_rent) chips.push(`Max Rent: ₹${parse.max_rent.toLocaleString("en-IN")}`);
  }

  return (
    <main className="min-h-screen bg-[#0b0c0f] text-white">
      <div className="max-w-5xl mx-auto px-6 pt-10">
        <div className="opacity-80">
          Query: <span className="font-semibold">{q}</span>
        </div>
        <div className="opacity-70 mt-1">Results: {total}</div>

        {search.did_you_mean && (
          <div className="mt-3 opacity-90">
            Did you mean: <span className="underline">{search.did_you_mean}</span>
          </div>
        )}

        {chips.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {chips.map((c) => (
              <span key={c} className="text-xs px-2 py-1 rounded-md bg-white/10 border border-white/15">
                {c}
              </span>
            ))}
          </div>
        )}

        {total === 0 ? (
          <div className="mt-8">
            <div className="text-xl font-semibold">No results found</div>
            <div className="opacity-70 mt-1">
              {search.fallbacks?.relaxed_used ? `Tried relaxed matching. Reason: ${search.fallbacks.reason}` : ""}
            </div>

            {search.fallbacks?.trending?.length ? (
              <section className="mt-6">
                <h2 className="text-lg font-semibold">Trending</h2>
                <div className="mt-3 space-y-3">
                  {search.fallbacks.trending.map((e) => (
                    <div key={e.id} className="border border-white/15 rounded-lg p-4 bg-white/5">
                      <div className="font-medium">{e.name}</div>
                      <div className="text-sm opacity-70">{e.entity_type}</div>
                      <div className="text-sm mt-2 opacity-80">URL: {e.canonical_url}</div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <>
            <Section title="Locations" items={search.groups.locations} />
            <Section title="Projects" items={search.groups.projects} />
            <Section title="Builders" items={search.groups.builders} />
            <Section title="Property Rates" items={search.groups.rate_pages} />
            <Section title="Properties" items={search.groups.property_pdps} />
          </>
        )}
      </div>
    </main>
  );
}