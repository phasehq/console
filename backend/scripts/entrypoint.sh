#!/bin/sh
set -e

if [ "$SKIP_DJANGO_MIGRATIONS" != "true" ]; then
    echo "Running migrations..."
    python manage.py migrate
fi

# Execute CMD
exec "$@"
