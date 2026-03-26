"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { BookshelfAnimation } from "./bookshelf-animation";
import { ImportOptionsUI } from "./import-options-ui";
import { DEFAULT_IMPORT_OPTIONS, type ImportOptions } from "@/lib/import/import-options";

type ImportState = "idle" | "uploading" | "done" | "error" | "cancelled";

interface ProgressEvent {
  type: "progress";
  current: number;
  total: number;
  title: string;
  status: "imported" | "existing" | "skipped" | "error";
  error?: string;
}

interface DoneEvent {
  type: "done";
  imported: number;
  existing: number;
  skipped: number;
  errors: { title: string; error: string }[];
}

export function StoryGraphImport() {
  const [state, setState] = useState<ImportState>("idle");
  const [progress, setProgress] = useState({ current: 0, total: 0, title: "" });
  const [result, setResult] = useState<DoneEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importOptions, setImportOptions] = useState<ImportOptions>({ ...DEFAULT_IMPORT_OPTIONS });
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);

  // Warn before leaving during import
  useEffect(() => {
    if (state !== "uploading") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state]);

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setState("cancelled");
  }, []);

  const resetToIdle = useCallback(() => {
    setState("idle");
    setResult(null);
    setErrorMessage("");
    setProgress({ current: 0, total: 0, title: "" });
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleImport = useCallback(async (file: File) => {
    setState("uploading");
    setProgress({ current: 0, total: 0, title: "" });
    setResult(null);
    setErrorMessage("");
    startTimeRef.current = Date.now();

    const controller = new AbortController();
    abortRef.current = controller;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("updateReadingStates", String(importOptions.updateReadingStates));
    formData.append("updateRatingsReviews", String(importOptions.updateRatingsReviews));
    formData.append("updateOwnedFormats", String(importOptions.updateOwnedFormats));

    try {
      const res = await fetch("/api/import/storygraph", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Import failed" }));
        setErrorMessage(body.error ?? "Import failed");
        setState("error");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setErrorMessage("Failed to read response stream");
        setState("error");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "progress") {
              const p = event as ProgressEvent;
              setProgress({ current: p.current, total: p.total, title: p.title });
            } else if (event.type === "done") {
              setResult(event as DoneEvent);
              setState("done");
            } else if (event.type === "error") {
              setErrorMessage(event.message ?? "Import failed");
              setState("error");
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      // If we didn't get a "done" event, still mark as done
      if (state === "uploading") {
        setState("done");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Already handled by handleCancel setting state to "cancelled"
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : "Network error");
      setState("error");
    } finally {
      abortRef.current = null;
    }
  }, [state]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleImport(file);
    },
    [handleImport]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".csv")) {
        handleImport(file);
      }
    },
    [handleImport]
  );

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <div className="border border-border bg-surface p-4 space-y-2">
        <h3 className="text-sm font-semibold">How to export from StoryGraph</h3>
        <ol className="text-xs text-muted space-y-1.5 list-decimal list-inside">
          <li>Go to <strong>StoryGraph</strong> &rarr; Manage Account</li>
          <li>Click <strong>Manage Your Data</strong></li>
          <li>Click <strong>Export StoryGraph Library</strong></li>
          <li>Upload the downloaded CSV below</li>
        </ol>
      </div>

      {/* Upload area */}
      {state === "idle" && (
        <>
          <ImportOptionsUI options={importOptions} onChange={setImportOptions} />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
              dragOver
                ? "border-accent bg-accent/5"
                : "border-border hover:border-accent/40"
            }`}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <svg className="mx-auto mb-3 text-muted" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-sm font-medium">
              Drop your StoryGraph CSV here
            </p>
            <p className="text-xs text-muted mt-1">or click to browse</p>
          </div>
          <p className="text-xs text-muted text-center">
            Imports typically take 1–3 seconds per book while we match your library.
          </p>

          {/* Limitations note */}
          <div className="border border-border/50 bg-surface-alt/50 p-3 space-y-1">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Not included in StoryGraph export</p>
            <ul className="text-xs text-muted space-y-0.5 list-disc pl-4">
              <li><strong>Top Shelf Reads</strong> — StoryGraph does not include shelf/list data in their CSV export</li>
              <li><strong>Up Next</strong> — priority queue info is not part of the export format</li>
            </ul>
            <p className="text-[10px] text-muted/70 mt-1">
              You can add these manually after import from each book&apos;s page.
            </p>
          </div>
        </>
      )}

      {/* Progress — full-screen bookshelf */}
      {state === "uploading" && (
        <BookshelfAnimation
          current={progress.current}
          total={progress.total}
          title={progress.title}
          startTime={startTimeRef.current}
          onCancel={handleCancel}
        />
      )}

      {/* Cancelled */}
      {state === "cancelled" && (
        <div className="border border-border bg-surface p-5 space-y-3">
          <p className="text-sm font-medium">
            Import cancelled after {progress.current} of {progress.total} books.
          </p>
          <p className="text-xs text-muted">
            Books already processed have been saved. You can re-import the same file &mdash; duplicates will be skipped.
          </p>
          <button
            onClick={resetToIdle}
            className="text-xs text-link hover:text-link/80 font-medium"
          >
            Start over
          </button>
        </div>
      )}

      {/* Results */}
      {state === "done" && result && (
        <div className="border border-border bg-surface p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xl text-purple-500">&#10003;</span>
            <h3 className="text-sm font-bold text-purple-500">Import Complete</h3>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-surface-alt p-3">
              <p className="text-lg font-bold font-heading text-purple-500">
                {result.imported}
              </p>
              <p className="text-[10px] text-muted uppercase tracking-wider">New Books</p>
            </div>
            <div className="bg-surface-alt p-3">
              <p className="text-lg font-bold font-heading text-foreground">
                {result.existing}
              </p>
              <p className="text-[10px] text-muted uppercase tracking-wider">Updated</p>
            </div>
            <div className="bg-surface-alt p-3">
              <p className="text-lg font-bold font-heading text-foreground">
                {result.errors.length}
              </p>
              <p className="text-[10px] text-muted uppercase tracking-wider">Errors</p>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div>
              <button
                onClick={() => setShowErrors(!showErrors)}
                className="text-xs text-link hover:text-link/80 font-medium"
              >
                {showErrors ? "Hide errors" : "Show errors"}
              </button>
              {showErrors && (
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-muted">
                      <span className="text-foreground font-medium">{e.title}</span> &mdash; {e.error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Import another */}
          <button
            onClick={resetToIdle}
            className="text-xs text-link hover:text-link/80 font-medium"
          >
            Import another file
          </button>
        </div>
      )}

      {/* Error */}
      {state === "error" && (
        <div className="border border-destructive/30 bg-destructive/5 p-5 space-y-3">
          <p className="text-sm font-medium text-destructive">{errorMessage}</p>
          <button
            onClick={resetToIdle}
            className="text-xs text-link hover:text-link/80 font-medium"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
