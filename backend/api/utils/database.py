from django.db import connection
import re
import logging

logger = logging.getLogger(__name__)


def get_approximate_count(queryset, threshold=10000):
    """
    Estimate the row count of a Django queryset using PostgreSQL EXPLAIN (FORMAT JSON).

    For large result sets, this avoids the expensive COUNT(*) by reading the planner's
    estimated row count directly from PostgreSQL's query plan. For smaller result sets
    (below `threshold`), this falls back to an exact `.count()` for accuracy.

    Args:
        queryset (QuerySet): The Django queryset to estimate count for.
        threshold (int, optional): Maximum estimated row count at which an exact
            .count() will still be used. Defaults to 10,000.

    Returns:
        int: Estimated or exact count of rows in the queryset.

    Notes:
        - This performs one lightweight EXPLAIN query, which is typically much faster
          than a full COUNT(*) on large tables.
        - If EXPLAIN fails for any reason, the function safely falls back to exact count.
        - Uses PostgreSQL's JSON-formatted query plan instead of parsing string output.
    """
    try:
        with connection.cursor() as cursor:
            sql, params = queryset.query.sql_with_params()
            cursor.execute(f"EXPLAIN (FORMAT JSON) {sql}", params)
            plan = cursor.fetchone()[0][0]  # first element of EXPLAIN JSON array
            estimated_count = int(plan["Plan"]["Plan Rows"])

            if estimated_count < threshold:
                return queryset.count()

            return estimated_count
    except Exception as e:
        logger.info(
            f"Failed to get approximate count, falling back to exact count: {e}"
        )

    return queryset.count()
