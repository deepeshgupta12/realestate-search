export type EntityType =
  | "city"
  | "micromarket"
  | "locality"
  | "listing_page"
  | "locality_overview"
  | "rate_page"
  | "project"
  | "property_pdp"
  | "builder"
  | "developer";

export type ResolveAction = "redirect" | "serp" | "disambiguate";

export interface EntityOut {
  id: string;
  entity_type: EntityType | string;
  name: string;
  city?: string;
  city_id?: string;
  parent_name?: string;
  canonical_url: string;
  score?: number | null;
  popularity_score?: number | null;
}

export interface SuggestResponse {
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
}

export interface ResolveResponse {
  action: ResolveAction;
  query: string;
  normalized_query: string;
  url?: string | null;
  match?: EntityOut | null;
  candidates?: EntityOut[] | null;
  reason?: string | null;
  debug?: Record<string, any> | null;
}

export interface ZeroStateResponse {
  city_id: string | null;
  recent_searches: string[];
  trending_searches: EntityOut[];
  trending_localities: EntityOut[];
  popular_entities: EntityOut[];
}

export interface EventsOkResponse {
  ok: boolean;
}
