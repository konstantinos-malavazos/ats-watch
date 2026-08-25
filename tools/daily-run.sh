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

# --format discord renders markdown and is deliberately not truncated; the
# poster splits it across as many messages as it takes. Capturing rather than
# piping directly so a failed run posts nothing at all, instead of piping a
# half-written digest into the channel.
digest="$("$REPO/ats-watch" --format discord)"
status=$?

if [ "$status" -ne 0 ]; then
  echo "error: ats-watch exited $status - nothing posted" >&2
  exit "$status"
fi

printf '%s' "$digest" | "$REPO/tools/post-discord.mjs"
