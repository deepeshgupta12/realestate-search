import os

ELASTIC_URL = os.getenv("ELASTIC_URL", "http://localhost:9200")
ELASTIC_INDEX = os.getenv("ELASTIC_INDEX", "re_entities_v1")
