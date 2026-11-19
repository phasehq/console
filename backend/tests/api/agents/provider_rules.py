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
    "action_classes": "actionClasses",
}
_PATH_RULE = {"host_label": "hostLabel"}
_ACTION_CLASSES = {
    "read_verbs": "readVerbs",
    "create_verbs": "createVerbs",
    "delete_verbs": "deleteVerbs",
    "admin_services": "adminServices",
    "admin_suffixes": "adminSuffixes",
    "s3_subresources": "s3Subresources",
    "rest_operations": "restOperations",
    "query_protocol_services": "queryProtocolServices",
    "dual_protocol_services": "dualProtocolServices",
    "json_target_services": "jsonTargetServices",
    "mixed_services": "mixedServices",
}


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
        elif key == "action_classes":
            value = {_ACTION_CLASSES.get(name, name): item for name, item in value.items()}
        result[_TOP[key]] = value
    return result


def expected_wire(service_type):
    return wire(recorded(service_type))
