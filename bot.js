const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.BOT_TOKEN || '8583015637:AAHujSR7PBiBO6FbtsV_5R_8VsKkMU7PyEc';
const OWNER_ID = process.env.OWNER_CHAT_ID || '345888574';
const bot = new TelegramBot(TOKEN, { polling: true });

const states = {};
const userData = {};

function getUser(id) {
  if (!userData[id]) userData[id] = { path: null, answers: {} };
  return userData[id];
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

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

// ── Старт без параметра ───────────────────────────────────
bot.onText(/^\/start$/, (msg) => {
  getUser(msg.chat.id);
  sendMenu(msg.chat.id);
});

// ── Старт с параметром (deep link) ────────────────────────
bot.onText(/\/start (audit|new)/, (msg, match) => {
  const id = msg.chat.id;
  const param = match[1];
  userData[id] = { path: param, answers: {} };

  if (param === 'audit') {
    states[id] = 'audit_waiting_url';
    bot.sendMessage(id,
      `🔍 *Аудит сайта*\n\nПришлите ссылку на ваш сайт — разберём по 6 параметрам и пришлём результат в течение 24 часов.\n\n_Пример: https://example.ru_`,
      { parse_mode: 'Markdown' }
    );
  } else {
    states[id] = 'new_q1';
    bot.sendMessage(id,
      `🚀 *Создание сайта*\n\nОтлично! Задам несколько коротких вопросов — подготовлю предложение под ваш бизнес.\n\n*Вопрос 1 из 4*\n👉 Чем занимается ваш бизнес?`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ── Команда владельца: отправить текст клиенту ────────────
bot.onText(/\/send (\d+) ([\s\S]+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const targetId = match[1];
  const text = match[2];
  try {
    await bot.sendMessage(targetId, text, { parse_mode: 'Markdown' });
    await delay(1200);
    await bot.sendMessage(targetId,
      `💡 Есть вопросы или хотите двигаться дальше?`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Хочу обсудить детали', callback_data: 'want_contact' }],
            [{ text: '🔄 Начать заново', callback_data: 'restart' }]
          ]
        }
      }
    );
    bot.sendMessage(OWNER_ID, `✅ Отправлено клиенту ${targetId}`);
  } catch(e) {
    bot.sendMessage(OWNER_ID, `❌ Ошибка: ${e.message}`);
  }
});

// ── Владелец отправляет файл с подписью /send ID ──────────
bot.on('message', async (msg) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;

  const caption = (msg.caption || '').trim();
  const match = caption.match(/^\/send (\d+)/);
  if (!match) return;

  const targetId = match[1];
  const extraText = caption.replace(/^\/send \d+\s*/, '').trim();

  try {
    if (msg.document) {
      await bot.sendDocument(targetId, msg.document.file_id, {
        caption: extraText || undefined
      });
    } else if (msg.photo) {
      const photo = msg.photo[msg.photo.length - 1];
      await bot.sendPhoto(targetId, photo.file_id, {
        caption: extraText || undefined
      });
    } else if (msg.video) {
      await bot.sendVideo(targetId, msg.video.file_id, {
        caption: extraText || undefined
      });
    } else {
      return;
    }

    await delay(1200);
    await bot.sendMessage(targetId,
      `💡 Есть вопросы или хотите двигаться дальше?`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Хочу обсудить детали', callback_data: 'want_contact' }],
            [{ text: '🔄 Начать заново', callback_data: 'restart' }]
          ]
        }
      }
    );
    bot.sendMessage(OWNER_ID, `✅ Файл отправлен клиенту ${targetId}`);
  } catch(e) {
    bot.sendMessage(OWNER_ID, `❌ Ошибка отправки файла: ${e.message}`);
  }
});

// ── Callbacks ─────────────────────────────────────────────
bot.on('callback_query', async (q) => {
  const id = q.message.chat.id;
  const data = q.data;
  await bot.answerCallbackQuery(q.id);

  if (data === 'path_audit') {
    userData[id] = { path: 'audit', answers: {} };
    states[id] = 'audit_waiting_url';
    bot.sendMessage(id,
      `🔍 *Аудит сайта*\n\n📎 Пришлите ссылку на ваш сайт.\n\n_Пример: https://example.ru_`,
      { parse_mode: 'Markdown' }
    );
  }

  if (data === 'path_new') {
    userData[id] = { path: 'new', answers: {} };
    states[id] = 'new_q1';
    bot.sendMessage(id,
      `🚀 *Создание сайта*\n\nЗадам несколько коротких вопросов.\n\n*Вопрос 1 из 4*\n👉 Чем занимается ваш бизнес?`,
      { parse_mode: 'Markdown' }
    );
  }

  if (data === 'prices') {
    bot.sendMessage(id,
      `📋 *Наши пакеты*\n\n` +
      `*1 страница — 5 000 ₽*\n▪️ Лендинг под ключ\n▪️ Адаптив под мобильный\n▪️ Формы заявок\n▪️ от 1 дня\n\n` +
      `*До 5 страниц — 10 000 ₽*\n▪️ Многостраничный сайт\n▪️ Портфолио / каталог\n▪️ Срок: 5 дней\n\n` +
      `*До 10 страниц — 15 000 ₽*\n▪️ Полноценный сайт компании\n▪️ Срок: 7 дней\n\n` +
      `_Доп. сервисы (интеграции, CRM, анимации) — обсуждаем отдельно._\n_Оплата после. Не понравится — возврат._`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '💬 Обсудить проект', callback_data: 'want_contact' }]]
        }
      }
    );
  }

  if (data === 'want_contact') {
    states[id] = 'waiting_contact';
    const name = q.from.username ? `@${q.from.username}` : q.from.first_name;
    bot.sendMessage(OWNER_ID,
      `🔥 *Горячий лид!*\n\n👤 ${name}\n🆔 ${id}\n📂 ${getUser(id).path || '?'}`,
      { parse_mode: 'Markdown' }
    );
    bot.sendMessage(id, `👍 Оставьте номер телефона или @username — свяжемся в течение часа.`);
  }

  if (data === 'restart') {
    userData[id] = { path: null, answers: {} };
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
  const user = getUser(id);

  console.log(`[${id}] state=${state} text=${text.substring(0,50)}`);

  // ── Ждём контакт ──
  if (state === 'waiting_contact') {
    const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    bot.sendMessage(OWNER_ID,
      `📞 *Контакт от лида*\n\n👤 ${name}\n🆔 ${id}\n📱 ${text}\n📂 ${user.path || '?'}`,
      { parse_mode: 'Markdown' }
    );
    bot.sendMessage(id, '✅ Получили! Свяжемся в течение часа.');
    states[id] = 'done';
    return;
  }

  // ══ ПУТЬ 1: АУДИТ ══════════════════════════════════════
  if (state === 'audit_waiting_url') {
    let url = text;
    if (!url.startsWith('http')) url = 'https://' + url;
    try { new URL(url); } catch {
      bot.sendMessage(id, '❌ Не похоже на ссылку. Пример: `https://example.ru`', { parse_mode: 'Markdown' });
      return;
    }
    user.url = url;
    states[id] = 'audit_pending';

    bot.sendMessage(id,
      `✅ *Заявка принята!*\n\n🌐 ${url}\n\n⏳ Аудит пришлём в течение 24 часов прямо сюда.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '📋 Посмотреть цены', callback_data: 'prices' }]]
        }
      }
    );
    const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    bot.sendMessage(OWNER_ID,
      `🔔 *Новая заявка — АУДИТ*\n\n👤 ${name}\n🆔 \`${id}\`\n🌐 ${url}\n\nОтправить аудит:\n/send ${id} [текст]`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ══ ПУТЬ 2: НОВЫЙ САЙТ — 4 вопроса ════════════════════
  if (state === 'new_q1') {
    user.answers.business = text;
    states[id] = 'new_q2';
    bot.sendMessage(id,
      `*Вопрос 2 из 4*\n\n👉 Кто ваши клиенты? Кому продаёте?`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (state === 'new_q2') {
    user.answers.clients = text;
    states[id] = 'new_q3';
    bot.sendMessage(id,
      `*Вопрос 3 из 4*\n\n👉 Что должен делать сайт?\n\nНапример: принимать заявки, продавать онлайн, показывать портфолио...`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (state === 'new_q3') {
    user.answers.goal = text;
    states[id] = 'new_q4';
    bot.sendMessage(id,
      `*Вопрос 4 из 4*\n\n👉 Есть примеры сайтов которые нравятся?\n\nЕсли да — скиньте ссылки. Если нет — напишите "нет".`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (state === 'new_q4') {
    user.answers.examples = text;
    states[id] = 'new_pending';
    const a = user.answers;

    bot.sendMessage(id,
      `✅ *Отлично! Заявка принята.*\n\nПодготовим предложение с ценой и сроком в течение 24 часов.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📞 Оставить контакт для связи', callback_data: 'want_contact' }],
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
      `🎯 Цель: ${a.goal}\n` +
      `🔗 Примеры: ${a.examples}\n\n` +
      `Отправить предложение:\n/send ${id} [текст]`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ── Непонятное состояние ──
  if (!state || state === 'done' || state === 'menu') {
    sendMenu(id);
  }
});

// ── Глобальный обработчик ошибок ──────────────────────────
bot.on('polling_error', (err) => console.error('Polling error:', err.message));
process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));

console.log('✅ SiteReset Bot запущен');
