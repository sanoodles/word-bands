#!/usr/bin/env bash
# Vercel build for @wordbands/web. Kept in a script because vercel.json's inline
# `buildCommand` is capped at 256 chars. Invoked from the repo root (the
# buildCommand cd's there first).
set -euo pipefail

# The app's data is committed under apps/web/data, so no step here builds it.
pnpm turbo run build --filter=@wordbands/web
