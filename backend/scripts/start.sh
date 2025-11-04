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
exec gunicorn -b '[::]:8000' --workers 3 backend.wsgi:application
