import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0146_agent_event_time_index"),
    ]

    operations = [
        migrations.AddField(
            model_name="agentconnection",
            name="encryption_public_key",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="agentconnection",
            name="key_version",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="agentconnection",
            name="sealed_value",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="agentconnection",
            name="value_revision",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="agentconnection",
            name="value_updated_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="agentconnection",
            name="value_updated_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="agent_connection_values_updated",
                to="api.organisationmember",
            ),
        ),
        migrations.AddField(
            model_name="agentrequest",
            name="action",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="agentrequest",
            name="applied_action",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="agentrequest",
            name="approval",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="agentrequest",
            name="title",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AlterField(
            model_name="agentrequest",
            name="kind",
            field=models.CharField(
                choices=[
                    ("setup", "Setup"),
                    ("credential_update", "Credential update"),
                    ("connection_update", "Connection update"),
                    ("connection_removal", "Connection removal"),
                ],
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name="agentrequest",
            name="markdown",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.CreateModel(
            name="AgentConnectionKeyCopy",
            fields=[
                (
                    "id",
                    models.TextField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "reader_type",
                    models.CharField(
                        choices=[
                            ("server", "Server"),
                            ("agent", "Agent"),
                            ("member", "Member"),
                        ],
                        max_length=16,
                    ),
                ),
                ("key_version", models.PositiveIntegerField()),
                ("wrapped_key", models.TextField()),
                ("wrapped_with", models.CharField(max_length=256)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "agent",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="connection_key_copies",
                        to="api.agent",
                    ),
                ),
                (
                    "connection",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="key_copies",
                        to="api.agentconnection",
                    ),
                ),
                (
                    "member",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="agent_connection_key_copies",
                        to="api.organisationmember",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        condition=models.Q(("reader_type", "server")),
                        fields=("connection",),
                        name="unique_agent_connection_server_key_copy",
                    ),
                    models.UniqueConstraint(
                        condition=models.Q(("agent__isnull", False)),
                        fields=("connection", "agent"),
                        name="unique_agent_connection_agent_key_copy",
                    ),
                    models.UniqueConstraint(
                        condition=models.Q(("member__isnull", False)),
                        fields=("connection", "member"),
                        name="unique_agent_connection_member_key_copy",
                    ),
                ],
            },
        ),
    ]
