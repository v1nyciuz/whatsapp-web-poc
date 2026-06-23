// src/salesforce.js
// Responsável por toda comunicação com a API do Salesforce
const jsforce = require('jsforce');
const logger = require('./logger');

let conn = null;

// ── Conecta ao Salesforce via username/password OAuth flow ──────────────────
async function connect() {
  if (conn && conn.accessToken) {
    return conn; // reutiliza conexão existente
  }

  conn = new jsforce.Connection({
    loginUrl: process.env.SF_LOGIN_URL || 'https://login.salesforce.com'
  });

  try {
    await conn.login(
      process.env.SF_USERNAME,
      process.env.SF_PASSWORD + process.env.SF_TOKEN
    );
    logger.info(`✅ Salesforce conectado como ${process.env.SF_USERNAME}`);
    return conn;
  } catch (err) {
    logger.error('❌ Falha ao conectar no Salesforce:', err.message);
    throw err;
  }
}

// ── Cria um Case a partir de uma mensagem do WhatsApp ──────────────────────
async function createCase({ from, body, timestamp, contactName }) {
  const sf = await connect();

  const caseData = {
    Subject: `[WhatsApp] ${contactName || from} — ${body.substring(0, 60)}`,
    Description: body,
    Origin: 'Web',                   // Você pode criar um valor customizado "WhatsApp"
    Status: 'New',
    Priority: 'Medium',
    // Campos customizados (se existirem na sua org):
    // WA_Phone__c: from,
    // WA_Message_Timestamp__c: new Date(timestamp * 1000).toISOString(),
  };

  try {
    const result = await sf.sobject('Case').create(caseData);
    if (result.success) {
      logger.info(`📋 Case criado: ${result.id} para ${from}`);
      return result;
    } else {
      throw new Error(JSON.stringify(result.errors));
    }
  } catch (err) {
    logger.error('❌ Erro ao criar Case:', err.message);
    throw err;
  }
}

// ── Cria ou atualiza um Lead a partir de um contato do WhatsApp ───────────
async function upsertLead({ from, contactName, body }) {
  const sf = await connect();

  // Divide nome em First/Last (fallback simples)
  const nameParts = (contactName || 'Desconhecido WhatsApp').split(' ');
  const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '';
  const lastName = nameParts[nameParts.length - 1];

  const leadData = {
    LastName: lastName,
    FirstName: firstName,
    Company: 'Via WhatsApp',
    LeadSource: 'Web',
    MobilePhone: from.replace('@c.us', ''),
    Description: `Primeira mensagem WhatsApp:\n${body}`
  };

  try {
    // Tenta encontrar Lead pelo telefone antes de criar
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
  const sf = await connect();

  try {
    const result = await sf.sobject('Task').create({
      Subject: `Mensagem WhatsApp recebida`,
      Description: body,
      Status: 'Completed',
      ActivityDate: new Date().toISOString().split('T')[0],
      WhoId: whoId || null,          // Id do Lead ou Contact
      // WA_Phone__c: from,
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
  const sf = await connect();
  const cleaned = phone.replace('@c.us', '').replace(/\D/g, '');

  try {
    // Busca em Contact e Lead
    const [contact, lead] = await Promise.all([
      sf.sobject('Contact').findOne({ MobilePhone: { $like: `%${cleaned.slice(-8)}` } }),
      sf.sobject('Lead').findOne({ MobilePhone: { $like: `%${cleaned.slice(-8)}` } })
    ]);

    return { contact, lead };
  } catch (err) {
    logger.error('❌ Erro ao buscar contato:', err.message);
    return { contact: null, lead: null };
  }
}

module.exports = { connect, createCase, upsertLead, logActivity, findContactByPhone };
