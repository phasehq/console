"""
Server-side key wrapping utilities for team-based access.

When a team is granted access to an SSE-enabled app, the server wraps
EnvironmentKeys for each team member using ServerEnvironmentKey data.
"""

from django.apps import apps
from django.utils import timezone
from api.utils.crypto import (
    get_server_keypair,
    decrypt_asymmetric,
    encrypt_asymmetric,
)


def server_wrap_env_key_for_member(environment, identity_key):
    """
    Unwraps a ServerEnvironmentKey and re-wraps the seed/salt for a user's
    identity_key. Returns (wrapped_seed, wrapped_salt).

    Requires SSE to be enabled on the app (ServerEnvironmentKey must exist).
    """
    ServerEnvironmentKey = apps.get_model("api", "ServerEnvironmentKey")

    server_env_key = ServerEnvironmentKey.objects.get(
        environment=environment, deleted_at__isnull=True
    )
    server_pk, server_sk = get_server_keypair()

    seed = decrypt_asymmetric(
        server_env_key.wrapped_seed, server_sk.hex(), server_pk.hex()
    )
    salt = decrypt_asymmetric(
        server_env_key.wrapped_salt, server_sk.hex(), server_pk.hex()
    )

    wrapped_seed = encrypt_asymmetric(seed, identity_key)
    wrapped_salt = encrypt_asymmetric(salt, identity_key)
    return wrapped_seed, wrapped_salt


def provision_team_environment_keys(team, app, members=None):
    """
    Wraps EnvironmentKeys for team members for a given app's team environments.

    Called when:
    - A team is granted access to an app (AddTeamApps)
    - A member is added to a team that already has app access (AddTeamMembers)
    - A SCIM-provisioned user completes their key ceremony (first login)

    Skips members without an identity_key (deferred until first login).
    """
    Environment = apps.get_model("api", "Environment")
    EnvironmentKey = apps.get_model("api", "EnvironmentKey")
    EnvironmentKeyGrant = apps.get_model("api", "EnvironmentKeyGrant")
    TeamAppEnvironment = apps.get_model("api", "TeamAppEnvironment")

    if not app.sse_enabled:
        raise ValueError("Team-based access requires SSE-enabled apps.")

    env_ids = TeamAppEnvironment.objects.filter(
        team=team, app=app
    ).values_list("environment_id", flat=True)
    environments = Environment.objects.filter(id__in=env_ids, deleted_at__isnull=True)

    if members is None:
        members = team.memberships.all()

    for env in environments:
        for membership in members:
            account = membership.org_member or membership.service_account
            if not account or not account.identity_key:
                continue  # Deferred until first login

            is_user = membership.org_member is not None
            key_filter = {
                "environment": env,
                "user_id": membership.org_member_id if is_user else None,
                "service_account_id": (
                    membership.service_account_id if not is_user else None
                ),
            }

            env_key = EnvironmentKey.objects.filter(
                deleted_at__isnull=True, **key_filter
            ).first()

            if not env_key:
                wrapped_seed, wrapped_salt = server_wrap_env_key_for_member(
                    env, account.identity_key
                )
                env_key = EnvironmentKey.objects.create(
                    **key_filter,
                    identity_key=account.identity_key,
                    wrapped_seed=wrapped_seed,
                    wrapped_salt=wrapped_salt,
                )

            EnvironmentKeyGrant.objects.get_or_create(
                environment_key=env_key,
                grant_type="team",
                team=team,
            )


def revoke_team_environment_keys(team, app=None, member=None, environments=None):
    """
    Removes team-specific EnvironmentKeyGrants.
    Soft-deletes EnvironmentKeys that have no remaining grants.

    Called when:
    - A team is removed from an app (RemoveTeamApp)
    - A member is removed from a team (RemoveTeamMember)
    - A team is deleted (DeleteTeam)
    - Specific environments are removed from a team-app link (UpdateTeamAppEnvironments)
    """
    EnvironmentKey = apps.get_model("api", "EnvironmentKey")
    EnvironmentKeyGrant = apps.get_model("api", "EnvironmentKeyGrant")

    grant_filter = {"grant_type": "team", "team": team}
    if app:
        grant_filter["environment_key__environment__app"] = app
    if environments is not None:
        grant_filter["environment_key__environment__in"] = environments
    if member:
        if hasattr(member, "user"):
            grant_filter["environment_key__user_id"] = member.id
        else:
            grant_filter["environment_key__service_account_id"] = member.id

    grants = EnvironmentKeyGrant.objects.filter(**grant_filter)
    env_key_ids = list(grants.values_list("environment_key_id", flat=True))
    grants.delete()

    # Soft-delete orphaned EnvironmentKeys (no remaining grants)
    for ek_id in env_key_ids:
        if not EnvironmentKeyGrant.objects.filter(environment_key_id=ek_id).exists():
            EnvironmentKey.objects.filter(id=ek_id).update(
                deleted_at=timezone.now()
            )


def provision_pending_team_keys(org_member):
    """
    Called after a user completes their key ceremony (first login).
    Wraps EnvironmentKeys for all team-accessible SSE environments
    that the user didn't yet have keys for.
    """
    App = apps.get_model("api", "App")
    TeamMembership = apps.get_model("api", "TeamMembership")
    TeamAppEnvironment = apps.get_model("api", "TeamAppEnvironment")

    team_memberships = TeamMembership.objects.filter(
        org_member=org_member,
        team__deleted_at__isnull=True,
    ).select_related("team")

    for tm in team_memberships:
        team_app_ids = (
            TeamAppEnvironment.objects.filter(team=tm.team)
            .values_list("app_id", flat=True)
            .distinct()
        )

        for app_id in team_app_ids:
            app = App.objects.get(id=app_id)
            if app.sse_enabled:
                provision_team_environment_keys(tm.team, app, members=[tm])
