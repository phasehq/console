from django.utils import timezone
from django.core.exceptions import ValidationError

from api.models import DynamicSecret, DynamicSecretLeaseEvent
from api.utils.crypto import decrypt_asymmetric, encrypt_asymmetric, get_server_keypair
from api.utils.syncing.aws.auth import get_aws_sts_session
from api.utils.secrets import get_environment_keys

from api.utils.rest import get_resolver_request_meta
from backend.utils.secrets import get_secret
from ee.integrations.secrets.dynamic.providers import DynamicSecretProviders
import logging
from datetime import datetime, timedelta
import boto3
from botocore.exceptions import ClientError, BotoCoreError
from api.models import DynamicSecret, DynamicSecretLease
import string
import random
import re
import django_rq


logger = logging.getLogger(__name__)


def generate_random_string(length=8):
    """Generate random alphanumeric suffix."""
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=length))


def render_username_template(template: str) -> str:
    """
    Render a username template by replacing {{ random }} placeholders.

    Examples:
        'prefix-{{ random }}' -> 'prefix-x8f2k9'
        '{{ random }}-suffix' -> 'q1z9xk-suffix'
        'plain-username'      -> 'plain-username'
    """

    def replace_placeholder(match):
        return generate_random_string(
            random.randint(6, 18)
        )  # random length between 6–18

    return re.sub(r"\{\{\s*random\s*\}\}", replace_placeholder, template)


def get_aws_access_key_credentials(provider_credentials):
    """
    Get AWS integration Access Key credentials from ProviderCredentials object.

    Args:
        provider_credentials: ProviderCredentials object with access key credentials

    Returns:
        dict: Decrypted credentials containing access_key_id, secret_access_key, and region
    """
    pk, sk = get_server_keypair()

    access_key_id = decrypt_asymmetric(
        provider_credentials.credentials["access_key_id"], sk.hex(), pk.hex()
    )
    secret_access_key = decrypt_asymmetric(
        provider_credentials.credentials["secret_access_key"],
        sk.hex(),
        pk.hex(),
    )
    region = decrypt_asymmetric(
        provider_credentials.credentials["region"], sk.hex(), pk.hex()
    )

    return {
        "access_key_id": access_key_id,
        "secret_access_key": secret_access_key,
        "region": region,
    }


def get_aws_assume_role_credentials(provider_credentials):
    """
    Get AWS integratio Assume Role credentials from ProviderCredentials object.

    Args:
        provider_credentials: ProviderCredentials object with assume role credentials

    Returns:
        dict: Decrypted credentials containing role_arn, region, and external_id
    """
    pk, sk = get_server_keypair()

    role_arn = decrypt_asymmetric(
        provider_credentials.credentials["role_arn"], sk.hex(), pk.hex()
    )

    region = None
    if "region" in provider_credentials.credentials:
        region = decrypt_asymmetric(
            provider_credentials.credentials["region"], sk.hex(), pk.hex()
        )

    external_id = None
    if "external_id" in provider_credentials.credentials:
        external_id = decrypt_asymmetric(
            provider_credentials.credentials["external_id"], sk.hex(), pk.hex()
        )

    return {
        "role_arn": role_arn,
        "region": region,
        "external_id": external_id,
    }


def build_dynamic_secret_config(provider: str, user_config: dict) -> dict:
    """
    Merge user-supplied config with provider defaults for key_map.
    - All non-key_map fields are preserved exactly as user provided.
    - key_map is filled with defaults where user did not specify.
    """
    # --- find provider definition ---
    provider_def = None
    for prov in DynamicSecretProviders.__dict__.values():
        if isinstance(prov, dict) and prov.get("id") == provider:
            provider_def = prov
            break
    if not provider_def:
        raise ValidationError(f"Unsupported provider: {provider}")

    # --- start with user config ---
    merged_config = dict(user_config or {})

    # --- build key_map ---
    key_map = merged_config.get("key_map", {})
    merged_key_map = {}
    for cred in provider_def.get("credentials", []):
        cid = cred["id"]
        default_key = cred.get("default_key_name")
        merged_key_map[cid] = key_map.get(cid, default_key)

    merged_config["key_map"] = merged_key_map
    return merged_config


def create_temporary_user(user_config, iam_client):
    """
    Create a temporary IAM user with specified configuration.

    Args:
        user_config (dict): Configuration for user creation
            - username_template (str): Base name for user
            - groups (list of str, optional): Comma separated list of groups to add user to
            - policy_arns (list of str, optional): Policy ARN to attach
            - iam_user_path (str, optional): User path
            - permission_boundary_arn (str, optional): Permission boundary ARN
            - ttl_seconds (int): Time to live in seconds

    Returns:
        dict: User creation result with username and metadata
    """
    try:
        # Generate unique username
        base_template = user_config.get(
            "username_template", "phase-dynamic-{{ random }}"
        )
        username = render_username_template(base_template)

        # Prepare user creation parameters
        path = user_config.get("iam_user_path", "/") or "/"

        # ensure leading slash
        if not path.startswith("/"):
            path = "/" + path

        # ensure trailing slash
        if not path.endswith("/"):
            path = path + "/"

        create_params = {
            "UserName": username,
            "Path": path,
        }

        # Add permission boundary if specified
        if user_config.get("permission_boundary_arn"):
            create_params["PermissionsBoundary"] = user_config[
                "permission_boundary_arn"
            ]

        # Create IAM user
        response = iam_client.create_user(**create_params)

        # Add tags to track the user
        creation_time = datetime.utcnow()
        expiry_time = creation_time + timedelta(
            seconds=user_config.get("ttl_seconds", 60)
        )

        iam_client.tag_user(
            UserName=username,
            Tags=[
                {"Key": "CreatedBy", "Value": "phase-dynamic-secrets"},
                {"Key": "CreationTime", "Value": creation_time.isoformat()},
                {"Key": "ExpiryTime", "Value": expiry_time.isoformat()},
                {"Key": "TTL", "Value": str(user_config.get("ttl_seconds", 60))},
            ],
        )

        # Attach policies if specified
        policy_arns = user_config.get("policy_arns")
        if policy_arns:
            # Support both comma-separated string and list
            if isinstance(policy_arns, str):
                policy_arns = [p.strip() for p in policy_arns.split(",") if p.strip()]
            for policy_arn in policy_arns:
                try:
                    iam_client.attach_user_policy(
                        UserName=username, PolicyArn=policy_arn
                    )
                    logger.info(f"Attached policy {policy_arn} to user {username}")
                except ClientError as e:
                    logger.error(
                        f"Failed to attach policy {policy_arn} to user {username}: {str(e)}"
                    )
                    raise

        # Add user to specified groups
        groups = user_config.get("groups")
        if groups:
            # If groups is a string (legacy), split by comma
            if isinstance(groups, str):
                groups = [g.strip() for g in groups.split(",") if g.strip()]
            for group_name in groups:
                try:
                    iam_client.add_user_to_group(
                        GroupName=group_name, UserName=username
                    )
                    logger.info(f"Added user {username} to group {group_name}")
                except ClientError as e:
                    logger.error(
                        f"Failed to add user {username} to group {group_name}: {str(e)}"
                    )
                    raise

        logger.info(f"Successfully created temporary IAM user: {username}")

        return {
            "username": username,
            "arn": response["User"]["Arn"],
            "creation_time": creation_time.isoformat(),
            "expiry_time": expiry_time.isoformat(),
        }

    except ClientError as e:
        logger.error(f"AWS client error creating user: {str(e)}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error creating user: {str(e)}")
        raise


def create_access_key(username, iam_client):
    """
    Create access key for IAM user.

    Args:
        username (str): IAM username

    Returns:
        dict: Access key details
    """
    try:
        response = iam_client.create_access_key(UserName=username)
        access_key = response["AccessKey"]

        logger.info(f"Successfully created access key for user: {username}")

        return {
            "access_key_id": access_key["AccessKeyId"],
            "secret_access_key": access_key["SecretAccessKey"],
            "status": access_key["Status"],
        }

    except ClientError as e:
        logger.error(f"AWS client error creating access key: {str(e)}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error creating access key: {str(e)}")
        raise


def get_sts_client(region="us-east-1"):

    aws_access_key_id = get_secret("AWS_INTEGRATION_ACCESS_KEY_ID")
    aws_secret_access_key = get_secret("AWS_INTEGRATION_SECRET_ACCESS_KEY")

    sts_client = boto3.client(
        "sts",
        region_name=region,
        aws_access_key_id=aws_access_key_id,
        aws_secret_access_key=aws_secret_access_key,
    )

    return sts_client


import boto3


def get_iam_client(secret: DynamicSecret) -> tuple[boto3.client, dict]:
    """
    Construct an IAM client using the given DynamicSecret's authentication config.
    Returns (iam_client, aws_credentials).
    """
    sts_client = get_sts_client()

    # Determine authentication method
    has_role_arn = "role_arn" in secret.authentication.credentials
    aws_credentials = {}

    if has_role_arn:
        integration_credentials = get_aws_assume_role_credentials(secret.authentication)
        role_arn = integration_credentials.get("role_arn")
        assumed_role = sts_client.assume_role(
            RoleArn=role_arn, RoleSessionName="phase-dynamic-secret-session"
        )
        aws_credentials = assumed_role["Credentials"]
    else:
        integration_credentials = get_aws_access_key_credentials(secret.authentication)
        aws_credentials["AccessKeyId"] = integration_credentials.get("access_key_id")
        aws_credentials["SecretAccessKey"] = integration_credentials.get(
            "secret_access_key"
        )

    region = integration_credentials.get("region")

    # Construct IAM client kwargs
    iam_client_kwargs = {
        "service_name": "iam",
        "region_name": region,
        "aws_access_key_id": aws_credentials["AccessKeyId"],
        "aws_secret_access_key": aws_credentials["SecretAccessKey"],
    }
    if "SessionToken" in aws_credentials:
        iam_client_kwargs["aws_session_token"] = aws_credentials["SessionToken"]

    return boto3.client(**iam_client_kwargs), aws_credentials


def create_aws_dynamic_secret_lease(
    *,
    secret: DynamicSecret,
    lease_name,
    organisation_member=None,
    service_account=None,
    ttl_seconds,
) -> dict:
    """
    Create a new lease for dynamic AWS credentials.
    """

    lease_config = secret.config

    if not organisation_member and not service_account:
        raise ValidationError("Must set either organisation_member or service_account")
    if organisation_member and service_account:
        raise ValidationError(
            "Only one of organisation_member or service_account may be set"
        )

    iam_client, _ = get_iam_client(secret)

    # Build config for user creation
    user_config = {
        "username_template": lease_config.get("username_template"),
        "groups": lease_config.get("groups"),
        "policy_arns": lease_config.get("policy_arns"),
        "iam_user_path": lease_config.get("iam_path", "/"),
        "permission_boundary_arn": lease_config.get("permission_boundary_arn"),
        "ttl_seconds": ttl_seconds,
    }

    user_result = create_temporary_user(user_config, iam_client)
    username = user_result["username"]

    # Create access key for the user
    access_key_result = create_access_key(username, iam_client)

    lease_data = {
        "username": username,
        "user_arn": user_result["arn"],
        "access_key_id": access_key_result["access_key_id"],
        "secret_access_key": access_key_result["secret_access_key"],
        "creation_time": user_result["creation_time"],
        "expiry_time": user_result["expiry_time"],
        "ttl_seconds": user_config.get("ttl_seconds", 60),
    }

    env_pubkey, _ = get_environment_keys(secret.environment.id)

    encrypted_credentials = {
        "access_key_id": encrypt_asymmetric(
            access_key_result["access_key_id"], env_pubkey
        ),
        "secret_access_key": encrypt_asymmetric(
            access_key_result["secret_access_key"], env_pubkey
        ),
        "username": encrypt_asymmetric(username, env_pubkey),
    }

    lease = DynamicSecretLease.objects.create(
        secret=secret,
        name=lease_name,
        organisation_member=organisation_member,
        service_account=service_account,
        ttl=timedelta(seconds=ttl_seconds),
        expires_at=timezone.now() + timedelta(seconds=ttl_seconds),
        credentials=encrypted_credentials,
    )

    # --- Schedule revocation ---
    from ee.integrations.secrets.dynamic.utils import schedule_lease_revocation

    schedule_lease_revocation(lease)

    return lease, lease_data


def revoke_aws_dynamic_secret_lease(
    lease_id,
    manual=False,
    request=None,
    organisation_member=None,
    service_account=None,
):
    """
    Delete IAM user and all associated credentials.

    Args:
        lease_id (DynamicSecretLease): id for the lease containing IAM username to delete
        manual (boolean): Whether this is a manual revoke or automatically scheduled expiry. Defaults to false

    Returns:
        bool: True if successful, False otherwise
    """
    lease = DynamicSecretLease.objects.get(id=lease_id)

    if lease.revoked_at is not None:
        logger.info(f"Lease {lease.id} already revoked at {lease.revoked_at}")
        return

    logger.info(f"Revoking lease {lease.id} (manual={manual})")

    iam_client, _ = get_iam_client(lease.secret)

    meta = {
        "action": "revoke",
        "provider": "aws",
        "source": "manual" if manual else "scheduled",
        "deleted_access_keys": [],
        "detached_policies": [],
        "deleted_inline_policies": [],
        "removed_groups": [],
    }

    try:
        # Decrypt username
        env_pubkey, env_privkey = get_environment_keys(lease.secret.environment.id)
        encrypted_username = lease.credentials.get("username")
        username = decrypt_asymmetric(encrypted_username, env_privkey, env_pubkey)

        # List and delete all access keys for the user
        access_keys = iam_client.list_access_keys(UserName=username)
        for key in access_keys["AccessKeyMetadata"]:
            iam_client.delete_access_key(
                UserName=username, AccessKeyId=key["AccessKeyId"]
            )
            logger.info(f"Deleted access key for user")
            meta["deleted_access_keys"].append(key["AccessKeyId"])

        # Detach all managed policies
        attached_policies = iam_client.list_attached_user_policies(UserName=username)
        for policy in attached_policies["AttachedPolicies"]:
            iam_client.detach_user_policy(
                UserName=username, PolicyArn=policy["PolicyArn"]
            )
            logger.info(f"Detached policy from user")
            meta["detached_policies"].append(policy["PolicyArn"])

        # Delete all inline policies
        inline_policies = iam_client.list_user_policies(UserName=username)
        for policy_name in inline_policies["PolicyNames"]:
            iam_client.delete_user_policy(UserName=username, PolicyName=policy_name)
            logger.info(f"Deleted inline policy from user")
            meta["deleted_inline_policies"].append(policy_name)

        # Remove user from all groups
        groups_resp = iam_client.list_groups_for_user(UserName=username)
        for group in groups_resp["Groups"]:
            iam_client.remove_user_from_group(
                UserName=username, GroupName=group["GroupName"]
            )
            logger.info(f"Removed user from group")
            meta["removed_groups"].append(group["GroupName"])

        # Finally, delete the user
        iam_client.delete_user(UserName=username)
        logger.info(f"Successfully deleted IAM user")

        if manual:
            lease.status = DynamicSecretLease.REVOKED
        else:
            lease.status = DynamicSecretLease.EXPIRED
        lease.credentials = {}
        lease.revoked_at = timezone.now()
        lease.save()

        # Add request metadata if available
        ip_address = user_agent = None
        if request is not None:
            try:
                ip_address, user_agent = get_resolver_request_meta(request)

                logger.info(f"Created revoke event for lease {lease.id}")
            except Exception:
                logger.error(
                    "Failed to read request meta for lease event", exc_info=True
                )
                pass

        DynamicSecretLeaseEvent.objects.create(
            lease=lease,
            event_type=DynamicSecretLease.REVOKED,
            organisation_member=organisation_member,
            service_account=service_account,
            ip_address=ip_address,
            user_agent=user_agent,
            metadata=meta,
        )

        return True

    except iam_client.exceptions.NoSuchEntityException:
        logger.warning(
            f"User {meta.get('username', '<unknown>')} does not exist, treating as already revoked"
        )
        # Emit event to reflect attempted revoke on missing user
        meta["outcome"] = "user_absent"
        try:
            DynamicSecretLeaseEvent.objects.create(
                lease=lease,
                event_type=DynamicSecretLease.REVOKED,
                organisation_member=organisation_member,
                service_account=service_account,
                ip_address=ip_address,
                user_agent=user_agent,
                metadata=meta,
            )
        except Exception as e:
            logger.warning(f"Failed to create revoke event for lease {lease.id}: {e}")
        return True
    except ClientError as e:
        logger.error(f"AWS client error deleting user: {str(e)}")
        meta["outcome"] = "error"
        meta["error"] = str(e)
        try:
            DynamicSecretLeaseEvent.objects.create(
                lease=lease,
                event_type=DynamicSecretLease.REVOKED,
                organisation_member=organisation_member,
                service_account=service_account,
                ip_address=ip_address,
                user_agent=user_agent,
                metadata=meta,
            )
        except Exception:
            pass
        raise ValidationError(f"AWS client error deleting user: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error deleting user: {str(e)}")
        meta["outcome"] = "error"
        meta["error"] = str(e)
        try:
            DynamicSecretLeaseEvent.objects.create(
                lease=lease,
                event_type=DynamicSecretLease.REVOKED,
                organisation_member=organisation_member,
                service_account=service_account,
                ip_address=ip_address,
                user_agent=user_agent,
                metadata=meta,
            )
        except Exception:
            pass
        raise Exception(f"Unexpected error deleting user: {str(e)}")
