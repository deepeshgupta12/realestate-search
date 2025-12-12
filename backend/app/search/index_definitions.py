from __future__ import annotations
from typing import Any, Dict, List

def index_settings() -> Dict[str, Any]:
    return {
        "settings": {
            "analysis": {
                "filter": {
                    "synonyms_re": {
                        "type": "synonym_graph",
                        "synonyms": [
                            "bhk, bedroom",
                            "society, gated community",
                            "builder floor, floor",
                            "rtm, ready to move, ready-to-move",
                            "uc, under construction, under-construction",
                            "rate, price, property rate, property rates",
                        ],
                    }
                },
                "analyzer": {
                    "folding": {"tokenizer": "standard", "filter": ["lowercase", "asciifolding"]},
                    "folding_syn": {"tokenizer": "standard", "filter": ["lowercase", "asciifolding", "synonyms_re"]},
                },
            }
        },
        "mappings": {
            "properties": {
                "id": {"type": "keyword"},
                "entity_type": {"type": "keyword"},
                "name": {"type": "text", "analyzer": "folding_syn"},
                "name_sayt": {"type": "search_as_you_type", "analyzer": "folding"},
                "aliases": {"type": "text", "analyzer": "folding_syn"},
                "city": {"type": "keyword"},
                "city_id": {"type": "keyword"},
                "parent_name": {"type": "keyword"},
                "canonical_url": {"type": "keyword"},
                "status": {"type": "keyword"},
                "popularity_score": {"type": "float"},
                "freshness_ts": {"type": "date"},
                "suggest": {"type": "completion"},
            }
        },
    }

def seed_docs() -> List[Dict[str, Any]]:
    return [
        {"id":"city_noida","entity_type":"city","name":"Noida","name_sayt":"Noida","aliases":["New Okhla Industrial Development Authority"],"city":"Noida","city_id":"city_noida","parent_name":"","canonical_url":"/noida","status":"active","popularity_score":90.0,"freshness_ts":"2025-01-01","suggest":{"input":["Noida"]}},
        {"id":"city_pune","entity_type":"city","name":"Pune","name_sayt":"Pune","aliases":["Poona"],"city":"Pune","city_id":"city_pune","parent_name":"","canonical_url":"/pune","status":"active","popularity_score":85.0,"freshness_ts":"2025-01-01","suggest":{"input":["Pune","Poona"]}},
        {"id":"loc_baner_pune","entity_type":"locality","name":"Baner","name_sayt":"Baner","aliases":["Baner Pune"],"city":"Pune","city_id":"city_pune","parent_name":"West Pune","canonical_url":"/pune/baner","status":"active","popularity_score":80.0,"freshness_ts":"2025-03-01","suggest":{"input":["Baner","Baner Pune"]}},
        {"id":"mm_sector150_noida","entity_type":"micromarket","name":"Sector 150","name_sayt":"Sector 150","aliases":["Sec 150"],"city":"Noida","city_id":"city_noida","parent_name":"Noida Expressway","canonical_url":"/noida/sector-150","status":"active","popularity_score":78.0,"freshness_ts":"2025-02-01","suggest":{"input":["Sector 150","Sec 150"]}},
        {"id":"rate_baner","entity_type":"rate_page","name":"Baner Property Rates","name_sayt":"Baner Property Rates","aliases":["Baner rates","Baner price trend"],"city":"Pune","city_id":"city_pune","parent_name":"Baner","canonical_url":"/property-rates/pune/baner","status":"active","popularity_score":60.0,"freshness_ts":"2025-04-01","suggest":{"input":["Baner property rates","Baner rates"]}},
        {"id":"proj_godrej_woods","entity_type":"project","name":"Godrej Woods","name_sayt":"Godrej Woods","aliases":["Godrej Woods Noida"],"city":"Noida","city_id":"city_noida","parent_name":"Sector 43","canonical_url":"/projects/noida/godrej-woods","status":"active","popularity_score":88.0,"freshness_ts":"2025-05-15","suggest":{"input":["Godrej Woods","Godrej Woods Noida"]}},
        {"id":"builder_dlf","entity_type":"builder","name":"DLF","name_sayt":"DLF","aliases":["DLF Limited"],"city":"","city_id":"","parent_name":"","canonical_url":"/builders/dlf","status":"active","popularity_score":95.0,"freshness_ts":"2025-01-01","suggest":{"input":["DLF","DLF Limited"]}},
        {"id":"pdp_resale_1","entity_type":"property_pdp","name":"2 BHK Resale Apartment in Baner","name_sayt":"2 BHK Resale Apartment in Baner","aliases":["2bhk baner resale"],"city":"Pune","city_id":"city_pune","parent_name":"Baner","canonical_url":"/pune/baner/resale/2-bhk-apartment-123","status":"active","popularity_score":40.0,"freshness_ts":"2025-06-01","suggest":{"input":["2 BHK Baner resale","2bhk baner resale"]}},
    ]
