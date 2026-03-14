"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { updateProfile, uploadAvatar, deleteAvatar } from "@/lib/actions/profile";

export default function EditProfilePage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        setDisplayName(data.displayName || "");
        setAvatarUrl(data.avatarUrl || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const formData = new FormData();
    formData.set("displayName", displayName);
    await updateProfile(formData);
    // redirect happens in server action
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.set("avatar", file);
    await uploadAvatar(formData);
    // Refresh to show new avatar
    setAvatarUrl(`/uploads/avatars/preview-${Date.now()}`);
    setUploading(false);
    router.refresh();
  }

  async function handleDeleteAvatar() {
    setUploading(true);
    await deleteAvatar();
    setAvatarUrl(null);
    setUploading(false);
    router.refresh();
  }

  if (loading) {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Edit Profile</h1>

      {/* Avatar Section */}
      <div className="mb-8">
        <label className="block text-sm font-medium mb-3">Photo</label>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-background overflow-hidden flex-shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              "?"
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className={`cursor-pointer text-sm text-primary hover:text-primary-dark ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
              {uploading ? "Uploading..." : "Upload photo"}
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
                disabled={uploading}
              />
            </label>
            {avatarUrl && (
              <button
                onClick={handleDeleteAvatar}
                disabled={uploading}
                className="text-sm text-muted hover:text-foreground text-left disabled:opacity-50"
              >
                Remove photo
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Display Name */}
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
            className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

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
