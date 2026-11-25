/**
 * Cases for src/lib/text/description-language.ts. No DB.
 *   npx tsx scripts/test-description-language.ts
 * Add a case whenever a new false positive/negative shows up in the audit.
 */
import { detectDescriptionLanguage, nonEnglishIsbnGroup } from "../src/lib/text/description-language";

const cases: [string, boolean, string][] = [
  [`Paperback. 13,70 / 21,00 cm. In Turkish. 640 p. Translated by Serkan Göktas "Bu kitabi okumak, bir video oyununun içine dalmak gibi: Sanderson'in tüm aksiyon ve savas sahneleri birer saheser." Yenilen, ezilen ve nesli tükenmek üzere olan insan irkindan küçük bir grup, sürekli gizemli uzaylilar Krell'lerin saldirisina ugrayan bir gezegende mahsur kalir.`, false, "Turkish, diacritics stripped (Skyward)"],
  [`Dans ce deuxième tome, Joe Henderson, scénariste et showrunner (Lucifer) et Lee Garbett continuent de donner vie à Willa, toujours plus combattive, dans un monde où la gravitation n'est plus mais où les faux-semblants demeurent.`, false, "French"],
  [`Die Welt zu retten, ist eine Aufgabe, auf die dich keine Zauberschule vorbereiten kann. Aber El ist fest entschlossen, und sie wird nicht aufgeben, bis sie und ihre Freunde in Sicherheit sind.`, false, "German"],
  [`¡Llega la nueva novela de Stephenie Meyer! Revive la historia de amor inmortal de Crepúsculo contada desde la perspectiva de Edward Cullen. Best seller número uno del New York Times. ${"Una historia de amor y de peligro que cambia todo. ".repeat(6)}ENGLISH DESCRIPTION When Edward Cullen and Bella Swan met in Twilight, an iconic love story was born. But until now, fans have heard only Bella's side of the story. ${"At last, readers can experience Edward's version of the story in the companion novel. ".repeat(10)}`, false, "bilingual, Spanish first"],
  [`Mikael Blomkvist, ekonomireporter, döms till fängelse för förtal av finansmannen Wennerström. Han tar sig an ett uppdrag som visar sig vara mer än det verkar, och det som han hittar är inte vad han väntade sig.`, false, "Swedish"],
  [`Now pilots are the heroes of what's left of the human race, and becoming one has always been Spensa's dream. Since she was a little girl, she has imagined soaring skyward and proving her bravery.`, true, "English"],
  [`From writer JOE HENDERSON (showrunner of Fox's Lucifer) and artist LEE GARBETT (Lucifer, Loki: Agent of Asgard) comes the story of a young woman's journey to find her place in a world where gravity has gone haywire.`, true, "English, names only"],
  [`𝐌𝐢𝐝𝐧𝐢𝐠𝐡𝐭 𝐒𝐭𝐫𝐢𝐤𝐞𝐬 𝐎𝐧 𝐀𝐥𝐥 𝐇𝐚𝐥𝐥𝐨𝐰𝐬 𝐄𝐯𝐞, where a summoning goes wrong and the town learns what was waiting for them in the dark. She has one night to send it back before it takes all of them with it.`, true, "styled-Unicode English"],
  [`Set in Barcelona, the novel follows Daniel as he discovers La Sombra del Viento, a book by Julián Carax, in the Cemetery of Forgotten Books — and learns that someone has been burning every copy of it.`, true, "English with a Spanish title quoted"],
  [`A retelling of a classic.`, true, "too short to judge"],
];

let fail = 0;
for (const [text, wantEnglish, name] of cases) {
  const v = detectDescriptionLanguage(text);
  const ok = v.english === wantEnglish;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name} → english=${v.english}${v.language ? ` (${v.language})` : ""} en=${v.englishHits} f=${v.foreignHits}`);
}
const isbns: [string, string | null][] = [["9786050979350", "Turkish"], ["9780399555770", null], ["9798888888888", null], ["9783453319233", "German"], ["9788419130372", "Spanish"]];
for (const [isbn, want] of isbns) {
  const got = nonEnglishIsbnGroup(isbn);
  if (got !== want) fail++;
  console.log(`${got === want ? "ok  " : "FAIL"} ISBN ${isbn} → ${got}`);
}
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
