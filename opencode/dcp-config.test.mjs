import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const packageSpec = "@tarquinen/opencode-dcp@3.1.15";
const sourceRevision = "11f6517780a502512a3467645074be447cb0369e";

async function readJson(relativePath) {
	return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"));
}

test("DCP is pinned once and loads after existing profile and TUI plugins", async () => {
	const [profile, profilePackage, tui] = await Promise.all([
		readJson("opencode/profile/opencode.jsonc"),
		readJson("opencode/profile/package.json"),
		readJson("opencode/tui.jsonc"),
	]);

	assert.deepEqual(profile.plugin, [packageSpec]);
	assert.deepEqual(tui.plugin, [
		"./herdr-tui-session.js",
		"./tui-plugins/hunk-review.js",
		packageSpec,
	]);
	assert.equal(profile.command?.["dcp-compress"], undefined);
	assert.equal(profilePackage.dependencies["@tarquinen/opencode-dcp"], "3.1.15");
	assert.equal(profilePackage.dependencies["@opencode-ai/plugin"], "1.4.3");
});

test("DCP starts in conservative manual mode with immutable schema provenance", async () => {
	const config = await readJson("opencode/profile/dcp.jsonc");

	assert.equal(
		config.$schema,
		`https://raw.githubusercontent.com/Opencode-DCP/opencode-dynamic-context-pruning/${sourceRevision}/dcp.schema.json`,
	);
	assert.equal(config.enabled, true);
	assert.equal(config.autoUpdate, false);
	assert.equal(config.debug, true);
	assert.equal(config.manualMode.enabled, true);
	assert.equal(config.manualMode.automaticStrategies, false);
	assert.equal(config.turnProtection.enabled, true);
	assert.equal(config.turnProtection.turns, 8);
	assert.equal(config.experimental.allowSubAgents, false);
	assert.equal(config.experimental.customPrompts, false);
	assert.equal(config.compress.permission, "ask");
	assert.equal(config.compress.protectUserMessages, true);
	assert.equal(config.strategies.deduplication.enabled, false);
	assert.equal(config.strategies.purgeErrors.enabled, false);
});

test("DCP's exact artifact and AGPL license are recorded", async () => {
	const notices = await readFile(path.join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
	assert.match(notices, new RegExp(packageSpec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.match(notices, new RegExp(sourceRevision));
	assert.match(notices, /AGPL-3\.0-or-later/);
	assert.match(notices, /sha512-cjBWL\+CvcuiSCocU8dBqVAuKPwMIIfi2C3IpyX8c2uLcCD95F\/8zctrVnlgbYWJbkc6ZyHVvn\+8t3wVMRd\/15Q==/);
});
