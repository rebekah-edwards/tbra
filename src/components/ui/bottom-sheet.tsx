"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragDelta = useRef(0);
  const dragStartTime = useRef(0);
  const isDragging = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle open/close with dismiss animation
  useEffect(() => {
    if (open) {
      setShouldRender(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else if (shouldRender) {
      // Animate out before unmounting
      setVisible(false);
      const timer = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timer);
    }
  }, [open, shouldRender]);

  // Lock body scroll when open
  useEffect(() => {
    if (shouldRender) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [shouldRender]);

  // Swipe-to-dismiss handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    dragStartTime.current = Date.now();
    dragDelta.current = 0;
    isDragging.current = true;
    if (panelRef.current) {
      panelRef.current.style.transition = "none";
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    // Only allow downward drag
    dragDelta.current = Math.max(0, delta);
    if (panelRef.current) {
      panelRef.current.style.transform = `translateY(${dragDelta.current}px)`;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const elapsed = Date.now() - dragStartTime.current;
    const velocity = dragDelta.current / elapsed; // px/ms

    if (panelRef.current) {
      panelRef.current.style.transition = "";
      panelRef.current.style.transform = "";
    }

    // Dismiss if dragged >100px or velocity >0.5px/ms
    if (dragDelta.current > 100 || velocity > 0.5) {
      onClose();
    }
    dragDelta.current = 0;
  }, [onClose]);

  if (!mounted || !shouldRender) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`absolute bottom-0 left-0 right-0 mx-auto max-w-[600px] max-h-[85vh] bg-surface border-t border-border rounded-t-2xl flex flex-col transition-transform duration-250 ease-out will-change-transform ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {/* Drag handle */}
        <div
          className="flex justify-center pt-2 pb-0 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="bottom-sheet-handle" />
        </div>

        {/* Sticky header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-alt transition-colors text-muted hover:text-foreground tap-scale"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto overflow-x-hidden flex-1 overscroll-contain">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
