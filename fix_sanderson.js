const { createClient } = require('@libsql/client');
const db = createClient({ url: 'file:data/tbra.db' });

const AUTHOR_ID = 'b6c79594-fbff-4337-8e1f-09856502c854';

// Series IDs
const SA_ID = 'e76ce964-a1f5-460c-87a4-6e842e76014d';
const MB_ID = '7d18e1a5-b26a-4432-819e-c060be586c6d';
const COSMERE_ID = '204b98d4-ee52-4a68-b98e-d451494de1f0';
const HT_ID = 'b517acf9-47ca-4630-9b35-996fea0a5130';
const SP_ID = '80af37b3-e6bb-4f9c-8de9-e35d0315aa2a';
const EL_ID = '5ae558ab-1610-4ea7-96f9-52afc3590e2e';
const TMS_ID = '45bb904f-d3b8-419c-8ee0-53adcc9b6e41';

// Canonical book IDs
const CANON = {
  wayOfKings: 'a6f643eb-edd9-4f23-96ab-b984297556b0',
  wordsOfRadiance: 'e56c6e38-96f4-4010-98d5-dec478e7e735',
  edgedancer: 'dc44e318-6c07-41cb-a1fc-127c62b2ff79',
  oathbringer: '9cdae90a-23e5-47d2-965d-1cb315fc617c',
  dawnshard: '32b3d408-8093-4f25-8d2b-3d2f0731d276',
  rhythmOfWar: 'c734d0d8-1f9e-4b77-b9bb-5f283324e47d',
  windAndTruth: '04ba7da3-114c-4029-8835-ad3abe2051f2',
  tress: '50e91b4b-17f8-4bf5-af6b-cb31962e334b',
  yumi: '15f9b827-07c9-42f5-ab7d-f5bcdea91b05',
  frugalWizard: '5ddfa059-5c54-4888-a0d7-565ede82795b',
  sunlitMan: '1eb6be8c-1e98-435f-8f33-839da2dadcef',
  emberdark: '429bb0cc-13f7-441a-be3e-836c77cbd2c8',
  elantris: 'a86d43c6-7b07-4379-859c-5d3f5f4f5654',
  emperorsSoul: '072af1a4-9222-46e6-ba05-83df50b6440e',
  warbreaker: 'e5713fac-7f78-4239-b322-e46b0a4535e9',
  arcanumUnbounded: 'def400ae-2640-4bea-b0bc-3a4e47743c41',
  finalEmpire: '8d8b4176-e183-4f0c-b408-d590b1341de7',
  wellOfAscension: 'aaf59507-34b1-47e0-ac77-52e4d8e12a5e',
  heroOfAges: 'cb183ae7-0f4d-404b-88e2-7ff9efd04826',
  alloyOfLaw: 'b382f13b-8626-447d-b8a1-55711f680d85',
  shadowsOfSelf: 'd02cb82e-5697-4ba6-b89c-b3b0417da35e',
  bandsOfMourning: '582ea620-c8b7-44a8-8071-5f84f2a9781c',
  lostMetal: '6418e03b-9441-4efc-8950-0d3bd4922a3a',
  secretHistory: '93a4db6b-5d94-428f-baa0-0a5e48de296e',
};

// GR-style duplicate IDs to delete
const GR_DUPES = [
  '9e5bd170-dfd8-4793-8cc9-84c79a2f1b30', // Way of Kings (SA #1)
  'c847aa07-b92b-42b1-b497-ef907c6bce5a', // Words of Radiance (SA #2)
  'abeca8bd-32d7-4814-aa48-4eef3f297977', // Edgedancer (SA #2.5)
  'bda91b87-444a-4803-b544-f177e5c7f267', // Oathbringer (SA #3)
  '2124fd62-2fd5-4f34-b1f2-2fe122cabec7', // Dawnshard (SA #3.5)
  'f1d601d6-3421-4182-82da-8dceda306972', // Rhythm of War (SA #4)
  'b88711c3-c72e-4cc7-b12a-8c9929b52ad3', // Wind and Truth (SA #5)
  'a5a60a4c-c122-4cf2-acd4-1a4b2b6df77a', // Tress (Hoid's #1)
  '75954ea7-43ec-4e7f-8881-6b40d8c4be46', // Elantris (Elantris #1)
  'a283522b-031c-4d04-9657-548cc1317320', // Mistborn: TFE (#1)
  'ad2f91f3-1734-46b6-9040-593944c3446f', // Well of Ascension (#2)
  '14243f6e-32da-4b0a-a0fd-555751094301', // Hero of Ages (#3)
  '42908a81-8446-4f19-918e-b069bc6bd2d0', // Alloy of Law (#4)
  '11cc8d92-4f13-4961-84bb-f3373d1c4aa0', // Shadows of Self (#5)
  'e6947d69-9b69-47a6-b40d-06410a85fcf9', // Lost Metal (#7)
  '010f5d6a-1ca8-4504-b4b7-3b389f877d60', // Lost Metal (TMS #7)
];

// Other junk to delete
const JUNK_BOOKS = [
  '6f55fa92-6688-4f09-8dda-e3bc027d798a', // "Mistborn" (wrong title, 1712 pages, year 2001)
  '34ce1df4-4694-4939-8d98-ea538a378ef9', // "Mistborn: The Final Empire" (dupe of The Final Empire)
  '9f06745c-4afc-49f5-9169-a9d23c5327a7', // Mistborn Saga 7 Book Series (junk)
  '3a6a7773-440a-496e-a82b-51a3bf9b2cf1', // Untitled Mistborn 1 Of 2 (junk)
  'c9f0dba0-a188-4e94-87e2-6493acffe4c6', // Nacidos de la Bruma / Mistborn (Spanish dupe)
  '3fd574aa-a030-4cd9-b1ca-03840fa1e790', // Tales from the Cosmere (not a real book)
];

async function run() {
  const stmts = [];
  
  // =====================================================
  // STEP 1: Merge user data from "Mistborn" and "Mistborn: TFE" to "The Final Empire"
  // =====================================================
  // User c2f3eb27 has review+rating on "Mistborn" but NOT on "The Final Empire" - move it
  stmts.push({ sql: "UPDATE user_book_reviews SET book_id = ? WHERE book_id = ? AND user_id = ? AND NOT EXISTS (SELECT 1 FROM user_book_reviews WHERE book_id = ? AND user_id = ?)", 
    args: [CANON.finalEmpire, '6f55fa92-6688-4f09-8dda-e3bc027d798a', 'c2f3eb27-139f-4605-9566-8ded8d9e1336', CANON.finalEmpire, 'c2f3eb27-139f-4605-9566-8ded8d9e1336'] });
  stmts.push({ sql: "UPDATE user_book_ratings SET book_id = ? WHERE book_id = ? AND user_id = ? AND NOT EXISTS (SELECT 1 FROM user_book_ratings WHERE book_id = ? AND user_id = ?)",
    args: [CANON.finalEmpire, '6f55fa92-6688-4f09-8dda-e3bc027d798a', 'c2f3eb27-139f-4605-9566-8ded8d9e1336', CANON.finalEmpire, 'c2f3eb27-139f-4605-9566-8ded8d9e1336'] });

  // =====================================================
  // STEP 2: Delete all user data from GR dupes + junk (all conflicts - canonical already has the data)
  // =====================================================
  const allDupes = [...GR_DUPES, ...JUNK_BOOKS];
  for (const id of allDupes) {
    stmts.push({ sql: "DELETE FROM user_book_state WHERE book_id = ?", args: [id] });
    stmts.push({ sql: "DELETE FROM user_book_reviews WHERE book_id = ?", args: [id] });
    stmts.push({ sql: "DELETE FROM user_book_ratings WHERE book_id = ?", args: [id] });
    stmts.push({ sql: "DELETE FROM user_book_dimension_ratings WHERE review_id IN (SELECT id FROM user_book_reviews WHERE book_id = ?)", args: [id] });
    stmts.push({ sql: "DELETE FROM user_favorite_books WHERE book_id = ?", args: [id] });
    stmts.push({ sql: "DELETE FROM user_hidden_books WHERE book_id = ?", args: [id] });
    stmts.push({ sql: "DELETE FROM book_category_ratings WHERE book_id = ?", args: [id] });
    stmts.push({ sql: "DELETE FROM book_series WHERE book_id = ?", args: [id] });
    stmts.push({ sql: "DELETE FROM book_authors WHERE book_id = ?", args: [id] });
    stmts.push({ sql: "DELETE FROM book_genres WHERE book_id = ?", args: [id] });
    stmts.push({ sql: "DELETE FROM book_narrators WHERE book_id = ?", args: [id] });
    stmts.push({ sql: "DELETE FROM landing_page_books WHERE book_slug = (SELECT slug FROM books WHERE id = ?)", args: [id] });
    stmts.push({ sql: "DELETE FROM books WHERE id = ?", args: [id] });
  }

  // Also handle SA box set - mark as box_set, keep in SA series
  stmts.push({ sql: "UPDATE books SET is_box_set = 1 WHERE id = 'c7425b76-1f5a-4990-9b35-2ae23c686712'", args: [] });
  // Secret Projects box set - already is_box_set = 1, keep in Secret Projects
  stmts.push({ sql: "UPDATE books SET is_box_set = 1 WHERE id = '39b5e892-3ad0-4cdf-b561-f30e84dd36a8'", args: [] });
  // Mistborn Saga 7 Book Series - mark box set (but we're deleting it anyway)
  
  // =====================================================
  // STEP 3: Delete "The Mistborn Saga" series (merging into Mistborn)
  // =====================================================
  // Remove The Final Empire from TMS (it's already in Mistborn)
  stmts.push({ sql: "DELETE FROM book_series WHERE series_id = ?", args: [TMS_ID] });
  stmts.push({ sql: "DELETE FROM series WHERE id = ?", args: [TMS_ID] });

  // =====================================================  
  // STEP 4: Fix Hoid's Travails - should have Tress pos 1 and Yumi pos 2
  // =====================================================
  // Tress is already in HT at pos 1 - good
  // Yumi is already in HT at pos 2 - good  
  // Remove Yumi from Secret Projects (it belongs in HT)
  stmts.push({ sql: "DELETE FROM book_series WHERE book_id = ? AND series_id = ?", args: [CANON.yumi, SP_ID] });
  // Remove Tress from Secret Projects (it belongs in HT)
  stmts.push({ sql: "DELETE FROM book_series WHERE book_id = ? AND series_id = ?", args: [CANON.tress, SP_ID] });

  // =====================================================
  // STEP 5: Fix Secret Projects - Emberdark, Frugal Wizard, Sunlit Man
  // =====================================================
  // Move Sunlit Man from Cosmere to Secret Projects
  stmts.push({ sql: "DELETE FROM book_series WHERE book_id = ? AND series_id = ?", args: [CANON.sunlitMan, COSMERE_ID] });
  stmts.push({ sql: "INSERT OR REPLACE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)", args: [CANON.sunlitMan, SP_ID, 3] });
  
  // Move Emberdark from Cosmere to Secret Projects
  stmts.push({ sql: "DELETE FROM book_series WHERE book_id = ? AND series_id = ?", args: [CANON.emberdark, COSMERE_ID] });
  stmts.push({ sql: "INSERT OR REPLACE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)", args: [CANON.emberdark, SP_ID, 4] });
  
  // Frugal Wizard stays at pos 2, now update positions:
  // 1 = Frugal Wizard, 2 = Sunlit Man, 3 = Isles of the Emberdark
  // Actually let me use: 1=Frugal Wizard, 2=Sunlit Man, 3=Emberdark
  stmts.push({ sql: "UPDATE book_series SET position_in_series = 1 WHERE book_id = ? AND series_id = ?", args: [CANON.frugalWizard, SP_ID] });
  // Sunlit Man already inserted at 3, update to 2
  stmts.push({ sql: "UPDATE book_series SET position_in_series = 2 WHERE book_id = ? AND series_id = ?", args: [CANON.sunlitMan, SP_ID] });
  // Emberdark already inserted at 4, update to 3
  stmts.push({ sql: "UPDATE book_series SET position_in_series = 3 WHERE book_id = ? AND series_id = ?", args: [CANON.emberdark, SP_ID] });

  // =====================================================
  // STEP 6: Fix Elantris series - add Emperor's Soul
  // =====================================================
  // Elantris already in Elantris series at pos 1
  stmts.push({ sql: "INSERT OR REPLACE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)", args: [CANON.emperorsSoul, EL_ID, 2] });

  // =====================================================
  // STEP 7: Rename Cosmere to "Cosmere (Other)" and set up books
  // =====================================================
  stmts.push({ sql: "UPDATE series SET name = 'Cosmere (Other)', slug = 'cosmere-other-brandon-sanderson' WHERE id = ?", args: [COSMERE_ID] });
  // After removing Sunlit Man and Emberdark (done above), add Warbreaker and Elantris
  stmts.push({ sql: "INSERT OR REPLACE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)", args: [CANON.warbreaker, COSMERE_ID, 1] });
  stmts.push({ sql: "INSERT OR REPLACE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)", args: [CANON.elantris, COSMERE_ID, 2] });
  // Arcanum Unbounded is already in Cosmere, set position
  stmts.push({ sql: "UPDATE book_series SET position_in_series = 3 WHERE book_id = ? AND series_id = ?", args: [CANON.arcanumUnbounded, COSMERE_ID] });

  // =====================================================
  // STEP 8: Fix Stormlight Archive - supplementary markers
  // =====================================================
  // No is_supplementary column exists on book_series. The positions 2.5/3.5 already indicate companion status.
  // Just ensure clean positions after dupe removal. The canonical books are:
  // pos 1: Way of Kings, pos 2: Words of Radiance, pos 2.5: Edgedancer, 
  // pos 3: Oathbringer, pos 3.5: Dawnshard, pos 4: Rhythm of War, pos 5: Wind and Truth
  // These are already correct. SA box set stays.

  // =====================================================
  // STEP 9: Fix Mistborn series - clean titles and positions  
  // =====================================================
  // After deleting dupes, Mistborn series will have:
  // pos 1: The Final Empire, pos 2: Well of Ascension, pos 3: Hero of Ages
  // pos 4: Alloy of Law, pos 5: Shadows of Self, pos 6: Bands of Mourning, pos 7: Lost Metal
  // Secret History at null position - set to 3.5 (between Era 1 and Era 2)
  stmts.push({ sql: "UPDATE book_series SET position_in_series = 3.5 WHERE book_id = ? AND series_id = ?", args: [CANON.secretHistory, MB_ID] });

  // =====================================================
  // STEP 10: Fix publication years
  // =====================================================
  stmts.push({ sql: "UPDATE books SET publication_year = 2014 WHERE id = ?", args: [CANON.wordsOfRadiance] }); // Words of Radiance is 2014 not 2012
  
  // =====================================================
  // STEP 11: Mark SA box set as is_box_set (already done above)
  // Add SA box set to Stormlight Archive series if not already
  // =====================================================
  const saBoxId = 'c7425b76-1f5a-4990-9b35-2ae23c686712';
  // Check if it's in the series already - it showed as series:NONE
  stmts.push({ sql: "INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, NULL)", args: [saBoxId, SA_ID] });

  // =====================================================
  // STEP 12: Set Elantris series slug
  // =====================================================
  stmts.push({ sql: "UPDATE series SET slug = 'elantris-brandon-sanderson' WHERE id = ?", args: [EL_ID] });

  console.log(`Executing ${stmts.length} statements...`);
  
  let executed = 0;
  for (const stmt of stmts) {
    try {
      await db.execute(stmt);
      executed++;
    } catch (e) {
      console.error(`FAILED: ${stmt.sql} | args: ${JSON.stringify(stmt.args)} | error: ${e.message}`);
    }
  }
  console.log(`Done. Executed ${executed}/${stmts.length} statements successfully.`);
}

run().catch(e => console.error(e));
