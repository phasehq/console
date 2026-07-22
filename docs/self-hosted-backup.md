# Back up and restore a self-hosted Phase instance

`phase-admin` creates a complete backup of a Phase Docker Compose deployment. The encrypted archive contains the PostgreSQL database, the `.env` file needed to decrypt secrets, the resolved Compose configuration, an instance manifest, and checksums.

## Create and verify a backup

Run these commands from the Console repository while Phase is running:

```bash
./phase-admin backup phase-backup.tar.enc
./phase-admin verify phase-backup.tar.enc
```

The script prompts for a password of at least 12 characters and encrypts the archive with AES-256-CBC and 200,000 PBKDF2 iterations. For unattended jobs, provide the password through the environment instead of a command-line argument:

```bash
PHASE_BACKUP_PASSWORD="$BACKUP_PASSWORD" ./phase-admin backup phase-backup.tar.enc
```

Store the archive password separately from the archive. Test restores regularly, and copy completed archives off the Phase host according to your retention policy.

## Restore

Use the same Console checkout and Docker Compose deployment that created the backup. For migration to a new host, start with an empty `phase-postgres-data` volume and copy the encrypted archive into the checkout.

```bash
./phase-admin restore phase-backup.tar.enc
```

Restore verifies every archived file before making changes, stops services that can write to PostgreSQL, saves the current `.env` as `.env.before-restore.<timestamp>`, and restores the database in one transaction. It then starts the full deployment so the normal migration service can apply migrations required by a newer Console version.

The archive contains secrets and configuration in encrypted form. Do not commit it or the saved `.env` files to source control.

## Scope

PostgreSQL is the only persistent application volume in the default Compose deployment, so this backup includes organizations, applications, environments, secret history, memberships, roles, service accounts, integrations, audit logs, and encryption metadata. Redis is transient and is not backed up. Host-managed TLS certificates and external reverse-proxy configuration are outside the Compose deployment and must be backed up separately.
