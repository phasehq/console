import os


def get_prices(env_var):
    val = os.getenv(env_var, "")
    return [p.strip() for p in val.split(",") if p.strip()]


STRIPE = {}
try:
    STRIPE["secret_key"] = os.getenv("STRIPE_SECRET_KEY")
    STRIPE["public_key"] = os.getenv("STRIPE_PUBLIC_KEY")
    STRIPE["webhook_secret"] = os.getenv("STRIPE_WEBHOOK_SECRET")

    STRIPE["prices"] = {
        "free": get_prices("STRIPE_FREE"),
        "pro_monthly": get_prices("STRIPE_PRO_MONTHLY"),
        "pro_yearly": get_prices("STRIPE_PRO_YEARLY"),
        "enterprise_monthly": get_prices("STRIPE_ENTERPRISE_MONTHLY"),
        "enterprise_yearly": get_prices("STRIPE_ENTERPRISE_YEARLY"),
    }
except:
    pass
