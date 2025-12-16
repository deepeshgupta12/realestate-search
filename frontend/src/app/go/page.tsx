"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000/api/v1";

type ClickPayload = {
  query_id: string;
  entity_id: string;
  entity_type: string;
  rank: number;
  url: string;
  city_id?: string | null;
  context_url?: string | null;
  timestamp: string;
};

export default function GoPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [status, setStatus] = useState<"idle" | "logging" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(() => {
    const url = sp.get("url") ?? "";
    const qid = sp.get("qid") ?? "";
    const entityId = sp.get("entity_id") ?? "";
    const entityType = sp.get("entity_type") ?? "";
    const rankStr = sp.get("rank") ?? "";
    const cityId = sp.get("city_id");
    const contextUrl = sp.get("context_url");

    const rank = Number(rankStr || "0");

    return {
      url,
      qid,
      entityId,
      entityType,
      rank,
      cityId,
      contextUrl,
    };
  }, [sp]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setStatus("logging");
      setError(null);

      // Hard requirement: we need at least a url to redirect.
      if (!params.url) {
        setStatus("error");
        setError("Missing url param. /go needs ?url=...");
        return;
      }

      // Click logging is best-effort; if missing metadata, still redirect.
      const canLog =
        Boolean(params.qid) &&
        Boolean(params.entityId) &&
        Boolean(params.entityType) &&
        Number.isFinite(params.rank) &&
        params.rank > 0;

      if (canLog) {
        const payload: ClickPayload = {
          query_id: params.qid,
          entity_id: params.entityId,
          entity_type: params.entityType,
          rank: params.rank,
          url: params.url,
          city_id: params.cityId ?? null,
          context_url: params.contextUrl ?? null,
          timestamp: new Date().toISOString(),
        };

        try {
          await fetch(`${API_BASE}/events/click`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        } catch (e: any) {
          // best-effort; don't block redirect
          if (!cancelled) {
            setError(`Click logging failed (continuing redirect): ${e?.message ?? String(e)}`);
          }
        }
      }

      if (cancelled) return;

      setStatus("done");

      // Redirect (internal vs external)
      if (params.url.startsWith("/")) {
        router.replace(params.url);
      } else {
        window.location.assign(params.url);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [params, router]);

  // Minimal debug UI (you’ll barely see it if redirect is instant)
  return (
    <div style={{ padding: 24 }}>
      <h1>Go</h1>
      <p>{status === "logging" ? "Logging click…" : status === "done" ? "Redirecting…" : "Ready"}</p>

      <div style={{ marginTop: 12, opacity: 0.9 }}>
        <div>Target URL: {params.url || "(missing)"}</div>
        <div>qid: {params.qid || "(missing)"}</div>
        <div>
          entity: {params.entityType || "-"} / {params.entityId || "-"}
        </div>
        <div>rank: {params.rank || "-"}</div>
      </div>

      {status === "error" && <p style={{ marginTop: 12 }}>Error: {error}</p>}
      {error && status !== "error" && <p style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}