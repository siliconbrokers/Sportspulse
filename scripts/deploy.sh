#!/usr/bin/env bash
# deploy.sh — push a main.
#
# El hook pre-push (.husky/pre-push) ejecuta automaticamente el seed de cache
# antes del push si ADMIN_SECRET y SEED_URL estan configurados en .env.local.
#
# Uso: pnpm deploy

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "ERROR: La rama actual es '$BRANCH', no 'main'."
  echo "  Cambia a main antes de deployar."
  exit 1
fi

git -C "$REPO_ROOT" push origin main
