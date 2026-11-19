"""Which secrets a leak protection event names.

The Phase CLI replaces a known secret value in a request to a model provider
with a placeholder, ``ph:<type>:<id>``, and reports the placeholders it used in
an Agent event of type ``leak_protection``. For an Agent login ``<id>`` is the
id of the Phase secret, so the Console can say which app and environment that
secret is in. For any other login the CLI sends ``ph:<type>`` without an id,
since the id would be the secret's key name; such a placeholder names no
secret here. A secret's key and value are never read here: only its id, its
folder and the names of its environment and app.
"""

from collections import namedtuple

from api.models import Secret


LEAK_PROTECTION_EVENT = "leak_protection"

# An event names at most this many placeholders.
MAX_PLACEHOLDERS = 20
_MAX_ID_LENGTH = 64

SecretLocation = namedtuple(
    "SecretLocation", "path environment_id environment_name app_id app_name"
)


def event_placeholders(event):
    """``[(placeholder, id)]`` of a leak protection event, in the order sent;
    empty for any other event."""

    if event.event_type != LEAK_PROTECTION_EVENT or not isinstance(event.detail, dict):
        return []
    listed = event.detail.get("placeholders")
    if not isinstance(listed, str):
        return []
    found = []
    for placeholder in listed.split(","):
        placeholder = placeholder.strip()
        parts = placeholder.split(":")
        if len(parts) == 3 and parts[0] == "ph" and 0 < len(parts[2]) <= _MAX_ID_LENGTH:
            found.append((placeholder, parts[2]))
    return found[:MAX_PLACEHOLDERS]


def secret_locations(organisation_id, secret_ids):
    """Where each id lives, for the ids that are a secret of the organisation:
    ``{secret id: SecretLocation}``, in one query."""

    if not secret_ids:
        return {}
    rows = Secret.objects.filter(
        id__in=secret_ids,
        deleted_at__isnull=True,
        environment__deleted_at__isnull=True,
        environment__app__organisation_id=organisation_id,
        environment__app__is_deleted=False,
        environment__app__deleted_at__isnull=True,
    ).values_list(
        "id",
        "path",
        "environment_id",
        "environment__name",
        "environment__app_id",
        "environment__app__name",
    )
    return {row[0]: SecretLocation(*row[1:]) for row in rows}


def preload_secret_locations(events, organisation_id):
    """Look up every placeholder on a page of events at once, so the secret
    lookup is one query however many of its events name a secret. Access
    checks are separate: for a member without global access they cost one
    query for each distinct app and environment on the page."""

    secret_ids = {
        secret_id for event in events for _, secret_id in event_placeholders(event)
    }
    locations = secret_locations(organisation_id, secret_ids)
    for event in events:
        event._secret_locations = locations


def placeholder_secrets(event, visibility):
    """The event's placeholders that stand for a secret, as one member may see
    them: ``[{placeholder, secret_id, path, app_id, app_name, environment_id,
    environment_name}]``. A member who cannot access the app gets only
    ``app_restricted``; one who cannot access the environment gets the app and
    ``environment_restricted``.
    """

    placeholders = event_placeholders(event)
    if not placeholders:
        return []
    locations = getattr(event, "_secret_locations", None)
    if locations is None:
        locations = secret_locations(
            event.organisation_id, {secret_id for _, secret_id in placeholders}
        )
    shown = []
    for placeholder, secret_id in placeholders:
        location = locations.get(secret_id)
        if location is None:
            continue
        entry = {"placeholder": placeholder}
        if not visibility.can_see_app(location.app_id):
            entry["app_restricted"] = True
        else:
            entry.update(app_id=location.app_id, app_name=location.app_name)
            if visibility.can_see_environment(location.app_id, location.environment_id):
                entry.update(
                    environment_id=location.environment_id,
                    environment_name=location.environment_name,
                    secret_id=secret_id,
                    path=location.path,
                )
            else:
                entry["environment_restricted"] = True
        shown.append(entry)
    return shown
