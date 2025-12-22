#!/bin/sh
set -e

# Handle database migrations.
echo "Checking migration configuration..."
if [ "$EXTERNAL_MIGRATION" = "true" ]; then
    echo "EXTERNAL_MIGRATION flag is set to true. Skipping migrations as they will be handled externally."
else
    echo "EXTERNAL_MIGRATION flag is not set. Running migrations locally..."
    python manage.py migrate
fi

echo "Starting gunicorn server..."

# Dynamically calculate the number of workers based on CPU cores: (2 * CPUs) + 1
# nproc = linux, sysctl = mac. Default to 2 if detection fails.
CORES=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)
AUTO_WORKERS=$(( CORES * 2 + 1 ))

# Max worker limit to prevent accidental PostgreSQL connection exhaustion.
# For example db.t3.medium (approx 450 conn limit), 8 workers * 20 replicas = 160 connections (Safe).
MAX_WORKERS_DEFAULT=8

if [ "$AUTO_WORKERS" -gt "$MAX_WORKERS_DEFAULT" ]; then
    echo "Auto-detected $AUTO_WORKERS workers, but capping at $MAX_WORKERS_DEFAULT to prevent database connection exhaustion."
    AUTO_WORKERS=$MAX_WORKERS_DEFAULT
fi

# Use GUNICORN_WORKERS env var if set and valid, else set the worker count dynamically.
WORKERS=$AUTO_WORKERS

# Validate GUNICORN_WORKERS as a positive integer if it is set.
if [ -n "$GUNICORN_WORKERS" ]; then
    case "$GUNICORN_WORKERS" in
        *[!0-9]* | '' | 0)
            echo "Warning: GUNICORN_WORKERS='$GUNICORN_WORKERS' is not a positive integer. Falling back to AUTO_WORKERS=$AUTO_WORKERS."
            ;;
        *)
            WORKERS=$GUNICORN_WORKERS
            echo "GUNICORN_WORKERS is set to '$GUNICORN_WORKERS'. Using override."
            ;;
    esac
fi

# Start gunicorn server.
echo "Detected $CORES system cores. Starting $WORKERS gunicorn workers."
# Listen for connections on IPv4 and IPv6 - Dualstack
exec gunicorn -b '[::]:8000' --workers "$WORKERS" backend.wsgi:application
