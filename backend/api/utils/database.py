from django.db import connection


def get_approximate_count(queryset):
    """
    Get approximate count using PostgreSQL statistics for better performance.
    Falls back to exact count if estimation fails.
    """
    import re

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
                        return int(match.group(1))
    except Exception:
        pass

    return queryset.count()
