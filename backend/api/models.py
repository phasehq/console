from django.db import models
from django.contrib.postgres.fields import ArrayField
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from uuid import uuid4
from backend.api.kv import write
import json
from django.utils import timezone
from django.conf import settings
from backend.api.services import ServiceConfig

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
    name = models.CharField(max_length=64, unique=True)
    identity_key = models.CharField(max_length=256)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    plan = models.CharField(
        max_length=2,
        choices=PLAN_TIERS,
        default=FREE_PLAN,
    )
    list_display = ('name', 'identity_key', 'id')

    def __str__(self):
        return self.name


class App(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE)
    name = models.CharField(max_length=64)
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


class OrganisationMember(models.Model):
    OWNER = 'owner'
    ADMIN = 'admin'
    DEVELOPER = 'dev'

    USER_ROLES = [
        (OWNER, 'Owner'),
        (ADMIN, 'Admin'),
        (DEVELOPER, 'Developer')
    ]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    user = models.ForeignKey(
        CustomUser, related_name='organisation', on_delete=models.CASCADE)
    organisation = models.ForeignKey(
        Organisation, related_name='users', on_delete=models.CASCADE)
    role = models.CharField(
        max_length=5,
        choices=USER_ROLES,
        default=DEVELOPER,
    )
    apps = models.ManyToManyField(App, related_name='members')
    identity_key = models.CharField(max_length=256, null=True, blank=True)
    wrapped_keyring = models.TextField(blank=True)
    wrapped_recovery = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    def delete(self, *args, **kwargs):
        """
        Soft delete the object by setting the 'deleted_at' field.
        """
        self.deleted_at = timezone.now()
        self.save()


class OrganisationMemberInvite(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, related_name='invites', on_delete=models.CASCADE)
    apps = models.ManyToManyField(App)
    role = models.CharField(
        max_length=5,
        choices=OrganisationMember.USER_ROLES,
        default=OrganisationMember.DEVELOPER,
    )
    invited_by = models.ForeignKey(
        OrganisationMember, on_delete=models.CASCADE)
    invitee_email = models.EmailField()
    valid = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField()


class Environment(models.Model):

    DEVELOPMENT = "dev"
    STAGING = "staging"
    PRODUCTION = "prod"

    ENV_TYPES = [
        (DEVELOPMENT, 'Development'),
        (STAGING, 'Staging'),
        (PRODUCTION, 'Production')
    ]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    app = models.ForeignKey(App, on_delete=models.CASCADE)
    name = models.CharField(max_length=64)
    env_type = models.CharField(
        max_length=7,
        choices=ENV_TYPES,
        default=DEVELOPMENT,
    )
    identity_key = models.CharField(max_length=256)
    wrapped_seed = models.CharField(max_length=256)
    wrapped_salt = models.CharField(max_length=256)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    is_deleted = models.BooleanField(default=False)


class EnvironmentKey(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE)
    user = models.ForeignKey(
        OrganisationMember, on_delete=models.CASCADE, blank=True, null=True)
    identity_key = models.CharField(max_length=256)
    wrapped_seed = models.CharField(max_length=256)
    wrapped_salt = models.CharField(max_length=256)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)

    def delete(self, *args, **kwargs):
        self.deleted_at = timezone.now()
        self.save()


class ServerEnvironmentKey(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE)
    identity_key = models.CharField(max_length=256)
    wrapped_seed = models.CharField(max_length=256)
    wrapped_salt = models.CharField(max_length=256)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)

    def delete(self, *args, **kwargs):
        self.deleted_at = timezone.now()
        self.save()


class EnvironmentSync(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE)
    service = models.CharField(
        max_length=50, choices=ServiceConfig.get_service_choices())
    options = models.JSONField()
    authentication = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)

    def delete(self, *args, **kwargs):
        self.deleted_at = timezone.now()
        self.save()


class EnvironmentToken(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE)
    user = models.ForeignKey(
        OrganisationMember, on_delete=models.CASCADE, blank=True, null=True)
    name = models.CharField(max_length=64)
    identity_key = models.CharField(max_length=256)
    token = models.CharField(max_length=64)
    wrapped_key_share = models.CharField(max_length=406)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)


class ServiceToken(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    app = models.ForeignKey(App, on_delete=models.CASCADE)
    keys = models.ManyToManyField(EnvironmentKey)
    identity_key = models.CharField(max_length=256)
    token = models.CharField(max_length=64)
    wrapped_key_share = models.CharField(max_length=406)
    name = models.CharField(max_length=64)
    created_by = models.ForeignKey(
        OrganisationMember, on_delete=models.CASCADE, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    expires_at = models.DateTimeField(null=True)


class UserToken(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    user = models.ForeignKey(
        OrganisationMember, on_delete=models.CASCADE, blank=True, null=True)
    name = models.CharField(max_length=64)
    identity_key = models.CharField(max_length=256)
    token = models.CharField(max_length=64)
    wrapped_key_share = models.CharField(max_length=406)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    expires_at = models.DateTimeField(null=True)


class SecretFolder(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE)
    parent = models.ForeignKey('self', on_delete=models.CASCADE)
    name = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)


class SecretTag(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE)
    name = models.CharField(max_length=64)
    color = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)


class Secret(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE)
    folder = models.ForeignKey(
        SecretFolder, on_delete=models.CASCADE, null=True)
    key = models.TextField()
    key_digest = models.TextField()
    value = models.TextField()
    version = models.IntegerField(default=1)
    tags = models.ManyToManyField(SecretTag)
    comment = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)


class SecretEvent(models.Model):

    CREATE = "C"
    READ = "R"
    UPDATE = "U"
    DELETE = "D"

    EVENT_TYPES = [
        (CREATE, 'Create'),
        (READ, 'Read'),
        (UPDATE, 'Update'),
        (DELETE, 'Delete')
    ]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    secret = models.ForeignKey(Secret, on_delete=models.CASCADE)
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE)
    folder = models.ForeignKey(
        SecretFolder, on_delete=models.CASCADE, null=True)
    user = models.ForeignKey(
        OrganisationMember, on_delete=models.SET_NULL, blank=True, null=True)
    key = models.TextField()
    key_digest = models.TextField()
    value = models.TextField()
    version = models.IntegerField(default=1)
    tags = models.ManyToManyField(SecretTag)
    comment = models.TextField()
    event_type = models.CharField(
        max_length=1,
        choices=EVENT_TYPES,
        default=CREATE,
    )
    timestamp = models.DateTimeField(auto_now_add=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(null=True, blank=True)


class PersonalSecret(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    secret = models.ForeignKey(Secret, on_delete=models.CASCADE)
    user = models.ForeignKey(
        OrganisationMember, on_delete=models.CASCADE)
    value = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
