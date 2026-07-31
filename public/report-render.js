/* Общий рендер отчёта CESAR SATELLITE.
   Используется и в предпросмотре редактора, и на публичной странице —
   так они гарантированно выглядят одинаково. */
(function (global) {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
  function has(s) { return s != null && String(s).trim() !== ''; }

  // Настоящий логотип CESAR SATELLITE (экспорт из Figma).
  var LOGO = '<img src="/logo.png" alt="CESAR SATELLITE" style="width:100%;height:auto">';

  function row(k, v) {
    if (!has(v)) return '';
    return '<div class="rp-row"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>';
  }

  function objCard(d, floating) {
    var o = d.object || {};
    var rows = [
      row('PIN', o.pin), row('Владелец', o.owner), row('Марка', o.brand),
      row('Модель', o.model), row('Гос. номер', o.plate), row('Адрес', o.address)
    ].join('');
    if (!has(o.pin) && !has(o.owner) && !has(o.brand) && !has(o.model) && !has(o.plate) && !has(o.address)) rows = '';
    var title = has(d.objectTitle) ? d.objectTitle : 'Информация об объекте';
    if (!rows) return '';
    return '<div class="rp-objcard">' +
      '<h3>' + esc(title) + '</h3><div class="rp-rows">' + rows + '</div></div>';
  }

  function stats(d) {
    var s = d.summary || {};
    if (!has(s.alarms) && !has(s.incidents) && !has(s.extraLabel)) return '';
    var tiles = '';
    if (has(s.alarms)) tiles += '<div class="rp-stat"><div class="num">' + esc(s.alarms) + '</div><div class="cap">' + esc(s.alarmsLabel || 'Тревожных сообщений') + '</div></div>';
    if (has(s.incidents)) tiles += '<div class="rp-stat"><div class="num">' + esc(s.incidents) + '</div><div class="cap">' + esc(s.incidentsLabel || 'Инцидентов') + '</div></div>';
    if (!tiles) return '';
    return '<div class="rp-stats">' + tiles + '</div>';
  }

  function events(d) {
    var evs = (d.events || []).filter(function (e) {
      return has(e.signal) || has(e.date) || has(e.time) || has(e.address) || has(e.photo) || has(e.note);
    });
    if (!evs.length) return '';
    var sectionTitle = has(d.eventsTitle) ? d.eventsTitle : 'Фотоматериалы и события';
    var html = '<div class="rp-section-h"><span class="label-red lbl">Раздел · Хронология</span><h2>' + esc(sectionTitle) + '</h2></div>';
    html += '<div class="rp-events">';
    evs.forEach(function (e) {
      var photo = has(e.photo)
        ? '<div class="rp-event-photo"><img src="' + esc(e.photo) + '" alt=""></div>'
        : '<div class="rp-event-photo empty">Фотография не добавлена</div>';
      var badge = has(e.signal) ? '<div class="rp-event-badge"><span class="dot"></span>' + esc(e.signal) + '</div>' : '';
      var meta = '<div class="rp-meta">' +
        (has(e.date) ? '<div><div class="k">Дата</div><div class="v">' + esc(e.date) + '</div></div>' : '') +
        (has(e.time) ? '<div><div class="k">Время</div><div class="v">' + esc(e.time) + '</div></div>' : '') +
        (has(e.address) ? '<div><div class="k">Адрес</div><div class="v">' + esc(e.address) + '</div></div>' : '') +
        '</div>';
      var note = has(e.note) ? '<div class="rp-event-note">' + nl2br(e.note) + '</div>' : '';
      html += '<div class="rp-event">' + photo + '<div class="rp-event-body">' + badge + meta + note + '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function footer(d) {
    var m = d.manager || {};
    var disc = has(d.disclaimer) ? d.disclaimer
      : 'Отчёт сформирован автоматически системой мониторинга CESAR SATELLITE. Данные актуальны на момент выгрузки.';
    var mgr = '';
    if (has(m.name) || has(m.phone) || has(m.email)) {
      var av = has(m.photo) ? '<img class="rp-mgr-av" src="' + esc(m.photo) + '" alt="">' : '<span class="rp-mgr-av"></span>';
      mgr = '<div class="rp-mgr"><div class="lbl">' + esc(m.label || 'Ваш персональный менеджер') + '</div>' +
        '<div class="rp-mgr-row">' + av + '<div><div class="nm">' + esc(m.name || '') + '</div>' +
        (has(m.role) ? '<div class="ro">' + esc(m.role) + '</div>' : '') + '</div></div>' +
        '<div class="rp-mgr-contacts">' +
        (has(m.phone) ? '<span>' + esc(m.phone) + '</span>' : '') +
        (has(m.email) ? '<a href="mailto:' + esc(m.email) + '">' + esc(m.email) + '</a>' : '') +
        '</div></div>';
    }
    return '<div class="rp-foot"><div class="rp-foot-grid"><div>' +
      '<div class="rp-foot-logo">' + LOGO + '</div>' +
      '<div class="rp-foot-disc">' + esc(disc) + '</div></div>' + mgr + '</div></div>';
  }

  function renderReport(d) {
    d = d || {};
    var title = has(d.title) ? d.title : 'Отчёт о мониторинге';
    var head = '<div class="rp-head"><div class="rp-head-l">' +
      '<div class="rp-accent"></div>' +
      '<div class="rp-title">' + esc(title) + '</div>' +
      (has(d.subtitle) ? '<div class="rp-subtitle">' + esc(d.subtitle) + '</div>' : '') +
      '</div></div>';

    var heroPhoto = d.heroPhoto || (d.events && d.events[0] && d.events[0].photo) || '';
    var card = objCard(d, false);
    var block;
    if (has(heroPhoto)) {
      var overlay = card ? '<div class="rp-objwrap overlay">' + card + '</div>' : '';
      block = '<div class="rp-hero has-img"><img src="' + esc(heroPhoto) + '" alt="">' + overlay + '</div>';
    } else {
      block = card ? '<div class="rp-objwrap flow">' + card + '</div>' : '';
    }
    return '<article class="report">' + head + block + stats(d) + events(d) + footer(d) + '</article>';
  }

  global.renderReport = renderReport;
})(typeof window !== 'undefined' ? window : this);
