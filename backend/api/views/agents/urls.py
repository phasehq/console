from django.urls import path

from api.views.agents.views import (
    AgentIdentityView,
    AgentRequestCollectionView,
    AgentRequestCancelView,
    AgentRequestDetailView,
    AgentSessionCollectionView,
    AgentSessionCapabilitiesView,
    AgentSessionConfigView,
    AgentSessionContextView,
    AgentSessionDiscoverView,
    AgentSessionRevokeView,
    AgentSessionRotateView,
)
from api.views.agents.management import (
    AgentCollectionView,
    AgentRegistryView,
    AgentTokenCreateView,
)
from api.views.agents.events import AgentSessionEventsView


urlpatterns = [
    path("", AgentCollectionView.as_view(), name="agents"),
    path("identity/", AgentIdentityView.as_view(), name="agent-identity"),
    path("registry/", AgentRegistryView.as_view(), name="agent-registry"),
    path(
        "<str:agent_id>/tokens/",
        AgentTokenCreateView.as_view(),
        name="agent-token-create",
    ),
    path("sessions/", AgentSessionCollectionView.as_view(), name="agent-sessions"),
    path(
        "sessions/<str:session_uid>/capabilities/",
        AgentSessionCapabilitiesView.as_view(),
        name="agent-session-capabilities",
    ),
    path(
        "sessions/<str:session_uid>/config/",
        AgentSessionConfigView.as_view(),
        name="agent-session-config",
    ),
    path(
        "sessions/<str:session_uid>/events/",
        AgentSessionEventsView.as_view(),
        name="agent-session-events",
    ),
    path(
        "sessions/<str:session_uid>/context/",
        AgentSessionContextView.as_view(),
        name="agent-session-context",
    ),
    path(
        "sessions/<str:session_uid>/discover/",
        AgentSessionDiscoverView.as_view(),
        name="agent-session-discover",
    ),
    path(
        "sessions/<str:session_uid>/revoke/",
        AgentSessionRevokeView.as_view(),
        name="agent-session-revoke",
    ),
    path(
        "sessions/<str:session_uid>/rotate/",
        AgentSessionRotateView.as_view(),
        name="agent-session-rotate",
    ),
    path("requests/", AgentRequestCollectionView.as_view(), name="agent-requests"),
    path(
        "requests/<str:request_id>/cancel/",
        AgentRequestCancelView.as_view(),
        name="agent-request-cancel",
    ),
    path(
        "requests/<str:request_id>/",
        AgentRequestDetailView.as_view(),
        name="agent-request-detail",
    ),
]
