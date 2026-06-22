const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// ── Firebase init ─────────────────────────────────────────
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  }),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.europe-west1.firebasedatabase.app`
});
const db = admin.database();

// ── Bot init ──────────────────────────────────────────────
const TOKEN = process.env.BOT_TOKEN || '8583015637:AAHujSR7PBiBO6FbtsV_5R_8VsKkMU7PyEc';
const OWNER_ID = process.env.OWNER_CHAT_ID || '345888574';
const bot = new TelegramBot(TOKEN, { polling: true });

const states = {};

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Firebase helpers ──────────────────────────────────────
async function saveUser(msg, path = null) {
  const id = String(msg.chat?.id || msg.from?.id || msg);
  const ref = db.ref(`users/${id}`);
  const snap = await ref.once('value');

  if (!snap.exists()) {
    await ref.set({
      chatId: id,
      username: msg.from?.username || msg.chat?.username || '',
      firstName: msg.from?.first_name || msg.chat?.first_name || '',
      path: path,
      status: 'new',
      createdAt: Date.now(),
      followup3sent: false,
      followup7sent: false,
      followup14sent: false
    });
  } else if (path) {
    await ref.update({ path, status: 'waiting' });
  }
}

async function updateUser(chatId, data) {
  await db.ref(`users/${chatId}`).update(data);
}

async function getAllUsers() {
  const snap = await db.ref('users').once('value');
  return snap.val() || {};
}

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

// ── /start без параметра ──────────────────────────────────
bot.onText(/^\/start$/, async (msg) => {
  await saveUser(msg);
  sendMenu(msg.chat.id);
});

// ── /start с deep link ────────────────────────────────────
bot.onText(/\/start (audit|new)/, async (msg, match) => {
  const id = msg.chat.id;
  const param = match[1];
  await saveUser(msg, param);

  if (param === 'audit') {
    states[id] = 'audit_waiting_url';
    bot.sendMessage(id,
      `🔍 *Аудит сайта*\n\nПришлите ссылку на ваш сайт — разберём по 6 параметрам и пришлём результат в течение 24 часов.\n\n_Пример: https://example.ru_`,
      { parse_mode: 'Markdown' }
    );
  } else {
    states[id] = 'new_q1';
    bot.sendMessage(id,
      `🚀 *Создание сайта*\n\nЗадам несколько коротких вопросов — подготовлю предложение под ваш бизнес.\n\n*Вопрос 1 из 4*\n👉 Чем занимается ваш бизнес?`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ── Команды владельца ─────────────────────────────────────

// /stats
bot.onText(/\/stats/, async (msg) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const users = await getAllUsers();
  const all = Object.values(users);
  const audit = all.filter(u => u.path === 'audit').length;
  const newSite = all.filter(u => u.path === 'new').length;
  const waiting = all.filter(u => u.status === 'waiting').length;
  const done = all.filter(u => u.status === 'done').length;

  bot.sendMessage(OWNER_ID,
    `📊 *Статистика SiteReset*\n\n` +
    `👥 Всего пользователей: *${all.length}*\n` +
    `🔍 Путь "Аудит": *${audit}*\n` +
    `🚀 Путь "Новый сайт": *${newSite}*\n\n` +
    `⏳ Ждут ответа: *${waiting}*\n` +
    `✅ Завершили: *${done}*`,
    { parse_mode: 'Markdown' }
  );
});

// /users
bot.onText(/\/users/, async (msg) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const users = await getAllUsers();
  const all = Object.values(users);
  if (!all.length) { bot.sendMessage(OWNER_ID, 'Пользователей пока нет.'); return; }

  const lines = all.slice(-30).map(u => {
    const name = u.username ? `@${u.username}` : u.firstName;
    const path = u.path === 'audit' ? '🔍' : u.path === 'new' ? '🚀' : '—';
    const date = new Date(u.createdAt).toLocaleDateString('ru-RU');
    return `${path} ${name} | ${u.status} | ${date} | \`${u.chatId}\``;
  });

  bot.sendMessage(OWNER_ID,
    `👥 *Последние ${lines.length} пользователей:*\n\n${lines.join('\n')}`,
    { parse_mode: 'Markdown' }
  );
});

// /broadcast текст — всем
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const text = match[1];
  const users = await getAllUsers();
  const all = Object.values(users);
  let sent = 0, failed = 0;

  for (const u of all) {
    try {
      await bot.sendMessage(u.chatId, text, { parse_mode: 'Markdown' });
      sent++;
      await delay(100);
    } catch { failed++; }
  }
  bot.sendMessage(OWNER_ID, `✅ Рассылка завершена\nОтправлено: ${sent}\nОшибок: ${failed}`);
});

// /broadcast_audit текст — только путь аудит
bot.onText(/\/broadcast_audit (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const text = match[1];
  const users = await getAllUsers();
  const filtered = Object.values(users).filter(u => u.path === 'audit');
  let sent = 0, failed = 0;

  for (const u of filtered) {
    try {
      await bot.sendMessage(u.chatId, text, { parse_mode: 'Markdown' });
      sent++;
      await delay(100);
    } catch { failed++; }
  }
  bot.sendMessage(OWNER_ID, `✅ Рассылка (аудит) завершена\nОтправлено: ${sent}\nОшибок: ${failed}`);
});

// /broadcast_new текст — только путь новый сайт
bot.onText(/\/broadcast_new (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const text = match[1];
  const users = await getAllUsers();
  const filtered = Object.values(users).filter(u => u.path === 'new');
  let sent = 0, failed = 0;

  for (const u of filtered) {
    try {
      await bot.sendMessage(u.chatId, text, { parse_mode: 'Markdown' });
      sent++;
      await delay(100);
    } catch { failed++; }
  }
  bot.sendMessage(OWNER_ID, `✅ Рассылка (новый сайт) завершена\nОтправлено: ${sent}\nОшибок: ${failed}`);
});

// /send ID текст
bot.onText(/\/send (\d+) ([\s\S]+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const targetId = match[1];
  const text = match[2];
  try {
    await bot.sendMessage(targetId, text, { parse_mode: 'Markdown' });
    await updateUser(targetId, { status: 'responded' });
    await delay(1200);
    await bot.sendMessage(targetId, `💡 Есть вопросы или хотите двигаться дальше?`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💬 Хочу обсудить детали', callback_data: 'want_contact' }],
          [{ text: '🔄 Начать заново', callback_data: 'restart' }]
        ]
      }
    });
    bot.sendMessage(OWNER_ID, `✅ Отправлено клиенту ${targetId}`);
  } catch(e) {
    bot.sendMessage(OWNER_ID, `❌ Ошибка: ${e.message}`);
  }
});

// Файл от владельца клиенту
bot.on('message', async (msg) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const caption = (msg.caption || '').trim();
  const match = caption.match(/^\/send (\d+)/);
  if (!match) return;

  const targetId = match[1];
  const extraText = caption.replace(/^\/send \d+\s*/, '').trim();

  try {
    if (msg.document) {
      await bot.sendDocument(targetId, msg.document.file_id, { caption: extraText || undefined });
    } else if (msg.photo) {
      await bot.sendPhoto(targetId, msg.photo[msg.photo.length-1].file_id, { caption: extraText || undefined });
    } else if (msg.video) {
      await bot.sendVideo(targetId, msg.video.file_id, { caption: extraText || undefined });
    } else return;

    await updateUser(targetId, { status: 'responded' });
    await delay(1200);
    await bot.sendMessage(targetId, `💡 Есть вопросы или хотите двигаться дальше?`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💬 Хочу обсудить детали', callback_data: 'want_contact' }],
          [{ text: '🔄 Начать заново', callback_data: 'restart' }]
        ]
      }
    });
    bot.sendMessage(OWNER_ID, `✅ Файл отправлен клиенту ${targetId}`);
  } catch(e) {
    bot.sendMessage(OWNER_ID, `❌ Ошибка: ${e.message}`);
  }
});

// ── Callbacks ─────────────────────────────────────────────
bot.on('callback_query', async (q) => {
  const id = q.message.chat.id;
  const data = q.data;
  await bot.answerCallbackQuery(q.id);

  if (data === 'path_audit') {
    await updateUser(id, { path: 'audit', status: 'waiting' });
    states[id] = 'audit_waiting_url';
    bot.sendMessage(id,
      `🔍 *Аудит сайта*\n\n📎 Пришлите ссылку на ваш сайт.\n\n_Пример: https://example.ru_`,
      { parse_mode: 'Markdown' }
    );
  }

  if (data === 'path_new') {
    await updateUser(id, { path: 'new', status: 'waiting' });
    states[id] = 'new_q1';
    bot.sendMessage(id,
      `🚀 *Создание сайта*\n\nЗадам несколько коротких вопросов.\n\n*Вопрос 1 из 4*\n👉 Чем занимается ваш бизнес?`,
      { parse_mode: 'Markdown' }
    );
  }

  if (data === 'prices') {
    bot.sendMessage(id,
      `📋 *Наши пакеты*\n\n` +
      `*1 страница — 5 000 ₽*\n▪️ Лендинг под ключ\n▪️ Адаптив под мобильный\n▪️ от 1 дня\n\n` +
      `*До 5 страниц — 10 000 ₽*\n▪️ Многостраничный сайт\n▪️ Портфолио / каталог\n▪️ Срок: 5 дней\n\n` +
      `*До 10 страниц — 15 000 ₽*\n▪️ Полноценный сайт\n▪️ Срок: 7 дней\n\n` +
      `_Доп. сервисы — обсуждаем отдельно._\n_Оплата после. Не понравится — возврат._`,
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
      `🔥 *Горячий лид!*\n\n👤 ${name}\n🆔 ${id}`,
      { parse_mode: 'Markdown' }
    );
    bot.sendMessage(id, `👍 Оставьте номер телефона или @username — свяжемся в течение часа.`);
  }

  if (data === 'restart') {
    await updateUser(id, { status: 'new' });
    sendMenu(id);
  }

  if (data === 'check_another') {
    states[id] = 'audit_waiting_url';
    bot.sendMessage(id, '📎 Пришлите ссылку на следующий сайт:');
  }
});

// ── Текстовые сообщения пользователей ────────────────────
bot.on('message', async (msg) => {
  const id = msg.chat.id;
  const text = (msg.text || '').trim();

  if (!text || text.startsWith('/')) return;
  if (String(id) === String(OWNER_ID)) return;

  const state = states[id];
  console.log(`[${id}] state=${state} text=${text.substring(0,40)}`);

  if (state === 'waiting_contact') {
    const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    bot.sendMessage(OWNER_ID,
      `📞 *Контакт от лида*\n\n👤 ${name}\n🆔 ${id}\n📱 ${text}`,
      { parse_mode: 'Markdown' }
    );
    await updateUser(id, { status: 'lead', contact: text });
    bot.sendMessage(id, '✅ Получили! Свяжемся в течение часа.');
    states[id] = 'done';
    return;
  }

  // ── АУДИТ ──
  if (state === 'audit_waiting_url') {
    let url = text;
    if (!url.startsWith('http')) url = 'https://' + url;
    try { new URL(url); } catch {
      bot.sendMessage(id, '❌ Не похоже на ссылку. Пример: `https://example.ru`', { parse_mode: 'Markdown' });
      return;
    }
    await updateUser(id, { url, status: 'waiting' });
    states[id] = 'audit_pending';

    bot.sendMessage(id,
      `✅ *Заявка принята!*\n\n🌐 ${url}\n\n⏳ Аудит пришлём в течение 24 часов прямо сюда.`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '📋 Посмотреть цены', callback_data: 'prices' }]] }
      }
    );
    const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    bot.sendMessage(OWNER_ID,
      `🔔 *Новая заявка — АУДИТ*\n\n👤 ${name}\n🆔 \`${id}\`\n🌐 ${url}\n\nОтправить аудит:\n/send ${id} [текст]`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ── НОВЫЙ САЙТ — 4 вопроса ──
  if (state === 'new_q1') {
    await updateUser(id, { 'answers/business': text });
    states[id] = 'new_q2';
    bot.sendMessage(id, `*Вопрос 2 из 4*\n\n👉 Кто ваши клиенты? Кому продаёте?`, { parse_mode: 'Markdown' });
    return;
  }

  if (state === 'new_q2') {
    await updateUser(id, { 'answers/clients': text });
    states[id] = 'new_q3';
    bot.sendMessage(id, `*Вопрос 3 из 4*\n\n👉 Что должен делать сайт?\n\nНапример: принимать заявки, продавать онлайн, показывать портфолио...`, { parse_mode: 'Markdown' });
    return;
  }

  if (state === 'new_q3') {
    await updateUser(id, { 'answers/goal': text });
    states[id] = 'new_q4';
    bot.sendMessage(id, `*Вопрос 4 из 4*\n\n👉 Есть примеры сайтов которые нравятся?\n\nЕсли нет — напишите "нет".`, { parse_mode: 'Markdown' });
    return;
  }

  if (state === 'new_q4') {
    await updateUser(id, { 'answers/examples': text, status: 'waiting' });
    states[id] = 'new_pending';

    bot.sendMessage(id,
      `✅ *Отлично! Заявка принята.*\n\nПодготовим предложение с ценой и сроком в течение 24 часов.`,
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

    const snap = await db.ref(`users/${id}`).once('value');
    const u = snap.val() || {};
    const a = u.answers || {};
    const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    bot.sendMessage(OWNER_ID,
      `🚀 *Новая заявка — НОВЫЙ САЙТ*\n\n👤 ${name}\n🆔 \`${id}\`\n\n🏢 ${a.business}\n👥 ${a.clients}\n🎯 ${a.goal}\n🔗 ${a.examples}\n\nОтправить предложение:\n/send ${id} [текст]`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (!state || state === 'done' || state === 'menu') sendMenu(id);
});

// ── Автопрогрев ───────────────────────────────────────────
const FOLLOWUP = {
  3: `Успели посмотреть аудит?\n\nЕсли есть вопросы — просто ответьте на это сообщение, разберём вместе.`,
  7: `Если решите делать редизайн — сейчас хороший момент.\n\nПока очередь небольшая, берём в работу быстро.`,
  14: `Последний раз пишу — не хочу быть навязчивым.\n\nЕсли надумаете обновить сайт — вы знаете где нас найти.\n\nsitereset.github.io`
};

setInterval(async () => {
  const users = await getAllUsers();
  const now = Date.now();
  const DAY = 86400000;

  for (const u of Object.values(users)) {
    if (!u.createdAt || u.status === 'done' || u.status === 'lead') continue;
    const days = Math.floor((now - u.createdAt) / DAY);

    if (days >= 3 && !u.followup3sent) {
      try {
        await bot.sendMessage(u.chatId, FOLLOWUP[3]);
        await updateUser(u.chatId, { followup3sent: true });
        await delay(500);
      } catch {}
    } else if (days >= 7 && !u.followup7sent) {
      try {
        await bot.sendMessage(u.chatId, FOLLOWUP[7]);
        await updateUser(u.chatId, { followup7sent: true });
        await delay(500);
      } catch {}
    } else if (days >= 14 && !u.followup14sent) {
      try {
        await bot.sendMessage(u.chatId, FOLLOWUP[14]);
        await updateUser(u.chatId, { followup14sent: true, status: 'done' });
        await delay(500);
      } catch {}
    }
  }
}, 3600000); // каждый час

bot.on('polling_error', (err) => console.error('Polling error:', err.message));
process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));

console.log('✅ SiteReset Bot + Firebase запущен');
