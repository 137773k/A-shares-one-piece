"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  computeBacktestContractHash,
  computeBacktestRunId,
  computeStrategyBaselineHash,
  createBacktestRunManifest,
  inspectBacktestExecutionReadiness,
  loadBacktestContract,
  loadBacktestContractRegistry,
  validateBacktestContract,
  validateBacktestContractRegistry,
} = require("./backtest/contract");

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function rehash(contract) {
  contract.strategyBaseline.strategyHash = computeStrategyBaselineHash(contract);
  contract.integrity.contractHash = computeBacktestContractHash(contract);
  return contract;
}

const FAST_VALIDATION = Object.freeze({ verifySourceFiles: false, verifyGit: false });
const LEGACY_REGISTRY_PATH = path.join(__dirname, "backtest", "contracts", "registry.json");
const V6_CONTRACT_PATH = path.join(__dirname, "backtest", "contracts", "strategy-v6.json");
const V8_CONTRACT_PATH = path.join(__dirname, "backtest", "contracts", "strategy-v8.json");

function loadV6Contract() {
  return loadBacktestContract(V6_CONTRACT_PATH);
}

function loadV8Contract() {
  return loadBacktestContract(V8_CONTRACT_PATH);
}

test("strategy-v8公开仓库契约、Git基线、源码和运行版本全部一致", () => {
  const contract = loadV8Contract();
  const inspection = validateBacktestContract(contract);
  const pendingRegistryCommit = inspection.reasons.includes("working_registry_differs_from_head");
  assert.deepEqual(
    inspection.reasons.filter((reason) => reason !== "working_registry_differs_from_head"),
    [],
    inspection.reasons.join(";"),
  );
  assert.equal(inspection.valid, !pendingRegistryCommit);
  assert.equal(loadBacktestContract().contractVersion, "v8");
  assert.equal(inspection.contractHash, contract.integrity.contractHash);
  assert.equal(inspection.strategyHash, contract.strategyBaseline.strategyHash);
  assert.equal(contract.strategyBaseline.sourceCommit, "8e77f92fcbb0ea0ceae332979d863d50e108ae0b");
  assert.equal(contract.strategyBaseline.sourceTree.fileCount, 81);
  assert.equal(inspection.fileAudit.length, 35);
  assert(inspection.fileAudit.every((row) => row.currentMatches && row.commitMatches));
  assert.equal(inspection.registryAudit.valid, !pendingRegistryCommit);
  if (pendingRegistryCommit) {
    assert.deepEqual(inspection.registryAudit.reasons, ["working_registry_differs_from_head"]);
  }
  assert.equal(inspection.registryAudit.entry.contractVersion, "v8");
  assert.equal(inspection.registryAudit.entry.contractCommit, "c6833604239c5568cd045d159851dd4d2c253e08");
  assert.equal(contract.signals.asDecided.allowObservationCandidates, false);
  assert.equal(contract.signals.asDecided.allowLegacySelected, false);
  assert.equal(contract.signals.counterfactual.receiptAllowed, false);
  assert.equal(contract.signals.counterfactual.asDecided, false);
  assert.equal(contract.signals.asDecided.cashOnlyReceiptAllowed, true);
  assert.equal(contract.signals.asDecided.requiredIdentityFields[1], "hashes.decisionHash");
  assert.equal(contract.portfolio.preserveCashForUntriggered, true);
  assert.equal(contract.portfolio.tradingUnitSource, "PROVIDER_SECURITY_AND_DATE_SPECIFIC_RULES");
  assert.equal(contract.entry.fillMethod, "NEXT_1M_BAR_OPEN");
  assert.equal(contract.entry.barIntervalMinutes, 1);
  assert.equal(contract.minuteEvidence.fullSessionBarCount, 240);
  assert.equal(contract.minuteEvidence.barStartObservationPolicy, "OBSERVED_AT_BAR_START_PLUS_60_SECONDS");
  assert.equal(contract.exit.earliestSession, "T_PLUS_2");
  assert.equal(contract.exit.markToMarketAtEntryDayClose, true);
  assert.equal(contract.exit.stateMachine.lowerLayer.hardStopLossPctFromActualComparableFill, 7);
  assert.equal(contract.exit.stateMachine.lowerLayer.peakProfitKeepRatio, 0.7);
  assert.equal(contract.exit.stateMachine.lowerLayer.trendMaximumHoldingSessions, null);
  assert.equal(contract.dataPolicy.legacyT1OutcomeUse, "EVALUATION_ONLY_NOT_REALIZED_PNL");
  assert.equal(contract.lanes.combineMetrics, false);
  assert.equal(contract.sellVariants.combineMetrics, false);
  assert.equal(contract.sellVariants.productionManualTickAccepted, false);
});

test("V1至V6契约文件与既有registry哈希保持不变", () => {
  const registry = loadBacktestContractRegistry(LEGACY_REGISTRY_PATH);
  for (const entry of registry.entries.filter((row) => /^v[1-6]$/.test(row.contractVersion))) {
    const historical = loadBacktestContract(path.join(__dirname, entry.contractPath));
    assert.equal(computeBacktestContractHash(historical), entry.contractHash, entry.contractVersion);
    assert.equal(historical.integrity.contractHash, entry.contractHash, entry.contractVersion);
  }
});

test("任何未重算哈希的契约修改都会失败", () => {
  const contract = loadV6Contract();
  contract.entry.slippageBps = 0;
  const inspection = validateBacktestContract(contract, FAST_VALIDATION);
  assert.equal(inspection.valid, false);
  assert(inspection.reasons.includes("contract_hash_mismatch"));
});

test("即使攻击者重算哈希，也不能放宽观察股、强制补票或T+1边界", () => {
  const observation = rehash(copy(loadV6Contract()));
  observation.signals.asDecided.allowObservationCandidates = true;
  rehash(observation);
  assert(validateBacktestContract(observation, FAST_VALIDATION).reasons.includes("observation_candidates_can_enter_backtest"));

  const forced = rehash(copy(loadV6Contract()));
  forced.signals.asDecided.allowForcedCandidate = true;
  rehash(forced);
  assert(validateBacktestContract(forced, FAST_VALIDATION).reasons.includes("forced_candidate_allowed"));

  const sameDayExit = rehash(copy(loadV6Contract()));
  sameDayExit.portfolio.allowSameDaySell = true;
  rehash(sameDayExit);
  assert(validateBacktestContract(sameDayExit, FAST_VALIDATION).reasons.includes("portfolio_t1_sell_rule_invalid"));

  const mixed = rehash(copy(loadV6Contract()));
  mixed.lanes.combineMetrics = true;
  rehash(mixed);
  assert(validateBacktestContract(mixed, FAST_VALIDATION).reasons.includes("backtest_lanes_can_be_combined"));

  const sameDayRealizedExit = rehash(copy(loadV6Contract()));
  sameDayRealizedExit.exit.earliestSession = "T_PLUS_1";
  sameDayRealizedExit.exit.method = "EXACT_T1_CLOSE";
  rehash(sameDayRealizedExit);
  const sameDayReasons = validateBacktestContract(sameDayRealizedExit, FAST_VALIDATION).reasons;
  assert(sameDayReasons.includes("exit_earliest_session_invalid"));
  assert(sameDayReasons.includes("exit_method_invalid"));
});

test("V7重算哈希也不能放宽一分钟、分层卖出、上下文和成交回执边界", () => {
  const cases = [
    ["entry_5m", (value) => { value.entry.fillMethod = "NEXT_5M_BAR_OPEN"; }, "entry_fill_method_invalid"],
    ["entry_interval", (value) => { value.entry.barIntervalMinutes = 5; }, "entry_bar_interval_invalid"],
    ["trigger_same_bar", (value) => { value.entry.triggerBarFillPolicy = "ALLOW_TRIGGER_BAR_OPEN"; }, "entry_trigger_bar_fill_policy_invalid"],
    ["session_239", (value) => { value.minuteEvidence.fullSessionBarCount = 239; }, "minute_evidence_session_contract_invalid"],
    ["bar_start_future", (value) => { value.minuteEvidence.barStartObservationPolicy = "OBSERVED_AT_STAMP"; }, "bar_start_observation_policy_invalid"],
    ["manual_tick", (value) => { value.sellVariants.productionManualTickAccepted = true; }, "manual_tick_accepted_in_sell_variants"],
    ["mix_variants", (value) => { value.sellVariants.combineMetrics = true; }, "sell_variant_separation_invalid"],
    ["t1_exit", (value) => { value.exit.earliestSession = "T_PLUS_1"; }, "exit_earliest_session_invalid"],
    ["hard_stop", (value) => { value.exit.stateMachine.lowerLayer.hardStopLossPctFromActualComparableFill = 8; }, "exit_hard_stop_invalid"],
    ["hwm", (value) => { value.exit.stateMachine.lowerLayer.peakProfitKeepRatio = 0.3; }, "exit_peak_profit_keep_ratio_invalid"],
    ["hwm_history", (value) => { value.exit.stateMachine.lowerLayer.highWaterMarkSeedPolicy = "CURRENT_DAY_ONLY"; }, "exit_hwm_seed_policy_invalid"],
    ["limit_break", (value) => { value.exit.stateMachine.lowerLayer.limitBreakConfirmCompletedBars = 4; }, "exit_limit_break_rule_invalid"],
    ["seal", (value) => { value.exit.stateMachine.lowerLayer.sealWeakDurationSeconds = 20; }, "exit_seal_decay_rule_invalid"],
    ["negative", (value) => { value.exit.stateMachine.lowerLayer.negativeFeedbackMa5BiasStrictlyGreaterPct = 9; }, "exit_negative_feedback_bias_invalid"],
    ["volume", (value) => { value.exit.stateMachine.lowerLayer.cumulativeVolumeMustStrictlyExceedPriorMaximum = false; }, "exit_volume_stagnation_rule_invalid"],
    ["deadline", (value) => { value.exit.stateMachine.lowerLayer.deadlineObservedTime = "15:00"; }, "exit_deadline_ma5_rule_invalid"],
    ["fixed_holding", (value) => { value.exit.stateMachine.lowerLayer.trendMaximumHoldingSessions = 5; }, "exit_trend_extension_rule_invalid"],
    ["intent_fill", (value) => { value.exit.intentExecution.actualPositionMutationPolicy = "INTENT_MUTATES_POSITION"; }, "exit_intent_fill_separation_invalid"],
    ["context_identity", (value) => { value.exit.stateMachine.upperLayer.sameSecurityDateGenerationAndDecisionRequired = false; }, "exit_upper_context_binding_invalid"],
    ["adapter_unbound", (value) => {
      value.strategyBaseline.sourceFiles = value.strategyBaseline.sourceFiles
        .filter((row) => row.path !== "fetch_jqdata_minute_outcomes.py");
    }, "v7_strategy_source_missing:fetch_jqdata_minute_outcomes.py"],
  ];
  for (const [label, mutate, expectedReason] of cases) {
    const contract = copy(loadV8Contract());
    mutate(contract);
    rehash(contract);
    assert(
      validateBacktestContract(contract, FAST_VALIDATION).reasons.includes(expectedReason),
      `${label} must fail with ${expectedReason}`,
    );
  }
});

test("重算哈希后仍不能删除坏样本、关闭防护或清零成本", () => {
  const cases = [
    ["delete_cash", (value) => { value.outcomes.deleteCashDays = true; }, "cash_days_can_be_deleted"],
    ["delete_failed", (value) => { value.outcomes.deleteFailedSamples = true; }, "failed_samples_can_be_deleted"],
    ["calendar", (value) => { value.guardrails.exactTradingCalendarRequired = false; }, "exact_calendar_guard_missing"],
    ["timestamp", (value) => { value.guardrails.providerTimestampRequired = false; }, "provider_timestamp_guard_missing"],
    ["observation", (value) => { value.guardrails.observationsCannotGrantExecution = false; }, "observation_execution_guard_missing"],
    ["auto_parameter", (value) => { value.validationThresholds.autoApplyParameters = true; }, "automatic_parameter_application_allowed"],
    ["entry_source", (value) => { value.entry.triggerWindowSource = "runtime_override"; }, "entry_trigger_window_source_invalid"],
    ["max_gap", (value) => { value.entry.maxGapSource = "runtime.maxGap"; }, "entry_max_gap_source_invalid"],
    ["entry_slippage", (value) => { value.entry.slippageBps = 0; value.costs.entrySlippageBps = 0; }, "entry_slippage_invalid"],
    ["fees", (value) => { value.costs.entryFeeBps = 0; }, "cost_side_fee_invalid"],
    ["carry_capital", (value) => { value.portfolio.capitalReusePolicy = "REUSE_AFTER_DAY_5"; }, "portfolio_carried_capital_can_be_reused"],
    ["legacy_t1", (value) => { value.dataPolicy.legacyT1OutcomeUse = "REALIZED_PNL"; }, "legacy_t1_outcome_can_supply_realized_pnl"],
    ["engine_anchor", (value) => { value.enginePolicy.engineTreeHashRequired = false; }, "engine_tree_hash_not_required"],
    ["lane_mix", (value) => { value.signals.counterfactual.allowLiveReceiptAsInput = true; }, "counterfactual_live_receipt_input_allowed"],
    ["fixed_lot", (value) => { value.portfolio.tradingUnitSource = "FIXED_100_SHARES"; }, "portfolio_trading_unit_source_invalid"],
    ["exposure", (value) => { value.portfolio.exposureBudgetFormula = "DEPLOY_FULL_DAILY_BUDGET"; }, "portfolio_exposure_budget_invalid"],
    ["limit_exit", (value) => { value.exit.lowerLimitPolicy = "FILL_IF_ANY_DAILY_VOLUME"; }, "exit_lower_limit_policy_invalid"],
    ["corporate_action", (value) => { value.corporateActions.rightsIssuePolicy = "AUTO_SUBSCRIBE"; }, "corporate_action_rights_issue_policy_invalid"],
    ["cash_day", (value) => { value.signals.asDecided.cashOnlyReceiptAllowed = false; }, "signal_cash_only_receipt_not_allowed"],
    ["price_mode", (value) => { value.priceAndAccounting.priceAdjustmentMode = "QFQ"; }, "price_adjustment_mode_invalid"],
    ["metric_formula", (value) => { value.metricDefinitions.winRatePct = "WINNING_DAYS_DIV_DAYS"; }, "metric_definitions_invalid"],
    ["remaining_budget", (value) => { value.portfolio.budgetDecrementPolicy = "NO_DECREMENT"; }, "portfolio_budget_decrement_policy_invalid"],
    ["zero_denominator", (value) => { value.metricZeroDenominatorPolicy.winRatePct = 0; }, "metric_zero_denominator_policy_invalid"],
    ["lineage", (value) => { value.positionAccounting.winLossCountingPolicy = "COUNT_SUCCESSORS"; }, "position_accounting_invalid"],
    ["event_schema", (value) => { value.corporateActions.eventTypeRequiredFields.CASH_DIVIDEND = []; }, "corporate_action_event_schema_invalid"],
    ["max_order_conflict", (value) => { value.portfolio.entrySizingMethod = "CAP_TO_MAXIMUM_ORDER_QUANTITY"; }, "portfolio_entry_sizing_invalid"],
    ["group_label", (value) => { value.metricGroupingPolicy.labelSource = "EXIT_DAY"; }, "metric_grouping_policy_invalid"],
    ["entitlement", (value) => { value.corporateActions.entitlementQuantityPolicy = "EX_DATE_SHARES"; }, "corporate_action_entitlement_quantity_invalid"],
    ["fee_boundary", (value) => { value.portfolio.desiredQuantityFormula = "IGNORE_ENTRY_FEE"; }, "portfolio_desired_quantity_formula_invalid"],
    ["open_lineage", (value) => { value.positionAccounting.openLineageUnrealizedPnlFormula = "REMAINING_SECURITY_ONLY"; }, "position_accounting_invalid"],
  ];
  for (const [label, mutate, expectedReason] of cases) {
    const contract = copy(loadV6Contract());
    mutate(contract);
    rehash(contract);
    assert(
      validateBacktestContract(contract, FAST_VALIDATION).reasons.includes(expectedReason),
      `${label} must fail with ${expectedReason}`,
    );
  }
});

test("源码、因子登记表或运行版本漂移时当前契约立即失效", () => {
  const source = copy(loadV8Contract());
  source.strategyBaseline.sourceFiles[0].sha256 = "f".repeat(64);
  rehash(source);
  const sourceInspection = validateBacktestContract(source);
  assert(sourceInspection.reasons.some((reason) => reason.startsWith("strategy_source_worktree_mismatch:")));
  assert(sourceInspection.reasons.some((reason) => reason.startsWith("strategy_source_commit_mismatch:")));

  const version = copy(loadV8Contract());
  version.strategyBaseline.versions.unifiedQuantFactors = 999;
  rehash(version);
  assert(validateBacktestContract(version, FAST_VALIDATION).reasons.includes("unified_factor_version_mismatch"));

  const registry = copy(loadV8Contract());
  registry.strategyBaseline.factorRegistryHash = "a".repeat(64);
  rehash(registry);
  assert(validateBacktestContract(registry, FAST_VALIDATION).reasons.includes("factor_registry_hash_mismatch"));

  const tree = copy(loadV8Contract());
  tree.strategyBaseline.sourceTree.hash = "b".repeat(64);
  rehash(tree);
  assert(validateBacktestContract(tree).reasons.includes("strategy_source_tree_hash_mismatch"));
});

test("源码清单拒绝绝对路径、目录逃逸和重复路径", () => {
  const traversal = copy(loadV6Contract());
  traversal.strategyBaseline.sourceFiles[0].path = "../server.js";
  rehash(traversal);
  assert(validateBacktestContract(traversal, FAST_VALIDATION).reasons.includes("strategy_source_path_invalid"));

  const duplicate = copy(loadV6Contract());
  duplicate.strategyBaseline.sourceFiles[1].path = duplicate.strategyBaseline.sourceFiles[0].path;
  rehash(duplicate);
  assert(validateBacktestContract(duplicate, FAST_VALIDATION).reasons.some((reason) => reason.startsWith("strategy_source_path_duplicated:")));

  const extraField = copy(loadV6Contract());
  extraField.signals.asDecided.runtimeOverride = true;
  rehash(extraField);
  assert(validateBacktestContract(extraField, FAST_VALIDATION).reasons.includes("signal_as_decided_unknown_key:runtimeOverride"));

  const extraLane = copy(loadV6Contract());
  extraLane.lanes.combined = { asDecided: true, receiptRequired: false, executionAuthority: false };
  rehash(extraLane);
  assert(validateBacktestContract(extraLane, FAST_VALIDATION).reasons.includes("lanes_unknown_key:combined"));
});

test("runId纯函数绑定策略、引擎、数据、轨道和显式配置", () => {
  const contract = loadV6Contract();
  const identity = {
    contractHash: contract.integrity.contractHash,
    strategyHash: contract.strategyBaseline.strategyHash,
    engineHash: "e".repeat(64),
    datasetHash: "a".repeat(64),
    decisionReceiptAnchorHash: "d".repeat(64),
    fillReceiptAnchorHash: "f".repeat(64),
    runtimeNodeVersion: "v24.6.0",
    lane: "asDecided",
    sellVariant: "CORE_1M",
    runConfig: { dateFrom: "2026-08-24", dateTo: "2026-12-31" },
  };
  const firstRunId = computeBacktestRunId(identity);
  assert.match(firstRunId, /^bt_[a-f0-9]{32}$/);
  assert.equal(firstRunId, computeBacktestRunId(copy(identity)));
  assert.notEqual(firstRunId, computeBacktestRunId({ ...identity, datasetHash: "b".repeat(64) }));
  assert.notEqual(firstRunId, computeBacktestRunId({ ...identity, lane: "counterfactual" }));
  assert.notEqual(firstRunId, computeBacktestRunId({ ...identity, sellVariant: "FULL_1M_TICK" }));
  assert.notEqual(firstRunId, computeBacktestRunId({ ...identity, fillReceiptAnchorHash: "c".repeat(64) }));

  const input = {
    datasetManifestPath: "backtest/dataset-manifest.json",
    engineManifestPath: "backtest/engine-manifest.json",
    lane: "asDecided",
    runConfig: identity.runConfig,
  };
  assert.throws(() => createBacktestRunManifest(contract, { ...input, lane: "combined" }), /lane/);
  assert.throws(() => createBacktestRunManifest(loadV8Contract(), {
    ...input,
    sellVariant: "FULL_1M_TICK",
  }), /signed Tick ingestion/);
  assert.throws(() => createBacktestRunManifest(contract, {
    ...input,
    runConfig: { ...input.runConfig, slippageBps: 0 },
  }), /run config invalid/);
  assert.throws(() => createBacktestRunManifest(contract, { ...input, resultPath: "selected" }), /run input invalid/);
  assert.throws(
    () => createBacktestRunManifest(contract, { ...input, datasetHash: "a".repeat(64) }),
    /run input invalid/,
  );
});

test("V8缺少数据、凭证、引擎、持仓执行器和成交回执锚时正式绩效失败关闭", () => {
  const contract = loadV8Contract();
  const readiness = inspectBacktestExecutionReadiness(contract);
  assert.equal(readiness.executable, false);
  assert.equal(readiness.formalPerformanceEligible, false);
  assert.equal(readiness.legacyT1OutcomeEligibleForRealizedPnl, false);
  assert(readiness.reasons.includes("backtest_engine_manifest_missing"));
  assert(readiness.reasons.includes("validated_dataset_manifest_missing"));
  assert(readiness.reasons.includes("validated_decision_receipt_anchor_missing"));
  assert(readiness.reasons.includes("validated_fill_receipt_anchor_missing"));
  assert(readiness.reasons.includes("dedicated_v7_position_engine_missing"));
  assert.equal(readiness.authorityBindingStatus, "pending_validated_dataset_engine_position_and_fill_receipt_anchors");
});

test("外部锚定哈希不一致时拒绝契约", () => {
  const contract = loadV8Contract();
  const inspection = validateBacktestContract(contract, {
    ...FAST_VALIDATION,
    expectedContractHash: "f".repeat(64),
  });
  assert(inspection.reasons.includes("contract_hash_does_not_match_external_anchor"));
});

test("重算契约内哈希仍不能绕过独立Git注册表", () => {
  const contract = copy(loadV8Contract());
  contract.name = "篡改后的同版本契约";
  rehash(contract);
  const inspection = validateBacktestContract(contract);
  assert(inspection.reasons.includes("contract_registry_hash_mismatch"));
  assert(inspection.reasons.includes("working_contract_differs_from_registered_blob"));

  const registry = copy(loadBacktestContractRegistry());
  const v8Entry = registry.entries.find((entry) => entry.contractVersion === "v8");
  v8Entry.contractHash = "f".repeat(64);
  const registryInspection = validateBacktestContractRegistry(registry, loadV8Contract());
  assert.equal(registryInspection.valid, false);
  assert(registryInspection.reasons.includes("contract_registry_hash_mismatch"));
});

test("每个契约版本必须锚定其文件首次加入Git的提交", () => {
  const registry = copy(loadBacktestContractRegistry());
  const v8Entry = registry.entries.find((entry) => entry.contractVersion === "v8");
  v8Entry.contractCommit = "f".repeat(40);
  const inspection = validateBacktestContractRegistry(registry, loadV8Contract());
  assert.equal(inspection.valid, false);
  assert(inspection.reasons.includes("contract_registry_commit_not_file_creation_commit:v8"));
});
