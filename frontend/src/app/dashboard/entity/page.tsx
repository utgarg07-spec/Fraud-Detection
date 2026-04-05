"use client";

import { Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getEntity } from "@/lib/api";

export default function EntitySearchPage() {
  const [id, setId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Awaited<
    ReturnType<typeof getEntity>
  > | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = id.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    try {
      const p = await getEntity(trimmed);
      setProfile(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Entity search</h1>
        <p className="text-sm text-slate-500">
          Load an Account profile and 2-hop neighborhood from TigerGraph.
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
        <Input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Account entity ID"
          className="border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-600"
        />
        <Button
          type="submit"
          disabled={loading || !id.trim()}
          className="shrink-0 gap-2 bg-blue-600 hover:bg-blue-500"
        >
          <Search className="h-4 w-4" />
          Search
        </Button>
      </form>

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-32 rounded-xl bg-slate-800" />
          <Skeleton className="h-48 rounded-xl bg-slate-800" />
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {profile && !loading && (
        <div className="space-y-4">
          <Card className="border-slate-800 bg-slate-900">
            <CardHeader>
              <CardTitle className="font-mono text-slate-100">
                {profile.entity_id}
              </CardTitle>
              <CardDescription className="text-slate-500">
                Type: {profile.entity_type}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-300">
              {profile.risk_score != null && (
                <p>
                  <span className="text-slate-500">Risk score:</span>{" "}
                  <span className="font-medium text-orange-300">
                    {profile.risk_score.toFixed(2)}
                  </span>
                </p>
              )}
              {profile.flagged != null && (
                <p>
                  <span className="text-slate-500">Flagged:</span>{" "}
                  {profile.flagged ? "Yes" : "No"}
                </p>
              )}
              {profile.fraud_types?.length ? (
                <p>
                  <span className="text-slate-500">Fraud types:</span>{" "}
                  {profile.fraud_types.join(", ")}
                </p>
              ) : null}
              {profile.explanation && (
                <p className="text-slate-400">{profile.explanation}</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900">
            <CardHeader>
              <CardTitle className="text-slate-100">Neighborhood</CardTitle>
              <CardDescription className="text-slate-500">
                Raw API payload (nodes & edges)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-400">
                {JSON.stringify(profile.neighborhood, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
