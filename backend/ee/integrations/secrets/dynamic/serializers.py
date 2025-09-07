from api.models import DynamicSecretLease, DynamicSecret
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
        with_credentials = self.context.get("with_credentials", False)
        if not with_credentials:
            return []
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
                    result.append({"key": key_name, "value": value})
        else:
            for entry in key_map:
                key_id = entry.get("id")
                key_name = entry.get("key_name")
                value = credentials.get(key_id)
                if key_name and value:
                    result.append({"key": key_name, "value": value})
        return result


class DynamicSecretSerializer(serializers.ModelSerializer):
    lease = serializers.SerializerMethodField()
    key_map = serializers.SerializerMethodField()

    class Meta:
        model = DynamicSecret
        fields = [
            "id",
            "name",
            "description",
            "environment",
            "folder",
            "path",
            "default_ttl",
            "max_ttl",
            "provider",
            "key_map",
            "created_at",
            "updated_at",
            "deleted_at",
            "lease",
        ]

    def get_key_map(self, obj):
        sse = self.context.get("sse")
        entries = obj.key_map or []
        if not sse:
            return entries

        # Decrypt key_name for each entry using environment keys
        env_pubkey, env_privkey = get_environment_keys(obj.environment.id)
        decrypted = []
        for entry in entries:
            # keep other fields (e.g., id, key_digest) intact
            out = dict(entry) if isinstance(entry, dict) else {}
            key_name_encrypted = out.get("key_name")
            if key_name_encrypted:
                try:
                    out["key_name"] = decrypt_asymmetric(
                        key_name_encrypted, env_privkey, env_pubkey
                    )
                except Exception:
                    # If decryption fails, fall back to stored value
                    pass
            decrypted.append(out)
        return decrypted

    def get_lease(self, obj):
        lease_id = self.context.get("lease_id")
        if not lease_id:
            return None
        try:
            lease = obj.leases.get(id=lease_id)
        except (obj.leases.model.DoesNotExist, AttributeError):
            return None
        return DynamicSecretLeaseSerializer(lease, context=self.context).data
