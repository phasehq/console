# Contributing to Phase

Thanks for taking the time to contribute! 🫡

We welcome any contributions to Phase, big or small.

## Bugs and issues

Bug reports help make Phase a better experience for everyone. When you report a bug, a template will be created automatically containing information we'd like to know.

Before raising a new issue, please search existing ones to make sure you're not creating a duplicate.

**If the issue is related to security, please email us directly at security@phase.dev**

For more information see: [SECURITY.md](/SECURITY.md)

## Deciding what to work on

You can start by browsing through our list of issues or adding your own that improves on the platform experience. Once you've decided on an issue, leave a comment and wait to get approved; this helps avoid multiple people working on the same issue.

If you're ever in doubt about whether or not a proposed feature aligns with Phase as a whole, feel free to raise an issue about it and we'll get back to you promptly.

## Writing and submitting code

Anyone can contribute code to Phase. To get started, check out the local development guide, make your changes, and submit a pull request to the main repository. When committing code, please try and use [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/).

## Licensing

Most of Phase's code is under the MIT license, though some paid feature restrictions may covered by a proprietary license.

Any third party components incorporated into our code are licensed under the original license provided by the applicable component owner.

## Setup local development environment

### Dev server with hot reload

1. Create a **.env.dev** file using
    ```bash
    cp .env.dev.example .env.dev
    ```

2. Add at least one of the available OAuth provider credentials in your **.env.dev**. Follow the [Phase Docs](https://docs.phase.dev/self-hosting/configuration/envars#single-sign-on-sso)

3. Install the dependencies:

    ```bash
    docker compose -f dev-docker-compose.yml build
    ```

4. Start the containers in dev mode using: 
    ```
    docker compose -f dev-docker-compose.yml up
    ```

5. The Console is now running at <https://localhost> with [HMR(Hot Module Replacement)](https://webpack.js.org/concepts/hot-module-replacement) and a self-signed certificate.
   
   >**Note : Your browser might warn you about the self-signed certificate. You can safely accept the certificate and proceed. 

### Set up a staging environment

1. Create a **.env** file using
    ```bash
    cp .env.example .env
    ```
2. Add at least one of the available OAuth provider credentials in your **.env**. Follow the [Phase Docs](https://docs.phase.dev/self-hosting/configuration/envars#single-sign-on-sso)

2. Build the image locally with `docker compose -f staging-docker-compose.yml build`

3. Start the Phase Console with `docker compose -f staging-docker-compose.yml up -d`

4. The Console is now running at `https://localhost` with a self-signed certificate.

   >**Note : Your browser might warn you about the self-signed certificate. You can safely accept the certificate and proceed. 
