import json
import requests
import graphene
from graphene import ObjectType
from .auth import CLOUDFLARE_API_BASE_URL, get_cloudflare_headers


class CloudFlarePagesType(ObjectType):
    name = graphene.String()
    deployment_id = graphene.String()
    environments = graphene.List(graphene.String)


# Function to list all Cloudflare pages. This is a straightforward API call
# that prints out details of all pages/projects within the Cloudflare account.
def list_cloudflare_pages(ACCOUNT_ID, ACCESS_TOKEN):
    """List all Cloudflare pages."""
    url = f"{CLOUDFLARE_API_BASE_URL}/accounts/{ACCOUNT_ID}/pages/projects"
    response = requests.get(url, headers=get_cloudflare_headers(ACCESS_TOKEN))
    if response.status_code == 200:
        projects = response.json().get("result", [])

        cf_projects = []

        for project in projects:
            cf_projects.append(
                {
                    "name": project["name"],
                    "deployment_id": project["id"],
                    "environments": project.get(
                        "environments", ["production", "preview"]
                    ),
                }
            )
        return cf_projects

    elif response.status_code == 401 or response.status_code == 403:
        raise Exception("Incorrect credentials")

    else:
        print("Error in listing Cloudflare pages:", response.text)
