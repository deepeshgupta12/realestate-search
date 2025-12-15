"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export default function GoPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const [logged, setLogged] = useState(false);

  const payload = useMemo(() => {
    const url = sp.get("url") || "";
    const qid = sp.get("qid") || "";
    const entity_id = sp.get("entity_id");
    const entity_type = sp.get("entity_type");
    const rank = sp.get("rank");
    const city_id = sp.get("city_id");
    const context_url = sp.get("context_url");

    return {
      url,
      qid,
      entity_id,
      entity_type,
      rank: rank ? Number(rank) : null,
      city_id,
      context_url,
    };
  }, [sp]);

  useEffect(() => {
    let cancelled = false;

    async function logClick() {
      if (!payload.url || !payload.qid || !payload.entity_id || !payload.entity_type || !payload.rank) {
        setLogged(true);
        return;
      }

      try {
        await fetch(`${API_BASE}/api/v1/events/click`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query_id: payload.qid,
            entity_id: payload.entity_id,
            entity_type: payload.entity_type,
            rank: payload.rank,
            url: payload.url,
            city_id: payload.city_id || null,
            context_url: payload.context_url || null,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch {
        // never block UX
      } finally {
        if (!cancelled) setLogged(true);
      }
    }

    logClick();
    return () => {
      cancelled = true;
    };
  }, [payload]);

  // Keep /go as a “safe” destination (your demo pages may not exist yet).
  // User can click through to canonical_url if they want.
  const canNavigate = payload.url && payload.url.startsWith("/") && payload.url !== "/go";

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 18, fontWeight: 700 }}>Go</h1>
      <p style={{ marginTop: 8 }}>
        {logged ? "Click logged." : "Logging click…"}
      </p>

      <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
        <div><b>Target URL:</b> {payload.url || "(missing)"}</div>
        <div style={{ marginTop: 6 }}><b>qid:</b> {payload.qid || "(missing)"}</div>
        <div style={{ marginTop: 6 }}><b>entity:</b> {payload.entity_type || "-"} / {payload.entity_id || "-"}</div>
        <div style={{ marginTop: 6 }}><b>rank:</b> {payload.rank ?? "-"}</div>
      </div>

      {canNavigate ? (
        <button
          style={{ marginTop: 16, padding: "10px 14px", borderRadius: 8, background: "black", color: "white" }}
          onClick={() => router.push(payload.url)}
        >
          Continue to destination
        </button>
      ) : null}
    </div>
  );
}