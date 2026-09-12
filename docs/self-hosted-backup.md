# Back up and restore a self-hosted Phase instance

`phase-admin` backs up the default Phase Docker Compose deployment. The encrypted archive contains the PostgreSQL database, the `.env` file needed to decrypt secrets, the resolved Compose configuration, an instance manifest, and checksums.

## Create and verify a backup

Run these commands from the Console repository while Phase is running:

```bash
./phase-admin backup --output phase-backup.tar.enc
./phase-admin verify phase-backup.tar.enc
```

The script prompts for a password of at least 12 characters and encrypts the archive with AES-256-CBC and 200,000 PBKDF2 iterations. For unattended jobs, provide the password through the environment instead of a command-line argument:

```bash
PHASE_BACKUP_PASSWORD="$BACKUP_PASSWORD" ./phase-admin backup --output phase-backup.tar.enc
```

Store the archive password separately from the archive. Test restores regularly, and copy completed archives off the Phase host according to your retention policy.

## Restore

Verify the incoming archive first:

```bash
./phase-admin verify phase-backup.tar.enc
```

The manifest records the source `console_revision` plus the backend and frontend container image identifiers. Use the source Console revision for the restore; after a successful restore, upgrade Phase normally. Image identifiers are diagnostic metadata and may be `unknown` if those containers were stopped during backup. The script verifies archive integrity but does not decide whether versions are compatible, and restoring with an older Console version is not supported.

Next, create and verify a fresh backup of the current instance so the restore can be reversed if needed:

```bash
./phase-admin backup --output pre-restore-backup.tar.enc
./phase-admin verify pre-restore-backup.tar.enc
```

For a same-instance restore, keep the existing `.env`; the script rejects a restore if its database identity differs from the archive. For migration to a new host, copy the encrypted archive into the checkout, remove any bootstrap `.env`, and start with an empty `phase-postgres-data` volume. The archived `.env` initializes the new database.

```bash
./phase-admin restore phase-backup.tar.enc
```

For automation, append `--yes` to skip the destructive confirmation. Use it only after separately verifying the archive.

Restore verifies every archived file before making changes, shows the source manifest and target, stops services that can write to PostgreSQL, saves an existing `.env` as `.env.before-restore.<timestamp>`, and replaces the public database schema in one transaction. It then runs migrations and starts the full deployment.

The archive contains secrets and configuration in encrypted form. Do not commit it or the saved `.env` files to source control.

## Scope

PostgreSQL is the only persistent application volume in the default Compose deployment, so this backup includes organizations, applications, environments, secret history, memberships, roles, service accounts, integrations, audit logs, and encryption metadata. Redis is transient and is not backed up. Host-managed TLS certificates and external reverse-proxy configuration are outside the Compose deployment and must be backed up separately.
