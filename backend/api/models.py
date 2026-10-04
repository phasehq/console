from django.db import models, transaction
from django.contrib.auth.models import (
    AbstractBaseUser,
    BaseUserManager,
    PermissionsMixin,
)
from uuid import uuid4
from datetime import timedelta
from backend.api.kv import write
import json
from django.utils import timezone
from django.conf import settings
from api.services import Providers, ServiceConfig
from api.tasks.syncing import trigger_sync_tasks, detect_and_trigger_referencing_syncs
from backend.quotas import (
    can_add_account,
    can_add_app,
    can_add_environment,
)
from django.core.exceptions import ValidationError
from api.utils.access.roles import MANAGED_ROLE_CHOICES

CLOUD_HOSTED = settings.APP_HOST == "cloud"


def _same_text_id(left, right):
    """TextField UUID defaults may remain UUID objects until DB reload."""
    return left is not None and right is not None and str(left) == str(right)


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
    full_name = models.CharField(max_length=128, blank=True, default="")

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = ["email"]

    active = models.BooleanField(default=True)

    is_staff = models.BooleanField(default=False)
    is_superuser = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = CustomUserManager()

    @property
    def auth_method(self):
        """'password' if the user signed up with email/password, else 'sso'."""
        return "password" if self.has_usable_password() else "sso"

    class Meta:
        verbose_name = "Custom User"


class EmailVerification(models.Model):
    user = models.OneToOneField(CustomUser, on_delete=models.CASCADE)
    token = models.CharField(max_length=64, unique=True, db_index=True)
    verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()


class UserTOTP(models.Model):
    """TOTP 2FA config for a user. The seed is encrypted with the server
    keypair (ProviderCredentials precedent). Hard-deleted on disable —
    a disabled 2FA must not leave a resurrectable seed."""

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    user = models.OneToOneField(
        CustomUser, on_delete=models.CASCADE, related_name="totp"
    )
    encrypted_seed = models.TextField()
    # NULL = enrollment pending; a code must verify before activation.
    activated_at = models.DateTimeField(null=True, blank=True)
    # Replay guard: the highest timestep a code has been accepted for.
    last_verified_timestep = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class UserRecoveryCode(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    user = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name="recovery_codes"
    )
    code_hash = models.CharField(max_length=255)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["user", "used_at"], name="recovery_code_user_unused_idx"
            )
        ]


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
    require_sso = models.BooleanField(default=False)
    scim_enabled = models.BooleanField(default=False)
    list_display = ("name", "identity_key", "id")

    def save(self, *args, **kwargs):
        if self._state.adding:
            self.pricing_version = self.PRICING_V2
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class OrganisationSSOProvider(models.Model):
    from api.utils.sso import ORG_SSO_PROVIDER_CHOICES

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, related_name="sso_providers", on_delete=models.CASCADE
    )
    provider_type = models.CharField(max_length=50, choices=ORG_SSO_PROVIDER_CHOICES)
    name = models.CharField(max_length=128)
    config = models.JSONField()
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        "OrganisationMember",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="sso_providers_created",
    )
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        "OrganisationMember",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="sso_providers_updated",
    )

    class Meta:
        unique_together = [("organisation", "provider_type")]

    def __str__(self):
        return f"{self.name} ({self.organisation.name})"


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
    """Represents a role with specific permissions for an organisation."""

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
    managed_key = models.CharField(
        max_length=16,
        choices=MANAGED_ROLE_CHOICES,
        null=True,
        blank=True,
        editable=False,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            persisted_key = (
                type(self)
                .objects.filter(pk=self.pk)
                .values_list("managed_key", flat=True)
                .first()
            )
            if persisted_key != self.managed_key:
                raise ValidationError("Managed role keys are immutable.")
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} ({self.organisation.name})"

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organisation", "managed_key"],
                condition=models.Q(managed_key__isnull=False),
                name="unique_managed_role_key_per_org",
            ),
            models.CheckConstraint(
                check=(
                    models.Q(is_default=True, managed_key__isnull=False)
                    | models.Q(is_default=False, managed_key__isnull=True)
                ),
                name="role_default_requires_managed_key",
            ),
        ]


class NetworkAccessPolicy(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    name = models.CharField(max_length=100)
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE)
    allowed_ips = models.TextField(
        help_text="Comma-separated list of IP addresses or CIDR ranges (e.g. 192.168.1.1, 10.0.0.0/24)"
    )
    is_global = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # SET_NULL: policies are org-owned — deleting their creator's account
    # must not delete the org's IP allowlist.
    created_by = models.ForeignKey(
        "OrganisationMember",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="network_policies_created",
    )
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        "OrganisationMember",
        on_delete=models.SET_NULL,
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

    def retire_agent_access(self, *, retired_at=None):
        from api.utils.agents import retire_organisation_member_agent_access

        return retire_organisation_member_agent_access(
            self,
            retired_at=retired_at,
        )

    @transaction.atomic
    def delete(self, *args, **kwargs):
        """
        Soft delete the object by setting the 'deleted_at' field.
        """
        now = timezone.now()
        self.retire_agent_access(retired_at=now)
        self.deleted_at = now
        self.save(update_fields=["deleted_at", "updated_at"])


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
    team = models.ForeignKey(
        "Team",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_service_accounts",
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
        Soft delete the SA, its tokens, and its EnvironmentKey rows
        (wiping wrapping material so an attacker with DB access can't
        recover env seeds belonging to a deleted principal).
        """
        now = timezone.now()
        self.deleted_at = now
        self.save()

        self.serviceaccounttoken_set.filter(deleted_at__isnull=True).update(
            deleted_at=now
        )

        EnvironmentKey.objects.filter(
            service_account=self, deleted_at__isnull=True
        ).update(
            deleted_at=now,
            wrapped_seed="",
            wrapped_salt="",
            identity_key="",
        )


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
    invited_by = models.ForeignKey(
        OrganisationMember, on_delete=models.SET_NULL, null=True, blank=True
    )
    invited_by_service_account = models.ForeignKey(
        "ServiceAccount", on_delete=models.SET_NULL, null=True, blank=True
    )
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
        super().save(*args, **kwargs)

        # Own syncs: synchronous, so queued status shows immediately.
        [
            trigger_sync_tasks(env_sync)
            for env_sync in EnvironmentSync.objects.filter(
                environment=self, deleted_at=None
            )
            if env_sync.is_active
        ]

        # Referencing envs: dispatched after commit (on_commit) so the worker
        # can't race an open transaction; runs off the request path.
        env_id = str(self.id)
        transaction.on_commit(
            lambda: detect_and_trigger_referencing_syncs.delay(env_id)
        )


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
    revision = models.UUIDField(default=uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)

    def save(self, *args, **kwargs):
        fields = kwargs.get("update_fields")
        if not self._state.adding:
            self.revision = uuid4()
            if fields is not None and "revision" not in fields:
                kwargs["update_fields"] = [*fields, "revision"]
        super().save(*args, **kwargs)


class EnvironmentSync(models.Model):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"
    FAILED = "failed"

    STATUS_OPTIONS = [
        (QUEUED, "Queued"),
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
        default=QUEUED,
    )


class EnvironmentSyncEvent(models.Model):
    meta = models.JSONField(null=True)
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    env_sync = models.ForeignKey(EnvironmentSync, on_delete=models.CASCADE)
    status = models.CharField(
        max_length=16,
        choices=EnvironmentSync.STATUS_OPTIONS,
        default=EnvironmentSync.QUEUED,
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


class ServiceToken(models.Model):
    """Retained for historical data and audit foreign keys, not authentication."""

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    app = models.ForeignKey(App, on_delete=models.CASCADE)
    keys = models.ManyToManyField(EnvironmentKey)
    identity_key = models.CharField(max_length=256)
    token = models.CharField(max_length=64)
    wrapped_key_share = models.CharField(max_length=406)
    name = models.CharField(max_length=64)
    # SET_NULL: tokens power live workloads — deleting their creator's
    # account must not revoke them.
    created_by = models.ForeignKey(
        OrganisationMember, on_delete=models.SET_NULL, blank=True, null=True
    )
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    expires_at = models.DateTimeField(null=True)


class ServiceAccountToken(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    service_account = models.ForeignKey(ServiceAccount, on_delete=models.CASCADE)
    name = models.CharField(max_length=64)
    identity_key = models.CharField(max_length=256)
    token = models.CharField(max_length=64)
    wrapped_key_share = models.CharField(max_length=406)
    # SET_NULL: tokens power live workloads — deleting their creator's
    # account must not revoke them.
    created_by = models.ForeignKey(
        OrganisationMember, on_delete=models.SET_NULL, blank=True, null=True
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
    # Bumped on every successful authentication via the REST/management API.
    # The legacy `last_used` resolver fell back to SecretEvent history, which
    # only fires for E2EE secret operations and misses management-API usage
    # entirely. This direct field makes "Last used" accurate across both.
    last_used_at = models.DateTimeField(blank=True, null=True)

    def clean(self):
        # Ensure only one of created_by or created_by_service_account is set
        # Service accounts can create tokens for themselves and others.
        # Enforced at creation only: both creator FKs are SET_NULL, so
        # existing rows legitimately lose their creator when the creating
        # account is deleted — later saves (soft delete) must still work.
        if self._state.adding and not (
            self.created_by or self.created_by_service_account
        ):
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
    SECRET_TYPE_CHOICES = [
        ("secret", "Secret"),
        ("sealed", "Sealed"),
        ("config", "Config"),
    ]

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
    type = models.CharField(
        max_length=10,
        choices=SECRET_TYPE_CHOICES,
        default="secret",
    )
    # Materialised owner for rotating-secret outputs. The rotation engine
    # owns this row's value/key/path; users can still edit tags/comment/type.
    rotating_secret = models.ForeignKey(
        "RotatingSecret",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="secrets",
    )
    rotating_output_id = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)

    def save(self, *args, trigger_sync=True, **kwargs):
        # Call the "real" save() method to save the Secret
        super().save(*args, **kwargs)

        # Notify the environment (bumps updated_at and triggers syncs). Bulk
        # callers pass trigger_sync=False and trigger once after the loop so the
        # per-env sync jobs and org-wide reference scan run a single time.
        if self.environment and trigger_sync:
            self.environment.updated_at = timezone.now()
            self.environment.save()

    def delete(self, *args, trigger_sync=True, **kwargs):
        env = self.environment
        super().delete(*args, **kwargs)
        # See save(): bulk callers defer the trigger and fire it once.
        if env and trigger_sync:
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


class RotatingSecret(models.Model):
    """
    Configures automated rotation of a third-party credential. The active credential
    surfaces transparently in the env's secret list under user-chosen key names.
    """

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    FAILED = "failed"
    HEALTH_CHOICES = [
        (HEALTHY, "Healthy"),
        (DEGRADED, "Degraded"),
        (FAILED, "Failed"),
    ]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    name = models.TextField()
    description = models.TextField(blank=True)
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE)
    folder = models.ForeignKey(SecretFolder, on_delete=models.CASCADE, null=True)
    path = models.TextField(default="/")
    provider = models.CharField(
        max_length=50,
        help_text="Rotation provider id (resolved against the rotation provider registry).",
    )
    authentication = models.ForeignKey(
        ProviderCredentials, on_delete=models.SET_NULL, null=True
    )
    config = models.JSONField(default=dict)
    key_map = models.JSONField(
        help_text="Provider-agnostic mapping of keys: "
        "[{'id': '<key_id>', 'key_name': '<encrypted_key_name>', 'key_digest': '<key_digest>'}, ...]",
        default=list,
    )
    rotation_interval = models.DurationField(
        help_text="How often a new credential is minted."
    )
    revocation_delay = models.DurationField(
        default=timedelta,
        help_text="How long Phase waits before revoking the previous credential "
        "after a rotation. 0 = revoke immediately on rotation.",
    )
    next_rotation_at = models.DateTimeField(null=True, blank=True)
    rotation_job_id = models.TextField(default=uuid4)
    # Remaining time until the next rotation at the moment of pause. Set when
    # pause() runs, consumed by resume() so the timer continues where it left
    # off instead of restarting at a full interval.
    paused_remaining = models.DurationField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    health = models.CharField(max_length=20, choices=HEALTH_CHOICES, default=HEALTHY)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    last_failure_reason = models.TextField(blank=True)
    consecutive_failure_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.environment:
            self.environment.updated_at = timezone.now()
            self.environment.save()

    def delete(self, *args, **kwargs):
        from ee.integrations.secrets.rotation.engine import (
            cancel_rotation_jobs,
            revoke_credential,
        )

        self.updated_at = timezone.now()
        self.deleted_at = timezone.now()
        self.save()

        cancel_rotation_jobs(self)
        for cred in self.credentials.filter(
            status__in=[
                RotatingSecretCredential.ACTIVE,
                RotatingSecretCredential.EXPIRING,
                RotatingSecretCredential.REVOKING,
            ]
        ):
            revoke_credential(cred.id, immediate=True)

        # Soft-delete the materialised Secret rows so they disappear from
        # the env. Hard-delete would also work since the FK is CASCADE, but
        # save() never calls super().delete() so we have to do it explicitly.
        self.secrets.filter(deleted_at__isnull=True).update(
            deleted_at=timezone.now()
        )

        env = self.environment
        if env:
            env.updated_at = timezone.now()
            env.save()


class RotatingSecretCredential(models.Model):
    """
    A single credential minted by the rotation engine. The encrypted_values field
    is the source of truth for the credential's per-output-key ciphertexts (encrypted
    with the environment keypair). Synthetic Secret rows are constructed from this
    at fetch time — no Secret rows are materialized.
    """

    PENDING = "pending"
    ACTIVE = "active"
    EXPIRING = "expiring"
    REVOKING = "revoking"
    REVOKED = "revoked"
    MINT_FAILED = "mint_failed"
    REVOKE_FAILED = "revoke_failed"
    STATUS_OPTIONS = [
        (PENDING, "Pending"),
        (ACTIVE, "Active"),
        (EXPIRING, "Expiring"),
        (REVOKING, "Revoking"),
        (REVOKED, "Revoked"),
        (MINT_FAILED, "Mint Failed"),
        (REVOKE_FAILED, "Revoke Failed"),
    ]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    rotating_secret = models.ForeignKey(
        RotatingSecret, on_delete=models.CASCADE, related_name="credentials"
    )
    status = models.CharField(max_length=20, choices=STATUS_OPTIONS, default=PENDING)
    provider_credential_id = models.TextField(blank=True)
    encrypted_values = models.JSONField(default=dict)
    metadata = models.JSONField(default=dict, blank=True)
    failure_count = models.PositiveIntegerField(default=0)
    last_failure_reason = models.TextField(blank=True)
    revoke_job_id = models.TextField(default=uuid4)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    expire_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)


class RotatingSecretEvent(models.Model):
    """
    Append-only audit/lifecycle log for rotating secrets. Every state change to
    a RotatingSecret or RotatingSecretCredential — successful or failed — is recorded
    here so the full lifecycle is reconstructable from events alone.
    """

    CONFIG_CREATED = "config_created"
    CONFIG_UPDATED = "config_updated"
    ROTATED = "rotated"
    MINT_ATTEMPTED = "mint_attempted"
    MINT_FAILED = "mint_failed"
    REVOKE_ATTEMPTED = "revoke_attempted"
    REVOKED = "revoked"
    REVOKE_FAILED = "revoke_failed"
    ORPHANED_CREDENTIAL = "orphaned_credential"
    PAUSED = "paused"
    RESUMED = "resumed"
    MANUAL_ROTATE = "manual_rotate"
    HEALTH_DEGRADED = "health_degraded"
    HEALTH_FAILED = "health_failed"
    HEALTH_RECOVERED = "health_recovered"
    EVENT_TYPES = [
        (CONFIG_CREATED, "Config Created"),
        (CONFIG_UPDATED, "Config Updated"),
        (ROTATED, "Rotated"),
        (MINT_ATTEMPTED, "Mint Attempted"),
        (MINT_FAILED, "Mint Failed"),
        (REVOKE_ATTEMPTED, "Revoke Attempted"),
        (REVOKED, "Revoked"),
        (REVOKE_FAILED, "Revoke Failed"),
        (ORPHANED_CREDENTIAL, "Orphaned Credential"),
        (PAUSED, "Paused"),
        (RESUMED, "Resumed"),
        (MANUAL_ROTATE, "Manual Rotate"),
        (HEALTH_DEGRADED, "Health Degraded"),
        (HEALTH_FAILED, "Health Failed"),
        (HEALTH_RECOVERED, "Health Recovered"),
    ]

    id = models.BigAutoField(primary_key=True)
    rotating_secret = models.ForeignKey(
        RotatingSecret, on_delete=models.CASCADE, related_name="events"
    )
    credential = models.ForeignKey(
        RotatingSecretCredential,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="events",
    )
    event_type = models.CharField(max_length=50, choices=EVENT_TYPES)
    organisation_member = models.ForeignKey(
        OrganisationMember,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="rotation_events",
    )
    service_account = models.ForeignKey(
        ServiceAccount,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="rotation_events",
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, null=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

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
    type = models.CharField(
        max_length=10,
        choices=Secret.SECRET_TYPE_CHOICES,
        default="secret",
    )
    event_type = models.CharField(
        max_length=1,
        choices=EVENT_TYPES,
        default=CREATE,
    )
    timestamp = models.DateTimeField(auto_now_add=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(null=True, blank=True)


class AuditEvent(models.Model):
    """
    Generic audit log for organisation-level events (Apps, Environments, Roles,
    Service Accounts, Members, Tokens, Network Policies).
    SecretEvent remains separate for encrypted-value logging.
    """

    CREATE = "C"
    READ = "R"
    UPDATE = "U"
    DELETE = "D"
    ACCESS = "A"
    EVENT_TYPES = [
        (CREATE, "Create"),
        (READ, "Read"),
        (UPDATE, "Update"),
        (DELETE, "Delete"),
        (ACCESS, "Access"),
    ]

    APP = "app"
    ENVIRONMENT = "env"
    ROLE = "role"
    SERVICE_ACCOUNT = "sa"
    ORG_MEMBER = "member"
    NETWORK_POLICY = "policy"
    USER_TOKEN = "pat"
    SA_TOKEN = "sa_token"
    SERVICE_TOKEN = "svc_token"
    INVITE = "invite"
    TEAM = "team"
    ROTATING_SECRET = "rs"
    LOG_STREAM = "stream"
    AGENT = "agent"
    AGENT_CONNECTION = "agent_conn"
    AGENT_REQUEST = "agent_request"
    RESOURCE_TYPES = [
        (APP, "App"),
        (ENVIRONMENT, "Environment"),
        (ROLE, "Role"),
        (SERVICE_ACCOUNT, "ServiceAccount"),
        (ORG_MEMBER, "OrganisationMember"),
        (NETWORK_POLICY, "NetworkAccessPolicy"),
        (USER_TOKEN, "UserToken"),
        (SA_TOKEN, "ServiceAccountToken"),
        (SERVICE_TOKEN, "ServiceToken"),
        (INVITE, "Invite"),
        (TEAM, "Team"),
        (ROTATING_SECRET, "RotatingSecret"),
        (LOG_STREAM, "LogStream"),
        (AGENT, "Agent"),
        (AGENT_CONNECTION, "AgentConnection"),
        (AGENT_REQUEST, "AgentRequest"),
    ]

    class Meta:
        indexes = [
            models.Index(
                fields=["resource_type", "resource_id", "-timestamp"],
                name="audit_resource_history_idx",
            ),
            models.Index(
                fields=["organisation", "-timestamp"],
                name="audit_org_activity_idx",
            ),
            models.Index(
                fields=["actor_type", "actor_id", "-timestamp"],
                name="audit_actor_activity_idx",
            ),
        ]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="audit_events"
    )

    # What happened
    event_type = models.CharField(max_length=1, choices=EVENT_TYPES)
    resource_type = models.CharField(max_length=16, choices=RESOURCE_TYPES)
    resource_id = models.TextField()

    # Who did it (no ForeignKey — survives entity deletion)
    actor_type = models.CharField(
        max_length=10,
        choices=[("user", "User"), ("sa", "ServiceAccount")],
    )
    actor_id = models.TextField()
    actor_metadata = models.JSONField(default=dict)

    # What changed
    resource_metadata = models.JSONField(default=dict)
    old_values = models.JSONField(null=True, blank=True)
    new_values = models.JSONField(null=True, blank=True)
    description = models.TextField(blank=True, default="")

    # Request metadata
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")

    timestamp = models.DateTimeField(default=timezone.now)


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
            if self.provider == "azure_entra":
                principals = self.config.get("allowedServicePrincipalIds", [])
            else:
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


class Team(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    name = models.CharField(max_length=64)
    description = models.TextField(null=True, blank=True)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="teams"
    )

    # Optional roles — when set, override org role's app_permissions for team-accessed apps
    member_role = models.ForeignKey(
        Role,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="teams_as_member_role",
    )
    service_account_role = models.ForeignKey(
        Role,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="teams_as_sa_role",
    )

    is_scim_managed = models.BooleanField(default=False)
    owner = models.ForeignKey(
        OrganisationMember,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="owned_teams",
    )
    created_by = models.ForeignKey(
        OrganisationMember,
        null=True,
        on_delete=models.SET_NULL,
        related_name="created_teams",
    )
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    def delete(self, *args, **kwargs):
        self.deleted_at = timezone.now()
        self.save(update_fields=["deleted_at", "updated_at"])

    def __str__(self):
        return f"{self.name} ({self.organisation.name})"


class TeamMembership(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="memberships")
    org_member = models.ForeignKey(
        OrganisationMember,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="team_memberships",
    )
    service_account = models.ForeignKey(
        ServiceAccount,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="team_memberships",
    )
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["team", "org_member"],
                condition=models.Q(org_member__isnull=False),
                name="unique_team_user",
            ),
            models.UniqueConstraint(
                fields=["team", "service_account"],
                condition=models.Q(service_account__isnull=False),
                name="unique_team_sa",
            ),
        ]


class TeamAppEnvironment(models.Model):
    """Tracks which environments within an app a team has access to."""

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="app_environments"
    )
    app = models.ForeignKey(App, on_delete=models.CASCADE)
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["team", "environment"],
                name="unique_team_env",
            )
        ]


class EnvironmentKeyGrant(models.Model):
    """Tracks why an EnvironmentKey exists — prevents accidental revocation
    when removing team access."""

    INDIVIDUAL = "individual"
    TEAM = "team"

    GRANT_TYPE_CHOICES = [
        (INDIVIDUAL, "Individual"),
        (TEAM, "Team"),
    ]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    environment_key = models.ForeignKey(
        EnvironmentKey, on_delete=models.CASCADE, related_name="grants"
    )
    grant_type = models.CharField(max_length=20, choices=GRANT_TYPE_CHOICES)
    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, null=True, blank=True, related_name="key_grants"
    )
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)


class SCIMToken(models.Model):
    """Bearer token for SCIM v2 provisioning API."""

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="scim_tokens"
    )
    name = models.CharField(max_length=64)
    token_hash = models.CharField(max_length=128, unique=True, db_index=True)
    token_prefix = models.CharField(max_length=12)
    created_by = models.ForeignKey(
        OrganisationMember, on_delete=models.SET_NULL, null=True
    )
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    def delete(self, *args, **kwargs):
        self.deleted_at = timezone.now()
        self.save()


class SCIMUser(models.Model):
    """Maps a SCIM external user ID to a Phase CustomUser + OrganisationMember."""

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    external_id = models.CharField(max_length=255)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="scim_users"
    )
    user = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, null=True, blank=True
    )
    org_member = models.ForeignKey(
        OrganisationMember, on_delete=models.CASCADE, null=True, blank=True
    )
    email = models.EmailField()
    display_name = models.CharField(max_length=255, blank=True)
    active = models.BooleanField(default=True)
    scim_data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["external_id", "organisation"],
                name="unique_scim_user_external_id",
            ),
            models.UniqueConstraint(
                fields=["email", "organisation"],
                name="unique_scim_user_email",
            ),
        ]


class SCIMGroup(models.Model):
    """Maps a SCIM external group ID to a Phase Team."""

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    external_id = models.CharField(max_length=255)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="scim_groups"
    )
    team = models.OneToOneField(
        Team, on_delete=models.CASCADE, null=True, blank=True, related_name="scim_group"
    )
    display_name = models.CharField(max_length=255)
    scim_data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["external_id", "organisation"],
                name="unique_scim_group_external_id",
            ),
        ]


class SCIMEvent(models.Model):
    """Audit log for SCIM provisioning operations."""

    EVENT_TYPES = [
        ("user_created", "User Created"),
        ("user_updated", "User Updated"),
        ("user_deactivated", "User Deactivated"),
        ("user_reactivated", "User Reactivated"),
        ("group_created", "Group Created"),
        ("group_updated", "Group Updated"),
        ("group_deleted", "Group Deleted"),
        ("member_added", "Member Added to Group"),
        ("member_removed", "Member Removed from Group"),
    ]

    RESOURCE_TYPES = [("user", "User"), ("group", "Group")]

    STATUS_CHOICES = [("success", "Success"), ("error", "Error")]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="scim_events"
    )
    scim_token = models.ForeignKey(
        SCIMToken, on_delete=models.SET_NULL, null=True, related_name="events"
    )
    event_type = models.CharField(max_length=32, choices=EVENT_TYPES)
    status = models.CharField(max_length=8, choices=STATUS_CHOICES, default="success")
    resource_type = models.CharField(max_length=16, choices=RESOURCE_TYPES)
    resource_id = models.TextField(blank=True)
    resource_name = models.CharField(max_length=255, blank=True)
    detail = models.JSONField(default=dict)
    request_method = models.CharField(max_length=8, blank=True)
    request_path = models.TextField(blank=True)
    request_body = models.JSONField(null=True, blank=True)
    response_status = models.IntegerField(null=True, blank=True)
    response_body = models.JSONField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["organisation", "-timestamp"],
                name="scim_event_org_ts_idx",
            ),
            models.Index(
                fields=["scim_token", "-timestamp"],
                name="scim_event_token_ts_idx",
            ),
        ]
        ordering = ["-timestamp"]


class Lockbox(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    data = models.JSONField()
    views = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    expires_at = models.DateTimeField(null=True)
    allowed_views = models.IntegerField(null=True)


class LogStream(models.Model):
    """
    Configuration for streaming audit/secret event logs to an external
    log management platform (e.g. Datadog).

    Scope: Organisation level. Delivery state (cursors, health, job ids) is
    managed exclusively by the log stream engine (ee.integrations.logs.streams).
    """

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    HEALTH_CHOICES = [
        (HEALTHY, "Healthy"),
        (DEGRADED, "Degraded"),
    ]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="log_streams"
    )
    name = models.CharField(max_length=64)
    provider = models.CharField(
        max_length=50,
        help_text="Log stream adapter id (resolved against the log stream adapter registry).",
    )
    authentication = models.ForeignKey(
        ProviderCredentials,
        on_delete=models.SET_NULL,
        null=True,
        related_name="log_streams",
    )
    sources = models.JSONField(
        default=list,
        help_text="Event source ids to ship (resolved against the log stream source registry).",
    )
    options = models.JSONField(default=dict)
    max_attempts = models.PositiveIntegerField(
        default=5,
        help_text="Delivery attempts per chunk before it is recorded as failed and skipped.",
    )
    is_active = models.BooleanField(default=True)
    health = models.CharField(max_length=20, choices=HEALTH_CHOICES, default=HEALTHY)
    # Set when the engine pauses the stream (e.g. "auth_error"); empty when
    # paused by a user.
    paused_reason = models.TextField(blank=True, default="")
    # Per-source delivery cursors: {"<source_id>": {"ts": "<iso8601>", "id": "<pk>"}}.
    # A cursor only advances after its chunk is accepted by the destination.
    cursors = models.JSONField(default=dict)
    ship_job_id = models.TextField(null=True, blank=True)
    last_shipped_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    last_failure_reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)

    def delete(self, *args, **kwargs):
        from ee.integrations.logs.streams.engine import cancel_ship_job

        self.is_active = False
        self.updated_at = timezone.now()
        self.deleted_at = timezone.now()
        self.save()

        # A deleted stream's failed/skipped ranges can never be re-shipped,
        # and auto-resolve/retention both skip deleted streams — resolve them
        # here or they are exempt from retention forever.
        self.delivery_events.filter(
            status__in=[
                LogStreamDeliveryEvent.FAILED,
                LogStreamDeliveryEvent.SKIPPED,
            ],
            resolved_at__isnull=True,
        ).update(resolved_at=timezone.now())

        cancel_ship_job(self)


class LogStreamDeliveryEvent(models.Model):
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"

    STATUS_OPTIONS = [
        (COMPLETED, "Completed"),
        (FAILED, "Failed"),
        (SKIPPED, "Skipped"),
    ]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    stream = models.ForeignKey(
        LogStream, on_delete=models.CASCADE, related_name="delivery_events"
    )
    source = models.CharField(max_length=32)
    # Rows are written once with a terminal status; chunk lifecycle is seconds,
    # so there is no queued/in-progress state to track here.
    status = models.CharField(max_length=16, choices=STATUS_OPTIONS)
    event_count = models.PositiveIntegerField(default=0)
    payload_bytes = models.PositiveIntegerField(default=0)
    attempts = models.PositiveIntegerField(default=0)
    cursor_from = models.DateTimeField(null=True, blank=True)
    cursor_to = models.DateTimeField(null=True, blank=True)
    # Id bounds of the covered range. Events are ordered by (timestamp, id),
    # and chunks can split inside a single timestamp — auto-resolving a
    # failed range by timestamp containment alone could match a chunk that
    # covered the same timestamps but different events. Empty string means
    # "unknown" (legacy rows / open boundaries) and compares leniently.
    cursor_from_id = models.TextField(default="", blank=True)
    cursor_to_id = models.TextField(default="", blank=True)
    # Set on delivery events created by a manual retry of a failed/skipped one.
    retried_from = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="retries"
    )
    # Set on a failed/skipped event once a manual retry covering it succeeds.
    resolved_at = models.DateTimeField(null=True, blank=True)
    meta = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    completed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["stream", "-created_at"],
                name="log_stream_delivery_idx",
            ),
            # Unresolved rows are rare but queried constantly (badge count,
            # auto-resolve) — partial, so completed rows never enter it.
            models.Index(
                fields=["stream", "source"],
                condition=models.Q(
                    status__in=["failed", "skipped"], resolved_at__isnull=True
                ),
                name="log_stream_unresolved_idx",
            ),
        ]
        ordering = ["-created_at"]


# AI Agents


class Agent(models.Model):
    """An organisation-owned principal with explicitly assigned members."""

    CLAUDE_CODE = "claude_code"
    CODEX = "codex"
    CURSOR = "cursor"
    DEVIN = "devin"
    OPENCODE = "opencode"
    OTHER = "other"
    HARNESS_CHOICES = [
        (CLAUDE_CODE, "Claude Code"),
        (CODEX, "Codex"),
        (CURSOR, "Cursor"),
        (DEVIN, "Devin"),
        (OPENCODE, "OpenCode"),
        (OTHER, "Other"),
    ]

    ACTIVE = "active"
    DISABLED = "disabled"
    STATUS_CHOICES = [(ACTIVE, "Active"), (DISABLED, "Disabled")]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="agents"
    )
    name = models.CharField(max_length=255)
    harness_type = models.CharField(
        max_length=32, choices=HARNESS_CHOICES, default=OTHER
    )
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=ACTIVE)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        OrganisationMember,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agents_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    def delete(self, *args, **kwargs):
        from api.utils.agent_sessions import revoke_agent_sessions

        session_ids = list(
            AgentSession.objects.filter(
                workflow__agent=self, revoked_at__isnull=True
            ).values_list("pk", flat=True)
        )
        now = timezone.now()
        self.workflows.update(deleted_at=now, updated_at=now)
        self.memberships.update(deleted_at=now, updated_at=now)
        AgentWorkflowMembership.objects.filter(
            agent_membership__agent=self,
            deleted_at__isnull=True,
        ).update(deleted_at=now, updated_at=now)
        AgentToken.objects.filter(workflow__agent=self).update(
            deleted_at=now, updated_at=now
        )
        AgentWorkflowGrant.objects.filter(workflow__agent=self).update(
            deleted_at=now,
            updated_at=now,
        )
        self.deleted_at = now
        self.status = self.DISABLED
        self.save(update_fields=["deleted_at", "status", "updated_at"])
        revoke_agent_sessions(session_ids)

    class Meta:
        indexes = [
            models.Index(
                fields=["organisation", "deleted_at"],
                name="agent_org_active_idx",
            )
        ]


class AgentWorkflow(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="agent_workflows"
    )
    agent = models.ForeignKey(
        Agent, on_delete=models.CASCADE, related_name="workflows"
    )
    name = models.CharField(max_length=255)
    created_by = models.ForeignKey(
        OrganisationMember,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_workflows_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    def clean(self):
        if self.agent_id and not _same_text_id(
            self.agent.organisation_id, self.organisation_id
        ):
            raise ValidationError("Workflow Agent must belong to the same organisation")

    def delete(self, *args, **kwargs):
        from api.utils.agent_sessions import revoke_agent_sessions

        session_ids = list(
            self.sessions.filter(revoked_at__isnull=True).values_list(
                "pk", flat=True
            )
        )
        now = timezone.now()
        self.grants.update(deleted_at=now, updated_at=now)
        self.memberships.update(deleted_at=now, updated_at=now)
        self.tokens.update(deleted_at=now, updated_at=now)
        self.deleted_at = now
        self.save(update_fields=["deleted_at", "updated_at"])
        revoke_agent_sessions(session_ids)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["agent", "name"],
                condition=models.Q(deleted_at__isnull=True),
                name="unique_active_agent_workflow_name",
            ),
        ]
        indexes = [
            models.Index(
                fields=["organisation", "agent", "deleted_at"],
                name="workflow_org_agent_active_idx",
            )
        ]


class AgentMembership(models.Model):
    """Assign an organisation member to an Agent."""

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    agent = models.ForeignKey(
        Agent, on_delete=models.CASCADE, related_name="memberships"
    )
    member = models.ForeignKey(
        OrganisationMember,
        on_delete=models.CASCADE,
        related_name="agent_memberships",
    )
    assigned_by = models.ForeignKey(
        OrganisationMember,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_memberships_assigned",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    def clean(self):
        if self.agent_id and self.member_id and not _same_text_id(
            self.agent.organisation_id, self.member.organisation_id
        ):
            raise ValidationError("Agent membership crosses an organisation boundary")
        if self.agent_id and self.assigned_by_id and not _same_text_id(
            self.agent.organisation_id, self.assigned_by.organisation_id
        ):
            raise ValidationError(
                "Agent membership assigner crosses an organisation boundary"
            )
        if (
            self.deleted_at is None
            and self.member_id
            and self.member.deleted_at is not None
        ):
            raise ValidationError(
                "Agent memberships require an active organisation member"
            )

    @transaction.atomic
    def delete(self, *args, **kwargs):
        from api.utils.agents import retire_member_agent_authentication

        now = timezone.now()
        self.workflow_memberships.filter(deleted_at__isnull=True).update(
            deleted_at=now,
            updated_at=now,
        )
        self.deleted_at = now
        self.save(update_fields=["deleted_at", "updated_at"])
        retire_member_agent_authentication(
            member_id=self.member_id,
            agent_id=self.agent_id,
            retired_at=now,
        )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["agent", "member"],
                condition=models.Q(deleted_at__isnull=True),
                name="unique_active_agent_member",
            ),
        ]
        indexes = [
            models.Index(
                fields=["member", "deleted_at"],
                name="agent_member_active_idx",
            ),
        ]


class AgentWorkflowMembership(models.Model):
    """Assign an Agent member to one Workflow of that Agent."""

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    workflow = models.ForeignKey(
        AgentWorkflow, on_delete=models.CASCADE, related_name="memberships"
    )
    agent_membership = models.ForeignKey(
        AgentMembership,
        on_delete=models.CASCADE,
        related_name="workflow_memberships",
    )
    assigned_by = models.ForeignKey(
        OrganisationMember,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_workflow_memberships_assigned",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    def clean(self):
        if self.workflow_id and self.agent_membership_id:
            if not _same_text_id(
                self.workflow.agent_id, self.agent_membership.agent_id
            ):
                raise ValidationError(
                    "Workflow membership must belong to the same Agent"
                )
            if not _same_text_id(
                self.workflow.organisation_id,
                self.agent_membership.agent.organisation_id,
            ):
                raise ValidationError(
                    "Workflow membership crosses an organisation boundary"
                )
            if not _same_text_id(
                self.workflow.organisation_id,
                self.agent_membership.member.organisation_id,
            ):
                raise ValidationError(
                    "Workflow membership crosses an organisation boundary"
                )
        if self.workflow_id and self.assigned_by_id and not _same_text_id(
            self.workflow.organisation_id, self.assigned_by.organisation_id
        ):
            raise ValidationError(
                "Workflow membership assigner crosses an organisation boundary"
            )
        if (
            self.deleted_at is None
            and self.agent_membership_id
            and self.agent_membership.deleted_at is not None
        ):
            raise ValidationError(
                "Workflow memberships require an active Agent membership"
            )

    @transaction.atomic
    def delete(self, *args, **kwargs):
        from api.utils.agents import retire_member_agent_authentication

        now = timezone.now()
        self.deleted_at = now
        self.save(update_fields=["deleted_at", "updated_at"])
        retire_member_agent_authentication(
            member_id=self.agent_membership.member_id,
            workflow_id=self.workflow_id,
            retired_at=now,
        )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["workflow", "agent_membership"],
                condition=models.Q(deleted_at__isnull=True),
                name="unique_active_workflow_member",
            ),
        ]
        indexes = [
            models.Index(
                fields=["agent_membership", "deleted_at"],
                name="workflow_member_active_idx",
            ),
        ]


class AgentConnection(models.Model):
    PENDING_CREDENTIALS = "pending_credentials"
    ACTIVE = "active"
    DISABLED = "disabled"
    STATE_CHOICES = [
        (PENDING_CREDENTIALS, "Pending credentials"),
        (ACTIVE, "Active"),
        (DISABLED, "Disabled"),
    ]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="agent_connections"
    )
    name = models.CharField(max_length=255)
    service_type = models.CharField(max_length=64)
    config = models.JSONField(default=dict, blank=True)
    authentication = models.ForeignKey(
        ProviderCredentials,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_connections",
    )
    state = models.CharField(
        max_length=32, choices=STATE_CHOICES, default=PENDING_CREDENTIALS
    )
    host_rules_authored_by = models.ForeignKey(
        OrganisationMember,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_host_rules_authored",
    )
    host_rules_approved_by = models.ForeignKey(
        OrganisationMember,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_host_rules_approved",
    )
    # User-supplied hosts are executable trust-boundary configuration. Every
    # revision records authorship; the service registry decides whether it is a
    # normal required endpoint or an optional override needing separate review.
    host_rules_version = models.TextField(default=uuid4, editable=False)
    host_rules_approved_version = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        OrganisationMember,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_connections_created",
    )
    updated_by = models.ForeignKey(
        OrganisationMember,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_connections_updated",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    def clean(self):
        if self.authentication_id:
            if not _same_text_id(
                self.authentication.organisation_id, self.organisation_id
            ):
                raise ValidationError(
                    "Connection authentication must belong to the same organisation"
                )
            if self.authentication.deleted_at is not None:
                raise ValidationError("Connection authentication must be active")
            from api.utils.agent_config import (
                ConfigRegistryError,
                get_config_registry,
            )

            try:
                service = get_config_registry().get_service(self.service_type)
            except ConfigRegistryError as exc:
                raise ValidationError("Connection service type is unsupported") from exc
            allowed_providers = set(service.get("credential_providers") or [])
            if self.authentication.provider not in allowed_providers:
                raise ValidationError(
                    "Connection authentication provider is incompatible with its service"
                )
        if self.state == self.ACTIVE and not self.authentication_id:
            raise ValidationError("Active connections require authentication")
        configured_hosts = (self.config or {}).get("hosts")
        if configured_hosts:
            if not self.host_rules_authored_by_id:
                raise ValidationError("Configured host rules require an author")
            if not _same_text_id(
                self.host_rules_authored_by.organisation_id,
                self.organisation_id,
            ):
                raise ValidationError("Host-rule author crosses an organisation boundary")
            if self.host_rules_approved_by_id:
                if not _same_text_id(
                    self.host_rules_approved_by.organisation_id,
                    self.organisation_id,
                ):
                    raise ValidationError(
                        "Host-rule approver crosses an organisation boundary"
                    )
                if (
                    self.host_rules_authored_by.user_id
                    == self.host_rules_approved_by.user_id
                ):
                    raise ValidationError(
                        "Host rules must be approved by a different human"
                    )
                if not _same_text_id(
                    self.host_rules_version,
                    self.host_rules_approved_version,
                ):
                    raise ValidationError(
                        "Host-rule approval does not match the current version"
                    )
            elif self.host_rules_approved_version:
                raise ValidationError(
                    "Pending host rules cannot carry an approved version"
                )
        elif (
            self.host_rules_authored_by_id
            or self.host_rules_approved_by_id
            or self.host_rules_approved_version
        ):
            raise ValidationError(
                "Connections without configured hosts cannot carry host-rule metadata"
            )

        if not self._state.adding:
            previous = (
                AgentConnection.objects.filter(id=self.id)
                .values("service_type", "config", "host_rules_version")
                .first()
            )
            previous_hosts = (previous or {}).get("config") or {}
            host_scope_changed = (
                previous
                and bool(previous_hosts.get("hosts") or configured_hosts)
                and (
                    previous["service_type"] != self.service_type
                    or previous_hosts.get("hosts") != configured_hosts
                )
            )
            if host_scope_changed and _same_text_id(
                previous["host_rules_version"], self.host_rules_version
            ):
                raise ValidationError(
                    "Changing configured host rules requires a new approval version"
                )


class AgentWorkflowGrant(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="agent_workflow_grants"
    )
    workflow = models.ForeignKey(
        AgentWorkflow, on_delete=models.CASCADE, related_name="grants"
    )
    connection = models.ForeignKey(
        AgentConnection, on_delete=models.PROTECT, related_name="workflow_grants"
    )
    created_by = models.ForeignKey(
        OrganisationMember,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_workflow_grants_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    def clean(self):
        assets = [self.workflow, self.connection]
        if any(
            not _same_text_id(asset.organisation_id, self.organisation_id)
            for asset in assets
        ):
            raise ValidationError("Grant assets must belong to the same organisation")
        if self.connection.deleted_at is not None:
            raise ValidationError("Grant connections must be active")
        if self.connection.state != AgentConnection.ACTIVE:
            raise ValidationError("Grant connections require active authentication")

    def delete(self, *args, **kwargs):
        """Soft-delete the Workflow binding."""

        self.deleted_at = timezone.now()
        self.save(update_fields=["deleted_at", "updated_at"])

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["workflow", "connection"],
                condition=models.Q(deleted_at__isnull=True),
                name="unique_active_workflow_connection_grant",
            )
        ]


class AgentToken(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    workflow = models.ForeignKey(
        AgentWorkflow, on_delete=models.CASCADE, related_name="tokens"
    )
    name = models.CharField(max_length=64)
    # BLAKE2b digest of the reveal-once bearer agent token. Plaintext is never stored.
    token = models.CharField(max_length=64, unique=True)
    created_by = models.ForeignKey(
        OrganisationMember,
        on_delete=models.CASCADE,
        related_name="agent_tokens_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    @property
    def agent(self):
        """The Agent this row belongs to, through its Workflow."""
        return self.workflow.agent

    @property
    def agent_id(self):
        return self.workflow.agent_id

    def clean(self):
        if self.created_by_id and not _same_text_id(
            self.created_by.organisation_id, self.workflow.organisation_id
        ):
            raise ValidationError("Agent token creator crosses an organisation boundary")
        if self.created_by_id and self.created_by.deleted_at is not None:
            raise ValidationError("Agent tokens require an active organisation member")
        try:
            token_lookup = bytes.fromhex(self.token)
        except (TypeError, ValueError) as exc:
            raise ValidationError("Agent token digest must be hex encoded") from exc
        if len(token_lookup) != 32:
            raise ValidationError("Agent token digest must be 32 bytes")

    def delete(self, *args, **kwargs):
        self.deleted_at = timezone.now()
        self.save(update_fields=["deleted_at", "updated_at"])


class AgentSession(models.Model):
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="agent_sessions"
    )
    workflow = models.ForeignKey(
        AgentWorkflow, on_delete=models.CASCADE, related_name="sessions"
    )
    session_uid = models.TextField(default=uuid4, primary_key=True, editable=False)
    hashed_session_credential = models.CharField(max_length=128)
    open_idempotency_key = models.CharField(
        max_length=128, unique=True, null=True, blank=True
    )
    expires_at = models.DateTimeField()
    max_expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    config_generation = models.PositiveBigIntegerField(default=1)
    # Non-secret, Agent-visible provider metadata captured during an authorized
    # config render. Discover reads this versioned snapshot so it can reproduce
    # the active proxy environment without decrypting or provisioning a second
    # credential.
    runtime_snapshot = models.JSONField(default=dict, blank=True)
    client_info = models.JSONField(default=dict, blank=True)
    harness_label = models.CharField(max_length=128, blank=True, default="")
    agent_token = models.ForeignKey(
        AgentToken,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sessions",
    )
    opened_by_member = models.ForeignKey(
        OrganisationMember,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_sessions_opened",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now_add=True)

    @property
    def agent(self):
        """The Agent this row belongs to, through its Workflow."""
        return self.workflow.agent

    @property
    def agent_id(self):
        return self.workflow.agent_id

    def clean(self):
        if self.workflow_id and not _same_text_id(
            self.workflow.organisation_id, self.organisation_id
        ):
            raise ValidationError("AgentSession Workflow must belong to its organisation")
        authenticators = [
            self.agent_token,
            self.opened_by_member,
        ]
        authenticator_count = sum(
            authenticator is not None for authenticator in authenticators
        )
        if self._state.adding and authenticator_count == 0:
            raise ValidationError("AgentSession requires exactly one authenticator")
        if authenticator_count > 1:
            raise ValidationError("AgentSession requires exactly one authenticator")
        if self.agent_token_id and not _same_text_id(
            self.agent_token.workflow_id, self.workflow_id
        ):
            raise ValidationError("Agent token is not scoped to this Workflow")
        authenticator = (
            self.opened_by_member
            or (self.agent_token.agent if self.agent_token_id else None)
        )
        if authenticator is not None and not _same_text_id(
            authenticator.organisation_id, self.organisation_id
        ):
            raise ValidationError(
                "AgentSession authenticator crosses an organisation boundary"
            )

    @property
    def is_active(self):
        return self.revoked_at is None and self.expires_at > timezone.now()

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(
                        agent_token__isnull=False,
                        opened_by_member__isnull=True,
                    )
                    | models.Q(
                        agent_token__isnull=True,
                        opened_by_member__isnull=False,
                    )
                ),
                name="agent_session_exactly_one_authenticator",
            )
        ]
        indexes = [
            models.Index(
                fields=["workflow", "-created_at"],
                name="agent_session_recent_idx",
            ),
            models.Index(
                fields=["organisation", "revoked_at", "expires_at"],
                name="agent_session_status_idx",
            ),
        ]


class AgentDecoy(models.Model):
    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="agent_decoys"
    )
    agent = models.ForeignKey(
        Agent,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="decoys",
    )
    authentication = models.ForeignKey(
        ProviderCredentials,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="decoys",
    )
    grant = models.ForeignKey(
        AgentWorkflowGrant, on_delete=models.CASCADE, related_name="decoys"
    )
    session = models.ForeignKey(
        AgentSession, on_delete=models.CASCADE, related_name="decoys"
    )
    kind = models.CharField(max_length=64)
    field_name = models.CharField(max_length=128)
    decoy_value = models.TextField(unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["session", "grant", "field_name"],
                name="unique_agent_decoy_field_per_grant",
            ),
        ]


class AgentRequest(models.Model):
    SETUP = "setup"
    CREDENTIAL_UPDATE = "credential_update"
    KIND_CHOICES = [
        (SETUP, "Setup"),
        (CREDENTIAL_UPDATE, "Credential update"),
    ]

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (CANCELLED, "Cancelled"),
        (PENDING, "Pending"),
        (APPROVED, "Approved"),
        (DENIED, "Denied"),
        (EXPIRED, "Expired"),
    ]

    id = models.TextField(default=uuid4, primary_key=True, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="agent_requests"
    )
    workflow = models.ForeignKey(
        AgentWorkflow, on_delete=models.CASCADE, related_name="requests"
    )
    connection = models.ForeignKey(
        AgentConnection,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="requests",
    )
    grant = models.ForeignKey(
        AgentWorkflowGrant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="requests",
    )
    kind = models.CharField(max_length=32, choices=KIND_CHOICES)
    credential = models.ForeignKey(
        ProviderCredentials,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_requests",
    )
    markdown = models.TextField()
    service_type = models.CharField(max_length=64, null=True, blank=True)
    credential_provider = models.CharField(max_length=50, null=True, blank=True)
    credential_name = models.CharField(max_length=64, blank=True, default="")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=PENDING)
    resolution_note = models.TextField(blank=True, default="")
    progress = models.JSONField(default=dict, blank=True)
    resolution = models.JSONField(default=dict, blank=True)
    revision = models.TextField(default=uuid4, editable=False)
    related_request = models.ForeignKey("self", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="followups")
    resolved_by = models.ForeignKey(
        OrganisationMember,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_requests_resolved",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    dedup_key = models.CharField(max_length=128, blank=True, default="", db_index=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        fields = kwargs.get("update_fields")
        if not self._state.adding and (fields is None or "revision" not in fields):
            self.revision = str(uuid4())
            if fields is not None:
                kwargs["update_fields"] = [*fields, "revision"]
        super().save(*args, **kwargs)

    @property
    def agent(self):
        """The Agent this row belongs to, through its Workflow."""
        return self.workflow.agent

    @property
    def agent_id(self):
        return self.workflow.agent_id

    def clean(self):
        if self.workflow_id and not _same_text_id(
            self.workflow.organisation_id, self.organisation_id
        ):
            raise ValidationError("Request Workflow must belong to its organisation")
        if self.connection_id and not _same_text_id(
            self.connection.organisation_id, self.organisation_id
        ):
            raise ValidationError("Request Connection crosses an organisation boundary")
        if self.credential_id and not _same_text_id(
            self.credential.organisation_id, self.organisation_id
        ):
            raise ValidationError("Request Credential crosses an organisation boundary")
        if self.grant_id:
            if not _same_text_id(self.grant.organisation_id, self.organisation_id):
                raise ValidationError("Request Grant crosses an organisation boundary")
            if not _same_text_id(self.grant.workflow_id, self.workflow_id):
                raise ValidationError("Request Grant must belong to its Workflow")
            if self.connection_id and not _same_text_id(
                self.grant.connection_id, self.connection_id
            ):
                raise ValidationError("Request Connection must match its Grant")
        if self.kind == self.SETUP:
            if not self.connection_id or not self.service_type:
                raise ValidationError("setup requests require a pending connection")
            if not self.credential_provider or not self.credential_name:
                raise ValidationError(
                    "setup requests require a credential provider and name"
                )
            if (
                self.status == self.PENDING
                and self.connection.state != AgentConnection.PENDING_CREDENTIALS
            ):
                raise ValidationError("setup requests require a pending connection")
        elif self.kind == self.CREDENTIAL_UPDATE:
            if not self.connection_id:
                raise ValidationError("credential_update requests require a connection")
        else:
            raise ValidationError("Unsupported Agent request kind")

    class Meta:
        indexes = [
            models.Index(
                fields=["organisation", "status", "-created_at"],
                name="agent_request_queue_idx",
            ),
            models.Index(
                fields=["workflow", "status", "-created_at"],
                name="agent_request_workflow_idx",
            ),
        ]


class AgentEvent(models.Model):
    """High-volume runtime stream with monotonic ingest and idempotent event IDs."""

    ALLOW = "allow"
    BLOCK = "block"
    AUTH_DENY = "auth_deny"
    ERROR = "error"
    DECISION_CHOICES = [
        (ALLOW, "Allow"),
        (BLOCK, "Block"),
        (AUTH_DENY, "Authentication denied"),
        (ERROR, "Error"),
    ]

    ingest_seq = models.BigAutoField(primary_key=True)
    event_id = models.TextField()
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="agent_events"
    )
    agent = models.ForeignKey(
        Agent, on_delete=models.SET_NULL, null=True, related_name="events"
    )
    workflow = models.ForeignKey(
        AgentWorkflow, on_delete=models.SET_NULL, null=True, related_name="events"
    )
    connection = models.ForeignKey(
        AgentConnection,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="events",
    )
    session = models.ForeignKey(
        AgentSession,
        on_delete=models.SET_NULL,
        null=True,
        related_name="events",
    )
    proxy_created_at = models.DateTimeField()
    ingested_at = models.DateTimeField(auto_now_add=True)
    event_type = models.CharField(max_length=64)
    protocol = models.CharField(max_length=32)
    method = models.CharField(max_length=32, blank=True, default="")
    host = models.CharField(max_length=512)
    port = models.PositiveIntegerField(null=True, blank=True)
    path = models.TextField(blank=True, default="")
    provider = models.CharField(max_length=64)
    status_code = models.IntegerField(null=True, blank=True)
    proxy_decision = models.CharField(max_length=32, choices=DECISION_CHOICES)
    outcome = models.CharField(max_length=32, blank=True, default="")
    latency_ms = models.PositiveIntegerField(null=True, blank=True)
    credential_action = models.CharField(max_length=64, blank=True, default="")
    bytes_in = models.PositiveBigIntegerField(default=0)
    bytes_out = models.PositiveBigIntegerField(default=0)
    reason = models.CharField(max_length=512, blank=True, default="")
    detail = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["session", "event_id"],
                name="unique_agent_event_id_per_session",
            )
        ]
        indexes = [
            models.Index(
                fields=["agent", "ingest_seq"], name="agent_event_agent_seq_idx"
            ),
            models.Index(
                fields=["workflow", "ingest_seq"],
                name="agent_event_workflow_seq_idx",
            ),
            models.Index(
                fields=["session", "ingest_seq"], name="agent_event_session_seq_idx"
            ),
            models.Index(
                fields=["organisation", "ingest_seq"], name="agent_event_org_seq_idx"
            ),
        ]
        ordering = ["-ingest_seq"]
