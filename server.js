
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

// Default bank template (will be loaded from DB if available)
let BANK_TEMPLATE = [
  { id: 1, name: 'Amazon', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 2, name: 'Wamo', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 3, name: 'Paysera Business', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 4, name: 'Paynovus', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 5, name: 'ICard', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 6, name: 'Mifinity', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 7, name: 'Revolut', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 8, name: 'OpenPayd', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 9, name: 'Finom', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 10, name: 'Zen', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 11, name: 'Genome', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 12, name: 'Multipass', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 13, name: 'Sokin', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 14, name: 'Brighty', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 15, name: 'Unlimit', status: 'NOT_STARTED', emoji: '⬜' },
  { id: 16, name: 'Satchel', status: 'NOT_STARTED', emoji: '⬜' }
];

// Load bank template from database
async function loadBankTemplate() {
  if (!supabase) return;
  try {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'bank_template')
      .single();
    
    if (data && data.value) {
      BANK_TEMPLATE = JSON.parse(data.value);
      console.log('✅ Bank template loaded from DB');
    }
  } catch (err) {
    console.log('⚠️  Using default bank template');
  }
}

// Save bank template to database
async function saveBankTemplate() {
  if (!supabase) return false;
  try {
    await supabase
      .from('settings')
      .upsert({
        key: 'bank_template',
        value: JSON.stringify(BANK_TEMPLATE),
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });
    return true;
  } catch (err) {
    console.error('Error saving bank template:', err);
    return false;
  }
}

// Sync bank template to all existing checklists (add new banks, keep existing statuses)
async function syncBankTemplateToChecklists() {
  if (!supabase) return { success: false, updated: 0 };
  
  try {
    // Get all checklists
    const { data: checklists, error } = await supabase
      .from('checklists')
      .select('*');
    
    if (error) throw error;
    
    let updatedCount = 0;
    
    for (const checklist of checklists || []) {
      const existingItems = typeof checklist.items === 'string' 
        ? JSON.parse(checklist.items) 
        : checklist.items;
      
      // Create map of existing items by name for quick lookup
      const existingByName = {};
      existingItems.forEach(item => {
        existingByName[item.name.toLowerCase()] = item;
      });
      
      // Build new items array
      const newItems = BANK_TEMPLATE.map(templateItem => {
        const existing = existingByName[templateItem.name.toLowerCase()];
        if (existing) {
          // Keep existing status, emoji and details
          return {
            ...templateItem,
            status: existing.status,
            emoji: existing.emoji,
            details: existing.details || {},
            lastModified: existing.lastModified,
            modifiedBy: existing.modifiedBy
          };
        } else {
          // New item - use template defaults
          return {
            ...templateItem,
            details: { login: '', password: '', phone: '', email: '' },
            lastModified: new Date().toISOString(),
            modifiedBy: 'system'
          };
        }
      });
      
      // Update checklist
      await supabase
        .from('checklists')
        .update({
          items: JSON.stringify(newItems),
          updated_at: new Date().toISOString()
        })
        .eq('id', checklist.id);
      
      updatedCount++;
    }
    
    return { success: true, updated: updatedCount };
  } catch (err) {
    console.error('Sync error:', err);
    return { success: false, updated: 0, error: err.message };
  }
}

// Load template on startup
loadBankTemplate();

const statusCycle = ['NOT_STARTED', 'IN_PROGRESS', 'APPROVED', 'DECLINED'];
const statusEmoji = {
  'NOT_STARTED': '⬜',
  'IN_PROGRESS': '💤',
  'APPROVED': '✅',
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
    const username = msg.from.username;

    if (!supabase) {
      bot.sendMessage(chatId, '❌ Database not connected');
      return;
    }

    // Check if user exists in whitelist
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .or(`telegram_id.eq.${userId},username.ilike.${username || 'NONE'}`)
      .single();

    if (!existingUser) {
      // User not in whitelist
      bot.sendMessage(chatId, 
        '❌ Access denied.\n\n' +
        'This bot is private. Ask admin to add you.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Update user data (fill in telegram_id if was added by username)
    try {
      await supabase
        .from('users')
        .update({
          telegram_id: userId,
          username: msg.from.username,
          first_name: msg.from.first_name,
          last_name: msg.from.last_name,
          last_active: new Date().toISOString()
        })
        .eq('id', existingUser.id);
    } catch (err) {
      console.error('Error updating user:', err);
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

  // ============================================
  // USER WHITELIST MANAGEMENT (Admin only)
  // ============================================

  // /adduser @username - Add user to whitelist
  bot.onText(/\/adduser @?(\w+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const adminId = msg.from.id.toString();
    const targetUsername = match[1].toLowerCase();

    if (!supabase) {
      bot.sendMessage(chatId, '❌ Database not connected');
      return;
    }

    // Check if sender is admin
    const { data: adminData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('telegram_id', adminId)
      .single();

    if (!adminData || !adminData.is_admin) {
      bot.sendMessage(chatId, '❌ Admin only');
      return;
    }

    // Check if user already exists
    const { data: existing } = await supabase
      .from('users')
      .select('*')
      .ilike('username', targetUsername)
      .single();

    if (existing) {
      bot.sendMessage(chatId, `⚠️ User @${targetUsername} already exists`);
      return;
    }

    // Add user with just username (telegram_id will be filled when they /start)
    try {
      await supabase
        .from('users')
        .insert({
          username: targetUsername,
          telegram_id: null,
          is_admin: false,
          created_at: new Date().toISOString()
        });

      bot.sendMessage(chatId, `✅ Added @${targetUsername} to whitelist\n\nThey can now use /start to access the bot.`);
    } catch (err) {
      bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  });

  // /deluser @username - Remove user from whitelist
  bot.onText(/\/deluser @?(\w+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const adminId = msg.from.id.toString();
    const targetUsername = match[1].toLowerCase();

    if (!supabase) {
      bot.sendMessage(chatId, '❌ Database not connected');
      return;
    }

    // Check if sender is admin
    const { data: adminData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('telegram_id', adminId)
      .single();

    if (!adminData || !adminData.is_admin) {
      bot.sendMessage(chatId, '❌ Admin only');
      return;
    }

    try {
      const { data: deleted } = await supabase
        .from('users')
        .delete()
        .ilike('username', targetUsername)
        .select();

      if (deleted && deleted.length > 0) {
        bot.sendMessage(chatId, `✅ Removed @${targetUsername} from whitelist`);
      } else {
        bot.sendMessage(chatId, `❌ User @${targetUsername} not found`);
      }
    } catch (err) {
      bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  });

  // /users - List all whitelisted users
  bot.onText(/\/users/, async (msg) => {
    const chatId = msg.chat.id;
    const adminId = msg.from.id.toString();

    if (!supabase) {
      bot.sendMessage(chatId, '❌ Database not connected');
      return;
    }

    // Check if sender is admin
    const { data: adminData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('telegram_id', adminId)
      .single();

    if (!adminData || !adminData.is_admin) {
      bot.sendMessage(chatId, '❌ Admin only');
      return;
    }

    try {
      const { data: users } = await supabase
        .from('users')
        .select('username, first_name, telegram_id, is_admin')
        .order('created_at', { ascending: true });

      const userList = (users || [])
        .map(u => {
          const name = u.first_name || u.username || 'Unknown';
          const status = u.telegram_id ? '✅' : '⏳'; // ✅ = activated, ⏳ = pending
          const admin = u.is_admin ? ' 👑' : '';
          return `${status} @${u.username || 'no_username'} (${name})${admin}`;
        })
        .join('\n');
      
      bot.sendMessage(chatId, 
        `👥 *Whitelist* (${users?.length || 0} users):\n\n${userList || 'Empty'}\n\n` +
        `✅ = activated, ⏳ = pending /start\n\n` +
        `Commands:\n` +
        `/adduser @username - Add user\n` +
        `/deluser @username - Remove user`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  });

  // ============================================
  // BANK TEMPLATE MANAGEMENT (Admin only)
  // ============================================

  // /banks - Show current bank list
  bot.onText(/\/banks/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    if (!supabase) {
      bot.sendMessage(chatId, '❌ Database not connected');
      return;
    }

    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('telegram_id', userId)
      .single();

    if (!userData || !userData.is_admin) {
      bot.sendMessage(chatId, '❌ Admin only');
      return;
    }

    const bankList = BANK_TEMPLATE
      .map(b => `${b.id}. ${b.name}`)
      .join('\n');

    bot.sendMessage(chatId, 
      `🏦 *Bank Template* (${BANK_TEMPLATE.length} items):\n\n${bankList}\n\n` +
      `Commands:\n` +
      `/addbank Name - Add new bank\n` +
      `/delbank 5 - Delete bank by ID\n` +
      `/renamebank 5 New Name - Rename bank\n` +
      `/syncbanks - Apply to all checklists`,
      { parse_mode: 'Markdown' }
    );
  });

  // /addbank <name> - Add new bank
  bot.onText(/\/addbank (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const bankName = match[1].trim();

    if (!supabase) {
      bot.sendMessage(chatId, '❌ Database not connected');
      return;
    }

    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('telegram_id', userId)
      .single();

    if (!userData || !userData.is_admin) {
      bot.sendMessage(chatId, '❌ Admin only');
      return;
    }

    // Get next ID
    const maxId = Math.max(...BANK_TEMPLATE.map(b => b.id), 0);
    const newBank = {
      id: maxId + 1,
      name: bankName,
      status: 'NOT_STARTED',
      emoji: '⬜'
    };

    BANK_TEMPLATE.push(newBank);
    
    if (await saveBankTemplate()) {
      bot.sendMessage(chatId, `✅ Added: ${newBank.id}. ${bankName}\n\nUse /syncbanks to apply to existing checklists`);
    } else {
      bot.sendMessage(chatId, '❌ Error saving');
    }
  });

  // /delbank <id> - Delete bank by ID
  bot.onText(/\/delbank (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const bankId = parseInt(match[1]);

    if (!supabase) {
      bot.sendMessage(chatId, '❌ Database not connected');
      return;
    }

    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('telegram_id', userId)
      .single();

    if (!userData || !userData.is_admin) {
      bot.sendMessage(chatId, '❌ Admin only');
      return;
    }

    const bank = BANK_TEMPLATE.find(b => b.id === bankId);
    if (!bank) {
      bot.sendMessage(chatId, `❌ Bank with ID ${bankId} not found`);
      return;
    }

    BANK_TEMPLATE = BANK_TEMPLATE.filter(b => b.id !== bankId);
    
    if (await saveBankTemplate()) {
      bot.sendMessage(chatId, `✅ Deleted: ${bank.name}\n\nUse /syncbanks to apply to existing checklists`);
    } else {
      bot.sendMessage(chatId, '❌ Error saving');
    }
  });

  // /renamebank <id> <new name> - Rename bank
  bot.onText(/\/renamebank (\d+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const bankId = parseInt(match[1]);
    const newName = match[2].trim();

    if (!supabase) {
      bot.sendMessage(chatId, '❌ Database not connected');
      return;
    }

    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('telegram_id', userId)
      .single();

    if (!userData || !userData.is_admin) {
      bot.sendMessage(chatId, '❌ Admin only');
      return;
    }

    const bank = BANK_TEMPLATE.find(b => b.id === bankId);
    if (!bank) {
      bot.sendMessage(chatId, `❌ Bank with ID ${bankId} not found`);
      return;
    }

    const oldName = bank.name;
    bank.name = newName;
    
    if (await saveBankTemplate()) {
      bot.sendMessage(chatId, `✅ Renamed: "${oldName}" → "${newName}"\n\nUse /syncbanks to apply to existing checklists`);
    } else {
      bot.sendMessage(chatId, '❌ Error saving');
    }
  });

  // /syncbanks - Apply template to all existing checklists
  bot.onText(/\/syncbanks/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    if (!supabase) {
      bot.sendMessage(chatId, '❌ Database not connected');
      return;
    }

    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('telegram_id', userId)
      .single();

    if (!userData || !userData.is_admin) {
      bot.sendMessage(chatId, '❌ Admin only');
      return;
    }

    bot.sendMessage(chatId, '⏳ Syncing...');

    const result = await syncBankTemplateToChecklists();
    
    if (result.success) {
      // Notify all connected clients to refresh
      io.emit('templateUpdated', { template: BANK_TEMPLATE });
      bot.sendMessage(chatId, `✅ Done! Updated ${result.updated} checklists.\n\nUsers will see changes after refresh.`);
    } else {
      bot.sendMessage(chatId, `❌ Error: ${result.error || 'Unknown error'}`);
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
    
    // Check if user exists in whitelist
    const { data: dbUser } = await supabase
      .from('users')
      .select('*')
      .or(`telegram_id.eq.${userId},username.ilike.${user.username || 'NONE'}`)
      .single();

    if (!dbUser) {
      return res.status(403).json({ error: 'Access denied. Not in whitelist.' });
    }

    // Update user data
    await supabase
      .from('users')
      .update({
        telegram_id: userId,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        last_active: new Date().toISOString()
      })
      .eq('id', dbUser.id);

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
      
      // Actually delete from database instead of archiving
      const { error } = await supabase
        .from('checklists')
        .delete()
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
