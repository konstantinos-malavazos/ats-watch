# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                                  # the whole suite (node --test "test/*.test.js")
node --test test/rank.test.js             # one file
node --test --test-name-pattern "budget"  # one test by name
./ats-watch --dry-run --limit 5           # a real run that writes no state
node tools/verify-feeds.mjs --all         # live field-coverage check, every board
node tools/verify-feeds.mjs --dump        # print a raw posting, for adding a mapping
```

`node --test test/` does **not** work on this Node build — it treats the
directory as the entry module. Always use the glob, which is what `npm test`
runs.

There is no build, no lint and no formatter. `npm` may not be installed on a
given machine; since `npm test` is only an alias, run its command directly.

## Hard constraints

These are enforced by CI (`.github/workflows/ci.yml`), not just convention:

- **Zero dependencies.** No `dependencies`, no `devDependencies`, no lockfile.
  The tool runs in a container with an ephemeral writable layer, so nothing can
  be installed at runtime. Never `npm install` anything.
- **Node >= 22.13.** Tested on 22.x and 24.x.
- **stdout is the product.** A normal run prints a plain-text digest and
  nothing else — no ANSI, no banners, capped at ~1500 chars so it pipes into a
  Discord message. Every log, warning and error goes to stderr. Zero new jobs
  prints nothing and exits 0.
- **`profile.md` is gitignored** and holds real salary and employment history.
  It goes to the ranker and nowhere else — never print, log or commit it.

## Architecture

One pipeline, in `ats-watch` (the executable entry point), each stage a pure
module in `lib/`:

```
fetch → normalise → dedupe → first-seen → filter → collapse re-listings
      → persist → rank → score cutoff → print
```

**`lib/schema.js` is the contract.** Every adapter must return objects with
exactly its twelve fields; `normalise()` fills defaults, computes `id` and
drops anything an adapter invented. Nothing downstream may add fields. It also
owns the shared helpers adapters lean on: `toIso`, `htmlToText`, `looksRemote`,
`formatSalary`.

**Adapters** (`lib/adapters/`) are one module per ATS — greenhouse, lever,
ashby, workable — each exporting `ats`, `buildUrl`, `parse(payload, company)`
and `fetchJobs(company, opts)`. `parse` is pure and network-free so it can run
against a fixture; all network lives in `fetchJobs` via `lib/http.js`.
`lib/adapters/index.js` is the only registry — `adapterFor()` is what makes
`companies.json` validation and the fetch loop fail identically for an unknown
ATS.

**Dedupe key is `(ats, company_token, ats_job_id)`** — the immutable board
token, not the display name, so renaming a company in `companies.json` doesn't
make all its postings look new. A job is new iff that tuple is absent from
state; a changed title or date does not make it new.

**State is written before ranking** (`ats-watch:102`), so a ranker failure can't
cause the same jobs to be reported as new tomorrow. `selectNew()` is pure and
returns the next state rather than mutating, which is what makes that correct.

**State is pruned on write.** An entry missing from the current run for more
than `PRUNE_AFTER_DAYS` (90) is dropped, so filled postings don't accumulate
forever. Only entries absent from *this* run are candidates — everything the run
saw has `last_seen === now` — so the window is 90 consecutive days off the
board, which is the margin that keeps a failing feed from re-reporting its whole
backlog as new.

**The title filter runs before the ranker** (`lib/filter.js`, `titleVerdict`).
Roughly two thirds of what these boards publish is sales, marketing,
recruitment, finance or customer success, and it used to cost a ranking each.
The rules are ordered and the last one decides the design: go-to-market titles
drop first (a Sales Engineer is not an engineer), an engineering word then
rescues a title from the back-office list ("Senior Frontend Engineer, Marketing
Website"), and **a title matching nothing is kept** — the filter never has to
recognise engineering to let a job through. Measured on 3497 live titles: 1562
dropped, and the only engineering-sounding casualties were three "Customer
Success Engineer" rows. Re-run that scan before widening either pattern, the
same way `looksRemote()` was widened. `--no-title-filter` turns it off.

**Re-listings are collapsed per run, never in state** (`lib/variants.js`).
Boards publish one opening once per country, each with its own `ats_job_id`, so
the dedupe tuple cannot see it — 1247 of those same 3497 rows were re-listings.
`collapseVariants()` groups on `(ats, company_token, baseTitle)` and returns a
side map of counts, which the renderers print as "also listed in N other
locations". `baseTitle()` only strips a trailing title segment when the
posting's own `location` field confirms it is a place, so "Backend Engineer,
Search" and "Backend Engineer, Payments" stay apart. The counts travel beside
the jobs rather than on them, because `lib/schema.js` owns the twelve fields.
State still records every `ats_job_id`, or tomorrow every collapsed copy would
look new.

**`--min-score <n>` is a print-time cutoff, applied after ranking.** Everything
fetched is still recorded as seen and everything selected is still ranked; only
the digest is shortened. Jobs the ranker returned no entry for, and runs where
ranking was unavailable, are never dropped by it — a short map from the model
parses exactly like a complete one, so the cutoff must not be able to turn that
into a role you never see. The daily Discord run uses `--min-score 7`; stdout
has no cutoff by default. `tools/daily-run.sh` posts a short "No jobs today"
line when the cutoff leaves nothing — the tool's silence is a contract, but a
silent Discord channel is indistinguishable from a broken cron job.

**The cron slot is chosen for DeepSeek's off-peak window.** Peak billing is
01:00-04:00 and 06:00-10:00 UTC, Monday to Friday; everything else is half
price. The run is at 14:00 Europe/Athens, i.e. 11:00 UTC in summer and 12:00
UTC in winter, off-peak on both sides of the DST change. The old 09:00 Athens
slot sat at 06:00 UTC, squarely in peak.

Two consequences that keep surprising people: `--limit` and `--since` filter
only what is *printed*. `nextState` is built from everything fetched, so a run
with either flag still marks every fetched posting as seen.

**There are two renderers.** `renderDigest()` is the product on stdout and is
hard-constrained: plain text, no ANSI, capped at `BUDGET` (1500) chars, whole
entries only, with a `+N more` tail when it runs out of room. `renderDiscord()`
targets the delivery path only, uses Discord markdown, and is deliberately
uncapped — `tools/post-discord.mjs` splits it on role boundaries via
`renderDiscordChunks()` and sends as many messages as it takes. The `+N more`
tail was silently hiding half of an eight-role digest; on a surface that can
send two messages, dropping jobs is the wrong trade. `--format discord`
selects it; `text` stays the default so the stdout contract is untouched.

**The ranker (`lib/rank.js`) must never throw and never lose the day's jobs.**
Every failure path — no key, network error, non-2xx, unparseable body, wrong
JSON shape — returns `null`, which the pipeline prints as the unranked list
while exiting 0. `parseRankingResponse` is deliberately forgiving: code fences,
prose around the JSON, and a bare array instead of the wrapper all recover.

## Working on this codebase

**Verify an endpoint or field name against a live response before writing code
against it.** The project's one real bug came from a guessed field name, and
the ranker's two live bugs (a token budget that didn't account for reasoning
tokens, a 60s timeout) both survived 12 passing tests because the tests used an
injected fake fetch. Passing offline tests do not mean the shape is right.

Adapter headers carry a STATUS line recording what was observed live and when.
Keep it accurate — it is the difference between a verified mapping and a
plausible one. Fixtures for ashby and workable are real trimmed responses; the
older greenhouse and lever ones are labelled SYNTHETIC and prove parsing only.

**Widen heuristics on evidence, not intuition.** `looksRemote()` gained
"home based" only after scanning all 3342 live postings showed it was the sole
missed phrasing (271 rows). "virtual" and "flexible" are excluded and pinned by
a test, because they misfire and no posting needed them.

The ranker's model is a reasoning model: hidden reasoning tokens come out of
`max_tokens` before any content is emitted, and a large batch takes minutes.
Both are env-tunable (`ATS_WATCH_LLM_MAX_TOKENS`, `ATS_WATCH_LLM_TIMEOUT_MS`).
The selection is sent in batches of at most 20 postings
(`ATS_WATCH_LLM_BATCH_SIZE`), one request at a time. Larger batches make the
model drop entries — it returns well-formed JSON with fewer rankings than
postings, which `parseRankingResponse` cannot detect, because a short map
parses exactly like a complete one. Observed repeatedly at 30. Scores are
absolute, so merging batches is sound; a batch that fails leaves its jobs
unranked rather than sinking the run, and `null` is returned only when every
batch fails.

CI never touches live ATS endpoints; that would fire twenty-five requests at
other people's job boards on every pull request. Live checks are the manual
`Verify feeds` workflow and `tools/verify-feeds.mjs`.
