#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/phase-admin-test.XXXXXXXX")
trap 'rm -rf "$SANDBOX"' EXIT

cp "$ROOT_DIR/phase-admin" "$SANDBOX/phase-admin"
mkdir "$SANDBOX/bin"
printf 'NEXTAUTH_SECRET=nextauth\nSECRET_KEY=django\nSERVER_SECRET=original\nDATABASE_NAME=phase\nDATABASE_USER=phase\nDATABASE_PASSWORD=phase-password\n' >"$SANDBOX/.env"

cat >"$SANDBOX/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ ${1:-} == inspect ]]; then
  printf 'phasehq/backend:test\n'
  exit
fi
[[ ${1:-} == compose ]] || exit 1
shift
case ${1:-} in
  version) exit ;;
  ps) printf 'postgres\n' ;;
  config) printf 'services:\n  postgres: {}\n' ;;
  stop|up) exit ;;
  run) [[ ${FAIL_MIGRATIONS:-} != 1 ]] ;;
  exec)
    case "$*" in
      *pg_dump*) printf '%s\n' 'CREATE TABLE restored (id integer);' ;;
      *'count(*)'*) printf '42\n' ;;
      *'ORDER BY applied'*) printf 'api:0042_test\n' ;;
      *pg_isready*) exit ;;
      *'psql --single-transaction'*) cat >/dev/null; [[ ${FAIL_RESTORE:-} != 1 ]] ;;
      *) exit 1 ;;
    esac
    ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$SANDBOX/phase-admin" "$SANDBOX/bin/docker"

cd "$SANDBOX"
export PATH="$SANDBOX/bin:$PATH"
export PHASE_BACKUP_PASSWORD=test-password

./phase-admin backup --output backup.tar.enc
mv bin/docker bin/docker.disabled
./phase-admin verify backup.tar.enc | grep -q 'latest_migration=api:0042_test'
mv bin/docker.disabled bin/docker
printf 'NEXTAUTH_SECRET=nextauth\nSECRET_KEY=django\nSERVER_SECRET=mutated\nDATABASE_NAME=phase\nDATABASE_USER=phase\nDATABASE_PASSWORD=phase-password\n' >.env

export FAIL_RESTORE=1
if ./phase-admin restore backup.tar.enc --yes 2>restore-error.log; then
  printf 'restore unexpectedly succeeded\n' >&2
  exit 1
fi
unset FAIL_RESTORE
grep -q '^SERVER_SECRET=mutated$' .env
grep -q 'restored .*\.env' restore-error.log

export FAIL_MIGRATIONS=1
if ./phase-admin restore backup.tar.enc --yes 2>migration-error.log; then
  printf 'restore with failed migrations unexpectedly succeeded\n' >&2
  exit 1
fi
unset FAIL_MIGRATIONS
grep -q '^SERVER_SECRET=original$' .env
grep -q 'database was restored' migration-error.log

./phase-admin restore backup.tar.enc --yes
grep -q '^SERVER_SECRET=original$' .env
grep -q '^SERVER_SECRET=mutated$' .env.before-restore.*

rm .env
./phase-admin restore backup.tar.enc --yes
grep -q '^SERVER_SECRET=original$' .env

printf 'phase-admin backup/verify/restore test passed\n'
