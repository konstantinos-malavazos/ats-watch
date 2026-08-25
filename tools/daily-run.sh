#!/usr/bin/env bash
# Daily driver: run ats-watch and post the digest to Discord.
#
# Intended for cron, which supplies no shell profile and no environment, so
# everything this needs is loaded explicitly from a config file kept OUTSIDE
# the repo (it holds secrets):
#
#   ATS_WATCH_DISCORD_WEBHOOK  Discord webhook URL for the target channel
#   DEEPSEEK_API_KEY           ranker key; without it the digest is unranked
#
# Config path defaults to ~/.config/ats-watch/env, override with ATS_WATCH_ENV.
#
# Silence is a successful run: no new jobs means no digest and nothing posted,
# matching the tool's own contract. Exit codes follow ats-watch itself.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ATS_WATCH_ENV:-$HOME/.config/ats-watch/env}"

if [ -r "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
else
  echo "warn: no config at $ENV_FILE - running without webhook or API key" >&2
fi

digest="$("$REPO/ats-watch")"
status=$?

if [ "$status" -ne 0 ]; then
  echo "error: ats-watch exited $status - nothing posted" >&2
  exit "$status"
fi

if [ -z "${digest//[[:space:]]/}" ]; then
  echo "info: no new jobs - nothing posted" >&2
  exit 0
fi

if [ -z "${ATS_WATCH_DISCORD_WEBHOOK:-}" ]; then
  echo "error: ATS_WATCH_DISCORD_WEBHOOK not set - digest not posted:" >&2
  printf '%s\n' "$digest" >&2
  exit 1
fi

# Build the JSON body with node rather than string-concatenation: the digest
# contains quotes, newlines and job titles with arbitrary punctuation, and a
# hand-rolled escape here is exactly the kind of thing that breaks on the one
# posting with a backslash in it. node is already a hard requirement.
# Discord rejects messages over 2000 characters; ats-watch caps its digest at
# ~1500, so the trim is a backstop, not the normal path.
payload="$(printf '%s' "$digest" | node -e '
  let s = "";
  process.stdin.on("data", (d) => { s += d; });
  process.stdin.on("end", () => {
    const max = 1900;
    const content = s.length > max ? s.slice(0, max) + "\n[truncated]" : s;
    process.stdout.write(JSON.stringify({ content, flags: 4 }));
  });
')"

code="$(printf '%s' "$payload" | curl -sS -o /tmp/ats-watch-discord.out -w '%{http_code}' \
  -X POST -H 'content-type: application/json' --data-binary @- \
  --max-time 30 "$ATS_WATCH_DISCORD_WEBHOOK")"

if [ "$code" -ge 200 ] && [ "$code" -lt 300 ]; then
  echo "info: posted digest to Discord (HTTP $code)" >&2
  exit 0
fi

echo "error: Discord returned HTTP $code" >&2
head -c 300 /tmp/ats-watch-discord.out >&2; echo >&2
echo "digest was:" >&2
printf '%s\n' "$digest" >&2
exit 1
