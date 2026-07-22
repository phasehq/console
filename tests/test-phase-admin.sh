#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/phase-admin-test.XXXXXXXX")
trap 'rm -rf "$SANDBOX"' EXIT

cp "$ROOT_DIR/phase-admin" "$SANDBOX/phase-admin"
mkdir "$SANDBOX/bin"
printf 'SERVER_SECRET=original\nDATABASE_NAME=phase\n' >"$SANDBOX/.env"

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
  stop|up|run) exit ;;
  exec)
    case "$*" in
      *pg_dump*) printf 'fake PostgreSQL custom dump' ;;
      *'count(*)'*) printf '42\n' ;;
      *'ORDER BY applied'*) printf 'api:0042_test\n' ;;
      *pg_isready*) exit ;;
      *pg_restore*) cat >/dev/null ;;
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

./phase-admin backup backup.tar.enc
./phase-admin verify backup.tar.enc | grep -q 'latest_migration=api:0042_test'
printf 'SERVER_SECRET=mutated\n' >.env
./phase-admin restore backup.tar.enc --yes
grep -q '^SERVER_SECRET=original$' .env
grep -q '^SERVER_SECRET=mutated$' .env.before-restore.*

printf 'phase-admin backup/verify/restore test passed\n'
