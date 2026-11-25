"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

/**
 * "Share your review" — shown right after a reader posts a review (web twin
 * of the iOS sheet). The image is their own review rendered as a 1080×1920
 * story card by /api/share/review. Share uses the system share sheet with the
 * image file where the browser supports it; Save downloads the PNG.
 */
export function ReviewShareSheet({ bookId, bookTitle, onClose }: { bookId: string; bookTitle?: string; onClose: () => void }) {
  const [src] = useState(() => `/api/share/review?book=${encodeURIComponent(bookId)}&t=${Date.now()}`);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(src)
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => {
        if (cancelled) return;
        setBlob(b);
        try {
          const file = new File([b], "my-tbra-review.png", { type: "image/png" });
          setCanShareFiles(!!navigator.canShare?.({ files: [file] }));
        } catch {}
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [src]);

  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const share = async () => {
    if (!blob) return;
    const file = new File([blob], "my-tbra-review.png", { type: "image/png" });
    try {
      await navigator.share({ files: [file], title: bookTitle ? `My review of ${bookTitle}` : "My review" });
    } catch {
      /* cancelled */
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-4 sm:items-center" onClick={onClose}>
      <div className="card-hairline w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Share your review">
        <p className="eyebrow">Review posted</p>
        <h2 className="mt-1 font-heading text-lg font-bold text-foreground">Share your review</h2>
        <div className="mt-4 flex justify-center">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Your review as a shareable image" className="h-[52vh] max-h-[460px] w-auto rounded-2xl shadow-xl" />
          ) : failed ? (
            <p className="py-10 text-sm text-muted">Couldn&apos;t make the image right now.</p>
          ) : (
            <div className="flex h-[52vh] max-h-[460px] w-[29vh] max-w-[259px] items-center justify-center rounded-2xl border border-foreground/10 bg-surface/60">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted/30 border-t-foreground" />
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center justify-center gap-2">
          {canShareFiles && (
            <button type="button" onClick={share} className="btn-lime px-5 py-2 text-sm">
              Share
            </button>
          )}
          {url && (
            <a href={url} download="my-tbra-review.png" className={`${canShareFiles ? "btn-glass" : "btn-lime"} px-5 py-2 text-sm`}>
              Save image
            </a>
          )}
          <button type="button" onClick={onClose} className="btn-glass px-5 py-2 text-sm">
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
