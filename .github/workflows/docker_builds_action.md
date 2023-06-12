# Workflow documentation: `docker_builds.yml`

This repository utilizes GitHub Actions to implement a Continuous Integration/Continuous Deployment (CI/CD) workflow for building and pushing Docker images.

The CI/CD pipeline consists of the following stages:

1. **Build:** On every pull request to the `master` branch, Docker images are built for both the `frontend` and `backend` services. The images are tagged with the commit hash of the latest commit in the pull request.
2. **Push:** When the pull request is merged into the `master` branch, Docker images are built again for both `frontend` and `backend`, but this time they are tagged as `latest` and pushed to DockerHub.
3. **Release:** When a new release is published in the repository, Docker images are built for both `frontend` and `backend` services, tagged with the version of the release, and then pushed to DockerHub.

## Workflow File

The pipeline is defined in the `.github/workflows/docker.yml` file. This file describes the jobs that make up the pipeline, their triggers, and the steps included in each job.

## Jobs

The workflow contains three jobs: `build`, `push`, and `release`.

- **build:** Triggered on every pull request to the `master` branch. The job checks out the code, logs into DockerHub using stored secrets, and then builds the Docker images for `frontend` and `backend`.
- **push:** Triggered when a pull request is merged into the `master` branch. The job follows the same steps as the `build` job but also pushes the Docker images to DockerHub.
- **release:** Triggered when a new release is published. The job follows the same steps as the `push` job but tags the Docker images with the release version before pushing them to DockerHub.

## DockerHub Credentials

In order for the GitHub Actions workflow to push images to DockerHub, it needs the DockerHub username and access token. These are stored as secrets in the GitHub repository and accessed in the workflow file.

To add these secrets to your repository:

1. Go to the main page of your GitHub repository and click on "Settings".
2. Click on "Secrets" in the left sidebar.
3. Click on "New repository secret" and add the following two secrets:
   - `DOCKERHUB_USERNAME`: Your DockerHub username.
   - `DOCKERHUB_TOKEN`: Your DockerHub access token.

## Triggers

The pipeline can be triggered by:

- Creating a pull request to the `master` branch.
- Merging a pull request into the `master` branch.
- Publishing a new release.

Once the pipeline is triggered, it automatically proceeds through the stages of `build`, `push` (if triggered by a pull request merge), or `release` (if triggered by a new release), as defined in the workflow file.
