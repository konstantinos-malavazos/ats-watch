# ats-watch

A personal daily job watcher. Pulls open roles from public, unauthenticated ATS
feeds, keeps the ones it has never seen before, and (once a provider is wired
in) has an LLM rank them against your profile.

Personal use only. No auth, no scraping of logged-in sites, no republishing.

## Status

Phase 1. The full fetch → normalise → dedupe → persist → first-seen → filter →
rank → print pipeline is implemented and tested offline (131 tests). Two things
are still open, both blocked on the authoring environment rather than on design
— see **Known gaps**: no seed companies, and the ATS field mappings are
unverified.

## Requirements

Node >= 22.13.0. **Zero npm dependencies** — nothing is installed at runtime,
which is what makes this safe to run in a container with an ephemeral writable
layer.

State is a plain JSON file (`.ats-watch-state.json`), not `node:sqlite`. See
**Why not node:sqlite** below.

## Usage

```
./ats-watch                    # normal run: print a digest of new roles
node ./ats-watch               # identical; both invocation styles work
./ats-watch --dry-run          # fetch and rank, write no state
./ats-watch --since 7d         # only roles posted in the last week
./ats-watch --since 2026-01-15 # ISO dates work too
./ats-watch --limit 10         # cap the digest
./ats-watch --no-rank          # skip ranking, print the unranked list
./ats-watch --quiet            # suppress info-level stderr chatter
./ats-watch --help
```

### stdout is the product

A normal run prints a short plain-text digest to stdout and **nothing else** —
no ANSI colour, no banners, capped at 1500 characters so it can be piped
straight into a Discord message. All logging, warnings and errors go to stderr.

**Zero new jobs prints nothing and exits 0.** Silence is a valid successful run.

Exit codes: `0` success (including no news), `1` the run could not complete,
`2` bad usage.

## Configuration

`companies.json` — the boards to watch:

```json
{ "companies": [ { "name": "Acme", "ats": "greenhouse", "token": "acme" } ] }
```

`ats` is `greenhouse` or `lever`. `token` is the board token (Greenhouse) or
site slug (Lever) that appears in the feed URL.

`profile.md` — your background and what you want, sent verbatim to the ranker.
It ships as a template with `TODO`s; fill it in before ranking is worth much.

### Ranker

The ranker POSTs to an OpenAI-compatible `/v1/chat/completions` endpoint,
defaulting to DeepSeek:

| Variable | Default | |
|---|---|---|
| `ATS_WATCH_LLM_API_KEY` | — | required; falls back to `DEEPSEEK_API_KEY` |
| `ATS_WATCH_LLM_BASE_URL` | `https://api.deepseek.com` | |
| `ATS_WATCH_LLM_MODEL` | `deepseek-v4-pro` | |

```
export DEEPSEEK_API_KEY=sk-...
./ats-watch
```

The base URL is configurable because it could not be confirmed from the
authoring environment (see **Known gaps**), so a wrong default is an env change
rather than a code change. Point it at any OpenAI-compatible endpoint.

**Every ranker failure degrades to the unranked list**: no key, a network
error, a non-2xx, a timeout, or a response that is not the JSON we asked for.
Each warns on stderr, prints the plain list on stdout and exits 0, so a bad API
day never costs you the day's jobs. The API key is never written to stdout,
stderr or the state file.

## Sources

| ATS | Endpoint | Status |
|---|---|---|
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | Implemented, field mapping **unverified** |
| Lever | `https://api.lever.co/v0/postings/{site}?mode=json` | Implemented, field mapping **unverified** |
| Ashby | — | **Not implemented** (endpoint could not be verified) |
| Workable | — | **Not implemented** (endpoint could not be verified) |

Explicitly out of scope: LinkedIn, Indeed, Glassdoor, and anything behind
Cloudflare or a login.

Fetching is polite by construction: strictly sequential requests, a ~1s delay
between them, a real User-Agent, and a 15s per-request timeout. **One failing
source never aborts the run** — it degrades and reports the failure on stderr.

## Known gaps

These are honest gaps, not oversights. Each is blocked on something outside the
authoring session.

1. **No seed companies.** `companies.json` ships empty. The environment this
   was built in had every ATS host blocked by its network egress policy, so no
   board token could be confirmed to return 200 with jobs. Inventing plausible
   tokens would have produced a list that 404s on first run. Add your own and
   verify each with the `curl` one-liners in `companies.json`.

2. **The Greenhouse and Lever field mappings are INFERRED.** The two endpoint
   URLs came from the project brief, but no live response was ever fetched, so
   the response field names (`absolute_url`, `first_published`, `hostedUrl`,
   `createdAt`, `workplaceType`, …) are unverified. The adapters are defensive
   and degrade rather than crash, but **re-check them against a real response
   before trusting field coverage.** The test fixtures are hand-built to the
   inferred shape and are labelled `SYNTHETIC` — they prove the parsing logic,
   not the shape.

3. **Ashby and Workable are unimplemented.** The brief required verifying their
   endpoints with a real request first. That was impossible, so per the brief
   they were left out rather than guessed at.

4. **The DeepSeek endpoint is INFERRED.** `https://api.deepseek.com/v1/chat/completions`
   and the model name `deepseek-v4-pro` were taken from search results, not
   from a fetched API document — `api-docs.deepseek.com` was blocked too. The
   request is a standard OpenAI-compatible chat completion, so it should work
   against DeepSeek or any compatible gateway, but **confirm the base URL and
   model name against DeepSeek's own docs** before relying on it. Both are env
   variables precisely so this costs nothing to correct.

## Why not node:sqlite

The brief asked to verify `node:sqlite` is non-experimental on Node 24 before
committing to it. It is not:

- On **Node 24**, `node:sqlite` is `Stability: 1.2 - Release candidate` — no
  longer flag-gated, but still not Stable (2).
- On **Node 22.22.2** (the runtime this was built and tested on) it loads but
  emits an `ExperimentalWarning` on stderr.

Given a dataset of at most a few thousand rows, a zero-dependency constraint and
an ephemeral container, a JSON file is adequate and carries no version-gated API
risk. `lib/store.js` writes it atomically (temp file + rename), so an
interrupted run cannot leave a half-written state file.

## Design notes

**Dedupe key** is `(ats, company_token, ats_job_id)`. The brief said
`(ats, company, ats_job_id)`; this uses the immutable board token rather than
the human display name, so renaming "Acme" to "Acme Inc." in `companies.json`
does not make every one of its postings look brand new.

**A job is new iff its tuple is absent from the state file.** A changed title
or a changed `posted_at` does not make it new — retitled postings are the
largest source of false positives in a watcher like this.

**State is written before ranking**, so a ranker failure cannot cause the same
jobs to be reported as new again tomorrow. `--dry-run` skips the write entirely;
`selectNew()` is pure and returns the next state rather than mutating, which is
what makes that correct by construction.

**`--since` keeps jobs with no `posted_at`.** We cannot prove such a job is old,
and a job you never see is worse than a job you skim past.

## Tests

```
node --test test/
```

131 tests, entirely offline — the adapters are tested against fixtures in
`test/fixtures/`, and the ranker against an injected `fetchImpl`. No test makes
a network request.

The load-bearing test is that a second run over the same fixtures produces zero
new jobs, using the real parsed fixtures from both adapters.

Note: `node --test test/` fails on this Node build (it treats the directory as
the entry module). Use `npm test`, which runs `node --test "test/*.test.js"`.

## Out of scope

Discord delivery, cron scheduling, deployment. Phase 2.
