"""Request actions that change an Agent Workflow itself."""

import hashlib

from django.utils import timezone

from api.models import AgentRequest, AgentWorkflow
from api.utils.access.permissions import account_can_access_workflow

from . import (
    ActionError,
    ActionHandler,
    AppliedAction,
    contains_credential_text,
    fit_title,
    register,
)
from .agent_connections import _inputs, _members


MAX_CONTEXT_LENGTH = 16384
_MAX_DISPLAY_NAME_LENGTH = 64


def validate_workflow_context(markdown):
    """Check a Workflow's context text, from a member or from a request."""

    if not isinstance(markdown, str) or "\x00" in markdown:
        raise ActionError(
            "The Workflow context must be text.", code="invalid_workflow_context"
        )
    if len(markdown) > MAX_CONTEXT_LENGTH:
        raise ActionError(
            f"The Workflow context must contain at most {MAX_CONTEXT_LENGTH} "
            "characters.",
            code="invalid_workflow_context",
        )
    # It is read by Agents and shown to members in the clear.
    if contains_credential_text(markdown):
        raise ActionError(
            "The Workflow context must not contain credential-shaped values.",
            code="credential_in_workflow_context",
        )
    return markdown


def set_workflow_context(workflow, markdown, member):
    """Store checked context text on a locked Workflow row."""

    workflow.context_markdown = markdown
    workflow.context_updated_at = timezone.now()
    workflow.context_updated_by = member
    workflow.save(
        update_fields=[
            "context_markdown",
            "context_updated_at",
            "context_updated_by",
            "updated_at",
        ]
    )


def _digest(text):
    return hashlib.blake2b(text.encode(), digest_size=16).hexdigest()


class UpdateWorkflowContext(ActionHandler):
    """Replace the context text of the requesting session's own Workflow."""

    type = "agent_workflow.context_update"
    kind = AgentRequest.CONTEXT_UPDATE
    target_resource = "AgentWorkflows"

    def validate(self, request, action, member):
        _members(action, required=("markdown",))
        checked = {
            "type": self.type,
            "version": action["version"],
            "markdown": validate_workflow_context(action["markdown"]),
        }
        if request._state.adding:
            workflow = request.workflow
            request.credential_name = workflow.name[:_MAX_DISPLAY_NAME_LENGTH]
            request.progress = {
                **(request.progress or {}),
                # The requested text replaces the whole context, so it only
                # holds against the text it was written from.
                "baseline_context": _digest(workflow.context_markdown),
            }
        return checked

    def describe(self, request, action, member, view=None):
        return {
            "type": self.type,
            "title": fit_title(f"Update the context of {request.workflow.name}"),
            "requiresSecret": False,
            "current": {"markdown": request.workflow.context_markdown},
            "requested": {"markdown": action["markdown"]},
        }

    def check_approver(self, request, member):
        if not account_can_access_workflow(member, request.workflow, "update"):
            raise ActionError(
                "You don't have permission to update this Workflow", code="forbidden"
            )

    def apply(self, request, action, member, inputs):
        _inputs(inputs)
        try:
            workflow = (
                AgentWorkflow.objects.select_for_update(of=("self",))
                .select_related("agent")
                .get(id=request.workflow_id, deleted_at__isnull=True)
            )
        except AgentWorkflow.DoesNotExist as exc:
            raise ActionError("The Agent Workflow was deleted") from exc
        if not account_can_access_workflow(member, workflow, "update"):
            raise ActionError(
                "You don't have permission to update this Workflow", code="forbidden"
            )
        if _digest(workflow.context_markdown) != (request.progress or {}).get(
            "baseline_context"
        ):
            raise ActionError(
                "The Workflow context changed after this request was made; "
                "start a new request"
            )
        set_workflow_context(workflow, action["markdown"], member)
        request.workflow = workflow
        return AppliedAction(action=action, runtime_action="retry")


register(UpdateWorkflowContext())
