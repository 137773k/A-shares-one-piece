"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROVIDER_CONFIG_VERSION = 1;
const PROVIDER_CONFIG_FILE = "provider-config.json";
const PROVIDER_DIRECTORY = "providers";
const SECRET_KEY_PATTERN = /token|secret|password|passwd|cookie|authorization|api.?key/i;
const CREDENTIAL_ENV_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;

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
  if (path.dirname(resolved) !== directory) return null;
  if (fs.existsSync(resolved)) {
    try {
      const realDirectory = fs.realpathSync(directory);
      const realResolved = fs.realpathSync(resolved);
      if (path.dirname(realResolved) !== realDirectory) return null;
    } catch {
      return null;
    }
  }
  return resolved;
}

function listProviderModules(runtimeRoot) {
  const directory = path.resolve(runtimeRoot || process.cwd(), "data", PROVIDER_DIRECTORY);
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && safeProviderModulePath(runtimeRoot, entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
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

function publicProviderConfiguration(runtimeRoot) {
  const configuration = readProviderConfiguration(runtimeRoot);
  const source = isObject(configuration.config) ? configuration.config : {};
  return {
    schemaVersion: PROVIDER_CONFIG_VERSION,
    configured: configuration.configured === true,
    mode: ['auto', 'custom_first'].includes(String(source.mode)) ? String(source.mode) : "auto",
    providers: Array.isArray(source.providers) ? source.providers.map((entry) => ({
      module: String(entry && entry.module || ""),
      enabled: entry && entry.enabled === true,
      priority: Number(entry && entry.priority || 100),
      credentialEnv: Array.isArray(entry && entry.credentialEnv)
        ? entry.credentialEnv.map((name) => String(name || "")).filter(Boolean)
        : [],
    })) : [],
    availableModules: listProviderModules(runtimeRoot),
    errors: [...configuration.errors],
    configPath: `data/${PROVIDER_CONFIG_FILE}`,
    providerDirectory: `data/${PROVIDER_DIRECTORY}`,
    secretsStoredInConfig: false,
  };
}

function normalizeProviderConfigurationInput(runtimeRoot, input) {
  const source = isObject(input) ? input : {};
  const errors = [];
  const mode = ['auto', 'custom_first'].includes(String(source.mode)) ? String(source.mode) : "";
  if (!mode) errors.push("provider_config_mode_invalid");
  const rows = Array.isArray(source.providers) ? source.providers : [];
  if (!Array.isArray(source.providers) || rows.length > 16) errors.push("provider_config_entries_invalid");
  const providers = [];
  rows.slice(0, 16).forEach((entry, index) => {
    if (!isObject(entry)) {
      errors.push(`provider_entry_invalid:${index}`);
      return;
    }
    const module = String(entry.module || "").trim();
    const moduleFile = safeProviderModulePath(runtimeRoot, module);
    if (!moduleFile || !fs.existsSync(moduleFile) || !fs.statSync(moduleFile).isFile()) {
      errors.push(`provider_module_missing:${module || index}`);
      return;
    }
    const priority = Number(entry.priority);
    if (!Number.isInteger(priority) || priority < -1000 || priority > 10000) {
      errors.push(`provider_priority_invalid:${module}`);
      return;
    }
    const credentialEnv = Array.isArray(entry.credentialEnv)
      ? Array.from(new Set(entry.credentialEnv.map((name) => String(name || "").trim()).filter(Boolean)))
      : [];
    if (credentialEnv.some((name) => !CREDENTIAL_ENV_PATTERN.test(name))) {
      errors.push(`provider_credential_env_invalid:${module}`);
      return;
    }
    providers.push({ module, enabled: entry.enabled === true, priority, credentialEnv });
  });
  if (new Set(providers.map((entry) => entry.module)).size !== providers.length) {
    errors.push("provider_module_duplicate");
  }
  return {
    valid: errors.length === 0,
    errors: Array.from(new Set(errors)),
    config: { schemaVersion: PROVIDER_CONFIG_VERSION, mode: mode || "auto", providers },
  };
}

function writeProviderConfiguration(runtimeRoot, input) {
  const root = path.resolve(runtimeRoot || process.cwd());
  if (configContainsSecretValue(input)) {
    const error = new Error("配置中禁止保存Token、密码、Cookie或密钥值");
    error.code = "provider_config_contains_secret_value";
    throw error;
  }
  const normalized = normalizeProviderConfigurationInput(root, input);
  if (!normalized.valid) {
    const error = new Error(normalized.errors.join(","));
    error.code = "provider_config_invalid";
    error.reasons = normalized.errors;
    throw error;
  }
  const directory = path.resolve(root, "data");
  const configFile = path.resolve(directory, PROVIDER_CONFIG_FILE);
  fs.mkdirSync(directory, { recursive: true });
  const tempFile = path.resolve(directory, `.${PROVIDER_CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tempFile, `${JSON.stringify(normalized.config, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(tempFile, configFile);
  } finally {
    try { fs.rmSync(tempFile, { force: true }); } catch { /* best effort */ }
  }
  return publicProviderConfiguration(root);
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
        ? entry.credentialEnv.map((name) => String(name || "").trim()).filter((name) => CREDENTIAL_ENV_PATTERN.test(name))
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
  CREDENTIAL_ENV_PATTERN,
  configContainsSecretValue,
  listProviderModules,
  loadConfiguredProviders,
  normalizeProviderConfigurationInput,
  publicProviderConfiguration,
  readProviderConfiguration,
  safeProviderModulePath,
  writeProviderConfiguration,
};
