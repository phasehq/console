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


### Create dummy users

To mock various UI screens and workflows, you may want to create dummy users on the backend. To create fake users:

1. Install the dev dependencies in your venv:

```bash
pip install -r dev-requirements.txt
```
2. Signup and create an organisation.

3. Run the `create_dummy_users` management command:

Get the container id of the backend container:

```bash
docker ps
```

Shell into the backend:

```bash
docker exec -it <container_id> /bin/sh
```

Create users and add them to your org. You may want to optionally specify the email domain used for the fake users. This makes it easier to identify these users for cleanup later.

```bash
python manage.py create_dummy_users --count 10 --org "OrgName" --domain "example.com"
```

