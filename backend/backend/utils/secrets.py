import os
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

def get_secret(key: str) -> str:
    """
    Retrieve secrets from either files or environment variables. Implements a "secrets provider" pattern 
    commonly used in containerized applications.
    
    1. Check if {key}_FILE exists as an environment variable (e.g. PGSQL_PASSWORD_FILE)
        - If it exists, read the secret from that file location
        - This supports Docker/Kubernetes secrets (https://docs.docker.com/reference/compose-file/secrets)
    2. Fall back to checking if {key} exists as a regular environment variable
    
    Example:
        # Using file-based secret:
        DATABASE_PASSWORD_FILE=/run/secrets/db_password
        get_secret('DATABASE_PASSWORD')  # reads from /run/secrets/db_password
        
        # Using environment variable:
        DATABASE_PASSWORD=ebeefa2b4634ab18b0280c96fce1adc5969dcad133cce440353b5ed1a7387f0a
        get_secret('DATABASE_PASSWORD')  # returns 'ebeefa2b4634ab18b0280c96fce1adc5969dcad133cce440353b5ed1a7387f0a'
    
    Args:
        key: Name of the secret to retrieve (e.g. 'DATABASE_PASSWORD')
    
    Returns:
        str: The secret value or empty string if not found
    """

    debug_mode = os.getenv('DEBUG', 'False').lower() == 'true'
    
    file_env_key = f"{key}_FILE"
    file_path = os.getenv(file_env_key)
    
    if file_path:
        path = Path(file_path)
        if path.exists():
            try:
                secret = path.read_text().strip()
                if debug_mode:
                    logger.debug(f"Loaded secret '{key}' from file: {file_path}")
                return secret
            except (PermissionError, OSError) as e:
                if debug_mode:
                    logger.debug(f"Failed to read secret file for '{key}': {e}")
        elif debug_mode:
            logger.debug(f"File path specified for '{key}' but file not found: {file_path}")
            
    secret = os.getenv(key, '')
    if debug_mode:
        if secret:
            logger.debug(f"Loaded secret '{key}' from environment variable")
        else:
            logger.debug(f"Secret '{key}' not found in environment or file")
            
    return secret
