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
    list_display = ("name", "identity_key", "id")

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
        if not can_add_account(organisation):
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
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    expires_at = models.DateTimeField(null=True)

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
