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


def validate_aws_assume_role_auth():
    """
    Check if AWS integration credentials are available for assume role functionality.
    This validates that the Phase instance can perform STS assume role operations.
    
    Returns:
        dict: Validation result with status and message
    """
    try:
        # Check for supplied AWS integration credentials for non-AWS environments.
        aws_access_key_id = get_secret('AWS_INTEGRATION_ACCESS_KEY_ID')
        aws_secret_access_key = get_secret('AWS_INTEGRATION_SECRET_ACCESS_KEY')
        
        if aws_access_key_id and aws_secret_access_key:
            # Validate the integration credentials by making a simple STS call
            sts_client = boto3.client(
                'sts',
                aws_access_key_id=aws_access_key_id,
                aws_secret_access_key=aws_secret_access_key,
                region_name='us-east-1'  # STS is available in all regions
            )
            
            # Make a simple call to validate credentials
            response = sts_client.get_caller_identity()
            
            return {
                'valid': True,
                'message': 'AWS integration credentials are available and valid',
                'method': 'integration_credentials'
            }
        else:
            # Try using instance/machine roles
            try:
                sts_client = boto3.client('sts', region_name='us-east-1')
                response = sts_client.get_caller_identity()
                
                return {
                    'valid': True,
                    'message': 'AWS machine/instance roles are available',
                    'method': 'machine_roles'
                }
            except Exception as machine_role_error:
                return {
                    'valid': False,
                    'message': 'No AWS integration credentials found and machine roles are not available. Set AWS_INTEGRATION_ACCESS_KEY_ID and AWS_INTEGRATION_SECRET_ACCESS_KEY environment variables.',
                    'method': 'none',
                    'error': str(machine_role_error)
                }
    
    except Exception as e:
        return {
            'valid': False,
            'message': f'AWS credential validation failed: {str(e)}',
            'method': 'error',
            'error': str(e)
        }


def validate_aws_assume_role_credentials(role_arn, region=None, external_id=None):
    """
    Validate that we can successfully assume the specified role.
    
    Args:
        role_arn (str): The ARN of the role to assume
        region (str, optional): AWS region
        external_id (str, optional): External ID for cross-account access
    
    Returns:
        dict: Validation result with status and message
    """
    try:
        # First check if we have the base credentials to perform assume role
        auth_validation = validate_aws_assume_role_auth()
        if not auth_validation['valid']:
            return auth_validation
        
        # Check for supplied AWS integration credentials for non-AWS environments.
        aws_access_key_id = get_secret('AWS_INTEGRATION_ACCESS_KEY_ID')
        aws_secret_access_key = get_secret('AWS_INTEGRATION_SECRET_ACCESS_KEY')
        
        if aws_access_key_id and aws_secret_access_key:
            # Use provided integration credentials
            sts_client = boto3.client(
                'sts',
                aws_access_key_id=aws_access_key_id,
                aws_secret_access_key=aws_secret_access_key,
                region_name=region or 'us-east-1'
            )
        else:
            # Use instance/machine roles
            sts_client = boto3.client('sts', region_name=region or 'us-east-1')
        
        # Build assume role parameters
        assume_role_params = {
            'RoleArn': role_arn,
            'RoleSessionName': 'phase-validation-session'
        }
        
        if external_id:
            assume_role_params['ExternalId'] = external_id
        
        # Try to assume the role
        response = sts_client.assume_role(**assume_role_params)
        
        return {
            'valid': True,
            'message': 'Successfully validated assume role credentials',
            'assumed_role_arn': response['AssumedRoleUser']['Arn']
        }
        
    except Exception as e:
        error_message = str(e)
        
        # Provide more specific error messages based on common failure scenarios
        if 'AccessDenied' in error_message:
            return {
                'valid': False,
                'message': 'Access denied when assuming role. Check that the role trust policy allows the Phase credentials to assume this role.',
                'error': error_message
            }
        elif 'InvalidUserID.NotFound' in error_message:
            return {
                'valid': False,
                'message': 'The specified role ARN was not found. Check that the role ARN is correct.',
                'error': error_message
            }
        elif 'external id' in error_message.lower():
            return {
                'valid': False,
                'message': 'External ID validation failed. Check that the external ID matches the role trust policy.',
                'error': error_message
            }
        else:
            return {
                'valid': False,
                'message': f'Role assumption failed: {error_message}',
                'error': error_message
            }
