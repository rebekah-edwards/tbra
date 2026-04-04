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
    <div className="flex flex-col gap-3">
      {sorted.map((member) => (
        <div key={member.userId} className="flex items-center gap-3">
          {/* Avatar */}
          {member.avatarUrl ? (
            <Image
              src={member.avatarUrl}
              alt={member.displayName}
              width={24}
              height={24}
              className="w-6 h-6 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
              <span className="text-[9px] font-semibold text-accent">
                {getInitials(member.displayName)}
              </span>
            </div>
          )}

          {/* Name + progress */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="font-body text-xs text-primary truncate">
                {member.displayName}
              </span>

              {member.readingState === "finished" ? (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-accent shrink-0 ml-2">
                  <svg
                    className="w-3 h-3"
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
                <span className="text-[10px] text-tertiary shrink-0 ml-2">
                  Not started
                </span>
              ) : (
                <span className="text-[10px] text-secondary shrink-0 ml-2">
                  {member.percentComplete}%
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="h-2 w-full rounded-full bg-border">
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
