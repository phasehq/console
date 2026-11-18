"""Whether a member may see an asset's name.

Agent screens and Change Requests show apps and environments an Agent can
reach. A member who cannot reach one themselves still sees that something is
there, never its name. Every place that returns such a name to a member asks
here, so the rule lives in one place; a new kind of asset adds a view here.
"""

from dataclasses import dataclass, field

from api.utils.access.permissions import (
    role_has_global_access,
    user_can_access_app,
    user_can_access_environment,
)


WITHHELD_APP = "an app you can't access"
WITHHELD_CONNECTION = "App secrets"


@dataclass(frozen=True)
class AppView:
    """An app and some of its environments as one member may see them.

    ``app`` is None when the member cannot access the app (``app_restricted``)
    or it no longer exists. ``environments`` are the ones they can access;
    ``hidden_environment_count`` counts the rest.
    """

    app: object = None
    environments: tuple = ()
    app_restricted: bool = False
    hidden_environment_count: int = 0
    withheld_names: tuple = field(default=(), repr=False)

    @property
    def restricted(self):
        return self.app_restricted or self.hidden_environment_count > 0

    def mentions_withheld(self, text):
        lowered = (text or "").lower()
        return any(name.lower() in lowered for name in self.withheld_names if name)

    def scrub(self, text, fallback):
        """``text``, or ``fallback`` when it names something withheld."""

        return fallback if self.mentions_withheld(text) else text

    def app_label(self):
        return self.app.name if self.app is not None else WITHHELD_APP

    def environments_label(self):
        """``Development, Staging and 2 more`` for a reader."""

        names = ", ".join(environment.name for environment in self.environments)
        count = self.hidden_environment_count
        if not count:
            return names
        if names:
            return f"{names} and {count} more"
        return f"{count} environment{'' if count == 1 else 's'} you can't access"

    def connection_name(self, name):
        """A Connection's name, or a neutral one when it was made from names
        the member may not see."""

        if not self.mentions_withheld(name):
            return name
        if self.app is None:
            return WITHHELD_CONNECTION
        return f"{self.app.name} secrets"


class AssetVisibility:
    """What one member may see. A role with global access sees everything;
    anyone else sees an app they can access and, within it, the environments
    they hold a key for: the check giving an Agent access makes."""

    def __init__(self, member):
        self.member = member
        self.sees_all = member is not None and role_has_global_access(member.role)
        self._apps = {}
        self._environments = {}

    def can_see_app(self, app_id):
        if self.sees_all:
            return True
        if self.member is None or app_id is None:
            return False
        key = str(app_id)
        if key not in self._apps:
            self._apps[key] = user_can_access_app(self.member.user_id, app_id)
        return self._apps[key]

    def can_see_environment(self, app_id, environment_id):
        if self.sees_all:
            return True
        if not self.can_see_app(app_id):
            return False
        key = str(environment_id)
        if key not in self._environments:
            self._environments[key] = user_can_access_environment(
                self.member.user_id, environment_id
            )
        return self._environments[key]

    def app_view(self, app, environments):
        environments = list(environments)
        if app is None:
            return AppView(environments=tuple(environments))
        if not self.can_see_app(app.id):
            return AppView(
                app_restricted=True,
                hidden_environment_count=len(environments),
                withheld_names=(app.name, *(env.name for env in environments)),
            )
        visible = [
            env for env in environments if self.can_see_environment(app.id, env.id)
        ]
        hidden = [env.name for env in environments if env not in visible]
        return AppView(
            app=app,
            environments=tuple(visible),
            hidden_environment_count=len(hidden),
            withheld_names=tuple(hidden),
        )


def asset_visibility(member):
    """The member's ``AssetVisibility``, kept on the member for the request."""

    if member is None:
        return AssetVisibility(None)
    cached = getattr(member, "_asset_visibility", None)
    if cached is None:
        cached = member._asset_visibility = AssetVisibility(member)
    return cached
