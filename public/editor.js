/* Конструктор отчётов — логика редактора */
(function (root) {
  'use strict';
  function identity(item) { return String(item.system || '') + ':' + String(item.code || ''); }
  function unique(values) { return values.filter(function (value, index) { return value && values.indexOf(value) === index; }); }
  var money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
  var ProposalUI = {
    filterEquipment: function (items, filters) {
      var query = String(filters.query || '').trim().toLocaleLowerCase('ru');
      var system = filters.system || '';
      if (!system && query.length < 2) return [];
      return (items || []).filter(function (item) {
        if (system && item.system !== system) return false;
        if (!query) return true;
        return [item.code, item.name, item.model].some(function (value) { return String(value || '').toLocaleLowerCase('ru').indexOf(query) !== -1; });
      }).slice(0, 30);
    },
    addEquipment: function (proposal, source) {
      var key = identity(source);
      var existing = (proposal.items || []).find(function (item) { return (item.identity || identity(item)) === key; });
      if (existing) existing.quantity += 1;
      else {
        if (!Array.isArray(proposal.items)) proposal.items = [];
        proposal.items.push({ identity: key, system: source.system, systemLabel: source.systemLabel, code: source.code,
          name: source.name, model: source.model, unit: source.unit, quantity: 1,
          installedUnitPrice: source.installedUnitPrice, sourceInstalledUnitPrice: source.installedUnitPrice, priceOverridden: false });
      }
      return proposal;
    },
    setQuantity: function (proposal, key, value) {
      var numeric = Number(value);
      var item = (proposal.items || []).find(function (entry) { return (entry.identity || identity(entry)) === key; });
      if (!item || !Number.isSafeInteger(numeric) || numeric <= 0) return { valid: false, message: 'Количество должно быть целым числом больше нуля.' };
      item.quantity = numeric; return { valid: true };
    },
    removeEquipment: function (proposal, key) { proposal.items = (proposal.items || []).filter(function (item) { return (item.identity || identity(item)) !== key; }); },
    setManualPrice: function (proposal, key, value) {
      var item = (proposal.items || []).find(function (entry) { return (entry.identity || identity(entry)) === key; });
      var numeric = Number(value);
      if (!item || !Number.isFinite(numeric) || numeric < 0) return false;
      item.installedUnitPrice = numeric; item.priceOverridden = numeric !== item.sourceInstalledUnitPrice; return true;
    },
    resetManualPrice: function (proposal, key) { var item = (proposal.items || []).find(function (entry) { return (entry.identity || identity(entry)) === key; }); if (item) { item.installedUnitPrice = item.sourceInstalledUnitPrice; item.priceOverridden = false; } },
    scenarioOptions: function (catalog, scenario) {
      var rows = scenario.segment === 'B2B' ? (catalog.b2bTariffs || []) : (scenario.rent ? catalog.b2cRentalTariffs || [] : catalog.b2cTariffs || []);
      return { regions: unique(rows.map(function (row) { return row.region; })), objectTypes: scenario.segment === 'B2B' ? [] : unique(rows.map(function (row) { return row.objectType; })), tariffs: unique(rows.map(function (row) { return row.name; })) };
    },
    compatibleValue: function (current, values) { return values.indexOf(current) === -1 ? '' : current; },
    formatMoney: function (value) { return typeof value === 'number' && Number.isFinite(value) ? money.format(value) : '—'; },
    overrideView: function (value) { return { calculated: ProposalUI.formatMoney(value && value.calculated), final: ProposalUI.formatMoney(value && value.final), badge: value && value.overridden ? 'Изменено вручную' : '' }; },
    isProposalValid: function (proposal) { return !!(proposal && proposal.client && proposal.client.name && proposal.scenario && proposal.scenario.segment && proposal.scenario.region && (proposal.scenario.segment === 'B2B' || proposal.scenario.objectType) && proposal.items && proposal.items.some(function (item) { return item.quantity > 0; }) && proposal.computed && !(proposal.computed.warnings || []).some(function (warning) { return /^MISSING_|^INVALID_/.test(warning.code); })); }
  };
  root.CesarProposalUI = ProposalUI;
  if (typeof module === 'object' && module.exports) module.exports.CesarProposalUI = ProposalUI;
  if (typeof document === 'undefined') return;
  var LS_KEY = 'cesar_report_draft_v2';
  var DEFAULT_HERO = '/hero-default.jpg';
  var editorBlocked = false;
  var editorBlockMessage = '';

  var DEFAULT = {
    title: 'Отчёт о мониторинге автомобиля',
    subtitle: 'на основе данных системы мониторинга CESAR SATELLITE',
    objectTitle: 'Информация об объекте',
    object: { pin: '', owner: '', brand: '', model: '', plate: '', address: '' },
    heroPhoto: DEFAULT_HERO,
    summary: { alarms: '', incidents: '' },
    promotions: [],
    eventsTitle: 'Фотоматериалы и события',
    events: [],
    manager: {
      label: 'Ваш персональный менеджер',
      name: 'Мешенков Андрей',
      role: 'Руководитель направления безопасности',
      phone: '+7 495 785 53 53 · доб. 4311',
      email: 'a.meshenkov@cesar-satellite.ru',
      photo: ''
    },
    proposal: root.CesarProposalState.createDefaultProposal()
  };

  var state = load();

  /* ---------- утилиты состояния ---------- */
  function recalculateProposal(draft) {
    var target = draft || state;
    root.CesarProposalState.calculateProposal(target.proposal, root.CESAR_CALCULATOR_CATALOGS);
    return target;
  }
  function freshDraft() {
    var draft = window.CesarProposalState.ensureDraft(JSON.parse(JSON.stringify(DEFAULT)), { isNewDraft: true });
    draft.events = [];
    return recalculateProposal(draft);
  }
  function mergeSavedDraft(saved) {
    var source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    var draft = Object.assign(JSON.parse(JSON.stringify(DEFAULT)), source);
    draft.object = Object.assign({}, DEFAULT.object, source.object && typeof source.object === 'object' && !Array.isArray(source.object) ? source.object : {});
    draft.summary = Object.assign({}, DEFAULT.summary, source.summary && typeof source.summary === 'object' && !Array.isArray(source.summary) ? source.summary : {});
    draft.manager = Object.assign({}, DEFAULT.manager, source.manager && typeof source.manager === 'object' && !Array.isArray(source.manager) ? source.manager : {});
    return draft;
  }
  function load() {
    var raw, saved;
    try {
      raw = localStorage.getItem(LS_KEY);
      if (!raw) return freshDraft();
      saved = JSON.parse(raw);
    } catch (e) { return freshDraft(); }
    try {
      var draft = mergeSavedDraft(saved);
      if (!Array.isArray(draft.events)) draft.events = [];
      return recalculateProposal(window.CesarProposalState.ensureDraft(draft, { isNewDraft: false }));
    } catch (e) {
      if (e && e.code === 'UNSUPPORTED_PROPOSAL_SCHEMA') {
        editorBlocked = true;
        editorBlockMessage = 'Этот черновик создан в более новой версии. Обновите приложение, чтобы открыть его. Данные сохранены без изменений.';
        return mergeSavedDraft(saved);
      }
    }
    return freshDraft();
  }
  var saveTimer;
  function save() {
    if (editorBlocked) { showBlockedWarning(); return; }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
    }, 250);
  }
  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function setPath(obj, path, val) {
    var keys = path.split('.'), o = obj;
    for (var i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null) o[keys[i]] = {}; o = o[keys[i]]; }
    o[keys[keys.length - 1]] = val;
  }

  /* ---------- рендер предпросмотра ---------- */
  var previewEl = document.getElementById('preview');
  var renderTimer;
  function render() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      previewEl.innerHTML = window.renderReport(state);
    }, 60);
  }

  /* ---------- сжатие изображений ---------- */
  function fileToDataURL(file, maxSize, quality) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('not image')); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height, scale = Math.min(1, maxSize / Math.max(w, h));
          var cw = Math.round(w * scale), ch = Math.round(h * scale);
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
          try { resolve(canvas.toDataURL('image/jpeg', quality)); }
          catch (e) { resolve(reader.result); }
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  function pickImage(cb, maxSize, quality) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      fileToDataURL(f, maxSize || 1600, quality || 0.82).then(cb).catch(function () {
        toast('Не удалось загрузить изображение');
      });
    };
    inp.click();
  }

  /* ---------- привязка простых полей ---------- */
  function bindFields() {
    document.querySelectorAll('[data-path]').forEach(function (el) {
      var path = el.getAttribute('data-path');
      var val = getPath(state, path);
      if (val != null) el.value = val;
      el.addEventListener('input', function () {
        if (editorBlocked) { el.value = getPath(state, path) == null ? '' : getPath(state, path); showBlockedWarning(); return; }
        setPath(state, path, el.value);
        if (path.indexOf('proposal.') === 0) recalculateProposal();
        save(); render();
      });
    });
  }

  /* ---------- калькулятор коммерческого предложения ---------- */
  function option(select, value, label) {
    var node = document.createElement('option'); node.value = value; node.textContent = label || value; select.appendChild(node);
  }
  function replaceOptions(select, values, current, emptyLabel) {
    select.innerHTML = '';
    if (emptyLabel) option(select, '', emptyLabel);
    values.forEach(function (value) { option(select, value); });
    select.value = ProposalUI.compatibleValue(current, values);
    if (!select.value && values.length && !emptyLabel) select.value = values[0];
    return select.value;
  }
  function commitProposal() {
    if (editorBlocked) { showBlockedWarning(); return; }
    renderScenarioControls();
    recalculateProposal(); save(); render(); renderCalculator();
  }
  function renderScenarioControls() {
    var proposal = state.proposal, scenario = proposal.scenario;
    document.querySelectorAll('[name="proposalSegment"]').forEach(function (radio) { radio.checked = radio.value === scenario.segment; });
    document.getElementById('proposalRent').checked = scenario.rent;
    var available = ProposalUI.scenarioOptions(root.CESAR_CALCULATOR_CATALOGS.calculator, scenario);
    scenario.region = replaceOptions(document.getElementById('proposalRegion'), available.regions, scenario.region);
    var objects = available.objectTypes;
    scenario.objectType = replaceOptions(document.getElementById('proposalObjectType'), objects, scenario.objectType, scenario.segment === 'B2B' ? 'Не применяется' : 'Выберите объект');
    document.getElementById('proposalObjectType').disabled = scenario.segment === 'B2B';
    var regionalCatalog = scenario.segment === 'B2B' ? root.CESAR_CALCULATOR_CATALOGS.calculator.b2bTariffs : (scenario.rent ? root.CESAR_CALCULATOR_CATALOGS.calculator.b2cRentalTariffs : root.CESAR_CALCULATOR_CATALOGS.calculator.b2cTariffs);
    var tariffs = regionalCatalog.filter(function (row) { return row.region === scenario.region && (scenario.segment === 'B2B' || row.objectType === scenario.objectType); }).map(function (row) { return row.name; });
    tariffs = unique(tariffs);
    scenario.tariff = replaceOptions(document.getElementById('proposalTariff'), tariffs, scenario.tariff);
  }
  function renderSearchResults() {
    var results = document.getElementById('equipmentResults');
    var search = document.getElementById('equipmentSearch');
    var system = document.getElementById('equipmentSystemFilter').value;
    var found = ProposalUI.filterEquipment(root.CESAR_CALCULATOR_CATALOGS.equipment.items, { query: search.value, system: system });
    results.innerHTML = '';
    search.setAttribute('aria-expanded', found.length ? 'true' : 'false');
    if (!system && search.value.trim().length < 2) { var help = document.createElement('p'); help.className = 'empty-state'; help.textContent = 'Введите минимум 2 символа или выберите систему.'; results.appendChild(help); return; }
    if (!found.length) { var empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'Ничего не найдено. Измените запрос или систему.'; results.appendChild(empty); return; }
    found.forEach(function (item) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'equipment-result'; button.setAttribute('role', 'option');
      var main = document.createElement('span'); main.className = 'equipment-result-main'; main.textContent = item.code + ' · ' + item.name;
      var meta = document.createElement('span'); meta.className = 'equipment-result-meta'; meta.textContent = [item.systemLabel, item.model, ProposalUI.formatMoney(item.installedUnitPrice)].filter(Boolean).join(' · ');
      button.appendChild(main); button.appendChild(meta);
      button.addEventListener('click', function () { ProposalUI.addEquipment(state.proposal, item); commitProposal(); });
      results.appendChild(button);
    });
  }
  function renderSelectedEquipment() {
    var host = document.getElementById('selectedEquipment'); host.innerHTML = '';
    if (!state.proposal.items.length) { var empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'Оборудование ещё не добавлено.'; host.appendChild(empty); return; }
    state.proposal.items.forEach(function (item) {
      var key = item.identity || identity(item), card = document.createElement('article'); card.className = 'spec-row';
      function cell(label, text, className) { var node = document.createElement('div'); node.className = className || ''; node.setAttribute('data-label', label); node.textContent = text; card.appendChild(node); }
      cell('Код', item.code, 'spec-code'); cell('Модель и наименование', [item.model, item.name].filter(Boolean).join(' · '), 'spec-name');
      var quantity = document.createElement('div'); quantity.className = 'spec-quantity'; quantity.setAttribute('data-label', 'Количество');
      var minus = document.createElement('button'); minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', 'Уменьшить количество');
      var input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.step = '1'; input.value = item.quantity; input.setAttribute('aria-label', 'Количество ' + item.name);
      var plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', 'Увеличить количество');
      var error = document.createElement('small'); error.className = 'row-error';
      minus.addEventListener('click', function () { if (item.quantity > 1) { ProposalUI.setQuantity(state.proposal, key, item.quantity - 1); commitProposal(); } });
      plus.addEventListener('click', function () { ProposalUI.setQuantity(state.proposal, key, item.quantity + 1); commitProposal(); });
      input.addEventListener('change', function () { var result = ProposalUI.setQuantity(state.proposal, key, input.value); if (!result.valid) { error.textContent = result.message; input.value = item.quantity; } else commitProposal(); });
      quantity.appendChild(minus); quantity.appendChild(input); quantity.appendChild(plus); quantity.appendChild(error); card.appendChild(quantity);
      var price = document.createElement('div'); price.className = 'spec-price'; price.setAttribute('data-label', 'Цена за ед.');
      var priceInput = document.createElement('input'); priceInput.type = 'number'; priceInput.min = '0'; priceInput.value = item.installedUnitPrice; priceInput.setAttribute('aria-label', 'Цена ' + item.name);
      var source = document.createElement('small'); source.textContent = 'Из справочника: ' + ProposalUI.formatMoney(item.sourceInstalledUnitPrice == null ? item.installedUnitPrice : item.sourceInstalledUnitPrice);
      var priceReset = document.createElement('button'); priceReset.type = 'button'; priceReset.className = 'reset-value'; priceReset.textContent = item.priceOverridden ? 'Изменено вручную · сбросить' : 'По справочнику'; priceReset.disabled = !item.priceOverridden;
      priceInput.addEventListener('change', function () { if (ProposalUI.setManualPrice(state.proposal, key, priceInput.value)) commitProposal(); });
      priceReset.addEventListener('click', function () { ProposalUI.resetManualPrice(state.proposal, key); commitProposal(); });
      price.appendChild(priceInput); price.appendChild(source); price.appendChild(priceReset); card.appendChild(price);
      cell('Сумма', ProposalUI.formatMoney(item.quantity * item.installedUnitPrice), 'spec-total');
      var del = document.createElement('button'); del.type = 'button'; del.className = 'spec-delete'; del.textContent = 'Удалить'; del.addEventListener('click', function () { ProposalUI.removeEquipment(state.proposal, key); commitProposal(); }); card.appendChild(del);
      host.appendChild(card);
    });
  }
  function totalRow(host, label, value, emphasized, override) { var row = document.createElement('div'); row.className = 'total-row' + (emphasized ? ' total-final' : ''); var key = document.createElement('span'); key.textContent = label; if (override && override.overridden) { var badge = document.createElement('small'); badge.className = 'manual-badge'; badge.textContent = 'Изменено вручную · расчёт ' + ProposalUI.formatMoney(override.calculated); key.appendChild(badge); } var amount = document.createElement('strong'); amount.textContent = ProposalUI.formatMoney(value); row.appendChild(key); row.appendChild(amount); host.appendChild(row); }
  function renderTotals() {
    var computed = state.proposal.computed || {}, equipment = computed.equipment || {}, host = document.getElementById('proposalTotals'); host.innerHTML = '';
    totalRow(host, 'Оборудование', equipment.subtotal); totalRow(host, 'Скидка', equipment.discountAmount ? -equipment.discountAmount : 0); totalRow(host, 'Монтаж', computed.installation && computed.installation.final, false, computed.installation);
    totalRow(host, 'Разовый платёж', computed.oneTime && computed.oneTime.final, true); totalRow(host, 'В месяц', computed.monthlyFee && computed.monthlyFee.final, true, computed.monthlyFee); totalRow(host, 'Материальная ответственность', computed.materialLiability && computed.materialLiability.final, true, computed.materialLiability);
    [ ['installation', computed.installation], ['monthlyFee', computed.monthlyFee], ['materialLiability', computed.materialLiability] ].forEach(function (entry) { var input = document.getElementById('override' + entry[0][0].toUpperCase() + entry[0].slice(1)); if (entry[1] && entry[1].overridden) input.classList.add('is-overridden'); else input.classList.remove('is-overridden'); });
    var warnings = document.getElementById('proposalWarnings'); warnings.innerHTML = '';
    var changes = computed.tariff && computed.tariff.automaticChanges || [];
    changes.forEach(function (change) { var note = document.createElement('p'); note.className = 'calculation-note'; note.textContent = 'Тариф изменён автоматически: ' + change.from + ' → ' + change.to + '. ' + change.reason + '.'; warnings.appendChild(note); });
    (computed.warnings || []).forEach(function (warning) { var note = document.createElement('p'); note.className = 'warning-item'; note.textContent = warning.message + ' Проверьте параметры расчёта.'; warnings.appendChild(note); });
    var valid = ProposalUI.isProposalValid(state.proposal); ['btnExportPdf', 'btnExportXlsx'].forEach(function (id) { var button = document.getElementById(id); button.disabled = !valid; button.setAttribute('aria-disabled', String(!valid)); button.title = 'Выгрузка будет доступна после сохранения расчёта'; });
  }
  function renderCalculator() {
    renderScenarioControls();
    var p = state.proposal;
    document.getElementById('proposalCameraCount').value = p.counts.cameraCount;
    document.getElementById('proposalHouseholdSensors').value = p.counts.additionalHouseholdSensors;
    document.getElementById('proposalSecuritySensors').value = p.counts.additionalSecuritySensors;
    document.getElementById('proposalDiscount').value = p.discountPercent;
    document.querySelectorAll('#proposalOptions input').forEach(function (input) { input.checked = p.selectedOptionNames.indexOf(input.value) !== -1; });
    [['overrideInstallation','installationOverride'],['overrideMonthlyFee','monthlyFeeOverride'],['overrideMaterialLiability','materialLiabilityOverride']].forEach(function (binding) { var value = p.overrides[binding[1]]; document.getElementById(binding[0]).value = value == null ? '' : value; });
    renderSelectedEquipment(); renderTotals();
  }
  function bindCalculator() {
    var catalog = root.CESAR_CALCULATOR_CATALOGS.calculator, equipmentCatalog = root.CESAR_CALCULATOR_CATALOGS.equipment.items;
    var systemSelect = document.getElementById('equipmentSystemFilter'); unique(equipmentCatalog.map(function (item) { return item.system; })).forEach(function (system) { var first = equipmentCatalog.find(function (item) { return item.system === system; }); option(systemSelect, system, first.systemLabel); });
    catalog.discounts.filter(function (discount) { return Number.isFinite(discount.percent); }).forEach(function (discount) { option(document.getElementById('proposalDiscount'), discount.percent, discount.percent + ' %'); });
    catalog.options.forEach(function (item, index) { var label = document.createElement('label'); label.className = 'option-check'; var input = document.createElement('input'); input.type = 'checkbox'; input.value = item.name; input.id = 'proposalOption' + index; var text = document.createElement('span'); text.textContent = item.name + ' · ' + ProposalUI.formatMoney(item.monthlyPrice) + '/мес.'; label.appendChild(input); label.appendChild(text); document.getElementById('proposalOptions').appendChild(label); input.addEventListener('change', function () { state.proposal.selectedOptionNames = Array.from(document.querySelectorAll('#proposalOptions input:checked')).map(function (node) { return node.value; }); commitProposal(); }); });
    document.querySelectorAll('[name="proposalSegment"]').forEach(function (radio) { radio.addEventListener('change', function () { if (radio.checked) { state.proposal.scenario.segment = radio.value; commitProposal(); } }); });
    document.getElementById('proposalRent').addEventListener('change', function (event) { state.proposal.scenario.rent = event.target.checked; commitProposal(); });
    [['proposalRegion','region'],['proposalObjectType','objectType'],['proposalTariff','tariff']].forEach(function (binding) { document.getElementById(binding[0]).addEventListener('change', function (event) { state.proposal.scenario[binding[1]] = event.target.value; commitProposal(); }); });
    [['proposalCameraCount','cameraCount'],['proposalHouseholdSensors','additionalHouseholdSensors'],['proposalSecuritySensors','additionalSecuritySensors']].forEach(function (binding) { document.getElementById(binding[0]).addEventListener('change', function (event) { state.proposal.counts[binding[1]] = event.target.value; commitProposal(); }); });
    document.getElementById('proposalDiscount').addEventListener('change', function (event) { state.proposal.discountPercent = event.target.value; commitProposal(); });
    document.getElementById('equipmentSearch').addEventListener('input', renderSearchResults); systemSelect.addEventListener('change', renderSearchResults);
    [['overrideInstallation','installationOverride'],['overrideMonthlyFee','monthlyFeeOverride'],['overrideMaterialLiability','materialLiabilityOverride']].forEach(function (binding) { var input = document.getElementById(binding[0]); input.addEventListener('change', function () { state.proposal.overrides[binding[1]] = input.value; commitProposal(); }); });
    [['resetInstallation','installationOverride'],['resetMonthlyFee','monthlyFeeOverride'],['resetMaterialLiability','materialLiabilityOverride']].forEach(function (binding) { document.getElementById(binding[0]).addEventListener('click', function () { root.CesarProposalState.resetOverride(state.proposal, binding[1], root.CESAR_CALCULATOR_CATALOGS); document.getElementById('override' + binding[0].slice(5)).value = ''; save(); render(); renderCalculator(); }); });
    ['btnExportPdf','btnExportXlsx'].forEach(function (id) { document.getElementById(id).addEventListener('click', function () { toast('Выгрузка будет доступна после сохранения расчёта'); }); });
    renderCalculator();
  }

  /* ---------- фото-пикеры (обложка, менеджер) ---------- */
  function bindPhotoPickers() {
    document.querySelectorAll('.filepick[data-photo]').forEach(function (wrap) {
      var path = wrap.getAttribute('data-photo');
      var btn = wrap.querySelector('.filepick-btn');
      var nameEl = wrap.querySelector('.filepick-name');
      var isAvatar = path === 'manager.photo';

      function refresh() {
        var v = getPath(state, path);
        wrap.querySelectorAll('.filepick-thumb, .filepick-clear').forEach(function (n) { n.remove(); });
        if (v) {
          wrap.classList.add('has-photo');
          nameEl.textContent = (v === DEFAULT_HERO) ? 'Фото CESAR SATELLITE (по умолчанию)' : 'Загружено';
          var img = document.createElement('img');
          img.className = 'filepick-thumb'; img.src = v;
          wrap.insertBefore(img, nameEl);
          var clr = document.createElement('button');
          clr.type = 'button'; clr.className = 'filepick-clear'; clr.textContent = 'убрать';
          clr.onclick = function () { setPath(state, path, ''); save(); render(); refresh(); };
          wrap.appendChild(clr);
        } else {
          wrap.classList.remove('has-photo');
          nameEl.textContent = isAvatar ? 'необязательно' : 'необязательно — иначе берётся первое фото события';
        }
      }
      btn.addEventListener('click', function () {
        pickImage(function (data) { setPath(state, path, data); save(); render(); refresh(); },
          isAvatar ? 400 : 1800, isAvatar ? 0.85 : 0.82);
      });
      refresh();
    });
  }

  /* ---------- акции ---------- */
  var promotionsEl = document.getElementById('promotions');

  function selectedPromotion(id) {
    return state.promotions.find(function (item) { return item.id === id; });
  }

  function togglePromotion(item) {
    var index = state.promotions.findIndex(function (selected) { return selected.id === item.id; });
    if (index === -1) {
      state.promotions.push({ id: item.id, title: item.title, description: item.description, image: item.image, priority: item.priority });
    } else {
      state.promotions.splice(index, 1);
    }
    save(); render(); renderPromotions();
  }

  function renderPromotions() {
    promotionsEl.innerHTML = '';
    (window.CESAR_PROMOTIONS || []).map(function (item, index) {
      return { item: item, index: index };
    }).sort(function (a, b) {
      return b.item.priority - a.item.priority || a.index - b.index;
    }).map(function (entry) {
      return entry.item;
    }).forEach(function (item) {
      var selected = selectedPromotion(item.id);
      var card = document.createElement('div');
      card.className = 'promo-option' + (selected ? ' selected' : '');
      card.setAttribute('role', 'checkbox');
      card.setAttribute('aria-checked', selected ? 'true' : 'false');
      card.tabIndex = 0;
      card.innerHTML =
        '<div class="promo-option-image"><img src="' + item.image + '" alt=""><span class="promo-check">✓</span></div>' +
        '<div class="promo-option-body"><div class="promo-option-title">' + item.title + '</div>' +
        '<div class="promo-option-description">' + item.description + '</div></div>' +
        (selected ? '<div class="promo-edit">' +
          '<label class="field"><span>Заголовок в отчёте</span><input data-promo-title></label>' +
          '<label class="field"><span>Описание в отчёте</span><textarea data-promo-description></textarea></label>' +
        '</div>' : '');

      card.addEventListener('click', function (event) {
        if (event.target.closest('.promo-edit')) return;
        togglePromotion(item);
      });
      card.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); togglePromotion(item);
        }
      });

      if (selected) {
        var titleInput = card.querySelector('[data-promo-title]');
        var descriptionInput = card.querySelector('[data-promo-description]');
        titleInput.value = selected.title;
        descriptionInput.value = selected.description;
        titleInput.addEventListener('input', function () { selected.title = titleInput.value; save(); render(); });
        descriptionInput.addEventListener('input', function () { selected.description = descriptionInput.value; save(); render(); });
      }
      promotionsEl.appendChild(card);
    });
  }

  /* ---------- события ---------- */
  var eventsEl = document.getElementById('events');
  function newEvent() {
    return { signal: 'Тревожный сигнал: вторжение', date: '', time: '', address: '', photo: '', note: '' };
  }
  function renderEvents() {
    eventsEl.innerHTML = '';
    state.events.forEach(function (ev, idx) {
      eventsEl.appendChild(eventCard(ev, idx));
    });
  }
  function eventCard(ev, idx) {
    var card = document.createElement('div');
    card.className = 'ev';
    card.innerHTML =
      '<div class="ev-head"><div class="ev-num">Событие ' + (idx + 1) + '<small>из ' + state.events.length + '</small></div>' +
      '<div class="ev-actions">' +
        '<button class="ev-icon" data-act="up" title="Выше">↑</button>' +
        '<button class="ev-icon" data-act="down" title="Ниже">↓</button>' +
        '<button class="ev-icon danger" data-act="del" title="Удалить">✕</button>' +
      '</div></div>' +
      '<div class="ev-grid">' +
        '<div class="ev-photo-drop" data-drop>' +
          (ev.photo ? '<button class="ev-photo-clear" data-clearphoto>✕</button><img src="' + ev.photo + '" alt="">'
                    : '<div class="drop-hint">＋ Нажмите или перетащите фото сюда</div>') +
        '</div>' +
        '<label class="field"><span>Тип сигнала</span><input data-ev="signal" placeholder="Тревожный сигнал: вторжение"></label>' +
        '<div class="grid2">' +
          '<label class="field"><span>Дата</span><input data-ev="date" placeholder="01 января 2025 г."></label>' +
          '<label class="field"><span>Время</span><input data-ev="time" placeholder="00:00 МСК"></label>' +
        '</div>' +
        '<label class="field"><span>Адрес</span><input data-ev="address" placeholder="Москва, ул. Миклухо-Маклая, д. 66"></label>' +
        '<label class="field"><span>Комментарий</span><textarea data-ev="note" placeholder="Описание события (необязательно)"></textarea></label>' +
      '</div>';

    // значения
    card.querySelectorAll('[data-ev]').forEach(function (inp) {
      var key = inp.getAttribute('data-ev');
      if (ev[key] != null) inp.value = ev[key];
      inp.addEventListener('input', function () { ev[key] = inp.value; save(); render(); });
    });

    // фото
    var drop = card.querySelector('[data-drop]');
    drop.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-clearphoto')) return;
      pickImage(function (data) { ev.photo = data; save(); render(); renderEvents(); }, 1800, 0.82);
    });
    var clearBtn = card.querySelector('[data-clearphoto]');
    if (clearBtn) clearBtn.addEventListener('click', function (e) {
      e.stopPropagation(); ev.photo = ''; save(); render(); renderEvents();
    });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('dragover'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.classList.remove('dragover');
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) fileToDataURL(f, 1800, 0.82).then(function (data) { ev.photo = data; save(); render(); renderEvents(); });
    });

    // действия
    card.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act');
        if (act === 'del') { state.events.splice(idx, 1); }
        else if (act === 'up' && idx > 0) { swap(idx, idx - 1); }
        else if (act === 'down' && idx < state.events.length - 1) { swap(idx, idx + 1); }
        save(); render(); renderEvents();
      });
    });
    return card;
  }
  function swap(a, b) { var t = state.events[a]; state.events[a] = state.events[b]; state.events[b] = t; }

  document.getElementById('btnAddEvent').addEventListener('click', function () {
    state.events.push(newEvent()); save(); render(); renderEvents();
    var last = eventsEl.lastElementChild;
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  /* ---------- генерация ссылки ---------- */
  var modal = document.getElementById('modal');
  var linkInput = document.getElementById('linkInput');
  var linkOpen = document.getElementById('linkOpen');
  var btnGen = document.getElementById('btnGenerate');

  btnGen.addEventListener('click', function () {
    if (editorBlocked) { showBlockedWarning(); return; }
    var orig = btnGen.textContent;
    btnGen.disabled = true; btnGen.textContent = 'Публикуем…';
    fetch('/api/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    }).then(function (r) {
      if (!r.ok) throw new Error('server');
      return r.json();
    }).then(function (res) {
      var url = location.origin + '/r/' + res.id;
      linkInput.value = url; linkOpen.href = url;
      modal.hidden = false;
    }).catch(function () {
      toast('Ошибка публикации. Проверьте, что сервер запущен.');
    }).finally(function () {
      btnGen.disabled = false; btnGen.textContent = orig;
    });
  });

  document.getElementById('btnCopy').addEventListener('click', function () { copy(linkInput.value); });
  linkInput.addEventListener('click', function () { linkInput.select(); });
  document.getElementById('btnCloseModal').addEventListener('click', function () { modal.hidden = true; });
  modal.addEventListener('click', function (e) { if (e.target === modal) modal.hidden = true; });

  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('Ссылка скопирована'); }, fallbackCopy);
    else fallbackCopy();
    function fallbackCopy() { linkInput.select(); try { document.execCommand('copy'); toast('Ссылка скопирована'); } catch (e) {} }
  }

  /* ---------- прочее ---------- */
  document.getElementById('btnReset').addEventListener('click', function () {
    if (editorBlocked) { showBlockedWarning(); return; }
    if (!confirm('Очистить все поля отчёта?')) return;
    state = freshDraft();
    save(); rebindAll();
  });

  var panePreview = document.getElementById('panePreview');
  document.getElementById('btnPreviewMobile').addEventListener('click', function () { panePreview.classList.add('open'); render(); });
  document.getElementById('btnClosePreview').addEventListener('click', function () { panePreview.classList.remove('open'); });

  var toastEl = document.getElementById('toast'), toastTimer;
  function showBlockedWarning() {
    if (!editorBlocked || !toastEl) return;
    toastEl.textContent = editorBlockMessage;
    toastEl.hidden = false;
  }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2200);
  }

  function rebindAll() {
    document.querySelectorAll('[data-path]').forEach(function (el) {
      var v = getPath(state, el.getAttribute('data-path')); el.value = v == null ? '' : v;
    });
    bindPhotoPickers(); renderPromotions(); renderEvents(); renderCalculator(); render();
  }

  /* ---------- старт ---------- */
  bindFields();
  if (!editorBlocked) bindCalculator();
  bindPhotoPickers();
  renderPromotions();
  renderEvents();
  render();
  showBlockedWarning();
})(typeof window !== 'undefined' ? window : globalThis);
