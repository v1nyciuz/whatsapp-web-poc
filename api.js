// src/api.js
// Servidor Express — endpoints que o Salesforce (ou qualquer sistema) pode chamar
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const logger = require('./logger');
const { sendMessage, getStatus } = require('./whatsapp');

const router = express.Router();

// ── Middleware: valida webhook secret (se configurado) ─────────────────────
function validateSecret(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return next(); // sem secret configurado, passa livre

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
    timestamp: new Date().toISOString()
  });
});

// ── POST /send — Envia mensagem pelo WhatsApp ──────────────────────────────
// Chamado pelo Salesforce (Flow, Apex, Process Builder, etc.)
// Body: { "to": "5534999998888", "message": "Olá, tudo bem?" }
router.post('/send', validateSecret, async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({
      error: 'Campos obrigatórios: "to" (número) e "message" (texto)'
    });
  }

  // Remove caracteres não numéricos do número
  const cleanNumber = to.replace(/\D/g, '');
  if (cleanNumber.length < 10) {
    return res.status(400).json({ error: 'Número inválido. Use formato: 5534999998888' });
  }

  try {
    await sendMessage(cleanNumber, message);
    logger.info(`✅ /send: mensagem enviada para ${cleanNumber}`);
    res.json({ success: true, to: cleanNumber, message });
  } catch (err) {
    logger.error('/send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /send-bulk — Envia mensagem para múltiplos números ───────────────
// Body: { "numbers": ["5534999998888", "5511988887777"], "message": "Texto" }
router.post('/send-bulk', validateSecret, async (req, res) => {
  const { numbers, message } = req.body;

  if (!Array.isArray(numbers) || !message) {
    return res.status(400).json({ error: 'Campos obrigatórios: "numbers" (array) e "message"' });
  }

  const results = [];
  for (const num of numbers) {
    const clean = num.replace(/\D/g, '');
    try {
      await sendMessage(clean, message);
      results.push({ number: clean, success: true });
      // Pequena pausa entre envios para não parecer spam
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      results.push({ number: clean, success: false, error: err.message });
    }
  }

  res.json({ results });
});

// ── POST /webhook/salesforce — Recebe eventos do Salesforce ───────────────
// Útil se você quiser que o SF notifique o servidor de algo
router.post('/webhook/salesforce', validateSecret, async (req, res) => {
  const payload = req.body;
  logger.info('📥 Webhook do Salesforce recebido:', JSON.stringify(payload).substring(0, 200));

  // Exemplo: SF envia { action: "send_whatsapp", to: "...", message: "..." }
  if (payload.action === 'send_whatsapp' && payload.to && payload.message) {
    try {
      await sendMessage(payload.to.replace(/\D/g, ''), payload.message);
      return res.json({ success: true });
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
  app.use(express.json());
  app.use('/api', router);

  // Rota raiz informativa
  app.get('/', (req, res) => {
    res.json({
      name: 'WhatsApp + Salesforce POC',
      docs: 'Veja README.md para os endpoints disponíveis',
      status: '/api/status'
    });
  });

  return app;
}

module.exports = { createApp };
