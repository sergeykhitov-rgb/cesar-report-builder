(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CesarCalculator = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const HOUSE_TYPES = new Set(['Дом', 'Коттедж', 'неотапливаемое', 'Неотапливаемое', 'Дом/неотапливаемое']);
  const CAMERA_OPTION_PATTERN = /видеокамер/i;

  function roundMoney(value) {
    if (value === null || value === undefined) return null;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function warning(code, field, message) {
    return { code, field, message };
  }

  function isBlank(value) {
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  }

  function applyOverride(calculated, override) {
    if (isBlank(override)) {
      return { calculated, override: null, final: calculated, overridden: false };
    }
    const numeric = typeof override === 'number' ? override : Number(String(override).trim());
    if (!Number.isFinite(numeric) || numeric < 0) {
      return {
        calculated,
        override,
        final: null,
        overridden: false,
        error: warning('INVALID_OVERRIDE', 'override', 'Переопределение должно быть конечным неотрицательным числом.'),
      };
    }
    const final = roundMoney(numeric);
    return { calculated, override: final, final, overridden: true };
  }

  function cloneItem(item) {
    return { ...item };
  }

  function groupEquipment(items) {
    const groups = [];
    const bySystem = new Map();
    (Array.isArray(items) ? items : []).forEach(item => {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) return;
      let group = bySystem.get(item.system);
      if (!group) {
        group = { system: item.system, systemLabel: item.systemLabel, items: [] };
        bySystem.set(item.system, group);
        groups.push(group);
      }
      group.items.push(cloneItem(item));
    });
    return groups;
  }

  function normalizeObjectType(objectType, entries) {
    if (entries.some(entry => entry.objectType === objectType)) return objectType;
    if (!HOUSE_TYPES.has(objectType)) return null;
    const supported = entries.find(entry => HOUSE_TYPES.has(entry.objectType));
    return supported ? supported.objectType : null;
  }

  function baseTariffName(name) {
    return String(name || '').replace(/^Видео[ -]?/, '');
  }

  function isPremium(name) {
    return baseTariffName(name) === 'Премиальный';
  }

  function addChange(changes, from, to, reason) {
    if (from !== to) changes.push({ from, to, reason });
  }

  function resolveB2CName(input) {
    const changes = [];
    const requestedName = input.tariff;
    let resolvedName = requestedName;
    const security = Number(input.additionalSecuritySensors || 0);
    const household = Number(input.additionalHouseholdSensors || 0);
    const house = HOUSE_TYPES.has(input.objectType);

    if (!isPremium(resolvedName) && baseTariffName(resolvedName) === 'Базовый' && household > 0) {
      const next = /^Видео/.test(resolvedName) ? 'Видео Выгодный' : 'Выгодный';
      addChange(changes, resolvedName, next, 'Добавлен бытовой датчик');
      resolvedName = next;
    }

    if (!isPremium(resolvedName)) {
      const level = baseTariffName(resolvedName);
      const threshold = house ? 4 : level === 'Базовый' ? 3 : level === 'Выгодный' ? 2 : null;
      if (threshold !== null && security > threshold) {
        const next = /^Видео/.test(resolvedName) ? 'Видео Премиальный' : 'Премиальный';
        addChange(changes, resolvedName, next, `Дополнительных охранных датчиков больше ${threshold}`);
        resolvedName = next;
      }
    }

    if (Number(input.cameraCount || 0) > 0 && !/^Видео/.test(resolvedName)) {
      const next = `Видео ${resolvedName}`;
      addChange(changes, resolvedName, next, 'Выбрана видеокамера');
      resolvedName = next;
    }
    return { requestedName, resolvedName, automaticChanges: changes };
  }

  function resolveTariff(input, catalogs) {
    const warnings = [];
    if (input.segment === 'B2B') {
      if (input.baseMonthlyFee !== undefined && input.baseMonthlyFee !== null && input.baseMonthlyFee !== '') {
        const supplied = typeof input.baseMonthlyFee === 'number' ? input.baseMonthlyFee : Number(input.baseMonthlyFee);
        if (!Number.isFinite(supplied) || supplied < 0) {
          warnings.push(warning('INVALID_BASE_MONTHLY_FEE', 'baseMonthlyFee', 'Базовая абонентская плата должна быть конечным неотрицательным числом.'));
          return { requestedName: input.tariff, resolvedName: input.tariff || null, automaticChanges: [], monthlyPrice: null, warnings };
        }
        return { requestedName: input.tariff, resolvedName: input.tariff || null, automaticChanges: [], monthlyPrice: roundMoney(supplied), warnings };
      }
      const match = (catalogs.b2bTariffs || []).find(tariff => tariff.region === input.region && tariff.name === input.tariff);
      if (!match || !Number.isFinite(match.monthlyPrice)) {
        warnings.push(warning('MISSING_TARIFF_RATE', 'tariff', 'Не найдена ставка B2B для выбранного региона и тарифа.'));
      }
      return {
        requestedName: input.tariff,
        resolvedName: match ? match.name : input.tariff || null,
        automaticChanges: [],
        monthlyPrice: match && Number.isFinite(match.monthlyPrice) ? match.monthlyPrice : null,
        warnings,
      };
    }

    const names = resolveB2CName(input);
    const entries = input.rent ? (catalogs.b2cRentalTariffs || []) : (catalogs.b2cTariffs || []);
    const sameRegion = entries.filter(tariff => tariff.region === input.region);
    const objectType = normalizeObjectType(input.objectType, sameRegion);
    let lookupName = names.resolvedName;
    if (input.rent && /^Видео /.test(lookupName)) lookupName = names.resolvedName;
    const match = objectType && sameRegion.find(tariff => tariff.objectType === objectType && tariff.name === lookupName);
    if (!match || !Number.isFinite(match.monthlyPrice)) {
      warnings.push(warning('MISSING_TARIFF_RATE', 'tariff', 'Не найдена ставка B2C для выбранных региона, объекта и тарифа.'));
    }
    return {
      ...names,
      objectType: objectType || input.objectType,
      monthlyPrice: match && Number.isFinite(match.monthlyPrice) ? match.monthlyPrice : null,
      warnings,
    };
  }

  function calculateEquipment(input, catalogs, warnings) {
    let invalid = false;
    const items = [];
    (Array.isArray(input.items) ? input.items : []).forEach((source, index) => {
      const quantity = source.quantity;
      const price = source.installedUnitPrice;
      if (!Number.isFinite(quantity) || quantity < 0) {
        invalid = true;
        warnings.push(warning('INVALID_EQUIPMENT_QUANTITY', `items[${index}].quantity`, 'Количество должно быть конечным неотрицательным числом.'));
        return;
      }
      if (quantity === 0) return;
      if (!Number.isFinite(price) || price < 0) {
        invalid = true;
        warnings.push(warning('INVALID_EQUIPMENT_PRICE', `items[${index}].installedUnitPrice`, 'Цена должна быть конечным неотрицательным числом.'));
        return;
      }
      items.push({ ...source, lineTotal: roundMoney(quantity * price) });
    });

    const allowed = (catalogs.discounts || []).some(discount => discount.kind === 'standard' && discount.percent === input.discountPercent);
    const discountPercent = allowed ? input.discountPercent : 0;
    if (!allowed) warnings.push(warning('INVALID_DISCOUNT', 'discountPercent', 'Скидка отсутствует в списке разрешённых значений.'));
    const subtotal = invalid ? null : roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
    const discountAmount = subtotal === null ? null : roundMoney(subtotal * discountPercent / 100);
    const afterDiscount = subtotal === null ? null : roundMoney(subtotal - discountAmount);
    return { items, subtotal, discountPercent, discountAmount, afterDiscount };
  }

  function resolveOptions(input, catalogs, warnings) {
    const selected = [];
    let total = 0;
    let missingRate = false;
    (Array.isArray(input.selectedOptionNames) ? input.selectedOptionNames : []).forEach(name => {
      const matches = (catalogs.options || []).filter(option => option.category === input.segment && option.name === name);
      if (matches.length === 0) {
        warnings.push(warning('MISSING_OPTION', 'selectedOptionNames', `Не найдена опция «${name}».`));
        return;
      }
      const option = { ...matches[0] };
      selected.push(option);
      if (input.segment === 'B2C' && CAMERA_OPTION_PATTERN.test(option.name) && Number(input.cameraCount || 0) > 0) return;
      if (!Number.isFinite(option.monthlyPrice)) {
        warnings.push(warning('MISSING_OPTION_RATE', 'selectedOptionNames', `Для опции «${name}» не задана ставка.`));
        missingRate = true;
        return;
      }
      total += option.monthlyPrice;
    });
    return { selected, total: missingRate ? null : roundMoney(total) };
  }

  function hasRentalSensorRule(catalogs) {
    return (catalogs.rentalLogic || []).some(rule =>
      rule.category === 'B2C' && rule.parameter === 'Дополнительные датчики' && /60\s*₽/.test(rule.value)
    );
  }

  function liabilityAmount(input, tariff, catalogs) {
    if (input.segment === 'B2B') return catalogs.materialLiability?.b2b?.any?.any ?? null;
    const objectKey = input.objectType === 'Квартира' ? 'apartment' : HOUSE_TYPES.has(input.objectType) ? 'cottage' : null;
    const tariffName = baseTariffName(tariff.resolvedName);
    const levelKey = tariffName === 'Базовый' || tariffName === 'Эконом' ? 'basic'
      : tariffName === 'Выгодный' ? 'value'
        : tariffName === 'Премиальный' ? 'premium' : null;
    return objectKey && levelKey ? (catalogs.materialLiability?.b2c?.[objectKey]?.[levelKey] ?? null) : null;
  }

  function withOverrideWarning(result, field, warnings) {
    if (!result.error) return result;
    warnings.push({ ...result.error, field });
    const clean = { ...result };
    delete clean.error;
    return clean;
  }

  function calculate(input, catalogs) {
    const warnings = [];
    const equipment = calculateEquipment(input, catalogs, warnings);
    const tariffResolution = resolveTariff(input, catalogs);
    warnings.push(...tariffResolution.warnings);
    const options = resolveOptions(input, catalogs, warnings);

    let installationCalculated = input.installationCalculated;
    if (isBlank(installationCalculated)) installationCalculated = input.segment === 'B2B' && input.rent ? 5000 : 0;
    if (!Number.isFinite(installationCalculated) || installationCalculated < 0) {
      warnings.push(warning('INVALID_INSTALLATION', 'installationCalculated', 'Расчёт монтажа должен быть конечным неотрицательным числом.'));
      installationCalculated = null;
    } else {
      installationCalculated = roundMoney(installationCalculated);
    }
    if (input.segment === 'B2B' && input.rent && installationCalculated !== null && installationCalculated < 3000) {
      warnings.push(warning('B2B_RENTAL_INSTALLATION_BELOW_MINIMUM', 'installationCalculated', 'Монтаж B2B при аренде ниже минимальных 3000 ₽.'));
    }
    const installation = withOverrideWarning(applyOverride(installationCalculated, input.installationOverride), 'installationOverride', warnings);

    let rentalAdjustments = 0;
    if (input.segment === 'B2B' && input.rent && tariffResolution.monthlyPrice !== null) {
      rentalAdjustments = roundMoney(tariffResolution.monthlyPrice * 0.15);
    } else if (input.segment === 'B2C') {
      const cameras = Number(input.cameraCount || 0);
      if (cameras > 1) rentalAdjustments += (cameras - 1) * 250;
      if (input.rent && hasRentalSensorRule(catalogs)) {
        rentalAdjustments += (Number(input.additionalHouseholdSensors || 0) + Number(input.additionalSecuritySensors || 0)) * 60;
      }
      if (input.rent && !(input.selectedOptionNames || []).includes('Аренда оборудования-400')) {
        warnings.push(warning('UNRESOLVED_RENTAL_OPTION', 'rent', 'Не подтверждено автоматическое применение отдельной опции аренды 400 ₽.'));
      }
    }
    rentalAdjustments = roundMoney(rentalAdjustments);

    const base = tariffResolution.monthlyPrice;
    const monthlyCalculated = base === null || options.total === null ? null : roundMoney(base + options.total + rentalAdjustments);
    const monthlyFee = withOverrideWarning(applyOverride(monthlyCalculated, input.monthlyFeeOverride), 'monthlyFeeOverride', warnings);
    if (monthlyCalculated === null) {
      monthlyFee.final = null;
      monthlyFee.overridden = false;
    }
    monthlyFee.base = base;
    monthlyFee.options = options.total;
    monthlyFee.rentalAdjustments = rentalAdjustments;

    const liabilityCalculated = liabilityAmount(input, tariffResolution, catalogs);
    if (liabilityCalculated === null) warnings.push(warning('MISSING_LIABILITY_RATE', 'materialLiability', 'Не найдена ставка материальной ответственности.'));
    const materialLiability = withOverrideWarning(applyOverride(liabilityCalculated, input.materialLiabilityOverride), 'materialLiabilityOverride', warnings);
    if (liabilityCalculated === null) {
      materialLiability.final = null;
      materialLiability.overridden = false;
    }
    const oneTimeFinal = equipment.afterDiscount === null || installation.final === null
      ? null : roundMoney(equipment.afterDiscount + installation.final);

    return {
      equipment,
      installation,
      oneTime: { final: oneTimeFinal },
      tariff: {
        requestedName: tariffResolution.requestedName,
        resolvedName: tariffResolution.resolvedName,
        automaticChanges: tariffResolution.automaticChanges,
      },
      monthlyFee,
      materialLiability,
      selectedOptions: options.selected,
      warnings,
      exportGroups: groupEquipment(equipment.items),
    };
  }

  return { calculate, applyOverride, groupEquipment, resolveTariff };
}));
