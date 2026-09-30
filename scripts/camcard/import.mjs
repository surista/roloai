#!/usr/bin/env node
/**
 * One-off migration: loads the cards extracted by `extract.py` into RoloAI.
 *
 * Runs against the same public client SDK the apps use, signed in as the owner account, so the
 * deployed Firestore/Storage rules apply exactly as they do to a scan from the phone — no
 * service-account key to mint, hold, or leak for a job that happens once.
 *
 * Usage:
 *   node scripts/camcard/import.mjs <data-dir> [--dry-run] [--limit=N] [--keep-duplicates]
 *   node scripts/camcard/import.mjs <data-dir> --resync [--force]
 *                                            re-apply the mapping to imported cards that
 *                                            have not been edited since (--force: all of them)
 *
 * <data-dir> holds cards.json and images/ as written by extract.py. The password is read from
 * ROLOAI_PASSWORD, or prompted for (hidden) when run from a terminal.
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile, appendFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';

import {
  Timestamp,
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { dedupe, identityKeys, sharedAddresses } from './dedupe.mjs';
import { signIn } from './session.mjs';
import { eachLimited } from './util.mjs';

const run = promisify(execFile);

/** Matches `makeThumbnail` in the mobile app: 400px covers every list view at any density. */
const THUMB_WIDTH = 400;
/** Cards upload three files each; enough overlap to saturate the link, not enough to stall it. */
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const dataDir = args.find((a) => !a.startsWith('--'));
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : undefined;
};

if (!dataDir) {
  console.error(
    'usage: import.mjs <data-dir> [--dry-run] [--limit=N] [--keep-duplicates] [--resync [--force]]'
  );
  process.exit(1);
}

const dryRun = flag('dry-run');
const limit = Number(option('limit') ?? Infinity);

// ---------------------------------------------------------------- images

/**
 * Writes a small copy for the list views, or reuses the original when it is already small enough
 * — re-encoding a 336px-wide export at thumbnail quality would only throw away detail.
 *
 * CamCard's own export tops out at 1312px wide, comfortably under the 1600px the scan path
 * renders to, so the full-size image goes up untouched.
 */
async function thumbnail(source, destination) {
  if (existsSync(destination)) return destination;
  const { stdout } = await run('sips', ['-g', 'pixelWidth', source]);
  const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0);
  if (width > THUMB_WIDTH) {
    await run('sips', [
      '--resampleWidth', String(THUMB_WIDTH),
      '-s', 'format', 'jpeg',
      '-s', 'formatOptions', '60',
      source, '--out', destination,
    ]);
  } else {
    await copyFile(source, destination);
  }
  return destination;
}

async function upload(storage, storagePath, file) {
  const bytes = await readFile(file);
  const fileRef = ref(storage, storagePath);
  await uploadBytes(fileRef, bytes, { contentType: 'image/jpeg' });
  return getDownloadURL(fileRef);
}

// ---------------------------------------------------------------- import

/**
 * Uploads a card's photos, then writes the document.
 *
 * Same order as the scan path: Storage first, so a failed upload leaves no photo-less card
 * behind, and the id is minted up front because it keys the storage path.
 */
async function importCard(db, storage, card, imagesDir, thumbsDir) {
  const docRef = doc(collection(db, 'cards'));
  // A row whose Creation Date could not be read (extract.py warns about it) is stamped with the
  // import time: a real, sortable value rather than `null` in a storage path and a 1970 date.
  const createdAt = card.createdAt ?? Date.now();
  const stamp = createdAt;
  const images = {};

  // Whatever reached Storage, so a card that fails half way through can take its files with it.
  // Retrying writes under a fresh document id, which would otherwise leave the first attempt's
  // uploads in the bucket with nothing referencing them.
  const uploaded = [];
  const track = async (storagePath, file) => {
    const url = await upload(storage, storagePath, file);
    uploaded.push(url);
    return url;
  };

  // allSettled rather than all: on the first rejection Promise.all returns while the other
  // uploads are still running, and those would finish after the cleanup below had looked.
  const front = card.front && path.join(imagesDir, card.front);
  const jobs = [];
  if (front) {
    jobs.push(
      track(`cards/${docRef.id}/front-${stamp}.jpg`, front).then((url) => (images.imageUrl = url)),
      thumbnail(front, path.join(thumbsDir, card.front))
        .then((thumb) => track(`cards/${docRef.id}/thumb-${stamp}.jpg`, thumb))
        .then((url) => (images.thumbUrl = url))
    );
  }
  if (card.back) {
    jobs.push(
      track(`cards/${docRef.id}/back-${stamp}.jpg`, path.join(imagesDir, card.back)).then(
        (url) => (images.imageBackUrl = url)
      )
    );
  }
  const results = await Promise.allSettled(jobs);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) {
    await Promise.all(uploaded.map((url) => deleteObject(ref(storage, url)).catch(() => {})));
    throw failed.reason;
  }

  // createdAt is the date CamCard first scanned the card, as a Timestamp rather than the raw
  // millis: the list orders by createdAt, and Firestore sorts every number ahead of every
  // timestamp, so millis would bury seven years of imported cards under whatever was scanned in
  // the app.
  await setDoc(docRef, {
    firstName: card.firstName,
    lastName: card.lastName,
    ...(card.jobTitle ? { jobTitle: card.jobTitle } : {}),
    ...(card.company ? { company: card.company } : {}),
    phones: card.phones,
    emails: card.emails,
    ...(card.website ? { website: card.website } : {}),
    ...(card.address ? { address: card.address } : {}),
    ...(card.notes ? { notes: card.notes } : {}),
    tags: card.tags,
    source: card.source,
    imageUrl: images.imageUrl ?? '',
    ...(images.thumbUrl ? { thumbUrl: images.thumbUrl } : {}),
    ...(images.imageBackUrl ? { imageBackUrl: images.imageBackUrl } : {}),
    createdAt: Timestamp.fromMillis(createdAt),
    updatedAt: Timestamp.fromMillis(createdAt),
  });

  return docRef.id;
}

/** The text fields the export owns. Images, tags and createdAt belong to the card, not the row. */
const MAPPED_FIELDS = [
  'firstName',
  'lastName',
  'jobTitle',
  'company',
  'phones',
  'emails',
  'website',
  'address',
  'notes',
];

/**
 * Re-applies the export mapping to the cards a previous run created, for when the mapping itself
 * was wrong rather than the data.
 *
 * CamCard packs overflow values into the last slot of each group, newline-separated, which the
 * first extractor read as a single string — welding two phone numbers into one unusable number
 * and two URLs into one unusable website on 90 rows. The ledger already says which card each row
 * became, so the correction is an update rather than a re-import: photos, tags and the original
 * scan date stay exactly as they are.
 *
 * Only cards still as imported are touched. A card whose updatedAt has moved past its createdAt
 * was edited since (in the app, or by reextract.mjs --apply), and the export's OCR would undo
 * that; fields listed in reextract-backup.jsonl are skipped for the same reason. --force
 * overrides both.
 */
async function resync(db, cards, ledger, dataDir) {
  const byRow = new Map(cards.map((card) => [card.row, card]));
  const force = flag('force');

  // Fields reextract.mjs replaced, per card id.
  const backupPath = path.join(dataDir, 'reextract-backup.jsonl');
  const reread = new Map();
  if (!force && existsSync(backupPath)) {
    for (const line of (await readFile(backupPath, 'utf8')).split('\n').filter(Boolean)) {
      const { id, previous } = JSON.parse(line);
      reread.set(id, new Set([...(reread.get(id) ?? []), ...Object.keys(previous)]));
    }
  }

  const current = new Map();
  (await getDocs(query(collection(db, 'cards'), where('tags', 'array-contains', 'camcard')))).forEach(
    (snapshot) => current.set(snapshot.id, snapshot.data())
  );

  let changed = 0;
  let edited = 0;
  await eachLimited(
    ledger,
    async ({ row, id }) => {
      const card = byRow.get(row);
      if (!card) return;
      const data = current.get(id);
      if (!data) {
        console.log(`  gone row ${row} — card deleted, skipping`);
        return;
      }
      if (!force && data.updatedAt && data.createdAt && data.updatedAt.toMillis() > data.createdAt.toMillis()) {
        edited += 1;
        return;
      }

      const changes = {};
      for (const field of MAPPED_FIELDS) {
        if (reread.get(id)?.has(field)) continue;
        const next = card[field];
        const same =
          typeof next === 'object'
            ? JSON.stringify(next ?? []) === JSON.stringify(data[field] ?? [])
            : (next || '') === (data[field] ?? '');
        // A field the export no longer fills is removed rather than blanked, so the card reads
        // the same as one that never had it.
        if (!same) changes[field] = next === '' || next === undefined ? deleteField() : next;
      }
      if (!Object.keys(changes).length) return;

      try {
        // updatedAt stays at createdAt: this is the export being re-applied, not an edit, and
        // moving it would make the next resync treat the card as edited.
        await updateDoc(doc(db, 'cards', id), { ...changes, updatedAt: data.createdAt });
        changed += 1;
        console.log(`  row ${row} ${card.firstName} ${card.lastName}: ${Object.keys(changes).join(', ')}`);
      } catch (error) {
        console.error(`  FAILED row ${row}: ${error}`);
      }
    },
    CONCURRENCY
  );
  console.log(`\nresynced ${changed} cards, left ${edited} edited cards alone`);
}

async function main() {
  const imagesDir = path.join(dataDir, 'images');
  const thumbsDir = path.join(dataDir, 'thumbs');
  const ledgerPath = path.join(dataDir, 'ledger.jsonl');
  await mkdir(thumbsDir, { recursive: true });

  const all = JSON.parse(await readFile(path.join(dataDir, 'cards.json'), 'utf8'));
  const { keep, drop, shared } = flag('keep-duplicates')
    ? { keep: all, drop: [], shared: sharedAddresses(all) }
    : dedupe(all);

  // A previous run's rows, so an interrupted import resumes instead of duplicating what landed.
  const ledger = existsSync(ledgerPath)
    ? (await readFile(ledgerPath, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const done = new Set(ledger.map((entry) => entry.row));

  if (flag('resync')) {
    const { db } = await signIn();
    console.log(`resyncing ${ledger.length} imported cards against cards.json`);
    await resync(db, all, ledger, dataDir);
    process.exit(0);
  }

  console.log(`${all.length} cards in export, ${drop.length} duplicates dropped, ${keep.length} to consider`);
  if (shared.size) console.log(`  shared addresses ignored: ${[...shared].join(', ')}`);
  for (const { card, insteadOf } of drop) {
    const name = `${card.firstName} ${card.lastName}`.trim() || '(no name)';
    console.log(`  dup  row ${card.row} ${name} — superseded by row ${insteadOf.row}`);
  }

  const { db, storage } = await signIn();

  // Cards already in RoloAI win: they were read by Claude from a fresh scan rather than by
  // CamCard's OCR, so an incoming duplicate is strictly the worse copy.
  const existing = await getDocs(collection(db, 'cards'));
  const taken = new Set();
  existing.forEach((snapshot) => {
    for (const key of identityKeys(snapshot.data(), shared)) taken.add(key);
  });
  console.log(`${existing.size} cards already in RoloAI`);

  const pending = keep.filter((card) => {
    if (done.has(card.row)) return false;
    const clash = identityKeys(card, shared).find((key) => taken.has(key));
    if (clash) {
      console.log(`  skip row ${card.row} ${card.firstName} ${card.lastName} — ${clash} already in RoloAI`);
      return false;
    }
    return true;
  });

  const todo = pending.slice(0, limit);
  console.log(`\nimporting ${todo.length} cards${dryRun ? ' (dry run — nothing will be written)' : ''}`);
  if (dryRun) {
    for (const card of todo.slice(0, 10)) {
      console.log(`  row ${card.row} ${card.firstName} ${card.lastName} | ${card.company}`);
    }
    process.exit(0);
  }

  let count = 0;
  const failures = [];
  await eachLimited(todo, async (card) => {
    try {
      const id = await importCard(db, storage, card, imagesDir, thumbsDir);
      await appendFile(ledgerPath, `${JSON.stringify({ row: card.row, id })}\n`);
      count += 1;
      if (count % 25 === 0) console.log(`  ${count}/${todo.length}`);
    } catch (error) {
      failures.push({ row: card.row, error: String(error) });
      console.error(`  FAILED row ${card.row}: ${error}`);
    }
  }, CONCURRENCY);

  console.log(`\nimported ${count} cards, ${failures.length} failed`);
  if (failures.length) {
    await writeFile(path.join(dataDir, 'failures.json'), JSON.stringify(failures, null, 1));
    console.log('failures written to failures.json — rerun to retry them');
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
