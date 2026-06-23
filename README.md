# WhatsApp Web + Salesforce — POC

Integração não-oficial do WhatsApp Web com Salesforce usando **Node.js** + **Puppeteer** (automação por interface visual).

> ⚠️ Usa Puppeteer raw para controlar o WhatsApp Web diretamente (clica, digita, envia) — sem depender de bibliotecas de terceiros como `whatsapp-web.js`.

---

## 📋 Pré-requisitos

- **Node.js** v18+ → https://nodejs.org
- **Google Chrome** instalado
- Um número de WhatsApp para conectar (não pode estar logado no WhatsApp Web ao mesmo tempo)

---

## 🚀 Instalação e Execução

### 1. Clone e instale dependências

```bash
cd whatsapp-web-poc
npm install
```

### 2. Configure o ambiente

```bash
cp .env.example .env
# Edite o .env com suas credenciais
```

### 3. Inicie o servidor

```bash
npm start
```

Uma janela do Chrome será aberta com o WhatsApp Web.

### 4. Escaneie o QR Code

Na **primeira execução**, escaneie o QR Code que aparece na janela do Chrome usando o WhatsApp do celular:

- **Android:** Menu (3 pontos) → WhatsApp Web
- **iPhone:** Configurações → Aparelhos conectados → Conectar um aparelho

A sessão é salva em `.puppeteer_session/` — **não precisa escanear toda vez**.

---

## 🔌 Endpoints da API REST

### Verificar status
```http
GET http://localhost:3000/api/status
```

### Enviar mensagem
```http
POST http://localhost:3000/api/send
Content-Type: application/json
x-webhook-secret: SEU_WEBHOOK_SECRET

{
  "to": "5534999998888",
  "message": "Olá! Tudo bem?"
}
```

**PowerShell:**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/send" -Method Post -ContentType "application/json" -Headers @{"x-webhook-secret" = "SEU_WEBHOOK_SECRET"} -Body '{"to":"5534999998888","message":"Teste!"}'
```

### Enviar para múltiplos números
```http
POST http://localhost:3000/api/send-bulk
Content-Type: application/json

{
  "numbers": ["5534999998888", "5511977776666"],
  "message": "Aviso importante!"
}
```

### Webhook para eventos do Salesforce
```http
POST http://localhost:3000/api/webhook/salesforce
Content-Type: application/json

{
  "action": "send_whatsapp",
  "to": "5534999998888",
  "message": "Seu Case #00001 foi atualizado!"
}
```

---

## 📥 Recebimento de Mensagens

O servidor verifica o DOM do WhatsApp Web a cada **2 segundos**. Mensagens novas aparecem no terminal automaticamente.

> Mensagens de grupos (`@g.us`) são ignoradas.

---

## 🔄 Salesforce (opcional)

A integração com Salesforce está **desabilitada por padrão** (`SF_DISABLED=true` no `.env`).

Para ativar:
1. Configure as credenciais Salesforce no `.env`
2. Defina `SF_DISABLED=false`
3. Reinicie o servidor

### Fluxos quando ativo:
| Situação | Ação automática |
|----------|----------------|
| Mensagem de número **desconhecido** | Cria **Lead** no Salesforce |
| Mensagem de número **já cadastrado** | Cria **Task** vinculada ao Contact/Lead |
| Mensagem começando com `!sf` | Cria **Case** no Salesforce |

### Setup da Connected App no Salesforce
1. Setup → App Manager → **New Connected App**
2. Marque **Enable OAuth Settings**
3. Callback URL: `http://localhost:3000/oauth/callback`
4. Scopes: `api`, `refresh_token`
5. Salve e aguarde ~10 minutos
6. Copie **Consumer Key** e **Consumer Secret** para o `.env`

---

## ⚠️ Limitações

| Item | Detalhe |
|------|---------|
| **Não-oficial** | A Meta/WhatsApp pode banir o número se detectar automação agressiva |
| **Uma sessão por vez** | O número não pode estar no WhatsApp Web do navegador simultaneamente |
| **Volume** | Evite envios em massa rápidos — use delays entre mensagens |
| **Produção** | Para uso em produção, considere a API Oficial do WhatsApp Business |
| **Local** | Para expor externamente, use ngrok: `npx ngrok http 3000` |

---

## 📁 Estrutura

```
whatsapp-web-poc/
├── index.js              # Entry point
├── whatsapp.js           # Automação WhatsApp via Puppeteer
├── api.js                # Servidor Express + endpoints
├── salesforce.js         # Integração Salesforce (jsforce)
├── logger.js             # Logger centralizado (Winston)
├── WhatsAppService.cls   # Classe Apex para Salesforce
├── .env.example
├── package.json
└── README.md
```

---

## 🛠️ Próximos Passos

- [ ] Expor via ngrok para testes com Salesforce remoto
- [ ] Adicionar fila de mensagens (Bull/Redis) para envios em massa
- [ ] Dashboard web para visualizar mensagens recebidas
- [ ] Deploy em servidor (VPS/EC2) para uso em produção
- [ ] Migrar para API Oficial WhatsApp Business
