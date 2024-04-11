from api.utils.crypto import decrypt_asymmetric

from api.utils.secrets import decrypt_secret_value, get_environment_keys
from rest_framework import serializers
from .models import (
    CustomUser,
    Environment,
    EnvironmentKey,
    Lockbox,
    Organisation,
    Secret,
    ServerEnvironmentKey,
    ServiceToken,
    UserToken,
    PersonalSecret,
)


def find_index_by_id(dictionaries, target_id):
    for index, dictionary in enumerate(dictionaries):
        if dictionary.get("id") == target_id:
            return index
    return -1


class CustomUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomUser
        fields = [
            "userId",
            "username",
            "email",
            "password",
        ]

    def create(self, validated_data):
        user = CustomUser.objects.create_user(
            validated_data["username"],
            validated_data["email"],
            validated_data["password"],
        )

        return user


class OrganisationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organisation
        fields = ["id", "name"]

        def create(self, validated_data):
            return Organisation(**validated_data)


class PersonalSecretSerializer(serializers.ModelSerializer):
    value = serializers.SerializerMethodField()

    class Meta:
        model = PersonalSecret
        exclude = ["secret", "user", "deleted_at"]

    def get_value(self, obj):
        if self.context.get("sse"):
            secret_obj = obj.secret
            secret_obj.value = obj.value
            value = decrypt_secret_value(secret_obj)
            return value
        return obj.value


class SecretSerializer(serializers.ModelSerializer):
    key = serializers.SerializerMethodField()
    value = serializers.SerializerMethodField()
    comment = serializers.SerializerMethodField()
    tags = serializers.SerializerMethodField()
    override = serializers.SerializerMethodField()

    class Meta:
        model = Secret
        exclude = ["deleted_at"]

    def get_key(self, obj):
        if self.context.get("sse"):
            env_pubkey, env_privkey = get_environment_keys(obj.environment.id)
            key = decrypt_asymmetric(obj.key, env_privkey, env_pubkey)
            return key
        return obj.key

    def get_value(self, obj):
        if self.context.get("sse"):
            value = decrypt_secret_value(obj)
            return value
        return obj.value

    def get_comment(self, obj):
        if self.context.get("sse"):
            env_pubkey, env_privkey = get_environment_keys(obj.environment.id)
            if obj.comment:
                comment = decrypt_asymmetric(obj.comment, env_privkey, env_pubkey)
                return comment
            return ""
        return obj.comment

    def get_tags(self, obj):
        return [tag.name for tag in obj.tags.all()]

    def get_override(self, obj):
        org_member = self.context.get("org_member")
        if org_member:
            try:
                personal_secret = PersonalSecret.objects.get(
                    secret=obj, user=org_member
                )
                return PersonalSecretSerializer(
                    personal_secret, context={"sse": True}
                ).data
            except PersonalSecret.DoesNotExist:
                return None
        return None


class EnvironmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Environment
        fields = ["id", "name", "env_type"]


class EnvironmentKeySerializer(serializers.ModelSerializer):
    environment = EnvironmentSerializer()

    class Meta:
        model = EnvironmentKey
        fields = "__all__"


class UserTokenSerializer(serializers.ModelSerializer):
    apps = EnvironmentKeySerializer(many=True, read_only=True)

    # New field 'userId'
    user_id = serializers.UUIDField(source="user.id", read_only=True)

    # New field 'offline_enabled' with default value False
    offline_enabled = serializers.BooleanField(default=False, read_only=True)

    organisation = OrganisationSerializer(source="user.organisation", read_only=True)

    class Meta:
        model = UserToken
        fields = [
            "wrapped_key_share",
            "user_id",
            "offline_enabled",
            "apps",
            "organisation",
        ]

    def to_representation(self, instance):
        representation = super().to_representation(instance)

        # Filter environment_keys to include only those associated with the same user
        user = instance.user

        if user is not None:
            environment_keys = EnvironmentKey.objects.filter(
                user=user, environment__app__deleted_at=None
            )
            apps = []
            for key in environment_keys:

                serializer = EnvironmentKeySerializer(key)
                index = find_index_by_id(apps, key.environment.app.id)

                app_data = {
                    "id": key.environment.app.id,
                    "name": key.environment.app.name,
                    "encryption": "E2E",
                }

                if ServerEnvironmentKey.objects.filter(
                    environment=key.environment
                ).exists():
                    app_data["encryption"] = "SSE"

                if index == -1:
                    app_data["environment_keys"] = [serializer.data]
                    apps.append(app_data)
                else:
                    apps[index]["environment_keys"].append(serializer.data)

            representation["apps"] = apps

        return representation


class ServiceTokenSerializer(serializers.ModelSerializer):
    apps = EnvironmentKeySerializer(many=True, read_only=True)

    organisation = OrganisationSerializer(source="app.organisation", read_only=True)

    class Meta:
        model = ServiceToken
        fields = ["wrapped_key_share", "apps", "organisation"]

    def to_representation(self, instance):
        representation = super().to_representation(instance)

        environment_keys = instance.keys.all()
        apps = []
        for key in environment_keys:
            serializer = EnvironmentKeySerializer(key)
            index = find_index_by_id(apps, key.environment.app.id)

            app_data = {
                "id": key.environment.app.id,
                "name": key.environment.app.name,
                "encryption": "E2E",  # Adding encryption to each app
            }

            if index == -1:
                app_data["environment_keys"] = [serializer.data]
                apps.append(app_data)
            else:
                apps[index]["environment_keys"].append(serializer.data)

        representation["apps"] = apps

        return representation


class LockboxSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lockbox
        fields = "__all__"
