"use strict";

// 题材库只把明确属于“人用药/制药产业链”的标签归入医药母题材。
// 这里使用精确白名单，刻意不使用 /药|医|生物/ 之类宽泛正则，避免把
// 农药、兽药、AI 医疗、医疗器械等不同交易逻辑误并进来。
const MEDICAL_FAMILY = "医药";
const AI_COMPUTE_FAMILY = "AI算力";
const AI_COMPUTE_SUBTHEMES = new Set([
  AI_COMPUTE_FAMILY,
  "存储芯片",
  "CPO",
  "共封装光学(CPO)",
  "光模块",
  "光纤概念",
  "算力租赁",
  "服务器",
  "液冷服务器",
  "先进封装",
]);
const MEDICAL_SUBTHEMES = new Set([
  MEDICAL_FAMILY,
  "生物医药",
  "医药商业",
  "医药电商",
  "创新药",
  "仿制药",
  "仿制药一致性评价",
  "CRO",
  "CRO概念",
  "CXO",
  "CXO概念",
  "CDMO",
  "CDMO概念",
  "化学制药",
  "化学制剂",
  "原料药",
  "中药",
  "中药概念",
  "生物制品",
  "血液制品",
  "流感",
  "肝炎概念",
  "青蒿素",
  "猴痘概念",
  "新冠药物",
  "新冠治疗",
  "抗病毒",
  "疫苗",
  "人用疫苗",
  "减肥药",
  "细胞免疫治疗",
  "CAR-T",
  "CAR-T细胞疗法",
  "基因治疗",
  "单抗概念",
]);

function cleanThemeName(value) {
  return String(value ?? "").trim();
}

function uniqueThemeNames(values) {
  return Array.from(new Set((values || []).map(cleanThemeName).filter(Boolean)));
}

function isMedicalThemeName(value) {
  return MEDICAL_SUBTHEMES.has(cleanThemeName(value));
}

function canonicalThemeFamily(value) {
  const name = cleanThemeName(value);
  if (isMedicalThemeName(name)) return MEDICAL_FAMILY;
  if (AI_COMPUTE_SUBTHEMES.has(name)) return AI_COMPUTE_FAMILY;
  return name;
}

function isExplicitFamilySubtheme(value, family) {
  const name = cleanThemeName(value);
  const target = cleanThemeName(family);
  return Boolean(name && target && name !== target && canonicalThemeFamily(name) === target);
}

function topicThemeNames(theme) {
  return uniqueThemeNames([
    theme && theme.name,
    theme && theme.family,
    ...(Array.isArray(theme && theme.aliases) ? theme.aliases : []),
    ...(Array.isArray(theme && theme.matchNames) ? theme.matchNames : []),
    ...(Array.isArray(theme && theme.subthemes) ? theme.subthemes : []),
  ]);
}

function stockThemeNames(stock) {
  return uniqueThemeNames([
    stock && stock.mainConcept,
    stock && stock.mainFamily,
    ...(Array.isArray(stock && stock.concepts) ? stock.concepts : []),
  ]);
}

function stockMedicalSubthemes(stock) {
  return stockThemeNames(stock)
    .filter((name) => name !== MEDICAL_FAMILY && isMedicalThemeName(name));
}

module.exports = {
  MEDICAL_FAMILY,
  MEDICAL_SUBTHEMES,
  AI_COMPUTE_FAMILY,
  AI_COMPUTE_SUBTHEMES,
  canonicalThemeFamily,
  isExplicitFamilySubtheme,
  isMedicalThemeName,
  topicThemeNames,
  stockMedicalSubthemes,
};
