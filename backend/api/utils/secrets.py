from django.db import transaction

from api.models import Environment, SecretFolder, Secret


def create_environment_folder_structure(complete_path, environment_id):
    """
    Correctly creates a nested folder structure based on a given the complete_path within a specified environment.

    Parameters:
    - complete_path (str): The complete path string representing the nested folder structure to create.
    - environment_id (int): The ID of the `Environment` instance where the folder structure will be created.

    Returns:
    - SecretFolder: The last `SecretFolder` instance created or retrieved, representing the deepest
                    level in the provided path structure.
    """
    # Ensure the path_segments list does not include empty segments caused by leading or trailing slashes
    path_segments = [segment for segment in complete_path.split("/") if segment]

    current_folder = None
    # The initial current_path should correctly represent the root
    current_path = "/"

    environment = Environment.objects.get(id=environment_id)

    with transaction.atomic():
        for i, segment in enumerate(path_segments):
            # For each folder except the first, the path includes its parent's name
            # For the first segment, current_path should remain "/" as its location

            if i > 0:
                current_path += (
                    f"/{path_segments[i-1]}"
                    if current_path != "/"
                    else path_segments[i - 1]
                )

            # Check if the folder already exists at the current path and with the given name
            folder, _ = SecretFolder.objects.get_or_create(
                name=segment,
                environment=environment,
                folder=current_folder,
                path=current_path,
            )

            # Update the current_folder to the folder that was just created or found
            current_folder = folder

    return current_folder


def normalize_path_string(path):
    """
    Ensures the given string is a valid path string following specific rules.

    Args:
    - path (str): The input string to be normalized as a path.

    Returns:
    - str: The normalized path string.
    """
    if path == "/":
        return path

    # Ensure the string doesn't contain repeated "/"s
    while "//" in path:
        path = path.replace("//", "/")

    # Ensure the string has a leading "/"
    if not path.startswith("/"):
        path = "/" + path

    # Remove trailing slash if present
    if path.endswith("/"):
        path = path[:-1]

    return path


def check_for_duplicates(secrets):
    """
    Checks if a list of secrets contains any duplicates internally or in the target env + path.

    Args:
        secrets (List[Dict]): The list of secrets to check for duplicates.

    Returns:
        bool: True if a duplicate is found, False otherwise.
    """
    processed_secrets = set()  # Set to store processed secrets

    for secret in secrets:
        try:
            path = normalize_path_string(secret["path"])
        except:
            path = "/"

        # Check if the secret is already processed
        if (path, secret["keyDigest"]) in processed_secrets:
            return True  # Found a duplicate within the list

        # Check if the secret already exists in the database
        if Secret.objects.filter(
            environment="env", path=path, key_digest=secret["keyDigest"]
        ).exists():
            return True  # Found a duplicate in the database

        # Add the processed secret to the set
        processed_secrets.add((path, secret["keyDigest"]))

    return False  # No duplicates found
