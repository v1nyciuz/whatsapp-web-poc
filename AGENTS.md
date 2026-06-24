# AGENTS.md — WhatsApp + Salesforce POC

## Project structure

Source files are at **root level** (not `src/` as the README claims; docs are stale). Entry point: `index.js`.

```
.
├── index.js              # Boot: Express + WhatsApp init + wiring inbound→SF
├── api.js                # Express server on PORT (default 3000). Routes under /api
├── whatsapp.js           # WhatsApp Web via whatsapp-web.js (store injection + eventos)
├── salesforce.js         # jsforce: persistência de Conversation/Message + funções legadas
├── logger.js             # Winston → logs/error.log + logs/combined.log
├── .env / .env.example   # Config
├── .wwjs_session/        # Sessão whatsapp-web.js (LocalAuth) — QR só na 1ª vez
└── salesforce/           # Artefatos SF de referência (deploy manual)
    ├── SCHEMA.md         # Objetos customizados + setup necessário
    ├── apex/             # WhatsAppService.cls + WhatsAppChatController.cls
    └── lwc/whatsappChat/ # Componente de chat LWC
```

## Key commands

| Command | Purpose |
|---------|---------|
| `npm start` | Start server + WhatsApp client |
| `npm run dev` | Start with nodemon (auto-restart on changes) |

## Architecture

- **`index.js`** — boots Express, then initializes WhatsApp with `onMessage` callback wired to `salesforce.persistInbound()`
- **`api.js`** — Express server on `PORT` (default 3000). Routes: `/api/status`, `/api/send`, `/api/send-bulk`, `/api/webhook/salesforce`
- **`whatsapp.js`** — uses **`whatsapp-web.js`** (store injection nativa do WhatsApp Web). Eventos: `message` (inbound), `message_create` (outbound), `message_ack` (status entrega). Sessão em `.wwjs_session/` via `LocalAuth`. QR no terminal via `qrcode-terminal`.
- **`salesforce.js`** — jsforce. Funções novas: `persistInbound()`, `upsertConversation()`, `createMessage()`, `updateMessageStatus()`, `publishMessageEvent()`. Funções legadas: `createCase()`, `upsertLead()`, `logActivity()`, `findContactByPhone()`. Respeita `SF_DISABLED=true`.
- **`logger.js`** — Winston writes to `logs/error.log` and `logs/combined.log`

## Recebimento de mensagens (M1 + M2)

`whatsapp-web.js` assina o **store interno** do WhatsApp Web (não mais poll de DOM):
1. Evento `message` dispara para cada mensagem recebida (push, tempo real)
2. Evento `message_create` dispara para mensagens enviadas por mim (Outbound)
3. Cada mensagem → callback `onMessage` → `salesforce.persistInbound()`
4. `persistInbound` faz upsert de `WhatsApp_Conversation__c` + create `WhatsApp_Message__c`
5. Dedup por `WhatsApp_Msg_Id__c` (External ID unique)
6. Quando `SF_DISABLED=true`, apenas loga (não conecta no SF)

## Testes manuais

```powershell
# Enviar mensagem (PowerShell)
Invoke-RestMethod -Uri "http://localhost:3000/api/send" -Method Post -ContentType "application/json" -Headers @{"x-webhook-secret" = "9o5bkn3f12secaghjr7tlm6y"} -Body '{"to":"5534992111561","message":"Teste!"}'

# Ver status
curl http://localhost:3000/api/status

# Receber: mande uma msg do celular para o número conectado
```

## Non-obvious setup details

- **Session persistence**: `.wwjs_session/` (whatsapp-web.js LocalAuth) — QR scan needed only on first run
- **Chrome required**: whatsapp-web.js usa Puppeteer internamente com `headless: false`. Chrome must be installed.
- **Puppeteer args**: `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`
- **Number format**: International sem + ou traços (ex: `5534999998888`). Código limpa não-dígitos.
- **SalesForce login**: password and security token concatenados direto (`SF_PASSWORD + SF_TOKEN`)
- **Webhook secret**: verificado via header `x-webhook-secret` ou query param `?secret=`
- **SF_DISABLED**: quando `true`, middleware funciona só como WhatsApp (não conecta no SF). Quando `false`, persiste mensagens em `WhatsApp_Conversation__c` e `WhatsApp_Message__c`.

## WhatsApp message handling

| Condição | Ação |
|----------|------|
| POST `/api/send` com `to` + `message` | Envia via `client.sendMessage()` |
| Evento `message` (recebida) | Loga + `persistInbound()` → SF |
| Evento `message_create` (enviada por mim) | Loga + `persistInbound()` → SF (Direction=Outbound) |
| Evento `message_ack` | Loga status (SENT/DELIVERED/READ) |
| Mensagens de grupo (`@g.us`) | Ignoradas |
| Mensagens de status (`@broadcast`) | Ignoradas |
| Mensagens não-texto (media, etc) | Loga tipo e ignora (expandir depois) |

## Salesforce side (requer setup manual — ver `salesforce/SCHEMA.md`)

Objetos customizados necessários:
- `WhatsApp_Conversation__c` (Phone__c unique, Contact_Name__c, Last_Message__c, Last_Activity__c, Unread__c)
- `WhatsApp_Message__c` (Conversation__c M-D, Direction__c, Body__c, WhatsApp_Msg_Id__c unique, Timestamp__c, Status__c)
- `WhatsApp_Message__e` (Platform Event opcional para tempo real)

Apex: `WhatsAppService.cls` (callout), `WhatsAppChatController.cls` (LWC controller)
LWC: `whatsappChat` (lista conversas + thread + input + polling 4s)

## Common pitfalls

- Se a sessão corromper (lock files), delete `.wwjs_session/` e escanear QR de novo.
- O Chrome aberto pelo whatsapp-web.js **não pode** ter outro WhatsApp Web logado simultaneamente.
- O `.env` é obrigatório; copie de `.env.example`.
- Projeto usa CommonJS (`require`/`module.exports`) — não adicionar ESM imports.
- `SF_LOGIN_URL` padrão `https://login.salesforce.com`; usar `https://test.salesforce.com` para sandbox.
- Para o Salesforce chamar o middleware, precisa de **ngrok/cloudflared** + **Remote Site Setting** ou **Named Credential**.
