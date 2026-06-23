# AGENTS.md — WhatsApp + Salesforce POC

## Project structure

Source files are at **root level** (not `src/` as the README claims; docs are stale). Entry point: `index.js`.

## Key commands

| Command | Purpose |
|---------|---------|
| `npm start` | Start server + WhatsApp client |
| `npm run dev` | Start with nodemon (auto-restart on changes) |

## Architecture

- **`index.js`** — boots Express, then initializes WhatsApp
- **`api.js`** — Express server on `PORT` (default 3000). Routes under `/api`
- **`whatsapp.js`** — Puppeteer raw (no `whatsapp-web.js`). Controls WhatsApp Web UI directly: navigates to `send?phone=...`, clicks input, types, presses Enter. Saves session in `.puppeteer_session/` (Chrome profile dir).
- **`salesforce.js`** — jsforce connection via username-password OAuth; concatenates `SF_PASSWORD + SF_TOKEN` for login
- **`logger.js`** — Winston writes to `logs/error.log` and `logs/combined.log`

## Recebimento de mensagens

A cada 2s, o Node.js verifica o DOM do painel de conversas do WhatsApp Web via `page.evaluate`:
1. Primeiro poll captura o snapshot completo das mensagens (baseline) — não loga nada
2. Polls seguintes comparam o snapshot atual com o anterior
3. Se detecta linha nova, extrai o nome (de `data-pre-plain-text`) e o texto (de `span[dir="ltr"]`) e loga

## Testes manuais

```powershell
# Enviar mensagem (PowerShell)
Invoke-RestMethod -Uri "http://localhost:3000/api/send" -Method Post -ContentType "application/json" -Headers @{"x-webhook-secret" = "SEU_WEBHOOK_SECRET"} -Body '{"to":"SEU_NUMERO","message":"Teste!"}'

# Ver status
curl http://localhost:3000/api/status

# Receber: mande uma msg do celular para o número conectado
```

## Non-obvious setup details

- **Session persistence**: `.puppeteer_session/` (Chrome user data dir) — QR scan needed only on first run
- **Chrome required**: Puppeteer launches local Chrome with `headless: false`. Chrome must be installed.
- **Puppeteer args**: `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`
- **Number format**: International sem + ou traços (ex: `5534999998888`). Código limpa não-dígitos.
- **SalesForce login**: password and security token concatenados direto (`SF_PASSWORD + SF_TOKEN`)
- **Webhook secret**: verificado via header `x-webhook-secret` ou query param `?secret=`
- **Envio**: navega para `https://web.whatsapp.com/send?phone=NUMERO`, espera input carregar, digita, pressiona Enter, volta para página principal

## WhatsApp message handling (via API)

| Condição | Ação |
|----------|------|
| POST `/api/send` com `to` + `message` | Envia WhatsApp via UI automation |
| Mensagem recebida (detectada por poll) | Loga no terminal |
| Mensagens de grupo (`@g.us`) | Ignoradas (não chegam no painel ativo) |

## Common pitfalls

- A sessão do Chrome (`userDataDir`) cria lock files. Se matar o processo abruptamente, talvez precise deletar `.puppeteer_session/` e escanear QR de novo.
- O Chrome aberto pelo Puppeteer **não pode** ter outro WhatsApp Web logado simultaneamente no mesmo navegador.
- O `.env` é obrigatório; copie de `.env.example`.
- Projeto usa CommonJS (`require`/`module.exports`) — não adicionar ESM imports.
- `SF_LOGIN_URL` padrão `https://login.salesforce.com`; usar `https://test.salesforce.com` para sandbox.
- Dependências não usadas (`whatsapp-web.js`, `qrcode-terminal`, `axios`) ainda estão em `node_modules/` — remova se quiser.
