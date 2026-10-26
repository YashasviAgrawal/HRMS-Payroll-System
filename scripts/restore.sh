#!/usr/bin/env bash
# Restores a backup made by backup.sh into DATABASE_URL (an EMPTY database) and STORAGE_DIR.
#   BACKUP_PASSPHRASE_FILE=/etc/dcb/backup.key ./scripts/restore.sh backups/dcb-hrms-20261026T010000Z.tar.gz.enc
set -euo pipefail
file="${1:?usage: restore.sh <backup file>}"
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE must point to the passphrase file}"
STORAGE_DIR="${STORAGE_DIR:-./storage}"
[ -f "$file.sha256" ] && sha256sum -c "$file.sha256"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$file" | tar -C "$tmp" -xzf -
pg_restore --no-owner --exit-on-error --dbname="$DATABASE_URL" "$tmp/database.dump"
if [ -f "$tmp/storage.tar.gz" ]; then mkdir -p "$STORAGE_DIR" && tar -C "$STORAGE_DIR" -xzf "$tmp/storage.tar.gz"; fi
echo "Restore complete."
