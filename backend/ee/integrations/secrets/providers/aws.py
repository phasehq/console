"""AWS credential provider that rotates the access keys of an existing IAM user."""

from __future__ import annotations

import itertools
import re
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    NoCredentialsError,
    ParamValidationError,
    PartialCredentialsError,
)

from api.utils.syncing.aws.auth import get_aws_sts_session

from .base import (
    ConfigSchemaField,
    CredentialProvider,
    CredentialSchemaField,
    MintResult,
    OutputSchemaField,
    ResourceOption,
)
from .exceptions import (
    ProviderAuthError,
    ProviderConfigError,
    ProviderError,
    ProviderNotFound,
    ProviderTransientError,
)
from .sanitize import excerpt

_PROVIDER_ID_SEP = ":"

# CreateAccessKey's UserName pattern. It excludes ":", so provider IDs split cleanly.
_USER_NAME_RE = re.compile(r"[\w+=,.@-]{1,128}", re.ASCII)

_MAX_USER_PAGES = 50
_USERS_PAGE_SIZE = 1000

# Same budget as http.DEFAULT_TIMEOUT so a hung endpoint can't outlive the rotation job.
_BOTO_CONFIG = Config(
    connect_timeout=5,
    read_timeout=30,
    retries={"mode": "standard", "total_max_attempts": 2},
)

_AUTH_ERROR_CODES = frozenset(
    {
        "AccessDenied",
        "AccessDeniedException",
        "ExpiredToken",
        "ExpiredTokenException",
        "InvalidClientTokenId",
        "NotAuthorized",
        "SignatureDoesNotMatch",
        "UnrecognizedClientException",
    }
)

_TRANSIENT_ERROR_CODES = frozenset(
    {
        "InternalFailure",
        "RequestLimitExceeded",
        "ServiceFailure",
        "ServiceUnavailable",
        "Throttling",
        "ThrottlingException",
    }
)


def _encode_provider_id(user_name: str, access_key_id: str) -> str:
    return f"{user_name}{_PROVIDER_ID_SEP}{access_key_id}"


def _decode_provider_id(provider_credential_id: str) -> tuple[str, str]:
    parts = provider_credential_id.split(_PROVIDER_ID_SEP, 1)
    if len(parts) != 2 or not all(parts):
        raise ProviderConfigError(
            f"Malformed provider credential ID: {provider_credential_id!r}",
            user_message=(
                "This credential's ID isn't in the 'IAM user:access key ID' "
                "format. Delete the access key manually in AWS."
            ),
        )
    user_name, access_key_id = parts
    return user_name, access_key_id


def _with_detail(summary: str, detail: str) -> str:
    return f"{summary}: {detail}" if detail else f"{summary}."


def _translate_error(
    error: Exception, action: str, user_name: str = ""
) -> ProviderError:
    """Map a boto3 error raised during `action` (assume_role, list, mint or revoke)."""
    if isinstance(error, ClientError):
        details = error.response.get("Error") or {}
        code = str(details.get("Code") or "Unknown")
        aws_message = excerpt(str(details.get("Message") or "")).strip()[:300]
        status = (error.response.get("ResponseMetadata") or {}).get("HTTPStatusCode")
        message = f"AWS {error.operation_name} failed: {code}"
        raw = {"error_code": code, "operation": error.operation_name}

        if code in _TRANSIENT_ERROR_CODES or (status or 0) >= 500:
            return ProviderTransientError(
                message,
                user_message=f"AWS is throttling or unavailable ({code}). Will retry.",
                raw=raw,
            )
        if action == "assume_role":
            return ProviderAuthError(
                message,
                user_message=_with_detail(
                    f"Phase couldn't assume the IAM role ({code})", aws_message
                ),
                raw=raw,
            )
        if code in _AUTH_ERROR_CODES:
            return ProviderAuthError(
                message,
                user_message=_with_detail(
                    f"AWS denied the request ({code})", aws_message
                ),
                raw=raw,
            )
        if action == "mint" and code == "LimitExceeded":
            # Transient: a pending revoke usually frees a key slot before the next retry.
            return ProviderTransientError(
                message,
                user_message=(
                    f"IAM user '{user_name}' already has 2 access keys (the AWS "
                    "limit). Revoke the expiring credential in Phase or delete an "
                    "unused key in AWS."
                ),
                raw=raw,
            )
        if action == "mint" and code == "NoSuchEntity":
            return ProviderConfigError(
                message, user_message=f"IAM user '{user_name}' not found.", raw=raw
            )
        if action == "revoke" and code == "NoSuchEntity":
            return ProviderNotFound(
                message,
                user_message=_with_detail("Not found in AWS", aws_message),
                raw=raw,
            )
        return ProviderConfigError(
            message,
            user_message=_with_detail(f"AWS returned an error ({code})", aws_message),
            raw=raw,
        )

    message = f"AWS {action} failed: {error.__class__.__name__}"
    raw = {"error_class": error.__class__.__name__}
    if isinstance(error, (NoCredentialsError, PartialCredentialsError)):
        return ProviderAuthError(
            message,
            user_message=(
                "This Phase instance has no AWS credentials to assume the role with."
                if action == "assume_role"
                else "The AWS credentials are missing or incomplete."
            ),
            raw=raw,
        )
    if isinstance(error, ParamValidationError):
        # Rejected client-side, so retrying can't help.
        if action == "assume_role":
            return ProviderAuthError(
                message,
                user_message="The role ARN or external ID in these credentials is invalid.",
                raw=raw,
            )
        return ProviderConfigError(
            message, user_message="AWS rejected the request parameters.", raw=raw
        )
    return ProviderTransientError(
        message, user_message="Could not reach AWS. Will retry.", raw=raw
    )


def _session(root_creds: dict) -> boto3.Session:
    """Session for stored `aws` (access key) or `aws_assume_role` credentials."""
    region = root_creds.get("region") or None
    if root_creds.get("role_arn"):
        try:
            return get_aws_sts_session(
                root_creds["role_arn"], region, root_creds.get("external_id") or None
            )
        except (ClientError, BotoCoreError) as e:
            raise _translate_error(e, "assume_role") from e
    if not root_creds.get("access_key_id") or not root_creds.get("secret_access_key"):
        raise ProviderAuthError(
            "AWS root credentials have no role ARN or access key pair",
            user_message=(
                "These AWS credentials are missing the access key ID or secret "
                "access key."
            ),
        )
    return boto3.Session(
        aws_access_key_id=root_creds["access_key_id"],
        aws_secret_access_key=root_creds["secret_access_key"],
        region_name=region,
    )


def _client(root_creds: dict, service: str):
    return _session(root_creds).client(service, config=_BOTO_CONFIG)


def _call_summary(operation: str, response: Any) -> dict:
    meta = (response or {}).get("ResponseMetadata") or {}
    return {
        "operation": operation,
        "status": meta.get("HTTPStatusCode"),
        "request_id": meta.get("RequestId"),
    }


class AWSProvider(CredentialProvider):
    id = "aws"
    name = "AWS"
    key_name_prefix = "AWS"
    credential_id_label = "IAM user:access key ID"
    extra_credential_providers = ("aws_assume_role",)

    credential_schema = [
        CredentialSchemaField(
            id="access_key_id",
            label="Access Key ID",
            required=True,
            help_text=(
                "Access key of the IAM identity that rotates the target user's "
                "keys. It needs iam:CreateAccessKey and iam:DeleteAccessKey on "
                "that user, and iam:ListUsers to pick it. Saved AWS assume-role "
                "credentials work too if the role has these permissions."
            ),
        ),
        CredentialSchemaField(
            id="secret_access_key",
            label="Secret Access Key",
            required=True,
            masked=True,
            help_text="Secret access key for the access key ID above.",
        ),
        CredentialSchemaField(
            id="region",
            label="Region",
            required=True,
            help_text=(
                "IAM is global, but the region selects the AWS partition, for "
                "example China or GovCloud."
            ),
        ),
    ]

    config_schema = [
        ConfigSchemaField(
            id="user_name",
            label="IAM user",
            required=True,
            resource_type="iam_user",
            help_url="https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
            help_text=(
                "The existing IAM user whose access keys Phase rotates. AWS "
                "allows 2 access keys per user, and each rotation creates the new "
                "key before it deletes the old one, so remove any other keys from "
                "this user. The root identity needs iam:CreateAccessKey and "
                "iam:DeleteAccessKey on this user, plus iam:ListUsers to list "
                "users here. New keys can take a few seconds to work, so set a "
                "non-zero revocation delay."
            ),
        ),
    ]

    output_schema = [
        OutputSchemaField(
            id="access_key_id",
            label="Access Key ID",
            masked=False,
            help_text="The IAM access key ID.",
        ),
        OutputSchemaField(
            id="secret_access_key",
            label="Secret Access Key",
            masked=True,
            help_text="The secret access key that signs requests as the IAM user.",
        ),
    ]

    @classmethod
    def validate_config(cls, config: dict) -> None:
        user_name = config.get("user_name")
        if not user_name or not isinstance(user_name, str):
            raise ProviderConfigError(
                "user_name is required and must be a string",
                user_message="Pick the IAM user whose access keys Phase rotates.",
            )
        if not _USER_NAME_RE.fullmatch(user_name):
            raise ProviderConfigError(
                f"Invalid IAM user name: {user_name!r}",
                user_message=(
                    "IAM user names can only contain letters, digits and the "
                    "characters _+=,.@- (up to 128)."
                ),
            )

    @classmethod
    def validate_root_credentials(cls, root_creds: dict) -> bool:
        try:
            _client(root_creds, "sts").get_caller_identity()
            return True
        except Exception:
            return False

    @classmethod
    def list_resources(
        cls,
        root_creds: dict,
        resource_type: str,
        config: dict | None = None,
    ) -> list[ResourceOption]:
        if resource_type != "iam_user":
            return super().list_resources(root_creds, resource_type, config)
        users: list[ResourceOption] = []
        try:
            pages = (
                _client(root_creds, "iam")
                .get_paginator("list_users")
                .paginate(PaginationConfig={"PageSize": _USERS_PAGE_SIZE})
            )
            # Hard ceiling on pagination so a misbehaving server can't loop forever.
            for page in itertools.islice(pages, _MAX_USER_PAGES):
                for user in page.get("Users") or []:
                    user_name = user.get("UserName")
                    if user_name:
                        users.append(
                            ResourceOption(
                                id=user_name,
                                name=user_name,
                                description=user.get("Path") or "",
                            )
                        )
        except (ClientError, BotoCoreError) as e:
            raise _translate_error(e, "list") from e
        return users

    @classmethod
    def mint(
        cls,
        root_creds: dict,
        config: dict,
        *,
        caller_id: str,
    ) -> MintResult:
        user_name = config["user_name"]
        try:
            response = _client(root_creds, "iam").create_access_key(UserName=user_name)
        except (ClientError, BotoCoreError) as e:
            raise _translate_error(e, "mint", user_name) from e

        access_key = response.get("AccessKey") if isinstance(response, dict) else None
        if (
            not isinstance(access_key, dict)
            or not access_key.get("AccessKeyId")
            or not access_key.get("SecretAccessKey")
        ):
            raise ProviderConfigError(
                "Unexpected AWS CreateAccessKey response",
                user_message=(
                    "AWS returned an unexpected response shape when creating the "
                    "access key."
                ),
            )

        access_key_id = access_key["AccessKeyId"]
        key_user_name = access_key.get("UserName") or user_name
        create_date = access_key.get("CreateDate")
        return MintResult(
            provider_credential_id=_encode_provider_id(key_user_name, access_key_id),
            values={
                "access_key_id": access_key_id,
                "secret_access_key": access_key["SecretAccessKey"],
            },
            metadata={
                "user_name": key_user_name,
                "status": access_key.get("Status"),
                "create_date": (
                    create_date.isoformat()
                    if hasattr(create_date, "isoformat")
                    else create_date
                ),
            },
        )

    @classmethod
    def revoke(cls, root_creds: dict, provider_credential_id: str) -> dict | None:
        user_name, access_key_id = _decode_provider_id(provider_credential_id)
        try:
            response = _client(root_creds, "iam").delete_access_key(
                UserName=user_name, AccessKeyId=access_key_id
            )
        except (ClientError, BotoCoreError) as e:
            raise _translate_error(e, "revoke", user_name) from e
        return {
            "user_name": user_name,
            "call": _call_summary("DeleteAccessKey", response),
        }
