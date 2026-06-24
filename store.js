// store.js
// Repositório em memória de conversas e mensagens do WhatsApp.
// Permite que a POC funcione 100% standalone, sem Salesforce nem banco.
// As mensagens duram enquanto o processo Node estiver rodando.
const logger = require('./logger');

// Map<phone, conversation> e Map<messageId, message>
const conversations = new Map();
const messagesByConv = new Map(); // Map<phone, Array<message>>

// ── Adiciona/atualiza uma conversa ──────────────────────────────────────────
function upsertConversation({ phone, contactName, fromMe }) {
  let conv = conversations.get(phone);
  if (!conv) {
    conv = {
      id: phone,
      phone,
      contactName: contactName || null,
      lastMessage: '',
      lastActivity: new Date().toISOString(),
      unread: 0,
      createdAt: new Date().toISOString(),
    };
    conversations.set(phone, conv);
    messagesByConv.set(phone, []);
  } else {
    if (contactName && !conv.contactName) conv.contactName = contactName;
  }
  return conv;
}

// ── Adiciona uma mensagem à conversa (com dedup por ID) ─────────────────────
function addMessage({
  id,
  phone,
  body,
  timestamp,
  type,
  contactName,
  fromMe,
  status,
}) {
  const conv = upsertConversation({ phone, contactName, fromMe });

  const list = messagesByConv.get(phone) || [];

  // Dedup por id do WhatsApp
  if (list.some((m) => m.id === id)) {
    return { duplicate: true, message: list.find((m) => m.id === id) };
  }

  const msg = {
    id,
    phone,
    direction: fromMe ? 'Outbound' : 'Inbound',
    body: body || '',
    timestamp: timestamp
      ? new Date(timestamp * 1000).toISOString()
      : new Date().toISOString(),
    type: type || 'chat',
    status: status || (fromMe ? 'Sent' : 'Received'),
    contactName: contactName || conv.contactName || null,
  };

  list.push(msg);
  messagesByConv.set(phone, list);

  // Atualiza prévia na conversa
  conv.lastMessage = (body || '').substring(0, 255);
  conv.lastActivity = msg.timestamp;
  if (!fromMe) conv.unread = (conv.unread || 0) + 1;

  logger.debug(
    `💾 [store] ${msg.direction} ${phone}: ${(body || '').substring(0, 40)}`,
  );
  return { duplicate: false, message: msg };
}

// ── Atualiza status de entrega de uma mensagem ─────────────────────────────
function updateStatus(messageId, status) {
  for (const [phone, list] of messagesByConv.entries()) {
    const msg = list.find((m) => m.id === messageId);
    if (msg) {
      msg.status = status;
      return msg;
    }
  }
  return null;
}

// ── Marca conversa como lida ────────────────────────────────────────────────
function markRead(phone) {
  const conv = conversations.get(phone);
  if (conv) {
    conv.unread = 0;
    return true;
  }
  return false;
}

// ── Lista conversas ordenadas por última atividade ─────────────────────────
function listConversations() {
  return Array.from(conversations.values()).sort(
    (a, b) => new Date(b.lastActivity) - new Date(a.lastActivity),
  );
}

// ── Lista mensagens de uma conversa ─────────────────────────────────────────
function listMessages(phone) {
  return (messagesByConv.get(phone) || []).slice().sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  );
}

// ── Limpa tudo (reset) ──────────────────────────────────────────────────────
function clear() {
  conversations.clear();
  messagesByConv.clear();
}

module.exports = {
  upsertConversation,
  addMessage,
  updateStatus,
  markRead,
  listConversations,
  listMessages,
  clear,
};
