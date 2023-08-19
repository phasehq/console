from rest_framework import serializers
from .models import CustomUser, Environment, EnvironmentKey, Organisation, Secret, UserToken


def find_index_by_id(dictionaries, target_id):
    for index, dictionary in enumerate(dictionaries):
        if dictionary.get('id') == target_id:
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
    apps = EnvironmentKeySerializer(many=True, read_only=True)
    
    # New field 'userId'
    userId = serializers.UUIDField(source='user.id', read_only=True)
    
    # New field 'offline_enabled' with default value False
    offline_enabled = serializers.BooleanField(default=False, read_only=True)
    
    class Meta:
        model = UserToken
        fields = ['wrapped_key_share', 'userId', 'offline_enabled', 'apps']

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        
        # Filter environment_keys to include only those associated with the same user
        user = instance.user

        if user is not None:
            environment_keys = EnvironmentKey.objects.filter(user=user)
            apps = []
            for key in environment_keys:

                serializer = EnvironmentKeySerializer(key)
                index = find_index_by_id(apps, key.environment.app.id)

                if index == -1:
                    apps.append({
                        'id': key.environment.app.id,
                        'name': key.environment.app.name,
                        'environment_keys': [serializer.data]
                    })
                else:
                    apps[index]['environment_keys'].append(serializer.data)
                    
            representation['apps'] = apps

        return representation