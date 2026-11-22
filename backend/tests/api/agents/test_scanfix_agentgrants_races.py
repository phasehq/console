"""A member revokes a grant while another approves the Agent's request to renew
it: the revoke stays in force whichever of the two commits first.

Each side runs in its own thread and database connection, and is held by a stub
at the point where the other side has to wait for it.
"""

import threading
import time

import pytest
from django.db import connection as db_connection
from django.db import connections
from graphql import GraphQLError

import api.utils.agent_access as agent_access
import api.utils.request_actions.agent_grants as agent_grants
from api.models import AgentWorkflowGrant
from backend.graphene.agents.mutations import (
    ApproveAgentRequestActionMutation,
    RevokeAgentWorkflowGrantMutation,
)

from .custom_connections import (
    agent_client,
    ask,
    custom_connection,
    filed,
    grant,
    open_session,
    use_test_server_keypair,
    workspace,
)


def _renewal_pending(monkeypatch, label):
    use_test_server_keypair(monkeypatch)
    space = workspace(label)
    client, _ = agent_client(space)
    open_session(client, space.workflow)
    space.connection = custom_connection(space)
    space.granted = grant(space, space.connection)
    space.request = filed(
        ask(
            client,
            durationSeconds=3600,
            action={
                "type": "agent_grant.renew",
                "version": 1,
                "connectionId": str(space.connection.id),
            },
        )
    )
    return space


class _Side(threading.Thread):
    """One member's mutation in its own connection, with its backend id known
    before it starts, so the other side can see when it waits on a lock."""

    def __init__(self, work):
        super().__init__(daemon=True)
        self.work = work
        self.backend = None
        self.started_work = threading.Event()
        self.outcome = None

    def run(self):
        try:
            with db_connection.cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                self.backend = cursor.fetchone()[0]
            self.started_work.set()
            self.work()
            self.outcome = "done"
        except GraphQLError as exc:
            self.outcome = f"refused: {exc}"
        except Exception as exc:  # noqa: BLE001 - kept for the assertion
            self.outcome = f"failed: {exc!r}"
        finally:
            self.started_work.set()
            connections.close_all()


def _waits_on_a_lock(side, timeout=10):
    assert side.started_work.wait(15) and side.backend is not None, side.outcome
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with db_connection.cursor() as cursor:
            cursor.execute(
                "SELECT 1 FROM pg_locks WHERE pid = %s AND NOT granted", [side.backend]
            )
            if cursor.fetchone():
                return True
        if not side.is_alive():
            return False
        time.sleep(0.05)
    return False


def _approve(space):
    return lambda: ApproveAgentRequestActionMutation.mutate(
        None,
        space.info,
        request_id=space.request.id,
        expected_revision=str(space.request.revision),
    )


def _revoke(space):
    return lambda: RevokeAgentWorkflowGrantMutation.mutate(
        None, space.info, grant_id=space.granted.id
    )


def _in_force(space):
    return AgentWorkflowGrant.objects.active().filter(
        workflow=space.workflow, connection=space.connection
    )


@pytest.mark.django_db(transaction=True)
def test_a_revoke_committing_during_a_renewal_approval_stays_in_force(monkeypatch):
    space = _renewal_pending(monkeypatch, "race-revoke-first")
    holding, release = threading.Event(), threading.Event()
    real_prune = agent_access.prune_agent_key_copies

    def held_with_the_grant_locked(connection_ids):
        # The revoke has ended the grant and holds its row, not yet committed.
        if threading.current_thread() is revoker:
            holding.set()
            release.wait(15)
        return real_prune(connection_ids)

    monkeypatch.setattr(
        agent_access, "prune_agent_key_copies", held_with_the_grant_locked
    )
    revoker = _Side(_revoke(space))
    approver = _Side(_approve(space))

    revoker.start()
    assert holding.wait(15), revoker.outcome
    approver.start()
    waited = _waits_on_a_lock(approver)
    release.set()
    revoker.join(30)
    approver.join(30)

    assert waited, approver.outcome
    assert revoker.outcome == "done", revoker.outcome
    assert approver.outcome.startswith("refused") and "removed this access" in (
        approver.outcome
    ), approver.outcome
    assert not _in_force(space).exists()


@pytest.mark.django_db(transaction=True)
def test_a_revoke_made_during_a_renewal_approval_ends_the_renewed_grant(monkeypatch):
    space = _renewal_pending(monkeypatch, "race-approval-first")
    checked, release = threading.Event(), threading.Event()
    real_grant = agent_grants.grant_connection_access

    def held_after_the_check(*args, **kwargs):
        # The approval has checked for a revocation and holds the grant.
        checked.set()
        release.wait(15)
        return real_grant(*args, **kwargs)

    monkeypatch.setattr(agent_grants, "grant_connection_access", held_after_the_check)
    approver = _Side(_approve(space))
    revoker = _Side(_revoke(space))

    approver.start()
    assert checked.wait(15), approver.outcome
    revoker.start()
    waited = _waits_on_a_lock(revoker)
    release.set()
    approver.join(30)
    revoker.join(30)

    assert waited, revoker.outcome
    assert approver.outcome == "done", approver.outcome
    assert revoker.outcome == "done", revoker.outcome
    assert not _in_force(space).exists()
