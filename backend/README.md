# Phase Console - Backend

Django + Graphene + DRF

### Generate graphql schema for frontend

```bash
./manage.py graphql_schema --schema backend.schema.schema --out ../frontend/apollo/schema.graphql
```

Dev docker compose instructions:

```bash
docker compose -f dev-docker-compose.yml exec backend python manage.py graphql_schema --schema backend.schema.schema --out schema.graphql
```

Overwrite the schema in `/frontend/apollo/schema.graphql`.

You will also need to generate Typescript types, please see `frontend/README.md`.