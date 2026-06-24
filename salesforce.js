// salesforce.js
// Responsável por toda comunicação com a API do Salesforce
// Inclui persistência de conversas e mensagens do WhatsApp (inbound e outbound)
const jsforce = require('jsforce');
const logger = require('./logger');

let conn = null;
let connecting = false;
const sfDisabled = process.env.SF_DISABLED === 'true';

// ── Conecta ao Salesforce via username/password OAuth flow ──────────────────
async function connect() {
  if (sfDisabled) {
    logger.debug('SF_DISABLED=true — pulando conexão com Salesforce');
    return null;
  }

  if (conn && conn.accessToken) {
    return conn;
  }

  if (connecting) {
    // Aguarda conexão em andamento
    while (connecting) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (conn && conn.accessToken) return conn;
  }

  connecting = true;

  conn = new jsforce.Connection({
    loginUrl: process.env.SF_LOGIN_URL || 'https://login.salesforce.com',
  });

  try {
    await conn.login(
      process.env.SF_USERNAME,
      process.env.SF_PASSWORD + process.env.SF_TOKEN,
    );
    logger.info(`✅ Salesforce conectado como ${process.env.SF_USERNAME}`);
    return conn;
  } catch (err) {
    logger.error('❌ Falha ao conectar no Salesforce:', err.message);
    conn = null;
    throw err;
  } finally {
    connecting = false;
  }
}

// ── Limpa número de telefone (remove @c.us e não-dígitos) ──────────────────
function cleanPhone(phone) {
  return (phone || '').replace('@c.us', '').replace(/\D/g, '');
}

// ── Upsert de Conversation__c por telefone (External ID) ───────────────────
async function upsertConversation({ phone, contactName }) {
  if (sfDisabled) {
    logger.debug(`[SF_DISABLED] upsertConversation: ${phone} / ${contactName}`);
    return { id: null, disabled: true };
  }

  const sf = await connect();
  const cleaned = cleanPhone(phone);

  const convData = {
    Phone__c: cleaned,
    Contact_Name__c: contactName || null,
    Last_Activity__c: new Date().toISOString(),
  };

  try {
    // Tenta encontrar por telefone primeiro
    const existing = await sf.sobject('WhatsApp_Conversation__c')
      .findOne({ Phone__c: cleaned });

    if (existing) {
      await sf.sobject('WhatsApp_Conversation__c').update({
        Id: existing.Id,
        Contact_Name__c: contactName || existing.Contact_Name__c,
        Last_Activity__c: new Date().toISOString(),
      });
      logger.debug(`🔄 Conversation atualizada: ${existing.Id} (${cleaned})`);
      return { id: existing.Id, updated: true };
    } else {
      const result = await sf.sobject('WhatsApp_Conversation__c').create({
        ...convData,
        Unread__c: 0,
      });
      if (result.success) {
        logger.debug(`🆕 Conversation criada: ${result.id} (${cleaned})`);
        return { id: result.id, created: true };
      }
      throw new Error(JSON.stringify(result.errors));
    }
  } catch (err) {
    // Se o objeto não existir ainda na org, loga mas não quebra o fluxo
    if (err.message && err.message.includes('NOT_FOUND')) {
      logger.warn(`⚠️ Objeto WhatsApp_Conversation__c não encontrado na org. Crie os objetos customizados no Salesforce (ver salesforce/SCHEMA.md)`);
    } else {
      logger.error('❌ Erro no upsertConversation:', err.message);
    }
    return { id: null, error: err.message };
  }
}

// ── Cria Message__c vinculada a uma Conversation ───────────────────────────
async function createMessage({
  conversationId,
  direction,
  body,
  whatsappMsgId,
  timestamp,
  status,
}) {
  if (sfDisabled) {
    logger.debug(`[SF_DISABLED] createMessage: ${direction} / ${body?.substring(0, 40)}`);
    return { id: null, disabled: true };
  }

  if (!conversationId) {
    logger.warn('createMessage chamado sem conversationId — pulando');
    return { id: null, error: 'missing conversationId' };
  }

  const sf = await connect();

  const msgData = {
    Conversation__c: conversationId,
    Direction__c: direction, // 'Inbound' ou 'Outbound'
    Body__c: body || '',
    WhatsApp_Msg_Id__c: whatsappMsgId,
    Timestamp__c: timestamp
      ? new Date(timestamp * 1000).toISOString()
      : new Date().toISOString(),
    Status__c: status || (direction === 'Outbound' ? 'Sent' : 'Received'),
  };

  try {
    // Dedup: verifica se já existe mensagem com este WhatsApp_Msg_Id__c
    if (whatsappMsgId) {
      const existing = await sf.sobject('WhatsApp_Message__c')
        .findOne({ WhatsApp_Msg_Id__c: whatsappMsgId });
      if (existing) {
        logger.debug(`↩️ Message já existe (dedup): ${whatsappMsgId}`);
        return { id: existing.Id, duplicate: true };
      }
    }

    const result = await sf.sobject('WhatsApp_Message__c').create(msgData);
    if (result.success) {
      logger.debug(`📝 Message criada: ${result.id} (${direction})`);

      // Atualiza Last_Message__c na Conversation
      try {
        await sf.sobject('WhatsApp_Conversation__c').update({
          Id: conversationId,
          Last_Message__c: (body || '').substring(0, 255),
          Last_Activity__c: new Date().toISOString(),
          ...(direction === 'Inbound' ? { Unread__c: { $inc: 1 } } : {}),
        });
      } catch {}

      return { id: result.id, created: true };
    }
    throw new Error(JSON.stringify(result.errors));
  } catch (err) {
    if (err.message && err.message.includes('NOT_FOUND')) {
      logger.warn(`⚠️ Objeto WhatsApp_Message__c não encontrado na org. Crie os objetos customizados no Salesforce (ver salesforce/SCHEMA.md)`);
    } else {
      logger.error('❌ Erro ao criar Message:', err.message);
    }
    return { id: null, error: err.message };
  }
}

// ── Atualiza status de entrega de uma mensagem (via ACK) ───────────────────
async function updateMessageStatus({ whatsappMsgId, status }) {
  if (sfDisabled) {
    logger.debug(`[SF_DISABLED] updateMessageStatus: ${whatsappMsgId} → ${status}`);
    return { disabled: true };
  }

  const sf = await connect();

  try {
    const existing = await sf.sobject('WhatsApp_Message__c')
      .findOne({ WhatsApp_Msg_Id__c: whatsappMsgId });

    if (!existing) {
      logger.debug(`Status update: msg ${whatsappMsgId} não encontrada no SF`);
      return { notFound: true };
    }

    await sf.sobject('WhatsApp_Message__c').update({
      Id: existing.Id,
      Status__c: status,
    });
    logger.debug(`📋 Status atualizado: ${whatsappMsgId} → ${status}`);
    return { id: existing.Id, updated: true };
  } catch (err) {
    logger.error('❌ Erro ao atualizar status:', err.message);
    return { error: err.message };
  }
}

// ── Orquestra persistência de mensagem recebida/enviada ────────────────────
// Chamada pelo callback onMessage do whatsapp.js
async function persistInbound(msgData) {
  const { phone, contactName, body, id, timestamp, fromMe } = msgData;

  // 1. Upsert Conversation
  const conv = await upsertConversation({ phone, contactName });
  if (!conv.id) {
    logger.warn(`Mensagem não persistida — sem Conversation para ${phone}`);
    return;
  }

  // 2. Create Message
  const direction = fromMe ? 'Outbound' : 'Inbound';
  const status = fromMe ? 'Sent' : 'Received';
  await createMessage({
    conversationId: conv.id,
    direction,
    body,
    whatsappMsgId: id,
    timestamp,
    status,
  });
}

// ── Publica Platform Event (para tempo real no LWC via empApi) ─────────────
async function publishMessageEvent({ conversationId, direction, body, phone }) {
  if (sfDisabled) {
    logger.debug(`[SF_DISABLED] publishMessageEvent: ${direction} / ${phone}`);
    return { disabled: true };
  }

  const sf = await connect();

  try {
    const result = await sf.sobject('WhatsApp_Message__e').create({
      ConversationId__c: conversationId,
      Direction__c: direction,
      Body__c: (body || '').substring(0, 300),
      Phone__c: phone,
    });
    if (result.success) {
      logger.debug(`📡 Platform Event publicado: ${result.id}`);
      return { id: result.id };
    }
    throw new Error(JSON.stringify(result.errors));
  } catch (err) {
    // Platform Events exigem feature ativa — loga warning mas não quebra
    logger.debug(`Platform Event não publicado (ok para POC): ${err.message}`);
    return { error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Funções legadas (mantidas para compatibilidade)
// ═══════════════════════════════════════════════════════════════════════════

// ── Cria um Case a partir de uma mensagem do WhatsApp ──────────────────────
async function createCase({ from, body, timestamp, contactName }) {
  if (sfDisabled) return null;
  const sf = await connect();

  const caseData = {
    Subject: `[WhatsApp] ${contactName || from} — ${body.substring(0, 60)}`,
    Description: body,
    Origin: 'Web',
    Status: 'New',
    Priority: 'Medium',
  };

  try {
    const result = await sf.sobject('Case').create(caseData);
    if (result.success) {
      logger.info(`📋 Case criado: ${result.id} para ${from}`);
      return result;
    }
    throw new Error(JSON.stringify(result.errors));
  } catch (err) {
    logger.error('❌ Erro ao criar Case:', err.message);
    throw err;
  }
}

// ── Cria ou atualiza um Lead a partir de um contato do WhatsApp ───────────
async function upsertLead({ from, contactName, body }) {
  if (sfDisabled) return null;
  const sf = await connect();

  const nameParts = (contactName || 'Desconhecido WhatsApp').split(' ');
  const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '';
  const lastName = nameParts[nameParts.length - 1];

  const leadData = {
    LastName: lastName,
    FirstName: firstName,
    Company: 'Via WhatsApp',
    LeadSource: 'Web',
    MobilePhone: cleanPhone(from),
    Description: `Primeira mensagem WhatsApp:\n${body}`,
  };

  try {
    const existing = await sf.sobject('Lead')
      .findOne({ MobilePhone: leadData.MobilePhone });

    let result;
    if (existing) {
      result = await sf.sobject('Lead').update({ Id: existing.Id, ...leadData });
      logger.info(`🔄 Lead atualizado: ${existing.Id}`);
    } else {
      result = await sf.sobject('Lead').create(leadData);
      logger.info(`👤 Lead criado: ${result.id}`);
    }
    return result;
  } catch (err) {
    logger.error('❌ Erro ao fazer upsert do Lead:', err.message);
    throw err;
  }
}

// ── Cria uma Task vinculada a um contato/lead (log de mensagem) ───────────
async function logActivity({ from, body, whoId }) {
  if (sfDisabled) return null;
  const sf = await connect();

  try {
    const result = await sf.sobject('Task').create({
      Subject: 'Mensagem WhatsApp recebida',
      Description: body,
      Status: 'Completed',
      ActivityDate: new Date().toISOString().split('T')[0],
      WhoId: whoId || null,
    });
    logger.info(`📝 Task criada: ${result.id}`);
    return result;
  } catch (err) {
    logger.error('❌ Erro ao criar Task:', err.message);
    throw err;
  }
}

// ── Busca contato pelo telefone ────────────────────────────────────────────
async function findContactByPhone(phone) {
  if (sfDisabled) return { contact: null, lead: null };
  const sf = await connect();
  const cleaned = cleanPhone(phone);

  try {
    const [contact, lead] = await Promise.all([
      sf.sobject('Contact').findOne({
        MobilePhone: { $like: `%${cleaned.slice(-8)}` },
      }),
      sf.sobject('Lead').findOne({
        MobilePhone: { $like: `%${cleaned.slice(-8)}` },
      }),
    ]);
    return { contact, lead };
  } catch (err) {
    logger.error('❌ Erro ao buscar contato:', err.message);
    return { contact: null, lead: null };
  }
}

module.exports = {
  connect,
  persistInbound,
  upsertConversation,
  createMessage,
  updateMessageStatus,
  publishMessageEvent,
  createCase,
  upsertLead,
  logActivity,
  findContactByPhone,
};
