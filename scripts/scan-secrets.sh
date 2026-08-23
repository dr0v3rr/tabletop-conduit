#!/usr/bin/env bash
# Manual TruffleHog secret scans (defense-in-depth companion to the pre-commit hook).
#
#   scripts/scan-secrets.sh            Scan git history (default detectors), fixtures excluded
#   scripts/scan-secrets.sh --verified Only VERIFIED (live) secrets — network-checked, zero noise
#   scripts/scan-secrets.sh --full     Everything, INCLUDING test/fixtures (expect known FPs)
set -uo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"

command -v trufflehog >/dev/null 2>&1 || { echo "trufflehog not installed — brew install trufflehog"; exit 2; }

mode="${1:-default}"
args=(git "file://$root" --no-update)
case "$mode" in
  --verified) args+=(--only-verified); label="verified-only";;
  --full)     label="full (fixtures INCLUDED — known false positives)";;
  *)          args+=(--exclude-paths="$root/.trufflehog-exclude"); label="default (fixtures excluded)";;
esac

echo "TruffleHog scan — $label"
trufflehog "${args[@]}"
