import re

# Cap filter input to bound regex matching time. Real SCIM filters are short
# (typically a single `attr eq "value"` clause); anything over this is rejected
# to prevent polynomial backtracking on adversarial whitespace-heavy input.
MAX_FILTER_LENGTH = 1024


class InvalidSCIMFilter(Exception):
    """Raised when a SCIM filter is unparseable, uses an unsupported operator,
    or references an unknown attribute (RFC 7644 §3.4.2.2 → 400 invalidFilter)."""

    pass


# Operators we honour today (string attributes, RFC 7644 §3.4.2.2).
# Maps op → (case_insensitive_suffix, case_sensitive_suffix, negate).
# `pr` / `gt` / `lt` / `ge` / `le` aren't useful against our current schema
# (no nullable string attrs we'd want to test presence on, no numeric / date
# attrs) and are explicitly rejected with 400 invalidFilter.
_SUPPORTED_OPERATORS = {
    "eq": ("iexact", "exact", False),
    "ne": ("iexact", "exact", True),
    "co": ("icontains", "contains", False),
    "sw": ("istartswith", "startswith", False),
    "ew": ("iendswith", "endswith", False),
}

# Schema URI prefixes per RFC 7643 §3.1 / §4. Strip them so a filter like
# `urn:ietf:params:scim:schemas:core:2.0:User:userName eq "x"` (which any
# spec-compliant IdP is allowed to send) resolves to the same attribute as
# the unqualified `userName`.
_SCHEMA_PREFIXES = (
    "urn:ietf:params:scim:schemas:core:2.0:user:",
    "urn:ietf:params:scim:schemas:core:2.0:group:",
)


def _normalize_attribute(attr):
    a = attr.lower()
    for prefix in _SCHEMA_PREFIXES:
        if a.startswith(prefix):
            return a[len(prefix):]
    return a


def parse_scim_filter(filter_string):
    """
    Parse a SCIM filter expression (RFC 7644 §3.4.2.2) into a list of
    (attribute, operator, value) tuples. Supports the string-comparison
    operators eq/ne/co/sw/ew joined by `and`.

    Returns [] for empty/None input. Returns [] when input is non-empty but
    no clause matched the grammar — callers should treat that as invalid.
    """
    if not filter_string or len(filter_string) > MAX_FILTER_LENGTH:
        return []

    clauses = []
    # Split on ' and ' (case-insensitive). Lookarounds keep the pattern
    # non-backtracking: no `\s+` quantifier means no polynomial worst case.
    parts = re.split(r"(?<=\s)and(?=\s)", filter_string, flags=re.IGNORECASE)

    for part in parts:
        part = part.strip()
        match = re.match(
            r'^(\S+)\s+(eq|ne|co|sw|ew)\s+"([^"]*)"$', part, re.IGNORECASE
        )
        if match:
            attr, op, value = match.groups()
            clauses.append((_normalize_attribute(attr), op.lower(), value))

    return clauses


def parse_patch_path_filter(path):
    """
    Parse a SCIM PATCH path filter like 'members[value eq "abc-123"]'
    (RFC 7644 §3.5.2 — used by every IdP for targeted member removal).
    Returns the extracted value, or None if the path doesn't match.
    """
    match = re.match(r'^members\[value\s+eq\s+"([^"]+)"\]$', path, re.IGNORECASE)
    if match:
        return match.group(1)
    return None


# Each value is (django_field, case_exact). case_exact mirrors the SCIM
# schema's caseExact attribute (RFC 7643 §2.2 / §7); when true the filter
# uses Django's case-sensitive lookup variant.
SCIM_USER_ATTR_MAP = {
    "username": ("email", False),
    "externalid": ("external_id", True),
    "emails.value": ("email", False),
    "displayname": ("display_name", False),
}

SCIM_GROUP_ATTR_MAP = {
    "displayname": ("display_name", False),
    "externalid": ("external_id", True),
}


def scim_filter_to_queryset(queryset, filter_string, attr_map):
    """
    Apply a SCIM filter to a Django queryset.

    Raises InvalidSCIMFilter if the filter is unparseable, uses an
    unsupported operator, or names an attribute that isn't in `attr_map` —
    per RFC 7644 §3.4.2.2 these cases MUST return 400 invalidFilter rather
    than fall through to an unfiltered collection.
    """
    if not filter_string:
        return queryset

    clauses = parse_scim_filter(filter_string)
    if not clauses:
        raise InvalidSCIMFilter(f"Unparseable filter: {filter_string!r}")

    for attr, op, value in clauses:
        if op not in _SUPPORTED_OPERATORS:
            raise InvalidSCIMFilter(f"Unsupported operator: {op!r}")
        mapping = attr_map.get(attr)
        if mapping is None:
            raise InvalidSCIMFilter(f"Unknown attribute: {attr!r}")
        field, case_exact = mapping
        suffix_ci, suffix_cs, negate = _SUPPORTED_OPERATORS[op]
        suffix = suffix_cs if case_exact else suffix_ci
        lookup = {f"{field}__{suffix}": value}
        queryset = queryset.exclude(**lookup) if negate else queryset.filter(**lookup)

    return queryset
