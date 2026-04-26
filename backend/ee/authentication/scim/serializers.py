from ee.authentication.scim.constants import (
    SCIM_GROUP_SCHEMA,
    SCIM_LIST_RESPONSE_SCHEMA,
    SCIM_USER_SCHEMA,
)


def serialize_scim_user(scim_user, base_url=""):
    """Serialize a SCIMUser model instance to a SCIM v2 User resource."""
    resource = {
        "schemas": [SCIM_USER_SCHEMA],
        "id": str(scim_user.id),
        "externalId": scim_user.external_id,
        "userName": scim_user.email,
        "displayName": scim_user.display_name,
        "active": scim_user.active,
        "emails": [
            {
                "value": scim_user.email,
                "type": "work",
                "primary": True,
            }
        ],
        "meta": {
            "resourceType": "User",
            "created": (
                scim_user.created_at.isoformat() if scim_user.created_at else None
            ),
            "lastModified": (
                scim_user.updated_at.isoformat() if scim_user.updated_at else None
            ),
            "location": f"{base_url}/scim/v2/Users/{scim_user.id}",
        },
    }

    # Include name if available from scim_data
    name_data = scim_user.scim_data.get("name")
    if name_data:
        resource["name"] = name_data

    return resource


def serialize_scim_group(scim_group, base_url=""):
    """Serialize a SCIMGroup model instance to a SCIM v2 Group resource."""
    members = []
    if scim_group.team:
        from api.models import SCIMUser

        for membership in scim_group.team.memberships.select_related(
            "org_member"
        ).filter(org_member__isnull=False):
            scim_user = SCIMUser.objects.filter(
                org_member=membership.org_member,
                organisation=scim_group.organisation,
            ).first()
            if scim_user:
                members.append(
                    {
                        "value": str(scim_user.id),
                        "display": scim_user.display_name or scim_user.email,
                    }
                )

    return {
        "schemas": [SCIM_GROUP_SCHEMA],
        "id": str(scim_group.id),
        "externalId": scim_group.external_id,
        "displayName": scim_group.display_name,
        "members": members,
        "meta": {
            "resourceType": "Group",
            "created": (
                scim_group.created_at.isoformat() if scim_group.created_at else None
            ),
            "lastModified": (
                scim_group.updated_at.isoformat() if scim_group.updated_at else None
            ),
            "location": f"{base_url}/scim/v2/Groups/{scim_group.id}",
        },
    }


def serialize_list_response(resources, total_results, start_index=1, items_per_page=100):
    """Serialize a SCIM v2 ListResponse."""
    return {
        "schemas": [SCIM_LIST_RESPONSE_SCHEMA],
        "totalResults": total_results,
        "startIndex": start_index,
        "itemsPerPage": items_per_page,
        "Resources": resources,
    }
