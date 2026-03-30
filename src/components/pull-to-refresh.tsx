"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const PULL_THRESHOLD = 80;
const MAX_PULL = 120;

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const pulling = useRef(false);

  // Use refs for handlers to avoid re-attaching listeners on every state change
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;
  const pullDistanceRef = useRef(pullDistance);
  pullDistanceRef.current = pullDistance;

  useEffect(() => {
    function handleTouchStart(e: TouchEvent) {
      if (window.scrollY > 5) return;
      touchStartY.current = e.touches[0].clientY;
      pulling.current = true;
    }

    function handleTouchMove(e: TouchEvent) {
      if (!pulling.current || refreshingRef.current) return;
      const deltaY = e.touches[0].clientY - touchStartY.current;
      if (deltaY < 0) {
        pulling.current = false;
        setPullDistance(0);
        return;
      }
      const dampened = Math.min(deltaY * 0.5, MAX_PULL);
      setPullDistance(dampened);
    }

    function handleTouchEnd() {
      if (!pulling.current) return;
      pulling.current = false;

      if (pullDistanceRef.current >= PULL_THRESHOLD && !refreshingRef.current) {
        setRefreshing(true);
        setPullDistance(PULL_THRESHOLD * 0.6);
        router.refresh();
        setTimeout(() => {
          setRefreshing(false);
          setPullDistance(0);
        }, 800);
      } else {
        setPullDistance(0);
      }
    }

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", handleTouchEnd);
    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [router]);

  const progress = Math.min(pullDistance / PULL_THRESHOLD, 1);
  const rotation = refreshing ? 360 : progress * 270;

  return (
    <>
      {/* Pull indicator */}
      <div
        className="pull-indicator fixed top-0 left-0 right-0 z-[60] flex justify-center pointer-events-none"
        style={{
          transform: `translateY(${pullDistance > 0 ? pullDistance - 30 : -40}px)`,
          opacity: pullDistance > 10 ? progress : 0,
        }}
      >
        <div className={`flex items-center justify-center w-9 h-9 rounded-full bg-surface border border-border shadow-lg ${refreshing ? "animate-spin" : ""}`}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="text-accent"
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        </div>
      </div>
      {children}
    </>
  );
}
