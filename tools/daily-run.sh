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
# ats-watch itself stays silent when it has nothing to report - that is its
# contract and CI enforces it. This script is the delivery path, not the tool,
# and a silent channel is indistinguishable from a broken cron job, so a run
# with nothing to say posts a short "no jobs today" line instead. Exit codes
# follow ats-watch itself.
#
# SCHEDULING: the ranker is billed at DeepSeek's peak rate during 01:00-04:00
# and 06:00-10:00 UTC, Monday to Friday; every other hour is half price. The
# cron entry runs this at 14:00 Europe/Athens, which is 11:00 UTC in summer and
# 12:00 UTC in winter - off-peak on both sides of the DST change, with an hour
# of margin from the 10:00 UTC boundary. Verified 2026-08-26 against
# https://api-docs.deepseek.com/quick_start/pricing.

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
# --min-score 7 keeps the channel to roles worth acting on: anything the
# ranker scored below 7 is held back from the post (it is still recorded as
# seen, and still visible in a manual run without the flag).
digest="$("$REPO/ats-watch" --format discord --min-score 7)"
status=$?

if [ "$status" -ne 0 ]; then
  echo "error: ats-watch exited $status - nothing posted" >&2
  exit "$status"
fi

if [ -z "${digest//[[:space:]]/}" ]; then
  digest="**No jobs today.** Nothing new scored 7/10 or above."
fi

printf '%s' "$digest" | "$REPO/tools/post-discord.mjs"
