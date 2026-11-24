"""The secrets grid polls every secret and folder of every environment of an App.

Whatever a secret or a folder needs (its tags, the caller's override, its
environment, its child counts) is loaded for the whole list: the number of
queries must not grow with the number of rows.
"""

from collections import Counter
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db.models.sql.compiler import SQLCompiler

from api.models import (
    App,
    CustomUser,
    DynamicSecret,
    Environment,
    Organisation,
    OrganisationMember,
    PersonalSecret,
    Secret,
    SecretFolder,
    SecretTag,
)
from backend.schema import schema

TYPES = "backend.graphene.types"

QUERY = """
{
  appEnvironments(appId: "app-1", environmentId: null) {
    folders { id folderCount secretCount }
    secrets { id tags { id } override { value isActive } }
  }
}
"""

ME = CustomUser(userId="user-me", email="me@example.com")
ORG = Organisation(id="org-1", name="acme")
APP = App(id="app-1", name="backend", organisation=ORG)
MEMBER = OrganisationMember(id="member-1", user=ME, organisation=ORG)
TAG = SecretTag(id="tag-1", name="database", color="#ef4444")


def _matches(row, lookup, wanted):
    *relations, field = lookup.removesuffix("__in").split("__")
    for relation in relations:
        row = getattr(row, relation)
    # A foreign key is compared by its stored id, so the check itself loads nothing
    stored_id = f"{field}_id"
    actual = getattr(row, stored_id if hasattr(type(row), stored_id) else field)
    if lookup.endswith("__in"):
        return actual in {getattr(item, "pk", item) for item in wanted}
    return actual == getattr(wanted, "pk", wanted)


class _Rows:
    """Stands in for a model's manager and querysets, logging each query it would run."""

    def __init__(self, log, model, rows, prefetches=(), grouped_by=None):
        self.log = log
        self.model = model
        self.rows = rows
        self.prefetches = prefetches
        self.grouped_by = grouped_by

    def _with(self, **changes):
        state = dict(rows=self.rows, prefetches=self.prefetches, grouped_by=self.grouped_by)
        return _Rows(self.log, self.model, **{**state, **changes})

    def filter(self, **lookups):
        return self._with(
            rows=[
                row
                for row in self.rows
                if all(_matches(row, lookup, wanted) for lookup, wanted in lookups.items())
            ]
        )

    def order_by(self, *fields):
        return self

    def annotate(self, **aggregates):
        return self

    def prefetch_related(self, *names):
        return self._with(prefetches=names)

    def values_list(self, field):
        return self._with(grouped_by=field)

    def __iter__(self):
        self.log.append(self.model.__name__)
        if self.grouped_by:
            return iter(Counter(getattr(row, self.grouped_by) for row in self.rows).items())
        for name in self.prefetches:
            self.log.append(f"{self.model.__name__}.{name}")
            for row in self.rows:
                # What prefetch_related leaves on each row
                related = SecretTag.objects.all()
                related._result_cache = list(row.tags_in_db)
                related._prefetch_done = True
                row._prefetched_objects_cache = {name: related}
        return iter(self.rows)

    def count(self):
        self.log.append(self.model.__name__)
        return len(self.rows)

    def get(self, **lookups):
        found = list(self.filter(**lookups))
        if not found:
            raise self.model.DoesNotExist()
        if len(found) > 1:
            raise self.model.MultipleObjectsReturned()
        return found[0]


def _poll(secret_count, folder_count):
    """Runs the grid's query on an environment of that size: (data, the queries it ran)."""
    env = Environment(id="env-1", name="Production", app=APP)
    folders = [
        SecretFolder(id=f"folder-{i}", environment_id=env.id, path="/", name=f"folder-{i}")
        for i in range(folder_count)
    ]
    secrets = []
    for i in range(secret_count):
        # Only the stored id, as rows come from the database: reading secret.environment would be a query
        secret = Secret(
            id=f"secret-{i}",
            environment_id=env.id,
            folder_id=folders[i % folder_count].id if i % 2 else None,
            path="/",
            key=f"KEY_{i}",
            value="value",
            comment="",
        )
        secret.tags_in_db = [TAG] if i % 3 == 0 else []
        secrets.append(secret)
    overrides = [
        PersonalSecret(id=f"override-{i}", secret=secret, user=MEMBER, value=f"mine-{i}")
        for i, secret in enumerate(secrets)
        if i % 4 == 1
    ]
    # Two overrides for one secret: the single lookup has always answered none for it
    overrides.append(PersonalSecret(id="override-twice", secret=secrets[1], user=MEMBER, value="x"))

    log = []
    tables = {
        Secret: secrets,
        SecretFolder: folders,
        DynamicSecret: [],
        PersonalSecret: overrides,
        OrganisationMember: [MEMBER],
    }

    def refuse(compiler, *args, **kwargs):
        log.append(f"unexpected: {compiler.query.model.__name__}")
        raise AssertionError(f"A query on {compiler.query.model.__name__} outside the list's own")

    patches = [
        patch(f"{TYPES}.{model.__name__}", SimpleNamespace(objects=_Rows(log, model, rows)))
        for model, rows in tables.items()
    ]
    patches += [
        patch(f"{TYPES}.user_has_permission", return_value=True),
        patch(f"{TYPES}.user_can_access_environment", return_value=True),
        patch.object(SQLCompiler, "execute_sql", refuse),
        patch.object(
            schema.graphql_schema.query_type.fields["appEnvironments"],
            "resolve",
            return_value=[env],
        ),
    ]
    for p in patches:
        p.start()
    try:
        result = schema.execute(QUERY, context_value=SimpleNamespace(user=ME))
    finally:
        for p in reversed(patches):
            p.stop()

    assert result.errors is None, result.errors
    return result.data["appEnvironments"][0], log


def test_the_poll_returns_tags_overrides_and_counts():
    env, _ = _poll(secret_count=8, folder_count=2)

    secrets = {secret["id"]: secret for secret in env["secrets"]}
    assert len(secrets) == 8
    assert secrets["secret-0"]["tags"] == [{"id": "tag-1"}]
    assert secrets["secret-2"]["tags"] == []
    assert secrets["secret-5"]["override"] == {"value": "mine-5", "isActive": True}
    assert secrets["secret-0"]["override"] is None
    # The one overridden twice
    assert secrets["secret-1"]["override"] is None

    # Odd-numbered secrets sit in a folder; with two folders that is always the second
    assert env["folders"] == [
        {"id": "folder-0", "folderCount": 0, "secretCount": 0},
        {"id": "folder-1", "folderCount": 0, "secretCount": 4},
    ]


def test_the_poll_runs_the_same_queries_however_many_secrets_and_folders():
    _, few = _poll(secret_count=6, folder_count=3)
    _, many = _poll(secret_count=12, folder_count=6)

    assert few == many
    assert not [query for query in many if query.startswith("unexpected")]


def test_a_secret_from_elsewhere_still_looks_its_own_override_up():
    from backend.graphene.types import SecretType

    secret = Secret(id="secret-1", environment=Environment(id="env-1", app=APP))
    override = PersonalSecret(id="override-1", secret=secret, user=MEMBER, value="mine")
    info = MagicMock()
    info.context.user = ME

    with patch(f"{TYPES}.OrganisationMember") as members, patch(
        f"{TYPES}.PersonalSecret"
    ) as overrides:
        members.objects.get.return_value = MEMBER
        overrides.objects.get.return_value = override

        assert SecretType.resolve_override(secret, info) is override

    overrides.objects.get.assert_called_once_with(secret=secret, user=MEMBER)
