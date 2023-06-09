from rest_framework.serializers import ModelSerializer
from .models import CustomUser, Organisation


class CustomUserSerializer(ModelSerializer):
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


class OrganisationSerializer(ModelSerializer):
    class Meta:
        model = Organisation
        fields = ['id', 'name', 'identity_key', 'created_at']

        def create(self, validated_data):
            return Organisation(**validated_data)
