export type EntityType =
  | "city"
  | "micromarket"
  | "locality"
  | "listing_page"
  | "locality_overview"
  | "rate_page"
  | "project"
  | "builder"
  | "property_pdp"
  | string;

export type SuggestItem = {
  id: string;
  entity_type: EntityType;
  name: string;
  city: string;
  city_id: string;
  parent_name: string;
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

export type ResolveResponse =
  | {
      action: "redirect";
      query: string;
      normalized_query: string;
      url: string;
      match: SuggestItem;
      debug?: any;
    }
  | {
      action: "serp";
      query: string;
      normalized_query: string;
      reason: string;
    };

export type TrendingResponse = {
  city_id: string | null;
  items: SuggestItem[];
};
