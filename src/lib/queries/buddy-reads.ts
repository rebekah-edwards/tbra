import { db } from "@/db";
import { sql } from "drizzle-orm";

// ─── Types ───

export interface BuddyReadSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  isPublic: boolean;
  inviteCode: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  book: {
    id: string;
    title: string;
    slug: string | null;
    coverImageUrl: string | null;
  };
  memberCount: number;
}

export interface BuddyReadRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  isPublic: boolean;
  inviteCode: string;
  maxMembers: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  bookId: string;
}

export interface BuddyReadMemberDetail {
  userId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  joinedAt: string | null;
  readingState: string | null;
  percentComplete: number | null;
  completionDate: string | null;
}

export interface BuddyReadDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  isPublic: boolean;
  inviteCode: string;
  maxMembers: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  createdBy: string;
  book: {
    id: string;
    title: string;
    slug: string | null;
    coverImageUrl: string | null;
    pages: number | null;
    authors: string[];
  };
  members: BuddyReadMemberDetail[];
}

export interface BuddyReadMessage {
  id: string;
  message: string;
  createdAt: string;
  user: {
    id: string;
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
  };
}

export interface BuddyReadInvitePreview {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  bookTitle: string;
  bookCoverImageUrl: string | null;
  memberCount: number;
}

export interface BuddyReadMembership {
  role: string;
  status: string;
}

// ─── Queries ───

/**
 * Get all buddy reads where user is an active or invited member.
 */
export async function getUserBuddyReads(userId: string): Promise<BuddyReadSummary[]> {
  const rows = await db.all(sql`
    SELECT
      br.id,
      br.name,
      br.slug,
      br.description,
      br.status,
      br.is_public,
      br.invite_code,
      br.start_date,
      br.end_date,
      br.created_at,
      b.id as book_id,
      b.title as book_title,
      b.slug as book_slug,
      b.cover_image_url as book_cover_image_url,
      (SELECT COUNT(*) FROM buddy_read_members brm2
       WHERE brm2.buddy_read_id = br.id AND brm2.status IN ('active', 'invited')) as member_count
    FROM buddy_read_members brm
    JOIN buddy_reads br ON brm.buddy_read_id = br.id
    JOIN books b ON br.book_id = b.id
    WHERE brm.user_id = ${userId} AND brm.status IN ('active', 'invited')
    ORDER BY
      CASE WHEN br.status = 'active' THEN 0 ELSE 1 END ASC,
      br.created_at DESC
  `) as {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    status: string;
    is_public: number;
    invite_code: string;
    start_date: string | null;
    end_date: string | null;
    created_at: string;
    book_id: string;
    book_title: string;
    book_slug: string | null;
    book_cover_image_url: string | null;
    member_count: number;
  }[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    isPublic: !!row.is_public,
    inviteCode: row.invite_code,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    book: {
      id: row.book_id,
      title: row.book_title,
      slug: row.book_slug,
      coverImageUrl: row.book_cover_image_url,
    },
    memberCount: row.member_count,
  }));
}

/**
 * Simple lookup returning the buddy read row or null.
 */
export async function getBuddyReadBySlug(slug: string): Promise<BuddyReadRow | null> {
  const rows = await db.all(sql`
    SELECT
      id, name, slug, description, status, is_public, invite_code,
      max_members, start_date, end_date, created_at, updated_at,
      created_by, book_id
    FROM buddy_reads
    WHERE slug = ${slug}
  `) as {
    id: string; name: string; slug: string; description: string | null;
    status: string; is_public: number; invite_code: string;
    max_members: number; start_date: string | null; end_date: string | null;
    created_at: string; updated_at: string; created_by: string; book_id: string;
  }[];

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    status: r.status,
    isPublic: !!r.is_public,
    inviteCode: r.invite_code,
    maxMembers: r.max_members,
    startDate: r.start_date,
    endDate: r.end_date,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.created_by,
    bookId: r.book_id,
  };
}

/**
 * Full buddy read details: info + book + all members with reading progress.
 */
export async function getBuddyReadDetail(buddyReadId: string): Promise<BuddyReadDetail | null> {
  // Fetch buddy read + book info, members, and authors in parallel
  const [brRows, memberRows] = await Promise.all([
    db.all(sql`
      SELECT
        br.id, br.name, br.slug, br.description, br.status, br.is_public,
        br.invite_code, br.max_members, br.start_date, br.end_date,
        br.created_at, br.created_by, br.book_id,
        b.title as book_title, b.slug as book_slug,
        b.cover_image_url as book_cover_image_url, b.pages as book_pages
      FROM buddy_reads br
      JOIN books b ON br.book_id = b.id
      WHERE br.id = ${buddyReadId}
    `) as Promise<{
      id: string; name: string; slug: string; description: string | null;
      status: string; is_public: number; invite_code: string; max_members: number;
      start_date: string | null; end_date: string | null; created_at: string;
      created_by: string; book_id: string; book_title: string; book_slug: string | null;
      book_cover_image_url: string | null; book_pages: number | null;
    }[]>,

    db.all(sql`
      SELECT
        brm.user_id,
        brm.role,
        brm.status,
        brm.joined_at,
        u.display_name,
        u.username,
        u.avatar_url,
        ubs.state as reading_state,
        (SELECT MAX(rn.percent_complete) FROM reading_notes rn
         WHERE rn.user_id = brm.user_id AND rn.book_id = (SELECT book_id FROM buddy_reads WHERE id = ${buddyReadId})
        ) as percent_complete,
        (SELECT rs.completion_date FROM reading_sessions rs
         WHERE rs.user_id = brm.user_id AND rs.book_id = (SELECT book_id FROM buddy_reads WHERE id = ${buddyReadId})
           AND rs.state = 'completed'
         ORDER BY rs.completion_date DESC LIMIT 1
        ) as completion_date
      FROM buddy_read_members brm
      JOIN users u ON brm.user_id = u.id
      LEFT JOIN user_book_state ubs ON ubs.user_id = brm.user_id
        AND ubs.book_id = (SELECT book_id FROM buddy_reads WHERE id = ${buddyReadId})
      WHERE brm.buddy_read_id = ${buddyReadId}
        AND brm.status IN ('active', 'invited')
      ORDER BY
        CASE brm.role WHEN 'host' THEN 0 ELSE 1 END ASC,
        brm.joined_at ASC
    `) as Promise<{
      user_id: string; role: string; status: string; joined_at: string | null;
      display_name: string | null; username: string | null; avatar_url: string | null;
      reading_state: string | null; percent_complete: number | null;
      completion_date: string | null;
    }[]>,
  ]);

  if (brRows.length === 0) return null;
  const br = brRows[0];

  // Fetch authors for the book
  const authorRows = await db.all(sql`
    SELECT a.name
    FROM book_authors ba
    JOIN authors a ON ba.author_id = a.id
    WHERE ba.book_id = ${br.book_id}
  `) as { name: string }[];

  const members: BuddyReadMemberDetail[] = memberRows.map((m) => ({
    userId: m.user_id,
    displayName: m.display_name,
    username: m.username,
    avatarUrl: m.avatar_url,
    role: m.role,
    status: m.status,
    joinedAt: m.joined_at,
    readingState: m.reading_state,
    percentComplete: m.percent_complete,
    completionDate: m.completion_date,
  }));

  return {
    id: br.id,
    name: br.name,
    slug: br.slug,
    description: br.description,
    status: br.status,
    isPublic: !!br.is_public,
    inviteCode: br.invite_code,
    maxMembers: br.max_members,
    startDate: br.start_date,
    endDate: br.end_date,
    createdAt: br.created_at,
    createdBy: br.created_by,
    book: {
      id: br.book_id,
      title: br.book_title,
      slug: br.book_slug,
      coverImageUrl: br.book_cover_image_url,
      pages: br.book_pages,
      authors: authorRows.map((a) => a.name),
    },
    members,
  };
}

/**
 * Paginated messages for a buddy read, chronological order.
 */
export async function getBuddyReadMessages(
  buddyReadId: string,
  limit = 50,
  offset = 0,
): Promise<BuddyReadMessage[]> {
  const rows = await db.all(sql`
    SELECT
      brm.id,
      brm.message,
      brm.created_at,
      brm.user_id,
      u.display_name,
      u.username,
      u.avatar_url
    FROM buddy_read_messages brm
    JOIN users u ON brm.user_id = u.id
    WHERE brm.buddy_read_id = ${buddyReadId}
    ORDER BY brm.created_at ASC
    LIMIT ${limit} OFFSET ${offset}
  `) as {
    id: string; message: string; created_at: string; user_id: string;
    display_name: string | null; username: string | null; avatar_url: string | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    message: row.message,
    createdAt: row.created_at,
    user: {
      id: row.user_id,
      displayName: row.display_name,
      username: row.username,
      avatarUrl: row.avatar_url,
    },
  }));
}

/**
 * Look up a buddy read by invite code. For the join page.
 */
export async function getBuddyReadByInviteCode(code: string): Promise<BuddyReadInvitePreview | null> {
  const rows = await db.all(sql`
    SELECT
      br.id,
      br.name,
      br.slug,
      br.description,
      br.status,
      b.title as book_title,
      b.cover_image_url as book_cover_image_url,
      (SELECT COUNT(*) FROM buddy_read_members brm
       WHERE brm.buddy_read_id = br.id AND brm.status IN ('active', 'invited')) as member_count
    FROM buddy_reads br
    JOIN books b ON br.book_id = b.id
    WHERE br.invite_code = ${code}
  `) as {
    id: string; name: string; slug: string; description: string | null;
    status: string; book_title: string; book_cover_image_url: string | null;
    member_count: number;
  }[];

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    status: r.status,
    bookTitle: r.book_title,
    bookCoverImageUrl: r.book_cover_image_url,
    memberCount: r.member_count,
  };
}

/**
 * Check if a user is a member of a buddy read. Returns role/status or null.
 */
export async function isBuddyReadMember(
  buddyReadId: string,
  userId: string,
): Promise<BuddyReadMembership | null> {
  const rows = await db.all(sql`
    SELECT role, status
    FROM buddy_read_members
    WHERE buddy_read_id = ${buddyReadId} AND user_id = ${userId}
  `) as { role: string; status: string }[];

  if (rows.length === 0) return null;
  return { role: rows[0].role, status: rows[0].status };
}
