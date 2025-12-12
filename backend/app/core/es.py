from elasticsearch import Elasticsearch
from app.core.config import ELASTIC_URL

_es: Elasticsearch | None = None

def get_es() -> Elasticsearch:
    global _es
    if _es is None:
        _es = Elasticsearch(ELASTIC_URL)
    return _es
