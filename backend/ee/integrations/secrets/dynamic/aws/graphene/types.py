import graphene

from graphene.types.generic import GenericScalar  # JSON-safe scalar


class AWSConfigType(graphene.ObjectType):
    username_template = graphene.String(required=True)
    iam_path = graphene.String(required=False, default_value="/")
    permission_boundary_arn = graphene.String(required=False)
    groups = graphene.String(required=False)
    policy_arns = graphene.String(required=False)
    policy_document = GenericScalar(required=False)  # JSON object


class AwsCredentialsType(graphene.ObjectType):
    access_key_id = graphene.String()
    secret_access_key = graphene.String()
    username = graphene.String()
