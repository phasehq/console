"""0148: each App's production environment becomes its primary one, as the
editor compared every environment with it before."""

import importlib
from unittest.mock import MagicMock

migration = importlib.import_module("api.migrations.0148_environment_is_primary")


def test_the_first_production_environment_of_each_app_becomes_primary():
    model = MagicMock()
    # Ordered by app, then place: an App with two production environments keeps the first
    model.objects.filter.return_value.order_by.return_value.values_list.return_value = [
        ("prod-a", "app-a"),
        ("prod-a2", "app-a"),
        ("live-b", "app-b"),
    ]
    apps = MagicMock()
    apps.get_model.return_value = model

    migration.designate_production(apps, None)

    found = model.objects.filter.call_args_list[0].kwargs
    assert found == {"env_type__iexact": "prod", "deleted_at__isnull": True}
    ordered = model.objects.filter.return_value.order_by.call_args.args
    assert ordered == ("app_id", "index", "created_at")
    marked = model.objects.filter.call_args_list[1].kwargs["id__in"]
    assert marked == ["prod-a", "live-b"]
    model.objects.filter.return_value.update.assert_called_once_with(is_primary=True)
