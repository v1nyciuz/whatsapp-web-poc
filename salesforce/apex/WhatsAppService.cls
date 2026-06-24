/**
 * @description Callout para o middleware Node enviar mensagens WhatsApp
 * @group WhatsApp
 */
public with sharing class WhatsAppService {

    // URL do middleware — via Named Credential ou Remote Site Setting
    private static final String MIDDLEWARE_URL = '/whatsapp_middleware';

    /**
     * Envia mensagem WhatsApp via callout para o middleware Node
     * @param phoneNumber número no formato internacional (ex: 5534999998888)
     * @param message texto da mensagem
     * @return WhatsAppSendResponse com success + messageId
     */
    @Future(callout=true)
    public static void sendWhatsAppMessage(String phoneNumber, String message) {
        try {
            String result = doCallout(MIDDLEWARE_URL + '/api/send', phoneNumber, message);
            System.debug('WhatsApp send result: ' + result);
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'WhatsApp send error: ' + e.getMessage());
        }
    }

    /**
     * Versão síncrona — para uso em Queueable/Batchable
     */
    public static WhatsAppSendResponse sendWhatsAppMessageSync(String phoneNumber, String message) {
        Http http = new Http();
        HttpRequest request = new HttpRequest();

        String baseUrl = getBaseUrl();
        String secret = getWebhookSecret();

        request.setEndpoint(baseUrl + '/api/send');
        request.setMethod('POST');
        request.setHeader('Content-Type', 'application/json');
        if (String.isNotBlank(secret)) {
            request.setHeader('x-webhook-secret', secret);
        }

        Map<String, Object> body = new Map<String, Object>{
            'to' => phoneNumber,
            'message' => message
        };
        request.setBody(JSON.serialize(body));
        request.setTimeout(30000);

        HttpResponse response = http.send(request);

        if (response.getStatusCode() == 200) {
            return (WhatsAppSendResponse) JSON.deserialize(
                response.getBody(),
                WhatsAppSendResponse.class
            );
        } else {
            throw new CalloutException(
                'WhatsApp middleware error: ' + response.getStatusCode() + ' - ' + response.getBody()
            );
        }
    }

    private static String doCallout(String endpoint, String phone, String message) {
        Http http = new Http();
        HttpRequest request = new HttpRequest();

        request.setEndpoint(getBaseUrl() + endpoint);
        request.setMethod('POST');
        request.setHeader('Content-Type', 'application/json');

        String secret = getWebhookSecret();
        if (String.isNotBlank(secret)) {
            request.setHeader('x-webhook-secret', secret);
        }

        Map<String, Object> body = new Map<String, Object>{
            'to' => phone,
            'message' => message
        };
        request.setBody(JSON.serialize(body));
        request.setTimeout(30000);

        HttpResponse response = http.send(request);
        return response.getBody();
    }

    private static String getBaseUrl() {
        // Se usando Named Credential, retorna callout:NamedCredential
        // Caso contrário, lê de Custom Setting ou hardcode para POC
        String url = System.Label.WhatsApp_Middleware_URL;
        if (String.isBlank(url)) {
            url = 'https://SEU-NGROK-URL.ngrok-free.app';
        }
        return url;
    }

    private static String getWebhookSecret() {
        String secret = System.Label.WhatsApp_Webhook_Secret;
        return secret != null ? secret : '';
    }

    public class WhatsAppSendResponse {
        @AuraEnabled public Boolean success { get; set; }
        @AuraEnabled public String to { get; set; }
        @AuraEnabled public String messageId { get; set; }
        @AuraEnabled public String message { get; set; }
    }
}
