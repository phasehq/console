from django.core.management.base import BaseCommand
from faker import Faker
from django.contrib.auth import get_user_model
from api.models import Organisation, OrganisationMember, Role  # Adjust as needed
from allauth.socialaccount.models import SocialAccount

fake = Faker()

class Command(BaseCommand):
    help = "Create dummy users and associate them with an existing organisation"

    def add_arguments(self, parser):
        parser.add_argument("--count", type=int, default=50)
        parser.add_argument("--org", type=str, required=True, help="Name of the organisation to assign users to")
        parser.add_argument("--domain", type=str, default="example.org", help="Domain name for user emails (e.g. 'example.org')")

    def handle(self, *args, **options):
        count = options["count"]
        org_name = options["org"]
        domain = options["domain"]

        User = get_user_model()

        try:
            org = Organisation.objects.get(name=org_name)
        except Organisation.DoesNotExist:
            self.stderr.write(self.style.ERROR(f"Organisation '{org_name}' does not exist."))
            return

        original_member = OrganisationMember.objects.filter(organisation=org).first()
        if not original_member:
            self.stderr.write(self.style.ERROR(f"No existing organisation member found in '{org_name}'."))
            return

        try:
            role = Role.objects.get(organisation=org, name__iexact="developer")
        except Role.DoesNotExist:
            self.stderr.write(self.style.ERROR(f"No 'developer' role found in organisation '{org_name}'."))
            return

        for i in range(count):
            first_name = fake.first_name()
            last_name = fake.last_name()
            full_name = f"{first_name} {last_name}"

            username = f"{first_name.lower()}.{last_name.lower()}"
            email = f"{username}@{domain}"


            user = User.objects.create_user(
                username=username,
                email=email,
                password="not-needed",
            )

            SocialAccount.objects.create(
                user=user,
                provider="google",
                uid=email,
                extra_data={
                    "email": email,
                    "name": full_name,
                    "picture": None,
                },
            )

            OrganisationMember.objects.create(
                user=user,
                organisation=org,
                role=role,
                identity_key=original_member.identity_key,
                wrapped_keyring=original_member.wrapped_keyring,
                wrapped_recovery=original_member.wrapped_recovery,
            )

        self.stdout.write(self.style.SUCCESS(f"Created {count} dummy users and added them to '{org_name}'."))

