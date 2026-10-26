#!/usr/bin/env bun
/**
 * One-time entity secret registration for Circle developer-controlled wallets.
 * Run once per Circle entity. Never run again — it replaces the registered secret.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { registerEntitySecretCiphertext, initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const apiKey = process.env.CIRCLE_API_KEY;
if (!apiKey) {
  console.error("ERROR: CIRCLE_API_KEY not set in environment.");
  process.exit(1);
}

const entitySecret = crypto.randomBytes(32).toString("hex");

const recoveryDir = "/home/user/app/.circle";
fs.mkdirSync(recoveryDir, { recursive: true });

console.log("Registering entity secret ciphertext with Circle...");

const response = await registerEntitySecretCiphertext({
  apiKey,
  entitySecret,
  recoveryFileDownloadPath: recoveryDir,
});

const recoveryPath = path.join(recoveryDir, "recovery_file.dat");
if (response.data?.recoveryFile) {
  fs.writeFileSync(recoveryPath, response.data.recoveryFile);
}

// Persist secret to .env
const envPath = path.join("/home/user/app", ".env");
fs.appendFileSync(envPath, `\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`, "utf-8");

// Verify registration
const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
await client.listWalletSets({ pageSize: 1 });

console.log("SUCCESS: Entity secret registered and verified.");
console.log(`Recovery file written to: ${recoveryPath}`);
console.log("CIRCLE_ENTITY_SECRET has been appended to .env");
