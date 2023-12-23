from botocore.exceptions import ClientError
from .auth import get_client
import boto3
import json
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
                secrets_list.append({"Name": secret["Name"], "ARN": secret["ARN"]})
        return secrets_list
    except ClientError:
        raise Exception("Failed to list AWS Secrets")


def sync_aws_secrets(
    secrets, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, region, secret_name, arn
):
    """
    Sync secrets from secrets.json to AWS Secrets Manager.
    If an ARN is provided, updates a single secret with key-value pairs from secrets.json.
    If an ARN is not provided but a secret name is, creates or updates a secret with that name.
    """
    try:
        secrets_client = boto3.client(
            "secretsmanager",
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=region,
        )

        if arn:
            secrets_client.update_secret(SecretId=arn, SecretString=json.dumps(secrets))
            return True, {"message": f"Secret '{arn}' updated with provided secrets."}

        elif secret_name:
            # Check if the secret exists
            try:
                secrets_client.get_secret_value(SecretId=secret_name)
                update_operation = True
            except secrets_client.exceptions.ResourceNotFoundException:
                update_operation = False

            if update_operation:
                secrets_client.update_secret(
                    SecretId=secret_name, SecretString=json.dumps(secrets)
                )
                return True, {"message": f"Existing secret '{secret_name}' updated."}
            else:
                secrets_client.create_secret(
                    Name=secret_name, SecretString=json.dumps(secrets)
                )
                return True, {"message": f"New secret '{secret_name}' created."}

        else:
            return False, {"message": "Please provide either a secret ARN or a name."}

    except ClientError as e:
        return False, {"message": str(e)}
    except json.JSONDecodeError:
        return False, {"message": "Error decoding JSON"}
    except Exception as e:
        return False, {"message": f"An unexpected error occurred: {str(e)}"}
