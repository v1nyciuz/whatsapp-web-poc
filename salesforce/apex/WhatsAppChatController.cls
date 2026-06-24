/**
 * @description Controller para o LWC whatsappChat — busca conversas, mensagens e envia
 * @group WhatsApp
 */
public with sharing class WhatsAppChatController {

    /**
     * Busca todas as conversas ordenadas por última atividade
     */
    @AuraEnabled(cacheable=true)
    public static List<WhatsApp_Conversation__c> getConversations() {
        return [
            SELECT Id, Phone__c, Contact_Name__c, Last_Message__c,
                   Last_Activity__c, Unread__c
            FROM WhatsApp_Conversation__c
            ORDER BY Last_Activity__c DESC NULLS LAST
            LIMIT 50
        ];
    }

    /**
     * Busca mensagens de uma conversa específica
     */
    @AuraEnabled(cacheable=true)
    public static List<WhatsApp_Message__c> getMessages(String conversationId) {
        return [
            SELECT Id, Direction__c, Body__c, Timestamp__c, Status__c,
                   WhatsApp_Msg_Id__c
            FROM WhatsApp_Message__c
            WHERE Conversation__c = :conversationId
            ORDER BY Timestamp__c ASC
            LIMIT 100
        ];
    }

    /**
     * Envia mensagem via callout para o middleware Node
     */
    @AuraEnabled
    public static WhatsAppService.WhatsAppSendResponse sendMessage(String phone, String message) {
        return WhatsAppService.sendWhatsAppMessageSync(phone, message);
    }

    /**
     * Marca conversa como lida (zera Unread__c)
     */
    @AuraEnabled
    public static void markAsRead(String conversationId) {
        try {
            WhatsApp_Conversation__c conv = new WhatsApp_Conversation__c(
                Id = conversationId,
                Unread__c = 0
            );
            update conv;
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'markAsRead error: ' + e.getMessage());
        }
    }
}
