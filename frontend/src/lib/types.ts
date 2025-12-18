// frontend/src/lib/types.ts

export type EntityType =
  | "city"
  | "micromarket"
  | "locality"
  | "project"
  | "builder"
  | "rate_page"
  | "property_pdp";

export type EntityOut = {
  id: string;
  entity_type: EntityType | string;
  name: string;
  city: string;
  city_id: string;
  parent_name: string;
  canonical_url: string;
  score: number | null;
  popularity_score: number | null;
};

export type SuggestGroups = {
  locations: EntityOut[];
  projects: EntityOut[];
  builders: EntityOut[];
  rate_pages: EntityOut[];
  property_pdps: EntityOut[];
};

export type SuggestFallbacks = {
  relaxed_used: boolean;
  trending: EntityOut[];
  reason: string | null;
};

export type SuggestResponse = {
  q: string;
  normalized_q: string;
  did_you_mean: string | null;
  groups: SuggestGroups;
  fallbacks: SuggestFallbacks;
};

export type ZeroStateResponse = {
  city_id: string | null;
  // keeping flexible because you may evolve to store structured recent items
  recent_searches: any[];
  trending_searches: EntityOut[];
  trending_localities: EntityOut[];
  popular_entities: EntityOut[];
};

export type ResolveAction = "redirect" | "disambiguate" | "serp";

export type ResolveResponse = {
  action: ResolveAction;
  query: string;
  normalized_query: string;
  url: string | null;
  match: EntityOut | null;
  candidates: EntityOut[] | null;
  reason: string;
  debug: any | null;
};

export type OkResponse = { ok: boolean };