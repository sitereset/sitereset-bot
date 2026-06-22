const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

const TOKEN = process.env.BOT_TOKEN || '8583015637:AAHujSR7PBiBO6FbtsV_5R_8VsKkMU7PyEc';
const OWNER_ID = String(process.env.OWNER_CHAT_ID || '345888574');

// ── Firebase ──────────────────────────────────────────────
let db = null;
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
  db = admin.database();
  console.log('✅ Firebase OK');
} catch(e) {
  console.error('⚠️ Firebase error:', e.message);
}

async function dbSave(path, data) {
  if (!db) return;
  try { await db.ref(path).set(data); } catch(e) { console.error('dbSave:', e.message); }
}
async function dbUpdate(path, data) {
  if (!db) return;
  try { await db.ref(path).update(data); } catch(e) { console.error('dbUpdate:', e.message); }
}
async function dbGet(path) {
  if (!db) return null;
  try { const s = await db.ref(path).once('value'); return s.val(); } catch(e) { return null; }
}

// ── Bot ───────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: true });
const states = {};
const mem = {}; // in-memory fallback

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getUser(id) {
  const u = await dbGet(`users/${id}`);
  return u || mem[id] || null;
}

async function createUser(msg) {
  const id = String(msg.chat.id);
  const data = {
    chatId: id,
    username: msg.from?.username || '',
    firstName: msg.from?.first_name || '',
    path: null, status: 'new',
    createdAt: Date.now(),
    followup3: false, followup7: false, followup14: false
  };
  mem[id] = data;
  await dbSave(`users/${id}`, data);
}

async function setUserPath(id, path) {
  if (mem[id]) mem[id].path = path;
  await dbUpdate(`users/${id}`, { path, status: 'waiting' });
}

async function setUserField(id, field, value) {
  if (mem[id]) mem[id][field] = value;
  await dbUpdate(`users/${id}`, { [field]: value });
}

// ── Menu ──────────────────────────────────────────────────
function sendMenu(chatId) {
  states[chatId] = 'menu';
  bot.sendMessage(chatId, `👋 *Привет! Я бот SiteReset.*\n\nЧем могу помочь?`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [
      [{ text: '🔍 Есть сайт — хочу аудит',    callback_data: 'path_audit' }],
      [{ text: '🚀 Сайта нет — хочу создать',   callback_data: 'path_new'   }]
    ]}
  });
}

// ── /start ────────────────────────────────────────────────
bot.onText(/\/start$/, async (msg) => {
  const id = String(msg.chat.id);
  if (!await getUser(id)) await createUser(msg);
  sendMenu(id);
});

bot.onText(/\/start (audit|new)/, async (msg, match) => {
  const id = String(msg.chat.id);
  if (!await getUser(id)) await createUser(msg);
  const param = match[1];
  await setUserPath(id, param);

  if (param === 'audit') {
    states[id] = 'audit_url';
    bot.sendMessage(id,
      `🔍 *Аудит сайта*\n\nПришлите ссылку на ваш сайт.\n\n_Пример: https://example.ru_`,
      { parse_mode: 'Markdown' });
  } else {
    states[id] = 'new_q1';
    bot.sendMessage(id,
      `🚀 *Создание сайта*\n\n*Вопрос 1 из 4*\n👉 Чем занимается ваш бизнес?`,
      { parse_mode: 'Markdown' });
  }
});

// ── Owner: /stats ─────────────────────────────────────────
bot.onText(/\/stats/, async (msg) => {
  if (String(msg.chat.id) !== OWNER_ID) return;
  const users = await dbGet('users') || {};
  const all = Object.values(users);
  const audit   = all.filter(u => u.path === 'audit').length;
  const newSite = all.filter(u => u.path === 'new').length;
  const waiting = all.filter(u => u.status === 'waiting').length;
  bot.sendMessage(OWNER_ID,
    `📊 *Статистика*\n\n👥 Всего: *${all.length}*\n🔍 Аудит: *${audit}*\n🚀 Новый сайт: *${newSite}*\n⏳ Ждут ответа: *${waiting}*`,
    { parse_mode: 'Markdown' });
});

// ── Owner: /users ─────────────────────────────────────────
bot.onText(/\/users/, async (msg) => {
  if (String(msg.chat.id) !== OWNER_ID) return;
  const users = await dbGet('users') || {};
  const all = Object.values(users).slice(-20);
  if (!all.length) { bot.sendMessage(OWNER_ID, 'Пользователей пока нет.'); return; }
  const lines = all.map(u => {
    const icon = u.path === 'audit' ? '🔍' : u.path === 'new' ? '🚀' : '—';
    const name = u.username ? `@${u.username}` : u.firstName;
    return `${icon} ${name} | \`${u.chatId}\``;
  });
  bot.sendMessage(OWNER_ID, `👥 *Последние ${lines.length}:*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
});

// ── Owner: /broadcast ─────────────────────────────────────
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== OWNER_ID) return;
  const text = match[1];
  const users = await dbGet('users') || {};
  let sent = 0, fail = 0;
  for (const u of Object.values(users)) {
    try { await bot.sendMessage(u.chatId, text, { parse_mode: 'Markdown' }); sent++; await delay(150); }
    catch { fail++; }
  }
  bot.sendMessage(OWNER_ID, `✅ Рассылка: отправлено ${sent}, ошибок ${fail}`);
});

bot.onText(/\/broadcast_audit (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== OWNER_ID) return;
  const text = match[1];
  const users = await dbGet('users') || {};
  let sent = 0, fail = 0;
  for (const u of Object.values(users).filter(u => u.path === 'audit')) {
    try { await bot.sendMessage(u.chatId, text, { parse_mode: 'Markdown' }); sent++; await delay(150); }
    catch { fail++; }
  }
  bot.sendMessage(OWNER_ID, `✅ Рассылка (аудит): ${sent} / ошибок ${fail}`);
});

bot.onText(/\/broadcast_new (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== OWNER_ID) return;
  const text = match[1];
  const users = await dbGet('users') || {};
  let sent = 0, fail = 0;
  for (const u of Object.values(users).filter(u => u.path === 'new')) {
    try { await bot.sendMessage(u.chatId, text, { parse_mode: 'Markdown' }); sent++; await delay(150); }
    catch { fail++; }
  }
  bot.sendMessage(OWNER_ID, `✅ Рассылка (новый сайт): ${sent} / ошибок ${fail}`);
});

// ── Owner: /send ──────────────────────────────────────────
bot.onText(/\/send (\d+) ([\s\S]+)/, async (msg, match) => {
  if (String(msg.chat.id) !== OWNER_ID) return;
  const [, targetId, text] = match;
  try {
    await bot.sendMessage(targetId, text, { parse_mode: 'Markdown' });
    await setUserField(targetId, 'status', 'responded');
    await delay(1200);
    await bot.sendMessage(targetId, `💡 Есть вопросы или хотите двигаться дальше?`, {
      reply_markup: { inline_keyboard: [
        [{ text: '💬 Хочу обсудить детали', callback_data: 'want_contact' }],
        [{ text: '🔄 Начать заново',         callback_data: 'restart'      }]
      ]}
    });
    bot.sendMessage(OWNER_ID, `✅ Отправлено клиенту ${targetId}`);
  } catch(e) { bot.sendMessage(OWNER_ID, `❌ Ошибка: ${e.message}`); }
});

// ── All messages ──────────────────────────────────────────
bot.on('message', async (msg) => {
  const id = String(msg.chat.id);
  const text = (msg.text || '').trim();

  // Owner: file forward
  if (id === OWNER_ID) {
    const caption = (msg.caption || '').trim();
    const m = caption.match(/^\/send (\d+)/);
    if (!m) return;
    const targetId = m[1];
    const extra = caption.replace(/^\/send \d+\s*/, '').trim();
    try {
      if (msg.document) await bot.sendDocument(targetId, msg.document.file_id, { caption: extra || undefined });
      else if (msg.photo) await bot.sendPhoto(targetId, msg.photo[msg.photo.length-1].file_id, { caption: extra || undefined });
      else if (msg.video) await bot.sendVideo(targetId, msg.video.file_id, { caption: extra || undefined });
      else return;
      await setUserField(targetId, 'status', 'responded');
      await delay(1200);
      await bot.sendMessage(targetId, `💡 Есть вопросы или хотите двигаться дальше?`, {
        reply_markup: { inline_keyboard: [
          [{ text: '💬 Хочу обсудить детали', callback_data: 'want_contact' }],
          [{ text: '🔄 Начать заново',         callback_data: 'restart'      }]
        ]}
      });
      bot.sendMessage(OWNER_ID, `✅ Файл отправлен клиенту ${targetId}`);
    } catch(e) { bot.sendMessage(OWNER_ID, `❌ Ошибка: ${e.message}`); }
    return;
  }

  if (!text || text.startsWith('/')) return;

  const state = states[id];
  console.log(`MSG [${id}] state=${state} "${text.slice(0,30)}"`);

  // Waiting contact
  if (state === 'waiting_contact') {
    const name = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name;
    bot.sendMessage(OWNER_ID, `📞 *Контакт*\n\n👤 ${name}\n🆔 ${id}\n📱 ${text}`, { parse_mode: 'Markdown' });
    await setUserField(id, 'status', 'lead');
    bot.sendMessage(id, '✅ Получили! Свяжемся в течение часа.');
    states[id] = 'done';
    return;
  }

  // AUDIT
  if (state === 'audit_url') {
    let url = text;
    if (!url.startsWith('http')) url = 'https://' + url;
    try { new URL(url); } catch {
      bot.sendMessage(id, '❌ Не похоже на ссылку. Пример: `https://example.ru`', { parse_mode: 'Markdown' });
      return;
    }
    await setUserField(id, 'url', url);
    states[id] = 'audit_pending';
    bot.sendMessage(id,
      `✅ *Заявка принята!*\n\n🌐 ${url}\n\n⏳ Аудит пришлём в течение 24 часов.`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📋 Посмотреть цены', callback_data: 'prices' }]] }}
    );
    const name = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name;
    bot.sendMessage(OWNER_ID,
      `🔔 *АУДИТ*\n\n👤 ${name}\n🆔 \`${id}\`\n🌐 ${url}\n\n/send ${id} [аудит]`,
      { parse_mode: 'Markdown' });
    return;
  }

  // NEW SITE — 4 questions
  if (state === 'new_q1') {
    await dbUpdate(`users/${id}`, { 'answers/business': text });
    states[id] = 'new_q2';
    bot.sendMessage(id, `*Вопрос 2 из 4*\n\n👉 Кто ваши клиенты?`, { parse_mode: 'Markdown' });
    return;
  }
  if (state === 'new_q2') {
    await dbUpdate(`users/${id}`, { 'answers/clients': text });
    states[id] = 'new_q3';
    bot.sendMessage(id, `*Вопрос 3 из 4*\n\n👉 Что должен делать сайт?\n\nНапример: принимать заявки, показывать портфолио...`, { parse_mode: 'Markdown' });
    return;
  }
  if (state === 'new_q3') {
    await dbUpdate(`users/${id}`, { 'answers/goal': text });
    states[id] = 'new_q4';
    bot.sendMessage(id, `*Вопрос 4 из 4*\n\n👉 Есть примеры сайтов которые нравятся?\n\nЕсли нет — напишите "нет".`, { parse_mode: 'Markdown' });
    return;
  }
  if (state === 'new_q4') {
    await dbUpdate(`users/${id}`, { 'answers/examples': text, status: 'waiting' });
    states[id] = 'new_pending';
    bot.sendMessage(id,
      `✅ *Заявка принята!*\n\nПодготовим предложение в течение 24 часов.`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        [{ text: '📞 Оставить контакт', callback_data: 'want_contact' }],
        [{ text: '📋 Посмотреть цены',  callback_data: 'prices'       }]
      ]}}
    );
    const u = await dbGet(`users/${id}`) || {};
    const a = u.answers || {};
    const name = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name;
    bot.sendMessage(OWNER_ID,
      `🚀 *НОВЫЙ САЙТ*\n\n👤 ${name}\n🆔 \`${id}\`\n\n🏢 ${a.business}\n👥 ${a.clients}\n🎯 ${a.goal}\n🔗 ${a.examples}\n\n/send ${id} [предложение]`,
      { parse_mode: 'Markdown' });
    return;
  }

  sendMenu(id);
});

// ── Callbacks ─────────────────────────────────────────────
bot.on('callback_query', async (q) => {
  const id = String(q.message.chat.id);
  await bot.answerCallbackQuery(q.id);

  if (q.data === 'path_audit') {
    await setUserPath(id, 'audit');
    states[id] = 'audit_url';
    bot.sendMessage(id, `🔍 *Аудит сайта*\n\n📎 Пришлите ссылку на ваш сайт.\n\n_Пример: https://example.ru_`, { parse_mode: 'Markdown' });
  }
  if (q.data === 'path_new') {
    await setUserPath(id, 'new');
    states[id] = 'new_q1';
    bot.sendMessage(id, `🚀 *Создание сайта*\n\n*Вопрос 1 из 4*\n👉 Чем занимается ваш бизнес?`, { parse_mode: 'Markdown' });
  }
  if (q.data === 'prices') {
    bot.sendMessage(id,
      `📋 *Наши пакеты*\n\n*1 страница — 5 000 ₽*\n▪️ Лендинг под ключ\n▪️ Адаптив\n▪️ от 1 дня\n\n*До 5 страниц — 10 000 ₽*\n▪️ Многостраничный\n▪️ Срок: 5 дней\n\n*До 10 страниц — 15 000 ₽*\n▪️ Полноценный сайт\n▪️ Срок: 7 дней\n\n_Доп. сервисы — обсуждаем отдельно._\n_Оплата после. Не понравится — возврат._`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '💬 Обсудить проект', callback_data: 'want_contact' }]] }}
    );
  }
  if (q.data === 'want_contact') {
    states[id] = 'waiting_contact';
    const name = q.from.username ? `@${q.from.username}` : q.from.first_name;
    bot.sendMessage(OWNER_ID, `🔥 *Горячий лид!*\n\n👤 ${name}\n🆔 ${id}`, { parse_mode: 'Markdown' });
    bot.sendMessage(id, `👍 Оставьте номер телефона или @username — свяжемся в течение часа.`);
  }
  if (q.data === 'restart') {
    await setUserField(id, 'status', 'new');
    sendMenu(id);
  }
});

// ── Автопрогрев ───────────────────────────────────────────
setInterval(async () => {
  const users = await dbGet('users') || {};
  const now = Date.now();
  const DAY = 86400000;
  for (const u of Object.values(users)) {
    if (!u.createdAt || ['done','lead'].includes(u.status)) continue;
    const days = Math.floor((now - u.createdAt) / DAY);
    try {
      if (days >= 3 && !u.followup3) {
        await bot.sendMessage(u.chatId, `Успели посмотреть?\n\nЕсли есть вопросы — просто ответьте на это сообщение.`);
        await dbUpdate(`users/${u.chatId}`, { followup3: true });
      } else if (days >= 7 && !u.followup7) {
        await bot.sendMessage(u.chatId, `Если решите делать сайт — сейчас хороший момент.\nПока очередь небольшая, берём в работу быстро.`);
        await dbUpdate(`users/${u.chatId}`, { followup7: true });
      } else if (days >= 14 && !u.followup14) {
        await bot.sendMessage(u.chatId, `Последний раз пишу — не хочу быть навязчивым.\n\nЕсли надумаете — вы знаете где нас найти.\nsitereset.github.io`);
        await dbUpdate(`users/${u.chatId}`, { followup14: true, status: 'done' });
      }
    } catch {}
    await delay(200);
  }
}, 3600000);

bot.on('polling_error', err => console.error('Polling:', err.message));
process.on('uncaughtException', err => console.error('Uncaught:', err.message));
process.on('unhandledRejection', err => console.error('Unhandled:', err));

console.log('✅ SiteReset Bot запущен');
