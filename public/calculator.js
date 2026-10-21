(function (root, factory) {
  var calculator = typeof module === 'object' && module.exports
    ? require('./calculator-engine.js')
    : root.CesarCalculator;
  var api = factory(root, calculator);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CesarProposalState = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root, calculator) {
  'use strict';

  var SCHEMA_VERSION = 1;
  var OVERRIDE_FIELDS = [
    'monthlyFeeOverride',
    'installationOverride',
    'materialLiabilityOverride'
  ];
  var DEFAULT_PROPOSAL = {
    schemaVersion: SCHEMA_VERSION,
    client: { name: '', phone: '', email: '' },
    scenario: {
      segment: 'B2C',
      region: 'Москва/МО, ЦФО',
      objectType: 'Квартира',
      tariff: 'Базовый',
      rent: false,
      baseMonthlyFee: null,
      installationCalculated: null
    },
    items: [],
    selectedOptionNames: [],
    discountPercent: 0,
    counts: {
      cameraCount: 0,
      additionalHouseholdSensors: 0,
      additionalSecuritySensors: 0,
      baseSecuritySensorCount: 0
    },
    overrides: {
      monthlyFeeOverride: null,
      installationOverride: null,
      materialLiabilityOverride: null
    },
    computed: null,
    exportMetadata: { generatedAt: null, generatedBy: null }
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isPlainObject(value) {
    if (!isRecord(value)) return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function stringOr(value, fallback) {
    return typeof value === 'string' ? value : fallback;
  }

  function finiteNumberOr(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  function sanitizeClient(value) {
    var source = isPlainObject(value) ? value : {};
    return {
      name: stringOr(source.name, ''),
      phone: stringOr(source.phone, ''),
      email: stringOr(source.email, '')
    };
  }

  function sanitizeScenario(value) {
    var source = isPlainObject(value) ? value : {};
    return {
      segment: source.segment === 'B2B' || source.segment === 'B2C' ? source.segment : 'B2C',
      region: stringOr(source.region, DEFAULT_PROPOSAL.scenario.region),
      objectType: stringOr(source.objectType, DEFAULT_PROPOSAL.scenario.objectType),
      tariff: stringOr(source.tariff, DEFAULT_PROPOSAL.scenario.tariff),
      rent: typeof source.rent === 'boolean' ? source.rent : false,
      baseMonthlyFee: finiteNumberOr(source.baseMonthlyFee, null),
      installationCalculated: finiteNumberOr(source.installationCalculated, null)
    };
  }

  function sanitizeItem(value) {
    if (!isPlainObject(value)) return null;
    var item = {};
    Object.keys(value).forEach(function (key) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') return;
      var field = value[key];
      if (field === null || typeof field === 'string' || typeof field === 'boolean' || (typeof field === 'number' && Number.isFinite(field))) {
        item[key] = field;
      }
    });
    return item;
  }

  function sanitizeOptionNames(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(function (name, index, names) {
      return typeof name === 'string' && names.indexOf(name) === index;
    });
  }

  function sanitizeCounts(value) {
    var source = isPlainObject(value) ? value : {};
    return {
      cameraCount: finiteNumberOr(source.cameraCount, 0),
      additionalHouseholdSensors: finiteNumberOr(source.additionalHouseholdSensors, 0),
      additionalSecuritySensors: finiteNumberOr(source.additionalSecuritySensors, 0),
      baseSecuritySensorCount: finiteNumberOr(source.baseSecuritySensorCount, 0)
    };
  }

  function sanitizeOverride(value) {
    if (value === null || value === '') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      var trimmed = value.trim();
      return trimmed !== '' && Number.isFinite(Number(trimmed)) ? trimmed : null;
    }
    return null;
  }

  function sanitizeOverrides(value) {
    var source = isPlainObject(value) ? value : {};
    return {
      monthlyFeeOverride: sanitizeOverride(source.monthlyFeeOverride),
      installationOverride: sanitizeOverride(source.installationOverride),
      materialLiabilityOverride: sanitizeOverride(source.materialLiabilityOverride)
    };
  }

  function sanitizeExportMetadata(value) {
    var source = isPlainObject(value) ? value : {};
    return {
      generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt : null,
      generatedBy: typeof source.generatedBy === 'string' ? source.generatedBy : null
    };
  }

  function safeComputed(value) {
    if (!isPlainObject(value)) return null;
    try { return clone(value); } catch (error) { return null; }
  }

  function createDefaultProposal() {
    return clone(DEFAULT_PROPOSAL);
  }

  function normalizeProposal(proposal) {
    var source = isRecord(proposal) ? proposal : {};
    var normalized = createDefaultProposal();
    normalized.client = sanitizeClient(source.client);
    normalized.scenario = sanitizeScenario(source.scenario);
    normalized.items = Array.isArray(source.items) ? source.items.map(sanitizeItem).filter(Boolean) : [];
    normalized.selectedOptionNames = sanitizeOptionNames(source.selectedOptionNames);
    normalized.discountPercent = finiteNumberOr(source.discountPercent, 0);
    normalized.counts = sanitizeCounts(source.counts);
    normalized.overrides = sanitizeOverrides(source.overrides);
    normalized.computed = safeComputed(source.computed);
    normalized.exportMetadata = sanitizeExportMetadata(source.exportMetadata);
    return normalized;
  }

  function promotionCopy(item) {
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      image: item.image,
      priority: item.priority
    };
  }

  function defaultPromotions() {
    var ids = Array.isArray(root.CESAR_PRIORITY_PROMOTIONS) ? root.CESAR_PRIORITY_PROMOTIONS : [];
    var catalog = Array.isArray(root.CESAR_PROMOTIONS) ? root.CESAR_PROMOTIONS : [];
    return ids.map(function (id) {
      return catalog.find(function (item) { return item.id === id; });
    }).filter(Boolean).map(promotionCopy);
  }

  function ensureDraft(draft, options) {
    var source = isRecord(draft) ? draft : {};
    var normalized = Object.assign({}, source);
    normalized.proposal = normalizeProposal(source.proposal);
    if (options && options.isNewDraft) normalized.promotions = defaultPromotions();
    else normalized.promotions = Array.isArray(source.promotions) ? source.promotions.filter(isRecord).map(function (selected) {
      var catalog = Array.isArray(root.CESAR_PROMOTIONS) ? root.CESAR_PROMOTIONS : [];
      var item = catalog.find(function (candidate) { return candidate.id === selected.id; }) || {};
      return {
        id: selected.id,
        title: typeof selected.title === 'string' ? selected.title : item.title || '',
        description: typeof selected.description === 'string' ? selected.description : item.description || '',
        image: typeof selected.image === 'string' ? selected.image : item.image || '',
        priority: typeof selected.priority === 'number' ? selected.priority : (typeof item.priority === 'number' ? item.priority : 0)
      };
    }) : [];
    return normalized;
  }

  function engineInput(proposal) {
    return Object.assign(
      {},
      proposal.scenario,
      proposal.counts,
      proposal.overrides,
      {
        items: proposal.items,
        selectedOptionNames: proposal.selectedOptionNames,
        discountPercent: proposal.discountPercent
      }
    );
  }

  function engineCatalogs(catalogs) {
    return catalogs && isRecord(catalogs.calculator) ? catalogs.calculator : catalogs;
  }

  function calculateProposal(proposal, catalogs) {
    if (!isRecord(proposal)) throw new TypeError('proposal must be an object');
    if (!calculator || typeof calculator.calculate !== 'function') throw new Error('CesarCalculator is unavailable');
    var normalized = normalizeProposal(proposal);
    Object.keys(proposal).forEach(function (key) { delete proposal[key]; });
    Object.assign(proposal, normalized);
    proposal.computed = calculator.calculate(engineInput(proposal), engineCatalogs(catalogs));
    return proposal;
  }

  function resetOverride(proposal, field, catalogs) {
    if (OVERRIDE_FIELDS.indexOf(field) === -1) throw new RangeError('Invalid override field: ' + field);
    if (!isRecord(proposal)) throw new TypeError('proposal must be an object');
    if (!isRecord(proposal.overrides)) proposal.overrides = {};
    proposal.overrides[field] = null;
    return calculateProposal(proposal, catalogs || root.CESAR_CALCULATOR_CATALOGS);
  }

  return {
    createDefaultProposal: createDefaultProposal,
    normalizeProposal: normalizeProposal,
    ensureDraft: ensureDraft,
    calculateProposal: calculateProposal,
    resetOverride: resetOverride
  };
}));
