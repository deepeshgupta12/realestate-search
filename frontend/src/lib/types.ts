export type EntityOut = {
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

export type SuggestResponse = {
  q: string;
  normalized_q: string;
  did_you_mean?: string | null;
  groups: {
    locations: EntityOut[];
    projects: EntityOut[];
    builders: EntityOut[];
    rate_pages: EntityOut[];
    property_pdps: EntityOut[];
  };
  fallbacks?: {
    relaxed_used: boolean;
    trending: EntityOut[];
    reason?: string | null;
  } | null;
};

export type ResolveResponse = {
  action: "redirect" | "serp" | "disambiguate";
  query: string;
  normalized_query: string;

  // redirect/serp
  url?: string | null;

  // redirect
  match?: EntityOut | null;

  // disambiguate
  candidates?: EntityOut[] | null;

  reason?: string | null;
  debug?: Record<string, any> | null;
};

export type ZeroStateResponse = {
  city_id: string | null;
  recent_searches: string[];
  trending_searches: EntityOut[];
  trending_localities: EntityOut[];
  popular_entities: EntityOut[];
};
