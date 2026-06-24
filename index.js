// index.js
// Ponto de entrada — inicia WhatsApp + servidor HTTP
// Conecta eventos de mensagem do WhatsApp ao store em memória + Salesforce (opcional)
require('dotenv').config();
const logger = require('./logger');
const { initWhatsApp } = require('./whatsapp');
const { persistInbound } = require('./salesforce');
const store = require('./store');
const { createApp } = require('./api');

const PORT = process.env.PORT || 3000;
const sfDisabled = process.env.SF_DISABLED === 'true';

async function main() {
  logger.info('🚀 Iniciando WhatsApp + Salesforce POC...');
  logger.info(
    sfDisabled
      ? '⚠️  SF_DISABLED=true — modo standalone (sem Salesforce)'
      : '🔑 SF habilitado — mensagens serão persistidas no Salesforce',
  );

  // 1. Sobe o servidor REST (para receber chamadas do Salesforce / servir chat)
  const app = createApp();
  app.listen(PORT, () => {
    logger.info(`🌐 Servidor HTTP rodando em http://localhost:${PORT}`);
    logger.info(`   → Chat web:   GET  http://localhost:${PORT}/chat`);
    logger.info(`   → Status:     GET  http://localhost:${PORT}/api/status`);
    logger.info(`   → Enviar msg: POST http://localhost:${PORT}/api/send`);
    logger.info(`   → Conversas:  GET  http://localhost:${PORT}/api/conversations`);
    logger.info(`   → Mensagens:  GET  http://localhost:${PORT}/api/messages?phone=NUMERO`);
    logger.info(`   → Webhook SF: POST http://localhost:${PORT}/api/webhook/salesforce`);
  });

  // 2. Inicia WhatsApp via whatsapp-web.js (store injection + eventos)
  //    Callback onMessage grava no store em memória (sempre) + no SF (se habilitado)
  logger.info('📱 Iniciando WhatsApp Web... uma janela Chrome será aberta.');
  initWhatsApp({
    onMessage: async (msgData) => {
      // 1. Store em memória (sempre — independente do SF)
      store.addMessage(msgData);

      // 2. Salesforce (apenas se habilitado)
      if (!sfDisabled) {
        try {
          await persistInbound(msgData);
        } catch (err) {
          logger.error('Erro ao persistir no SF:', err.message);
        }
      }
    },
  });
}

// Captura erros não tratados para não derrubar o processo
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

main();
