from api.emails import send_invite_email, send_scim_provisioned_email
import django_rq


def send_invite_email_job(invite):
    queue = django_rq.get_queue("default")

    queue.enqueue(send_invite_email, invite)


def send_scim_provisioned_email_job(scim_user):
    queue = django_rq.get_queue("default")

    queue.enqueue(send_scim_provisioned_email, scim_user)
