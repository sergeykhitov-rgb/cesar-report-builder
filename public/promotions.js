(function (global) {
  'use strict';

  global.CESAR_PRIORITY_PROMOTIONS = Object.freeze([
    'two-objects',
    'refer-friend',
    'prepayment'
  ]);

  global.CESAR_PROMOTIONS = Object.freeze([
    { id: 'two-objects', title: 'Два объекта выгоднее', description: 'Скидка 20% на общую ежемесячную абонентскую плату при одновременном подключении двух и более объектов.', image: '/assets/promotions/two-objects.webp', priority: 300 },
    { id: 'refer-friend', title: 'Приведи друга', description: 'Месяц абонентской платы в подарок за каждого нового клиента по рекомендации.', image: '/assets/promotions/refer-friend.webp', priority: 200 },
    { id: 'reactivation', title: 'Возвращайтесь на выгодных условиях', description: 'При возобновлении обслуживания оплаченный период от четырёх месяцев удваивается по условиям акции.', image: '/assets/promotions/reactivation.webp', priority: 0 },
    { id: 'prepayment', title: 'Выгодная предоплата', description: 'Специальные условия при оплате 9 или 12 месяцев обслуживания вперёд.', image: '/assets/promotions/prepayment.webp', priority: 100 },
    { id: 'equipment-discount', title: 'Комплект и дополнительные устройства', description: 'Скидка 15% на оборудование при дополнительном подключении услуг.', image: '/assets/promotions/equipment-discount.webp', priority: 0 },
    { id: 'same-day-install', title: 'Установка в день обращения', description: 'Скидка 10% при планировании установки в день обращения.', image: '/assets/promotions/same-day-install.webp', priority: 0 },
    { id: 'three-cameras', title: 'Видеонаблюдение от трёх камер', description: 'Обслуживание охранной системы без дополнительной платы при подключении видеоохраны от трёх камер.', image: '/assets/promotions/three-cameras.webp', priority: 0 },
    { id: 'competitor-estimate', title: 'Предложение лучше сметы конкурента', description: 'Индивидуальное ценовое предложение при наличии действующей сметы другой охранной компании.', image: '/assets/promotions/competitor-estimate.webp', priority: 0 },
    { id: 'repair-certificate', title: 'Сертификат на ремонт', description: 'Сертификат номиналом 5 000 рублей для клиентов в течение двух месяцев после ремонта.', image: '/assets/promotions/repair-certificate.webp', priority: 0 },
    { id: 'easy-move', title: 'Лёгкий переезд', description: 'Специальные условия переноса охранной системы на новый объект.', image: '/assets/promotions/easy-move.webp', priority: 0 },
    { id: 'first-month-free', title: 'Первый месяц бесплатно', description: 'Скидка 100% на абонентскую плату в течение первых 30 дней.', image: '/assets/promotions/first-month-free.webp', priority: 0 },
    { id: 'switch-free', title: 'Переключение оборудования за 0 рублей', description: 'Подключение совместимого оборудования другой охранной компании без платы за переключение.', image: '/assets/promotions/switch-free.webp', priority: 0 },
    { id: 'safe-box', title: 'Сейф-бокс по специальной цене', description: 'Сейф-бокс за 1 500 рублей вместо 4 200 рублей.', image: '/assets/promotions/safe-box.webp', priority: 0 },
    { id: 'rental-zero', title: 'Оборудование в аренду за 0 рублей', description: 'Базовый или выгодный комплект для квартиры, коттеджа или малого бизнеса предоставляется в аренду без платы за оборудование при соблюдении условий акции.', image: '/assets/promotions/rental-zero.webp', priority: 0 }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
