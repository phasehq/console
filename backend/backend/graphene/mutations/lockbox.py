from api.models import Lockbox
from backend.graphene.types import LockboxType
import graphene
from datetime import datetime


class LockboxInput(graphene.InputObjectType):
    data = graphene.JSONString()
    allowed_views = graphene.Int()
    expiry = graphene.BigInt(required=False)


class CreateLockboxMutation(graphene.Mutation):
    class Arguments:
        input = LockboxInput(LockboxInput)

    lockbox = graphene.Field(LockboxType)

    @classmethod
    def mutate(cls, root, info, input):
        if input.expiry is not None:
            expires_at = datetime.fromtimestamp(input.expiry / 1000)
        else:
            expires_at = None

        lockbox = Lockbox.objects.create(
            data=input.data, expires_at=expires_at, allowed_view=input.allowed_views
        )

        return CreateLockboxMutation(lockbox=lockbox)
