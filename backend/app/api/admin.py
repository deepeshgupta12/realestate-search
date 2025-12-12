from fastapi import APIRouter, HTTPException
from app.core.es import get_es
from app.core.config import ELASTIC_INDEX
from app.search.index_definitions import index_settings, seed_docs

router = APIRouter(prefix="/admin", tags=["admin"])

@router.get("/ping-es")
def ping_es():
    es = get_es()
    try:
        info = es.info()
        return {"ok": True, "cluster_name": info.get("cluster_name"), "version": info.get("version", {}).get("number")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Elasticsearch not reachable: {e}")

@router.post("/create-index")
def create_index():
    es = get_es()
    if es.indices.exists(index=ELASTIC_INDEX):
        return {"ok": True, "message": f"Index {ELASTIC_INDEX} already exists"}
    es.indices.create(index=ELASTIC_INDEX, **index_settings())
    return {"ok": True, "message": f"Created index {ELASTIC_INDEX}"}

@router.post("/reset-index")
def reset_index():
    es = get_es()
    if es.indices.exists(index=ELASTIC_INDEX):
        es.indices.delete(index=ELASTIC_INDEX)
    es.indices.create(index=ELASTIC_INDEX, **index_settings())
    return {"ok": True, "message": f"Reset index {ELASTIC_INDEX}"}

@router.post("/seed")
def seed():
    es = get_es()
    if not es.indices.exists(index=ELASTIC_INDEX):
        raise HTTPException(status_code=400, detail=f"Index {ELASTIC_INDEX} does not exist. Call /admin/create-index first.")
    docs = seed_docs()
    ops = []
    for d in docs:
        ops.append({"index": {"_index": ELASTIC_INDEX, "_id": d["id"]}})
        ops.append(d)
    resp = es.bulk(operations=ops, refresh=True)
    if resp.get("errors"):
        raise HTTPException(status_code=500, detail={"message": "Bulk seed had errors", "resp": resp})
    count = es.count(index=ELASTIC_INDEX)["count"]
    return {"ok": True, "seeded": len(docs), "index_count": count}
