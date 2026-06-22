const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const TOKEN = process.env.BOT_TOKEN || '8583015637:AAHujSR7PBiBO6FbtsV_5R_8VsKkMU7PyEc';
const OWNER_ID = process.env.OWNER_CHAT_ID || '345888574';
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const bot = new TelegramBot(TOKEN, { polling: true });

// state: waiting_url | analyzing | waiting_contact | done
const states = {};
const lastUrl = {};

// ─── /start ──────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const id = msg.chat.id;
  states[id] = 'waiting_url';
  bot.sendMessage(id,
    `👋 *Привет!*\n\nЯ проанализирую ваш сайт и бесплатно покажу что мешает ему приносить клиентов.\n\n` +
    `Проверяю 6 параметров:\n` +
    `▪️ Мобильная версия\n` +
    `▪️ Скорость загрузки\n` +
    `▪️ Главный экран и заголовок\n` +
    `▪️ Кнопки и формы заявок\n` +
    `▪️ Доверие и соцдоказательства\n` +
    `▪️ Итог и рекомендации\n\n` +
    `📎 *Пришлите ссылку на сайт* — и через минуту получите разбор.`,
    { parse_mode: 'Markdown' }
  );
});

// ─── Main message handler ─────────────────────────────────
bot.on('message', async (msg) => {
  const id = msg.chat.id;
  const text = (msg.text || '').trim();

  if (!text || text.startsWith('/')) return;

  // ── Collecting contact after hot lead ──
  if (states[id] === 'waiting_contact') {
    const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    bot.sendMessage(OWNER_ID,
      `📞 *Контакт от лида — SiteReset*\n\n👤 ${name}\n🆔 chat: ${id}\n📱 ${text}`,
      { parse_mode: 'Markdown' }
    );
    bot.sendMessage(id, '✅ Получили! Свяжемся с вами в течение часа.');
    states[id] = 'done';
    return;
  }

  // ── Waiting for URL ──
  if (states[id] === 'analyzing') {
    bot.sendMessage(id, '⏳ Уже анализирую ваш сайт, подождите немного...');
    return;
  }

  // ── Detect URL ──
  let url = text;
  if (!url.startsWith('http')) url = 'https://' + url;

  try {
    new URL(url);
  } catch {
    bot.sendMessage(id,
      '❌ Не похоже на ссылку.\n\nПришлите адрес сайта, например:\n`https://example.ru`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  states[id] = 'analyzing';
  lastUrl[id] = url;

  const loading = await bot.sendMessage(id, '🔍 Анализирую сайт...\nЭто займёт 30–60 секунд.');

  try {
    // ── Fetch HTML ──
    let html = '';
    try {
      const r = await axios.get(url, {
        timeout: 12000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SiteAuditBot)' },
        maxContentLength: 500000
      });
      html = String(r.data).replace(/<script[\s\S]*?<\/script>/gi, '')
                           .replace(/<style[\s\S]*?<\/style>/gi, '')
                           .replace(/<[^>]+>/g, ' ')
                           .replace(/\s+/g, ' ')
                           .substring(0, 6000);
    } catch (e) {
      html = 'HTML недоступен — сайт не ответил или закрыт.';
    }

    // ── PageSpeed ──
    let speed = '';
    try {
      const ps = await axios.get(
        `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile`,
        { timeout: 20000 }
      );
      const lhr = ps.data.lighthouseResult;
      const score = Math.round((lhr?.categories?.performance?.score || 0) * 100);
      const fcp   = lhr?.audits?.['first-contentful-paint']?.displayValue || '—';
      const lcp   = lhr?.audits?.['largest-contentful-paint']?.displayValue || '—';
      const tbt   = lhr?.audits?.['total-blocking-time']?.displayValue || '—';
      const heavy = lhr?.audits?.['uses-optimized-images']?.score === 0 ? 'Изображения не оптимизированы. ' : '';
      const js    = lhr?.audits?.['unused-javascript']?.score === 0 ? 'Много лишнего JS. ' : '';
      speed = `Балл мобильной скорости: ${score}/100. FCP: ${fcp}, LCP: ${lcp}, TBT: ${tbt}. ${heavy}${js}`;
    } catch {
      speed = 'PageSpeed данные недоступны.';
    }

    // ── Claude audit ──
    const resp = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1600,
      messages: [{
        role: 'user',
        content:
`Ты эксперт по конверсии сайтов. Сделай аудит сайта ${url}.

ТЕКСТ СТРАНИЦЫ (очищен от HTML):
${html}

ДАННЫЕ СКОРОСТИ (Google PageSpeed, мобильный):
${speed}

Напиши аудит строго в этом формате. Каждый пункт — 2-3 конкретных предложения без воды.

📱 *01. Мобильная версия*
[оценка: есть ли адаптив, viewport, насколько удобно на телефоне]

⚡ *02. Скорость загрузки*
[используй данные PageSpeed: балл, главные проблемы, вывод]

🎯 *03. Главный экран*
[есть ли чёткий заголовок, понятно ли чем занимается компания, есть ли призыв к действию]

🔘 *04. Кнопки и формы*
[есть ли CTA-кнопки, формы, телефон, насколько легко оставить заявку]

⭐ *05. Доверие*
[отзывы, кейсы, лицензии, команда, адрес — что есть, чего не хватает]

📊 *06. Итог*
Оценка сайта: *X/10*
Топ-3 проблемы:
• [самая критичная проблема]
• [вторая проблема]
• [третья проблема]

Пиши по-русски, конкретно, как профессионал. Без вводных фраз типа "Давайте рассмотрим".`
      }]
    });

    const audit = resp.content[0].text;

    await bot.deleteMessage(id, loading.message_id).catch(() => {});

    // Send audit
    await bot.sendMessage(id,
      `🔍 *Аудит сайта:*\n_${url}_\n\n${audit}`,
      { parse_mode: 'Markdown' }
    );

    // Offer after pause
    await new Promise(r => setTimeout(r, 2000));
    await bot.sendMessage(id,
      `💡 *Хотите исправить эти проблемы?*\n\nМы переделываем сайты за 3 дня. Стоимость от 15 000 ₽.\nОплата после — гарантия или возврат.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Хочу новый сайт — обсудить', callback_data: 'want_site' }],
            [{ text: '📋 Пакеты и цены', callback_data: 'prices' }],
            [{ text: '🔄 Проверить другой сайт', callback_data: 'again' }]
          ]
        }
      }
    );

    // Notify owner
    const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    bot.sendMessage(OWNER_ID,
      `🔔 *Новый аудит — SiteReset*\n\n👤 ${name}\n🆔 ${id}\n🌐 ${url}`,
      { parse_mode: 'Markdown' }
    );

    states[id] = 'done';

  } catch (err) {
    await bot.deleteMessage(id, loading.message_id).catch(() => {});
    bot.sendMessage(id,
      '❌ Не удалось проанализировать сайт. Проверьте ссылку и попробуйте ещё раз.\n\nПример: `https://example.ru`',
      { parse_mode: 'Markdown' }
    );
    states[id] = 'waiting_url';
    console.error('Audit error:', err.message);
  }
});

// ─── Callbacks ────────────────────────────────────────────
bot.on('callback_query', async (q) => {
  const id = q.message.chat.id;
  await bot.answerCallbackQuery(q.id);

  if (q.data === 'want_site') {
    states[id] = 'waiting_contact';
    const name = q.from.username ? `@${q.from.username}` : q.from.first_name;
    bot.sendMessage(OWNER_ID,
      `🔥 *Горячий лид — SiteReset*\n\n👤 ${name}\n🆔 ${id}\n🌐 ${lastUrl[id] || '—'}\n\nНажал "Хочу новый сайт"`,
      { parse_mode: 'Markdown' }
    );
    bot.sendMessage(id, '👍 Отлично!\n\nОставьте номер телефона или ваш Telegram @username — свяжемся в течение часа.');
  }

  if (q.data === 'prices') {
    bot.sendMessage(id,
      `📋 *Пакеты SiteReset*\n\n` +
      `*Старт — 15 000 ₽*\n` +
      `▪️ Лендинг (1 страница)\n▪️ Адаптив под мобильный\n▪️ Формы заявок\n▪️ Срок: 3 дня\n\n` +
      `*Стандарт — 29 000 ₽*\n` +
      `▪️ До 5 страниц\n▪️ Каталог или портфолио\n▪️ SEO-базовое\n▪️ Срок: 5 дней\n\n` +
      `*Про — 45 000 ₽*\n` +
      `▪️ До 10 страниц\n▪️ Интеграция с CRM/формами\n▪️ Настройка аналитики\n▪️ Срок: 7 дней\n\n` +
      `_Оплата после результата. Не понравится — возвращаем деньги._`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Обсудить мой проект', callback_data: 'want_site' }]
          ]
        }
      }
    );
  }

  if (q.data === 'again') {
    states[id] = 'waiting_url';
    bot.sendMessage(id, '📎 Пришлите ссылку на следующий сайт:');
  }
});

console.log('✅ SiteReset Bot запущен');
