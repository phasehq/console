import requests
import graphene

from api.utils.syncing.auth import get_credentials


class RailwayServiceType(graphene.ObjectType):
    id = graphene.ID(required=True)
    name = graphene.String(required=True)


class RailwayEnvironmentType(graphene.ObjectType):
    id = graphene.ID(required=True)
    name = graphene.String(required=True)
    project_id = graphene.ID(required=True)


class RailwayProjectType(graphene.ObjectType):
    id = graphene.ID(required=True)
    name = graphene.String(required=True)
    environments = graphene.List(
        graphene.NonNull(RailwayEnvironmentType), required=True
    )
    services = graphene.List(graphene.NonNull(RailwayServiceType), required=True)


RAILWAY_API_URL = "https://backboard.railway.app/graphql/v2"


def get_headers(api_token):
    return {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}


def fetch_railway_projects(credential_id):
    credentials = get_credentials(credential_id)
    api_token = credentials.get("api_token")

    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }

    query = """
    query {
        projects {
            edges {
                node {
                    id
                    name
                    environments {
                      edges {
                        node {
                          id
                          name
                        }
                      }
                    }
                  services {
                    edges {
                      node {
                        id 
                        name
                      }
                    }
                  }
                }
            }
        }
    }
    """

    response = requests.post(RAILWAY_API_URL, json={"query": query}, headers=headers)
    response.raise_for_status()
    data = response.json()

    if "errors" in data:
        raise Exception(data["errors"])

    projects = []
    for edge in data["data"]["projects"]["edges"]:
        project = edge["node"]
        environments = [
            env_edge["node"] for env_edge in project["environments"]["edges"]
        ]
        services = [env_edge["node"] for env_edge in project["services"]["edges"]]
        project["environments"] = environments
        project["services"] = services
        projects.append(project)

    return projects


def create_environment(name, api_token):
    headers = get_headers(api_token)

    mutation = """
    mutation($name: String!) {
        createEnvironment(input: { name: $name }) {
            environment {
                id
                name
            }
        }
    }
    """
    variables = {"name": name}
    response = requests.post(
        RAILWAY_API_URL,
        json={"query": mutation, "variables": variables},
        headers=headers,
    )
    response.raise_for_status()
    data = response.json()

    if "errors" in data:
        raise Exception(data["errors"])

    environment = data["data"]["createEnvironment"]["environment"]
    return environment


def sync_railway_secrets(
    secrets, credential_id, project_id, railway_environment_id, service_id=None
):

    try:
        credentials = get_credentials(credential_id)
        api_token = credentials.get("api_token")

        headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
            "Accept-Encoding": "application/json",
        }

        # Prepare the secrets to the format expected by Railway
        formatted_secrets = {k: v for k, v, _ in secrets}

        # Build the mutation query
        mutation = """
        mutation UpsertVariables($input: VariableCollectionUpsertInput!) {
            variableCollectionUpsert(input: $input)
        }
        """
        variables = {
            "input": {
                "projectId": project_id,
                "environmentId": railway_environment_id,
                "replace": True,
                "variables": formatted_secrets,
            }
        }

        # Optionally add serviceId if provided
        if service_id:
            variables["input"]["serviceId"] = service_id

        # Make the request to Railway API
        response = requests.post(
            RAILWAY_API_URL,
            json={"query": mutation, "variables": variables},
            headers=headers,
        )

        data = response.json()

        response.raise_for_status()

        if "errors" in data:
            raise Exception(data["errors"])

        else:
            return True, {
                "response_code": response.status_code,
                "message": "Successfully synced secrets.",
            }

    except Exception as e:
        return False, {"message": f"Error syncing secrets: {str(e)}"}
