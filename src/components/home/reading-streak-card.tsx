interface ReadingStreakCardProps {
  streak: { currentStreak: number; longestStreak: number; unit: "days" };
}

export function ReadingStreakCard({ streak }: ReadingStreakCardProps) {
  const hasStreak = streak.currentStreak > 0;

  return (
    <div className="rounded-xl border border-neon-purple/20 bg-gradient-to-br from-surface to-surface-alt p-4 lg:px-6">
      <p className="text-xs font-medium text-muted mb-2">tbr streak</p>
      <div className="flex items-center gap-3">
        <span className="text-3xl">{hasStreak ? "🔥" : "📚"}</span>
        <div>
          <p className="text-lg font-bold font-heading">
            {streak.currentStreak}{" "}
            <span className="text-sm font-normal text-muted">
              {streak.currentStreak === 1 ? "day" : "days"}
            </span>
          </p>
          <p className="text-xs text-muted">
            {hasStreak
              ? `Best: ${streak.longestStreak} ${streak.longestStreak === 1 ? "day" : "days"}`
              : "Read or log something to start!"}
          </p>
        </div>
      </div>
      <p className="text-[10px] text-muted/60 mt-2">Any reading activity keeps your streak alive</p>
    </div>
  );
}
