"""What `migrate` schedules. It runs before the new workers of a release
exist, so a job it schedules can be taken by an old worker."""

from unittest.mock import patch

from django.apps import apps

from api import config


def test_migrate_does_not_schedule_the_sweeps_or_the_session_purge():
    api = apps.get_app_config("api")

    with patch.object(config.post_migrate, "connect") as connect:
        api.ready()

    # The workers schedule the rest when they start: see the rqworker command.
    assert [call.args[0].__name__ for call in connect.call_args_list] == [
        "validate_licenses_post_migrate",
        "init_log_streams_post_migrate",
    ]
    assert all(call.kwargs == {"sender": api} for call in connect.call_args_list)
