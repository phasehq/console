from api.emails import send_invite_email
import django_rq


def send_invite_email_job(invite):
    queue = django_rq.get_queue("default")

    queue.enqueue(send_invite_email, invite)
