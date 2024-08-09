import json
from nacl import encoding, signing, exceptions
from .utils import PhaseLicense, parse_license_format
from datetime import datetime
import json

VERIFIER_KEYS = [
    "8d48215b99bb91a96ad1d687563a371578eee7813f11192ce2c615802c257262",
    "091f058551d4e93a04111e645a6454af8339b5fc11325928c9bab2c76181473b",
    "43f8d3f155e4ded036c8b9329d2689fbed682d8a38ad6a95198654b5d46e3061",
    "b11e4451061fc98e48e9070f4d451a87846ed5a5ba245394a1a02944266c3dda",
    "c5ab568e411fc28612ad9e8fec50db4108f5e7ff3234f1698c5d53c2cac5aba8",
    "e29cd5f5e63ec37a84c9e4ac1d64b3cff399db63f7129461b9b8e5947a5207e1",
    "e49a7db985381b0dc5876131b91801aa025efaa70d2d2c5afc0d4157c62684ba",
    "9dbd98e324a6628e4608287d24a57fc0a50ab1d03a706d48bcf0fb59ac4fed2c",
    "a2785ebda2729f8c72b517b6436db95f728edeb9d0bd82e29c762d7fd5c82f7b",
    "e61a1d54c1990d98c453ebf7772585e8756920ba54e67bea1035c98ed71689e5",
]


def verify_signature(public_key_hex, license_str):
    try:
        _, signed_message = parse_license_format(license_str)

        verify_key = signing.VerifyKey(public_key_hex, encoder=encoding.HexEncoder)

        original_message = verify_key.verify(signed_message).decode("utf-8")
        data = json.loads(original_message)

        data["issued_at"] = datetime.strptime(data["issued_at"], "%Y-%m-%d").date()
        data["expires_at"] = datetime.strptime(data["expires_at"], "%Y-%m-%d").date()

        if datetime.now().date() > data["expires_at"]:
            print("License is expired.")
            valid = False
        else:
            print("License is valid.")
            valid = True

        license = PhaseLicense(**data)

        print(license)
        return valid, license
    except exceptions.BadSignatureError:
        pass

    except Exception as e:
        print(f"License validation error: {e}")

    return None


def check_license(license_str):
    if license_str is None:
        return None

    try:
        is_valid = False
        for key in VERIFIER_KEYS:
            license = verify_signature(key, license_str)
            if license is not None:
                is_valid, license_data = license
            if is_valid:
                break

        return license_data if is_valid else None
    except Exception as ex:
        print(f"Error validating license: {ex}")
        return None