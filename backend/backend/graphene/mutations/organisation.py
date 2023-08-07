from backend.graphene.utils.permissions import user_is_admin
import graphene
from graphql import GraphQLError
from api.models import Organisation, CustomUser, OrganisationMember
from backend.graphene.types import OrganisationMemberType, OrganisationType

class CreateOrganisationMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        name = graphene.String(required=True)
        identity_key = graphene.String(required=True)

    organisation = graphene.Field(OrganisationType)

    @classmethod
    def mutate(cls, root, info, id, name, identity_key):
        if Organisation.objects.filter(name__iexact=name).exists():
            raise GraphQLError('This organisation name is not available.')
        if OrganisationMember.objects.filter(user_id=info.context.user.userId, role=OrganisationMember.OWNER).exists():
            raise GraphQLError(
                'Your current plan only supports one organisation.')

        owner = CustomUser.objects.get(userId=info.context.user.userId)
        org = Organisation.objects.create(
            id=id, name=name, identity_key=identity_key)
        OrganisationMember.objects.create(user=owner, organisation=org, role=OrganisationMember.OWNER, identity_key=identity_key)

        return CreateOrganisationMutation(organisation=org)
    
class CreateOrganisationMemberMutation(graphene.Mutation):
    class Arguments:
        org_id = graphene.ID(required=True)
        user_id = graphene.ID(required=True)
        role = graphene.String(required=True)
        identity_key = graphene.String(required=False)
        wrapped_keyring = graphene.String(required=False)

    org_member = graphene.Field(OrganisationMemberType)

    @classmethod
    def mutate(cls, root, info, org_id, user_id, role, identity_key, wrapped_keyring):
        if user_is_admin(info.context.user, org_id):
          org = Organisation.objects.get(id=org_id)

          org_member = OrganisationMember.objects.create(user_id=user_id, organisation=org, role=role, identity_key=identity_key, wrapped_keyring=wrapped_keyring)

          return CreateOrganisationMemberMutation(org_member=org_member)
        else: 
            raise GraphQLError("You don't have permission to perform this action")
        
class UpdateOrganisationMemberRole(graphene.Mutation):
    class Arguments:
        org_id = graphene.ID(required=True)
        user_id = graphene.ID(required=True)
        role = graphene.String(required=True)

    org_member = graphene.Field(OrganisationMemberType)

    @classmethod
    def mutate(cls, root, info, org_id, user_id, role):
        if user_is_admin(info.context.user, org_id):
            if role == OrganisationMember.OWNER:
                raise GraphQLError('You cannot set this user as the organisation owner')
            org_member = OrganisationMember.objects.get(organisation__id=org_id, user__id=user_id)
            org_member.role = role
            org_member.save()

            return UpdateOrganisationMemberRole(org_member=org_member)
        else: 
            raise GraphQLError("You don't have permission to perform this action")

        
        