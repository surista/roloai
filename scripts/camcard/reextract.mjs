#!/usr/bin/env node
/**
 * Re-reads imported cards with Claude, replacing CamCard's OCR with what the card photo says.
 *
 * CamCard's own text extraction failed outright on a handful of the imported rows — an address
 * of `RrggrpsebaTgil-5-1 2f Iy y 9XAQIH\\I@e) L`, an email of `itb@fbw5il`. The photos are in
 * Storage, so those cards can simply be read again by the `extractCard` function the app
 * already uses for a fresh scan.
 *
 * Two phases, because the reading costs money and the writing is destructive:
 *
 *   node scripts/camcard/reextract.mjs <data-dir> [--all] [--limit=N]   read, write proposals
 *   node scripts/camcard/reextract.mjs <data-dir> --apply               write the reviewed set
 *
 * Proposals land in <data-dir>/reextract.json for inspection before anything is applied, and
 * --apply keeps every replaced field in <data-dir>/reextract-backup.jsonl so it can be undone.
 */
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { merge, suspicions } from './review.mjs';
import { signIn } from './session.mjs';
import { eachLimited } from './util.mjs';

/** The function is capped at maxInstances 3; more callers in flight would just queue. */
const CONCURRENCY = 3;
const IMPORT_TAG = 'camcard';

const args = process.argv.slice(2);
const dataDir = args.find((a) => !a.startsWith('--'));
const flag = (name) => args.includes(`--${name}`);
const limit = Number(args.find((a) => a.startsWith('--limit='))?.slice(8) ?? Infinity);

if (!dataDir) {
  console.error('usage: reextract.mjs <data-dir> [--all] [--limit=N] [--apply]');
  process.exit(1);
}

const proposalsPath = path.join(dataDir, 'reextract.json');
const backupPath = path.join(dataDir, 'reextract-backup.jsonl');

// ---------------------------------------------------------------- images

/**
 * The card's photos as base64, preferring the copies already on disk.
 *
 * The export images are the same bytes that were uploaded, so re-downloading 800 files from
 * Storage to send them straight back out would be pure round trip. Cards imported before the
 * ledger existed, or scanned in the app, still fall back to their download URL.
 */
async function imagesFor(card, row, imagesDir) {
  const read = async (localName, url) => {
    if (localName) {
      const local = path.join(imagesDir, localName);
      if (existsSync(local)) return (await readFile(local)).toString('base64');
    }
    if (!url) return undefined;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`could not fetch ${url}: ${response.status}`);
    return Buffer.from(await response.arrayBuffer()).toString('base64');
  };
  return {
    front: await read(row && `${row}-front.jpg`, card.imageUrl),
    back: await read(row && `${row}-back.jpg`, card.imageBackUrl),
  };
}

// ---------------------------------------------------------------- phases

async function loadCards(db) {
  const snapshot = await getDocs(
    query(collection(db, 'cards'), where('tags', 'array-contains', IMPORT_TAG))
  );
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** row number per card id, so a card can find its local photos. */
async function loadLedger(dataDir) {
  const ledgerPath = path.join(dataDir, 'ledger.jsonl');
  if (!existsSync(ledgerPath)) return new Map();
  const lines = (await readFile(ledgerPath, 'utf8')).split('\n').filter(Boolean);
  return new Map(lines.map((line) => JSON.parse(line)).map(({ id, row }) => [id, row]));
}

async function plan(db, functions, dataDir) {
  const imagesDir = path.join(dataDir, 'images');
  const cards = await loadCards(db);
  const rows = await loadLedger(dataDir);
  console.log(`${cards.length} cards tagged "${IMPORT_TAG}"`);

  const scored = cards.map((card) => ({ card, reasons: suspicions(card) }));
  const candidates = (flag('all') ? scored : scored.filter((c) => c.reasons.length)).slice(0, limit);

  console.log(`re-reading ${candidates.length}${flag('all') ? '' : ' that look misread'}\n`);
  if (!candidates.length) return;

  const extractCard = httpsCallable(functions, 'extractCard');
  const proposals = [];
  const failures = [];
  let done = 0;

  await eachLimited(candidates, async ({ card, reasons }) => {
    const name = `${card.firstName ?? ''} ${card.lastName ?? ''}`.trim() || '(no name)';
    try {
      const { front, back } = await imagesFor(card, rows.get(card.id), imagesDir);
      if (!front) throw new Error('no front image');
      const { data } = await extractCard({ frontImageBase64: front, backImageBase64: back });
      const changes = merge(card, data);
      if (Object.keys(changes).length) proposals.push({ id: card.id, name, reasons, changes, before: card });
      console.log(`  ${name}: ${Object.keys(changes).join(', ') || 'no change'}`);
    } catch (error) {
      failures.push({ id: card.id, name, error: String(error) });
      console.error(`  FAILED ${name}: ${error}`);
    }
    done += 1;
    if (done % 25 === 0) console.log(`  — ${done}/${candidates.length}`);
  }, CONCURRENCY);

  await writeFile(proposalsPath, JSON.stringify(proposals, null, 1));
  console.log(`\n${proposals.length} cards to change, ${failures.length} failed`);
  console.log(`review ${proposalsPath}, then rerun with --apply`);
}

async function apply(db, dataDir) {
  if (!existsSync(proposalsPath)) {
    console.error(`no ${proposalsPath} — run without --apply first`);
    process.exit(1);
  }
  const proposals = JSON.parse(await readFile(proposalsPath, 'utf8'));
  console.log(`applying ${proposals.length} cards`);

  let count = 0;
  for (const { id, name, changes, before } of proposals) {
    // The replaced values, written before the update rather than after, so an interrupted run
    // still leaves every card it touched recoverable.
    const previous = Object.fromEntries(Object.keys(changes).map((key) => [key, before[key] ?? null]));
    await appendFile(backupPath, `${JSON.stringify({ id, previous })}\n`);
    await updateDoc(doc(db, 'cards', id), { ...changes, updatedAt: serverTimestamp() });
    count += 1;
    console.log(`  ${name}: ${Object.keys(changes).join(', ')}`);
  }
  console.log(`\nupdated ${count} cards; previous values in ${backupPath}`);
}

async function main() {
  const { db, functions } = await signIn();
  if (flag('apply')) await apply(db, dataDir);
  else await plan(db, functions, dataDir);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
