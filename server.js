
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
// Отдача статики из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Корневой маршрут
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Healthcheck для Railway
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// ============================================
// TELEGRAM WEBHOOK ENDPOINT
// ============================================
const BOT_TOKEN_FOR_WEBHOOK = process.env.TELEGRAM_BOT_TOKEN;
if (BOT_TOKEN_FOR_WEBHOOK) {
  app.post(`/bot${BOT_TOKEN_FOR_WEBHOOK}`, (req, res) => {
    if (bot) {
      bot.processUpdate(req.body);
    }
    res.sendStatus(200);
  });
}

// ============================================
// SUPABASE CONNECTION
// ============================================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('✅ Supabase connected');
  
  // Initialize tables on startup
  initializeDatabase();
} else {
  console.error('❌ SUPABASE_URL or SUPABASE_KEY not set in .env');
}

async function initializeDatabase() {
  if (!supabase) return;
  
  try {
    // Check if tables exist by trying to query them
    // If they don't exist, they will be created via SQL in Supabase Dashboard
    await supabase.from('users').select('count(*)', { count: 'exact', head: true });
    console.log('✅ Database tables verified');
  } catch (err) {
    console.log('⚠️  Database tables not found. Please create them in Supabase Dashboard.');
  }
}

const BANK_TEMPLATE = [
  { id: 1, name: 'Amazon', status: 'NOT_STARTED', emoji: '🥸' },
  { id: 2, name: 'Wamo', status: 'DECLINED', emoji: '❌' },
  { id: 3, name: 'Paysera Business + звонок +bitget/okx', status: 'APPROVED', emoji: '✔️' },
  { id: 4, name: 'Paynovus + звонок', status: 'APPROVED', emoji: '✔️' },
  { id: 5, name: 'ICard + звонок', status: 'APPROVED', emoji: '✔️' },
  { id: 6, name: 'Mifinity', status: 'APPROVED', emoji: '✔️' },
  { id: 7, name: 'Revolut', status: 'DECLINED', emoji: '❌' },
  { id: 8, name: 'OpenPayd', status: 'IN_PROGRESS', emoji: '💤' },
  { id: 9, name: 'Finom', status: 'DECLINED', emoji: '❌' },
  { id: 10, name: 'Zen', status: 'DECLINED', emoji: '❌' },
  { id: 11, name: 'Genome', status: 'NOT_STARTED', emoji: '🥸' },
  { id: 12, name: 'Multipass', status: 'IN_PROGRESS', emoji: '💤' },
  { id: 13, name: 'Sokin', status: 'DECLINED', emoji: '❌' },
  { id: 14, name: 'Brighty', status: 'IN_PROGRESS', emoji: '💤' },
  { id: 15, name: 'Unlimit', status: 'IN_PROGRESS', emoji: '💤' },
  { id: 16, name: 'Satchel', status: 'NOT_STARTED', emoji: '🥸' }
];

const statusCycle = ['NOT_STARTED', 'IN_PROGRESS', 'APPROVED', 'DECLINED'];
const statusEmoji = {
  'NOT_STARTED': '🥸',
  'IN_PROGRESS': '💤',
  'APPROVED': '✔️',
  'DECLINED': '❌'
};

// ============================================
// TELEGRAM BOT SETUP
// ============================================

let bot = null;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Only use polling in development, not on Railway (to avoid conflicts)
const usePolling = !process.env.RAILWAY_ENVIRONMENT;
const WEBHOOK_URL = 'https://telegram-checklist-production.up.railway.app';

if (BOT_TOKEN) {
  if (usePolling) {
    bot = new TelegramBot(BOT_TOKEN, { polling: true });
    console.log('✅ Telegram Bot connected (polling mode)');
  } else {
    bot = new TelegramBot(BOT_TOKEN, { polling: false });
    
    // Set up webhook for Railway
    bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`).then(() => {
      console.log('✅ Telegram Bot webhook set');
    }).catch(err => {
      console.error('❌ Failed to set webhook:', err.message);
    });
    
    console.log('✅ Telegram Bot connected (webhook mode)');
  }

  // Get the Web App URL
  const WEB_APP_URL = process.env.WEB_APP_URL || 'https://telegram-checklist-production.up.railway.app';
  const BOT_USERNAME = 'checkAwsBot'; // Your bot username without @

  // Helper: Get keyboard based on chat type (web_app doesn't work in groups)
  function getAppKeyboard(chatType) {
    if (chatType === 'private') {
      // web_app works in private chats
      return {
        inline_keyboard: [
          [{ text: '📋 Open Checklist', web_app: { url: WEB_APP_URL } }]
        ]
      };
    } else {
      // For groups, use URL that opens bot with Mini App
      return {
        inline_keyboard: [
          [{ text: '📋 Open Checklist', url: `https://t.me/${BOT_USERNAME}?startapp=open` }]
        ]
      };
    }
  }

  // Bot command handlers
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    // Save user
    try {
      if (supabase) {
        await supabase.from('users').upsert({
          telegram_id: userId,
          username: msg.from.username,
          first_name: msg.from.first_name,
          last_name: msg.from.last_name,
          last_active: new Date().toISOString()
        }, { onConflict: 'telegram_id' });
      }
    } catch (err) {
      console.error('Error saving user:', err);
    }

    const keyboard = getAppKeyboard(msg.chat.type);

    bot.sendMessage(chatId, 
      '📋 Welcome to Telegram Checklist!\n\n' +
      'Click the button below to open the app:',
      { reply_markup: keyboard }
    );
  });

  // Command to open app (works in groups)
  bot.onText(/\/checklist/, async (msg) => {
    const chatId = msg.chat.id;
    const keyboard = getAppKeyboard(msg.chat.type);

    bot.sendMessage(chatId, 
      '📋 Click the button to open the Checklist App:',
      { reply_markup: keyboard }
    );
  });

  // Command /app as alias
  bot.onText(/\/app/, async (msg) => {
    const chatId = msg.chat.id;
    const keyboard = getAppKeyboard(msg.chat.type);

    bot.sendMessage(chatId, 
      '📋 Click the button to open the Checklist App:',
      { reply_markup: keyboard }
    );
  });

  // Command /pin - create pinned message with app button (for groups)
  bot.onText(/\/pin/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Check if it's a group
    if (msg.chat.type === 'private') {
      bot.sendMessage(chatId, '⚠️ This command only works in groups');
      return;
    }
    
    // Use URL button for groups (web_app doesn't work in groups)
    const keyboard = {
      inline_keyboard: [
        [{ text: '📋 Open Checklist', url: `https://t.me/${BOT_USERNAME}?startapp=open` }]
      ]
    };

    try {
      // Send message with button
      const sentMsg = await bot.sendMessage(chatId, 
        '📋 *Team Checklist*\n\nClick the button below to open the checklist app:',
        { 
          reply_markup: keyboard,
          parse_mode: 'Markdown'
        }
      );
      
      // Pin the message
      await bot.pinChatMessage(chatId, sentMsg.message_id, { disable_notification: true });
      
    } catch (err) {
      console.error('Error pinning message:', err.message);
      bot.sendMessage(chatId, '❌ Could not pin message. Make sure bot has "Pin Messages" admin right.');
    }
  });

  bot.onText(/\/admin (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const targetUserId = match[1].trim();

    if (!supabase) {
      bot.sendMessage(chatId, '❌ Database not connected');
      return;
    }

    // Check if sender is admin
    const { data: senderData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('telegram_id', userId)
      .single();

    if (!senderData || !senderData.is_admin) {
      bot.sendMessage(chatId, '❌ Access denied. Only admins can do this.');
      return;
    }

    try {
      await supabase
        .from('users')
        .upsert({
          telegram_id: targetUserId,
          is_admin: true
        }, { onConflict: 'telegram_id' });

      bot.sendMessage(chatId, `✅ User ${targetUserId} is now admin`);
    } catch (err) {
      bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  });

  bot.onText(/\/unadmin (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const targetUserId = match[1].trim();

    if (!supabase) {
      bot.sendMessage(chatId, '❌ База данных не подключена');
      return;
    }

    const { data: senderData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('telegram_id', userId)
      .single();

    if (!senderData || !senderData.is_admin) {
      bot.sendMessage(chatId, '❌ У вас нет прав.');
      return;
    }

    try {
      await supabase
        .from('users')
        .update({ is_admin: false })
        .eq('telegram_id', targetUserId);

      bot.sendMessage(chatId, `✅ Пользователь ${targetUserId} больше не админ`);
    } catch (err) {
      bot.sendMessage(chatId, `❌ Ошибка: ${err.message}`);
    }
  });

  bot.onText(/\/admins/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    if (!supabase) {
      bot.sendMessage(chatId, '❌ База данных не подключена');
      return;
    }

    const { data: senderData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('telegram_id', userId)
      .single();

    if (!senderData || !senderData.is_admin) {
      bot.sendMessage(chatId, '❌ У вас нет прав.');
      return;
    }

    try {
      const { data: admins } = await supabase
        .from('users')
        .select('first_name, username, telegram_id')
        .eq('is_admin', true);

      const adminList = (admins || [])
        .map(a => `👤 ${a.first_name || a.username || a.telegram_id}`)
        .join('\n');
      
      bot.sendMessage(chatId, `👨‍💼 Список админов:\n${adminList || 'Нет админов'}`);
    } catch (err) {
      bot.sendMessage(chatId, `❌ Ошибка: ${err.message}`);
    }
  });

  bot.onText(/\/app/, (msg) => {
    const chatId = msg.chat.id;
    const appUrl = process.env.APP_URL || 'https://your-app.railway.app';
    
    bot.sendMessage(chatId, 
      '📱 Открыть приложение:\n\n' +
      `[Checklist App](${appUrl})`,
      { parse_mode: 'Markdown', disable_web_page_preview: true }
    );
  });
} else {
  console.log('⚠️  TELEGRAM_BOT_TOKEN не установлен - бот отключен');
}

// Webhook endpoint for Telegram (production)
app.post('/api/telegram-webhook', (req, res) => {
  if (bot) {
    bot.processUpdate(req.body);
  }
  res.sendStatus(200);
});

// ============================================
// TELEGRAM WEB APP VERIFICATION
// ============================================

function verifyTelegramData(initData) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;

  try {
    const data = new URLSearchParams(initData);
    const hash = data.get('hash');
    
    const dataCheckString = Array.from(data.entries())
      .filter(([key]) => key !== 'hash')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(process.env.TELEGRAM_BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash === hash) {
      const userData = JSON.parse(data.get('user'));
      return userData;
    }
  } catch (err) {
    console.error('Verification error:', err);
  }

  return null;
}

// ============================================
// REST API ROUTES
// ============================================

// Verify user and get checklists
app.post('/api/auth', async (req, res) => {
  const { initData } = req.body;

  if (!initData) {
    return res.status(401).json({ error: 'No initData' });
  }

  let user = null;
  
  // Try to verify Telegram data
  if (process.env.TELEGRAM_BOT_TOKEN) {
    user = verifyTelegramData(initData);
  } else {
    // Development mode - extract from initData
    const data = new URLSearchParams(initData);
    user = JSON.parse(data.get('user') || '{}');
  }

  if (!user || !user.id) {
    return res.status(401).json({ error: 'Invalid user' });
  }

  try {
    const userId = user.id.toString();

    if (!supabase) {
      return res.status(500).json({ error: 'Database not connected' });
    }
    
    // Save or update user
    const { data: dbUser, error } = await supabase
      .from('users')
      .upsert({
        telegram_id: userId,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        last_active: new Date().toISOString()
      }, { onConflict: 'telegram_id' })
      .select()
      .single();

    if (error) throw error;

    res.json({
      userId,
      isAdmin: dbUser?.is_admin || false,
      user: dbUser
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all checklists
app.get('/api/checklists', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database not connected' });
  }

  try {
    const groupId = req.query.groupId || 'default-group';
    
    const { data: checklists, error } = await supabase
      .from('checklists')
      .select('*')
      .eq('group_id', groupId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Parse items JSON for each checklist
    const parsedChecklists = (checklists || []).map(cl => ({
      ...cl,
      items: typeof cl.items === 'string' ? JSON.parse(cl.items) : cl.items
    }));

    res.json(parsedChecklists);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// SOCKET.IO EVENTS
// ============================================

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('init', async (data) => {
    if (!supabase) {
      socket.emit('init', { checklists: [] });
      return;
    }

    try {
      const groupId = data.groupId || 'default-group';
      
      const { data: checklists, error } = await supabase
        .from('checklists')
        .select('*')
        .eq('group_id', groupId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Parse items JSON for each checklist
      const parsedChecklists = (checklists || []).map(cl => ({
        ...cl,
        items: typeof cl.items === 'string' ? JSON.parse(cl.items) : cl.items
      }));

      socket.emit('init', { checklists: parsedChecklists });
    } catch (err) {
      console.error('Init error:', err);
      socket.emit('init', { checklists: [] });
    }
  });

  socket.on('createChecklist', async (data) => {
    if (!supabase) {
      socket.emit('error', { message: 'Database not connected' });
      return;
    }

    try {
      const { name, userId, groupId } = data;
      
      const items = BANK_TEMPLATE.map(item => ({
        ...item,
        details: {
          login: '',
          password: '',
          phone: '',
          email: ''
        },
        lastModified: new Date().toISOString(),
        modifiedBy: userId
      }));

      const { data: checklist, error } = await supabase
        .from('checklists')
        .insert({
          name,
          created_by: userId,
          group_id: groupId || 'default-group',
          items: JSON.stringify(items),
          is_archived: false,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      const parsedChecklist = {
        ...checklist,
        items: JSON.parse(checklist.items)
      };

      io.emit('checklistCreated', parsedChecklist);
      console.log('Checklist created:', checklist.id);
    } catch (err) {
      console.error('Create checklist error:', err);
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('updateItemStatus', async (data) => {
    if (!supabase) return;

    try {
      const { checklistId, itemId, userId } = data;
      
      const { data: checklist, error: fetchError } = await supabase
        .from('checklists')
        .select('*')
        .eq('id', checklistId)
        .single();

      if (fetchError || !checklist) return;

      const items = typeof checklist.items === 'string' 
        ? JSON.parse(checklist.items) 
        : checklist.items;

      const item = items.find(i => i.id === parseInt(itemId));
      if (!item) return;

      const currentIndex = statusCycle.indexOf(item.status);
      const nextIndex = (currentIndex + 1) % statusCycle.length;
      item.status = statusCycle[nextIndex];
      item.emoji = statusEmoji[item.status];
      item.lastModified = new Date().toISOString();
      item.modifiedBy = userId;

      const { error: updateError } = await supabase
        .from('checklists')
        .update({
          items: JSON.stringify(items),
          updated_at: new Date().toISOString()
        })
        .eq('id', checklistId);

      if (updateError) throw updateError;

      io.emit('itemUpdated', {
        checklistId,
        itemId,
        status: item.status,
        emoji: item.emoji,
        modifiedBy: userId,
        lastModified: item.lastModified
      });
    } catch (err) {
      console.error('Update status error:', err);
    }
  });

  socket.on('updateItemDetails', async (data) => {
    if (!supabase) return;

    try {
      const { checklistId, itemId, details, userId } = data;
      
      const { data: checklist, error: fetchError } = await supabase
        .from('checklists')
        .select('*')
        .eq('id', checklistId)
        .single();

      if (fetchError || !checklist) return;

      const items = typeof checklist.items === 'string' 
        ? JSON.parse(checklist.items) 
        : checklist.items;

      const item = items.find(i => i.id === parseInt(itemId));
      if (!item) return;

      item.details = { ...item.details, ...details };
      item.lastModified = new Date().toISOString();
      item.modifiedBy = userId;

      const { error: updateError } = await supabase
        .from('checklists')
        .update({
          items: JSON.stringify(items),
          updated_at: new Date().toISOString()
        })
        .eq('id', checklistId);

      if (updateError) throw updateError;

      io.emit('detailsUpdated', {
        checklistId,
        itemId,
        details: item.details,
        modifiedBy: userId,
        lastModified: item.lastModified
      });
    } catch (err) {
      console.error('Update details error:', err);
    }
  });

  socket.on('updateItemEmoji', async (data) => {
    if (!supabase) return;

    try {
      const { checklistId, itemId, emoji, userId } = data;
      
      const { data: checklist, error: fetchError } = await supabase
        .from('checklists')
        .select('*')
        .eq('id', checklistId)
        .single();

      if (fetchError || !checklist) return;

      const items = typeof checklist.items === 'string' 
        ? JSON.parse(checklist.items) 
        : checklist.items;

      const item = items.find(i => i.id === parseInt(itemId));
      if (!item) return;

      item.emoji = emoji;
      item.lastModified = new Date().toISOString();
      item.modifiedBy = userId;

      const { error: updateError } = await supabase
        .from('checklists')
        .update({
          items: JSON.stringify(items),
          updated_at: new Date().toISOString()
        })
        .eq('id', checklistId);

      if (updateError) throw updateError;

      io.emit('emojiUpdated', {
        checklistId,
        itemId,
        emoji,
        modifiedBy: userId,
        lastModified: item.lastModified
      });
    } catch (err) {
      console.error('Update emoji error:', err);
    }
  });

  socket.on('deleteChecklist', async (data) => {
    if (!supabase) return;

    try {
      const { checklistId } = data;
      
      const { error } = await supabase
        .from('checklists')
        .update({ is_archived: true, updated_at: new Date().toISOString() })
        .eq('id', checklistId);

      if (error) throw error;

      io.emit('checklistDeleted', { checklistId });
      console.log('Checklist deleted:', checklistId);
    } catch (err) {
      console.error('Delete error:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Open: http://localhost:${PORT}`);
});
