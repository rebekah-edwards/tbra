"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { updateProfile, deleteAvatar } from "@/lib/actions/profile";

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

  const inputClass =
    "w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  if (loading) {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  return (
    <div className="max-w-md">
      <h1 className="text-foreground text-2xl font-bold tracking-tight mb-6">Edit Profile</h1>

      {/* Avatar Section */}
      <div className="mb-8">
        <label className="block text-sm font-medium mb-3">Photo</label>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-2xl font-bold text-black overflow-hidden flex-shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              "?"
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className={`cursor-pointer text-sm text-link hover:text-link/80 ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
              {uploading ? "Uploading..." : "Upload photo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleAvatarUpload}
                className="hidden"
                disabled={uploading}
              />
            </label>
            <span className="text-[11px] text-muted">JPG, PNG, GIF, or WebP. 5 MB max.</span>
            {avatarUrl && (
              <button
                onClick={handleDeleteAvatar}
                disabled={uploading}
                className="text-sm text-muted hover:text-foreground text-left disabled:opacity-50 mt-1"
              >
                Remove photo
              </button>
            )}
          </div>
        </div>
        {uploadError && (
          <p className="mt-2 text-xs text-destructive">{uploadError}</p>
        )}
      </div>

      {/* Profile Details */}
      <form onSubmit={handleSave}>
        <div className="mb-6">
          <label htmlFor="displayName" className="block text-sm font-medium mb-1">
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

        <div className="mb-6">
          <label htmlFor="username" className="block text-sm font-medium mb-1">
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
          <p className="mt-1 text-[11px] text-muted">Used for your public profile link: /u/{username || "username"}</p>
        </div>

        <div className="mb-6">
          <label htmlFor="bio" className="block text-sm font-medium mb-1">
            Bio
          </label>
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell other readers about yourself..."
            maxLength={200}
            rows={3}
            className={`${inputClass} resize-none`}
          />
          <p className="mt-1 text-[11px] text-muted text-right">{bio.length}/200</p>
        </div>

        {/* Social Handles */}
        <div className="mb-8">
          <h3 className="text-sm font-medium mb-3">Social links</h3>
          <p className="text-[11px] text-muted mb-3">Shown on your public profile so readers can find you.</p>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-20 text-xs text-muted">Instagram</span>
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
              <span className="w-20 text-xs text-muted">TikTok</span>
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
              <span className="w-20 text-xs text-muted">Threads</span>
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
              <span className="w-20 text-xs text-muted">X</span>
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
        <div className="mb-8">
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-4">
            <div>
              <p className="text-sm font-medium">Private profile</p>
              <p className="text-[11px] text-muted mt-0.5">When enabled, your profile can&apos;t be viewed publicly</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isPrivate}
              onClick={() => setIsPrivate(!isPrivate)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isPrivate ? "bg-primary" : "bg-border"
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

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-primary px-6 py-2 text-sm font-medium text-background hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/profile")}
            className="rounded-full border border-border px-6 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
