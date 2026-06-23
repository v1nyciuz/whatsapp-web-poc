// src/index.js
// Ponto de entrada — inicia WhatsApp + servidor HTTP
require('dotenv').config();
const logger = require('./logger');
const { initWhatsApp } = require('./whatsapp');
const { createApp } = require('./api');

const PORT = process.env.PORT || 3000;

async function main() {
  logger.info('🚀 Iniciando WhatsApp + Salesforce POC...');

  // 1. Sobe o servidor REST (para receber chamadas do Salesforce)
  const app = createApp();
  app.listen(PORT, () => {
    logger.info(`🌐 Servidor HTTP rodando em http://localhost:${PORT}`);
    logger.info(`   → Status:     GET  http://localhost:${PORT}/api/status`);
    logger.info(`   → Enviar msg: POST http://localhost:${PORT}/api/send`);
    logger.info(`   → Bulk send:  POST http://localhost:${PORT}/api/send-bulk`);
    logger.info(`   → Webhook SF: POST http://localhost:${PORT}/api/webhook/salesforce`);
  });

  // 2. Inicia WhatsApp via Puppeteer raw (abre browser visível)
  logger.info('📱 Iniciando WhatsApp Web... uma janela Chrome será aberta.');
  initWhatsApp();
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
