import requests
import re
import urllib.parse
from collections import defaultdict
from secrets import token_hex

import graphene
from urllib3.util import parse_url
from django.apps import apps
from django.conf import settings
from api.utils.network import validate_url_is_safe

from api.utils.syncing.auth import decrypt_credential_values, get_credentials

# GitLab's default environment scope: the variable is available to every environment.
GITLAB_ALL_ENVIRONMENTS_SCOPE = "*"

# Mirrors GitLab's own validation for environment scopes (Gitlab::Regex.environment_scope_regex)
# and the 255 character limit on the environment_scope column.
GITLAB_ENVIRONMENT_SCOPE_REGEX = re.compile(r"[a-zA-Z0-9_/${}. *-]+")
GITLAB_ENVIRONMENT_SCOPE_MAX_LENGTH = 255

GITLAB_REQUEST_TIMEOUT = 30
GITLAB_MAX_REDIRECTS = 5
REDIRECT_STATUS_CODES = (301, 302, 303, 307, 308)

# Upper bounds on pages fetched when listing environments and variables (100 per page)
GITLAB_ENVIRONMENTS_MAX_PAGES = 50
GITLAB_VARIABLES_MAX_PAGES = 1000


class NamespaceType(graphene.ObjectType):
    id = graphene.ID()
    name = graphene.String()
    path = graphene.String()
    full_path = graphene.String()


class GitLabProjectType(graphene.ObjectType):
    id = graphene.ID()
    name = graphene.String()
    name_with_namespace = graphene.String()
    path = graphene.String()
    path_with_namespace = graphene.String()
    created_at = graphene.DateTime()
    default_branch = graphene.String()
    tag_list = graphene.List(graphene.String)
    topics = graphene.List(graphene.String)
    ssh_url_to_repo = graphene.String()
    http_url_to_repo = graphene.String()
    web_url = graphene.String()
    avatar_url = graphene.String()
    star_count = graphene.Int()
    last_activity_at = graphene.DateTime()
    namespace = graphene.Field(NamespaceType)


class GitLabGroupType(graphene.ObjectType):
    id = graphene.ID()
    name = graphene.String()
    path = graphene.String()
    description = graphene.String()
    visibility = graphene.String()
    share_with_group_lock = graphene.Boolean()
    require_two_factor_authentication = graphene.Boolean()
    two_factor_grace_period = graphene.Int()
    project_creation_level = graphene.String()
    auto_devops_enabled = graphene.Boolean()
    subgroup_creation_level = graphene.String()
    emails_disabled = graphene.Boolean()
    emails_enabled = graphene.Boolean()
    mentions_disabled = graphene.Boolean()
    lfs_enabled = graphene.Boolean()
    default_branch = graphene.String()
    default_branch_protection = graphene.Int()
    avatar_url = graphene.String()
    web_url = graphene.String()
    request_access_enabled = graphene.Boolean()
    repository_storage = graphene.String()
    full_name = graphene.String()
    full_path = graphene.String()
    file_template_project_id = graphene.ID()
    parent_id = graphene.ID()
    created_at = graphene.DateTime()


def get_gitlab_credentials(credential_id):

    credentials = get_credentials(credential_id)

    # requests ignored whitespace around pasted hosts, and the checks below need it gone
    host = credentials["gitlab_host"].strip()
    # Pasted tokens can carry whitespace, which requests rejects as a header value
    token = credentials["gitlab_token"].strip()

    if settings.APP_HOST == "cloud":
        # requests must connect to the host that validate_url_is_safe checks
        if _connection_target(host, allow_credentials=True) is None:
            raise Exception("The GitLab host is not a valid URL.")
        validate_url_is_safe(host)

    return host, token


DEFAULT_PORTS = {"http": 80, "https": 443}


def _connection_target(url, allow_credentials=False):
    """
    The scheme, host and port requests connects to for a URL, or None if that isn't
    clear. requests parses URLs with urllib3, which can disagree with urllib.parse
    (used by validate_url_is_safe), e.g. on backslashes, so both must agree.
    """

    if "\\" in url:
        return None
    try:
        parsed = parse_url(url)
        hostname = urllib.parse.urlsplit(url).hostname
        # urllib3 encodes international domain names, urllib.parse doesn't
        hostname = (hostname or "").encode("idna").decode("ascii")
    except (ValueError, UnicodeError):
        return None

    scheme = (parsed.scheme or "").lower()
    host = (parsed.host or "").lower().rstrip(".").strip("[]")
    if (
        scheme not in DEFAULT_PORTS
        or not host
        or host != hostname.rstrip(".")
        or (parsed.auth and not allow_credentials)
    ):
        return None
    return scheme, host, parsed.port or DEFAULT_PORTS[scheme]


def _is_same_host_redirect(url, redirect_url):
    current = _connection_target(url, allow_credentials=True)
    target = _connection_target(redirect_url)
    if current is None or target is None:
        return False

    scheme, host, port = current
    target_scheme, target_host, target_port = target
    if target_host != host:
        return False
    if target_scheme == scheme:
        return target_port == port
    # The usual redirect of a GitLab host
    return scheme == "http" and target_scheme == "https" and target_port == 443


def gitlab_request(method, url, **kwargs):
    """
    Make a request to the GitLab API. Redirects are only followed on the same host,
    e.g. from http to https, keeping the method and body. Following them to another
    host could send the token, or a secret in the request body, to a host that was
    never validated.
    """

    kwargs.setdefault("timeout", GITLAB_REQUEST_TIMEOUT)
    for _ in range(GITLAB_MAX_REDIRECTS + 1):
        try:
            response = requests.request(method, url, allow_redirects=False, **kwargs)
        except requests.exceptions.InvalidHeader:
            # The original message contains the header value, i.e. the token
            raise Exception("The GitLab token contains invalid characters") from None

        location = response.headers.get("Location")
        if response.status_code not in REDIRECT_STATUS_CODES or not location:
            return response

        redirect_url = urllib.parse.urljoin(url, location)
        if "\\" in location or not _is_same_host_redirect(url, redirect_url):
            raise Exception(
                "GitLab redirected the request to another address. Check the GitLab "
                "host in the credentials used by this sync."
            )
        if settings.APP_HOST == "cloud":
            validate_url_is_safe(redirect_url)
        url = redirect_url

    raise Exception("GitLab redirected the request too many times.")


def get_gitlab_host(credentials):
    """
    The GitLab instance of a stored GitLab credential, normalized so that credentials
    for the same GitLab instance compare equal: e.g. http:// and https:// URLs of a
    host that redirects one to the other.
    """

    host = decrypt_credential_values(credentials, ["gitlab_host"]).get("gitlab_host")
    host = (host or "").strip().rstrip("/").lower()
    if not host:
        return ""

    try:
        url = urllib.parse.urlsplit(host if "://" in host else f"https://{host}")
        port = url.port
    except ValueError:
        return host
    if not url.hostname:
        return host
    netloc = url.hostname if port in (None, 80, 443) else f"{url.hostname}:{port}"
    return netloc + url.path.rstrip("/")


def validate_auth(credential_id):
    """
    Check if the GitLab token is valid and operational.
    This function makes a request to the GitLab API to fetch the user's details.
    A successful request (status code 200) indicates a valid token.
    """

    GITLAB_HOST, GITLAB_TOKEN = get_gitlab_credentials(credential_id)

    headers = {"Private-Token": GITLAB_TOKEN}
    response = gitlab_request("GET", f"{GITLAB_HOST}/api/v4/user", headers=headers)

    return response.status_code == 200


def list_gitlab_projects(credential_id):
    """
    List all GitLab repositories the user has access to with CRUD permissions on CI/CD variables.
    This function paginates through the GitLab API to fetch all projects accessible to the user.
    It checks for project access levels to determine if the user can CRUD CI/CD variables.
    """

    if not validate_auth(credential_id):
        raise Exception(
            "Could not authenticate with GitLab. Please check that your credentials are valid"
        )

    GITLAB_HOST, GITLAB_TOKEN = get_gitlab_credentials(credential_id)

    GITLAB_PROJECTS_BASE_URL = f"{GITLAB_HOST}/api/v4/projects?membership=true&min_access_level=30&per_page=100"

    headers = {"Private-Token": GITLAB_TOKEN}
    url = f"{GITLAB_HOST}/api/v4/projects?membership=true&min_access_level=30&per_page=100"
    all_projects = []

    while url:
        response = gitlab_request("GET", url, headers=headers)
        if response.status_code != 200:
            return None

        projects = response.json()
        all_projects.extend(projects)

        next_page = response.headers.get("X-Next-Page")
        url = f"{GITLAB_PROJECTS_BASE_URL}&page={next_page}" if next_page else None

    return all_projects


def list_gitlab_groups(credential_id):
    """
    List all GitLab visible groups for the authenticated user.
    This function paginates through the GitLab API to fetch all groups accessible to the user.
    It filters access levels to groups that the user can CRUD CI/CD variables.
    """

    if not validate_auth(credential_id):
        raise Exception(
            "Could not authenticate with GitLab. Please check that your credentials are valid"
        )

    GITLAB_HOST, GITLAB_TOKEN = get_gitlab_credentials(credential_id)

    GITLAB_GROUPS_BASE_URL = (
        f"{GITLAB_HOST}/api/v4/groups?membership=true&min_access_level=30&per_page=100"
    )

    headers = {"Private-Token": GITLAB_TOKEN}
    url = GITLAB_GROUPS_BASE_URL
    all_groups = []

    while url:
        response = gitlab_request("GET", url, headers=headers)
        if response.status_code != 200:
            return None

        groups = response.json()
        all_groups.extend(groups)

        next_page = response.headers.get("X-Next-Page")
        url = f"{GITLAB_GROUPS_BASE_URL}&page={next_page}" if next_page else None

    return all_groups


def normalize_environment_scope(environment_scope):
    """
    Validate a GitLab CI/CD variable environment scope.
    Returns the default scope ("*", all environments) when no scope is given.
    Raises ValueError if the scope would be rejected by GitLab.
    """

    if environment_scope is None:
        return GITLAB_ALL_ENVIRONMENTS_SCOPE

    environment_scope = environment_scope.strip()

    if not environment_scope:
        return GITLAB_ALL_ENVIRONMENTS_SCOPE

    if len(environment_scope) > GITLAB_ENVIRONMENT_SCOPE_MAX_LENGTH:
        raise ValueError(
            f"Environment scope must be {GITLAB_ENVIRONMENT_SCOPE_MAX_LENGTH} characters or fewer"
        )

    if not GITLAB_ENVIRONMENT_SCOPE_REGEX.fullmatch(environment_scope):
        raise ValueError(
            "Environment scope can contain only letters, digits, '-', '_', '/', '$', '{', '}', '.', '*' and spaces"
        )

    return environment_scope


def list_gitlab_environments(credential_id, project_id):
    """
    List the names of all environments in a GitLab project.
    Environments only exist at the project level, so there is no equivalent for groups.
    """

    GITLAB_HOST, GITLAB_TOKEN = get_gitlab_credentials(credential_id)

    headers = {"Private-Token": GITLAB_TOKEN}
    encoded_project_id = urllib.parse.quote(str(project_id), safe="")
    url = f"{GITLAB_HOST}/api/v4/projects/{encoded_project_id}/environments"

    environment_names = set()
    page = "1"
    pages_fetched = 0

    while page and pages_fetched < GITLAB_ENVIRONMENTS_MAX_PAGES:
        response = gitlab_request(
            "GET", url, headers=headers, params={"per_page": 100, "page": page}
        )
        # Projects with the Environments feature disabled return 403, but can still
        # have scoped variables.
        if response.status_code == 403:
            return []
        if response.status_code != 200:
            raise Exception(
                f"Could not list environments for this GitLab project (HTTP {response.status_code})"
            )

        environment_names.update(environment["name"] for environment in response.json())
        page = response.headers.get("X-Next-Page")
        pages_fetched += 1

    return sorted(environment_names)


GITLAB_GROUP_ENVIRONMENT_SCOPES_QUERY = """
query($fullPath: ID!) {
  group(fullPath: $fullPath) {
    environmentScopes(first: 100) {
      nodes {
        name
      }
    }
  }
}
"""


def list_gitlab_group_environment_scopes(credential_id, group_path):
    """
    List the environment scopes already used by the CI/CD variables of a GitLab group,
    the suggestions GitLab itself offers for group variables. Groups have no
    environments of their own.

    Only scope names are fetched, never variable values. Returns an empty list when
    GitLab doesn't support this (older versions) or can't be reached, as the
    suggestions are optional.
    """

    GITLAB_HOST, GITLAB_TOKEN = get_gitlab_credentials(credential_id)

    try:
        response = gitlab_request(
            "POST",
            f"{GITLAB_HOST}/api/graphql",
            headers={"Private-Token": GITLAB_TOKEN},
            json={
                "query": GITLAB_GROUP_ENVIRONMENT_SCOPES_QUERY,
                "variables": {"fullPath": group_path},
            },
        )
    except Exception:
        return []
    if response.status_code != 200:
        return []

    try:
        nodes = response.json()["data"]["group"]["environmentScopes"]["nodes"]
    except (ValueError, KeyError, TypeError):
        return []

    return sorted(
        {
            node["name"]
            for node in nodes
            if node.get("name") and node["name"] != GITLAB_ALL_ENVIRONMENTS_SCOPE
        }
    )


def extract_project_path(repo_url):
    """
    Extract the project or group path from the repository URL.
    This function uses a regular expression to parse the GitLab project or group path from a given URL.
    """
    repo_url = repo_url.rstrip("/")
    domain_match = re.search(r"https?://[^/]+/(.+)", repo_url)
    if not domain_match:
        return None
    return domain_match.group(1)


def resolve_gitlab_resource_id(credential_id, resource_path, is_group):
    """
    The ID of a GitLab project or group from its path, or None. GitLab redirects the
    old path of a renamed or moved project to the new one.
    """

    GITLAB_HOST, GITLAB_TOKEN = get_gitlab_credentials(credential_id)

    response = gitlab_request(
        "GET",
        f"{GITLAB_HOST}/api/v4/{'groups' if is_group else 'projects'}/"
        f"{urllib.parse.quote_plus(resource_path)}",
        headers={"Private-Token": GITLAB_TOKEN},
        params={"with_projects": "false"} if is_group else None,
    )
    if response.status_code != 200:
        return None
    resource_id = response.json().get("id")
    return str(resource_id) if resource_id is not None else None


def _normalize_resource_path(resource_path):
    return (resource_path or "").strip().strip("/").lower()


def same_gitlab_resource(options, other_options):
    """
    Whether the options of two GitLab syncs target the same project or group, on
    the same GitLab instance (which callers check).
    """

    if bool(options.get("is_group")) != bool(other_options.get("is_group")):
        return False

    resource_id = options.get("resource_id")
    other_resource_id = other_options.get("resource_id")
    if resource_id not in (None, "") and other_resource_id not in (None, ""):
        return str(resource_id) == str(other_resource_id)

    # Syncs created before July 2024 only stored the path of the project or group
    resource_path = _normalize_resource_path(options.get("resource_path"))
    return bool(resource_path) and resource_path == _normalize_resource_path(
        other_options.get("resource_path")
    )


def get_sync_gitlab_host(environment_sync):
    """The GitLab host of a sync, or None if it can't be told."""

    if environment_sync.authentication is None:
        return None
    try:
        return get_gitlab_host(environment_sync.authentication.credentials)
    except Exception:
        return None


def gitlab_sync_conflict(options, gitlab_host, app_id, other_syncs, host_of=None):
    """
    Why a GitLab sync with these options, on the GitLab instance at gitlab_host, in
    the App app_id, can't be added next to other_syncs (the other GitLab syncs in
    the organisation), or None.

    A sync owns every variable in its environment scope, so two syncs in an App to
    the same project or group and scope would overwrite and delete each other's
    variables. Syncs created before environment scopes were supported (no stored
    scope) also update variables moved to other scopes, so they can't be combined
    with scoped syncs, in any App: they could copy a variable moved to the scoped
    sync's scope into "*". Two such syncs could always be combined, and still can.
    """

    host_of = host_of or get_sync_gitlab_host
    environment_scope = options.get("environment_scope")
    resource_type = "group" if options.get("is_group") else "project"

    for other_sync in other_syncs:
        if not same_gitlab_resource(options, other_sync.options):
            continue
        other_scope = other_sync.options.get("environment_scope")
        if environment_scope is None and other_scope is None:
            continue
        same_app = str(other_sync.environment.app_id) == str(app_id)
        if environment_scope is not None and other_scope is not None and not same_app:
            continue
        # Project and group IDs are only unique within a GitLab instance. If that
        # can't be told, assume the same instance.
        other_host = host_of(other_sync)
        if other_host is not None and other_host != gitlab_host:
            continue

        in_another_app = "" if same_app else ", in another App,"
        if other_scope is None:
            return (
                f"This GitLab {resource_type} already has a sync{in_another_app} that "
                "was created before environment scopes were available. Delete that "
                "sync and create it again with an environment scope first."
            )
        if environment_scope is None:
            return (
                "This sync was created before environment scopes were available, and "
                f"this GitLab {resource_type} already has a sync{in_another_app} with "
                "an environment scope. Delete this sync and create it again with an "
                "environment scope first."
            )
        if normalize_environment_scope(other_scope) == normalize_environment_scope(
            environment_scope
        ):
            return f"A sync already exists for this GitLab {resource_type} and environment scope!"

    return None


def get_environment_scopes_of_other_syncs(environment_sync):
    """
    The environment scopes managed by other GitLab syncs in the organisation that
    target the same GitLab project or group as this sync.
    """

    if environment_sync.authentication is None:
        return set()

    EnvironmentSync = apps.get_model("api", "EnvironmentSync")

    options = environment_sync.options
    gitlab_host = get_gitlab_host(environment_sync.authentication.credentials)

    other_syncs = (
        EnvironmentSync.objects.filter(
            service=environment_sync.service,
            deleted_at=None,
            environment__app__organisation=environment_sync.environment.app.organisation,
        )
        .exclude(id=environment_sync.id)
        .select_related("authentication")
    )

    scopes = set()
    for other_sync in other_syncs:
        scope = other_sync.options.get("environment_scope")
        if scope is None or not same_gitlab_resource(options, other_sync.options):
            continue
        # Project and group IDs are only unique within a GitLab instance. If that
        # can't be told, assume the same instance and leave the scope alone.
        other_host = get_sync_gitlab_host(other_sync)
        if other_host is None or other_host == gitlab_host:
            scopes.add(scope)

    return scopes


def _variable_scope(variable):
    return variable.get("environment_scope", GITLAB_ALL_ENVIRONMENTS_SCOPE)


def _variable_url(base_url, key):
    return f"{base_url}/{urllib.parse.quote_plus(key)}"


def _scope_filter(environment_scope):
    return {"filter[environment_scope]": environment_scope}


def _check_group_environment_scope_support(base_url, headers, environment_scope):
    """
    GitLab tiers without scoped group variables silently drop the environment scope
    and create the variable for all environments. Check with a throwaway variable,
    before writing any secret.
    """

    probe_key = f"PHASE_SCOPE_CHECK_{token_hex(6).upper()}"
    response = gitlab_request(
        "POST",
        base_url,
        headers=headers,
        json={
            "key": probe_key,
            "value": token_hex(16),
            "environment_scope": environment_scope,
            "protected": True,
            "masked": False,
            "raw": True,
            "description": "Temporary variable created by Phase to check environment scope support",
        },
    )
    if response.status_code not in [200, 201]:
        raise Exception(
            f"Failed to check support for environment scopes: {response.text}"
        )

    created_scope = _variable_scope(response.json())

    # The variable holds no secret. If it can't be removed and was created in the
    # requested scope, the sync removes it on its next run.
    removed = _delete_variable(base_url, headers, probe_key, created_scope)

    if created_scope != environment_scope:
        leftover = (
            ""
            if removed
            else f" Please delete the {probe_key} variable, which holds no secret."
        )
        raise Exception(
            "This GitLab group does not support environment scopes for CI/CD variables, "
            "so secrets would be available to every environment. "
            "Environment scopes for group variables require GitLab Premium or Ultimate."
            + leftover
        )


def _delete_variable(base_url, headers, key, environment_scope):
    """Best-effort delete of a variable. Returns whether it was deleted."""

    try:
        response = gitlab_request(
            "DELETE",
            _variable_url(base_url, key),
            headers=headers,
            params=_scope_filter(environment_scope),
        )
        return response.status_code == 204
    except Exception:
        return False


def _restore_variable(base_url, headers, variable):
    """Best-effort restore of a variable to how it was listed. Returns whether it
    was restored."""

    if variable is None or variable.get("value") is None:
        return False

    scope = _variable_scope(variable)
    fields = ("value", "masked", "protected", "raw", "description")
    try:
        response = gitlab_request(
            "PUT",
            _variable_url(base_url, variable["key"]),
            headers=headers,
            params=_scope_filter(scope),
            json={
                **{field: variable[field] for field in fields if field in variable},
                "environment_scope": scope,
            },
        )
        return response.status_code == 200 and _variable_scope(response.json()) == scope
    except Exception:
        return False


def _variable_exists(base_url, headers, key, environment_scope):
    """Whether a variable exists. Unlike PUT, GET doesn't fall back to another
    variable with the same key."""

    response = gitlab_request(
        "GET",
        _variable_url(base_url, key),
        headers=headers,
        params=_scope_filter(environment_scope),
    )
    if response.status_code == 200:
        return True
    if response.status_code == 404:
        return False
    raise Exception(f"Failed to check secret {key}: {response.text}")


def _create_variable(base_url, headers, key, environment_scope, payload):
    response = gitlab_request(
        "POST",
        base_url,
        headers=headers,
        json={"key": key, "environment_scope": environment_scope, **payload},
    )
    if response.status_code not in [200, 201]:
        raise Exception(f"Failed to create secret {key}: {response.text}")

    created_scope = _variable_scope(response.json())
    if created_scope != environment_scope:
        if _delete_variable(base_url, headers, key, created_scope):
            outcome = "It was removed again."
        else:
            outcome = (
                "Removing it failed: delete it in GitLab, as it is available "
                "to environments it was not meant for."
            )
        raise Exception(
            f"GitLab created secret {key} with environment scope "
            f"'{created_scope}' instead of '{environment_scope}'. {outcome}"
        )


def _describe_variables(entries, limit=10):
    described = [
        f"{key} ({', '.join(sorted(_variable_scope(v) for v in variables))})"
        for key, variables in entries[:limit]
    ]
    if len(entries) > limit:
        described.append(f"and {len(entries) - limit} more")
    return ", ".join(described)


def _blocked_sync_message(
    ambiguous_updates, ambiguous_deletes, overridden, skipped_deletes, other_changes
):
    parts = []
    if ambiguous_updates:
        parts.append(
            "These secrets exist in several environment scopes in GitLab, but not for "
            "all environments, so this sync can't tell which variable to update: "
            f"{_describe_variables(ambiguous_updates)}."
        )
    if ambiguous_deletes:
        parts.append(
            "These secrets aren't in Phase, but exist in several environment scopes in "
            "GitLab, so this sync can't tell which variables to delete: "
            f"{_describe_variables(ambiguous_deletes)}."
        )
    if overridden:
        parts.append(
            "These secrets also exist in other environment scopes in GitLab, with "
            "other values: "
            f"{_describe_variables(overridden)}. Only their variable for all "
            "environments is synced."
        )
    if skipped_deletes:
        parts.append(
            "Until each of these secrets has one variable, or this sync is created "
            "again with an environment scope, it deletes no variables: "
            f"{', '.join(sorted(key for key, _ in skipped_deletes))}."
        )
    if other_changes:
        parts.append("New and changed secrets were synced.")
    parts.append(
        "To fix this, keep only one variable for each of these secrets in GitLab, or "
        "delete this sync and create it again with an environment scope."
    )
    return " ".join(parts)


def sync_gitlab_secrets(
    secrets,
    credential_id,
    destination_url,
    is_group=False,
    is_masked=False,
    is_protected=False,
    environment_scope=None,
    get_excluded_scopes=None,
):
    """
    Sync secrets to the CI/CD variables of a GitLab project or group.

    A sync with an environment scope manages the variables in that scope: they are
    created, updated or deleted to match the secrets. Variables with the same key in
    other scopes are left untouched.

    Syncs created before environment scopes were supported have no scope (None).
    They manage the variables for all environments ("*") as before. They also keep
    managing a variable that was moved to another scope in GitLab, the way to scope
    them before: a key with no "*" variable and exactly one variable in a scope that
    isn't one of get_excluded_scopes() (the scopes of other syncs to the same project
    or group). Where they used to stop because a key has variables in several
    scopes, they still create and update, but delete nothing, and fail naming the
    keys.
    """

    results = {}

    GITLAB_HOST, GITLAB_TOKEN = get_gitlab_credentials(credential_id)

    headers = {"Private-Token": GITLAB_TOKEN}
    destination_path = destination_url

    try:
        if not destination_path:
            raise ValueError("Error: Invalid project or group URL.")

        if environment_scope is None:
            target_scope = GITLAB_ALL_ENVIRONMENTS_SCOPE
            excluded_scopes = set(get_excluded_scopes() if get_excluded_scopes else ())

            def manages(scope):
                return scope == target_scope or scope not in excluded_scopes

        else:
            target_scope = normalize_environment_scope(environment_scope)

            def manages(scope):
                return scope == target_scope

        encoded_destination_path = urllib.parse.quote_plus(destination_path)
        base_url = f"{GITLAB_HOST}/api/v4/{'groups' if is_group else 'projects'}/{encoded_destination_path}/variables"

        # Fetch all existing GitLab variables with pagination. The same key can
        # exist once per environment scope.
        all_variables = {}
        managed_variables = defaultdict(list)
        page = 1
        while True:
            if page > GITLAB_VARIABLES_MAX_PAGES:
                raise Exception("Too many CI/CD variables to sync.")

            response = gitlab_request(
                "GET", base_url, headers=headers, params={"page": page, "per_page": 100}
            )
            if response.status_code != 200:
                raise Exception(f"Error fetching existing secrets: {response.text}")

            secrets_page = response.json()
            if not secrets_page:
                break  # Exit loop if no more secrets are found

            for var in secrets_page:
                scope = _variable_scope(var)
                all_variables[(var["key"], scope)] = var
                if manages(scope):
                    managed_variables[var["key"]].append(var)
            page += 1

        # Work out all changes before writing anything.
        #
        # Syncs without a scope manage several scopes. Before environment scopes,
        # GitLab refused (409) to delete a key with variables in several scopes, or
        # to update one in a project, which stopped the sync: it compared each secret
        # with the variable listed last for its key, and deleted after creating and
        # updating. (Group updates went to one of the variables instead.) Pipelines
        # may rely on variables it never got to delete, so these syncs still delete
        # nothing when they would have stopped. They do sync everything else.
        updates = []
        creates = []
        ambiguous_updates = []  # can't tell which variable to update
        ambiguous_deletes = []  # can't tell which variables to delete
        overridden = []  # "*" is synced, but the sync used to stop here
        for key, value, comment in secrets:
            payload = {
                "value": value,
                "masked": is_masked,
                "protected": is_protected,
                "raw": True,
                "description": comment,
            }

            existing = managed_variables.get(key, [])
            in_target_scope = [
                v for v in existing if _variable_scope(v) == target_scope
            ]

            def is_changed(variable):
                return (
                    variable.get("value") != value
                    or variable.get("masked") != payload["masked"]
                    or variable.get("protected") != payload["protected"]
                    or variable.get("description") != payload["description"]
                )

            # Only syncs without a scope manage several variables with one key
            used_to_stop = (
                not is_group and len(existing) > 1 and is_changed(existing[-1])
            )

            if in_target_scope:
                existing_secret = in_target_scope[0]
                if used_to_stop:
                    overridden.append((key, existing))
            elif len(existing) == 1:
                existing_secret = existing[0]
            elif existing:
                # Group updates used to change one of these, but not necessarily the
                # right one
                if used_to_stop or (is_group and any(is_changed(v) for v in existing)):
                    ambiguous_updates.append((key, existing))
                continue
            else:
                creates.append((key, payload))
                continue

            if is_changed(existing_secret):
                updates.append((key, _variable_scope(existing_secret), payload))

        # Variables are deleted from the sync's own scope, and syncs without a scope
        # also delete a variable that was moved to another scope.
        secret_keys = {key for key, _, _ in secrets}
        deletes = []
        for key, variables in managed_variables.items():
            if key in secret_keys:
                continue
            if len(variables) == 1:
                deletes.append((key, _variable_scope(variables[0])))
            else:
                ambiguous_deletes.append((key, variables))

        skipped_deletes = []
        if ambiguous_deletes or (not is_group and (ambiguous_updates or overridden)):
            skipped_deletes, deletes = deletes, []

        if (
            is_group
            and target_scope != GITLAB_ALL_ENVIRONMENTS_SCOPE
            and (updates or creates)
        ):
            _check_group_environment_scope_support(base_url, headers, target_scope)

        for key, scope, payload in updates:
            # Group PUTs fall back to another variable with the same key when this
            # one no longer exists, e.g. when it was deleted after it was listed, and
            # update that one instead. Create it again in that case.
            if is_group and not _variable_exists(base_url, headers, key, scope):
                _create_variable(base_url, headers, key, scope, payload)
                continue

            # The scope is also sent in the body: if GitLab still falls back to
            # another variable (deleted since the check above), that variable is
            # moved into this scope rather than exposing the secret to its
            # environments.
            update_response = gitlab_request(
                "PUT",
                _variable_url(base_url, key),
                headers=headers,
                params=_scope_filter(scope),
                json={**payload, "environment_scope": scope},
            )
            if update_response.status_code not in [200, 201]:
                raise Exception(
                    f"Failed to update secret {key}: {update_response.text}"
                )

            updated_scope = _variable_scope(update_response.json())
            if updated_scope != scope:
                if _restore_variable(
                    base_url, headers, all_variables.get((key, updated_scope))
                ):
                    outcome = "That variable was restored."
                else:
                    outcome = (
                        "Restoring it failed: check that variable in GitLab, as the "
                        "secret may be available to environments it was not meant for."
                    )
                raise Exception(
                    f"GitLab updated the {key} variable in environment scope "
                    f"'{updated_scope}' instead of '{scope}'. {outcome}"
                )

        for key, payload in creates:
            _create_variable(base_url, headers, key, target_scope, payload)

        for key, scope in deletes:
            delete_response = gitlab_request(
                "DELETE",
                _variable_url(base_url, key),
                headers=headers,
                params=_scope_filter(scope),
            )
            if delete_response.status_code != 204:
                raise Exception(
                    f"Failed to delete secret {key}: {delete_response.text}"
                )

        if ambiguous_updates or ambiguous_deletes or skipped_deletes:
            raise Exception(
                _blocked_sync_message(
                    ambiguous_updates,
                    ambiguous_deletes,
                    overridden,
                    skipped_deletes,
                    other_changes=bool(updates or creates),
                )
            )

        success = True
        results["message"] = (
            "Secrets synchronized successfully."
            if updates or creates or deletes
            else "No changes needed. Secrets are already synchronized."
        )
    except Exception as e:
        success = False
        results["error"] = f"An error occurred: {str(e)}"

    return success, results
