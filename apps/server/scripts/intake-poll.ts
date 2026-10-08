// pnpm intake:poll — one live intake pass: registers the token's Ring devices under
// the demo home, polls their event history and stores new events in DATABASE_PATH.
// Safe to run repeatedly; already-stored events are skipped.

import { desc } from 'drizzle-orm';
import { openDb } from '../src/db/client.ts';
import { events } from '../src/db/schema.ts';
import { ensureHome, pollAllDevices, syncDevices } from '../src/intake/intake.ts';
import { createRingClient, isTokenExpired, TOKEN_EXPIRED_MESSAGE } from '../src/ring/client.ts';

const DEMO_HOME_ID = 'demo';

async function main() {
  const dbPath = new URL(`../../../${process.env.DATABASE_PATH ?? './data/app.db'}`, import.meta.url).pathname;
  const db = openDb(dbPath);
  const ring = createRingClient();

  ensureHome(db, {
    id: DEMO_HOME_ID,
    name: 'Demo home',
    parentName: 'Parent',
    parentTelegramChatId: process.env.DEMO_PARENT_TELEGRAM_CHAT_ID || undefined,
  });

  const deviceCount = await syncDevices(db, ring, DEMO_HOME_ID);
  console.log(`Devices registered under home "${DEMO_HOME_ID}": ${deviceCount}`);

  for (const r of await pollAllDevices(db, ring)) {
    console.log(`${r.deviceName}: fetched ${r.fetched}, new ${r.inserted}, already stored ${r.duplicate}`);
  }

  const ist = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' });
  const latest = db.select().from(events).orderBy(desc(events.occurredAt)).limit(10).all();
  console.log(`\nNewest stored events (${latest.length} shown):`);
  for (const e of latest) {
    console.log(`  ${ist.format(e.occurredAt)} IST  ${e.type.padEnd(16)} ${e.subType ?? '-'}  ${e.source}`);
  }
}

try {
  await main();
} catch (err) {
  if (isTokenExpired(err)) {
    console.error(TOKEN_EXPIRED_MESSAGE);
    process.exit(2);
  }
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
