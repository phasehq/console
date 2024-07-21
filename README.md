<div align="center">
  <!-- Phase Console -->
  <a href="https://phase.dev">
  <img height="120" width="450" src="img/phase-lattice-logo.svg" alt="Phase">
  </a>

  <a href="https://phase.dev">Website</a> |
  <a href="https://docs.phase.dev">Documentation</a> |
  <a href="https://docs.phase.dev/security">Security</a> |
    <a href="https://github.com/phasehq/console/blob/main/CONTRIBUTING.md">Contributing</a> |
  <a href="https://slack.phase.dev">Join Slack</a>
</div>

---

[Phase](https://phase.dev) is an all-in-one platform for developers to securely create, manage and deploy application secrets across local development 💻, CI tools 🔨, and cloud ☁️ infrastructure.

An open source and developer-friendly alternative to **HashiCorp Vault** and **AWS Secrets Manager** that works with your whole team 🧑‍💻.

---

# Phase Console

<!-- Autoplay video -->
<video width="100%" autoplay loop muted>
  <source src="img/console-ui.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>


|     | **Features**                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 📈  | **[Phase Console](https://console.phase.dev)**: Dashboard for seamlessly creating, managing, rotating secrets and environment variables                |
| ⌨️  | **[CLI](https://github.com/phasehq/cli)**: Import existing secrets from `.env` files, encrypt them and securely inject them in your application at runtime  |
| 🤫  | **[Secret management](https://docs.phase.dev/console/apps)**: Secret Diffs, version control and Point-in-time Recovery                                                                                    |
| 🙋  | **[RBAC](https://docs.phase.dev/console/users#user-roles)**: Fine-grained, role-based and cryptographic access control, per application, per environment.                                                      |
| 🔌  | **[Integrations](https://docs.phase.dev/#integrate-phase)**: Automatically sync secrets to GitHub, Cloudflare Pages, AWS Secrets Manager etc.                                                        |
| ![Kubernets](img/kubernetes.svg)  | **[Kubernetes](https://docs.phase.dev/integrations/platforms/kubernetes)**: Automatically deploy secrets to your Kubernetes Cluster with End-to-End encryption via Phase Secrets Operator   |
| ⛓️  | **[Secret referencing & overrides](https://docs.phase.dev/console/secrets)**: Create personal secrets. Inherit values from other secrets                                                              |
| 🥡  | **[Self Hosting](https://docs.phase.dev)**: Run Phase on your own infrastructure                                                                            |
| 🔑  | **[Service Tokens](https://docs.phase.dev/console/tokens#service-tokens)**: Authenticate CI runners, build tools and production environment with granular scope                                                    |
| 🔍  | **[Audit Logs]()**: Complete visibility into every change and access event                                                                                  |

[Explore Phase Console](https://docs.phase.dev/console)

---

## CLI - Import, Encrypt and Inject secrets

![Phase CI](img/phase-cli-import-run.webp)

```fish
λ phase
Securely manage and sync environment variables with Phase.

⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⠔⠋⣳⣖⠚⣲⢖⠙⠳⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⡴⠉⢀⡼⠃⢘⣞⠁⠙⡆⠀⠘⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⢀⡜⠁⢠⠞⠀⢠⠞⠸⡆⠀⠹⡄⠀⠹⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⢀⠞⠀⢠⠏⠀⣠⠏⠀⠀⢳⠀⠀⢳⠀⠀⢧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⢠⠎⠀⣠⠏⠀⣰⠃⠀⠀⠀⠈⣇⠀⠘⡇⠀⠘⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⢠⠏⠀⣰⠇⠀⣰⠃⠀⠀⠀⠀⠀⢺⡀⠀⢹⠀⠀⢽⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⢠⠏⠀⣰⠃⠀⣰⠃⠀⠀⠀⠀⠀⠀⠀⣇⠀⠈⣇⠀⠘⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⢠⠏⠀⢰⠃⠀⣰⠃⠀⠀⠀⠀⠀⠀⠀⠀⢸⡀⠀⢹⡀⠀⢹⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⢠⠏⠀⢰⠃⠀⣰⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣇⠀⠈⣇⠀⠈⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠛⠒⠚⠛⠒⠓⠚⠒⠒⠓⠒⠓⠚⠒⠓⠚⠒⠓⢻⡒⠒⢻⡒⠒⢻⡒⠒⠒⠒⠒⠒⠒⠒⠒⠒⣲⠒⠒⣲⠒⠒⡲⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢧⠀⠀⢧⠀⠈⣇⠀⠀⠀⠀⠀⠀⠀⠀⢠⠇⠀⣰⠃⠀⣰⠃⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⡆⠀⠘⡆⠀⠸⡄⠀⠀⠀⠀⠀⠀⣠⠇⠀⣰⠃⠀⣴⠃⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⡄⠀⠹⡄⠀⠹⡄⠀⠀⠀⠀⡴⠃⢀⡼⠁⢀⡼⠁⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⣆⠀⠙⣆⠀⠹⣄⠀⣠⠎⠁⣠⠞⠀⡤⠏⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠳⢤⣈⣳⣤⣼⣹⢥⣰⣋⡥⡴⠊⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀

Options:
  -h, --help   show this help message and exit
  --version, -v
               show program's version number and exit

Commands:

    auth             💻 Authenticate with Phase
    init             🔗 Link your project with your Phase app
    run              🚀 Run and inject secrets to your app
    secrets          🗝️ Manage your secrets
    secrets list     📇 List all the secrets
    secrets get      🔍 Get a specific secret by key
    secrets create   💳 Create a new secret
    secrets update   📝 Update an existing secret
    secrets delete   🗑️ Delete a secret
    secrets import   📩 Import secrets from a .env file
    secrets export   🥡 Export secrets in a dotenv format
    users            👥 Manage users and accounts
    users whoami     🙋 See details of the current user
    users logout     🏃 Logout from phase-cli
    users keyring    🔐 Display information about the Phase keyring
    console          🖥️ Open the Phase Console in your browser
    update           🆙 Update the Phase CLI to the latest version
```

[Explore Phase CLI](https://github.com/phasehq/cli)

---

## Getting started

Check out the [Quickstart](https://docs.phase.dev/quickstart) Guides

### Use Phase Cloud

The quickest and most reliable way to get started is by signing up on the [Phase Console](https://console.phase.dev/).

|                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Deploy Phase Console on your infrastructure**                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
|![Docker](img/docker.svg) | [Docker Compose](https://docs.phase.dev/self-hosting/docker-compose) |
|![AWS](img/aws.svg)  | [AWS](https://docs.phase.dev/self-hosting/aws)                       |
|![GCP](img/gcp.svg)  | [Google Cloud Platform](https://docs.phase.dev/self-hosting/gcp)     |
|![Azure](img/azure.svg)  | [Azure](https://docs.phase.dev/self-hosting/azure)                   |
|![DigitalOcean](img/do.svg) | [DigitalOcean](https://docs.phase.dev/self-hosting/digitalocean)     |
| 🥡                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [Self-hosting Phase](https://docs.phase.dev/self-hosting)            |

---

### SDKs

- [JavaScript Browser](https://github.com/phasehq/client-js-sdk)
- [Node.js](https://github.com/phasehq/node-sdk)
- [Python](https://github.com/phasehq/python-sdk)

More coming soon!

---

## Community vs Enterprise edition

Phase operates on an [open-core](https://en.wikipedia.org/wiki/Open-core_model) model, similar to that of [GitLab](https://gitlab.com).

This repo available under the [MIT expat license](/LICENSE), with the exception of the `ee` directory which will contain Pro or Enterprise features requiring a Phase license.

---

## Security

For more information on how Phase encryption works, please see the [Security Docs](https://docs.phase.dev/security)

Please do not file GitHub issues or post on our public forum for security vulnerabilities, as they are public!

For more information see: [SECURITY.md](/SECURITY.md)

---

## Contributing

We love contributions. See [CONTRIBUTING.md](/CONTRIBUTING.md)

You can join our [Slack](https://slack.phase.dev) if you have any questions!
