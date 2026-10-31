"""Seed a multi-tenant dataset for the secret event logging benchmark.

Run inside the backend container:

    python bench/secret_events/seed.py /bench/targets.json

Creates BENCH_ORGS organisations, each with three apps whose environments
hold 10, 50 and 200 secrets respectively (the "s10", "s50", "s200" target
sets), one service account per org with a known token, and a handful of tags
spread over the secrets so the tag M2M write path is exercised.

Ciphertexts are random but shaped like real `ph:v1:<pubkey>:<b64>` values
(including the occasional multi-KB certificate) so row and payload sizes are
representative.
"""

import base64
import json
import os
import random
import secrets as pyrandom
import sys

import django

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

from django.db import transaction  # noqa: E402

from api.models import (  # noqa: E402
    App,
    CustomUser,
    Environment,
    EnvironmentKey,
    Organisation,
    OrganisationMember,
    Role,
    Secret,
    SecretTag,
    ServiceAccount,
    ServiceAccountToken,
)
from api.utils.access.roles import MANAGED_ROLE_NAMES, SERVICE_ROLE_KEY, OWNER_ROLE_KEY  # noqa: E402

ORGS = int(os.getenv("BENCH_ORGS", "20"))
APP_SIZES = [10, 50, 200]
ENV_NAMES = ["Development", "Staging", "Production"]
TAG_NAMES = ["backend", "frontend", "infra", "payments", "shared"]

rng = random.Random(1337)


def hexkey():
    return pyrandom.token_hex(32)


def ciphertext(plain_len):
    # XChaCha20-Poly1305 box: 24-byte nonce + 16-byte tag around the plaintext.
    raw = os.urandom(plain_len + 40)
    return f"ph:v1:{hexkey()}:{base64.b64encode(raw).decode()}"


def value_len():
    r = rng.random()
    if r < 0.85:
        return rng.randint(16, 64)  # tokens, passwords, URLs
    if r < 0.97:
        return rng.randint(100, 400)  # connection strings, JSON blobs
    return rng.randint(1200, 3000)  # certificates / keys


@transaction.atomic
def seed():
    targets = []
    for o in range(ORGS):
        org = Organisation.objects.create(
            name=f"bench-org-{o:03d}", identity_key=hexkey(), plan="EN"
        )
        roles = {
            key: Role.objects.create(
                name=name, organisation=org, is_default=True, managed_key=key
            )
            for key, name in MANAGED_ROLE_NAMES.items()
        }
        user = CustomUser.objects.create(
            username=f"bench-user-{o:03d}", email=f"bench{o:03d}@example.com"
        )
        owner = OrganisationMember.objects.create(
            user=user,
            organisation=org,
            role=roles[OWNER_ROLE_KEY],
            identity_key=hexkey(),
        )
        tags = [
            SecretTag.objects.create(organisation=org, name=n, color="#000000")
            for n in TAG_NAMES
        ]
        sa = ServiceAccount.objects.create(
            name=f"bench-sa-{o:03d}",
            organisation=org,
            role=roles[SERVICE_ROLE_KEY],
            identity_key=hexkey(),
        )
        token_value = f"bench{o:03d}" + pyrandom.token_hex(16)
        ServiceAccountToken.objects.create(
            service_account=sa,
            name="bench",
            identity_key=hexkey(),
            token=token_value,
            wrapped_key_share="x",
            created_by=owner,
        )

        for size in APP_SIZES:
            app = App.objects.create(
                organisation=org,
                name=f"app-s{size}",
                identity_key=hexkey(),
                app_token=pyrandom.token_hex(32),
                app_seed="x",
                wrapped_key_share="x",
            )
            app.members.add(owner)
            sa.apps.add(app)
            for idx, env_name in enumerate(ENV_NAMES):
                env = Environment.objects.create(
                    app=app,
                    name=env_name,
                    env_type=env_name[:4].lower() if env_name != "Production" else "prod",
                    index=idx,
                    identity_key=hexkey(),
                    wrapped_seed="x",
                    wrapped_salt="x",
                )
                EnvironmentKey.objects.create(
                    environment=env,
                    service_account=sa,
                    identity_key=hexkey(),
                    wrapped_seed="x",
                    wrapped_salt="x",
                )
                secret_rows = []
                secret_tags = []
                for s in range(size):
                    secret = Secret(
                        environment=env,
                        path="/",
                        key=ciphertext(rng.randint(8, 32)),
                        key_digest=pyrandom.token_hex(32),
                        value=ciphertext(value_len()),
                        comment=ciphertext(0) if rng.random() < 0.7 else ciphertext(rng.randint(10, 80)),
                        version=1,
                    )
                    secret_rows.append(secret)
                    r = rng.random()
                    n_tags = 0 if r < 0.5 else (1 if r < 0.8 else 2)
                    secret_tags.append(rng.sample(tags, n_tags))
                Secret.objects.bulk_create(secret_rows)
                through = Secret.tags.through
                through.objects.bulk_create(
                    [
                        through(secret_id=sec.id, secrettag_id=t.id)
                        for sec, ts in zip(secret_rows, secret_tags)
                        for t in ts
                    ]
                )
                targets.append(
                    {
                        "org": org.name,
                        "org_id": str(org.id),
                        "set": f"s{size}",
                        "token": token_value,
                        "app_id": str(app.id),
                        "env_id": str(env.id),
                        "secrets": [
                            {"id": str(sec.id), "tags": [t.name for t in ts]}
                            for sec, ts in zip(secret_rows, secret_tags)
                        ],
                    }
                )
    return targets


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "targets.json"
    if Organisation.objects.filter(name__startswith="bench-org-").exists():
        print("bench data already present; refusing to reseed", file=sys.stderr)
        sys.exit(1)
    targets = seed()
    with open(out, "w") as f:
        json.dump(targets, f)
    print(f"seeded {ORGS} orgs, {len(targets)} environments -> {out}")
