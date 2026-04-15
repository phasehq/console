import re


def parse_scim_filter(filter_string):
    """
    Parse a minimal subset of SCIM filter expressions (RFC 7644 Section 3.4.2.2).

    Supports:
      - eq operator: 'userName eq "user@example.com"'
      - and conjunction: 'userName eq "foo" and externalId eq "bar"'

    Returns a list of (attribute, operator, value) tuples.
    """
    if not filter_string:
        return []

    clauses = []
    # Split on ' and ' (case-insensitive)
    parts = re.split(r"\s+and\s+", filter_string, flags=re.IGNORECASE)

    for part in parts:
        part = part.strip()
        match = re.match(
            r'^(\S+)\s+(eq|ne|co|sw|ew)\s+"([^"]*)"$', part, re.IGNORECASE
        )
        if match:
            attr, op, value = match.groups()
            clauses.append((attr.lower(), op.lower(), value))

    return clauses


def parse_patch_path_filter(path):
    """
    Parse Azure Entra ID-style PATCH member removal path.

    Example: 'members[value eq "abc-123"]'
    Returns the extracted value, or None if the path doesn't match.
    """
    match = re.match(r'^members\[value\s+eq\s+"([^"]+)"\]$', path, re.IGNORECASE)
    if match:
        return match.group(1)
    return None


# Maps SCIM user attribute names to Django ORM lookups
SCIM_USER_ATTR_MAP = {
    "username": "email__iexact",
    "externalid": "external_id",
    "emails.value": "email__iexact",
    "displayname": "display_name__iexact",
}

# Maps SCIM group attribute names to Django ORM lookups
SCIM_GROUP_ATTR_MAP = {
    "displayname": "display_name__iexact",
    "externalid": "external_id",
}


def scim_filter_to_queryset(queryset, filter_string, attr_map):
    """
    Apply SCIM filter clauses to a Django queryset.
    Only 'eq' is supported — other operators are silently ignored.
    """
    clauses = parse_scim_filter(filter_string)
    for attr, op, value in clauses:
        if op != "eq":
            continue
        lookup = attr_map.get(attr)
        if lookup:
            queryset = queryset.filter(**{lookup: value})
    return queryset
