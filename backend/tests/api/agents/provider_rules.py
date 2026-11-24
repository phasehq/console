"""Provider rules each packaged manifest carries, and their wire form.

``wire`` converts only the documented key table, so data map keys such as
``kms:CreateGrant`` stay as written.
"""

import json
from pathlib import Path


RECORDED = Path(__file__).with_name("rest") / "golden" / "provider_rules"
SERVICES = tuple(sorted(path.stem for path in RECORDED.glob("*.json")))

_TOP = {
    "credential_environment": "credentialEnvironment",
    "secret_guard": "secretGuard",
}
_PATH_RULE = {"host_label": "hostLabel"}


def recorded(service_type):
    """The manifest-form data recorded for one service."""

    return json.loads((RECORDED / f"{service_type}.json").read_text())


def wire(manifest):
    """Manifest-form provider rules as the runtime API sends them."""

    result = {}
    for key, value in manifest.items():
        if key not in _TOP:
            continue
        if key == "secret_guard":
            value = {
                **value,
                **(
                    {
                        "paths": [
                            {_PATH_RULE.get(name, name): item for name, item in rule.items()}
                            for rule in value["paths"]
                        ]
                    }
                    if "paths" in value
                    else {}
                ),
            }
        result[_TOP[key]] = value
    return result


def expected_wire(service_type):
    return wire(recorded(service_type))
