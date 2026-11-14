"""Sealed values and key copies for custom HTTP Connections.

Each custom Connection has one X25519 keypair. Its value is stored once, sealed
to the public key, and the private key is wrapped once per reader in
``AgentConnectionKeyCopy``. A writer needs only the public key.

Plaintext values and private keys live in local variables of this module. They
are never logged or stored, and only the runtime resolver receives an opened
value.
"""

import json
import re
from uuid import uuid4

from django.db.models import Exists, OuterRef
from django.utils import timezone

from api.models import (
    AgentConnection,
    AgentConnectionKeyCopy,
    AgentWorkflowGrant,
)
from api.utils.agent_config.http_definition import (
    agent_visible_texts,
    bound_hosts,
    compile_service,
    is_custom_service,
    load_definition,
    secret_field_names,
    validate_definition,
)
from api.utils.agent_sessions import refresh_connection_sessions
from api.utils.crypto import (
    decrypt_asymmetric,
    ed25519_pk_to_kx,
    encrypt_asymmetric,
    get_server_keypair,
    random_hex,
    validate_encrypted_string,
)


SEALED_VALUE_VERSION = 1
MIN_FIELD_VALUE_BYTES = 8
MAX_FIELD_VALUE_BYTES = 16384
MAX_SEALED_VALUE_LENGTH = 1_048_576
MAX_WRAPPED_KEY_LENGTH = 512

_KEY = re.compile(r"^[0-9a-f]{64}$")


class SealedValueError(ValueError):
    """A sealed value or key copy is missing, malformed, or does not open."""


def _ciphertext(value, label, maximum):
    if (
        not isinstance(value, str)
        or not value
        or len(value) > maximum
        or value.count(":") != 3
        or not validate_encrypted_string(value)
    ):
        raise SealedValueError(f"{label} is not a sealed value")
    return value


def _open(ciphertext, private_key, public_key, failure):
    try:
        return decrypt_asymmetric(ciphertext, private_key, public_key)
    except Exception:
        pass
    # Raised outside the handler so the error does not carry the original,
    # which can hold a reference to the plaintext.
    raise SealedValueError(failure)


def _keys_match(private_key, public_key):
    probe = random_hex(16)
    try:
        return (
            decrypt_asymmetric(
                encrypt_asymmetric(probe, public_key), private_key, public_key
            )
            == probe
        )
    except Exception:
        return False


def _checked_fields(payload, definition):
    """Check an opened value against its Connection and return its fields."""

    if not isinstance(payload, dict) or set(payload) != {"v", "hosts", "fields"}:
        raise SealedValueError("The sealed value must hold v, hosts and fields")
    version = payload["v"]
    if isinstance(version, bool) or version != SEALED_VALUE_VERSION:
        raise SealedValueError("The sealed value has an unsupported version")

    hosts = payload["hosts"]
    if not isinstance(hosts, list):
        raise SealedValueError("The sealed value's hosts must be a list")
    sealed_hosts = set()
    for rule in hosts:
        if (
            not isinstance(rule, dict)
            or not {"match", "value"} <= set(rule) <= {"match", "value", "port"}
            or rule["match"] not in {"exact", "suffix"}
            or not isinstance(rule["value"], str)
        ):
            raise SealedValueError("The sealed value's hosts are malformed")
        port = rule.get("port")
        if port is not None and (isinstance(port, bool) or not isinstance(port, int)):
            raise SealedValueError("The sealed value's hosts are malformed")
        sealed_hosts.add((rule["value"].lower().rstrip("."), rule["match"], port))
    expected_hosts = {
        (rule["value"], rule["match"], rule.get("port"))
        for rule in bound_hosts(definition)
    }
    if sealed_hosts != expected_hosts:
        raise SealedValueError(
            "The sealed value is bound to different hosts than this Connection"
        )

    fields = payload["fields"]
    if not isinstance(fields, dict) or set(fields) != set(
        secret_field_names(definition)
    ):
        raise SealedValueError(
            "The sealed value must hold exactly this Connection's secret fields"
        )
    for name, value in fields.items():
        try:
            size = len(value.encode("utf-8")) if isinstance(value, str) else 0
        except UnicodeError:
            size = 0
        if (
            not MIN_FIELD_VALUE_BYTES <= size <= MAX_FIELD_VALUE_BYTES
            or "\x00" in value
        ):
            raise SealedValueError(
                f"Secret field {name} must be {MIN_FIELD_VALUE_BYTES} to "
                f"{MAX_FIELD_VALUE_BYTES} bytes without NUL"
            )
    return fields


def _refuse_agent_visible_secrets(fields, definition):
    """Refuse a secret that also occurs in text the Agent can read.

    Checked whenever a value or a definition is written and the server can open
    the value. The message names the place, never the secret.
    """

    for label, text in agent_visible_texts(definition):
        for name, value in fields.items():
            if value in text:
                raise SealedValueError(
                    f"The secret for {name} also appears in {label}, which the "
                    "Agent can read"
                )


def _read_sealed_value(ciphertext, private_key, public_key, definition):
    plaintext = _open(
        ciphertext, private_key, public_key, "The sealed value does not open"
    )
    try:
        payload = json.loads(plaintext)
    except ValueError:
        payload = None
    if payload is None:
        # Raised outside the handler: a JSON error keeps the whole document.
        raise SealedValueError("The sealed value is not valid JSON")
    return _checked_fields(payload, definition)


def _server_copy(connection):
    return AgentConnectionKeyCopy.objects.filter(
        connection=connection, reader_type=AgentConnectionKeyCopy.SERVER
    ).first()


def server_readable(connection):
    return _server_copy(connection) is not None


def _open_server_wrapped_key(wrapped_key):
    server_public_key, server_private_key = get_server_keypair()
    private_key = _open(
        wrapped_key,
        server_private_key.hex(),
        server_public_key.hex(),
        "The server copy of the Connection key does not open",
    )
    if not _KEY.fullmatch(private_key):
        raise SealedValueError("The server copy of the Connection key is malformed")
    return private_key


def _connection_private_key(connection):
    copy = _server_copy(connection)
    if copy is None or copy.key_version != connection.key_version:
        raise SealedValueError("This Connection has no server copy of its key")
    return _open_server_wrapped_key(copy.wrapped_key)


def _agent_public_key(agent):
    try:
        return ed25519_pk_to_kx(agent.identity_key)
    except Exception as exc:
        raise SealedValueError("This Agent has no usable identity key") from exc


def _write_key_copy(connection, private_key, reader_type, reader_key, *, agent=None):
    AgentConnectionKeyCopy.objects.update_or_create(
        connection=connection,
        reader_type=reader_type,
        agent=agent,
        defaults={
            "key_version": connection.key_version,
            "wrapped_key": encrypt_asymmetric(private_key, reader_key),
            "wrapped_with": reader_key,
        },
    )


def _set_value(connection, sealed_value, definition, member, *, private_key=None):
    """Put a new sealed value on the Connection, checking it while the server
    can still open it. The caller saves."""

    ciphertext = _ciphertext(sealed_value, "sealedValue", MAX_SEALED_VALUE_LENGTH)
    if not connection.encryption_public_key:
        raise SealedValueError("This Connection has no encryption key")
    if private_key is None and server_readable(connection):
        private_key = _connection_private_key(connection)
    if private_key is not None:
        _refuse_agent_visible_secrets(
            _read_sealed_value(
                ciphertext, private_key, connection.encryption_public_key, definition
            ),
            definition,
        )
    connection.sealed_value = ciphertext
    connection.value_revision += 1
    connection.value_updated_at = timezone.now()
    connection.value_updated_by = member
    connection.state = AgentConnection.ACTIVE


def _save(connection, member):
    connection.updated_by = member
    connection.full_clean()
    connection.save()


def activate_custom_connection(
    connection,
    *,
    definition,
    encryption_public_key,
    server_wrapped_key,
    sealed_value,
    member,
):
    """Give a new custom Connection its definition, keys and first value.

    The browser made the keypair, sealed the value and wrapped the private key
    to the server. Nothing is stored unless the wrapped key opens, matches the
    public key, and opens a value that fits the definition.
    """

    definition = validate_definition(definition)
    if not isinstance(encryption_public_key, str) or not _KEY.fullmatch(
        encryption_public_key
    ):
        raise SealedValueError(
            "encryptionPublicKey must be a 32-byte key in lower-case hex"
        )
    private_key = _open_server_wrapped_key(
        _ciphertext(server_wrapped_key, "serverWrappedKey", MAX_WRAPPED_KEY_LENGTH)
    )
    if not _keys_match(private_key, encryption_public_key):
        raise SealedValueError(
            "serverWrappedKey does not hold the private half of encryptionPublicKey"
        )

    connection.service_type = "http"
    connection.authentication = None
    connection.config = definition
    connection.encryption_public_key = encryption_public_key
    connection.key_version = 1
    connection.host_rules_version = str(uuid4())
    connection.host_rules_authored_by = member
    connection.host_rules_approved_by = None
    connection.host_rules_approved_version = ""
    _set_value(connection, sealed_value, definition, member, private_key=private_key)
    if connection.created_by_id is None:
        connection.created_by = member
    _save(connection, member)

    server_public_key, _ = get_server_keypair()
    connection.key_copies.all().delete()
    AgentConnectionKeyCopy.objects.create(
        connection=connection,
        reader_type=AgentConnectionKeyCopy.SERVER,
        key_version=connection.key_version,
        wrapped_key=server_wrapped_key,
        wrapped_with=server_public_key.hex(),
    )
    return connection


def update_custom_connection(
    connection, *, member, name=None, definition=None, sealed_value=None
):
    """Change a custom Connection's name, definition or value.

    A change to the bound hosts or to the set of secret fields must arrive with
    a value sealed over the new definition: the server could re-seal the stored
    one, but the rule is that a person enters the secret again. Returns what
    changed; when nothing differs from what is stored, nothing is saved and no
    session is refreshed. Call with the Connection row locked.
    """

    current = load_definition(connection.config)
    proposed = current if definition is None else validate_definition(definition)
    hosts_rebound = bound_hosts(proposed) != bound_hosts(current)
    fields_changed = set(secret_field_names(proposed)) != set(
        secret_field_names(current)
    )
    if connection.sealed_value and sealed_value is None:
        if hosts_rebound:
            raise SealedValueError(
                "Enter the secret again to change the hosts of this Connection"
            )
        if fields_changed:
            raise SealedValueError(
                "Enter the secret again to change the secret fields of this "
                "Connection"
            )

    changes = {
        "name_changed": name is not None and name != connection.name,
        "definition_changed": proposed != current,
        "hosts_changed": proposed["hosts"] != current["hosts"],
        "value_written": sealed_value is not None,
        "environment_changed": _agent_view(proposed) != _agent_view(current),
    }
    if sealed_value is not None:
        _set_value(connection, sealed_value, proposed, member)
    elif (
        changes["definition_changed"]
        and connection.sealed_value
        and server_readable(connection)
    ):
        # The stored value stays, so check it against what the Agent will now
        # be able to read.
        _refuse_agent_visible_secrets(
            _read_sealed_value(
                connection.sealed_value,
                _connection_private_key(connection),
                connection.encryption_public_key,
                proposed,
            ),
            proposed,
        )
    if not any(changes.values()):
        # Nothing differs from what is stored: leave the row untouched.
        return changes
    if changes["hosts_changed"]:
        connection.host_rules_version = str(uuid4())
        connection.host_rules_authored_by = member
        connection.host_rules_approved_by = None
        connection.host_rules_approved_version = ""
    if definition is not None:
        connection.config = proposed
    if name is not None:
        connection.name = name
    _save(connection, member)
    refresh_connection_sessions([connection.id])
    return changes


def _agent_view(definition):
    """What a definition puts in the Agent's process: a change needs a restart."""

    service = compile_service(definition)
    return (
        service["fields"],
        service["decoy_format"],
        service["environment_bindings"],
        service["identifier_values"],
    )


def write_custom_connection_value(connection, sealed_value, member):
    """Store a new sealed value. Call with the Connection row locked."""

    _set_value(connection, sealed_value, load_definition(connection.config), member)
    _save(connection, member)
    refresh_connection_sessions([connection.id])


def ensure_agent_key_copy(connection, agent):
    """Wrap a custom Connection's key to an Agent that was just granted it.

    The server opens its own copy to do this. Does nothing for a packaged
    Connection.
    """

    if not is_custom_service(connection.service_type) or not connection.key_version:
        return
    reader_key = _agent_public_key(agent)
    current = AgentConnectionKeyCopy.objects.filter(
        connection=connection,
        agent=agent,
        key_version=connection.key_version,
        wrapped_with=reader_key,
    ).exists()
    if not current:
        _write_key_copy(
            connection,
            _connection_private_key(connection),
            AgentConnectionKeyCopy.AGENT,
            reader_key,
            agent=agent,
        )


def prune_agent_key_copies(connection_ids):
    """Remove each Agent's copy of these Connections' keys once it has no
    grant on the Connection left."""

    live_grant = AgentWorkflowGrant.objects.active().filter(
        connection_id=OuterRef("connection_id"),
        workflow__agent_id=OuterRef("agent_id"),
        workflow__deleted_at__isnull=True,
    )
    stale = list(
        AgentConnectionKeyCopy.objects.filter(
            reader_type=AgentConnectionKeyCopy.AGENT,
            connection_id__in=list(connection_ids),
        )
        .annotate(has_grant=Exists(live_grant))
        .filter(has_grant=False)
        .values_list("id", flat=True)
    )
    if stale:
        AgentConnectionKeyCopy.objects.filter(id__in=stale).delete()


def discard_connection_secrets(connection):
    """Forget a deleted Connection's value and every copy of its key. The
    caller saves ``sealed_value``."""

    connection.key_copies.all().delete()
    connection.sealed_value = ""


def sealed_material_for_agent(connection_id, agent_id):
    """The stored ciphertext with this Agent's wrapped key, for the proxy to open.

    One statement reads the copy and its Connection, so both come from the same
    committed state. Returns ``(connection, material)``, or None when the Agent
    holds no copy of the current key.
    """

    copy = (
        AgentConnectionKeyCopy.objects.select_related("connection")
        .filter(
            connection_id=connection_id,
            reader_type=AgentConnectionKeyCopy.AGENT,
            agent_id=agent_id,
        )
        .first()
    )
    if (
        copy is None
        or copy.key_version != copy.connection.key_version
        or not copy.connection.sealed_value
    ):
        return None
    connection = copy.connection
    return connection, {
        "version": SEALED_VALUE_VERSION,
        "key_version": connection.key_version,
        "public_key": connection.encryption_public_key,
        "ciphertext": connection.sealed_value,
        "wrapped_key": copy.wrapped_key,
    }


def server_key_copy_for_release(connection_id):
    """The server's key copy with its Connection, read in one statement so both
    come from the same committed state. None when the server holds no copy."""

    return (
        AgentConnectionKeyCopy.objects.select_related("connection")
        .filter(
            connection_id=connection_id,
            reader_type=AgentConnectionKeyCopy.SERVER,
        )
        .first()
    )


def open_value_with_server_copy(copy, definition):
    """Open the stored value and check it against the definition the caller is
    about to hand to a proxy. Returns its fields."""

    connection = copy.connection
    if copy.key_version != connection.key_version or not connection.sealed_value:
        raise SealedValueError("This Connection has no value the server can open")
    return _read_sealed_value(
        connection.sealed_value,
        _open_server_wrapped_key(copy.wrapped_key),
        connection.encryption_public_key,
        definition,
    )
