from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from uuid import uuid4
from backend.api.kv import write
import json

from django.conf import settings

CLOUD_HOSTED = settings.APP_HOST == 'cloud'

class CustomUserManager(BaseUserManager):
    def create_user(self, username, email, password=None):
        """
          Creates a custom user with the given fields
        """

        user = self.model(
            username=username,
            email=self.normalize_email(email),
        )

        user.set_password(password)
        user.save(using=self._db)

        return user

    def create_superuser(self, username, email, password):
        user = self.create_user(
            username,
            email,
            password=password
        )

        user.is_staff = True
        user.is_superuser = True
        user.save(using=self._db)

        return user


class CustomUser(AbstractBaseUser, PermissionsMixin):
    userId = models.TextField(default=uuid4, primary_key=True, editable=False)
    username = models.CharField(
        max_length=64, unique=True, null=False, blank=False)
    email = models.EmailField(
        max_length=100, unique=True, null=False, blank=False)

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = ["email"]

    active = models.BooleanField(default=True)

    is_staff = models.BooleanField(default=False)
    is_superuser = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = CustomUserManager()

    class Meta:
        verbose_name = "Custom User"


class Organisation(models.Model):
    FREE_PLAN = "FR"
    PRO_PLAN = "PR"
    ENTERPRISE_PLAN = "EN"

    PLAN_TIERS = [
        (FREE_PLAN, 'Free'),
        (PRO_PLAN, 'Pro'),
        (ENTERPRISE_PLAN, 'Enterprise')
    ]
    
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    owner = models.ForeignKey(
        CustomUser, related_name='organisation', on_delete=models.CASCADE)
    name = models.CharField(max_length=64, unique=True)
    identity_key = models.CharField(max_length=256)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    plan = models.CharField(
        max_length=2,
        choices=PLAN_TIERS,
        default=FREE_PLAN,
    )
    list_display = ('owner', 'name', 'identity_key', 'id')

    def __str__(self):
        return self.name


class App(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE)
    name = name = models.CharField(max_length=64)
    identity_key = models.CharField(max_length=256)
    app_version = models.IntegerField(null=False, blank=False, default=1)
    app_token = models.CharField(max_length=64)
    app_seed = models.CharField(max_length=208)
    wrapped_key_share = models.CharField(max_length=406)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    is_deleted = models.BooleanField(default=False)

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)  # Call the "real" save() method.
        if CLOUD_HOSTED:
            key = self.app_token
            value = self.wrapped_key_share
            meta = {
                'appId': self.id,
                'appName': self.name,
                'live': True
            }
            try:
                write(key, value, json.dumps(meta))
            except:
                pass

    def __str__(self):
        return self.name
