interface Rating {
  categoryKey: string;
  categoryName: string;
  intensity: number;
  notes: string | null;
  evidenceLevel: string;
}

interface ContentProfileProps {
  ratings: Rating[];
}

const intensityColors = [
  "bg-intensity-0",
  "bg-intensity-1",
  "bg-intensity-2",
  "bg-intensity-3",
  "bg-intensity-4",
];

const evidenceBadge: Record<string, { label: string; className: string }> = {
  ai_inferred: {
    label: "AI",
    className: "bg-surface-alt text-muted",
  },
  cited: {
    label: "Cited",
    className: "bg-primary-light/20 text-primary-dark",
  },
  human_verified: {
    label: "Verified",
    className: "bg-primary/10 text-primary-dark",
  },
};

export function ContentProfile({ ratings }: ContentProfileProps) {
  if (ratings.length === 0) {
    return (
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Content Profile</h2>
        <div className="mt-4 rounded-lg border border-border bg-surface p-6 text-center">
          <p className="text-sm text-muted">No content profile yet.</p>
          <p className="mt-1 text-xs text-muted">
            Content ratings are added editorially and will appear here once
            available.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Content Profile</h2>
      <div className="mt-4 space-y-3">
        {ratings.map((rating) => {
          const badge = evidenceBadge[rating.evidenceLevel];
          return (
            <div key={rating.categoryKey}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {rating.categoryName}
                </span>
                <div className="flex items-center gap-2">
                  {badge && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  )}
                  <span className="text-xs text-muted">
                    {rating.intensity}/4
                  </span>
                </div>
              </div>
              <div className="mt-1 flex gap-1">
                {[0, 1, 2, 3].map((segment) => (
                  <div
                    key={segment}
                    className={`h-2 flex-1 rounded-full ${
                      segment < rating.intensity
                        ? intensityColors[rating.intensity]
                        : "bg-surface-alt"
                    }`}
                  />
                ))}
              </div>
              {rating.notes && (
                <p className="mt-1 text-xs text-muted">{rating.notes}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
