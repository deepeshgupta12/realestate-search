export type EntityType =
  | "city"
  | "micromarket"
  | "locality"
  | "locality_overview"
  | "rate_page"
  | "listing_page"
  | "project"
  | "property_pdp"
  | "builder";

export type EntityOut = {
  id: string;
  entity_type: EntityType;
  name: string;
  city: string;
  city_id: string;
  parent_name: string;
  canonical_url: string;
  score: number | null;
  popularity_score: number | null;
};

export type SuggestResponse = {
  q: string;
  normalized_q: string;
  did_you_mean: string | null;
  groups: {
    locations: EntityOut[];
    projects: EntityOut[];
    builders: EntityOut[];
    rate_pages: EntityOut[];
    property_pdps: EntityOut[];
  };
  fallbacks?: {
    relaxed_used?: boolean;
    trending?: EntityOut[];
    reason?: string | null;
  };
};

export type ZeroStateResponse = {
  city_id: string | null;
  recent_searches: string[];
  trending_searches: EntityOut[];
  trending_localities: EntityOut[];
  popular_entities: EntityOut[];
};

export type ResolveResponse =
  | {
      action: "redirect";
      query: string;
      normalized_query: string;
      url: string;
      match: EntityOut | null;
      candidates: null;
      reason: string | null;
      debug?: unknown;
    }
  | {
      action: "serp";
      query: string;
      normalized_query: string;
      url: string;
      match: null;
      candidates: null;
      reason: string | null;
      debug?: unknown;
    }
  | {
      action: "disambiguate";
      query: string;
      normalized_query: string;
      url: null;
      match: null;
      candidates: EntityOut[];
      reason: string | null;
      debug?: unknown;
    };

export type EventOk = { ok: boolean };
