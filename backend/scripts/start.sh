#!/bin/sh
set -e

echo "Checking migration configuration..."
if [ "$EXTERNAL_MIGRATION" = "true" ]; then
    echo "EXTERNAL_MIGRATION flag is set to true. Skipping migrations as they will be handled externally."
else
    echo "EXTERNAL_MIGRATION flag is not set. Running migrations locally..."
    python manage.py migrate
fi

echo "Starting gunicorn server..."

# Calculate optimal workers: (2 * CPUs) + 1
# nproc = linux, sysctl = mac. Default to 2 if detection fails.
CORES=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)
AUTO_WORKERS=$(( CORES * 2 + 1 ))

# Use GUNICORN_WORKERS env var if set, otherwise use calculated value
WORKERS=${GUNICORN_WORKERS:-$AUTO_WORKERS}

echo "Detected $CORES system cores. Starting $WORKERS gunicorn workers."
exec gunicorn -b '[::]:8000' --workers "$WORKERS" backend.wsgi:application
