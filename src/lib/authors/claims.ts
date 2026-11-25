/**
 * Author accounts (2026-11-25).
 *
 * A reader account becomes a VERIFIED AUTHOR when a person on the team
 * approves a claim linking it to an `authors` row — either the author asked
 * from their author page ("Claim this author page") or staff linked it from
 * /admin/authors. Verified authors get a badge (profile + author page) and,
 * on books they wrote, can:
 *   - replace the book's description,
 *   - confirm a content rating as-is (→ "Author-verified"),
 *   - change a rating's strength / note (also "Author-verified").
 * Every such change is applied immediately, written to `author_edits` with
 * what it replaced, and reported to the super admins (in-app notification +
 * email) so anything that doesn't fit how the app works can be reverted from
 * /admin/authors with one click.
 *
 * User-scoped functions here take a userId — this is deliberately NOT a
 * "use server" module, so none of it is callable from a client directly.
 */
import { db } from "@/db";
import {
  authorClaims,
  authorEdits,
  authors,
  bookAuthors,
  bookCategoryRatings,
  books,
  taxonomyCategories,
  userNotifications,
  users,
} from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { sendAdminNoticeEmail } from "@/lib/email";

export const VERIFIED_EVIDENCE = ["human_verified", "admin_verified", "author_verified"] as const;

export interface VerifiedAuthorRef {
  authorId: string;
  name: string;
  slug: string | null;
}

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

// ─── Reads ───

/** Authors this account is the verified author of (usually one; pen names can add more). */
export async function getVerifiedAuthorsForUser(userId: string): Promise<VerifiedAuthorRef[]> {
  const rows = await db
    .select({ authorId: authors.id, name: authors.name, slug: authors.slug })
    .from(authorClaims)
    .innerJoin(authors, eq(authors.id, authorClaims.authorId))
    .where(and(eq(authorClaims.userId, userId), eq(authorClaims.status, "approved")))
    .all();
  return rows;
}

export interface AuthorClaimant {
  userId: string;
  username: string | null;
  displayName: string | null;
}

/** The verified account behind an author page, if any. */
export async function getAuthorClaimant(authorId: string): Promise<AuthorClaimant | null> {
  const row = await db
    .select({ userId: users.id, username: users.username, displayName: users.displayName })
    .from(authorClaims)
    .innerJoin(users, eq(users.id, authorClaims.userId))
    .where(and(eq(authorClaims.authorId, authorId), eq(authorClaims.status, "approved")))
    .get();
  return row ?? null;
}

/** This viewer's own claim on an author page (pending/rejected/approved), newest first. */
export async function getViewerClaim(userId: string, authorId: string) {
  return (
    (await db
      .select({ id: authorClaims.id, status: authorClaims.status })
      .from(authorClaims)
      .where(and(eq(authorClaims.userId, userId), eq(authorClaims.authorId, authorId)))
      .orderBy(desc(authorClaims.createdAt))
      .get()) ?? null
  );
}

/** Is this account a verified author of this book (credited as author)? */
export async function isVerifiedAuthorOfBook(userId: string, bookId: string): Promise<boolean> {
  const row = await db
    .select({ id: authorClaims.id })
    .from(authorClaims)
    .innerJoin(bookAuthors, eq(bookAuthors.authorId, authorClaims.authorId))
    .where(
      and(
        eq(authorClaims.userId, userId),
        eq(authorClaims.status, "approved"),
        eq(bookAuthors.bookId, bookId),
        eq(bookAuthors.role, "author"),
      ),
    )
    .get();
  return !!row;
}

async function verifiedAuthorIdForBook(userId: string, bookId: string): Promise<string | null> {
  const row = await db
    .select({ authorId: authorClaims.authorId })
    .from(authorClaims)
    .innerJoin(bookAuthors, eq(bookAuthors.authorId, authorClaims.authorId))
    .where(
      and(
        eq(authorClaims.userId, userId),
        eq(authorClaims.status, "approved"),
        eq(bookAuthors.bookId, bookId),
        eq(bookAuthors.role, "author"),
      ),
    )
    .get();
  return row?.authorId ?? null;
}

// ─── Notifications ───

async function notifyAdmins(title: string, message: string, linkUrl: string) {
  try {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.accountType, "super_admin"))
      .all();
    if (admins.length > 0) {
      await db.insert(userNotifications).values(
        admins.map((a) => ({ userId: a.id, type: "author_activity", title, message, linkUrl })),
      );
    }
  } catch (err) {
    console.error("[authors] admin notification failed", err);
  }
  await sendAdminNoticeEmail({ subject: title, body: message, path: linkUrl });
}

async function nameOf(userId: string): Promise<string> {
  const u = await db.select({ d: users.displayName, u: users.username }).from(users).where(eq(users.id, userId)).get();
  return u?.d || (u?.u ? `@${u.u}` : "A reader");
}

// ─── Claims ───

export async function submitAuthorClaimFor(
  userId: string,
  authorId: string,
  input: { contactEmail?: string | null; evidenceLinks?: string | null; message?: string | null },
): Promise<Result<{ claimId: string }>> {
  const author = await db.select({ id: authors.id, name: authors.name, slug: authors.slug }).from(authors).where(eq(authors.id, authorId)).get();
  if (!author) return { success: false, error: "Author not found" };

  const claimant = await getAuthorClaimant(authorId);
  if (claimant) {
    return claimant.userId === userId
      ? { success: false, error: "You're already the verified author of this page" }
      : { success: false, error: "This author page has already been claimed. Contact us if that's wrong." };
  }
  const existing = await getViewerClaim(userId, authorId);
  if (existing?.status === "pending") return { success: false, error: "Your claim is already waiting for review" };

  const trim = (v: string | null | undefined, max: number) => (v ?? "").trim().slice(0, max) || null;
  const evidence = trim(input.evidenceLinks, 1000);
  const email = trim(input.contactEmail, 200);
  if (!evidence && !email) {
    return { success: false, error: "Add your website, a social profile, or a contact email so we can confirm it's you" };
  }

  const id = crypto.randomUUID();
  await db.insert(authorClaims).values({
    id,
    userId,
    authorId,
    status: "pending",
    method: "self",
    contactEmail: email,
    evidenceLinks: evidence,
    message: trim(input.message, 2000),
  });

  const who = await nameOf(userId);
  await notifyAdmins(
    "New author page claim",
    `${who} says they're ${author.name}. Proof given: ${[evidence, email].filter(Boolean).join(" · ")}`,
    "/admin/authors",
  );
  if (author.slug) revalidatePath(`/author/${author.slug}`);
  return { success: true, claimId: id };
}

export async function reviewAuthorClaimFor(
  adminId: string,
  claimId: string,
  decision: "approved" | "rejected" | "revoked",
  note?: string | null,
): Promise<Result> {
  const claim = await db.select().from(authorClaims).where(eq(authorClaims.id, claimId)).get();
  if (!claim) return { success: false, error: "Claim not found" };
  if (decision === "approved") {
    const other = await getAuthorClaimant(claim.authorId);
    if (other && other.userId !== claim.userId) {
      return { success: false, error: "Another account is already the verified author of this page — revoke it first" };
    }
  }
  const now = new Date().toISOString();
  await db
    .update(authorClaims)
    .set({ status: decision, reviewedBy: adminId, reviewedAt: now, reviewNote: note?.trim() || null, updatedAt: now })
    .where(eq(authorClaims.id, claimId));

  const author = await db.select({ name: authors.name, slug: authors.slug }).from(authors).where(eq(authors.id, claim.authorId)).get();
  if (decision !== "revoked") {
    try {
      await db.insert(userNotifications).values({
        userId: claim.userId,
        type: decision === "approved" ? "author_claim_approved" : "author_claim_rejected",
        title: decision === "approved" ? "You're a verified author" : "Author claim not approved",
        message:
          decision === "approved"
            ? `Your account is now linked to ${author?.name ?? "your author page"}. You can update your books' descriptions and confirm their content ratings from each book page.`
            : `We couldn't confirm your claim to ${author?.name ?? "this author page"}.${note ? ` ${note}` : ""} Reply to hello@thebasedreader.app if you can share more proof.`,
        linkUrl: author?.slug ? `/author/${author.slug}` : null,
      });
    } catch (err) {
      console.error("[authors] claimant notification failed", err);
    }
  }
  if (author?.slug) revalidatePath(`/author/${author.slug}`);
  return { success: true };
}

/** Staff link an account to an author page directly (already-verified identity). */
export async function staffLinkAuthorFor(
  adminId: string,
  username: string,
  authorIdOrSlug: string,
  note?: string | null,
): Promise<Result<{ claimId: string }>> {
  const user = await db.select({ id: users.id }).from(users).where(eq(users.username, username.replace(/^@/, "").trim())).get();
  if (!user) return { success: false, error: `No account with username "${username}"` };
  const author = await db
    .select({ id: authors.id, slug: authors.slug })
    .from(authors)
    .where(sql`${authors.id} = ${authorIdOrSlug} OR ${authors.slug} = ${authorIdOrSlug}`)
    .get();
  if (!author) return { success: false, error: `No author page "${authorIdOrSlug}"` };

  const other = await getAuthorClaimant(author.id);
  if (other) {
    if (other.userId === user.id) return { success: false, error: "That account is already the verified author" };
    return { success: false, error: "Another account is already the verified author of this page — revoke it first" };
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.insert(authorClaims).values({
    id,
    userId: user.id,
    authorId: author.id,
    status: "approved",
    method: "staff",
    reviewedBy: adminId,
    reviewedAt: now,
    reviewNote: note?.trim() || null,
  });
  // Close any of this user's pending claims on the same page.
  await db
    .update(authorClaims)
    .set({ status: "approved", reviewedBy: adminId, reviewedAt: now, updatedAt: now })
    .where(and(eq(authorClaims.userId, user.id), eq(authorClaims.authorId, author.id), eq(authorClaims.status, "pending")));
  if (author.slug) revalidatePath(`/author/${author.slug}`);
  return { success: true, claimId: id };
}

// ─── Author edits ───

async function bookLabel(bookId: string) {
  return db.select({ title: books.title, slug: books.slug }).from(books).where(eq(books.id, bookId)).get();
}

function revalidateBook(slug: string | null | undefined, bookId: string) {
  revalidatePath(`/book/${slug ?? bookId}`);
}

export async function authorEditDescriptionFor(
  userId: string,
  bookId: string,
  description: string,
): Promise<Result> {
  const authorId = await verifiedAuthorIdForBook(userId, bookId);
  if (!authorId) return { success: false, error: "Only the book's verified author can do that" };

  // Normalise line endings and spacing but keep the author's paragraphs and
  // **bold** / *italic* markers — the book page renders them.
  const text = description
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < 60) return { success: false, error: "The description needs at least 60 characters" };
  if (text.length > 6000) return { success: false, error: "Keep the description under 6,000 characters" };
  if (/<[a-z/][^>]*>/i.test(text)) return { success: false, error: "Use plain text — HTML isn't supported" };

  const book = await db.select({ description: books.description, title: books.title, slug: books.slug }).from(books).where(eq(books.id, bookId)).get();
  if (!book) return { success: false, error: "Book not found" };
  if ((book.description ?? "").trim() === text) return { success: true };

  await db
    .update(books)
    .set({ description: text, descriptionStale: false, updatedAt: new Date().toISOString() })
    .where(eq(books.id, bookId));
  await db.insert(authorEdits).values({
    userId,
    authorId,
    bookId,
    kind: "description",
    beforeText: book.description,
    afterText: text,
  });

  const who = await nameOf(userId);
  await notifyAdmins(
    "Author updated a description",
    `${who} replaced the description of "${book.title}". Review or revert it in /admin/authors.`,
    "/admin/authors",
  );
  revalidateBook(book.slug, bookId);
  return { success: true };
}

/**
 * Confirm a content rating as-is, or change its strength / note. Either way
 * the rating becomes "Author-verified". A staff-verified rating can still be
 * changed by its author — the edit is logged and reported like any other.
 */
export async function authorRateFor(
  userId: string,
  bookId: string,
  categoryKey: string,
  change: { intensity?: number | null; notes?: string | null },
): Promise<Result> {
  const authorId = await verifiedAuthorIdForBook(userId, bookId);
  if (!authorId) return { success: false, error: "Only the book's verified author can do that" };

  const category = await db
    .select({ id: taxonomyCategories.id, name: taxonomyCategories.name })
    .from(taxonomyCategories)
    .where(eq(taxonomyCategories.key, categoryKey))
    .get();
  if (!category) return { success: false, error: "Category not found" };

  const existing = await db
    .select()
    .from(bookCategoryRatings)
    .where(and(eq(bookCategoryRatings.bookId, bookId), eq(bookCategoryRatings.categoryId, category.id)))
    .get();
  if (!existing) return { success: false, error: "This book has no rating in that category yet" };

  const intensity = change.intensity ?? existing.intensity;
  if (!Number.isInteger(intensity) || intensity < 0 || intensity > 4) {
    return { success: false, error: "Strength must be between None and Extreme" };
  }
  const notes = change.notes === undefined ? existing.notes : change.notes?.trim() || null;
  if (notes && notes.length > 400) return { success: false, error: "Keep the note under 400 characters" };
  const changed = intensity !== existing.intensity || (notes ?? "") !== (existing.notes ?? "");

  await db
    .update(bookCategoryRatings)
    .set({ intensity, notes, evidenceLevel: "author_verified", updatedByUserId: userId, updatedAt: new Date().toISOString() })
    .where(eq(bookCategoryRatings.id, existing.id));
  await db.insert(authorEdits).values({
    userId,
    authorId,
    bookId,
    kind: changed ? "rating_edit" : "rating_confirm",
    categoryId: category.id,
    beforeText: existing.notes,
    afterText: notes,
    beforeIntensity: existing.intensity,
    afterIntensity: intensity,
    beforeEvidence: existing.evidenceLevel,
  });

  const book = await bookLabel(bookId);
  if (changed) {
    const who = await nameOf(userId);
    const names = ["None", "Mild", "Moderate", "Significant", "Extreme"];
    await notifyAdmins(
      "Author changed a content rating",
      `${who} changed ${category.name} on "${book?.title}" from ${names[existing.intensity]} to ${names[intensity]}${notes !== existing.notes ? " and rewrote the note" : ""}. Review or revert it in /admin/authors.`,
      "/admin/authors",
    );
  }
  revalidateBook(book?.slug, bookId);
  return { success: true };
}

/** Staff: put back what an author edit replaced. */
export async function revertAuthorEditFor(adminId: string, editId: string): Promise<Result> {
  const edit = await db.select().from(authorEdits).where(eq(authorEdits.id, editId)).get();
  if (!edit) return { success: false, error: "Edit not found" };
  if (edit.revertedAt) return { success: false, error: "Already reverted" };
  const now = new Date().toISOString();

  if (edit.kind === "description") {
    await db.update(books).set({ description: edit.beforeText, updatedAt: now }).where(eq(books.id, edit.bookId));
  } else if (edit.categoryId) {
    await db
      .update(bookCategoryRatings)
      .set({
        intensity: edit.beforeIntensity ?? 0,
        notes: edit.beforeText,
        evidenceLevel: edit.beforeEvidence ?? "ai_inferred",
        updatedByUserId: adminId,
        updatedAt: now,
      })
      .where(and(eq(bookCategoryRatings.bookId, edit.bookId), eq(bookCategoryRatings.categoryId, edit.categoryId)));
  }
  await db.update(authorEdits).set({ revertedAt: now, revertedBy: adminId }).where(eq(authorEdits.id, editId));
  const book = await bookLabel(edit.bookId);
  revalidateBook(book?.slug, edit.bookId);
  return { success: true };
}

// ─── Admin listings ───

export async function listAuthorClaims() {
  return db
    .select({
      id: authorClaims.id,
      status: authorClaims.status,
      method: authorClaims.method,
      contactEmail: authorClaims.contactEmail,
      evidenceLinks: authorClaims.evidenceLinks,
      message: authorClaims.message,
      createdAt: authorClaims.createdAt,
      reviewedAt: authorClaims.reviewedAt,
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      email: users.email,
      authorId: authors.id,
      authorName: authors.name,
      authorSlug: authors.slug,
    })
    .from(authorClaims)
    .innerJoin(users, eq(users.id, authorClaims.userId))
    .innerJoin(authors, eq(authors.id, authorClaims.authorId))
    .where(inArray(authorClaims.status, ["pending", "approved"]))
    .orderBy(desc(authorClaims.createdAt))
    .all();
}

export async function listRecentAuthorEdits(limit = 100) {
  return db
    .select({
      id: authorEdits.id,
      kind: authorEdits.kind,
      createdAt: authorEdits.createdAt,
      revertedAt: authorEdits.revertedAt,
      beforeText: authorEdits.beforeText,
      afterText: authorEdits.afterText,
      beforeIntensity: authorEdits.beforeIntensity,
      afterIntensity: authorEdits.afterIntensity,
      categoryName: taxonomyCategories.name,
      bookTitle: books.title,
      bookSlug: books.slug,
      username: users.username,
      displayName: users.displayName,
    })
    .from(authorEdits)
    .innerJoin(books, eq(books.id, authorEdits.bookId))
    .innerJoin(users, eq(users.id, authorEdits.userId))
    .leftJoin(taxonomyCategories, eq(taxonomyCategories.id, authorEdits.categoryId))
    .orderBy(desc(authorEdits.createdAt))
    .limit(limit)
    .all();
}
