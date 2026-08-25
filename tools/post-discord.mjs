#!/usr/bin/env node
// Post a rendered digest to a Discord webhook, splitting it across messages.
//
// Reads the digest on stdin, so it composes with the pipeline the same way
// everything else here does:
//
//   ats-watch --format discord | tools/post-discord.mjs
//
// Discord caps a message at 2000 characters. Rather than truncating - which
// is the bug this replaced, where half the roles vanished behind "+N more" -
// the digest is split on role boundaries and sent as several messages.
//
// Exit 0 on success, 1 on any delivery failure, with the undelivered digest
// written to stderr so a failed post lands in the cron log rather than
// disappearing.

import { renderDiscordChunks } from '../lib/render.js';

const webhook = process.env.ATS_WATCH_DISCORD_WEBHOOK;
const TIMEOUT_MS = 30000;
/** Discord's webhook bucket is tight; a beat between messages avoids 429s. */
const GAP_MS = 700;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readStdin() {
  let s = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

/** POST one message. Retries once on 429, honouring retry_after. */
async function post(content, attempt = 0) {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // flags 4 = SUPPRESS_EMBEDS. The digest is already a list of links; left
    // to itself Discord would unfurl every one of them into a preview card.
    body: JSON.stringify({ content, flags: 4 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (res.status === 429 && attempt === 0) {
    const body = await res.json().catch(() => ({}));
    const waitMs = Math.ceil((Number(body.retry_after) || 1) * 1000);
    process.stderr.write(`warn: rate limited, retrying in ${waitMs}ms\n`);
    await sleep(waitMs);
    return post(content, attempt + 1);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
}

const digest = await readStdin();

if (!digest.trim()) {
  process.stderr.write('info: no new jobs - nothing posted\n');
  process.exit(0);
}

if (!webhook) {
  process.stderr.write('error: ATS_WATCH_DISCORD_WEBHOOK not set - digest not posted:\n');
  process.stderr.write(`${digest}\n`);
  process.exit(1);
}

const chunks = renderDiscordChunks(digest);

for (let i = 0; i < chunks.length; i++) {
  if (i > 0) await sleep(GAP_MS);
  try {
    await post(chunks[i]);
  } catch (err) {
    process.stderr.write(`error: message ${i + 1}/${chunks.length} failed: ${err.message}\n`);
    process.stderr.write('undelivered digest follows:\n');
    process.stderr.write(`${digest}\n`);
    process.exit(1);
  }
}

process.stderr.write(`info: posted digest to Discord in ${chunks.length} message(s)\n`);
