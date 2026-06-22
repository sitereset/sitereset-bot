const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.BOT_TOKEN || '8583015637:AAHujSR7PBiBO6FbtsV_5R_8VsKkMU7PyEc';
const OWNER_ID = process.env.OWNER_CHAT_ID || '345888574';
const bot = new TelegramBot(TOKEN, { polling: true });

// state per user
const states = {};
const userData = {};

const TG_SVG = ''; // unused

// ── Главное меню ──────────────────────────────────────────
function sendMenu(chatId) {
  states[chatId] = 'menu';
  bot.sendMessage(chatId,
    `👋 *Привет! Я бот SiteReset.*\n\nЧем могу помочь?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Есть сайт — хочу аудит', callback_data: 'path_audit' }],
          [{ text: '🚀 Сайта нет — хочу создать', callback_data: 'path_new' }]
        ]
      }
    }
  );
}

// ── /start ────────────────────────────────────────────────
bot.onText(/\/start (.+)/, (msg, match) => {
  const id = msg.chat.id;
  const param = match[1].trim();
  userData[id] = { answers: {} };

  if (param === 'audit') {
    states[id] = 'audit_waiting_url';
    userData[id].path = 'audit';
    bot.sendMessage(id,
      `🔍 *Аудит сайта*\n\nПришлите ссылку на ваш сайт — разберём по 6 параметрам и пришлём результат в течение 24 часов.\n\n_Пример: https://example.ru_`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (param === 'new') {
    states[id] = 'new_q1';
    userData[id].path = 'new';
    bot.sendMessage(id,
      `🚀 *Создание сайта*\n\nОтлично! Задам несколько коротких вопросов — чтобы подготовить предложение под ваш бизнес.\n\n*Вопрос 1 из 4*\n👉 Чем занимается ваш бизнес?`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // без параметра — обычное меню
  userData[id] = { path: null, url: null, answers: {} };
  sendMenu(id);
});

bot.onText(/^\/start$/, (msg) => {
  userData[msg.chat.id] = { path: null, url: null, answers: {} };
  sendMenu(msg.chat.id);
});

// ── Команда владельца: отправить ответ клиенту ────────────
// /send 123456 текст ответа...
bot.onText(/\/send (\d+) ([\s\S]+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const targetId = match[1];
  const text = match[2];
  try {
    await bot.sendMessage(targetId, text, { parse_mode: 'Markdown' });
    await delay(1200);
    await bot.sendMessage(targetId,
      `💡 *Есть вопросы или хотите двигаться дальше?*`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Хочу обсудить детали', callback_data: 'want_contact' }],
            [{ text: '🔄 Начать заново', callback_data: 'restart' }]
          ]
        }
      }
    );
    bot.sendMessage(OWNER_ID, `✅ Сообщение отправлено клиенту ${targetId}`);
  } catch(e) {
    bot.sendMessage(OWNER_ID, `❌ Ошибка: ${e.message}`);
  }
});

// ── Callbacks ─────────────────────────────────────────────
bot.on('callback_query', async (q) => {
  const id = q.message.chat.id;
  const data = q.data;
  await bot.answerCallbackQuery(q.id);

  // ── ПУТЬ 1: АУДИТ ──
  if (data === 'path_audit') {
    states[id] = 'audit_waiting_url';
    userData[id] = { path: 'audit' };
    bot.sendMessage(id,
      `🔍 *Аудит сайта*\n\n📎 Пришлите ссылку на ваш сайт — разберём по 6 параметрам и пришлём результат в течение 24 часов.\n\n_Пример: https://example.ru_`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── ПУТЬ 2: НОВЫЙ САЙТ ──
  if (data === 'path_new') {
    states[id] = 'new_q1';
    userData[id] = { path: 'new', answers: {} };
    bot.sendMessage(id,
      `🚀 *Создание сайта*\n\nОтлично! Задам вам несколько коротких вопросов — чтобы подготовить предложение под ваш бизнес.\n\n*Вопрос 1 из 4*\n👉 Чем занимается ваш бизнес? Опишите в 1-2 предложениях.`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── Цены ──
  if (data === 'prices') {
    bot.sendMessage(id,
      `📋 *Наши пакеты*\n\n` +
      `*Старт — 15 000 ₽*\n▪️ Лендинг (1 страница)\n▪️ Адаптив под мобильный\n▪️ Формы заявок\n▪️ Срок: 3 дня\n\n` +
      `*Стандарт — 29 000 ₽*\n▪️ До 5 страниц\n▪️ Каталог или портфолио\n▪️ Базовое SEO\n▪️ Срок: 5 дней\n\n` +
      `*Про — 45 000 ₽*\n▪️ До 10 страниц\n▪️ Интеграции, CRM\n▪️ Настройка аналитики\n▪️ Срок: 7 дней\n\n` +
      `_Оплата после. Не понравится — возврат._`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Обсудить мой проект', callback_data: 'want_contact' }]
          ]
        }
      }
    );
  }

  // ── Хочу связаться ──
  if (data === 'want_contact') {
    states[id] = 'waiting_contact';
    const name = q.from.username ? `@${q.from.username}` : q.from.first_name;
    bot.sendMessage(OWNER_ID,
      `🔥 *Горячий лид — SiteReset*\n\n👤 ${name}\n🆔 ${id}\n📂 Путь: ${userData[id]?.path || '?'}\n\nНажал "Хочу обсудить"`,
      { parse_mode: 'Markdown' }
    );
    bot.sendMessage(id,
      `👍 Оставьте номер телефона или @username — свяжемся в течение часа.`
    );
  }

  if (data === 'restart') {
    userData[id] = {};
    sendMenu(id);
  }

  if (data === 'check_another') {
    states[id] = 'audit_waiting_url';
    bot.sendMessage(id, '📎 Пришлите ссылку на следующий сайт:');
  }
});

// ── Текстовые сообщения ───────────────────────────────────
bot.on('message', async (msg) => {
  const id = msg.chat.id;
  const text = (msg.text || '').trim();
  if (!text || text.startsWith('/')) return;
  if (String(id) === String(OWNER_ID)) return;

  const state = states[id];

  // ── Ждём контакт ──
  if (state === 'waiting_contact') {
    const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    bot.sendMessage(OWNER_ID,
      `📞 *Контакт от лида*\n\n👤 ${name}\n🆔 ${id}\n📱 ${text}\n📂 Путь: ${userData[id]?.path || '?'}`,
      { parse_mode: 'Markdown' }
    );
    bot.sendMessage(id, '✅ Получили! Свяжемся в течение часа.');
    states[id] = 'done';
    return;
  }

  // ══════════════════════════════════
  // ПУТЬ 1 — АУДИТ
  // ══════════════════════════════════
  if (state === 'audit_waiting_url') {
    let url = text;
    if (!url.startsWith('http')) url = 'https://' + url;
    try { new URL(url); } catch {
      bot.sendMessage(id, '❌ Не похоже на ссылку. Пример: `https://example.ru`', { parse_mode: 'Markdown' });
      return;
    }

    userData[id] = { ...userData[id], url };
    states[id] = 'audit_pending';

    bot.sendMessage(id,
      `✅ *Заявка принята!*\n\n🌐 ${url}\n\n⏳ Пришлём аудит в течение 24 часов прямо сюда.\n\nПока ждёте — можете посмотреть наши цены:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Посмотреть цены', callback_data: 'prices' }]
          ]
        }
      }
    );

    const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    bot.sendMessage(OWNER_ID,
      `🔔 *Новая заявка на АУДИТ*\n\n👤 ${name}\n🆔 \`${id}\`\n🌐 ${url}\n\n` +
      `Отправить аудит:\n/send ${id} [текст аудита]`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ══════════════════════════════════
  // ПУТЬ 2 — НОВЫЙ САЙТ (4 вопроса)
  // ══════════════════════════════════
  if (state === 'new_q1') {
    userData[id].answers.business = text;
    states[id] = 'new_q2';
    bot.sendMessage(id,
      `*Вопрос 2 из 4*\n\n👉 Кто ваши клиенты? Кому вы продаёте?`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (state === 'new_q2') {
    userData[id].answers.clients = text;
    states[id] = 'new_q3';
    bot.sendMessage(id,
      `*Вопрос 3 из 4*\n\n👉 Что должен делать сайт? Например: принимать заявки, продавать онлайн, показывать портфолио...`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (state === 'new_q3') {
    userData[id].answers.goal = text;
    states[id] = 'new_q4';
    bot.sendMessage(id,
      `*Вопрос 4 из 4*\n\n👉 Есть ли примеры сайтов которые вам нравятся? Если да — скиньте ссылки. Если нет — просто напишите "нет".`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (state === 'new_q4') {
    userData[id].answers.examples = text;
    states[id] = 'new_pending';

    const a = userData[id].answers;
    bot.sendMessage(id,
      `✅ *Отлично! Заявка принята.*\n\nПодготовим предложение с ценой и сроком в течение 24 часов.\n\nЕсли хотите ускорить — оставьте контакт:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📞 Оставить контакт', callback_data: 'want_contact' }],
            [{ text: '📋 Посмотреть цены', callback_data: 'prices' }]
          ]
        }
      }
    );

    const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    bot.sendMessage(OWNER_ID,
      `🚀 *Новая заявка — НОВЫЙ САЙТ*\n\n` +
      `👤 ${name}\n🆔 \`${id}\`\n\n` +
      `🏢 Бизнес: ${a.business}\n` +
      `👥 Клиенты: ${a.clients}\n` +
      `🎯 Цель сайта: ${a.goal}\n` +
      `🔗 Примеры: ${a.examples}\n\n` +
      `Отправить предложение:\n/send ${id} [текст предложения]`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ── Если состояние непонятно — показать меню ──
  if (!state || state === 'done') {
    sendMenu(id);
  }
});

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

console.log('✅ SiteReset Bot запущен — два пути: аудит + новый сайт');
