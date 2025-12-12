export type EntityType =
  | "city"
  | "micromarket"
  | "locality"
  | "project"
  | "builder"
  | "rate_page"
  | "property_pdp";

export type SuggestItem = {
  id: string;
  entity_type: EntityType;
  name: string;
  city?: string;
  city_id?: string;
  parent_name?: string;
  canonical_url: string;
  score?: number;
  popularity_score?: number;
};

export type SuggestGroups = {
  locations: SuggestItem[];
  projects: SuggestItem[];
  builders: SuggestItem[];
  rate_pages: SuggestItem[];
  property_pdps: SuggestItem[];
};

export type SuggestFallbacks = {
  relaxed_used: boolean;
  trending: SuggestItem[];
  reason: string | null;
};

export type SuggestResponse = {
  q: string;
  normalized_q: string;
  did_you_mean: string | null;
  groups: SuggestGroups;
  fallbacks: SuggestFallbacks;
};

export type TrendingResponse = {
  city_id: string | null;
  items: SuggestItem[];
};

export type ResolveResponse = {
  action: "redirect" | "serp";
  query: string;
  normalized_query: string;
  url: string | null;
  reason?: string | null;
};