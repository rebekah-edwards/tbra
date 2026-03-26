/**
 * One-time script to create Seth's account.
 * Run: npx tsx scripts/create-seth-account.ts
 */
import bcrypt from "bcryptjs";
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const email = "sethncordle@gmail.com";
  const displayName = "sethcordleauthor";
  const password = "changeme123";

  // Check if already exists
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (existing) {
    console.log(`User already exists: ${existing.id}`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [user] = await db.insert(users).values({
    email,
    passwordHash,
    displayName,
  }).returning();

  console.log(`Created user: ${user.id}`);
  console.log(`Email: ${email}`);
  console.log(`Display name: ${displayName}`);
  console.log(`Temp password: ${password}`);
}

main().catch(console.error);
