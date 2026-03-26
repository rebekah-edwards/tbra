import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { put, del } from "@vercel/blob";
import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const isProduction = !!process.env.TURSO_DATABASE_URL;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("avatar") as File | null;

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Invalid file type. Use JPG, PNG, GIF, or WebP." },
      { status: 400 },
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 5 MB." },
      { status: 400 },
    );
  }

  // Get existing avatar URL for cleanup
  const existing = await db
    .select({ avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, user.userId))
    .get();

  let avatarUrl: string;

  try {
    if (isProduction) {
      // Production: use Vercel Blob
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const filename = `avatars/${user.userId}-${Date.now()}.${ext}`;

      const blob = await put(filename, file, {
        access: "public",
        addRandomSuffix: false,
      });

      avatarUrl = blob.url;

      // Delete old blob if it was a Vercel Blob URL
      if (existing?.avatarUrl?.includes("vercel-storage.com") || existing?.avatarUrl?.includes("blob.vercel-storage.com")) {
        try {
          await del(existing.avatarUrl);
        } catch {
          // Old blob may not exist
        }
      }
    } else {
      // Local dev: save to filesystem
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const filename = `${user.userId}-${Date.now()}.${ext}`;
      const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars");

      await mkdir(uploadDir, { recursive: true });

      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(uploadDir, filename), buffer);

      // Delete old local file
      if (existing?.avatarUrl?.startsWith("/uploads/")) {
        const oldPath = path.join(process.cwd(), "public", existing.avatarUrl);
        try {
          await unlink(oldPath);
        } catch {
          // Old file may not exist
        }
      }

      avatarUrl = `/uploads/avatars/${filename}`;
    }
  } catch (err) {
    console.error("Avatar upload error:", err);
    const message = err instanceof Error ? err.message : "Unknown upload error";
    return NextResponse.json(
      { error: `Upload failed: ${message}` },
      { status: 500 },
    );
  }

  await db
    .update(users)
    .set({ avatarUrl })
    .where(eq(users.id, user.userId));

  revalidatePath("/", "layout");
  revalidatePath("/profile");
  revalidatePath("/");

  return NextResponse.json({ avatarUrl });
}
