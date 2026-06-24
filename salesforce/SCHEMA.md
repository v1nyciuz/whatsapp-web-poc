# Salesforce — Setup Necessário para a POC

> Estes são os artefatos que precisam ser criados na sua org Salesforce.
> O middleware Node já está pronto para consumir estes objetos. Crie nesta ordem.

## 1. Objetos Customizados

### WhatsApp_Conversation__c
| Campo | Type | Details |
|-------|------|---------|
| Phone__c | Text(20) | **Unique**, External ID, Required |
| Contact_Name__c | Text(80) | Nome do contato no WhatsApp |
| Contact__c | Lookup(Contact) | Vinculo opcional com Contact padrão |
| Last_Message__c | Text(255) | Prévia da última mensagem |
| Last_Activity__c | DateTime | Timestamp da última atividade |
| Unread__c | Number(2,0) | Default 0 — contador de não lidas |

### WhatsApp_Message__c
| Campo | Type | Details |
|-------|------|---------|
| Conversation__c | Master-Detail(WhatsApp_Conversation__c) | Required |
| Direction__c | Picklist | Values: `Inbound`, `Outbound` |
| Body__c | Long Text Area(4096) | Conteúdo da mensagem |
| WhatsApp_Msg_Id__c | Text(100) | **Unique**, External ID — dedup |
| Timestamp__c | DateTime | Quando a mensagem foi enviada/recebida |
| Status__c | Picklist | Values: `Received`, `Pending`, `Sent`, `Delivered`, `Read`, `Failed` |

### WhatsApp_Message__e (Platform Event — opcional, para tempo real)
| Campo | Type | Details |
|-------|------|---------|
| ConversationId__c | Text(18) | Id da Conversation |
| Direction__c | Text(10) | Inbound/Outbound |
| Body__c | Text(300) | Prévia do corpo |
| Phone__c | Text(20) | Número do contato |

## 2. Remote Site Setting ou Named Credential

O Salesforce precisa de permissão para chamar o middleware Node:

### Opção A — Remote Site Setting (mais simples)
- Setup > Remote Site Settings > New
- Name: `WhatsApp_Middleware`
- Remote Site URL: `https://SEU-NGROK-URL.ngrok-free.app`

### Opção B — Named Credential (recomendado)
- Setup > Named Credentials > New
- Name: `WhatsApp_Middleware`
- URL: `https://SEU-NGROK-URL.ngrok-free.app`
- Identity Type: Named Principal
- Authentication Protocol: No Authentication
- Header: `x-webhook-secret` = valor do WEBHOOK_SECRET do .env

## 3. Apex Class

Veja `apex/WhatsAppService.cls` — faz callout para o middleware.

## 4. LWC Component

Veja `lwc/whatsappChat/` — interface de chat simples com polling.

## 5. Passo a passo

1. Criar objetos customizados (WhatsApp_Conversation__c + WhatsApp_Message__c)
2. (Opc.) Criar Platform Event WhatsApp_Message__e
3. Subir middleware Node + ngrok: `npm start` + `ngrok http 3000`
4. Configurar Remote Site Setting / Named Credential com a URL do ngrok
5. Deploy da Apex class (WhatsAppService)
6. Deploy do LWC (whatsappChat)
7. Adicionar LWC a uma record page (Contact/Case) ou App Builder tab
8. Setar `SF_DISABLED=false` no .env do Node (para começar a persistir)
