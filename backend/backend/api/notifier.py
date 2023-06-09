import requests
from django.conf import settings


def notify_slack(message):
    url = settings.SLACK_WEBHOOK_URI

    headers = {
        "Content-Type": "application/json",
    }

    payload = {
        "text": message
    }

    response = requests.request("POST", url, headers=headers, json=payload)

    if response.status_code == 200:
        return True
    print('Error pushing notification to Slack:', response)
    return False
