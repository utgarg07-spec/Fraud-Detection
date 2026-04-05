"use client";

import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { type UploadCSVResponse, uploadCSV } from "@/lib/api";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadCSVResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) {
      setFile(accepted[0]);
      setResult(null);
      setError(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"] },
    maxFiles: 1,
    multiple: false,
  });

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const r = await uploadCSV(file);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Upload data</h1>
        <p className="text-sm text-slate-500">
          Send a CSV to the backend; data is loaded into TigerGraph and scored.
        </p>
      </div>

      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-slate-100">CSV file</CardTitle>
          <CardDescription className="text-slate-500">
            Drag and drop or click to choose one file
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            {...getRootProps()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 transition-colors ${
              isDragActive
                ? "border-blue-500 bg-blue-500/10"
                : "border-slate-700 bg-slate-950/50 hover:border-slate-600"
            }`}
          >
            <input {...getInputProps()} />
            <UploadCloud className="mb-3 h-10 w-10 text-slate-500" />
            <p className="text-center text-sm text-slate-400">
              {isDragActive
                ? "Drop the file here…"
                : "Drop CSV here, or click to browse"}
            </p>
          </div>

          {file && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-300">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-400" />
              <span className="truncate font-medium">{file.name}</span>
              <span className="shrink-0 text-slate-500">
                ({(file.size / 1024).toFixed(1)} KB)
              </span>
            </div>
          )}

          <Button
            type="button"
            disabled={!file || uploading}
            onClick={handleUpload}
            className="w-full bg-blue-600 hover:bg-blue-500 sm:w-auto"
          >
            {uploading ? "Uploading…" : "Upload to FraudNet"}
          </Button>

          {uploading && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
                </span>
                Processing on server (TigerGraph + ML)…
              </div>
              <Skeleton className="h-2 w-full rounded-full bg-slate-800" />
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {result && !uploading && (
        <Card className="border-slate-800 bg-slate-900">
          <CardHeader>
            <CardTitle className="text-slate-100">Results</CardTitle>
            <CardDescription className="text-slate-500">
              Summary from POST /upload-csv
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-300">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <p className="text-xs text-slate-500">Rows processed</p>
                <p className="text-2xl font-semibold text-slate-100">
                  {result.total_rows.toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <p className="text-xs text-slate-500">Flagged</p>
                <p className="text-2xl font-semibold text-orange-400">
                  {result.flagged_count.toLocaleString()}
                </p>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-slate-500">
                Fraud types (counts)
              </p>
              <ul className="max-h-48 space-y-1 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs">
                {Object.entries(result.fraud_types).map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-4">
                    <span className="text-slate-400">{k}</span>
                    <span className="text-slate-200">{v}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-slate-500">
              Graph queries:{" "}
              {result.graph_queries_ok ? (
                <span className="text-emerald-400">ok</span>
              ) : (
                <span className="text-amber-400">some queries failed</span>
              )}
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-slate-100">Expected columns</CardTitle>
          <CardDescription className="text-slate-500">
            Your loader recognizes these optional fields (see backend docs)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs leading-relaxed text-slate-400">
          <p>
            <span className="font-medium text-slate-300">Users / accounts:</span>{" "}
            user_id, user_name, kyc_status, user_risk_score, account_id,
            account_type, created_date, balance
          </p>
          <p>
            <span className="font-medium text-slate-300">Transactions:</span>{" "}
            transaction_id, amount (or Kaggle Amount), timestamp / Time, status,
            risk_score, from_account, to_account
          </p>
          <p>
            <span className="font-medium text-slate-300">Graph extras:</span>{" "}
            device_id, device_type, os, ip_id, country, city, device_user_id,
            ip_user_id, shares_user_a, shares_user_b
          </p>
          <p className="pt-2 text-slate-500">
            Kaggle creditcard.csv works with synthetic transaction_id + Time +
            Amount; add account columns if you want money-flow edges in
            TigerGraph.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
