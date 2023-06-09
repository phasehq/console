from datetime import datetime

from django.db import DatabaseError

from logs.dynamodb_models import KMSLog

PAGE_SIZE = 25

def get_app_logs(app_id, start, end, limit):
    """
    Get logs for a given app id within a specified time period

    Args:
        app_id (string): the app_id
        start (int): The start of the time period as a unix timestamp in ms.
        end (int): The end of the time period as a unix timestamp in ms.
        limit (int): The limit for number of items to fetch.

    Returns:
        List[KMSLog]: list of log entries
    """

    try:
        return [log.attribute_values for log in KMSLog.timestamp_index.query(app_id, KMSLog.timestamp.between(start, end), limit=limit, scan_index_forward=False)] 
    except Exception as e:
        print(e)
        raise DatabaseError('Error fetching logs. Please try again later.')

def get_app_log_count(app_id):
    """
    Get the count of total logs for the given app.

    Args:
        app_id (string): app_id

    Returns:
        number: Count of total logs for this app
    """
    try:
        return KMSLog.timestamp_index.count(app_id)
    except Exception as e:
        print(e)
        raise DatabaseError('Error fetching logs. Please try again later.')

def get_app_log_count_range(app_id, start, end):
    """
    Get the count of total logs for the given app in a specific time range.

    Args:
        app_id (string): app_id

    Returns:
        number: Count of total logs for this app
    """
    try:
        return KMSLog.timestamp_index.count(app_id, KMSLog.timestamp.between(start, end))
    except Exception as e:
        print(e)
        raise DatabaseError('Error fetching logs. Please try again later.')
