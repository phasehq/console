# Contributing to Phase 🫡

Thanks for taking the time to contribute!

We welcome any contributions to Phase, big or small.

## Minimum System Requirements 🦕

To run Phase locally, ensure your system meets the following minimum requirements:
- **System** !=🥔
- **RAM:** >= 8GB (preferably 16GB)


## Prerequisites 🛠️

Before setting up your development environment, ensure you have the following prerequisites installed 🐳:
- Docker
- Docker Compose
- Git

## Bugs and Issues 🧶

Bug reports help make Phase a better experience for everyone. When you report a bug, a template will be created automatically containing the information we'd like to know.

Before raising a new issue, please search existing ones to make sure you're not creating a duplicate.

**If the issue is related to security, please email us directly at `security@phase.dev`**

For more information, see: [SECURITY.md](/SECURITY.md)

## Deciding What to Work On 🏋️

You can start by browsing through our list of issues or adding your own that suggests a new feature or improves the platform experience. Once you've decided on an issue, leave a comment and wait to get approved; this helps avoid multiple people working on the same issue.

If you're ever in doubt about whether or not a proposed feature aligns with Phase as a whole, feel free to raise an issue about it and we'll get back to you promptly.

## Writing and Submitting Code 🏗️

Anyone can contribute code to Phase. To get started, check out the local development guide, make your changes, and submit a pull request to the main repository. When committing code, please try to use [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/).

## Licensing ⚖️

Most of Phase's code is under the MIT license, though some paid feature restrictions may be covered by a proprietary license.

Any third-party components incorporated into our code are licensed under the original license provided by the applicable component owner.

## Get Phase running locally 👩‍💻

### Dev Server with Hot Reload

1. Create a **.env.dev** file using:
    ```bash
    cp .env.dev.example .env.dev
    ```

2. Add at least one of the available OAuth provider credentials in your **.env.dev**. Follow the [Phase Docs](https://docs.phase.dev/self-hosting/configuration/envars#single-sign-on-sso).

3. Install the dependencies:
    ```bash
    docker compose -f dev-docker-compose.yml build
    ```

4. Start the containers in dev mode using:
    ```bash
    docker compose -f dev-docker-compose.yml up
    ```

5. The Console is now running at <https://localhost> with [HMR (Hot Module Replacement)](https://webpack.js.org/concepts/hot-module-replacement) and a self-signed certificate.
   
   >**Note:** Your browser might warn you about the self-signed certificate. You can safely accept the certificate and proceed.

### Set Up a Staging Environment

1. Create a **.env** file using:
    ```bash
    cp .env.example .env
    ```

2. Add at least one of the available OAuth provider credentials in your **.env**. Follow the [Phase Docs](https://docs.phase.dev/self-hosting/configuration/envars#single-sign-on-sso).

3. Build the image locally with:
    ```bash
    docker compose -f staging-docker-compose.yml build
    ```

4. Start the Phase Console with:
    ```bash
    docker compose -f staging-docker-compose.yml up -d
    ```

5. The Console is now running at <https://localhost> with a self-signed certificate.

   >**Note:** Your browser might warn you about the self-signed certificate. You can safely accept the certificate and proceed.

### Common Problems / Issues 🗿

1. **Certificate Errors**
   - Caused by a self-signed certificate.
   - Solved by adding a valid certificate to the NGINX config in `nginx/default.conf`.
   - Use a reverse proxy that will add a valid certificate like `cloudflared` or `tailscale serve`.

2. **NGINX 503 / Timeouts / Hot Reloading Not Working**
   - Caused by a slow system.
   - Please check how much leftover RAM you have after starting all the containers.
   - Additionally, for slower systems facing timeout issues, try increasing NGINX proxy timeouts by adding the following code snippet:

    ```nginx
    server {
        listen 80;
        listen 443 ssl http2;

        ssl_certificate /etc/nginx/ssl/nginx.crt;
        ssl_certificate_key /etc/nginx/ssl/nginx.key;
        
        # Increase the timeout to 3 minutes
        proxy_connect_timeout 180s;
        proxy_send_timeout 180s;
        proxy_read_timeout 180s;
    }

    # Rest of your config
    # ...
    ```

3. **Having Issues Signing In (Redirected Back to the Phase Console Log-In Screen Even After OAuth Authentication)**
   - Please make sure the OAuth credentials and the callback URL are correct and as described in the docs: [Phase Docs](https://docs.phase.dev/self-hosting/configuration/envars#single-sign-on-sso)

Need help?
[Join our Slack](https://slack.phase.dev)

Thank you for contributing to Phase! 