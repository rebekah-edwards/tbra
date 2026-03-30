#!/bin/bash
# deploy.sh — One-command deploy: code + database sync to production
# Usage: ./scripts/deploy.sh [--db-only] [--code-only] [--dry-run]
#
# This script:
#   1. Pushes code to origin/main (triggers Vercel auto-deploy)
#   2. Syncs the local SQLite database to Turso (production)
#
# Prerequisites:
#   - turso CLI installed and authenticated
#   - Git remote 'origin' configured
#   - Local SQLite DB at data/tbra.db

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="$PROJECT_DIR/data/tbra.db"
TURSO_DB="tbra-web-app"
DUMP_DIR="$PROJECT_DIR/.turso-sync"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse args
DB_ONLY=false
CODE_ONLY=false
DRY_RUN=false
for arg in "$@"; do
  case $arg in
    --db-only)  DB_ONLY=true ;;
    --code-only) CODE_ONLY=true ;;
    --dry-run)  DRY_RUN=true ;;
    --help|-h)
      echo "Usage: ./scripts/deploy.sh [--db-only] [--code-only] [--dry-run]"
      echo ""
      echo "  --db-only    Only sync database to Turso (skip git push)"
      echo "  --code-only  Only push code (skip database sync)"
      echo "  --dry-run    Show what would happen without doing it"
      exit 0
      ;;
  esac
done

cd "$PROJECT_DIR"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  tbr(a) Deploy Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# ─── Step 1: Push code ───────────────────────────────────────────────
if [ "$DB_ONLY" = false ]; then
  echo -e "${YELLOW}[1/2] Pushing code to origin/main...${NC}"

  if [ "$DRY_RUN" = true ]; then
    echo "  (dry run) Would run: git push origin main"
  else
    # Check for uncommitted changes
    if ! git diff --quiet HEAD 2>/dev/null; then
      echo -e "${RED}  Warning: You have uncommitted changes.${NC}"
      echo "  Commit or stash them first, or use --db-only."
      exit 1
    fi

    git push origin main 2>&1 | sed 's/^/  /'
    echo -e "${GREEN}  Code pushed. Vercel will auto-deploy.${NC}"
  fi
  echo ""
fi

# ─── Step 2: Sync database ──────────────────────────────────────────
if [ "$CODE_ONLY" = false ]; then
  echo -e "${YELLOW}[2/2] Syncing database to Turso...${NC}"

  if [ ! -f "$DB_PATH" ]; then
    echo -e "${RED}  Error: Local database not found at $DB_PATH${NC}"
    exit 1
  fi

  # Verify turso CLI
  if ! command -v turso &>/dev/null; then
    echo -e "${RED}  Error: turso CLI not found. Install: curl -sSfL https://get.tur.so/install.sh | bash${NC}"
    exit 1
  fi

  if [ "$DRY_RUN" = true ]; then
    echo "  (dry run) Would run: sync-incremental.sh pull && sync-incremental.sh push"
  else
    # Use incremental sync: pull live changes first (preserves user data),
    # then push new local content. NEVER deletes data from live.
    echo ""
    echo -e "${BLUE}  Step 2a: Pulling live changes into local...${NC}"
    "$SCRIPT_DIR/sync-incremental.sh" pull

    echo ""
    echo -e "${BLUE}  Step 2b: Pushing new local content to live...${NC}"
    "$SCRIPT_DIR/sync-incremental.sh" push
  fi

  echo ""
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deploy complete!${NC}"
echo -e "${GREEN}========================================${NC}"
