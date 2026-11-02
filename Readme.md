# Real Estate Search (Local) — V0 (Elastic‑powered navigation search) 🚀

A local, end‑to‑end **navigation search** prototype for a real‑estate website/app: **autocomplete → typo correction → resolve → SERP → click logging**, built on **Elasticsearch + FastAPI + Next.js**.

This repository is being developed in **versions (V0 → V4)**. This README documents the **V0 locked scope + what’s implemented today**, and a clear roadmap for upcoming versions.

---

## 1) Problem statement 🧩

Real‑estate discovery journeys have a common friction:

- Users *know what they want*, but the site’s navigation requires multiple clicks (city → locality → filters → etc.).
- Names are ambiguous (**Baner Pune vs Baner Noida**), misspelled (**banre**), or expressed as natural phrases (**“2 bhk in baner under 80L”**).
- Even when results exist, users still get dropped into generic pages with no “best next step” routing.

**Goal of this project:** build a single search surface that can **understand what the user meant** and **take them to the correct destination** with minimum friction.

---

## 2) Solution overview ✅

V0 ships an Elastic‑backed pipeline with these capabilities:

### A) Global search UX (Next.js)
- Header **Search Bar** with autocomplete dropdown (grouped by entity type)
- **Zero‑state** (when input is focused but empty): trending + popular + recent searches
- **/go** route that always uses backend **resolve** logic (keeps routing centralized)
- **SERP page** (/search): grouped sections, did‑you‑mean, and fallback UX
- **Disambiguation page** (/disambiguate) for same‑name entities

### B) Backend search services (FastAPI + Elasticsearch)
- Single ES index: `re_entities_v1`
- Entity types covered in V0:
  - cities, micromarkets, localities
  - locality overview, rate pages
  - project detail pages
  - property PDPs (resale/rental)
  - builders
- APIs:
  - `/api/v1/search/suggest` → grouped suggestions + typo hints
  - `/api/v1/search` → SERP grouped results + did‑you‑mean + fallbacks
  - `/api/v1/search/resolve` → redirect vs SERP vs disambiguate + clean URL handling
  - `/api/v1/search/zero-state` → trending/popular/recent searches payload
  - `/api/v1/events/search` and `/api/v1/events/click` → JSONL logs for future ranking/personalization

---

## 3) Locked scope (version‑wise) 📌

### V0 — Elastic‑powered navigation search + UI (MVP)
**Backend**
- Single index `re_entities_v1`
- Lexical search (BM25 + fuzziness)
- Basic synonyms/aliases (string fields; no heavy ML)
- Suggest API (grouped by entity type)
- Resolver:
  - direct navigation vs SERP vs disambiguation
  - no‑results fallback (relaxed + trending)
  - clean URL / slug normalization + redirect registry
- Zero‑state:
  - trending + popular + recent searches
- Events logging:
  - `/events/search`
  - `/events/click`

**Frontend**
- Global search bar + autocomplete dropdown
- Zero‑state block (trending / popular / recents)
- SERP with grouped results + did‑you‑mean + no‑results UX
- Disambiguation page for same‑named entities
- `/go` route which calls `/search/resolve` and redirects accordingly

---

### V1 — Stronger NLP / intent + constraint routing
- Better intent classification (locality vs overview vs rate page vs project vs builder)
- Rate intent detection (“property rates”, “price trends”)
- Constraint parsing: BHK, budget, status, property type (and more)
- Routing to Listing/DSE URLs when constraint‑heavy
- City context biasing + auto‑resolve same‑name entities
- Redirect registry / aliases moved into DB/config (not hard‑coded)

### V2 — Semantic retrieval (Hybrid: BM25 + embeddings)
- Dense vectors in ES (`dense_vector` / kNN)
- Hybrid retrieval (BM25 + vector) merged via RRF / score blending
- Better handling of natural language queries
- Smarter synonyms from offline pipeline

### V3 — Transformer reranker
- Cross‑encoder reranker over top‑N candidates
- Much better ordering for ambiguous queries
- Response‑time aware setup (quantized local model)

### V4 — LTR + advanced personalization
- Learning‑to‑rank with features from click logs, lead logs, popularity, recency, affinity, device
- Personalization by recent city/locality preference + session context
- Offline evaluation harness (NDCG/MRR + business metrics)

---

## 4) What’s implemented in V0 today ✅

### Backend (FastAPI)
- `re_entities_v1` index creation + seed data
- `/api/v1/search/suggest`
- `/api/v1/search` (SERP results + `did_you_mean` via ES suggesters + fallback blocks)
- `/api/v1/search/resolve`
  - constraint‑heavy detection (first version)
  - disambiguation for same‑name entities
  - city‑scoped auto‑resolve
  - clean URL resolution + redirect registry
- `/api/v1/search/zero-state`
  - trending + popular + recent searches (from event log)
- Event logging:
  - `/api/v1/events/search` → JSONL append
  - `/api/v1/events/click` → JSONL append
- Recent loader + integrity checks (no manual eyeballing)

### Frontend (Next.js App Router)
- `SearchBar` component
  - zero‑state on focus
  - suggest on keystrokes
  - enter → `/go?q=...` (resolve)
  - suggestion click → `/go?url=...` (logs click)
- SERP page (`/search`) rendering grouped sections + fallback UX
- Disambiguation page (`/disambiguate`) rendering candidates + click logging
- `/go` route performing server‑side resolve and redirecting accordingly

---

## 5) Architecture (V0) 🏗️

```text
[User types] → Next.js SearchBar
     ├─ (empty) → /search/zero-state  → backend /api/v1/search/zero-state
     ├─ (typing) → /search/suggest    → backend /api/v1/search/suggest
     └─ (enter/click) → /go → backend /api/v1/search/resolve
                         ├─ redirect → entity URL / listing URL
                         ├─ serp → /search?q=...
                         └─ disambiguate → /disambiguate?q=...
``

Event logging (V0):
- Each search submission logs to `backend/.events/search.jsonl`
- Each click logs to `backend/.events/click.jsonl`

These logs become training data for V4 (LTR/personalization).

---

## 6) Local setup & run instructions 🧪

### A) Start infra (Elasticsearch, Kibana, Postgres)
From repo root:

```bash
cd infra
docker compose up -d
```

Elasticsearch: `http://localhost:9200`  
Kibana: `http://localhost:5601`  
Postgres: `localhost:5432` (not used in V0 yet; reserved for future phases)

### B) Start backend (FastAPI)
From repo root:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# start server
uvicorn app.main:app --reload --port 8000
```

### C) Create index + seed demo entities
```bash
curl -s -X POST "http://localhost:8000/api/v1/admin/create-index" | python -m json.tool
curl -s -X POST "http://localhost:8000/api/v1/admin/seed" | python -m json.tool
```

### D) Start frontend (Next.js)
```bash
cd frontend
npm install
npm run dev
```

Open: `http://localhost:3000`

---

## 7) API quick reference (V0) 🔌

### Admin
```bash
curl -s -X POST "http://localhost:8000/api/v1/admin/create-index" | python -m json.tool
curl -s -X POST "http://localhost:8000/api/v1/admin/seed" | python -m json.tool
```

### Zero‑state
```bash
curl -s "http://localhost:8000/api/v1/search/zero-state?limit=8" | python -m json.tool
curl -s "http://localhost:8000/api/v1/search/zero-state?limit=8&city_id=city_pune" | python -m json.tool
```

### Suggest
```bash
curl -s "http://localhost:8000/api/v1/search/suggest?q=baner&limit=10" | python -m json.tool
```

### SERP search
```bash
curl -s "http://localhost:8000/api/v1/search?q=baner&limit=10" | python -m json.tool
```

### Resolve (routing brain)
```bash
curl -s "http://localhost:8000/api/v1/search/resolve?q=baner&context_url=/" | python -m json.tool
curl -s "http://localhost:8000/api/v1/search/resolve?q=baner&city_id=city_pune&context_url=/pune" | python -m json.tool
```

### Event logging
Search:
```bash
curl -s -X POST "http://localhost:8000/api/v1/events/search" \
  -H "Content-Type: application/json" \
  -d '{"query_id":"qid_test","raw_query":"baner","normalized_query":"baner","city_id":null,"context_url":"/","timestamp":"2025-12-18T00:00:00.000Z"}' \
  | python -m json.tool
```

Click:
```bash
curl -s -X POST "http://localhost:8000/api/v1/events/click" \
  -H "Content-Type: application/json" \
  -d '{"query_id":"qid_test","entity_id":"loc_baner_pune","entity_type":"locality","rank":1,"url":"/pune/baner","city_id":"city_pune","context_url":"/","timestamp":"2025-12-18T00:00:05.000Z"}' \
  | python -m json.tool
```

Logs location (V0):
```bash
tail -n 5 backend/.events/search.jsonl
tail -n 5 backend/.events/click.jsonl
```

---

## 8) Repository layout 🗂️

```text
.
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app + search APIs + events
│   │   └── events/
│   │       ├── store.py            # JSONL append store
│   │       └── recent.py           # recent searches loader + utilities
│   └── .events/                    # runtime logs (gitignored)
├── frontend/
│   └── src/
│       ├── app/                    # Next.js routes (/go, /search, /disambiguate)
│       └── components/
│           └── SearchBar.tsx        # UI: zero-state + suggest + resolve
├── infra/                          # docker-compose (ES/Kibana/Postgres)
└── docs/                           # design/notes (evolves over time)
```

---

## 9) “Is GitHub up‑to‑date?” verification steps ✅

I can’t directly access your private GitHub from here, but you can verify locally (reliable + deterministic). Run these from repo root:

```bash
# 1) Confirm clean working tree
git status

# 2) Fetch latest remote refs
git fetch --all --prune

# 3) Confirm your current branch
git branch --show-current

# 4) Confirm your local HEAD == remote HEAD
BR=$(git branch --show-current)
git rev-parse HEAD
git rev-parse origin/$BR

# 5) Confirm no unpushed commits (should print nothing)
git log --oneline origin/$BR..HEAD

# 6) Confirm no local changes vs remote (should print nothing)
git diff --name-only origin/$BR..HEAD
```

If (5) prints commits, push them:
```bash
git push origin $(git branch --show-current)
```

Optional: tag the V0 milestone for future rollbacks:
```bash
git tag -a v0 -m "V0: Elastic navigation search + UI"
git push origin v0
```

---

## 10) V0 completion checklist 🧾

- [x] Index + seed + ES connectivity
- [x] Suggest API (grouped entities) + typo correction
- [x] SERP API + UI grouping + fallback UX
- [x] Resolve API + `/go` route integration
- [x] Disambiguation UI
- [x] Zero‑state (trending + popular + recent)
- [x] Events logging (search + click)
- [x] Quick integrity checks script (no manual eyeballing)

---

## 11) Next: V1 plan 🔜

V1 focuses on **better intent + better constraint routing**:

- Detect “rate intent” vs “overview intent” vs “project intent” more reliably
- Robust extraction of constraints (BHK, budget, status, type, etc.)
- Stronger “listing URL builder” to route users to filtered DSE pages
- City context persistence + personalization scaffolding

---

## License / Usage 📄
MIT © 2025 Deepesh Kumar Gupta. See [LICENSE](LICENSE) for details. Internal prototype intended for local development.
