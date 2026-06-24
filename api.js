// api.js
// Servidor Express — endpoints que o Salesforce (ou qualquer sistema) pode chamar
// Também serve uma interface de chat web standalone em /chat
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const { sendMessage, getStatus } = require('./whatsapp');
const store = require('./store');

const router = express.Router();

// ── Middleware: valida webhook secret (se configurado) ─────────────────────
function validateSecret(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return next();

  const provided = req.headers['x-webhook-secret'] || req.query.secret;
  if (!provided || provided !== secret) {
    logger.warn(`🚫 Tentativa de acesso com secret inválido de ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── GET /status — Verifica saúde do serviço ────────────────────────────────
router.get('/status', (req, res) => {
  const status = getStatus();
  res.json({
    service: 'whatsapp-salesforce-poc',
    whatsapp: status,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ── GET /conversations — Lista conversas (do store em memória) ─────────────
// Não exige secret — é a interface local de chat da POC
router.get('/conversations', (req, res) => {
  const convs = store.listConversations();
  res.json({ conversations: convs });
});

// ── GET /messages?id=ID — Lista mensagens de uma conversa ───────────────────
// id = identificador completo da conversa (ex: 7821...@lid ou 5534...@c.us)
router.get('/messages', (req, res) => {
  const id = req.query.id || req.query.phone || '';
  if (!id) {
    return res.status(400).json({ error: 'Parâmetro "id" é obrigatório' });
  }
  const msgs = store.listMessages(id);
  res.json({ id, messages: msgs });
});

// ── POST /conversations/:id/read — Marca conversa como lida ────────────────
router.post('/conversations/:id/read', (req, res) => {
  const id = req.params.id || '';
  store.markRead(id);
  res.json({ success: true, id });
});

// ── POST /chat/send — Envia mensagem SEM secret (para interface local /chat) ─
// Body: { "to": "7821...@lid ou 5534999998888", "message": "texto" }
router.post('/chat/send', async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({
      error: 'Campos obrigatórios: "to" (número ou ID) e "message" (texto)',
    });
  }

  try {
    const result = await sendMessage(to, message);

    store.addMessage({
      id: result.messageId,
      phone: to.includes('@') ? to : `${to.replace(/\D/g, '')}@c.us`,
      body: message,
      timestamp: Math.floor(Date.now() / 1000),
      type: 'chat',
      contactName: null,
      fromMe: true,
      status: 'Sent',
    });

    logger.info(`✅ /chat/send: mensagem enviada (id: ${result.messageId})`);
    res.json({
      success: true,
      to: result.to,
      messageId: result.messageId,
      message,
    });
  } catch (err) {
    logger.error('/chat/send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /send — Envia mensagem pelo WhatsApp (com secret, para Salesforce) ──
// Body: { "to": "5534999998888", "message": "Olá, tudo bem?" }
router.post('/send', validateSecret, async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({
      error: 'Campos obrigatórios: "to" (número) e "message" (texto)',
    });
  }

  const cleanNumber = to.replace(/\D/g, '');
  if (cleanNumber.length < 10) {
    return res
      .status(400)
      .json({ error: 'Número inválido. Use formato: 5534999998888' });
  }

  try {
    const result = await sendMessage(cleanNumber, message);

    // Grava no store em memória a mensagem enviada
    store.addMessage({
      id: result.messageId,
      phone: cleanNumber,
      body: message,
      timestamp: Math.floor(Date.now() / 1000),
      type: 'chat',
      contactName: null,
      fromMe: true,
      status: 'Sent',
    });

    logger.info(`✅ /send: mensagem enviada para ${cleanNumber} (id: ${result.messageId})`);
    res.json({
      success: true,
      to: cleanNumber,
      messageId: result.messageId,
      message,
    });
  } catch (err) {
    logger.error('/send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /send-bulk — Envia mensagem para múltiplos números ───────────────
router.post('/send-bulk', validateSecret, async (req, res) => {
  const { numbers, message } = req.body;

  if (!Array.isArray(numbers) || !message) {
    return res
      .status(400)
      .json({ error: 'Campos obrigatórios: "numbers" (array) e "message"' });
  }

  const results = [];
  for (const num of numbers) {
    const clean = num.replace(/\D/g, '');
    try {
      const result = await sendMessage(clean, message);
      store.addMessage({
        id: result.messageId,
        phone: clean,
        body: message,
        timestamp: Math.floor(Date.now() / 1000),
        type: 'chat',
        contactName: null,
        fromMe: true,
        status: 'Sent',
      });
      results.push({ number: clean, success: true, messageId: result.messageId });
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      results.push({ number: clean, success: false, error: err.message });
    }
  }

  res.json({ results });
});

// ── POST /webhook/salesforce — Recebe eventos do Salesforce ───────────────
router.post('/webhook/salesforce', validateSecret, async (req, res) => {
  const payload = req.body;
  logger.info(
    '📥 Webhook do Salesforce recebido:',
    JSON.stringify(payload).substring(0, 200),
  );

  if (payload.action === 'send_whatsapp' && payload.to && payload.message) {
    try {
      const result = await sendMessage(
        payload.to.replace(/\D/g, ''),
        payload.message,
      );
      store.addMessage({
        id: result.messageId,
        phone: payload.to.replace(/\D/g, ''),
        body: payload.message,
        timestamp: Math.floor(Date.now() / 1000),
        type: 'chat',
        contactName: null,
        fromMe: true,
        status: 'Sent',
      });
      return res.json({ success: true, messageId: result.messageId });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.json({ received: true, note: 'Ação não reconhecida ou sem ação definida' });
});

// ── Monta o app Express ────────────────────────────────────────────────────
function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', router);

  // Interface de chat web standalone servida em /chat
  app.get('/chat', (req, res) => {
    const htmlPath = path.join(__dirname, 'public', 'chat.html');
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.type('text/html').send(html);
    } catch {
      res.status(404).send('chat.html não encontrado em /public');
    }
  });

  app.get('/', (req, res) => {
    res.json({
      name: 'WhatsApp + Salesforce POC',
      chat: '/chat',
      docs: 'Veja README.md para os endpoints disponíveis',
      status: '/api/status',
    });
  });

  return app;
}

module.exports = { createApp };
