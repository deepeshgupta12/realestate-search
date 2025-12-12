export type SearchEntityType =
  | "city"
  | "micromarket"
  | "locality"
  | "listing_page"
  | "locality_overview"
  | "rate_page"
  | "project"
  | "property_pdp"
  | "builder";

export type SuggestItem = {
  id: string;
  entity_type: SearchEntityType;
  name: string;
  city?: string;
  city_id?: string;
  parent_name?: string;
  canonical_url: string;
  score?: number;
};

export type SuggestResponse = {
  q: string;
  normalized_q: string;
  did_you_mean: string | null;
  groups: {
    locations: SuggestItem[];
    projects: SuggestItem[];
    builders: SuggestItem[];
    rate_pages: SuggestItem[];
    property_pdps: SuggestItem[];
  };
};

export type ResolveResponse =
  | {
      action: "redirect";
      query: string;
      normalized_query: string;
      url: string;
      match: SuggestItem;
      debug?: unknown;
    }
  | {
      action: "disambiguate";
      query: string;
      normalized_query: string;
      candidates: SuggestItem[];
      debug?: unknown;
    }
  | {
      action: "serp";
      query: string;
      normalized_query: string;
      reason: string;
      debug?: unknown;
    };

export type SearchResponse = {
  q: string;
  normalized_q: string;
  did_you_mean: string | null;
  groups: {
    locations: SuggestItem[];
    projects: SuggestItem[];
    builders: SuggestItem[];
    rate_pages: SuggestItem[];
    property_pdps: SuggestItem[];
  };
  fallbacks: {
    relaxed_used: boolean;
    reason: string | null;
    trending: Array<{
      id: string;
      entity_type: SearchEntityType;
      name: string;
      city?: string;
      city_id?: string;
      parent_name?: string;
      canonical_url: string;
      popularity_score?: number;
    }>;
  };
};
