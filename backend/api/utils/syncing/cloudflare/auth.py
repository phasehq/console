CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4"


# A function to create headers for Cloudflare API requests.
def get_cloudflare_headers(ACCESS_TOKEN):
    """Prepare headers for Cloudflare API requests."""
    return {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }
