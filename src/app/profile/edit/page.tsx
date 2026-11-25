"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { updateProfile, deleteAvatar } from "@/lib/actions/profile";
import { ReaderAvatar } from "@/components/ui/reader-row";
import { HERO_BACK_BUTTON_CLASS } from "@/components/ui/cover-art-hero";

export default function EditProfilePage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [instagram, setInstagram] = useState("");
  const [tiktok, setTiktok] = useState("");
  const [threads, setThreads] = useState("");
  const [twitter, setTwitter] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        setDisplayName(data.displayName || "");
        setUsername(data.username || "");
        setBio(data.bio || "");
        setAvatarUrl(data.avatarUrl || null);
        setInstagram(data.instagram || "");
        setTiktok(data.tiktok || "");
        setThreads(data.threads || "");
        setTwitter(data.twitter || "");
        setIsPrivate(data.isPrivate || false);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    const formData = new FormData();
    formData.set("displayName", displayName);
    formData.set("username", username);
    formData.set("bio", bio);
    formData.set("instagram", instagram);
    formData.set("tiktok", tiktok);
    formData.set("threads", threads);
    formData.set("twitter", twitter);
    formData.set("isPrivate", isPrivate ? "true" : "false");
    const result = await updateProfile(formData);
    if (result?.error) {
      setSaveError(result.error);
      setSaving(false);
      return;
    }
    // redirect happens in server action
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side size check before uploading
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("File too large. Maximum size is 5 MB.");
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.set("avatar", file);
      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || "Upload failed. Please try again.");
        return;
      }
      setAvatarUrl(data.avatarUrl);
      router.refresh();
    } catch {
      setUploadError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteAvatar() {
    setUploading(true);
    setUploadError(null);
    try {
      await deleteAvatar();
      setAvatarUrl(null);
      router.refresh();
    } catch {
      setUploadError("Failed to remove photo.");
    } finally {
      setUploading(false);
    }
  }

  const inputClass = "field-glass w-full text-base";
  const labelClass = "eyebrow mb-1.5 block pl-4";

  if (loading) {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  return (
    <div className="mx-auto max-w-md pb-24">
      <div className="mb-5 flex items-center gap-3">
        <button type="button" onClick={() => router.push("/profile")} aria-label="Back to profile" className={HERO_BACK_BUTTON_CLASS}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <p className="eyebrow">Profile</p>
          <h1 className="font-heading text-foreground text-[22px] font-bold leading-tight tracking-tight">Edit Profile</h1>
        </div>
      </div>

      {/* Avatar Section */}
      <div className="card-hairline mb-5 flex flex-col items-center p-5 text-center">
        <ReaderAvatar avatarUrl={avatarUrl} name={displayName || username || "?"} size={84} />
        <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2">
            <label className={`btn-glass cursor-pointer px-4 py-1.5 text-xs ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-neon-blue" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              {uploading ? "Uploading..." : avatarUrl ? "Change photo" : "Upload photo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleAvatarUpload}
                className="hidden"
                disabled={uploading}
              />
            </label>
            {avatarUrl && (
              <button
                type="button"
                onClick={handleDeleteAvatar}
                disabled={uploading}
                className="btn-glass px-4 py-1.5 text-xs disabled:opacity-50"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400" aria-hidden="true">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
                Remove
              </button>
            )}
        </div>
        <span className="mt-2 text-[11px] text-muted">JPG, PNG, GIF, or WebP. 5 MB max.</span>
        {uploadError && (
          <p className="mt-2 text-xs text-destructive">{uploadError}</p>
        )}
      </div>

      {/* Profile Details */}
      <form onSubmit={handleSave}>
        <p className="eyebrow mb-2 pl-1">About you</p>
        <div className="card-glass mb-5 space-y-4 p-4">
        <div>
          <label htmlFor="displayName" className={labelClass}>
            Display name
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Enter a display name"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="username" className={labelClass}>
            Username
          </label>
          <div className="flex items-center">
            <span className="text-sm text-muted mr-1">@</span>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              placeholder="your_username"
              maxLength={30}
              className={`flex-1 ${inputClass}`}
            />
          </div>
          <p className="mt-1 pl-4 text-[11px] text-muted">Used for your public profile link: /u/{username || "username"}</p>
        </div>

        <div>
          <label htmlFor="bio" className={labelClass}>
            Bio
          </label>
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell other readers about yourself..."
            maxLength={200}
            rows={3}
            className={`${inputClass} h-auto resize-none !rounded-[20px] py-3`}
          />
          <p className="mt-1 pr-2 text-[11px] text-muted text-right">{bio.length}/200</p>
        </div>
        </div>

        {/* Social Handles */}
        <p className="eyebrow mb-2 pl-1">Social links</p>
        <div className="card-glass mb-5 p-4">
          <p className="text-[11px] text-muted mb-3 text-center">Shown on your public profile so readers can find you.</p>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-[72px] flex-shrink-0 text-xs font-medium text-muted">Instagram</span>
              <div className="flex items-center flex-1">
                <span className="text-sm text-muted mr-1">@</span>
                <input
                  type="text"
                  value={instagram}
                  onChange={(e) => setInstagram(e.target.value.replace(/^@/, "").replace(/[^a-zA-Z0-9_.]/g, ""))}
                  placeholder="handle"
                  maxLength={30}
                  className={`flex-1 ${inputClass}`}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-[72px] flex-shrink-0 text-xs font-medium text-muted">TikTok</span>
              <div className="flex items-center flex-1">
                <span className="text-sm text-muted mr-1">@</span>
                <input
                  type="text"
                  value={tiktok}
                  onChange={(e) => setTiktok(e.target.value.replace(/^@/, "").replace(/[^a-zA-Z0-9_.]/g, ""))}
                  placeholder="handle"
                  maxLength={30}
                  className={`flex-1 ${inputClass}`}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-[72px] flex-shrink-0 text-xs font-medium text-muted">Threads</span>
              <div className="flex items-center flex-1">
                <span className="text-sm text-muted mr-1">@</span>
                <input
                  type="text"
                  value={threads}
                  onChange={(e) => setThreads(e.target.value.replace(/^@/, "").replace(/[^a-zA-Z0-9_.]/g, ""))}
                  placeholder="handle"
                  maxLength={30}
                  className={`flex-1 ${inputClass}`}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-[72px] flex-shrink-0 text-xs font-medium text-muted">X</span>
              <div className="flex items-center flex-1">
                <span className="text-sm text-muted mr-1">@</span>
                <input
                  type="text"
                  value={twitter}
                  onChange={(e) => setTwitter(e.target.value.replace(/^@/, "").replace(/[^a-zA-Z0-9_.]/g, ""))}
                  placeholder="handle"
                  maxLength={30}
                  className={`flex-1 ${inputClass}`}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Privacy Toggle */}
        <p className="eyebrow mb-2 pl-1">Privacy</p>
        <div className="mb-6">
          <div className="card-glass flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium">Private profile</p>
              <p className="text-[11px] text-muted mt-0.5">When enabled, your profile can&apos;t be viewed publicly</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isPrivate}
              onClick={() => setIsPrivate(!isPrivate)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                isPrivate ? "bg-accent" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isPrivate ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        {saveError && (
          <p className="mb-4 text-xs text-destructive">{saveError}</p>
        )}

        <div className="flex justify-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="btn-lime px-7 py-2.5 text-sm"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/profile")}
            className="btn-glass px-6 py-2.5 text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
