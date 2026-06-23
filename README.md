# WhatsApp Web + Salesforce — POC Local

Integração não-oficial do WhatsApp Web com Salesforce usando **Node.js** + **whatsapp-web.js**.

---

## 📋 Pré-requisitos

- **Node.js** v18 ou superior → https://nodejs.org
- **Google Chrome** instalado (usado pelo Puppeteer)
- Conta Salesforce (Developer Edition gratuita: https://developer.salesforce.com/signup)
- Um número de WhatsApp para conectar (não pode estar logado no WhatsApp Web ao mesmo tempo)

---

## 🚀 Instalação e Execução

### 1. Clone / baixe o projeto e instale dependências

```bash
cd whatsapp-sf-poc
npm install
```

> A instalação baixa o Chromium automaticamente via Puppeteer (~150MB).

### 2. Configure as variáveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` com suas credenciais:

```env
SF_LOGIN_URL=https://login.salesforce.com
SF_CLIENT_ID=...
SF_CLIENT_SECRET=...
SF_USERNAME=voce@empresa.com
SF_PASSWORD=suasenha
SF_TOKEN=seutoken
```

> **Como pegar o Security Token do Salesforce:**  
> My Settings → Personal → Reset My Security Token → chegará por e-mail

### 3. Inicie o servidor

```bash
npm start
```

### 4. Escaneie o QR Code

No terminal aparecerá um QR Code. Abra o WhatsApp no celular:

**Android:** Menu (3 pontos) → WhatsApp Web  
**iPhone:** Configurações → Aparelhos conectados → Conectar um aparelho

Escaneie o QR Code. A sessão é salva localmente (pasta `.wwebjs_auth`) — **não precisa escanear toda vez**.

---

## 🔌 Endpoints da API REST

### Verificar status
```http
GET http://localhost:3000/api/status
```

### Enviar mensagem (via código/Salesforce)
```http
POST http://localhost:3000/api/send
Content-Type: application/json
x-webhook-secret: sua_chave_secreta

{
  "to": "5534999998888",
  "message": "Olá! Tudo bem?"
}
```

### Enviar para múltiplos números
```http
POST http://localhost:3000/api/send-bulk
Content-Type: application/json

{
  "numbers": ["5534999998888", "5511977776666"],
  "message": "Aviso importante para todos!"
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

## 🔄 Fluxos de Integração

### Fluxo 1: WhatsApp → Salesforce (automático)

| Situação | Ação automática |
|----------|----------------|
| Mensagem de número **desconhecido** | Cria **Lead** no Salesforce |
| Mensagem de número **já cadastrado** | Cria **Task** vinculada ao Contact/Lead |
| Mensagem começando com `!sf` | Cria **Case** no Salesforce |

**Exemplo:** Cliente envia `!sf Meu pedido não chegou` → Case criado automaticamente.

### Fluxo 2: Salesforce → WhatsApp (via Apex)

1. Copie `config/WhatsAppService.cls` para sua org Salesforce
2. Adicione `http://localhost:3000` em **Remote Site Settings**
3. Use em Triggers, Flows ou qualquer lógica Apex:

```apex
WhatsAppService.sendWhatsAppMessage('5534999998888', 'Seu atendimento foi aberto!');
```

---

## ⚙️ Salesforce — Setup da Connected App

1. Setup → App Manager → **New Connected App**
2. Marque **Enable OAuth Settings**
3. Callback URL: `http://localhost:3000/oauth/callback`
4. Scopes: `api`, `refresh_token`
5. Salve e aguarde ~10 minutos para ativar
6. Copie **Consumer Key** e **Consumer Secret** para o `.env`

---

## ⚠️ Limitações e Avisos Importantes

| Item | Detalhe |
|------|---------|
| **Não-oficial** | A Meta/WhatsApp pode banir o número se detectar automação agressiva |
| **Uma sessão por vez** | O número não pode estar no WhatsApp Web do navegador simultaneamente |
| **Volume** | Evite envios em massa rápidos — use delays entre mensagens |
| **Produção** | Para uso em produção, considere a API Oficial do WhatsApp Business |
| **Local** | Para expor externamente, use ngrok: `npx ngrok http 3000` |

---

## 📁 Estrutura do Projeto

```
whatsapp-sf-poc/
├── src/
│   ├── index.js          # Entry point
│   ├── whatsapp.js       # Cliente WhatsApp Web
│   ├── salesforce.js     # Integração Salesforce (jsforce)
│   ├── api.js            # Servidor Express + endpoints
│   └── logger.js         # Logger centralizado
├── config/
│   └── WhatsAppService.cls  # Classe Apex para o Salesforce
├── logs/                 # Logs gerados automaticamente
├── .wwebjs_auth/         # Sessão WhatsApp (gerado ao usar)
├── .env.example
├── package.json
└── README.md
```

---

## 🛠️ Próximos Passos Sugeridos

- [ ] Expor via ngrok para testes com Salesforce remoto
- [ ] Adicionar fila de mensagens (Bull/Redis) para envios em massa
- [ ] Dashboard web para visualizar mensagens recebidas
- [ ] Deploy em servidor (VPS/EC2) para uso em produção
- [ ] Migrar para API Oficial WhatsApp Business para produção
