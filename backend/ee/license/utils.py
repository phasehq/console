import base64
from datetime import datetime
from django.apps import apps
from datetime import datetime
from dataclasses import dataclass
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class PlanTier(Enum):
    PRO_PLAN = "PRO"
    ENTERPRISE_PLAN = "ENTERPRISE"


@dataclass
class PhaseLicense:
    id: str
    customer_name: str
    organisation_name: str
    plan: PlanTier
    seats: int
    tokens: int
    issued_at: datetime
    expires_at: datetime
    metadata: dict
    environment: str
    license_type: str
    signature_date: str
    issuing_authority: str

    def __str__(self):
        return f"License ID: {self.id}, Customer Name: {self.customer_name}, Tier: {self.plan}, Expiry: {self.expires_at}"


def parse_license_format(license_str):
    """
    Parses the custom license format and extracts the public key and the encoded signed message.
    """
    try:
        # Split the license string into its components
        parts = license_str.split(":")
        if len(parts) != 4 or parts[0] != "phase_license" or parts[1] != "v1":
            raise ValueError("License format is invalid.")

        public_key_hex = parts[2]
        encoded_signed_message = parts[3]
        # Correctly handle base64 padding
        padding = "=" * ((4 - len(encoded_signed_message) % 4) % 4)
        encoded_signed_message += padding
        # Decode the base64-encoded signed message
        signed_message = base64.urlsafe_b64decode(encoded_signed_message)
        return public_key_hex, signed_message
    except Exception as e:
        raise ValueError(f"Error parsing license: {e}")


def update_existing_org_license(phase_license):
    Organisation = apps.get_model("api", "Organisation")
    try:
        existing_org = Organisation.objects.get(name=phase_license.organisation_name)

        if phase_license.plan == PlanTier.PRO_PLAN.value:
            existing_org.plan = Organisation.PRO_PLAN
        elif phase_license.plan == PlanTier.ENTERPRISE_PLAN.value:
            existing_org.plan = Organisation.ENTERPRISE_PLAN
        existing_org.save()
        logger.info(f"Updated license for {existing_org.name}")
    except Organisation.DoesNotExist:
        logger.info("Existing organisation not found for this license")
        pass


def activate_license(phase_license):
    """Activate a license for the given organisation"""
    Organisation = apps.get_model("api", "Organisation")
    ActivatedPhaseLicense = apps.get_model("api", "ActivatedPhaseLicense")

    if ActivatedPhaseLicense.objects.filter(id=phase_license.id).exists():
        logger.info("License is already activated")
        return True

    try:
        org = Organisation.objects.get(name=phase_license.organisation_name)

        fields = {
            "id": phase_license.id,
            "customer_name": phase_license.customer_name,
            "organisation": org,
            "plan": None,  # Initialize plan field
            "seats": phase_license.seats,
            "tokens": phase_license.tokens,
            "metadata": phase_license.metadata,
            "environment": phase_license.environment,
            "license_type": phase_license.license_type,
            "signature_date": datetime.strptime(
                phase_license.signature_date, "%Y-%m-%d"
            ),
            "issuing_authority": phase_license.issuing_authority,
            "issued_at": datetime.now(),
            "expires_at": phase_license.expires_at,
            "activated_at": datetime.now(),
        }

        if phase_license.plan == PlanTier.PRO_PLAN.value:
            fields["plan"] = Organisation.PRO_PLAN
            org.plan = Organisation.PRO_PLAN
        elif phase_license.plan == PlanTier.ENTERPRISE_PLAN.value:
            fields["plan"] = Organisation.ENTERPRISE_PLAN
            org.plan = Organisation.ENTERPRISE_PLAN

        new_license = ActivatedPhaseLicense.objects.create(**fields)
        org.save()

        logger.info(f"Activated license: {new_license}")
    except Organisation.DoesNotExist:
        logger.info("Existing organisation not found for this license")
        pass
