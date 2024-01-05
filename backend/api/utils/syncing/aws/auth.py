from api.utils.crypto import decrypt_asymmetric, get_server_keypair
import boto3


def get_client(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, region):
    session = boto3.Session(
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
        region_name=region,
    )
    return session.client("secretsmanager")


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
