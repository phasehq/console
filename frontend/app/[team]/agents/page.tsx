'use client'

import { use, useContext, useMemo } from 'react'
import { useQuery } from '@apollo/client'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { userHasOrganisationAgentPermission } from '@/utils/access/agents'
import { GetAgents } from '@/graphql/queries/agents/getAgents.gql'
import { GetAgentMesh } from '@/graphql/queries/agents/getAgentMesh.gql'
import { GetAgentAssets } from '@/graphql/queries/agents/getAgentAssets.gql'
import { GetAgentRequestMesh } from '@/graphql/queries/agents/getAgentRequestMesh.gql'
import { AgentMesh, type AgentMeshPermissions } from '@/components/agents/AgentMesh'
import { buildMeshModel } from '@/components/agents/AgentMeshUtils'
import { CreateAgentDialog } from '@/components/agents/AgentDialogs'
import {
  AgentEmpty,
  AgentError,
  AgentMeshSkeleton,
  AgentPageHeader,
} from '@/components/agents/AgentUI'

export default function AgentsOverviewPage(props: { params: Promise<{ team: string }> }) {
  const params = use(props.params)
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const permissions = organisation?.role?.permissions
  const canReadConnections =
    !!permissions && userHasPermission(permissions, 'AgentConnections', 'read')
  const canReadRequests = !!permissions && userHasPermission(permissions, 'AgentRequests', 'read')
  const canCreateConnection =
    !!permissions &&
    userHasPermission(permissions, 'AgentConnections', 'create') &&
    userHasPermission(permissions, 'IntegrationCredentials', 'read')
  const canCreateOrganisationAgent =
    !!organisation && userHasOrganisationAgentPermission(organisation, 'create')
  const canCreateTokens = !!permissions && userHasPermission(permissions, 'AgentTokens', 'create')

  const canCreateAgent = canCreateOrganisationAgent

  const agentsQuery = useQuery(GetAgents, {
    variables: { organisationId: organisation?.id },
    skip: !organisation?.id,
    fetchPolicy: 'cache-and-network',
  })
  // Workflow grants are the mesh edges. Workflow and grant mutations refetch
  // GetAgentDetail by name, which is not mounted here; canvas dialogs bridge
  // that via onDone → refetch, and polling covers changes made elsewhere.
  const meshQuery = useQuery(GetAgentMesh, {
    variables: { organisationId: organisation?.id },
    skip: !organisation?.id,
    fetchPolicy: 'cache-and-network',
    pollInterval: 10000,
  })
  const assetsQuery = useQuery(GetAgentAssets, {
    variables: {
      organisationId: organisation?.id,
      includeConnections: canReadConnections,
      includeServiceTemplates: canReadConnections,
    },
    skip: !organisation?.id || !canReadConnections,
    fetchPolicy: 'cache-and-network',
  })
  const requestsQuery = useQuery(GetAgentRequestMesh, {
    variables: {
      organisationId: organisation?.id,
    },
    skip: !organisation?.id || !canReadRequests,
    fetchPolicy: 'cache-and-network',
    pollInterval: 10000,
  })

  const model = useMemo(
    () =>
      buildMeshModel({
        agents: (agentsQuery.data?.agents || []).filter(Boolean).map((agent: any) => ({
          id: agent.id,
          name: agent.name,
          harnessType: agent.harnessType,
          status: agent.status,
          lastSeenAt: agent.lastSeenAt,
          activeSessionCount: agent.activeSessionCount,
          canMintToken: canCreateTokens && (agent.viewerWorkflowIds?.length ?? 0) > 0,
        })),
        workflows: (meshQuery.data?.agentWorkflows || []).filter(Boolean).map((workflow: any) => ({
          id: workflow.id,
          name: workflow.name,
          agentId: workflow.agent.id,
          grants: (workflow.grants || []).filter(Boolean),
        })),
        connections: (assetsQuery.data?.agentConnections || []).filter(Boolean),
        requests: (requestsQuery.data?.agentRequests || []).filter(Boolean),
      }),
    [
      canCreateTokens,
      agentsQuery.data,
      meshQuery.data,
      assetsQuery.data,
      requestsQuery.data,
    ]
  )

  const services = (assetsQuery.data?.agentServiceTemplates || []).filter(Boolean)

  const loading =
    (agentsQuery.loading && !agentsQuery.data) || (meshQuery.loading && !meshQuery.data)
  const error = agentsQuery.error || meshQuery.error

  // Organisation context resolves before any permission or data checks so we
  // never flash restricted/empty states while the session is still loading.
  // The real page header renders in every state so content never jumps.
  if (!organisation || loading)
    return (
      <div className="space-y-5">
        <AgentPageHeader
          title="Overview"
          description="Agents, their workflows, and the credential-backed Connections they can use."
        />
        <AgentMeshSkeleton />
      </div>
    )
  if (error)
    return (
      <AgentError
        message={error.message}
        retry={() => {
          agentsQuery.refetch()
          meshQuery.refetch()
        }}
      />
    )

  const meshPermissions: AgentMeshPermissions = {
    canCreateAgent,
    canReadConnections,
    canCreateConnection,
  }

  const graphEmpty = model.agents.length === 0 && model.connections.length === 0

  return (
    <div className="space-y-5">
      <AgentPageHeader
        title="Overview"
        description="Agents, their workflows, and the credential-backed Connections they can use."
      />
      {graphEmpty ? (
        <AgentEmpty
          title="Nothing on the canvas yet"
          subtitle="Create an Agent, then grant a credential-backed Connection to its workflow."
        >
          {canCreateAgent && organisation?.id ? (
            <CreateAgentDialog
              organisationId={organisation.id}
              onCreated={() => meshQuery.refetch()}
            />
          ) : (
            <></>
          )}
        </AgentEmpty>
      ) : organisation?.id ? (
        <AgentMesh
          organisationId={organisation.id}
          team={params.team}
          model={model}
          services={services}
          permissions={meshPermissions}
          onGraphChange={() => meshQuery.refetch()}
        />
      ) : null}
    </div>
  )
}
