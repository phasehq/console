from api.models import App, Organisation


def allow_new_app(organisation):
    """
    Feature gate to enforce app limits based on account license

    Args:
        organisation (Organisation): The organisation for which to check the license 

    Returns:
        bool: Whether or not to allow creating an app for the given org
    """
    FREE_APP_LIMIT = 3
    PRO_APP_LIMIT = 10

    current_app_count = App.objects.filter(
        organisation=organisation, is_deleted=False).count()

    if organisation.plan == Organisation.FREE_PLAN and current_app_count >= FREE_APP_LIMIT:
        return False
    elif organisation.plan == Organisation.PRO_PLAN and current_app_count >= PRO_APP_LIMIT:
        return False
    return True
