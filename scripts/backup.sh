#!/usr/bin/env bash
# Daily encrypted backup (PRD §16: kept 90 days, restore within 4 hours, at most 1 hour of data lost —
# pair this nightly dump with PostgreSQL WAL archiving for the 1-hour point).
#
#   BACKUP_DIR=/srv/backups BACKUP_PASSPHRASE_FILE=/etc/dcb/backup.key ./scripts/backup.sh
#
# The passphrase file is held by the named officer, never in the repository or the database.
set -euo pipefail
umask 077 # backups and their checksums are readable by the backup user only
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE must point to the passphrase file}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STORAGE_DIR="${STORAGE_DIR:-./storage}"
KEEP_DAYS="${KEEP_DAYS:-90}"
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/dcb-hrms-$stamp.tar.gz.enc"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$tmp/database.dump"
[ -d "$STORAGE_DIR" ] && tar -C "$STORAGE_DIR" -czf "$tmp/storage.tar.gz" .
tar -C "$tmp" -czf - . | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -out "$out"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256")
find "$BACKUP_DIR" -name 'dcb-hrms-*.enc*' -mtime "+$KEEP_DAYS" -delete
echo "Backup written: $out"
