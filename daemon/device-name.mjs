// Single source for this machine's device name, used both for
// psyntient.io pairing (pairing.mjs) and for Neural Vault's
// Devices/<device_name>/ scoping (working-memory.mjs) so the two never
// drift apart.
import os from "node:os";

export function deviceName() {
  return os.hostname();
}
