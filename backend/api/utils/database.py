from django.db import connection
import re
import logging

logger = logging.getLogger(__name__)


def get_approximate_count(queryset, threshold=10000):
    """
    Get approximate count using PostgreSQL statistics for better performance.
    Falls back to exact count for smaller datasets.

    Args:
        queryset: Django QuerySet to count
        threshold: Use exact count if estimate is below this value (default: 10000)

    Returns:
        int: Estimated or exact row count
    """

    try:
        with connection.cursor() as cursor:
            sql, params = queryset.query.sql_with_params()
            cursor.execute(f"EXPLAIN {sql}", params)
            result = cursor.fetchall()

            for row in result:
                row_str = str(row[0])
                if "rows=" in row_str:
                    match = re.search(r"rows=(\d+)", row_str)
                    if match:
                        estimated_count = int(match.group(1))
                        # For small datasets, get exact count for accuracy
                        if estimated_count < threshold:
                            return queryset.count()
                        return estimated_count
    except Exception as e:
        logger.info(
            f"Failed to get approximate count, falling back to exact count: {str(e)}"
        )

    return queryset.count()
