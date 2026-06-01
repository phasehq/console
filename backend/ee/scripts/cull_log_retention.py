#!/usr/bin/env python3
"""
Cloud-only operational script: cull SecretEvent READ-log retention per plan tier.

  Free orgs   →  retain 24 hours (1 day)
  Pro orgs    →  retain 90 days
  Enterprise  →  skipped (no automated cull)

Usage (run from /app inside the container):
    python ee/scripts/cull_log_retention.py                  # discover only
    python ee/scripts/cull_log_retention.py --count          # discover + count rows
    python ee/scripts/cull_log_retention.py --apply          # execute the purge
    python ee/scripts/cull_log_retention.py --plan free --apply
    python ee/scripts/cull_log_retention.py --org-id <uuid> --apply

Refuses to run when APP_HOST != "cloud" unless --force is given.
"""
import argparse
import io
import json
import os
import re
import sys
import time

# Bootstrap Django when invoked as a plain script.
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(os.path.dirname(_HERE))
sys.path.insert(0, _BACKEND)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402
from django.core.management import call_command  # noqa: E402
from django.utils import timezone  # noqa: E402
from datetime import timedelta  # noqa: E402

from api.models import Organisation, SecretEvent  # noqa: E402


PLAN_LABEL = {
    Organisation.FREE_PLAN: "Free",
    Organisation.PRO_PLAN: "Pro",
}


def build_arg_parser():
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="Actually run the purge. Without this, the script only reports.",
    )
    sizing = p.add_mutually_exclusive_group()
    sizing.add_argument(
        "--count",
        action="store_true",
        help="Show exact READ-event row count per org (COUNT(*) via index — "
        "accurate, can take minutes on prod-scale data).",
    )
    sizing.add_argument(
        "--estimate",
        action="store_true",
        help="Show planner-estimated row count per org (EXPLAIN-based — "
        "instant, accuracy depends on how recent ANALYZE was).",
    )
    p.add_argument(
        "--plan",
        choices=["free", "pro", "both"],
        default="both",
        help="Limit to a single plan tier (default: both).",
    )
    p.add_argument(
        "--org-id",
        help="Limit to a single org id (useful for spot runs).",
    )
    p.add_argument(
        "--free-retain-days",
        type=int,
        default=1,
        help="Retention for Free orgs in days (default: 1).",
    )
    p.add_argument(
        "--pro-retain-days",
        type=int,
        default=90,
        help="Retention for Pro orgs in days (default: 90).",
    )
    p.add_argument(
        "--batch-size",
        type=int,
        default=10_000,
        help="Forwarded to purge_app_logs --batch-size (default: 10000).",
    )
    p.add_argument(
        "--sleep-ms",
        type=int,
        default=500,
        help="Forwarded to purge_app_logs --sleep-ms (default: 500).",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Allow running when APP_HOST != 'cloud'.",
    )
    return p


def select_orgs(args):
    plan_filter = {
        "free": [Organisation.FREE_PLAN],
        "pro": [Organisation.PRO_PLAN],
        "both": [Organisation.FREE_PLAN, Organisation.PRO_PLAN],
    }[args.plan]
    qs = Organisation.objects.filter(plan__in=plan_filter)
    if args.org_id:
        qs = qs.filter(id=args.org_id)
    return list(qs.order_by("plan", "created_at"))


def retention_for(org, args):
    if org.plan == Organisation.FREE_PLAN:
        return args.free_retain_days
    if org.plan == Organisation.PRO_PLAN:
        return args.pro_retain_days
    # Defensive — select_orgs filters Enterprise out, but if --force lets one
    # through somehow, refuse to assign retention.
    return None


def _rows_for_org(org, cutoff):
    return SecretEvent.objects.filter(
        environment__app__organisation=org,
        event_type=SecretEvent.READ,
        timestamp__lte=cutoff,
    )


def count_rows(org, cutoff):
    """Exact COUNT(*) — uses (environment_id, -timestamp) index; slow on big orgs."""
    return _rows_for_org(org, cutoff).count()


def estimate_rows(org, cutoff):
    """Planner row estimate via EXPLAIN — instant, accuracy depends on ANALYZE freshness."""
    plan = json.loads(_rows_for_org(org, cutoff).explain(format="json"))
    return int(plan[0]["Plan"]["Plan Rows"])


def report(orgs, args):
    print(f"Discovery — {len(orgs)} org(s) match (plan={args.plan})")
    header = f"  {'plan':<5}  {'org_id':<36}  {'name':<30}  {'apps':>4}  retain"
    if args.count:
        header += f"  {'rows_to_purge':>14}"
    elif args.estimate:
        header += f"  {'rows_estimated':>14}"
    print(header)
    print("  " + "-" * (len(header) - 2))
    total_apps = 0
    total_rows = 0
    for org in orgs:
        retain = retention_for(org, args)
        if retain is None:
            continue
        apps = list(org.apps.all())
        total_apps += len(apps)
        line = (
            f"  {PLAN_LABEL[org.plan]:<5}  {org.id:<36}  "
            f"{org.name[:30]:<30}  {len(apps):>4}  {retain}d"
        )
        if args.count or args.estimate:
            cutoff = timezone.now() - timedelta(days=retain)
            n = count_rows(org, cutoff) if args.count else estimate_rows(org, cutoff)
            total_rows += n
            line += f"  {n:>14,}"
        print(line)
    print(f"\n  Total apps: {total_apps}")
    if args.count:
        print(f"  Total rows that would be purged: {total_rows:,}")
    elif args.estimate:
        print(
            f"  Total rows estimated: ~{total_rows:,} (planner estimate, ±20% typical)"
        )


def apply_purge(orgs, args):
    grand_start = time.monotonic()
    failures = []
    grand_total_rows = 0
    for i, org in enumerate(orgs, 1):
        retain = retention_for(org, args)
        if retain is None:
            continue
        label = PLAN_LABEL[org.plan]
        print(
            f"\n=== [{i}/{len(orgs)}] {label} org '{org.name}' "
            f"(id={org.id}, retain={retain}d) ===",
            flush=True,
        )
        captured = io.StringIO()
        try:
            call_command(
                "purge_app_logs",
                org.name,
                retain=retain,
                batch_size=args.batch_size,
                sleep_ms=args.sleep_ms,
                stdout=captured,
            )
            output = captured.getvalue()
            sys.stdout.write(output)
            sys.stdout.flush()
            m = re.search(r"Log deletion completed:\s+(\d+)\s+rows", output)
            if m:
                grand_total_rows += int(m.group(1))
        except Exception as e:
            sys.stdout.write(captured.getvalue())
            sys.stdout.flush()
            print(f"  FAILED: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
            failures.append((org.id, org.name, repr(e)))
            continue

    elapsed = time.monotonic() - grand_start
    print(
        f"\nCompleted {len(orgs) - len(failures)}/{len(orgs)} orgs "
        f"in {elapsed:.1f}s ({elapsed/60:.1f} min)"
    )
    print(f"Total rows deleted: {grand_total_rows:,}")
    if failures:
        print(f"Failures ({len(failures)}):")
        for org_id, name, err in failures:
            print(f"  - {org_id}  {name!r}: {err}")


def main():
    args = build_arg_parser().parse_args()

    if settings.APP_HOST != "cloud" and not args.force:
        print(
            f"Refusing to run: APP_HOST={settings.APP_HOST!r}, expected 'cloud'. "
            f"Use --force to override (intentionally inconvenient — this script "
            f"is for cloud SaaS only).",
            file=sys.stderr,
        )
        return 2

    orgs = select_orgs(args)
    if not orgs:
        print("No orgs match the filter.")
        return 0

    if not args.apply:
        report(orgs, args)
        print("\nReport-only run. Pass --apply to execute the purge.")
        return 0

    # Brief preview before executing.
    report(orgs, args)
    print()
    apply_purge(orgs, args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
