import os
from pathlib import Path
from datetime import timedelta
import logging.config

# Clear prev config
LOGGING_CONFIG = None

# Get loglevel from env
LOGLEVEL = "DEBUG" if os.getenv("DEBUG") == "True" else "INFO"

logging.config.dictConfig(
    {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "console": {
                "format": "%(asctime)s %(levelname)s [%(name)s:%(lineno)s] %(module)s %(process)d %(thread)d %(message)s",
            },
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "console",
            },
        },
        "loggers": {
            "": {
                "level": LOGLEVEL,
                "handlers": [
                    "console",
                ],
            },
        },
    }
)

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

ADMIN_ENABLED = os.getenv("ADMIN_ENABLED")

# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/4.1/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.getenv("SECRET_KEY")

SERVER_SECRET = os.getenv("SERVER_SECRET")

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = True if os.getenv("DEBUG") == "True" else False

ALLOWED_HOSTS = os.getenv("ALLOWED_HOSTS", []).split(",")

SESSION_ENGINE = "django.contrib.sessions.backends.signed_cookies"

SESSION_COOKIE_SECURE = True

SESSION_COOKIE_DOMAIN = os.getenv("SESSION_COOKIE_DOMAIN")

SESSION_COOKIE_AGE = 604800  # 1 week, in seconds

# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "django.contrib.sites",
    "dj_rest_auth",
    "dj_rest_auth.registration",
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",
    "allauth.socialaccount.providers.github",
    "allauth.socialaccount.providers.gitlab",
    "api",
    "logs",
    "graphene_django",
    "django_rq",
]

SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "SCOPE": ["profile", "email"],
        "AUTH_PARAMS": {"access_type": "online"},
        "APP": {
            "client_id": os.getenv("GOOGLE_CLIENT_ID"),
            "secret": os.getenv("GOOGLE_CLIENT_SECRET"),
        },
    },
    "github": {
        "SCOPE": [
            "user read:user user:email",
        ],
        "APP": {
            "client_id": os.getenv("GITHUB_CLIENT_ID"),
            "secret": os.getenv("GITHUB_CLIENT_SECRET"),
        },
    },
    "gitlab": {
        "SCOPE": [
            "user read:user user:email",
        ],
        "APP": {
            "client_id": os.getenv("GITLAB_CLIENT_ID"),
            "secret": os.getenv("GITLAB_CLIENT_SECRET"),
        },
    },
}

SOCIALACCOUNT_EMAIL_VERIFICATION = "none"
SOCIALACCOUNT_EMAIL_REQUIRED = True
SOCIALACCOUNT_QUERY_EMAIL = True

OAUTH_REDIRECT_URI = os.getenv("OAUTH_REDIRECT_URI")


# Email configurations
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = os.getenv("SMTP_SERVER")
EMAIL_PORT = int(os.getenv("SMTP_PORT", 587))
EMAIL_USE_TLS = True
EMAIL_HOST_USER = os.getenv("SMTP_USERNAME")
EMAIL_HOST_PASSWORD = os.getenv("SMTP_PASSWORD")
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL")


SITE_ID = 1

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "djangorestframework_camel_case.middleware.CamelCaseMiddleWare",
]

USE_X_FORWARDED_HOST = True

CORS_ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS").split(",")

CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = os.getenv("ALLOWED_ORIGINS").split(",")

AUTH_USER_MODEL = "api.CustomUser"

REST_AUTH_SERIALIZERS = {
    "USER_DETAILS_SERIALIZER": "api.serializers.CustomUserSerializer"
}

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework.authentication.SessionAuthentication",
    ),
    "EXCEPTION_HANDLER": "backend.exceptions.custom_exception_handler",
}

GRAPHENE = {
    "SCHEMA": "backend.schema.schema",
}

ROOT_URLCONF = "backend.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "backend.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "USER": os.getenv("DATABASE_USER"),
        "PASSWORD": os.getenv("DATABASE_PASSWORD"),
        "NAME": os.getenv("DATABASE_NAME"),
        "HOST": os.getenv("DATABASE_HOST"),
        "PORT": os.getenv("DATABASE_PORT"),
    },
}

DYNAMODB = {
    "TABLE": os.getenv("DYNAMODB_LOGS_TABLE"),
    "INDEX": os.getenv("DYNAMODB_LOGS_TIMESTAMP_INDEX"),
    "REGION": os.getenv("DYNAMODB_REGION"),
}


# Password validation
# https://docs.djangoproject.com/en/4.1/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# Internationalization
# https://docs.djangoproject.com/en/4.1/topics/i18n/

LANGUAGE_CODE = "en-us"

TIME_ZONE = "UTC"

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/4.1/howto/static-files/

STATIC_URL = "static/"

# Default primary key field type
# https://docs.djangoproject.com/en/4.1/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CLOUDFLARE = {
    "ACCOUNT_ID": os.getenv("CF_ACCOUNT_ID"),
    "KV_NAMESPACE": os.getenv("CF_KV_NAMESPACE"),
    "API_KEY": os.getenv("CF_API_KEY"),
    "ZONE_ID": os.getenv("CF_ZONE_ID"),
}

SLACK_WEBHOOK_URI = f"https://hooks.slack.com/services/{os.getenv('SLACK_NOTIFIER')}"

# Whether the app is self-hosted or cloud-hosted
# Value should be either 'self' or 'cloud'
try:
    APP_HOST = os.getenv("APP_HOST")
except:
    APP_HOST = "self"

RQ_QUEUES = {
    "default": {
        "HOST": os.getenv("REDIS_HOST"),
        "PORT": os.getenv("REDIS_PORT"),
        "PASSWORD": os.getenv("REDIS_PASSWORD"),
        "SSL": os.getenv("REDIS_SSL", None),
        "DB": 0,
    }
}
