<h1>
  <table align="center" border="0">
    <tr>
      <td>
        <img height="100" width="100" src="img/phase-logo.png" alt="Phase">
      </td>
      <td>
        Phase Console
      </td>
    </tr>
  </table>
    <h4 align="center">
  <a href="https://phase.dev">Website</a> |
    <a href="https://join.slack.com/t/infisical-users/shared_invite/zt-1kdbk07ro-RtoyEt_9E~fyzGo_xQYP6g">Slack</a> |
    <a href="https://phase.dev">Security</a> |
  <a href="https://docs.phase.dev">Docs</a>

  <h4>
</h1>
<p align="center">
  <p align="center">Open Source, end-to-end encrypted key management platform for developers to encrypt data in their apps.</p>
</p>

<img src="img/console-home.png" width="100%" alt="Phase Console" />

<div width="100%">
  <img src="img/console-logs.png" alt="Phase Console" width="48%">
  &nbsp; &nbsp; &nbsp; &nbsp;
  <img src="img/vscode-demo.png" alt="Phase Console" width="48%"/>
</div>
  
<br>

[Phase Console](https://phase.dev) is an open source, end-to-end encrypted key management solution for developers to seamlessly encrypt production data in their apps.

We're on a mission to make strong encryption accessible to all developers not just security teams. That means redesigning the entire developer experience from the ground up.

## Features

- **[Phase Console](https://console.phase.dev)**: Dashboard for seamlessly creating, rotating and monitoring key usage
- **[Phase KMS](https://phase.dev)**: A zero knowledge key management service
  the browsers of your users without any external API or sensitive keys. [Live Demo](https://phase.dev/#use-cases)
- **[Dual-Key Model](https://docs.phase.dev/security#dual-key-model)**: Decentralized private key deployment via [secret sharing schemes](https://en.wikipedia.org/wiki/Secret_sharing)
- **[Hold your keys](https://docs.phase.dev/security/phase-encryption#account-keyring)**: Maintain self-custody of your keys with 24 word mnemonic phrase
- **[Self Hosting](https://docs.phase.dev)**: Run Phase on your own infrastructure
- **[Client SDKs](https://docs.phase.dev/sdks)**: Asynchronously encrypt data in
- **[Server SDKs](https://docs.phase.dev/sdks)**: Securely decrypt and process data in memory only when you need to with 3 lines of code
- **[Phase I/O]()**: Self-hosted EaaS (Encryption as a Service) and a transparent proxy encryption (Coming Soon)

And much more.

---

## What about SSE?

Relying on automatic database, disk or bucket level encryption has its limitations, since the data is automatically decrypted when retrieved and the keys typically belong to the hosting provider. A breach is a single SQL or a IAM misconfiguration away.

See:

- [OWAP - Cryptographic Failures](https://owasp.org/Top10/A02_2021-Cryptographic_Failures/#example-attack-scenarios)
- [IAM misconfiguration](https://github.com/nagwww/s3-leaks)
- [Problems with S3 encryption](https://www.secwale.com/p/encryption)

---

## Getting started

Check out the [Quickstart](https://docs.phase.dev/quickstart) Guides

### Use Phase Cloud

The quickest and most reliable way to get started is making a new free account on the [Phase Console](https://console.phase.dev/).

### Deploy Phase Console on premise (Coming soon)

Deployment options: WIP: [Docker]()

---

### SDKs

- [JavaScript Browser](https://github.com/phasehq/client-js-sdk)

- [Node.js](https://github.com/phasehq/node-sdk)

- [Python](https://github.com/phasehq/python-sdk)

More coming soon!

Example:

```js
// Import & initialize
const Phase = require('@phase.dev/phase-node')
const phase = new Phase(APP_ID, APP_SECRET)

// Encrypt
const ciphertext = await phase.encrypt('hello world')

// Decrypt
const plaintext = await phase.decrypt(ciphertext)
console.log(ciphertext)
$ hello world
```

---

## Community vs Enterprise edition

This repo available under the [MIT expat license](/LICENSE), with the exception of the `ee` directory which will contain premium Pro or Enterprise features requiring a Phase license in the future.

---

## Security

For more information of how Phase encryption works, please see the [Security Docs](https://docs.phase.dev/security/overview)

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
