import requests
import graphene
from graphene import ObjectType

from api.utils.syncing.auth import get_credentials

VERCEL_API_BASE_URL = 'https://api.vercel.com'

class VercelProjectType(ObjectType):
    id = graphene.ID(required=True)
    name = graphene.String(required=True)
    environment = graphene.List(graphene.String)


def get_vercel_credentials(credential_id):
    """Get Vercel credentials from the encrypted storage."""
    credentials = get_credentials(credential_id)
    token = credentials.get("api_token")
    return token


def get_vercel_headers(token):
    """Prepare headers for Vercel API requests."""
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


def test_vercel_creds(credential_id):
    """Test if the Vercel credentials are valid."""
    try:
        token = get_vercel_credentials(credential_id)
        url = f'{VERCEL_API_BASE_URL}/v2/user'
        response = requests.get(url, headers=get_vercel_headers(token))
        return response.status_code == 200
    except Exception:
        return False


def list_vercel_projects(credential_id):
    """
    List all Vercel projects accessible with the provided credentials.
    Returns a list of projects with their IDs, names, and available environments.
    """
    try:
        token = get_vercel_credentials(credential_id)
        url = f'{VERCEL_API_BASE_URL}/v9/projects'
        response = requests.get(url, headers=get_vercel_headers(token))
        
        if response.status_code != 200:
            raise Exception(f"Failed to list Vercel projects: {response.text}")
        
        projects = response.json().get('projects', [])
        return [
            {
                "id": project["id"],
                "name": project["name"],
                "environment": ["development", "preview", "production"]
            }
            for project in projects
        ]
    except Exception as e:
        raise Exception(f"Error listing Vercel projects: {str(e)}")


def get_existing_env_vars(token, project_id):
    """Retrieve all environment variables for a specific Vercel project."""
    url = f'{VERCEL_API_BASE_URL}/v9/projects/{project_id}/env'
    response = requests.get(url, headers=get_vercel_headers(token))
    
    if response.status_code != 200:
        raise Exception(f"Error retrieving environment variables: {response.text}")
    
    return {
        env['key']: {
            'id': env['id'],
            'value': env['value'],
            'target': env['target'],
            'comment': env.get('comment'),
        }
        for env in response.json().get('envs', [])
    }


def delete_env_var(token, project_id, env_var_id):
    """Delete a Vercel environment variable using its ID."""
    url = f'{VERCEL_API_BASE_URL}/v9/projects/{project_id}/env/{env_var_id}'
    response = requests.delete(url, headers=get_vercel_headers(token))
    
    if response.status_code != 200:
        raise Exception(f"Error deleting environment variable: {response.text}")


def sync_vercel_secrets(
    secrets,
    credential_id,
    project_id,
    environment="production",
    secret_type="encrypted",
):
    """
    Sync secrets to a Vercel project.
    
    Args:
        secrets (list of tuple): List of (key, value, comment) tuples to sync
        credential_id (str): The ID of the stored credentials
        project_id (str): The Vercel project ID
        environment (str): Target environment (development/preview/production/all)
        secret_type (str): Type of secret (plain/encrypted/sensitive)
    
    Returns:
        tuple: (bool, dict) indicating success/failure and a message
    """
    try:
        token = get_vercel_credentials(credential_id)
        
        # Determine target environments
        target_environments = (
            ['production', 'preview', 'development']
            if environment == 'all'
            else [environment]
        )
        
        # Get existing environment variables
        existing_env_vars = get_existing_env_vars(token, project_id)
        
        # Prepare payload for bulk creation
        payload = []
        for key, value, comment in secrets:
            # Check if the environment variable exists and needs updating
            if key in existing_env_vars:
                existing_var = existing_env_vars[key]
                if (
                    value != existing_var['value']
                    or target_environments != existing_var['target']
                    or comment != existing_var.get('comment')
                ):
                    delete_env_var(token, project_id, existing_var['id'])
            
            env_var = {
                'key': key,
                'value': value,
                'type': secret_type,
                'target': target_environments,
            }
            if comment:
                env_var['comment'] = comment
            payload.append(env_var)
        
        # Delete environment variables not in the source
        for key, env_var in existing_env_vars.items():
            if not any(s[0] == key for s in secrets):
                delete_env_var(token, project_id, env_var['id'])
        
        # Bulk create environment variables
        if payload:
            url = f'{VERCEL_API_BASE_URL}/v10/projects/{project_id}/env?upsert=true'
            response = requests.post(
                url, headers=get_vercel_headers(token), json=payload
            )
            
            if response.status_code != 201:
                raise Exception(f"Error creating environment variables: {response.text}")
        
        return True, {
            "message": f"Successfully synced secrets to Vercel project environments: {', '.join(target_environments)}"
        }
    
    except Exception as e:
        return False, {"message": f"Failed to sync secrets: {str(e)}"}
