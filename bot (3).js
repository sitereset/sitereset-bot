const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.BOT_TOKEN || '8583015637:AAHujSR7PBiBO6FbtsV_5R_8VsKkMU7PyEc';
const OWNER_ID = process.env.OWNER_CHAT_ID || '345888574';

const bot = new TelegramBot(TOKEN, { polling: true });
const states = {};

// ─── /start ──────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const id = msg.chat.id;
  states[id] = 'waiting_url';
  bot.sendMessage(id,
    `👋 *Привет!*\n\nЯ бесплатно разберу ваш сайт по 6 параметрам:\n\n` +
    `▪️ Мобильная версия\n` +
    `▪️ Скорость загрузки\n` +
    `▪️ Главный экран и заголовок\n` +
    `▪️ Кнопки и формы заявок\n` +
    `▪️ Доверие и соцдоказательства\n` +
    `▪️ Итог и рекомендации\n\n` +
    `📎 *Пришлите ссылку на ваш сайт* — аудит пришлём в течение 24 часов.`,
    { parse_mode: 'Markdown' }
  );
});

// ─── Команда для отправки аудита клиенту ─────────────────
// Использование: /send 123456789 Текст аудита...
bot.onText(/\/send (\d+) ([\s\S]+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const targetId = match[1];
  const auditText = match[2];
  try {
    await bot.sendMessage(targetId, auditText, { parse_mode: 'Markdown' });
    await new Promise(r => setTimeout(r, 1000));
    await bot.sendMessage(targetId,
      `💡 *Хотите исправить эти проблемы?*\n\nМы переделываем сайты за 3 дня. От 15 000 ₽.\nОплата после — гарантия или возврат.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Хочу новый сайт — обсудить', callback_data: `lead_${targetId}` }],
            [{ text: '📋 Пакеты и цены', callback_data: 'prices' }],
            [{ text: '🔄 Проверить другой сайт', callback_data: 'again' }]
          ]
        }
      }
    );
    bot.sendMessage(OWNER_ID, `✅ Аудит отправлен клиенту ${targetId}`);
  } catch (e) {
    bot.sendMessage(OWNER_ID, `❌ Ошибка отправки: ${e.message}`);
  }
});

// ─── Сообщения пользователей ──────────────────────────────
bot.on('message', async (msg) => {
  const id = msg.chat.id;
  const text = (msg.text || '').trim();

  if (!text || text.startsWith('/')) return;
  if (String(id) === String(OWNER_ID)) return;

  // Ждёт контакт после нажатия "Хочу сайт"
  if (states[id] === 'waiting_contact') {
    const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    bot.sendMessage(OWNER_ID,
      `📞 *Контакт от лида*\n\n👤 ${name}\n🆔 ${id}\n📱 ${text}`,
      { parse_mode: 'Markdown' }
    );
    bot.sendMessage(id, '✅ Получили! Свяжемся в течение часа.');
    states[id] = 'done';
    return;
  }

  // Принимаем URL
  let url = text;
  if (!url.startsWith('http')) url = 'https://' + url;
  let valid = true;
  try { new URL(url); } catch { valid = false; }

  if (!valid) {
    bot.sendMessage(id,
      '❌ Не похоже на ссылку.\n\nПришлите адрес сайта, например:\n`https://example.ru`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  states[id] = 'pending';

  // Ответ пользователю
  bot.sendMessage(id,
    `✅ *Заявка принята!*\n\n🌐 ${url}\n\n⏳ Аудит пришлём в течение 24 часов — прямо сюда в бот.\n\nА пока можете посмотреть что мы проверяем 👆`,
    { parse_mode: 'Markdown' }
  );

  // Уведомление тебе
  const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
  bot.sendMessage(OWNER_ID,
    `🔔 *Новая заявка на аудит*\n\n👤 ${name}\n🆔 \`${id}\`\n🌐 ${url}\n\n` +
    `Чтобы отправить аудит клиенту:\n` +
    `/send ${id} [текст аудита]`,
    { parse_mode: 'Markdown' }
  );
});

// ─── Callbacks ────────────────────────────────────────────
bot.on('callback_query', async (q) => {
  const id = q.message.chat.id;
  await bot.answerCallbackQuery(q.id);

  if (q.data.startsWith('lead_')) {
    states[id] = 'waiting_contact';
    const name = q.from.username ? `@${q.from.username}` : q.from.first_name;
    bot.sendMessage(OWNER_ID,
      `🔥 *Горячий лид!*\n\n👤 ${name}\n🆔 ${id}\n\nНажал "Хочу новый сайт"`,
      { parse_mode: 'Markdown' }
    );
    bot.sendMessage(id, '👍 Отлично!\n\nОставьте номер телефона или @username — свяжемся в течение часа.');
  }

  if (q.data === 'prices') {
    bot.sendMessage(id,
      `📋 *Пакеты SiteReset*\n\n` +
      `*Старт — 15 000 ₽*\n▪️ Лендинг (1 страница)\n▪️ Адаптив под мобильный\n▪️ Срок: 3 дня\n\n` +
      `*Стандарт — 29 000 ₽*\n▪️ До 5 страниц\n▪️ Каталог или портфолио\n▪️ Срок: 5 дней\n\n` +
      `*Про — 45 000 ₽*\n▪️ До 10 страниц + интеграции\n▪️ Срок: 7 дней\n\n` +
      `_Оплата после. Не понравится — возврат._`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '💬 Обсудить проект', callback_data: 'lead_manual' }]]
        }
      }
    );
  }

  if (q.data === 'again') {
    states[id] = 'waiting_url';
    bot.sendMessage(id, '📎 Пришлите ссылку на следующий сайт:');
  }

  if (q.data === 'lead_manual') {
    states[id] = 'waiting_contact';
    bot.sendMessage(id, '👍 Оставьте номер телефона или @username — свяжемся в течение часа.');
  }
});

console.log('✅ SiteReset Bot запущен (ручной режим)');
