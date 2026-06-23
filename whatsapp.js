const puppeteer = require('puppeteer');
const logger = require('./logger');
const path = require('path');

const WA_URL = 'https://web.whatsapp.com';
const SESSION_DIR = path.join(__dirname, '.puppeteer_session');

let browser = null;
let page = null;
let isReady = false;
let myNumber = null;
let reconnectTimer = null;
let pollTimer = null;
const seenMessages = new Set();

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function initWhatsApp() {
  await launchBrowser();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  isReady = false;
  logger.info('🔄 Reconectando em 10s...');
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await launchBrowser();
  }, 10000);
}

async function launchBrowser() {
  try {
    if (browser) {
      try { await browser.close(); } catch(e) {}
      browser = null; page = null;
    }
  } catch(e) {}

  try {
    logger.info('🌐 Abrindo navegador Chrome...');
    browser = await puppeteer.launch({
      headless: false,
      userDataDir: SESSION_DIR,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    page = (await browser.pages())[0];
    await page.setViewport({ width: 1366, height: 768 });

    page.on('error', err => { logger.error(`🚫 ${err.message}`); scheduleReconnect(); });
    page.on('close', () => { logger.warn('⚠️ Página fechada'); scheduleReconnect(); });
    browser.on('disconnected', () => { logger.warn('⚠️ Navegador desconectado'); isReady = false; scheduleReconnect(); });

    logger.info('📱 Carregando WhatsApp Web...');
    await page.goto(WA_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    const authed = await waitForAuth();
    if (!authed) { scheduleReconnect(); return; }

    isReady = true;
    await extractMyNumber();
    startPoll();
    printInstructions();
  } catch (err) {
    logger.error(`❌ ${err.message}`);
    scheduleReconnect();
  }
}

async function waitForAuth() {
  const deadline = Date.now() + 180000;

  while (Date.now() < deadline) {
    try {
      await page.waitForSelector('div[data-testid="chat-list"]', { timeout: 3000 });
      return true;
    } catch {}

    try {
      await page.waitForSelector('canvas[aria-label="Scan me!"]', { timeout: 2000 });
      logger.info('📱 QR Code gerado! Escaneie com o WhatsApp do celular.');
      const qrDeadline = Date.now() + 120000;
      while (Date.now() < qrDeadline) {
        try {
          await page.waitForSelector('div[data-testid="chat-list"]', { timeout: 2000 });
          logger.info('✅ WhatsApp autenticado!');
          return true;
        } catch {}
      }
      logger.warn('⏰ QR expirou, recarregando...');
      await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    } catch {}
  }

  logger.error('❌ Autenticação falhou após 3 min');
  return false;
}

async function extractMyNumber() {
  try {
    try {
      const profile = await page.waitForSelector('header header div[role="button"]', { timeout: 5000 });
      await profile.click();
      await sleep(1500);

      myNumber = await page.evaluate(() => {
        const spans = document.querySelectorAll('span[dir="auto"]');
        for (const s of spans) {
          const t = s.textContent.trim();
          if (/^\d{10,15}$/.test(t.replace(/\D/g, ''))) return t;
        }
        return null;
      });

      const close = await page.$('button[aria-label="Fechar"]');
      if (close) await close.click();
      await sleep(1000);
    } catch {
      myNumber = await page.evaluate(() => {
        const spans = document.querySelectorAll('span[dir="auto"]');
        for (const s of spans) {
          const t = s.textContent.trim();
          if (/^\d{10,15}$/.test(t.replace(/\D/g, ''))) return t;
        }
        return null;
      });
    }
    if (myNumber) logger.info(`📞 Conectado: ${myNumber}`);
    else logger.info('📞 Conectado');
  } catch(e) {
    logger.warn(`⚠️ ${e.message}`);
  }
}

async function sendMessage(to, text) {
  if (!isReady) throw new Error('WhatsApp não conectado');

  const clean = to.replace(/\D/g, '');
  logger.info(`📤 Enviando para ${clean}...`);

  try {
    await page.goto(`${WA_URL}/send?phone=${clean}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await sleep(3000);

    try {
      await page.waitForFunction(() => {
        const err = document.querySelector('div[data-testid="conversation-panel-error"]');
        return !err;
      }, { timeout: 8000 });
    } catch {
      await page.goto(WA_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      throw new Error(`Número ${clean} inválido ou não está no WhatsApp`);
    }

    let input = null;
    for (let i = 0; i < 30; i++) {
      try {
        input = await page.$('div[contenteditable="true"][data-tab="10"]');
        if (input) break;
      } catch {}
      await sleep(500);
    }

    if (!input) {
      await page.goto(WA_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      throw new Error('Campo de mensagem não encontrado');
    }

    await input.click();
    await sleep(200);
    await input.type(text, { delay: 15 });
    await sleep(500);

    const sendBtn = await page.$('button[data-testid="compose-btn-send"]');
    if (sendBtn) await sendBtn.click();
    else await page.keyboard.press('Enter');

    await sleep(3000);
    logger.info(`✅ Enviado para ${clean}`);

    await page.goto(WA_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    // Reset snapshot so next poll only catches new messages
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; startPoll(); }
    return true;
  } catch (err) {
    if (err.message.includes('invalido') || err.message.includes('encontrado')) throw err;
    logger.error(`❌ Erro: ${err.message}`);
    await page.goto(WA_URL, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    throw err;
  }
}

function startPoll() {
  if (pollTimer) clearInterval(pollTimer);
  logger.info('📥 Monitorando mensagens recebidas...');

  let lastSnapshot = '';

  pollTimer = setInterval(async () => {
    if (!page || !isReady) return;

    try {
      const url = page.url();
      if (!url.startsWith(WA_URL) || url.includes('/send?')) return;

      const result = await page.evaluate(() => {
        const msgs = document.querySelectorAll('[data-pre-plain-text]');
        if (!msgs.length) return null;

        let snapshot = '';
        for (const m of msgs) {
          const pre = m.getAttribute('data-pre-plain-text') || '';
          const spans = m.querySelectorAll('span[dir="ltr"], span[dir="auto"]');
          let text = '';
          for (const s of spans) {
            const t = s.textContent.trim();
            if (t && t.length > 1) text += t + ' ';
          }
          text = text.trim() || '(mensagem)';
          snapshot += pre + '|' + text + '\n';
        }
        return { snapshot, msgs: snapshot.split('\n').filter(Boolean) };
      });

      if (!result || !result.snapshot) return;

      // Primeiro poll define a baseline (não loga histórico existente)
      if (!lastSnapshot) { lastSnapshot = result.snapshot; return; }

      if (result.snapshot !== lastSnapshot) {
        const oldLines = new Set(lastSnapshot.split('\n').filter(Boolean));
        for (const line of result.msgs) {
          if (!oldLines.has(line)) {
            const sender = line.replace(/\[.*?\]\s*/, '').replace(/:.*$/, '').trim();
            const text = line.split('|').slice(1).join('|');
            const key = line;
            if (!seenMessages.has(key)) {
              seenMessages.add(key);
              logger.info(`📨 ${sender}: ${text.substring(0, 120)}`);
            }
          }
        }
      }
      lastSnapshot = result.snapshot;
    } catch {}
  }, 2000);
}

function printInstructions() {
  const port = process.env.PORT || 3000;
  logger.info('═══════════════════════════════════════════════════');
  logger.info('  ✅ WhatsApp POC PRONTA!');
  logger.info('');
  logger.info('  📤 ENVIAR (PowerShell):');
  logger.info(`    Invoke-RestMethod -Uri "http://localhost:${port}/api/send" -Method Post -ContentType "application/json" -Headers @{"x-webhook-secret" = "SEU_WEBHOOK_SECRET"} -Body '{"to":"SEU_NUMERO","message":"Teste!"}'`);
  logger.info('');
  logger.info('  📊 STATUS:');
  logger.info(`    GET http://localhost:${port}/api/status`);
  logger.info('');
  logger.info('  📥 RECEBER: mande msg para o número conectado no WhatsApp');
  logger.info('');
  logger.info('  ⚠️  SF desabilitado');
  logger.info('═══════════════════════════════════════════════════');
}

function getStatus() {
  return { connected: isReady, number: myNumber };
}

module.exports = { initWhatsApp, sendMessage, getStatus };
