#!/bin/sh
set -e

# If set to true the Django database migrations needs be run externally 
if [ "$EXTERNAL_MIGRATION" != "true" ]; then
    echo "Running migrations..."
    python manage.py migrate
fi

echo "Starting gunicorn..."
exec gunicorn -b '[::]:8000' --workers 3 backend.wsgi:application
