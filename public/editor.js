/* Конструктор отчётов — логика редактора */
(function () {
  'use strict';
  var LS_KEY = 'cesar_report_draft_v2';
  var DEFAULT_HERO = '/hero-default.jpg';

  var DEFAULT = {
    title: 'Отчёт о мониторинге автомобиля',
    subtitle: 'на основе данных системы мониторинга CESAR SATELLITE',
    objectTitle: 'Информация об объекте',
    object: { pin: '', owner: '', brand: '', model: '', plate: '', address: '' },
    heroPhoto: DEFAULT_HERO,
    summary: { alarms: '', incidents: '' },
    eventsTitle: 'Фотоматериалы и события',
    events: [],
    manager: {
      label: 'Ваш персональный менеджер',
      name: 'Мешенков Андрей',
      role: 'Руководитель направления безопасности',
      phone: '+7 495 785 53 53 · доб. 4311',
      email: 'a.meshenkov@cesar-satellite.ru',
      photo: ''
    }
  };

  var state = load();

  /* ---------- утилиты состояния ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) return Object.assign({}, DEFAULT, JSON.parse(raw));
    } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULT));
  }
  var saveTimer;
  function save() {
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
        setPath(state, path, el.value);
        save(); render();
      });
    });
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
    if (!confirm('Очистить все поля отчёта?')) return;
    state = JSON.parse(JSON.stringify(DEFAULT)); state.events = [];
    save(); rebindAll();
  });

  var panePreview = document.getElementById('panePreview');
  document.getElementById('btnPreviewMobile').addEventListener('click', function () { panePreview.classList.add('open'); render(); });
  document.getElementById('btnClosePreview').addEventListener('click', function () { panePreview.classList.remove('open'); });

  var toastEl = document.getElementById('toast'), toastTimer;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2200);
  }

  function rebindAll() {
    document.querySelectorAll('[data-path]').forEach(function (el) {
      var v = getPath(state, el.getAttribute('data-path')); el.value = v == null ? '' : v;
    });
    bindPhotoPickers(); renderEvents(); render();
  }

  /* ---------- старт ---------- */
  bindFields();
  bindPhotoPickers();
  renderEvents();
  render();
})();
