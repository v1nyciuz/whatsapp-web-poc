# Plano de Produção — WhatsApp Web + Salesforce

## Visão Geral

**Objetivo:** Encapsular o WhatsApp Web como canal de comunicação dentro do Salesforce, permitindo:

1. **Salesforce → WhatsApp:** Enviar mensagens para usuários externos via automação Apex/Flow
2. **WhatsApp → Salesforce:** Receber respostas e criar registros (Task/Lead/Case) no Salesforce

---

## Arquitetura Alvo

```
┌──────────────────┐     HTTP POST     ┌──────────────────┐
│   Salesforce     │ ────────────────→ │  Seu Servidor    │
│  (Flow/Trigger)  │    /api/send      │  (Node.js)       │
│                  │ ←──────────────── │                  │
│                  │    JSON response   │  ┌────────────┐  │
│                  │                   │  │ Puppeteer  │  │
│                  │                   │  │ (Chrome)   │──┼──→ WhatsApp Web
│                  │                   │  └────────────┘  │
│                  │                   └──────────────────┘
│  REST Endpoint   │     HTTP POST          │
│  /api/msg-recv   │ ←──────────────────────┘
│  (cria Task/etc) │    (quando chega resposta)
└──────────────────┘
```

---

## Passo 1: Melhorar o Envio (Node.js)

### Problema atual
`page.goto('https://web.whatsapp.com/send?phone=N')` → navega a página, espera carregar → ~3s por envio

### Solução: navegação por click (sem page.goto)

Ficar na página principal do WhatsApp Web e usar a UI:

1. Clicar no botão **"Nova conversa"** (`button[data-testid="chat-list-search"]`)
2. Digitar o número no campo de busca
3. Clicar no contato/chat que aparece
4. Digitar a mensagem e enviar
5. Fechar o chat (ou voltar à lista)

**Vantagem:** ~1s por envio, sem recarregar a página, mais estável

```javascript
// Pseudocódigo da melhoria
async function sendMessage(to, text) {
  // 1. Abrir nova conversa
  await page.click('button[data-testid="chat-list-search"]');
  await sleep(500);
  
  // 2. Digitar número
  await page.type('div[contenteditable="true"][data-tab="3"]', to, { delay: 20 });
  await sleep(2000);
  
  // 3. Selecionar contato
  const contact = await page.waitForSelector('[data-testid="cell-frame-container"]', { timeout: 5000 });
  await contact.click();
  await sleep(1000);
  
  // 4. Digitar e enviar
  const input = await page.$('div[contenteditable="true"][data-tab="10"]');
  await input.type(text, { delay: 15 });
  await page.keyboard.press('Enter');
  await sleep(2000);
  
  // 5. Voltar à lista
  await page.click('button[aria-label="Voltar"]');
}
```

### Melhoria 2: Fila de mensagens

Para não sobrecarregar o WhatsApp Web, implementar uma fila:

| Cenário | Comportamento |
|---------|---------------|
| 1 mensagem | Envia direto |
| Várias mensagens seguidas | Enfileira e envia uma por vez com delay de 2s |
| Mensagem falha | Re-tenta 3x, depois descarta e loga erro |

```javascript
const messageQueue = [];
let processing = false;

async function enqueue(to, text) {
  messageQueue.push({ to, text, retries: 0 });
  if (!processing) processQueue();
}

async function processQueue() {
  processing = true;
  while (messageQueue.length > 0) {
    const item = messageQueue.shift();
    try {
      await sendMessageWhatsApp(item.to, item.text);
    } catch (err) {
      item.retries++;
      if (item.retries < 3) {
        messageQueue.unshift(item);
        logger.warn(`⚠️ Re-tentando ${item.to} (tentativa ${item.retries})`);
      } else {
        logger.error(`❌ Falha após 3 tentativas: ${item.to}`);
      }
    }
    await sleep(2000);
  }
  processing = false;
}
```

---

## Passo 2: Melhorar o Recebimento (Node.js)

### Problema atual
Polling a cada 2s no DOM → ineficiente, pode perder mensagens se a página navegar

### Solução escalável: WebSocket + MutationObserver

1. Conectar via WebSocket (ou polling otimizado) diretamente na página do WhatsApp Web
2. Usar `page.exposeFunction` + MutationObserver para detecção em tempo real
3. Quando detectar nova mensagem:
   - Extrair nome + texto
   - Logar no terminal
   - Fazer HTTP POST para o Salesforce

**Opção ainda melhor:** substituir polling DOM por monitoramento de novas entradas na lista de chats (não precisa de conversa ativa):

```javascript
async function startRealtimeMonitor() {
  await page.exposeFunction('__onNewChat', (name, text, phone) => {
    logger.info(`📨 ${name}: ${text.substring(0, 120)}`);
    // Chamar Salesforce REST API
    notifySalesforce({ name, text, phone });
  });

  await page.evaluate(() => {
    // Observa a lista de chats por novas entradas com não-lidos
    const chatList = document.querySelector('div[data-testid="chat-list"]');
    if (!chatList) return;
    
    const observer = new MutationObserver(() => {
      const unread = document.querySelectorAll('[data-testid="icon-unread-count"]');
      unread.forEach(badge => {
        const chat = badge.closest('[data-testid="cell-frame-container"]');
        if (chat && !chat.dataset.seen) {
          chat.dataset.seen = 'true';
          const name = chat.querySelector('span[dir="auto"]')?.textContent || '?';
          const msg = chat.querySelector('[data-testid="last-msg"]')?.textContent || '(mídia)';
          window.__onNewChat(name, msg, '');
        }
      });
    });
    
    observer.observe(chatList, { childList: true, subtree: true });
  });
}
```

---

## Passo 3: No Salesforce

### 3.1 Remote Site Settings

Setup → Security → Remote Site Settings → **New Remote Site**

| Campo | Valor |
|-------|-------|
| Remote Site Name | `WhatsAppServer` |
| Remote Site URL | `https://seu-servidor.com` (ou `http://IP:3000` se for interno) |
| Disable Protocol Security | Desmarcado |

### 3.2 Classe Apex (já temos — `WhatsAppService.cls`)

A classe já está pronta no repositório. Fazer deploy para a org:

**Opções de deploy:**
- **Developer Console:** File → Open → WhatsAppService.cls
- **VS Code + SFDX:** `sfdx force:source:deploy -p force-app/main/default/classes/`
- **Workbench:** Migration → Deploy

### 3.3 Usar em Flow (recomendado)

1. Setup → Flows → **New Flow** → Record-Triggered Flow
2. Disparo: **Case** ou **Lead** após insert/update
3. Ação: **Invocable** → `WhatsAppService.sendFromFlow`
4. Passar os parâmetros:
   - `phoneNumber` → campo do telefone do contato
   - `message` → texto desejado

### 3.4 Endpoint REST para receber respostas

Criar um serviço REST no Salesforce para o servidor Node.js chamar quando chegar resposta do cliente:

```apex
@RestResource(urlMapping='/whatsapp/response/*')
global class WhatsAppResponseReceiver {
    @HttpPost
    global static void receive() {
        RestRequest req = RestContext.request;
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody);
        
        String phone = (String) body.get('phone');
        String message = (String) body.get('message');
        String contactName = (String) body.get('name');
        
        // Criar Task
        Task t = new Task(
            Subject = 'Resposta WhatsApp: ' + message.substring(0, 50),
            Description = message,
            Status = 'Completed',
            WhoId = findContactByPhone(phone)
        );
        insert t;
    }
}
```

### 3.5 Autenticação

Para o Salesforce chamar seu servidor:
- **Webhook secret** → já implementado (header `x-webhook-secret`)
- Para algo mais robusto → **JWT Bearer Token** entre os sistemas

Para seu servidor chamar o Salesforce:
- **OAuth2 Client Credentials** → gerar Access Token
- Ou **Session ID** se for na mesma org

---

## Passo 4: Expor o Servidor

### Local (testes)

```bash
npm install -g ngrok
ngrok http 3000
# → https://abc123.ngrok-free.app
```

Atualizar no Salesforce:
- Remote Site Settings → `https://abc123.ngrok-free.app`
- `WhatsAppService.cls` → SERVER_URL

### Produção (recomendado)

| Opção | Custo | Complexidade |
|-------|-------|-------------|
| VPS (DigitalOcean/Linode) | ~$6/mês | Média |
| AWS EC2 t2.micro | Grátis 1 ano | Alta |
| Railway/Render | ~$5/mês | Baixa |
| Docker em servidor próprio | ~$0 | Média |

**Container Docker:**
```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y chromium
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "index.js"]
```

---

## Passo 5: Tratamento de Falhas

### Problemas comuns e soluções

| Problema | Causa | Solução |
|----------|-------|---------|
| Chrome fecha sozinho | OOM (out of memory) | Limitar Chrome: `--max_old_space_size=512` |
| Sessão expirada | WhatsApp Web desloga | `userDataDir` corrompido? Deletar `.puppeteer_session/` e reconectar |
| Número inválido | Não está no WhatsApp | Validar antes: tentar abrir conversa, se erro, retornar |
| Erro de rede | Internet caiu | Auto-reconnect com backoff exponencial (já implementado) |
| Múltiplas instâncias | 2 processos com mesmo `userDataDir` | Usar diretórios diferentes por instância |

### Monitoramento

```javascript
// Endpoint de health check (GET /api/health)
{
  "status": "ok",
  "uptime": 3600,
  "whatsapp": { "connected": true, "number": "553492111561" },
  "queue": { "pending": 3, "failed_today": 1 },
  "memory": { "rss": "120MB", "heap": "45MB" }
}
```

---

## Resumo da Prioridade

| Passo | Descrição | Esforço | Impacto |
|-------|-----------|---------|---------|
| **1** | Envio sem page.goto (click) | 2h | Alto |
| **2** | Fila de mensagens | 1h | Alto |
| **3** | Remote Site Settings + Apex deploy | 30min | Crítico |
| **4** | Ngrok para testes | 10min | Crítico |
| **5** | REST endpoint no Salesforce | 2h | Alto |
| **6** | Recebimento via MutationObserver | 1h | Médio |
| **7** | Docker + deploy produção | 3h | Alto |
| **8** | Health check + monitoramento | 1h | Médio |

---

## Comparação: Node.js vs Python para Produção

| Critério | Node.js (atual) | Python + Playwright |
|----------|-----------------|---------------------|
| **Estabilidade** | Mesma — ambos controlam navegador | Mesma |
| **Performance** | Melhor: mesmo processo | Precisa subir subprocesso Python |
| **Manutenção** | Já está pronto | Precisa reescrever do zero |
| **Bibliotecas** | Puppeteer (maduro) | Astra Engine (beta) |
| **Equipe** | Seu time sabe JS? | Seu time sabe Python? |
| **Ecosystem** | npm gigante | PyPI gigante |

**Veredito:** Fique com Node.js. Só mude para Python se seu time for exclusivamente Python ou se o Puppeteer quebrar de um jeito que o Playwright resolva.
