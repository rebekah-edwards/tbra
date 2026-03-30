"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const PARTICLE_COUNT = 24;
const COLORS = ["#a3e635", "#38bdf8", "#c084fc", "#facc15", "#fb923c", "#f87171"];

interface Particle {
  id: number;
  x: number;
  color: string;
  delay: number;
  drift: number;
  size: number;
}

function generateParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    x: 30 + Math.random() * 40, // 30-70% of viewport width
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    delay: Math.random() * 400,
    drift: -50 + Math.random() * 100, // horizontal drift
    size: 4 + Math.random() * 6,
  }));
}

export function Confetti({ onDone }: { onDone: () => void }) {
  const [particles] = useState(generateParticles);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const timer = setTimeout(onDone, 2200);
    return () => clearTimeout(timer);
  }, [onDone]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      {particles.map((p) => (
        <div
          key={p.id}
          className="confetti-particle"
          style={{
            "--x": `${p.x}vw`,
            "--drift": `${p.drift}px`,
            "--size": `${p.size}px`,
            "--delay": `${p.delay}ms`,
            backgroundColor: p.color,
          } as React.CSSProperties}
        />
      ))}
    </div>,
    document.body
  );
}
