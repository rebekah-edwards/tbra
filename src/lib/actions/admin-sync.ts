"use server";

import { execSync } from "child_process";
import { getCurrentUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@libsql/client";

export async function syncUsersFromLive(): Promise<{
  success: boolean;
  message: string;
}> {
  const currentUser = await getCurrentUser();
  if (!currentUser || !isSuperAdmin(currentUser)) {
    return { success: false, message: "Unauthorized" };
  }

  try {
    // Fetch all users from live Turso database
    const raw = execSync(
      `turso db shell tbra-web-app "SELECT json_group_array(json_object('id', id, 'email', email, 'display_name', display_name, 'username', username, 'password_hash', password_hash, 'account_type', account_type, 'role', role, 'avatar_url', avatar_url, 'bio', bio, 'email_verified', email_verified, 'created_at', created_at)) FROM users;"`,
      { encoding: "utf-8", timeout: 30000 }
    );

    // The turso CLI outputs a header line then the JSON — find the JSON array
    const lines = raw.trim().split("\n");
    let jsonStr = "";
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("[")) {
        jsonStr = t;
        break;
      }
    }
    if (!jsonStr) {
      return { success: false, message: "Could not parse Turso output" };
    }
    const liveUsers = JSON.parse(jsonStr);

    if (!Array.isArray(liveUsers) || liveUsers.length === 0) {
      return { success: true, message: "No users found in live database" };
    }

    // Connect to local SQLite database
    const localDb = createClient({ url: "file:data/tbra.db" });

    // Get existing local user IDs so we know which ones already exist
    const existingResult = await localDb.execute("SELECT id FROM users");
    const existingIds = new Set(
      existingResult.rows.map((r) => r.id as string)
    );

    let newCount = 0;
    let updatedCount = 0;

    for (const u of liveUsers) {
      if (existingIds.has(u.id)) {
        // User exists locally — update fields but NOT password_hash
        await localDb.execute({
          sql: `UPDATE users SET
            email = ?,
            display_name = ?,
            username = ?,
            account_type = ?,
            role = ?,
            avatar_url = ?,
            bio = ?,
            email_verified = ?,
            created_at = ?
          WHERE id = ?`,
          args: [
            u.email,
            u.display_name,
            u.username,
            u.account_type,
            u.role,
            u.avatar_url,
            u.bio,
            u.email_verified,
            u.created_at,
            u.id,
          ],
        });
        updatedCount++;
      } else {
        // New user — insert with all fields including password_hash
        await localDb.execute({
          sql: `INSERT INTO users (id, email, display_name, username, password_hash, account_type, role, avatar_url, bio, email_verified, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            u.id,
            u.email,
            u.display_name,
            u.username,
            u.password_hash,
            u.account_type,
            u.role,
            u.avatar_url,
            u.bio,
            u.email_verified,
            u.created_at,
          ],
        });
        newCount++;
      }
    }

    if (newCount === 0 && updatedCount === 0) {
      return { success: true, message: "All users in sync" };
    }

    const parts: string[] = [];
    if (newCount > 0) parts.push(`${newCount} new user${newCount !== 1 ? "s" : ""}`);
    if (updatedCount > 0) parts.push(`${updatedCount} updated`);

    return {
      success: true,
      message: `Synced ${parts.join(", ")}`,
    };
  } catch (error) {
    console.error("syncUsersFromLive error:", error);
    const msg =
      error instanceof Error ? error.message : "Unknown error during sync";
    return { success: false, message: msg };
  }
}
