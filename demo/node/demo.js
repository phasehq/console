const Phase = require("@phase.dev/phase-node");

const APP_ID =
  "phApp:v1:03c31a67e6374c83ba1c2bd7458859aed06151a9a1e0103c7a69ad7075338b05";
const APP_SECRET =
  "pss:v1:95c04786404b6bfb868b6a0f4d86a55f22f1f089dd808bbe983b9e08ee3830c9:40f3340696c9fa54819ca894c8fde63ff0b64eb4affc790cd5d422a2a71ec7eb:2bfb71d3a716723bef6ead8c569f11d27df35075425b0b10ef91973eb61b3711";

const phase = new Phase(APP_ID, APP_SECRET);

async function main() {
  const ciphertext = await phase.encrypt(
    "The quick brown fox jumped over the lazy dog!"
  );
  console.log(ciphertext, "\n");
  const plaintext = await phase.decrypt(ciphertext);
  console.log("Plaintext:", plaintext);
}

main().catch((error) => {
  console.error(error);
});
