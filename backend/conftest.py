import os
import django

# Set environment variables required for settings.py to import successfully
os.environ.setdefault("ALLOWED_HOSTS", "localhost")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost")

# Set dummy Redis values so settings.py generates a valid URL (e.g. redis://localhost:6379/1)
os.environ.setdefault("REDIS_HOST", "localhost")
os.environ.setdefault("REDIS_PORT", "6379")

# Set dummy database config
os.environ.setdefault("DATABASE_HOST", "localhost")
os.environ.setdefault("DATABASE_PORT", "5432")
os.environ.setdefault("DATABASE_NAME", "dummy_db")
os.environ.setdefault("DATABASE_USER", "dummy_user")
os.environ.setdefault("DATABASE_PASSWORD", "dummy_password")

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")


def pytest_configure():
    django.setup()
