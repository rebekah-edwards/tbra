"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  flickerSpeed: number;
  flickerPhase: number;
}

/**
 * SpoilerParticles — canvas overlay that draws independent twinkling
 * particles over every unrevealed `.spoiler-tag` inside a container.
 *
 * Uses getClientRects() so it correctly covers inline spans that wrap
 * across multiple lines.
 */
export function SpoilerParticles({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const particlesRef = useRef<Map<Element, Particle[]>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const DENSITY = 0.025; // particles per square pixel
    const SPEED = 0.35;
    const PAD = 2; // px padding around each rect so particles aren't smushed

    function getExpandedRects(el: Element) {
      const rects = el.getClientRects();
      const containerRect = container!.getBoundingClientRect();
      const bounds: { x: number; y: number; w: number; h: number }[] = [];
      for (const rect of rects) {
        bounds.push({
          x: rect.left - containerRect.left - PAD,
          y: rect.top - containerRect.top - PAD,
          w: rect.width + PAD * 2,
          h: rect.height + PAD * 2,
        });
      }
      return bounds;
    }

    function createParticlesForElement(el: Element): Particle[] {
      const bounds = getExpandedRects(el);
      const particles: Particle[] = [];

      for (const b of bounds) {
        const count = Math.floor(b.w * b.h * DENSITY);

        for (let i = 0; i < count; i++) {
          particles.push({
            x: b.x + Math.random() * b.w,
            y: b.y + Math.random() * b.h,
            vx: (Math.random() - 0.5) * SPEED * 2,
            vy: (Math.random() - 0.5) * SPEED * 2,
            size: 0.4 + Math.random() * 0.7,
            opacity: 0.2 + Math.random() * 0.5,
            flickerSpeed: 2 + Math.random() * 4,
            flickerPhase: Math.random() * Math.PI * 2,
          });
        }
      }
      return particles;
    }

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = container!.offsetWidth * dpr;
      canvas!.height = container!.offsetHeight * dpr;
      canvas!.style.width = container!.offsetWidth + "px";
      canvas!.style.height = container!.offsetHeight + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function initParticles() {
      particlesRef.current.clear();
      const spoilers = container!.querySelectorAll(
        ".spoiler-tag:not(.revealed)"
      );
      spoilers.forEach((el) => {
        particlesRef.current.set(el, createParticlesForElement(el));
      });
    }

    resizeCanvas();
    initParticles();

    // Get theme for particle color
    function getParticleColor() {
      const theme = document.documentElement.getAttribute("data-theme");
      return theme === "light"
        ? { r: 0, g: 0, b: 0 }
        : { r: 255, g: 255, b: 255 };
    }

    let time = 0;
    function animate() {
      time += 0.016; // ~60fps
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      const color = getParticleColor();

      particlesRef.current.forEach((particles, el) => {
        // Skip revealed spoilers
        if (el.classList.contains("revealed")) return;

        const bounds = getExpandedRects(el);
        if (bounds.length === 0) return;

        particles.forEach((p) => {
          // Move
          p.x += p.vx;
          p.y += p.vy;

          // Bounce within the correct rect bounds
          let inBounds = false;
          for (const b of bounds) {
            if (
              p.x >= b.x &&
              p.x <= b.x + b.w &&
              p.y >= b.y &&
              p.y <= b.y + b.h
            ) {
              inBounds = true;
              // Bounce off edges
              if (p.x <= b.x || p.x >= b.x + b.w) p.vx *= -1;
              if (p.y <= b.y || p.y >= b.y + b.h) p.vy *= -1;
              break;
            }
          }

          // If particle escaped its bounds, teleport back into a random rect
          if (!inBounds) {
            const b = bounds[Math.floor(Math.random() * bounds.length)];
            p.x = b.x + Math.random() * b.w;
            p.y = b.y + Math.random() * b.h;
            p.vx = (Math.random() - 0.5) * SPEED * 2;
            p.vy = (Math.random() - 0.5) * SPEED * 2;
          }

          // Flicker opacity
          const flicker =
            Math.sin(time * p.flickerSpeed + p.flickerPhase) * 0.3 + 0.7;
          const alpha = p.opacity * flicker;

          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
          ctx!.fill();
        });
      });

      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);

    // Re-init on resize
    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      initParticles();
    });
    resizeObserver.observe(container);

    // Watch for reveal/un-reveal clicks
    const mutationObserver = new MutationObserver(() => {
      // Remove particles for revealed spoilers
      particlesRef.current.forEach((_, el) => {
        if (el.classList.contains("revealed")) {
          particlesRef.current.delete(el);
        }
      });
      // Re-create particles for un-revealed spoilers
      const spoilers = container!.querySelectorAll(
        ".spoiler-tag:not(.revealed)"
      );
      spoilers.forEach((el) => {
        if (!particlesRef.current.has(el)) {
          particlesRef.current.set(el, createParticlesForElement(el));
        }
      });
    });
    mutationObserver.observe(container, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [containerRef]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}
