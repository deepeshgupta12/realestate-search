"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiPost } from "@/lib/api";
import type { EventOk } from "@/lib/types";

export default function GoPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const url = sp.get("url") || "";
  const qid = sp.get("qid") || "";
  const entityId = sp.get("entity_id");
  const entityType = sp.get("entity_type");
  const rankStr = sp.get("rank");
  const cityId = sp.get("city_id");
  const contextUrl = sp.get("context_url");

  const [status, setStatus] = useState<string>("Click logged.");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!url) {
        setStatus("Missing target URL.");
        return;
      }

      try {
        await apiPost<EventOk>("/events/click", {
          query_id: qid || null,
          entity_id: entityId || null,
          entity_type: entityType || null,
          rank: rankStr ? Number(rankStr) : null,
          url,
          city_id: cityId || null,
          context_url: contextUrl || null,
          timestamp: new Date().toISOString(),
        });
      } catch (e: any) {
        if (!cancelled) setStatus(`Click logging failed (non-blocking): ${String(e?.message || e)}`);
      }

      if (!cancelled) {
        window.location.href = url;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, qid, entityId, entityType, rankStr, cityId, contextUrl]);

  return (
    <main style={{ padding: 24 }}>
      <h1>Go</h1>
      <div style={{ opacity: 0.8 }}>{status}</div>

      <pre style={{ marginTop: 16, padding: 16, border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8 }}>
{`Target URL: ${url || "(missing)"}
qid: ${qid || "(missing)"}
entity: ${entityType || "-"} / ${entityId || "-"}
rank: ${rankStr || "-"}
`}
      </pre>

      <button
        style={{ marginTop: 12, padding: "8px 12px" }}
        onClick={() => router.push("/")}
      >
        Back
      </button>
    </main>
  );
}
