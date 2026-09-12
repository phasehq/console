#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/phase-admin-compose.XXXXXXXX")

cleanup() {
  (cd "$SANDBOX" && docker compose down -v >/dev/null 2>&1) || true
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

cp "$ROOT_DIR/phase-admin" "$SANDBOX/phase-admin"
cp "$ROOT_DIR/tests/phase-admin-compose.yml" "$SANDBOX/docker-compose.yml"
chmod +x "$SANDBOX/phase-admin"
printf 'NEXTAUTH_SECRET=integration-nextauth\nSECRET_KEY=integration-django\nSERVER_SECRET=integration-server-secret\nDATABASE_NAME=phase\nDATABASE_USER=phase\nDATABASE_PASSWORD=phase-password\n' >"$SANDBOX/.env"

cd "$SANDBOX"
export PHASE_BACKUP_PASSWORD=integration-password
docker compose up -d postgres backend frontend worker nginx
docker compose exec -T postgres sh -c \
  'until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do sleep 1; done'
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U phase -d phase <<'SQL'
CREATE TABLE django_migrations (id integer, app text, name text, applied timestamptz);
INSERT INTO django_migrations VALUES (1, 'api', '0001_initial', now());
CREATE TABLE backed_up (value text);
INSERT INTO backed_up VALUES ('before');
SQL

./phase-admin backup --output backup.tar.enc
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U phase -d phase <<'SQL'
UPDATE backed_up SET value = 'after';
CREATE TABLE target_only (id integer);
SQL
./phase-admin restore backup.tar.enc --yes

[[ $(docker compose exec -T postgres psql -At -U phase -d phase -c 'SELECT value FROM backed_up') == before ]]
[[ $(docker compose exec -T postgres psql -At -U phase -d phase -c "SELECT to_regclass('public.target_only') IS NULL") == t ]]
printf 'phase-admin PostgreSQL/Compose integration test passed\n'
