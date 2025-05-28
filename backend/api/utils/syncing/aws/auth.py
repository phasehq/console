from api.utils.crypto import decrypt_asymmetric, get_server_keypair
import boto3
from backend.utils.secrets import get_secret


def get_client(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, region):
    session = boto3.Session(
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
        region_name=region,
    )
    return session.client("secretsmanager")


def get_aws_sts_session(role_arn, region=None, external_id=None):
    """
    Create a boto3 session using STS assume role.
    
    Args:
        role_arn (str): The ARN of the role to assume
        region (str, optional): AWS region
        external_id (str, optional): External ID for cross-account access
    
    Returns:
        boto3.Session: Session with temporary credentials
    """
    # Check for supplied AWS integration credentials for non-AWS environments.
    aws_access_key_id = get_secret('AWS_INTEGRATION_ACCESS_KEY_ID')
    aws_secret_access_key = get_secret('AWS_INTEGRATION_SECRET_ACCESS_KEY')
    
    if aws_access_key_id and aws_secret_access_key:
        # Use provided integration credentials
        sts_client = boto3.client(
            'sts',
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
            region_name=region
        )
    else:
        # Use instance/machine roles for when running in AWS environments.
        sts_client = boto3.client('sts', region_name=region)
    
    # Build assume role parameters
    assume_role_params = {
        'RoleArn': role_arn,
        'RoleSessionName': 'phase-sync-session'
    }
    
    if external_id:
        assume_role_params['ExternalId'] = external_id
    
    # Assume the role
    response = sts_client.assume_role(**assume_role_params)
    
    credentials = response['Credentials']
    
    # Create session with temporary credentials
    session = boto3.Session(
        aws_access_key_id=credentials['AccessKeyId'],
        aws_secret_access_key=credentials['SecretAccessKey'],
        aws_session_token=credentials['SessionToken'],
        region_name=region
    )
    
    return session


def get_aws_secrets_manager_credentials(environment_sync):
    pk, sk = get_server_keypair()

    access_key_id = decrypt_asymmetric(
        environment_sync.authentication.credentials["access_key_id"], sk.hex(), pk.hex()
    )
    secret_access_key = decrypt_asymmetric(
        environment_sync.authentication.credentials["secret_access_key"],
        sk.hex(),
        pk.hex(),
    )
    region = decrypt_asymmetric(
        environment_sync.authentication.credentials["region"], sk.hex(), pk.hex()
    )

    return {
        "access_key_id": access_key_id,
        "secret_access_key": secret_access_key,
        "region": region,
    }


def get_aws_assume_role_credentials(environment_sync):
    """
    Get AWS integration configuration from environment sync.
    
    Args:
        environment_sync: EnvironmentSync object with assume role credentials
        
    Returns:
        dict: Decrypted credentials containing role_arn, region, and external_id
    """
    pk, sk = get_server_keypair()
    
    role_arn = decrypt_asymmetric(
        environment_sync.authentication.credentials["role_arn"], sk.hex(), pk.hex()
    )
    
    region = None
    if "region" in environment_sync.authentication.credentials:
        region = decrypt_asymmetric(
            environment_sync.authentication.credentials["region"], sk.hex(), pk.hex()
        )
    
    external_id = None
    if "external_id" in environment_sync.authentication.credentials:
        external_id = decrypt_asymmetric(
            environment_sync.authentication.credentials["external_id"], sk.hex(), pk.hex()
        )
    
    return {
        "role_arn": role_arn,
        "region": region,
        "external_id": external_id,
    }
