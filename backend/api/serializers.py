from rest_framework import serializers
from .models import (
    CustomUser,
    Environment,
    EnvironmentKey,
    Lockbox,
    Organisation,
    Secret,
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
        fields = ["id", "name", "identity_key", "created_at"]

        def create(self, validated_data):
            return Organisation(**validated_data)


class PersonalSecretSerializer(serializers.ModelSerializer):
    class Meta:
        model = PersonalSecret
        fields = "__all__"


class SecretSerializer(serializers.ModelSerializer):
    tags = serializers.SerializerMethodField()
    override = serializers.SerializerMethodField()

    class Meta:
        model = Secret
        fields = "__all__"

    def get_tags(self, obj):
        return [tag.name for tag in obj.tags.all()]

    def get_override(self, obj):
        # Assuming 'request' is passed to the context of the serializer.
        org_member = self.context.get("org_member")
        if org_member:

            try:
                personal_secret = PersonalSecret.objects.get(
                    secret=obj, user=org_member
                )
                return PersonalSecretSerializer(personal_secret).data
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

    class Meta:
        model = UserToken
        fields = ["wrapped_key_share", "user_id", "offline_enabled", "apps"]

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
                    "encryption": "E2E",  # Adding encryption to each app
                }

                if index == -1:
                    app_data["environment_keys"] = [serializer.data]
                    apps.append(app_data)
                else:
                    apps[index]["environment_keys"].append(serializer.data)

            representation["apps"] = apps

        return representation


class ServiceTokenSerializer(serializers.ModelSerializer):
    apps = EnvironmentKeySerializer(many=True, read_only=True)

    class Meta:
        model = ServiceToken
        fields = ["wrapped_key_share", "apps"]

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
