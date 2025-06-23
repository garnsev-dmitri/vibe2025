const express = require('express');
const mysql = require('mysql2/promise');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs').promises;
const TelegramBot = require('node-telegram-bot-api');
const app = express();
const port = 3000;
const telegram_token = '8049995581:AAGUvWHikQUxvJV280vttYBI3xhZB8PMXaY';
const bot = new TelegramBot(telegram_token, { polling: true });
const dbConfig = {
  host: 'Localhost',
  user: 'root',
  password: 'qwe123!@#',
  database: 'todolist',
};

app.use(express.json());
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } 
}));

async function initDatabase() {
  try {
    const connection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password
    });
    console.log('Connected to MySQL server');
    
    await connection.query('CREATE DATABASE IF NOT EXISTS todolist');
    await connection.query('USE todolist');
    console.log('Database todolist selected');
    
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        telegram_id VARCHAR(50) UNIQUE
      )
    `);
    console.log('Table users created');
    
    await connection.query('DROP TABLE IF EXISTS items');
    await connection.query(`
      CREATE TABLE items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        text VARCHAR(255) NOT NULL,
        user_id INT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    console.log('Table items created');
    
    await connection.end();
    console.log('Database and tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

async function retrieveListItems(userId) {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const query = 'SELECT id, text FROM items WHERE user_id = ?';
    const [rows] = await connection.execute(query, [userId]);
    await connection.close();
    return rows;
  } catch (error) {
    console.error('Ошибка при получении элементов:', error);
    throw error;
  }
}

async function addListItem(text, userId) {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const query = 'INSERT INTO items (text, user_id) VALUES (?, ?)';
    const [result] = await connection.execute(query, [text, userId]);
    await connection.close();
    return { id: result.insertId, text };
  } catch (error) {
    console.error('Ошибка при добавлении элемента:', error);
    throw error;
  }
}

async function deleteListItem(id, userId) {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const query = 'DELETE FROM items WHERE id = ? AND user_id = ?';
    const [result] = await connection.execute(query, [id, userId]);
    await connection.close();
    return result.affectedRows > 0;
  } catch (error) {
    console.error('Ошибка при удалении элемента:', error);
    throw error;
  }
}

async function updateListItem(id, newText, userId) {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const query = 'UPDATE items SET text = ? WHERE id = ? AND user_id = ?';
    const [result] = await connection.execute(query, [newText, id, userId]);
    await connection.close();
    return result.affectedRows > 0;
  } catch (error) {
    console.error('Ошибка при обновлении элемента:', error);
    throw error;
  }
}

async function getUserByTelegramId(telegramId) {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    await connection.close();
    return rows[0];
  } catch (error) {
    console.error('Ошибка при получении пользователя:', error);
    throw error;
  }
}

async function linkTelegramId(username, telegramId) {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [userRows] = await connection.execute('SELECT * FROM users WHERE username = ?', [username]);
    
    if (userRows.length === 0) {
      await connection.close();
      return { success: false, message: `Пользователь с логином "${username}" не найден. Зарегистрируйтесь на сайте.` };
    }
    
    const [telegramRows] = await connection.execute('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    
    if (telegramRows.length > 0) {
      await connection.close();
      return { success: false, message: `Этот Telegram ID уже привязан к пользователю "${telegramRows[0].username}".` };
    }
    
    await connection.execute('UPDATE users SET telegram_id = ? WHERE username = ?', [telegramId, username]);
    await connection.close();
    
    console.log(`Telegram ID ${telegramId} успешно привязан к пользователю ${username}`);
    return { 
      success: true, 
      message: 'Аккаунт успешно привязан! Используйте /add <дело>, /delete <дело>, /update <дело> - <новое дело>, /list.' 
    };
  } catch (error) {
    console.error('Ошибка при привязке Telegram ID:', error);
    return { success: false, message: 'Ошибка сервера при привязке Telegram ID. Попробуйте позже.' };
  }
}

async function getHtmlRows(userId) {
  const todoItems = await retrieveListItems(userId);
  return todoItems.map(item => `
    <tr>
      <td>${item.id}</td>
      <td class="text-cell" data-id="${item.id}">${item.text}</td>
      <td>
        <button class="edit-btn" data-id="${item.id}">изменить</button>
        <button class="delete-btn" data-id="${item.id}">удалить</button>
      </td>
    </tr>
  `).join('');
}


function isAuthenticated(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
}

app.get('/login', async (req, res) => {
  const html = await fs.readFile(path.join(__dirname, 'interf.html'), 'utf8');
  res.send(html.replace('{{rows}}', ''));
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password || username.trim().length === 0 || password.trim().length === 0) {
    return res.status(400).json({ error: 'Логин и пароль не могут быть пустыми' });
  }
  
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT * FROM users WHERE username = ?', [username]);
    await connection.close();
    
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }
    
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    
    if (match) {
      req.session.user = { id: user.id, username: user.username };
      return res.json({ message: 'Успешный вход' });
    } else {
      return res.status(401).json({ error: 'Неверный пароль' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password || username.trim().length === 0 || password.trim().length === 0) {
    return res.status(400).json({ error: 'Логин и пароль не могут быть пустыми' });
  }
  
  try {
    const connection = await mysql.createConnection(dbConfig);
    const hashedPassword = await bcrypt.hash(password, 10);
    await connection.execute('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
    await connection.close();
    return res.json({ message: 'Пользователь зарегистрирован' });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: 'Пользователь уже существует или ошибка сервера' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/', isAuthenticated, async (req, res) => {
  try {
    const html = await fs.readFile(path.join(__dirname, 'interf.html'), 'utf8');
    const processedHtml = html.replace('{{rows}}', await getHtmlRows(req.session.user.id));
    res.send(processedHtml);
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка загрузки страницы');
  }
});

app.post('/add', isAuthenticated, async (req, res) => {
  const { text } = req.body;
  
  if (!text || typeof text !== 'string' || text.trim() === '') {
    res.status(400).json({ error: 'Некорректный или отсутствующий текст' });
    return;
  }
  
  try {
    const newItem = await addListItem(text.trim(), req.session.user.id);
    res.json(newItem);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось добавить элемент' });
  }
});

app.delete('/delete', isAuthenticated, async (req, res) => {
  const id = req.query.id;
  
  if (!id || isNaN(id)) {
    res.status(400).json({ error: 'Некорректный или отсутствующий ID' });
    return;
  }
  
  try {
    const success = await deleteListItem(id, req.session.user.id);
    if (success) {
      res.json({ message: 'Элемент удален' });
    } else {
      res.status(404).json({ error: 'Элемент не найден' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось удалить элемент' });
  }
});

app.put('/update', isAuthenticated, async (req, res) => {
  const id = req.query.id;
  const { text } = req.body;
  
  if (!id || isNaN(id) || !text || typeof text !== 'string' || text.trim() === '') {
    res.status(400).json({ error: 'Некорректный или отсутствующий ID или текст' });
    return;
  }
  
  try {
    const success = await updateListItem(id, text.trim(), req.session.user.id);
    if (success) {
      res.json({ message: 'Элемент обновлен', text });
    } else {
      res.status(404).json({ error: 'Элемент не найден' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось обновить элемент' });
  }
});

//бот тг
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Введите ваш логин для привязки аккаунта:');
  
  bot.once('message', async (msg) => {
    const username = msg.text.trim();
    const result = await linkTelegramId(username, chatId.toString());
    bot.sendMessage(chatId, result.message);
  });
});

bot.onText(/\/add (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const text = match[1].trim();
  const user = await getUserByTelegramId(chatId.toString());
  
  if (!user) {
    bot.sendMessage(chatId, 'Ваш Telegram ID не привязан к аккаунту. Используйте /start для привязки.');
    return;
  }
  
  try {
    await addListItem(text, user.id);
    bot.sendMessage(chatId, `Задача "${text}" добавлена.`);
  } catch (error) {
    bot.sendMessage(chatId, 'Ошибка при добавлении задачи.');
  }
});

bot.onText(/\/delete (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const text = match[1].trim();
  const user = await getUserByTelegramId(chatId.toString());
  
  if (!user) {
    bot.sendMessage(chatId, 'Ваш Telegram ID не привязан к аккаунту. Используйте /start для привязки.');
    return;
  }
  
  try {
    const success = await deleteListItem(text, user.id);
    if (success) {
      bot.sendMessage(chatId, `Задача "${text}" удалена.`);
    } else {
      bot.sendMessage(chatId, `Задача "${text}" не найдена.`);
    }
  } catch (error) {
    bot.sendMessage(chatId, 'Ошибка при удалении задачи.');
  }
});

bot.onText(/\/update (.+) - (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const oldText = match[1].trim();
  const newText = match[2].trim();
  const user = await getUserByTelegramId(chatId.toString());
  
  if (!user) {
    bot.sendMessage(chatId, 'Ваш Telegram ID не привязан к аккаунту. Используйте /start для привязки.');
    return;
  }
  
  try {
    const success = await updateListItem(oldText, newText, user.id);
    if (success) {
      bot.sendMessage(chatId, `Задача "${oldText}" обновлена на "${newText}".`);
    } else {
      bot.sendMessage(chatId, `Задача "${oldText}" не найдена.`);
    }
  } catch (error) {
    bot.sendMessage(chatId, 'Ошибка при обновлении задачи.');
  }
});

bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await getUserByTelegramId(chatId.toString());
  
  if (!user) {
    bot.sendMessage(chatId, 'Ваш Telegram ID не привязан к аккаунту. Используйте /start для привязки.');
    return;
  }
  
  try {
    const items = await retrieveListItems(user.id);
    if (items.length === 0) {
      bot.sendMessage(chatId, 'Список задач пуст.');
      return;
    }
    
    const message = items.map(item => `${item.id}. ${item.text}`).join('\n');
    bot.sendMessage(chatId, `Ваши задачи:\n${message}`);
  } catch (error) {
    bot.sendMessage(chatId, 'Ошибка при получении списка задач.');
  }
});

initDatabase().then(() => {
  app.listen(port, () => console.log(`Сервер запущен на порту ${port}`));
}).catch(err => {
  console.error('Failed to initialize database and start server:', err);
  process.exit(1);
});
