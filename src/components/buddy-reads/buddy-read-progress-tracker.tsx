"use client";

import Image from "next/image";

interface MemberProgress {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  readingState: "not_started" | "currently_reading" | "finished";
  percentComplete: number;
  completionDate: string | null;
}

interface BuddyReadProgressTrackerProps {
  members: MemberProgress[];
}

function sortMembers(members: MemberProgress[]): MemberProgress[] {
  return [...members].sort((a, b) => {
    // Completed first
    if (a.readingState === "finished" && b.readingState !== "finished") return -1;
    if (a.readingState !== "finished" && b.readingState === "finished") return 1;

    // Then by percent DESC
    if (a.percentComplete !== b.percentComplete) {
      return b.percentComplete - a.percentComplete;
    }

    // Not started last
    if (a.readingState === "not_started" && b.readingState !== "not_started") return 1;
    if (a.readingState !== "not_started" && b.readingState === "not_started") return -1;

    return 0;
  });
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function BuddyReadProgressTracker({ members }: BuddyReadProgressTrackerProps) {
  const sorted = sortMembers(members);

  return (
    <div className="flex flex-col gap-3.5 rounded-[18px] border border-foreground/10 bg-surface/60 p-4 backdrop-blur-md">
      {sorted.map((member) => (
        <div key={member.userId} className="flex items-center gap-3">
          {/* Avatar */}
          {member.avatarUrl ? (
            <Image
              src={member.avatarUrl}
              alt={member.displayName}
              width={32}
              height={32}
              className="w-8 h-8 rounded-full object-cover shrink-0 ring-1 ring-foreground/10"
            />
          ) : (
            <div className="w-8 h-8 rounded-full border border-foreground/12 bg-surface/80 flex items-center justify-center shrink-0">
              <span className="text-[10px] font-bold text-foreground">
                {getInitials(member.displayName)}
              </span>
            </div>
          )}

          {/* Name + progress */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-body text-[13px] font-semibold text-foreground truncate">
                {member.displayName}
              </span>

              {member.readingState === "finished" ? (
                <span className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-full border border-foreground/10 bg-surface/80 px-2 py-0.5 text-[10px] font-semibold text-foreground">
                  <svg
                    className="w-3 h-3 text-accent"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                  Done
                </span>
              ) : member.readingState === "not_started" ? (
                <span className="text-[11px] text-muted shrink-0 ml-2">
                  Not started
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-foreground tabular-nums shrink-0 ml-2">
                  {member.percentComplete}%
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="h-1.5 w-full rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width:
                    member.readingState === "finished"
                      ? "100%"
                      : member.readingState === "not_started"
                        ? "0%"
                        : `${Math.min(100, Math.max(0, member.percentComplete))}%`,
                }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
