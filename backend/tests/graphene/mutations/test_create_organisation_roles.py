from unittest.mock import MagicMock, call, patch


@patch("backend.graphene.mutations.organisation.send_welcome_email")
@patch("backend.graphene.mutations.organisation.OrganisationMember")
@patch("backend.graphene.mutations.organisation.Role")
@patch("backend.graphene.mutations.organisation.CustomUser")
@patch("backend.graphene.mutations.organisation.Organisation")
def test_new_organisation_creates_keyed_managed_roles(
    mock_organisation,
    mock_user,
    mock_role,
    mock_member,
    _mock_welcome,
    settings,
):
    from backend.graphene.mutations.organisation import CreateOrganisationMutation

    settings.APP_HOST = "self-hosted"
    settings.PHASE_LICENSE = ""
    mock_organisation.objects.filter.return_value.exists.return_value = False
    org = MagicMock()
    mock_organisation.objects.create.return_value = org
    user = MagicMock()
    mock_user.objects.get.return_value = user
    owner_role = MagicMock()
    mock_role.objects.get.return_value = owner_role
    mock_member.objects.create.return_value = MagicMock()
    info = MagicMock()
    info.context.user.userId = "user-1"

    CreateOrganisationMutation.mutate(
        None,
        info,
        id="org-1",
        name="Acme",
        identity_key="identity",
        wrapped_keyring="keyring",
        wrapped_recovery="recovery",
    )

    assert mock_role.objects.create.call_args_list == [
        call(name="Owner", organisation=org, is_default=True, managed_key="owner"),
        call(name="Admin", organisation=org, is_default=True, managed_key="admin"),
        call(name="Manager", organisation=org, is_default=True, managed_key="manager"),
        call(
            name="Developer",
            organisation=org,
            is_default=True,
            managed_key="developer",
        ),
        call(name="Service", organisation=org, is_default=True, managed_key="service"),
    ]
    mock_role.objects.get.assert_called_once_with(
        organisation=org,
        is_default=True,
        managed_key="owner",
    )
