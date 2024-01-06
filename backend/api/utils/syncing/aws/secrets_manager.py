from api.utils.crypto import decrypt_asymmetric, get_server_keypair
from botocore.exceptions import ClientError
from .auth import get_client
import boto3
import json
import os
import graphene
from graphene import ObjectType


class AWSSecretType(ObjectType):
    name = graphene.String()
    arn = graphene.String()


def list_aws_secrets(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, region):
    """
    List available secrets in AWS Secrets Manager.
    This function uses a paginator to handle the possible scenario of having more secrets than what can be returned in a single API call.
    It lists all secrets along with their names and ARNs, which are crucial identifiers in AWS.
    """
    try:
        secrets_client = get_client(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, region)

        secrets_list = []
        paginator = secrets_client.get_paginator("list_secrets")
        for page in paginator.paginate():
            for secret in page["SecretList"]:
                secrets_list.append({"name": secret["Name"], "arn": secret["ARN"]})
        return secrets_list
    except ClientError:
        raise Exception("Failed to list AWS Secrets")


def sync_aws_secrets(
    secrets,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    region,
    secret_name,
    arn,
    kms_id=None,
):
    """
    Sync secrets to AWS Secrets Manager.
    Args:
        secrets (list of tuple): List of key-value pairs to sync.
        AWS_ACCESS_KEY_ID (str): AWS access key ID.
        AWS_SECRET_ACCESS_KEY (str): AWS secret access key.
        region (str): AWS region.
        secret_name (str): The name of the secret.
        arn (str): The ARN of the secret.
        path (str, optional): Path to prepend to the secret name.
        kms_id (str, optional): KMS key ID for encryption.
    Returns:
        tuple: (bool, dict) indicating success or failure and a message.
    """
    try:
        # Convert list of tuples into a dictionary
        secrets_dict = dict(secrets)

        # Initialize the AWS Secrets Manager client
        secrets_client = boto3.client(
            "secretsmanager",
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=region,
        )

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
