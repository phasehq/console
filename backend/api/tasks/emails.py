from api.emails import (
    send_invite_email,
    send_rotation_unhealthy_email,
    send_scim_provisioned_email,
)
import django_rq


def send_invite_email_job(invite):
    queue = django_rq.get_queue("default")

    queue.enqueue(send_invite_email, invite)


def send_scim_provisioned_email_job(scim_user):
    queue = django_rq.get_queue("default")

    queue.enqueue(send_scim_provisioned_email, scim_user)


def send_rotation_unhealthy_email_job(rotating_secret_id):
    """Enqueue an unhealthy-rotation notification. Takes the id (not the
    instance) so the worker re-fetches fresh state and resolves recipients
    at delivery time — role / membership / health may have changed between
    enqueue and run."""
    queue = django_rq.get_queue("default")
    queue.enqueue(send_rotation_unhealthy_email, rotating_secret_id)
