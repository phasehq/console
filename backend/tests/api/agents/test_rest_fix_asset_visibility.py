"""A name a member may not see is withheld wherever older text still holds it."""

from api.utils.asset_visibility import asset_visibility

from .app_secrets import lab, member  # noqa: F401

def test_a_connection_name_withholds_an_environment_it_no_longer_covers(lab):
    name = "orders-service secrets (Development, Production)"
    dev_only = member(lab, "devonly", app=lab.app, environments=[lab.dev])

    # The Connection covers Development alone now; its name was made earlier.
    view = asset_visibility(dev_only).app_view(lab.app, [lab.dev])

    assert view.connection_name(name) == "orders-service secrets"
    assert view.environments == (lab.dev,)
    assert view.hidden_environment_count == 0
    assert view.connection_name("orders-service secrets (Development)") == (
        "orders-service secrets (Development)"
    )
    # A member who can access Production is shown the name as it is.
    for viewer in (lab.approver, member(lab, "owner", managed_key="owner")):
        assert asset_visibility(viewer).app_view(lab.app, [lab.dev]).connection_name(
            name
        ) == name
