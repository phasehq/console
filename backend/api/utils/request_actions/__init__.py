"""Typed actions a request can carry.

The registry only dispatches. Each action's handler owns its target, so this module
knows nothing about what an action changes.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
import re


ACTION_VERSION = 1

# Text that looks like a credential. Requests are reviewed and logged in the
# clear, so none of their free text or requested settings may carry one.
CREDENTIAL_TEXT = re.compile(
    r"(?:pss_(?:agent|user|service):v[0-9]+:[A-Za-z0-9:]+|"
    r"psx_sess_[A-Za-z0-9_-]+|"
    r"AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|"
    r"github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|"
    r"xox[abprs]-[A-Za-z0-9-]{10,}|[rs]k_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"\b(?:rnd|sbp)_[A-Za-z0-9]{20,}|\blin_api_[A-Za-z0-9]{20,}|"
    r"\bsk-(?:proj-|admin-)?[A-Za-z0-9_-]{16,}|"
    r"-----BEGIN [A-Z ]+PRIVATE KEY-----|"
    r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})"
)


class ActionError(ValueError):
    """An action cannot be requested or applied as given."""

    def __init__(self, message, *, code="invalid_request_action", not_found=False):
        super().__init__(message)
        self.code = code
        self.not_found = not_found


@dataclass(frozen=True)
class AppliedAction:
    # The action as carried out. Stored on the request and written to the
    # audit log, so it never holds a secret.
    action: dict
    # What the requester should do next: "retry" or "restart_required".
    runtime_action: str
    # Identifiers of what the action touched, for the request's resolution.
    references: dict = field(default_factory=dict)


class ActionHandler:
    """One action type. Subclass it and ``register`` an instance."""

    type = ""
    # The request kind a request carrying this action is filed under.
    kind = ""
    # Whether the action ends in access that lasts for a time. Such a request
    # takes a top-level ``durationSeconds``, held in ``request.duration_seconds``,
    # and the member approving it may grant a different one through
    # ``inputs.durationSeconds`` or ``inputs.untilRevoked``.
    takes_duration = False

    def validate(self, request, action, member):
        """Return the action in canonical form, or raise ``ActionError``.

        Called again on the action a reviewer approves, since they may have edited it.
        """

        raise NotImplementedError

    def describe(self, request, action, member, view=None):
        """Return what a reviewer needs to judge the action.

        Always includes a ``title``. ``view`` limits the asset names shown to the reader; None
        gives the full description that a stored title or audit entry needs.
        """

        raise NotImplementedError

    def asset(self, request, action):
        """The app and environments the action is about, as ``(app,
        environments)``, or None when it names no such asset."""

        return None

    def apply(self, request, action, member, inputs):
        """Carry out an approved action and return an ``AppliedAction``.

        Runs in the approving transaction with the request row locked. The handler checks that
        ``member`` may change its target. ``inputs`` is never stored on the request.
        """

        raise NotImplementedError


_HANDLERS = {}


def register(handler):
    _HANDLERS[handler.type] = handler
    return handler


def action_handler(action):
    """The handler for an action, once its type and version are known."""

    if not isinstance(action, Mapping):
        raise ActionError("action must be an object.")
    action_type = action.get("type")
    handler = _HANDLERS.get(action_type) if isinstance(action_type, str) else None
    if handler is None:
        raise ActionError(
            "action.type is not supported.", code="unsupported_request_action"
        )
    version = action.get("version")
    if isinstance(version, bool) or version != ACTION_VERSION:
        raise ActionError(
            "action.version is not supported.", code="unsupported_request_action"
        )
    return handler


def contains_credential_text(value):
    """Whether any string inside a JSON-like value looks like a credential."""

    if isinstance(value, str):
        return bool(CREDENTIAL_TEXT.search(value))
    if isinstance(value, Mapping):
        return any(
            contains_credential_text(key) or contains_credential_text(item)
            for key, item in value.items()
        )
    if isinstance(value, (list, tuple)):
        return any(contains_credential_text(item) for item in value)
    return False


def fit_title(text, maximum=120):
    return text if len(text) <= maximum else f"{text[: maximum - 1].rstrip()}…"


# Importing a handler module registers its action types.
from . import agent_connections  # noqa: E402,F401
from . import agent_app_access  # noqa: E402,F401
from . import agent_grants  # noqa: E402,F401
from . import agent_workflows  # noqa: E402,F401
