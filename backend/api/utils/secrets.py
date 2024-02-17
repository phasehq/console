from django.db import transaction

from api.models import Environment, SecretFolder


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
