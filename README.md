<h1 align="center">
  <!-- Phase Console -->
  <img height="68" width="306" src="img/wordmark-dark.svg" alt="Phase">
</h1>

<h3 align="center">Open Source, end-to-end encrypted, self-hostable all in one platform for developers to manage secrets and environment variables. From their laptop 💻 to the cloud ☁️.</h3>

<div align="center">
  <a href="https://phase.dev">Website</a> |
  <a href="https://docs.phase.dev">Docs</a> |
  <a href="https://docs.phase.dev/security">Security</a> |
  <a href="https://join.slack.com/t/phase-community/shared_invite/zt-1tkwzl31z-a6yCB5Uqlj~V2x43ep2Evg">Slack</a>
</div>

<hr/>


<img src="img/phase-console-secrets-development.webp" width="100%" alt="Phase Console" />

|     | **Features**                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 📺  | **[Phase Console](https://console.phase.dev)**: Dashboard for seamlessly creating, managing, rotating secrets and environment variables)                    |
| 🔐  | **[Hold your keys](https://docs.phase.dev/security/phase-encryption#account-keyring)**: Maintain self-custody of your root keys via 24 word mnemonic phrase |
| 🤫  | **Secret management**: Diffs, version control and Point-in-time Recovery                                                                                    |
| 🙋  | **RBAC**: Fine-grained, role-based and cryptographic access control, per application, per environment.                                                      |
| 🔑  | **Service Tokens**: Authenticate CI runners, build tools and production environment with granualar-scope                                                    |
| ⛓️  | **Secret referencing & overrides**: Create personal secrets. Inherit values from other secrets                                                              |
| 🥡  | **[Self Hosting](https://docs.phase.dev)**: Run Phase on your own infrastructure                                                                            |
| 🔍  | **[Audit Logs]()**: Compelte visibility into every change and access event                                                                                  |

And much more.

---

## CLI

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

|                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Deploy Phase Console on your infrastructure**                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Docker</title><path fill="#2496ED" d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"/></svg>                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | [Docker Compose](https://docs.phase.dev/self-hosting/docker-compose) |
| <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Amazon AWS</title><path fill="#FF9900" d="M6.763 10.036c0 .296.032.535.088.71.064.176.144.368.256.576.04.063.056.127.056.183 0 .08-.048.16-.152.24l-.503.335a.383.383 0 0 1-.208.072c-.08 0-.16-.04-.239-.112a2.47 2.47 0 0 1-.287-.375 6.18 6.18 0 0 1-.248-.471c-.622.734-1.405 1.101-2.347 1.101-.67 0-1.205-.191-1.596-.574-.391-.384-.59-.894-.59-1.533 0-.678.239-1.23.726-1.644.487-.415 1.133-.623 1.955-.623.272 0 .551.024.846.064.296.04.6.104.918.176v-.583c0-.607-.127-1.03-.375-1.277-.255-.248-.686-.367-1.3-.367-.28 0-.568.031-.863.103-.295.072-.583.16-.862.272a2.287 2.287 0 0 1-.28.104.488.488 0 0 1-.127.023c-.112 0-.168-.08-.168-.247v-.391c0-.128.016-.224.056-.28a.597.597 0 0 1 .224-.167c.279-.144.614-.264 1.005-.36a4.84 4.84 0 0 1 1.246-.151c.95 0 1.644.216 2.091.647.439.43.662 1.085.662 1.963v2.586zm-3.24 1.214c.263 0 .534-.048.822-.144.287-.096.543-.271.758-.51.128-.152.224-.32.272-.512.047-.191.08-.423.08-.694v-.335a6.66 6.66 0 0 0-.735-.136 6.02 6.02 0 0 0-.75-.048c-.535 0-.926.104-1.19.32-.263.215-.39.518-.39.917 0 .375.095.655.295.846.191.2.47.296.838.296zm6.41.862c-.144 0-.24-.024-.304-.08-.064-.048-.12-.16-.168-.311L7.586 5.55a1.398 1.398 0 0 1-.072-.32c0-.128.064-.2.191-.2h.783c.151 0 .255.025.31.08.065.048.113.16.16.312l1.342 5.284 1.245-5.284c.04-.16.088-.264.151-.312a.549.549 0 0 1 .32-.08h.638c.152 0 .256.025.32.08.063.048.12.16.151.312l1.261 5.348 1.381-5.348c.048-.16.104-.264.16-.312a.52.52 0 0 1 .311-.08h.743c.127 0 .2.065.2.2 0 .04-.009.08-.017.128a1.137 1.137 0 0 1-.056.2l-1.923 6.17c-.048.16-.104.263-.168.311a.51.51 0 0 1-.303.08h-.687c-.151 0-.255-.024-.32-.08-.063-.056-.119-.16-.15-.32l-1.238-5.148-1.23 5.14c-.04.16-.087.264-.15.32-.065.056-.177.08-.32.08zm10.256.215c-.415 0-.83-.048-1.229-.143-.399-.096-.71-.2-.918-.32-.128-.071-.215-.151-.247-.223a.563.563 0 0 1-.048-.224v-.407c0-.167.064-.247.183-.247.048 0 .096.008.144.024.048.016.12.048.2.08.271.12.566.215.878.279.319.064.63.096.95.096.502 0 .894-.088 1.165-.264a.86.86 0 0 0 .415-.758.777.777 0 0 0-.215-.559c-.144-.151-.416-.287-.807-.415l-1.157-.36c-.583-.183-1.014-.454-1.277-.813a1.902 1.902 0 0 1-.4-1.158c0-.335.073-.63.216-.886.144-.255.335-.479.575-.654.24-.184.51-.32.83-.415.32-.096.655-.136 1.006-.136.175 0 .359.008.535.032.183.024.35.056.518.088.16.04.312.08.455.127.144.048.256.096.336.144a.69.69 0 0 1 .24.2.43.43 0 0 1 .071.263v.375c0 .168-.064.256-.184.256a.83.83 0 0 1-.303-.096 3.652 3.652 0 0 0-1.532-.311c-.455 0-.815.071-1.062.223-.248.152-.375.383-.375.71 0 .224.08.416.24.567.159.152.454.304.877.44l1.134.358c.574.184.99.44 1.237.767.247.327.367.702.367 1.117 0 .343-.072.655-.207.926-.144.272-.336.511-.583.703-.248.2-.543.343-.886.447-.36.111-.734.167-1.142.167zM21.698 16.207c-2.626 1.94-6.442 2.969-9.722 2.969-4.598 0-8.74-1.7-11.87-4.526-.247-.223-.024-.527.272-.351 3.384 1.963 7.559 3.153 11.877 3.153 2.914 0 6.114-.607 9.06-1.852.439-.2.814.287.383.607zM22.792 14.961c-.336-.43-2.22-.207-3.074-.103-.255.032-.295-.192-.063-.36 1.5-1.053 3.967-.75 4.254-.399.287.36-.08 2.826-1.485 4.007-.215.184-.423.088-.327-.151.32-.79 1.03-2.57.695-2.994z"/></svg> | [AWS](https://docs.phase.dev/self-hosting/aws)                       |
| <svg fill="#4285F4" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Google Cloud</title><path d="M12.19 2.38a9.344 9.344 0 0 0-9.234 6.893c.053-.02-.055.013 0 0-3.875 2.551-3.922 8.11-.247 10.941l.006-.007-.007.03a6.717 6.717 0 0 0 4.077 1.356h5.173l.03.03h5.192c6.687.053 9.376-8.605 3.835-12.35a9.365 9.365 0 0 0-2.821-4.552l-.043.043.006-.05A9.344 9.344 0 0 0 12.19 2.38zm-.358 4.146c1.244-.04 2.518.368 3.486 1.15a5.186 5.186 0 0 1 1.862 4.078v.518c3.53-.07 3.53 5.262 0 5.193h-5.193l-.008.009v-.04H6.785a2.59 2.59 0 0 1-1.067-.23h.001a2.597 2.597 0 1 1 3.437-3.437l3.013-3.012A6.747 6.747 0 0 0 8.11 8.24c.018-.01.04-.026.054-.023a5.186 5.186 0 0 1 3.67-1.69z"/></svg>                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | [Google Cloud Platform](https://docs.phase.dev/self-hosting/gcp)     |
| <svg fill="#0078D4" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Microsoft Azure</title><path d="M22.379 23.343a1.62 1.62 0 0 0 1.536-2.14v.002L17.35 1.76A1.62 1.62 0 0 0 15.816.657H8.184A1.62 1.62 0 0 0 6.65 1.76L.086 21.204a1.62 1.62 0 0 0 1.536 2.139h4.741a1.62 1.62 0 0 0 1.535-1.103l.977-2.892 4.947 3.675c.28.208.618.32.966.32m-3.084-12.531 3.624 10.739a.54.54 0 0 1-.51.713v-.001h-.03a.54.54 0 0 1-.322-.106l-9.287-6.9h4.853m6.313 7.006c.116-.326.13-.694.007-1.058L9.79 1.76a1.722 1.722 0 0 0-.007-.02h6.034a.54.54 0 0 1 .512.366l6.562 19.445a.54.54 0 0 1-.338.684"/></svg>                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [Azure](https://docs.phase.dev/self-hosting/azure)                   |
| <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>DigitalOcean</title><path fill="#0080FF" d="M12.04 0C5.408-.02.005 5.37.005 11.992h4.638c0-4.923 4.882-8.731 10.064-6.855a6.95 6.95 0 014.147 4.148c1.889 5.177-1.924 10.055-6.84 10.064v-4.61H7.391v4.623h4.61V24c7.86 0 13.967-7.588 11.397-15.83-1.115-3.59-3.985-6.446-7.575-7.575A12.8 12.8 0 0012.039 0zM7.39 19.362H3.828v3.564H7.39zm-3.563 0v-2.978H.85v2.978z"/></svg>                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [DigitalOcean](https://docs.phase.dev/self-hosting/digitalocean)     |
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

You can join our [Slack](https://join.slack.com/t/phase-community/shared_invite/zt-1tkwzl31z-a6yCB5Uqlj~V2x43ep2Evg) if you have any questions!

---

## Resources

- [Website](https://phase.dev)
- [Docs](https://docs.phase.dev)
- [GitHub](https://github.com/phasehq/console)
- [Slack](https://join.slack.com/t/phase-community/shared_invite/zt-1tkwzl31z-a6yCB5Uqlj~V2x43ep2Evg)
