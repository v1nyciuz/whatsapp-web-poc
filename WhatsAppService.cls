/**
 * SalesforceWhatsAppService.cls
 * 
 * Classe Apex para o Salesforce chamar o servidor Node.js local (ou hospedado).
 * 
 * SETUP NECESSÁRIO NO SALESFORCE:
 * 1. Setup > Remote Site Settings > Add: http://localhost:3000 (ou URL do servidor)
 * 2. Faça deploy desta classe via Developer Console ou VS Code + SFDX
 */
public class WhatsAppService {

    // URL do seu servidor Node.js — troque pelo IP/domínio em produção
    private static final String SERVER_URL = 'https://six-grapes-march.loca.lt';
    private static final String WEBHOOK_SECRET = 'SEU_WEBHOOK_SECRET';

    /**
     * Envia uma mensagem WhatsApp para um número.
     * @param phoneNumber  Número no formato 5534999998888
     * @param message      Texto da mensagem
     */
    @future(callout=true)
    public static void sendWhatsAppMessage(String phoneNumber, String message) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(SERVER_URL + '/api/send');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('x-webhook-secret', WEBHOOK_SECRET);

        Map<String, String> body = new Map<String, String>{
            'to' => phoneNumber,
            'message' => message
        };
        req.setBody(JSON.serialize(body));
        req.setTimeout(30000);

        Http http = new Http();
        try {
            HttpResponse res = http.send(req);
            if (res.getStatusCode() == 200) {
                System.debug('✅ Mensagem WhatsApp enviada para ' + phoneNumber);
            } else {
                System.debug('❌ Erro ao enviar: ' + res.getBody());
            }
        } catch (Exception e) {
            System.debug('❌ Exceção ao chamar servidor WhatsApp: ' + e.getMessage());
        }
    }

    /**
     * Exemplo: Enviar mensagem ao criar um Case
     * Coloque isso em um Trigger ou Flow (via Invocable Method)
     */
    @InvocableMethod(label='Enviar Mensagem WhatsApp'
                     description='Envia uma mensagem pelo WhatsApp para o número informado')
    public static void sendFromFlow(List<FlowInput> inputs) {
        for (FlowInput input : inputs) {
            sendWhatsAppMessage(input.phoneNumber, input.message);
        }
    }

    public class FlowInput {
        @InvocableVariable(label='Número de Telefone' required=true)
        public String phoneNumber;

        @InvocableVariable(label='Mensagem' required=true)
        public String message;
    }
}


/* ─────────────────────────────────────────────────────────────────────────────
   EXEMPLO DE TRIGGER — Envia WhatsApp quando um Case é criado
   ───────────────────────────────────────────────────────────────────────────── */
/*
trigger CaseWhatsAppNotification on Case (after insert) {
    for (Case c : Trigger.new) {
        if (c.SuppliedPhone != null) {
            String msg = 'Olá! Seu atendimento foi aberto com o número ' + c.CaseNumber
                       + '. Em breve nossa equipe entrará em contato!';
            WhatsAppService.sendWhatsAppMessage(c.SuppliedPhone, msg);
        }
    }
}
*/


/* ─────────────────────────────────────────────────────────────────────────────
   TESTE RÁPIDO — Cole no Developer Console > Execute Anonymous
   ───────────────────────────────────────────────────────────────────────────── */
/*
WhatsAppService.sendWhatsAppMessage('5534999998888', 'Teste de integração WhatsApp + Salesforce! 🚀');
*/
