"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROVIDER_CONFIG_VERSION = 1;
const PROVIDER_CONFIG_FILE = "provider-config.json";
const PROVIDER_DIRECTORY = "providers";
const SECRET_KEY_PATTERN = /token|secret|password|passwd|cookie|authorization|api.?key/i;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function configContainsSecretValue(value, key = "", depth = 0) {
  if (depth > 8 || value === null || value === undefined) return false;
  if (key === "credentialEnv") return false;
  if (Array.isArray(value)) return value.some((entry) => configContainsSecretValue(entry, key, depth + 1));
  if (!isObject(value)) return SECRET_KEY_PATTERN.test(key) && String(value).trim().length > 0;
  return Object.entries(value).some(([nestedKey, nested]) => (
    configContainsSecretValue(nested, nestedKey, depth + 1)
  ));
}

function safeProviderModulePath(runtimeRoot, moduleName) {
  const name = String(moduleName || "").trim();
  if (!/^[a-zA-Z0-9._-]+\.(?:js|cjs)$/.test(name)) return null;
  const directory = path.resolve(runtimeRoot, "data", PROVIDER_DIRECTORY);
  const resolved = path.resolve(directory, name);
  return path.dirname(resolved) === directory ? resolved : null;
}

function readProviderConfiguration(runtimeRoot) {
  const configFile = path.resolve(runtimeRoot, "data", PROVIDER_CONFIG_FILE);
  if (!fs.existsSync(configFile)) {
    return {
      configured: false,
      configFile,
      config: { schemaVersion: PROVIDER_CONFIG_VERSION, mode: "auto", providers: [] },
      errors: [],
    };
  }
  try {
    const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    const errors = [];
    if (!isObject(config) || config.schemaVersion !== PROVIDER_CONFIG_VERSION) errors.push("provider_config_schema_invalid");
    if (!['auto', 'custom_first'].includes(String(config.mode || "auto"))) errors.push("provider_config_mode_invalid");
    if (!Array.isArray(config.providers) || config.providers.length > 16) errors.push("provider_config_entries_invalid");
    if (configContainsSecretValue(config)) errors.push("provider_config_contains_secret_value");
    return { configured: true, configFile, config, errors };
  } catch (error) {
    return {
      configured: true,
      configFile,
      config: { schemaVersion: PROVIDER_CONFIG_VERSION, mode: "auto", providers: [] },
      errors: [`provider_config_read_failed:${String(error && error.message || error).slice(0, 180)}`],
    };
  }
}

function loadConfiguredProviders({ runtimeRoot, env = process.env } = {}) {
  const root = path.resolve(runtimeRoot || process.cwd());
  const configuration = readProviderConfiguration(root);
  const providers = [];
  const errors = [...configuration.errors];
  if (errors.length) return { providers, diagnostics: sanitizeDiagnostics(configuration, errors) };
  for (const entry of configuration.config.providers || []) {
    if (!isObject(entry) || entry.enabled !== true) continue;
    const moduleFile = safeProviderModulePath(root, entry.module);
    if (!moduleFile) {
      errors.push(`provider_module_path_invalid:${String(entry.module || "")}`);
      continue;
    }
    if (!fs.existsSync(moduleFile)) {
      errors.push(`provider_module_missing:${path.basename(moduleFile)}`);
      continue;
    }
    try {
      delete require.cache[require.resolve(moduleFile)];
      const exported = require(moduleFile);
      const credentialNames = Array.isArray(entry.credentialEnv)
        ? entry.credentialEnv.map((name) => String(name || "").trim()).filter((name) => /^[A-Z][A-Z0-9_]{2,63}$/.test(name))
        : [];
      const credentials = Object.fromEntries(credentialNames.map((name) => [name, String(env[name] || "")]));
      const provider = typeof exported.createProvider === "function"
        ? exported.createProvider({ runtimeRoot: root, credentials })
        : exported.provider || exported;
      if (!isObject(provider)) throw new Error("provider module did not export an object");
      providers.push({ ...provider, priority: Number(entry.priority ?? provider.priority ?? 100) });
    } catch (error) {
      errors.push(`provider_module_load_failed:${path.basename(moduleFile)}:${String(error && error.message || error).slice(0, 160)}`);
    }
  }
  return { providers, diagnostics: sanitizeDiagnostics(configuration, errors) };
}

function sanitizeDiagnostics(configuration, errors) {
  return {
    version: PROVIDER_CONFIG_VERSION,
    configured: configuration.configured === true,
    mode: String(configuration.config && configuration.config.mode || "auto"),
    enabledCount: Array.isArray(configuration.config && configuration.config.providers)
      ? configuration.config.providers.filter((entry) => entry && entry.enabled === true).length : 0,
    errors: Array.from(new Set(errors)),
    freeFallbackEnabled: true,
    credentialsStoredInConfig: false,
  };
}

module.exports = {
  PROVIDER_CONFIG_FILE,
  PROVIDER_CONFIG_VERSION,
  PROVIDER_DIRECTORY,
  configContainsSecretValue,
  loadConfiguredProviders,
  readProviderConfiguration,
  safeProviderModulePath,
};
