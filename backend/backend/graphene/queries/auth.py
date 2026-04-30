from graphql import GraphQLError

from api.views.auth_password import _password_auth_enabled


def resolve_verify_password(root, info, auth_hash):
    """Verify that the supplied authHash matches the session user's stored password.

    Returns True on match, False on mismatch. Used by onboarding/invite flows
    to confirm the user still knows their account password before deriving
    the deviceKey from it (so the deviceKey can't drift from the auth password).
    """
    user = info.context.user
    if not user or not getattr(user, "is_authenticated", False):
        raise GraphQLError("Authentication required")

    if not _password_auth_enabled():
        raise GraphQLError("Password authentication is disabled on this instance.")

    if not auth_hash:
        return False

    return user.check_password(auth_hash)
