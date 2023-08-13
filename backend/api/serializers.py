from rest_framework import serializers
from .models import CustomUser, Environment, EnvironmentKey, Organisation, Secret, UserToken


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
            validated_data["password"]
        )

        return user


class OrganisationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organisation
        fields = ['id', 'name', 'identity_key', 'created_at']

        def create(self, validated_data):
            return Organisation(**validated_data)


class SecretSerializer(serializers.ModelSerializer):
    class Meta:
        model = Secret
        fields = '__all__'


class EnvironmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Environment
        fields = ['id', 'name', 'env_type']


class EnvironmentKeySerializer(serializers.ModelSerializer):
    environment = EnvironmentSerializer()

    class Meta:
        model = EnvironmentKey
        fields = '__all__'


class UserTokenSerializer(serializers.ModelSerializer):
    environment_keys = EnvironmentKeySerializer(many=True, read_only=True)

    class Meta:
        model = UserToken
        fields = ['wrapped_key_share', 'environment_keys']

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        # Filter environment_keys to include only those associated with the same user
        user = instance.user

        if user is not None:
            environment_keys = EnvironmentKey.objects.filter(user=user)
            for key in environment_keys:
                print('env key', key.id, key.environment.id)
            serializer = EnvironmentKeySerializer(environment_keys, many=True)

            representation['environment_keys'] = serializer.data
        return representation
