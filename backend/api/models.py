from django.db import models
from django.contrib.auth.models import (
    AbstractBaseUser,
    BaseUserManager,
    PermissionsMixin,
)
from uuid import uuid4
from backend.api.kv import write
import json
from django.utils import timezone
from django.conf import settings
from api.services import Providers, ServiceConfig
from api.tasks.syncing import trigger_sync_tasks
from backend.quotas import (
    can_add_account,
    can_add_app,
    can_add_environment,
    can_add_service_token,
)
from django.core.exceptions import ValidationError

CLOUD_HOSTED = settings.APP_HOST == "cloud"


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
        user = self.create_user(username, email, password=password)

        user.is_staff = True
        user.is_superuser = True
        user.save(using=self._db)

        return user


class CustomUser(AbstractBaseUser, PermissionsMixin):
    userId = models.TextField(default=uuid4, primary_key=True, editable=False)
    username = models.CharField(max_length=64, unique=True, null=False, blank=False)
    email = models.EmailField(max_length=100, unique=True, null=False, blank=False)

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
        (FREE_PLAN, "Free"),
        (PRO_PLAN, "Pro"),
        (ENTERPRISE_PLAN, "Enterprise"),
    ]

    PRICING_V1 = 1
    PRICING_V2 = 2

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
    stripe_customer_id = models.CharField(max_length=255, blank=True, null=True)
    stripe_subscription_id = models.CharField(max_length=255, blank=True, null=True)
    pricing_version = models.IntegerField(default=1)
    list_display = ("name", "identity_key", "id")

    def save(self, *args, **kwargs):
        if self._state.adding:
            self.pricing_version = self.PRICING_V2
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class ActivatedPhaseLicense(models.Model):
    id = models.TextField(primary_key=True, editable=False)
    customer_name = models.CharField(max_length=255)
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE)
    plan = models.CharField(
        max_length=2,
        choices=Organisation.PLAN_TIERS,
        default=Organisation.ENTERPRISE_PLAN,
    )
    seats = models.IntegerField(null=True)
    tokens = models.IntegerField(null=True)
    metadata = models.JSONField()
    environment = models.CharField(max_length=255)
    license_type = models.CharField(max_length=255)
    signature_date = models.DateField()
    issuing_authority = models.CharField(max_length=255)
    issued_at = models.DateTimeField()
    expires_at = models.DateTimeField()
    activated_at = models.DateTimeField(auto_now_add=True)


class AppManager(models.Manager):
    def create(self, *args, **kwargs):
        organisation = kwargs.get("organisation")
        if not can_add_app(organisation):
            raise ValueError("Cannot add more apps to this organisation's plan.")
        return super().create(*args, **kwargs)


class App(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, related_name="apps", on_delete=models.CASCADE
    )
    name = models.CharField(max_length=64)
    description = models.TextField(null=True, blank=True)
    identity_key = models.CharField(max_length=256)
    app_version = models.IntegerField(null=False, blank=False, default=1)
    app_token = models.CharField(max_length=64)
    app_seed = models.CharField(max_length=208)
    wrapped_key_share = models.CharField(max_length=406)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    is_deleted = models.BooleanField(default=False)
    sse_enabled = models.BooleanField(default=False)

    objects = AppManager()

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)  # Call the "real" save() method.
        if CLOUD_HOSTED:
            key = self.app_token
            value = self.wrapped_key_share
            meta = {"appId": self.id, "appName": self.name, "live": True}
            try:
                write(key, value, json.dumps(meta))
            except:
                pass

    def __str__(self):
        return self.name


class Role(models.Model):
    """Represents a role with specific permissions for an organization."""

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    name = models.CharField(max_length=255)  # Role name, e.g., Owner, Admin, Developer
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="roles"
    )
    description = models.TextField(null=True, blank=True)
    color = models.CharField(max_length=7, blank=True, default="")

    # Store permissions as JSON
    permissions = models.JSONField(default=dict)

    is_default = models.BooleanField(
        default=False
    )  # Indicates if the role is a default role
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.organisation.name})"


class NetworkAccessPolicy(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    name = models.CharField(max_length=100)
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE)
    allowed_ips = models.TextField(
        help_text="Comma-separated list of IP addresses or CIDR ranges (e.g. 192.168.1.1, 10.0.0.0/24)"
    )
    is_global = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        "OrganisationMember",
        on_delete=models.CASCADE,
        blank=True,
        null=True,
        related_name="network_policies_created",
    )
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        "OrganisationMember",
        on_delete=models.CASCADE,
        blank=True,
        null=True,
        related_name="network_policies_updated",
    )

    def get_ip_list(self):
        return [ip.strip() for ip in self.allowed_ips.split(",") if ip.strip()]

    def __str__(self):
        return self.name


class OrganisationMember(models.Model):

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    user = models.ForeignKey(
        CustomUser, related_name="organisation", on_delete=models.CASCADE
    )
    organisation = models.ForeignKey(
        Organisation, related_name="users", on_delete=models.CASCADE
    )
    role = models.ForeignKey(
        Role,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="organisation_members",
    )
    apps = models.ManyToManyField(App, related_name="members")
    identity_key = models.CharField(max_length=256, null=True, blank=True)
    wrapped_keyring = models.TextField(blank=True)
    wrapped_recovery = models.TextField(blank=True)
    network_policies = models.ManyToManyField(
        NetworkAccessPolicy, blank=True, related_name="members"
    )
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    def delete(self, *args, **kwargs):
        """
        Soft delete the object by setting the 'deleted_at' field.
        """
        self.deleted_at = timezone.now()
        self.save()


class ServiceAccountManager(models.Manager):
    def create(self, *args, **kwargs):
        organisation = kwargs.get("organisation")
        if not can_add_account(organisation, account_type="service_account"):
            raise ValueError("Cannot add more accounts to this organisation's plan.")
        return super().create(*args, **kwargs)


class ServiceAccount(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    name = models.CharField(max_length=255)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="service_accounts"
    )
    role = models.ForeignKey(
        Role,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    apps = models.ManyToManyField(App, related_name="service_accounts")
    identity_key = models.CharField(max_length=256, null=True, blank=True)
    server_wrapped_keyring = models.TextField(null=True)
    server_wrapped_recovery = models.TextField(null=True)
    network_policies = models.ManyToManyField(
        NetworkAccessPolicy, blank=True, related_name="service_accounts"
    )
    identities = models.ManyToManyField(
        "Identity", blank=True, related_name="service_accounts"
    )
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    objects = ServiceAccountManager()

    def delete(self, *args, **kwargs):
        """
        Soft delete the object by setting the 'deleted_at' field.
        """
        self.deleted_at = timezone.now()
        self.save()

        # Soft-delete related tokens
        self.serviceaccounttoken_set.update(deleted_at=timezone.now())


class ServiceAccountHandler(models.Model):
    id = models.TextField(default=uuid4, primary_key=True)
    service_account = models.ForeignKey(
        ServiceAccount, on_delete=models.CASCADE, related_name="handlers"
    )
    user = models.ForeignKey(OrganisationMember, on_delete=models.CASCADE)
    wrapped_keyring = models.TextField()
    wrapped_recovery = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)


class OrganisationMemberInviteManager(models.Manager):
    def create(self, *args, **kwargs):
        organisation = kwargs.get("organisation")
        if not can_add_account(organisation):
            raise ValueError("Cannot add more users to this organisation's plan.")
        return super().create(*args, **kwargs)


class OrganisationMemberInvite(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, related_name="invites", on_delete=models.CASCADE
    )
    apps = models.ManyToManyField(App)
    role = models.ForeignKey(
        Role,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    invited_by = models.ForeignKey(OrganisationMember, on_delete=models.CASCADE)
    invitee_email = models.EmailField()
    valid = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField()
    objects = OrganisationMemberInviteManager()


class EnvironmentManager(models.Manager):
    def create(self, *args, **kwargs):
        app = kwargs.get("app")
        if not can_add_environment(app):
            raise ValueError("Cannot add more environments to this app.")
        return super().create(*args, **kwargs)


class Environment(models.Model):
    DEVELOPMENT = "dev"
    STAGING = "staging"
    PRODUCTION = "prod"
    CUSTOM = "custom"

    ENV_TYPES = [
        (DEVELOPMENT, "Development"),
        (STAGING, "Staging"),
        (PRODUCTION, "Production"),
        (CUSTOM, "Custom"),
    ]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    app = models.ForeignKey(App, related_name="environments", on_delete=models.CASCADE)
    name = models.CharField(max_length=64)
    env_type = models.CharField(
        max_length=7,
        choices=ENV_TYPES,
        default=DEVELOPMENT,
    )
    index = models.IntegerField(default=0)
    identity_key = models.CharField(max_length=256)
    wrapped_seed = models.CharField(max_length=256)
    wrapped_salt = models.CharField(max_length=256)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    is_deleted = models.BooleanField(default=False)

    objects = EnvironmentManager()

    def save(self, *args, **kwargs):
        # Call the "real" save() method to save the Secret
        super().save(*args, **kwargs)

        # Trigger all sync jobs associated with this environment
        [
            trigger_sync_tasks(env_sync)
            for env_sync in EnvironmentSync.objects.filter(
                environment=self, deleted_at=None
            )
            if env_sync.is_active
        ]


class EnvironmentKey(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE)
    user = models.ForeignKey(
        OrganisationMember, on_delete=models.CASCADE, blank=True, null=True
    )
    service_account = models.ForeignKey(
        ServiceAccount, on_delete=models.CASCADE, blank=True, null=True
    )
    paths = models.TextField(blank=True, null=True)
    identity_key = models.CharField(max_length=256)
    wrapped_seed = models.CharField(max_length=256)
    wrapped_salt = models.CharField(max_length=256)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)

    def delete(self, *args, **kwargs):
        self.deleted_at = timezone.now()
        self.save()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["environment", "user"],
                name="unique_envkey_user",
                condition=models.Q(user__isnull=False, deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["environment", "service_account"],
                name="unique_envkey_service_account",
                condition=models.Q(
                    service_account__isnull=False, deleted_at__isnull=True
                ),
            ),
        ]


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


class ProviderCredentials(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, related_name="credentials", on_delete=models.CASCADE
    )
    name = models.CharField(max_length=64)
    provider = models.CharField(max_length=50, choices=Providers.get_provider_choices())
    credentials = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)


class EnvironmentSync(models.Model):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"
    FAILED = "failed"

    STATUS_OPTIONS = [
        (IN_PROGRESS, "In progress"),
        (COMPLETED, "Completed"),
        (CANCELLED, "cancelled"),
        (TIMED_OUT, "Timed out"),
        (FAILED, "Failed"),
    ]
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE)
    path = models.TextField(default="/")
    service = models.CharField(
        max_length=50, choices=ServiceConfig.get_service_choices()
    )
    options = models.JSONField()
    authentication = models.ForeignKey(
        ProviderCredentials, on_delete=models.SET_NULL, null=True
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    last_sync = models.DateTimeField(blank=True, null=True)
    status = models.CharField(
        max_length=16,
        choices=STATUS_OPTIONS,
        default=IN_PROGRESS,
    )


class EnvironmentSyncEvent(models.Model):
    meta = models.JSONField(null=True)
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    env_sync = models.ForeignKey(EnvironmentSync, on_delete=models.CASCADE)
    status = models.CharField(
        max_length=16,
        choices=EnvironmentSync.STATUS_OPTIONS,
        default=EnvironmentSync.IN_PROGRESS,
    )
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    completed_at = models.DateTimeField(blank=True, null=True)


class EnvironmentToken(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE)
    user = models.ForeignKey(
        OrganisationMember, on_delete=models.CASCADE, blank=True, null=True
    )
    name = models.CharField(max_length=64)
    identity_key = models.CharField(max_length=256)
    token = models.CharField(max_length=64)
    wrapped_key_share = models.CharField(max_length=406)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)


class ServiceTokenManager(models.Manager):
    def create(self, *args, **kwargs):
        app = kwargs.get("app")
        if not can_add_service_token(app):
            raise ValueError("Cannot add more service tokens to this app.")
        return super().create(*args, **kwargs)


class ServiceToken(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    app = models.ForeignKey(App, on_delete=models.CASCADE)
    keys = models.ManyToManyField(EnvironmentKey)
    identity_key = models.CharField(max_length=256)
    token = models.CharField(max_length=64)
    wrapped_key_share = models.CharField(max_length=406)
    name = models.CharField(max_length=64)
    created_by = models.ForeignKey(
        OrganisationMember, on_delete=models.CASCADE, blank=True, null=True
    )
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    expires_at = models.DateTimeField(null=True)
    objects = ServiceTokenManager()


class ServiceAccountToken(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    service_account = models.ForeignKey(ServiceAccount, on_delete=models.CASCADE)
    name = models.CharField(max_length=64)
    identity_key = models.CharField(max_length=256)
    token = models.CharField(max_length=64)
    wrapped_key_share = models.CharField(max_length=406)
    created_by = models.ForeignKey(
        OrganisationMember, on_delete=models.CASCADE, blank=True, null=True
    )
    created_by_service_account = models.ForeignKey(
        ServiceAccount,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="created_tokens",
    )
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    expires_at = models.DateTimeField(null=True)

    def clean(self):
        # Ensure only one of created_by or created_by_service_account is set
        # Service accounts can create tokens for themselves and others
        if not (self.created_by or self.created_by_service_account):
            raise ValidationError(
                "Must set either created_by (organisation member) or created_by_service_account"
            )
        if self.created_by and self.created_by_service_account:
            raise ValidationError(
                "Only one of created_by or created_by_service_account may be set"
            )

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def get_creator_account(self):
        return self.created_by or self.created_by_service_account

    def delete(self, *args, **kwargs):
        """
        Soft delete the object by setting the 'deleted_at' field.
        """
        self.deleted_at = timezone.now()
        self.save()


class UserToken(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    user = models.ForeignKey(
        OrganisationMember, on_delete=models.CASCADE, blank=True, null=True
    )
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
    path = models.TextField(default="/")
    folder = models.ForeignKey("self", on_delete=models.CASCADE, null=True)
    name = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["environment", "folder", "name", "path"],
                name="unique_secret_folder",
                condition=models.Q(folder__isnull=False),
            ),
            models.UniqueConstraint(
                fields=["environment", "name", "path"],
                name="unique_root_folder",
                condition=models.Q(folder__isnull=True),
            ),
        ]

    def delete(self, *args, **kwargs):
        env = self.environment
        super().delete(*args, **kwargs)
        # Update the 'updated_at' timestamp of the associated Environment
        if env:
            env.updated_at = timezone.now()
            env.save()


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
    folder = models.ForeignKey(SecretFolder, on_delete=models.CASCADE, null=True)
    path = models.TextField(default="/")
    key = models.TextField()
    key_digest = models.TextField()
    value = models.TextField()
    version = models.IntegerField(default=1)
    tags = models.ManyToManyField(SecretTag)
    comment = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)

    def save(self, *args, **kwargs):
        # Call the "real" save() method to save the Secret
        super().save(*args, **kwargs)

        # Update the 'updated_at' timestamp of the associated Environment
        if self.environment:
            self.environment.updated_at = timezone.now()
            self.environment.save()

    def delete(self, *args, **kwargs):
        env = self.environment
        super().delete(*args, **kwargs)
        # Update the 'updated_at' timestamp of the associated Environment
        if env:
            env.updated_at = timezone.now()
            env.save()


class DynamicSecret(models.Model):

    PROVIDER_CHOICES = [("aws", "AWS")]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    name = models.TextField()
    description = models.TextField(blank=True)
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE)
    folder = models.ForeignKey(SecretFolder, on_delete=models.CASCADE, null=True)
    path = models.TextField(default="/")
    default_ttl = models.DurationField(
        help_text="Default TTL for leases (must be <= max_ttl)."
    )
    max_ttl = models.DurationField(help_text="Maximum allowed TTL for leases.")
    authentication = models.ForeignKey(
        ProviderCredentials, on_delete=models.SET_NULL, null=True
    )
    provider = models.CharField(
        max_length=50,
        choices=PROVIDER_CHOICES,
        help_text="Which provider this secret is associated with.",
    )
    config = models.JSONField()
    key_map = models.JSONField(
        help_text="Provider-agnostic mapping of keys: "
        "[{'id': '<key_id>', 'key_name': '<encrypted_key_name>', 'key_digest': '<key_digest>'}, ...]",
        default=list,
    )
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)

    def save(self, *args, **kwargs):
        # Call the "real" save() method to save the Secret
        super().save(*args, **kwargs)

        # Update the 'updated_at' timestamp of the associated Environment
        if self.environment:
            self.environment.updated_at = timezone.now()
            self.environment.save()

    def delete(self, *args, **kwargs):
        # Soft delete the object by setting the 'deleted_at' field.
        self.updated_at = timezone.now()
        self.deleted_at = timezone.now()
        self.save()

        # Revoke all active leases
        from ee.integrations.secrets.dynamic.utils import schedule_lease_revocation

        for lease in self.leases.filter(status=DynamicSecretLease.ACTIVE):
            schedule_lease_revocation(lease, True)

        # Update the 'updated_at' timestamp of the associated Environment
        env = self.environment
        if env:
            env.updated_at = timezone.now()
            env.save()


class DynamicSecretLease(models.Model):

    CREATED = "created"
    ACTIVE = "active"
    RENEWED = "renewed"
    REVOKED = "revoked"
    EXPIRED = "expired"

    STATUS_OPTIONS = [
        (CREATED, "Created"),
        (ACTIVE, "Active"),
        (RENEWED, "Renewed"),
        (REVOKED, "Revoked"),
        (EXPIRED, "Expired"),
    ]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    name = models.TextField()
    description = models.TextField(blank=True)
    secret = models.ForeignKey(
        DynamicSecret, on_delete=models.CASCADE, related_name="leases"
    )
    organisation_member = models.ForeignKey(
        OrganisationMember, null=True, blank=True, on_delete=models.CASCADE
    )
    service_account = models.ForeignKey(
        ServiceAccount, null=True, blank=True, on_delete=models.CASCADE
    )
    ttl = models.DurationField()
    status = models.CharField(
        max_length=50,
        choices=STATUS_OPTIONS,
        default=ACTIVE,
        help_text="Current status of the lease",
    )
    credentials = models.JSONField(
        default=dict,
    )
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    renewed_at = models.DateTimeField(null=True)
    expires_at = models.DateTimeField(null=True)
    revoked_at = models.DateTimeField(null=True)
    deleted_at = models.DateTimeField(null=True)
    cleanup_job_id = models.TextField(default=uuid4)

    def clean(self):
        """
        Ensure only one of organisation_member or service_account is set.
        """
        if not (self.organisation_member or self.service_account):
            raise ValidationError(
                "Must set either organisation_member or service_account"
            )
        if self.organisation_member and self.service_account:
            raise ValidationError(
                "Only one of organisation_member or service_account may be set"
            )

    def get_account(self):
        """
        Return whichever account is associated with this lease.
        """
        return self.organisation_member or self.service_account


class DynamicSecretLeaseEvent(models.Model):

    EVENT_TYPES = DynamicSecretLease.STATUS_OPTIONS

    id = models.BigAutoField(primary_key=True)
    lease = models.ForeignKey(
        DynamicSecretLease, on_delete=models.CASCADE, related_name="events"
    )
    event_type = models.CharField(
        max_length=50, choices=EVENT_TYPES, default=DynamicSecretLease.CREATED
    )
    organisation_member = models.ForeignKey(
        OrganisationMember,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="lease_events",
    )
    service_account = models.ForeignKey(
        ServiceAccount,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="lease_events",
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, null=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def clean(self):
        """
        Ensure only one of organisation_member or service_account is set.
        """
        if not (self.organisation_member or self.service_account):
            raise ValidationError(
                "Must set either organisation_member or service_account"
            )
        if self.organisation_member and self.service_account:
            raise ValidationError(
                "Only one of organisation_member or service_account may be set"
            )

    def get_actor(self):
        return self.organisation_member or self.service_account


class SecretEvent(models.Model):
    CREATE = "C"
    READ = "R"
    UPDATE = "U"
    DELETE = "D"

    EVENT_TYPES = [
        (CREATE, "Create"),
        (READ, "Read"),
        (UPDATE, "Update"),
        (DELETE, "Delete"),
    ]

    class Meta:
        indexes = [
            # For secret history queries
            models.Index(
                fields=["secret_id", "event_type", "timestamp"],
                name="secret_event_history_idx",
            ),
            # For logs queries (per-environment)
            models.Index(
                fields=["environment", "-timestamp"],
                name="secret_logs_env_idx",
            ),
            # For service account token last_used queries
            models.Index(
                fields=["service_account_token", "-timestamp"],
                name="sa_token_last_used_idx",
            ),
        ]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    secret = models.ForeignKey(Secret, on_delete=models.CASCADE)
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE)
    folder = models.ForeignKey(SecretFolder, on_delete=models.CASCADE, null=True)
    path = models.TextField(default="/")
    user = models.ForeignKey(
        OrganisationMember, on_delete=models.SET_NULL, blank=True, null=True
    )
    service_token = models.ForeignKey(
        ServiceToken, on_delete=models.SET_NULL, blank=True, null=True
    )
    service_account = models.ForeignKey(
        ServiceAccount, on_delete=models.SET_NULL, blank=True, null=True
    )
    service_account_token = models.ForeignKey(
        ServiceAccountToken, on_delete=models.SET_NULL, blank=True, null=True
    )
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


class Identity(models.Model):
    """
    Third-party identity configuration.

    Scope: Organisation level; can be attached to multiple ServiceAccounts.
    """

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE)
    provider = models.CharField(max_length=64)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)

    # Provider-specific configuration
    # Example for aws_iam:
    # {
    #   "trustedPrincipals": "arn:..., arn:...",
    #   "signatureTtlSeconds": 60,
    #   "stsEndpoint": "https://sts.amazonaws.com"
    # }
    config = models.JSONField(default=dict)

    # Token configuration
    token_name_pattern = models.CharField(max_length=128, blank=True, null=True)
    default_ttl_seconds = models.IntegerField(default=3600)
    max_ttl_seconds = models.IntegerField(default=86400)

    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)

    def get_trusted_list(self):
        try:
            principals = self.config.get("trustedPrincipals", [])
            if isinstance(principals, list):
                return [
                    p.strip() for p in principals if isinstance(p, str) and p.strip()
                ]
            # Fallback for legacy comma-separated string format
            return [p.strip() for p in str(principals).split(",") if p.strip()]
        except Exception:
            return []


class PersonalSecret(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    secret = models.ForeignKey(Secret, on_delete=models.CASCADE)
    user = models.ForeignKey(OrganisationMember, on_delete=models.CASCADE)
    value = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)


class Lockbox(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    data = models.JSONField()
    views = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    expires_at = models.DateTimeField(null=True)
    allowed_views = models.IntegerField(null=True)
