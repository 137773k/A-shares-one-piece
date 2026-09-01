"use strict";

const {
  CAPABILITY_VALUES,
  createCapabilityEnvelope,
  inferAdjustment,
  inferObservedAt,
  inferTradingDate,
  validateCapabilityEnvelope,
  validateProviderDescriptor,
} = require("./contracts");

function safeError(error) {
  return String(error && error.message || error || "provider_failed").slice(0, 300);
}

class DataProviderRegistry {
  constructor() {
    this.providers = [];
  }

  register(provider) {
    const inspection = validateProviderDescriptor(provider);
    if (!inspection.valid) throw new Error(`invalid data provider: ${inspection.reasons.join(",")}`);
    if (this.providers.some((entry) => entry.id === provider.id)) throw new Error(`duplicate data provider: ${provider.id}`);
    this.providers.push(provider);
    this.providers.sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
    return this;
  }

  list() {
    return this.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      kind: provider.kind,
      priority: Number(provider.priority || 0),
      capabilities: [...provider.capabilities],
      executionAuthority: false,
    }));
  }

  async invoke(capability, args = [], context = {}) {
    if (!CAPABILITY_VALUES.includes(capability)) throw new Error(`unknown data capability: ${capability}`);
    const attempts = [];
    const candidates = this.providers.filter((provider) => provider.capabilities.includes(capability));
    for (const provider of candidates) {
      try {
        const raw = await provider.invoke(capability, ...(Array.isArray(args) ? args : [args]));
        const envelope = raw && raw.version === 1 && raw.capability
          ? { ...raw, executionAuthority: false }
          : createCapabilityEnvelope({
              capability,
              providerId: provider.id,
              data: raw,
              observedAt: inferObservedAt(raw) || context.observedAt,
              tradingDate: inferTradingDate(raw) || context.tradingDate,
              adjustment: inferAdjustment(raw) || context.adjustment,
              quality: raw === null || raw === undefined ? "unavailable" : "live",
            });
        const inspection = validateCapabilityEnvelope(envelope, {
          expectedTradingDate: context.expectedTradingDate,
          expectedAdjustment: context.expectedAdjustment,
        });
        attempts.push({ providerId: provider.id, valid: inspection.valid, reasons: inspection.reasons });
        if (inspection.valid && envelope.usable === true) return { envelope, attempts };
      } catch (error) {
        attempts.push({ providerId: provider.id, valid: false, reasons: [safeError(error)] });
      }
    }
    return {
      envelope: createCapabilityEnvelope({
        capability,
        providerId: candidates.at(-1) && candidates.at(-1).id || "unavailable-provider",
        data: null,
        observedAt: context.observedAt,
        tradingDate: context.tradingDate,
        adjustment: context.adjustment,
        quality: "unavailable",
        errors: attempts.flatMap((attempt) => attempt.reasons),
      }),
      attempts,
    };
  }
}

module.exports = { DataProviderRegistry };
