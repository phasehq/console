"""Typed actions a request can carry.

A request asks for one action. The handler registered for the action's type
checks a request, describes it for the member reviewing it, and carries it out
once approved. A handler owns its target: this registry is handed the request
and the member acting on it, and knows nothing about what an action changes or
who requested it.
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

    def validate(self, request, action, member):
        """Return the action in canonical form, or raise ``ActionError``.

        Called for a request before its request is saved, and again for the
        action a reviewer is about to approve, which they may have edited.
        ``member`` is who the request is made by or on behalf of, then the
        reviewer; it may be None. On an unsaved request the handler may set
        the columns that point at its target.
        """

        raise NotImplementedError

    def describe(self, request, action, member):
        """Return what a reviewer needs to judge the action.

        Always a ``title``. A handler adds the current and requested state of
        its target where that makes sense.
        """

        raise NotImplementedError

    def apply(self, request, action, member, inputs):
        """Carry out an approved action and return an ``AppliedAction``.

        Runs inside the approving transaction with the request row locked.
        ``inputs`` is what the reviewer supplied beyond the action, such as
        material sealed in their browser; it is never stored on the request.
        The handler checks that ``member`` may change its target.
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
