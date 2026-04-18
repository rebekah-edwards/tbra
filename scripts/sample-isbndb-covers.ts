import { config } from 'dotenv';
config({ path: '.env.vercel.local' });
import { createClient } from '@libsql/client';
import { createHash } from 'crypto';

async function fetchAndHash(url: string): Promise<{ size: number; hash: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      size: buf.length,
      hash: createHash('sha256').update(buf).digest('hex'),
    };
  } catch {
    return null;
  }
}

async function main() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  // Get 50 random isbndb-sourced books
  const { rows } = await client.execute(`
    SELECT slug, title, cover_image_url
    FROM books
    WHERE cover_image_url LIKE 'https://images.isbndb.com/covers/%'
    ORDER BY random()
    LIMIT 50
  `);

  console.log(`Sampling ${rows.length} ISBNdb covers...`);
  const hashCounts = new Map<string, { size: number; count: number; examples: string[] }>();
  const PLACEHOLDER_HASH = '56c3e12f87260f78db39b9deeb0d04194e110c99702e6483963f2ab009bfea15';

  for (const r of rows as any[]) {
    const result = await fetchAndHash(r.cover_image_url);
    if (!result) continue;
    const existing = hashCounts.get(result.hash);
    if (existing) {
      existing.count++;
      if (existing.examples.length < 3) existing.examples.push(r.slug);
    } else {
      hashCounts.set(result.hash, { size: result.size, count: 1, examples: [r.slug] });
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  // Report: sort by count descending
  const sorted = [...hashCounts.entries()].sort((a, b) => b[1].count - a[1].count);
  console.log('\nHash / size / count distribution:');
  for (const [hash, info] of sorted.slice(0, 10)) {
    const isPlaceholder = hash === PLACEHOLDER_HASH ? ' ← PLACEHOLDER' : '';
    console.log(`  size=${info.size.toString().padStart(7)}  count=${info.count}  hash=${hash.slice(0, 12)}...${isPlaceholder}`);
    if (info.count > 1) console.log(`    examples: ${info.examples.join(', ')}`);
  }
  console.log(`\nTotal unique hashes: ${hashCounts.size} (out of ${rows.length} sampled)`);
  const placeholderCount = hashCounts.get(PLACEHOLDER_HASH)?.count ?? 0;
  console.log(`Placeholder hash hits in sample: ${placeholderCount} / ${rows.length} = ${((placeholderCount / rows.length) * 100).toFixed(1)}%`);

  client.close();
}

main();
