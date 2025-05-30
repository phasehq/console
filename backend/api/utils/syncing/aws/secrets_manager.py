from botocore.exceptions import ClientError
from .auth import get_client, get_aws_sts_session
import json
import os
import graphene
from graphene import ObjectType


class AWSSecretType(ObjectType):
    name = graphene.String()
    arn = graphene.String()


def get_secrets_client_from_session(session):
    """Get secrets manager client from a boto3 session."""
    return session.client("secretsmanager")


def list_aws_secrets(region, AWS_ACCESS_KEY_ID=None, AWS_SECRET_ACCESS_KEY=None, role_arn=None, external_id=None):
    """
    List available secrets in AWS Secrets Manager using either access keys or assume role.
    This function uses a paginator to handle the possible scenario of having more secrets than what can be returned in a single API call.
    It lists all secrets along with their names and ARNs, which are crucial identifiers in AWS.
    """
    try:
        # Initialize the AWS Secrets Manager client based on authentication method
        if role_arn:
            # Use assume role authentication
            session = get_aws_sts_session(role_arn, region, external_id)
            secrets_client = get_secrets_client_from_session(session)
        elif AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
            # Use access key authentication
            secrets_client = get_client(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, region)
        else:
            raise Exception("Please provide either assume role parameters or access keys.")

        secrets_list = []
        paginator = secrets_client.get_paginator("list_secrets")
        for page in paginator.paginate():
            for secret in page["SecretList"]:
                secrets_list.append({"name": secret["Name"], "arn": secret["ARN"]})
        return secrets_list
    except ClientError as e:
        raise Exception(f"Failed to list AWS Secrets: {str(e)}")


def sync_aws_secrets(
    secrets,
    region,
    secret_name,
    arn,
    kms_id=None,
    AWS_ACCESS_KEY_ID=None,
    AWS_SECRET_ACCESS_KEY=None,
    role_arn=None,
    external_id=None,
):
    """
    Sync secrets to AWS Secrets Manager using either access keys or assume role.
    Args:
        secrets (list of tuple): List of key-value pairs to sync.
        region (str): AWS region.
        secret_name (str): The name of the secret.
        arn (str): The ARN of the secret.
        kms_id (str, optional): KMS key ID for encryption.
        AWS_ACCESS_KEY_ID (str, optional): AWS access key ID.
        AWS_SECRET_ACCESS_KEY (str, optional): AWS secret access key.
        role_arn (str, optional): The ARN of the role to assume.
        external_id (str, optional): External ID for cross-account access.
    Returns:
        tuple: (bool, dict) indicating success or failure and a message.
    """
    try:
        # Convert list of tuples into a dictionary
        secrets_dict = {k: v for k, v, _ in secrets}

        # Initialize the AWS Secrets Manager client based on authentication method
        if role_arn:
            # Use assume role authentication
            session = get_aws_sts_session(role_arn, region, external_id)
            secrets_client = get_secrets_client_from_session(session)
        elif AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
            # Use access key authentication
            secrets_client = get_client(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, region)
        else:
            return False, {"message": "Please provide either assume role parameters or access keys."}

        # Format the secrets into a JSON string
        secret_string = json.dumps(secrets_dict)

        # Updating or creating the secret
        if arn:
            update_args = {"SecretId": arn, "SecretString": secret_string}
            if kms_id:
                update_args["KmsKeyId"] = kms_id
            secrets_client.update_secret(**update_args)
            return True, {"message": f"Secret '{arn}' updated with provided secrets."}
        elif secret_name:
            try:
                secrets_client.get_secret_value(SecretId=secret_name)
                update_operation = True
            except secrets_client.exceptions.ResourceNotFoundException:
                update_operation = False

            if update_operation:
                update_args = {"SecretId": secret_name, "SecretString": secret_string}
                if kms_id:
                    update_args["KmsKeyId"] = kms_id
                secrets_client.update_secret(**update_args)
                return True, {"message": f"Existing secret '{secret_name}' updated."}
            else:
                create_args = {"Name": secret_name, "SecretString": secret_string}
                if kms_id:
                    create_args["KmsKeyId"] = kms_id
                secrets_client.create_secret(**create_args)
                return True, {"message": f"New secret '{secret_name}' created."}
        else:
            return False, {"message": "Please provide either a secret ARN or a name."}

    except ClientError as e:
        return False, {"message": str(e)}
    except json.JSONDecodeError:
        return False, {"message": "Error decoding JSON"}
    except Exception as e:
        return False, {"message": f"An unexpected error occurred: {str(e)}"}
