import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { put } from "@vercel/blob";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const isProduction = !!process.env.TURSO_DATABASE_URL;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("proof") as File | null;

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Invalid file type. Use JPG, PNG, or WebP." },
      { status: 400 },
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 5 MB." },
      { status: 400 },
    );
  }

  let proofUrl: string;

  try {
    if (isProduction) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const filename = `arc-proofs/${user.userId}-${Date.now()}.${ext}`;

      const blob = await put(filename, file, {
        access: "public",
        addRandomSuffix: false,
      });

      proofUrl = blob.url;
    } else {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const filename = `${user.userId}-${Date.now()}.${ext}`;
      const uploadDir = path.join(process.cwd(), "public", "uploads", "arc-proofs");

      await mkdir(uploadDir, { recursive: true });

      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(uploadDir, filename), buffer);

      proofUrl = `/uploads/arc-proofs/${filename}`;
    }
  } catch (err) {
    console.error("ARC proof upload error:", err);
    const message = err instanceof Error ? err.message : "Unknown upload error";
    return NextResponse.json(
      { error: `Upload failed: ${message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ proofUrl });
}
