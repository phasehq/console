# Contributing to Phase

Thanks for taking the time to contribute! ❤️

We welcome any contributions to Phase, big or small.

## Community

It's the early days of Phase and we're working hard to build an awesome, inclusive community.

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

Most of Phase's code is under the MIT license, though some paid feature restrictions are covered by a proprietary license.

Any third party components incorporated into our code are licensed under the original license provided by the applicable component owner.

## Setup local development environment
### Dev server with hot reload
1. Create a **.env.dev** file using
    ```
    cp .env.dev.example .env.dev
    ```
2. Add atleast one OAuth provider in your **.env.dev**. Follow the [docs](https://docs.phase.dev/self-hosting/configuration/envars)
2. Check **dev-docker-compose.yml** file is populating correctly with env variables by running 
    ```
    docker compose -f dev-docker-compose.yml --env-file .env.dev config
    ```
3. If all the configs are correct, start the cotainers using 
    ```
    docker-compose -f dev-docker-compose.yml --env-file .env.dev up
    ```
4. The Console is now running at <http://localhost> with HMR(Hot Module Reload)
   You can also connect using https protocol - <https://localhost>
   >**Note :** It might show **Your connection isn't private**. 
   You can ignore the message and continue using localhost

### Staging env to test production builds

1. Set up a `.env` file with `cp .env.example` and add atleast one OAuth provider. View the [docs](https://docs.phase.dev/self-hosting/configuration/envars) for more info.
2. Build the image locally with `docker-compose -f staging-docker-compose.yml build`
3. Bring docker compose up with `docker-compose -f staging-docker-compose.yml up`
4. The Console is now running at `https://localhost`.
