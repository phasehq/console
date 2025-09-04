from api.models import DynamicSecretLease
from api.utils.crypto import decrypt_asymmetric
from api.utils.secrets import get_environment_keys
from rest_framework import serializers


class DynamicSecretLeaseSerializer(serializers.ModelSerializer):
    credentials = serializers.SerializerMethodField()

    class Meta:
        model = DynamicSecretLease
        fields = [
            "id",
            "name",
            "description",
            "secret",
            "ttl",
            "status",
            "credentials",
            "created_at",
            "renewed_at",
            "expires_at",
            "revoked_at",
            "deleted_at",
        ]

    def get_credentials(self, obj):
        sse = self.context.get("sse")
        credentials = obj.credentials or {}
        key_map = obj.secret.key_map if obj.secret else []
        result = []
        if sse:
            env_pubkey, env_privkey = get_environment_keys(obj.secret.environment.id)
            for entry in key_map:
                key_id = entry.get("id")
                key_name_encrypted = entry.get("key_name")
                cred_encrypted = credentials.get(key_id)
                if key_name_encrypted and cred_encrypted:
                    key_name = decrypt_asymmetric(
                        key_name_encrypted, env_privkey, env_pubkey
                    )
                    value = decrypt_asymmetric(cred_encrypted, env_privkey, env_pubkey)
                    result.append({"key_name": key_name, "value": value})
        else:
            for entry in key_map:
                key_id = entry.get("id")
                key_name = entry.get("key_name")
                value = credentials.get(key_id)
                if key_name and value:
                    result.append({"key": key_name, "value": value})
        return result
