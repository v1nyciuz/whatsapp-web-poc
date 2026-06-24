// whatsapp.js
// WhatsApp Web via whatsapp-web.js (store injection nativa + eventos em tempo real)
// Substitui a automação Puppeteer raw por uma lib que acessa o store interno do WA Web,
// fornecendo metadados estruturados (id, from, body, timestamp, type) e eventos push.
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const logger = require('./logger');
const path = require('path');
const qrcode = require('qrcode-terminal');

const SESSION_DIR = path.join(__dirname, '.wwjs_session');

let client = null;
let isReady = false;
let myNumber = null;
let reconnectTimer = null;

// Callback injetada pelo index.js para persistir mensagens recebidas no Salesforce
let onInboundMessage = null;

// ── Inicializa o cliente WhatsApp ────────────────────────────────────────────
function initWhatsApp({ onMessage } = {}) {
  if (onMessage) onInboundMessage = onMessage;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    puppeteer: {
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
  });

  // ── Eventos de autenticação ──────────────────────────────────────────────
  client.on('qr', (qr) => {
    logger.info('📱 QR Code gerado! Escaneie com o WhatsApp do celular.');
    qrcode.generate(qr, { small: true }, (qrcode) => {
      console.log(qrcode);
    });
  });

  client.on('authenticated', () => {
    logger.info('🔐 WhatsApp autenticado!');
  });

  client.on('auth_failure', (msg) => {
    logger.error(`❌ Falha na autenticação: ${msg}`);
    scheduleReconnect();
  });

  client.on('loading_screen', (percent) => {
    logger.info(`⏳ Carregando WhatsApp Web... ${percent}%`);
  });

  // ── Pronto ───────────────────────────────────────────────────────────────
  client.on('ready', async () => {
    isReady = true;
    try {
      const info = client.info;
      myNumber = info.wid.user;
      logger.info(`✅ WhatsApp pronto! Conectado: ${myNumber}`);
    } catch {
      myNumber = null;
      logger.info('✅ WhatsApp pronto!');
    }
    logger.info('📥 Monitorando mensagens recebidas (store injection)...');
  });

  // ── Mensagem recebida (evento push do store interno) ─────────────────────
  client.on('message', async (msg) => {
    // Ignora mensagens enviadas por mim
    if (msg.fromMe) return;
    // Ignora grupos (@g.us) e status (@broadcast)
    if (msg.isStatus) return;
    const chatId = msg.from || '';
    if (chatId.endsWith('@g.us')) return;

    // Apenas texto por enquanto (pode expandir para media depois)
    if (msg.type !== 'chat' && msg.type !== 'text') {
      logger.info(`📨 [${msg.type}] de ${msg.from} (não-texto, ignorado)`);
      return;
    }

    let contactName = null;
    try {
      const contact = await msg.getContact();
      contactName = contact.name || contact.pushname || contact.shortName || null;
    } catch {}

    const from = msg.from; // ID completo (ex: 7821...@lid ou 5534...@c.us)
    const body = msg.body || '';

    logger.info(`📨 ${contactName || from}: ${body.substring(0, 120)}`);

    // Dispara callback para persistir no Salesforce
    if (onInboundMessage) {
      try {
        await onInboundMessage({
          id: msg.id._serialized,
          from,
          phone: from,
          body,
          timestamp: msg.timestamp,
          type: msg.type,
          contactName,
          fromMe: false,
        });
      } catch (err) {
        logger.error('Erro ao persistir mensagem recebida:', err.message);
      }
    }
  });

  // ── Mensagem criada (inclui enviadas por mim — loga no SF como Outbound) ──
  client.on('message_create', async (msg) => {
    if (!msg.fromMe) return; // só processa mensagens que eu enviei
    if (msg.isStatus) return;
    const chatId = msg.to || msg.from || '';
    if (chatId.endsWith('@g.us')) return;

    // Ignora se não for texto
    if (msg.type !== 'chat' && msg.type !== 'text') return;

    const to = msg.to || msg.from || '';
    const body = msg.body || '';

    logger.info(`📤 [create] ${to}: ${body.substring(0, 80)}`);

    // Dispara callback para persistir mensagem enviada no SF
    if (onInboundMessage) {
      try {
        await onInboundMessage({
          id: msg.id._serialized,
          from: to,
          phone: to,
          body,
          timestamp: msg.timestamp,
          type: msg.type,
          contactName: null,
          fromMe: true,
        });
      } catch (err) {
        logger.error('Erro ao persistir mensagem enviada:', err.message);
      }
    }
  });

  // ── ACK de entrega/leitura (atualiza status da mensagem) ─────────────────
  client.on('message_ack', async (msg, ack) => {
    // ack: -1 = erro, 0 = pendente, 1 = enviado, 2 = entregue, 3 = lido
    if (!msg.fromMe) return;
    const ackLabels = { '-1': 'FALHOU', 0: 'PENDENTE', 1: 'ENVIADO', 2: 'ENTREGUE', 3: 'LIDO' };
    const label = ackLabels[String(ack)] || String(ack);
    logger.info(`📋 ACK ${label} para msg ${msg.id._serialized}`);

    // Aqui poderíamos atualizar o Status__c da WhatsApp_Message__c no SF
    // Por enquanto só loga — implementar quando o schema do SF estiver pronto
  });

  // ── Desconexão ───────────────────────────────────────────────────────────
  client.on('disconnected', (reason) => {
    logger.warn(`⚠️ WhatsApp desconectado: ${reason}`);
    isReady = false;
    myNumber = null;
    scheduleReconnect();
  });

  client.initialize();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  isReady = false;
  logger.info('🔄 Reconectando em 10s...');
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      if (client) {
        try { await client.destroy(); } catch {}
      }
      initWhatsApp({ onMessage: onInboundMessage });
    } catch (err) {
      logger.error('Erro ao reconectar:', err.message);
      scheduleReconnect();
    }
  }, 10000);
}

// ── Envia mensagem de texto ──────────────────────────────────────────────────
// Aceita tanto número limpo (5534999998888) quanto ID completo (7821...@lid / ...@c.us)
async function sendMessage(to, text) {
  if (!isReady || !client) throw new Error('WhatsApp não conectado');

  const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@c.us`;
  logger.info(`📤 Enviando para ${chatId}...`);

  try {
    const sent = await client.sendMessage(chatId, text);
    logger.info(`✅ Enviado para ${chatId} (id: ${sent.id._serialized})`);
    return {
      success: true,
      messageId: sent.id._serialized,
      to: chatId,
    };
  } catch (err) {
    logger.error(`❌ Erro ao enviar para ${chatId}: ${err.message}`);
    throw err;
  }
}

// ── Status do serviço ────────────────────────────────────────────────────────
function getStatus() {
  return {
    connected: isReady,
    number: myNumber,
  };
}

module.exports = { initWhatsApp, sendMessage, getStatus };
