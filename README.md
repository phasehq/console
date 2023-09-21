<h1 align="center">
  <!-- Phase Console -->
  <img height="68" width="306" src="img/phase-console-wordmark-dark.png" alt="Phase">
</h1>

<h3 align="center">Open Source, self-hostable, end-to-end secrets and environment variable management platform for developers.</h3>

<div align="center">
  <a href="https://phase.dev">Website</a> |
  <a href="https://docs.phase.dev">Docs</a> |
  <a href="https://docs.phase.dev/security">Security</a> |
  <a href="https://join.slack.com/t/phase-community/shared_invite/zt-1tkwzl31z-a6yCB5Uqlj~V2x43ep2Evg">Slack</a>
</div>

<hr/>

<img src="img/console-home.png" width="100%" alt="Phase Console" />

<div width="100%">
  <img src="img/console-logs.png" alt="Phase Console" width="47%">
  &nbsp; &nbsp; &nbsp; &nbsp;
</div>
  
<br>

[Phase Console](https://phase.dev) is an open source, end-to-end encrypted key management solution for developers to seamlessly encrypt production data in their apps.

## Console

- **[Phase Console](https://console.phase.dev)**: Dashboard for seamlessly creating, managing, rotating secrets and environment variables

- **[Hold your keys](https://docs.phase.dev/security/phase-encryption#account-keyring)**: Maintain self-custody of your root keys via 24 word mnemonic phrase
- **Secret management**: Diffs, version control and Point-in-time Recovery
- Fine grained Role-based and cryptographic access control, per application, per environment.
- **Service Tokens**:
- **Secret referencing**: Inheritance
- **[Audit Logs]()**
- **[Self Hosting](https://docs.phase.dev)**: Run Phase on your own infrastructure
- **[Phase KMS](https://phase.dev)**: A zero knowledge key management service
- **[SDKs](https://docs.phase.dev/sdks)**: Encrypt / decrypt data with a few lines of code.

And much more.

---

## CLI

```fish
# Your existing secrets
> cat .env
AWS_ACCESS_KEY_ID="AKIA2OGYBAH63UA3VNFG"
AWS_SECRET_ACCESS_KEY="V5yWXDe82Gohf9DYBhpatYZ74a5fiKfJVx8rx6W1"

# Import your existing secrets
> phase secrets import .env
Successfully imported and encrypted 2 secrets.
To view them please run: phase secrets list

# View your secrets in Phase
> phase secrets list
KEY 🗝️                    | VALUE ✨                                                                  
----------------------------------------------------------------------------------------------------     
AWS_ACCESS_KEY_ID        | AKI**************NFG                                                     
AWS_SECRET_ACCESS_KEY    | V5y**********************************6W1                                 

🥽 To uncover the secrets, use: phase secrets list --show

# Get rid of your .env
> rm .env

# Seamlessly inject secrets during runtime
> phase run yarn dev
$ next dev
ready - started server on 0.0.0.0:3000, url: http://localhost:3000
```


- **CLI**: Fetch, decrypt and inject secrets and environment variables to your application. Zero code changes required.
- Inject
- Export secrets in a dotenv format
- **Cross platform**: Easily install the Phase CLI on macOS, Ubuntu/Arch/Redhat/Alpine Linux, Windows, Docker.
- **Keyring Integration** - Store keys and credentials securely in [macOS Keychain](https://en.wikipedia.org/wiki/Keychain_%28software%29), [Windows Credential Locker](https://learn.microsoft.com/en-us/windows/uwp/security/credential-locker), [KDE Wallet](https://en.wikipedia.org/wiki/KWallet), [GNOME Keyring](https://en.wikipedia.org/wiki/GNOME_Keyring) etc.
- **[Private Key Sharding](https://docs.phase.dev/security#dual-key-model)**: Avoid single point of compromise of the private key via [secret splitting schemes](https://en.wikipedia.org/wiki/Secret_sharing)


---

## Getting started

Check out the [Quickstart](https://docs.phase.dev/quickstart) Guides

### Use Phase Cloud

The quickest and most reliable way to get started is making a new free account on the [Phase Console](https://console.phase.dev/).

### Deploy Phase Console on your infrastructure

- [Docker Compose](https://docs.phase.dev/self-hosting/docker-compose)
- [AWS](https://docs.phase.dev/self-hosting/aws)
- [Azure](https://docs.phase.dev/self-hosting/azure)
- [Google Cloud Platform](https://docs.phase.dev/self-hosting/gcp)
- [DigitalOcean](https://docs.phase.dev/self-hosting/digitalocean)


See: [Self-hosting Phase](https://docs.phase.dev/self-hosting)

---

### SDKs

- [JavaScript Browser](https://github.com/phasehq/client-js-sdk)
- [Node.js](https://github.com/phasehq/node-sdk)
- [Python](https://github.com/phasehq/python-sdk)

More coming soon!

---

## Community vs Enterprise edition

Phase operates on an [open-core](https://en.wikipedia.org/wiki/Open-core_model) model, similar to that of [GitLab](https://gitlab.com), [Infisical](https://infisical.com), [PostHog](https://posthog.com) etc.

This repo available under the [MIT expat license](/LICENSE), with the exception of the `ee` directory which will contain premium Pro or Enterprise features requiring a Phase license in the future.

---

## Security

For more information on how Phase encryption works, please see the [Security Docs](https://docs.phase.dev/security)

Please do not file GitHub issues or post on our public forum for security vulnerabilities, as they are public!

For more information see: [SECURITY.md](/SECURITY.md)

---

## Contributing

Whether it's big or small, we love contributions. See [CONTRIBUTING.md](/CONTRIBUTING.md)

You can join our [Slack](https://join.slack.com/t/phase-community/shared_invite/zt-1tkwzl31z-a6yCB5Uqlj~V2x43ep2Evg) if you have any questions!

---

## Resources

- [Website](https://phase.dev)
- [Docs](https://docs.phase.dev)
- [GitHub](https://github.com/phasehq/console)
- [Slack](https://join.slack.com/t/phase-community/shared_invite/zt-1tkwzl31z-a6yCB5Uqlj~V2x43ep2Evg)
