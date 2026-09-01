"use strict";

const STATE_VERSION = 1;
const DEFAULT_THRESHOLDS = Object.freeze({
  confirmImpactDays: 2,
  challengeNoImpactDays: 2,
  expireNoImpactDays: 3,
});

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function unique(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function thresholdsOf(policy) {
  const source = policy && typeof policy === "object" ? policy : {};
  const positive = (value, fallback) => {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };
  return {
    confirmImpactDays: positive(source.confirmImpactDays, DEFAULT_THRESHOLDS.confirmImpactDays),
    challengeNoImpactDays: positive(source.challengeNoImpactDays, DEFAULT_THRESHOLDS.challengeNoImpactDays),
    expireNoImpactDays: positive(source.expireNoImpactDays, DEFAULT_THRESHOLDS.expireNoImpactDays),
  };
}

function emptyIdentity(observation, thresholds) {
  return {
    version: STATE_VERSION,
    cycleInstanceId: clean(observation && observation.cycleInstanceId) || null,
    code: clean(observation && observation.code) || null,
    state: "candidate",
    identityEstablished: false,
    activePrimary: false,
    validImpactDays: 0,
    cumulativeImpactStrength: 0,
    averageImpactStrength: 0,
    lastImpactStrength: 0,
    consecutiveNoImpactDays: 0,
    impactTradingDates: [],
    confirmedTradingDates: [],
    confirmedAt: null,
    lastImpactAt: null,
    lastEvaluatedTradingDate: null,
    challengedAt: null,
    expiredAt: null,
    replacedAt: null,
    replacedBy: null,
    frozen: false,
    calibrated: false,
    thresholds: { ...thresholds },
    history: [],
  };
}

function cycleMatches(previous, observation) {
  if (!previous || typeof previous !== "object") return false;
  return clean(previous.cycleInstanceId) === clean(observation && observation.cycleInstanceId)
    && clean(previous.code) === clean(observation && observation.code);
}

function eventOf(observation, type) {
  return {
    tradingDate: clean(observation && observation.tradingDate) || null,
    type,
    validCrossStockImpact: observation && observation.validCrossStockImpact === true,
    limitUp: observation && observation.limitUp === true,
    hardBreak: observation && observation.hardBreak === true,
    negativeFeedback: observation && observation.negativeFeedback === true,
    identitySupport: observation && observation.identitySupport === true,
    leadershipStrength: Number.isFinite(Number(observation && observation.leadershipStrength))
      ? Number(observation.leadershipStrength)
      : null,
    source: clean(observation && observation.source) || null,
    dataQuality: clean(observation && observation.dataQuality) || null,
    evidence: observation && observation.evidence && typeof observation.evidence === "object"
      ? { ...observation.evidence }
      : null,
  };
}

function advanceCycleLeaderState(previous, observation, policy = {}) {
  const input = observation && typeof observation === "object" ? observation : {};
  const thresholds = thresholdsOf(policy);
  const sameCycle = cycleMatches(previous, input);
  const base = sameCycle
    ? { ...previous, thresholds: { ...thresholds } }
    : emptyIdentity(input, thresholds);
  const tradingDate = clean(input.tradingDate);

  // Multiple intraday refreshes of the same completed session must not add hits
  // or misses. The frozen/raw evidence can be updated elsewhere, not here.
  if (sameCycle && tradingDate && tradingDate === clean(previous.lastEvaluatedTradingDate)) {
    return previous;
  }

  if (input.dataComplete !== true || !tradingDate || !clean(input.cycleInstanceId) || !clean(input.code)) {
    return {
      ...base,
      frozen: true,
      thresholds: { ...thresholds },
      calibrated: false,
    };
  }

  const impact = input.validCrossStockImpact === true;
  const inputStrength = Number(input.leadershipStrength);
  const impactStrength = impact && Number.isFinite(inputStrength) ? Math.max(0, inputStrength) : 0;
  const hardNegativeBreak = input.hardBreak === true && input.negativeFeedback === true;
  const identitySupport = input.identitySupport === true && !hardNegativeBreak;
  const impactTradingDates = impact
    ? unique([...(base.impactTradingDates || []), tradingDate])
    : unique(base.impactTradingDates || []);
  const validImpactDays = impactTradingDates.length;
  const cumulativeImpactStrength = Number(base.cumulativeImpactStrength || 0) + impactStrength;
  const averageImpactStrength = validImpactDays > 0
    ? cumulativeImpactStrength / validImpactDays
    : 0;
  let identityEstablished = base.identityEstablished === true;
  let activePrimary = base.activePrimary === true;
  let state = clean(base.state) || "candidate";
  let consecutiveNoImpactDays = impact || identitySupport ? 0 : Number(base.consecutiveNoImpactDays || 0) + 1;
  let confirmedAt = base.confirmedAt || null;
  let challengedAt = base.challengedAt || null;
  let expiredAt = base.expiredAt || null;

  if (impact) {
    if (!identityEstablished && validImpactDays >= thresholds.confirmImpactDays) {
      identityEstablished = true;
      confirmedAt = tradingDate;
    }
    state = identityEstablished ? "confirmed" : "candidate";
    activePrimary = identityEstablished;
    challengedAt = null;
    expiredAt = null;
  } else if (identityEstablished) {
    if (hardNegativeBreak) {
      state = "challenged";
      activePrimary = false;
      consecutiveNoImpactDays = Math.max(consecutiveNoImpactDays, thresholds.challengeNoImpactDays);
      challengedAt = tradingDate;
    } else if (identitySupport) {
      // A cycle leader does not need to re-prove cross-stock impact every day.
      // As long as its structure, attention and same-cycle recognition remain,
      // ordinary consolidation keeps the identity active. Only genuine loss of
      // support or hard negative feedback advances challenge/expiry counters.
      state = "retained";
      activePrimary = true;
    } else if (consecutiveNoImpactDays >= thresholds.expireNoImpactDays) {
      state = "expired";
      activePrimary = false;
      challengedAt = challengedAt || tradingDate;
      expiredAt = tradingDate;
    } else if (consecutiveNoImpactDays >= thresholds.challengeNoImpactDays) {
      state = "challenged";
      activePrimary = false;
      challengedAt = tradingDate;
    } else {
      state = "retained";
      activePrimary = true;
    }
  } else {
    state = "candidate";
    activePrimary = false;
  }

  return {
    ...base,
    version: STATE_VERSION,
    cycleInstanceId: clean(input.cycleInstanceId),
    code: clean(input.code),
    state,
    identityEstablished,
    activePrimary,
    validImpactDays,
    cumulativeImpactStrength,
    averageImpactStrength,
    lastImpactStrength: impact ? impactStrength : Number(base.lastImpactStrength || 0),
    consecutiveNoImpactDays,
    impactTradingDates,
    confirmedTradingDates: identityEstablished ? impactTradingDates.slice() : [],
    confirmedAt,
    lastImpactAt: impact ? tradingDate : base.lastImpactAt || null,
    lastEvaluatedTradingDate: tradingDate,
    challengedAt,
    expiredAt,
    replacedAt: null,
    replacedBy: null,
    frozen: false,
    calibrated: false,
    thresholds: { ...thresholds },
    history: [
      ...(Array.isArray(base.history) ? base.history : []),
      eventOf(input, hardNegativeBreak ? "hard_negative_break" : impact ? "impact" : identitySupport ? "identity_supported" : "no_impact"),
    ],
  };
}

function replacementCandidate(identities, excludedCode) {
  return Object.values(identities)
    .filter((identity) => identity && identity.code !== excludedCode)
    .filter((identity) => identity.identityEstablished === true && identity.state === "confirmed")
    .sort((left, right) => (
      Number(right.averageImpactStrength || 0) - Number(left.averageImpactStrength || 0)
      || Number(right.cumulativeImpactStrength || 0) - Number(left.cumulativeImpactStrength || 0)
      || Number(right.validImpactDays || 0) - Number(left.validImpactDays || 0)
      || clean(left.confirmedAt).localeCompare(clean(right.confirmedAt))
      || clean(left.code).localeCompare(clean(right.code))
    ))[0] || null;
}

function advanceThemeCycleLeaders(previous, snapshot, policy = {}) {
  const input = snapshot && typeof snapshot === "object" ? snapshot : {};
  const thresholds = thresholdsOf(policy);
  const cycleInstanceId = clean(input.cycleInstanceId) || null;
  const sameCycle = Boolean(previous && clean(previous.cycleInstanceId) === cycleInstanceId);
  const tradingDate = clean(input.tradingDate);
  if (sameCycle && tradingDate && tradingDate === clean(previous.lastEvaluatedTradingDate)) return previous;

  const priorIdentities = sameCycle && previous.identities && typeof previous.identities === "object"
    ? previous.identities
    : {};
  if (input.dataComplete !== true || !cycleInstanceId || !tradingDate) {
    return {
      version: STATE_VERSION,
      cycleInstanceId,
      activeLeaderCode: sameCycle ? previous.activeLeaderCode || null : null,
      identities: { ...priorIdentities },
      replacement: sameCycle ? previous.replacement || null : null,
      lastEvaluatedTradingDate: sameCycle ? previous.lastEvaluatedTradingDate || null : null,
      frozen: true,
      calibrated: false,
      thresholds: { ...thresholds },
    };
  }

  const observations = Array.isArray(input.observations) ? input.observations : [];
  const byCode = new Map(observations.map((row) => [clean(row && row.code), row]).filter(([code]) => code));
  const codes = unique([...Object.keys(priorIdentities), ...byCode.keys()]);
  const identities = {};
  codes.forEach((code) => {
    const row = byCode.get(code);
    if (!row) {
      identities[code] = { ...priorIdentities[code], frozen: true };
      return;
    }
    identities[code] = advanceCycleLeaderState(priorIdentities[code] || null, {
      ...row,
      tradingDate,
      cycleInstanceId,
      code,
      dataComplete: input.dataComplete === true && row.dataComplete !== false,
    }, thresholds);
  });

  const priorLeaderCode = sameCycle ? clean(previous.activeLeaderCode) : "";
  const priorLeader = priorLeaderCode ? identities[priorLeaderCode] : null;
  const challenger = replacementCandidate(identities, priorLeaderCode);
  let activeLeaderCode = priorLeader && priorLeader.activePrimary === true ? priorLeaderCode : null;
  let replacement = sameCycle ? previous.replacement || null : null;

  if (priorLeader && ["challenged", "expired"].includes(priorLeader.state) && challenger) {
    identities[priorLeaderCode] = {
      ...priorLeader,
      state: "replaced",
      activePrimary: false,
      replacedAt: tradingDate,
      replacedBy: challenger.code,
      history: [
        ...(Array.isArray(priorLeader.history) ? priorLeader.history : []),
        { tradingDate, type: "replaced", replacedBy: challenger.code },
      ],
    };
    activeLeaderCode = challenger.code;
    replacement = { from: priorLeaderCode, to: challenger.code, tradingDate };
  } else if (!priorLeaderCode && challenger) {
    activeLeaderCode = challenger.code;
  }

  // A confirmed challenger remains a challenger until the incumbent is truly
  // challenged; never expose two active cycle leaders in one theme instance.
  Object.keys(identities).forEach((code) => {
    identities[code] = { ...identities[code], activePrimary: code === activeLeaderCode };
  });

  return {
    version: STATE_VERSION,
    cycleInstanceId,
    activeLeaderCode,
    identities,
    replacement,
    lastEvaluatedTradingDate: tradingDate,
    frozen: false,
    calibrated: false,
    thresholds: { ...thresholds },
  };
}

module.exports = {
  STATE_VERSION,
  DEFAULT_THRESHOLDS,
  advanceCycleLeaderState,
  advanceThemeCycleLeaders,
};
