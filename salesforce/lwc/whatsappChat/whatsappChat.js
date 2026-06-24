import { LightningElement, track, wire, api } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import getConversations from '@salesforce/apex/WhatsAppChatController.getConversations';
import getMessages from '@salesforce/apex/WhatsAppChatController.getMessages';
import sendMessage from '@salesforce/apex/WhatsAppChatController.sendMessage';
import markAsRead from '@salesforce/apex/WhatsAppChatController.markAsRead';

export default class WhatsappChat extends LightningElement {
    @api recordId;

    @track conversations = [];
    @track messages = [];
    @track selectedConversationId = null;
    @track selectedPhone = null;
    @track inputMessage = '';
    @track loading = false;
    @track sending = false;
    @track error = null;

    wiredConversationsResult;
    wiredMessagesResult;
    pollInterval;

    // ── Carrega lista de conversas ──────────────────────────────────────────
    @wire(getConversations)
    wiredConversations(result) {
        this.wiredConversationsResult = result;
        if (result.data) {
            this.conversations = result.data.map((c) => ({
                id: c.Id,
                phone: c.Phone__c,
                name: c.Contact_Name__c || c.Phone__c,
                lastMessage: c.Last_Message__c || '',
                lastActivity: c.Last_Activity__c,
                unread: c.Unread__c || 0,
                hasUnread: (c.Unread__c || 0) > 0,
            }));
            // Seleciona a primeira se nenhuma selecionada
            if (!this.selectedConversationId && this.conversations.length > 0) {
                this.selectConversation(this.conversations[0]);
            }
        } else if (result.error) {
            this.error = result.error.body?.message || 'Erro ao carregar conversas';
        }
    }

    // ── Carrega mensagens da conversa selecionada ───────────────────────────
    @wire(getMessages, { conversationId: '$selectedConversationId' })
    wiredMessages(result) {
        this.wiredMessagesResult = result;
        if (result.data) {
            this.messages = result.data.map((m) => ({
                id: m.Id,
                direction: m.Direction__c,
                body: m.Body__c,
                timestamp: m.Timestamp__c,
                status: m.Status__c,
                isInbound: m.Direction__c === 'Inbound',
                isOutbound: m.Direction__c === 'Outbound',
                time: this.formatTime(m.Timestamp__c),
            }));
            this.scrollToBottom();
        } else if (result.error) {
            this.error = result.error.body?.message;
        }
    }

    // ── Polling a cada 4s para atualizar mensagens ──────────────────────────
    connectedCallback() {
        this.pollInterval = setInterval(() => {
            if (this.selectedConversationId) {
                refreshApex(this.wiredMessagesResult);
                refreshApex(this.wiredConversationsResult);
            }
        }, 4000);
    }

    disconnectedCallback() {
        if (this.pollInterval) clearInterval(this.pollInterval);
    }

    // ── Seleciona conversa na lista ─────────────────────────────────────────
    selectConversation(conv) {
        this.selectedConversationId = conv.id;
        this.selectedPhone = conv.phone;
        if (conv.hasUnread) {
            markAsRead({ conversationId: conv.id }).catch(() => {});
        }
    }

    handleConversationClick(event) {
        const id = event.currentTarget.dataset.id;
        const conv = this.conversations.find((c) => c.id === id);
        if (conv) this.selectConversation(conv);
    }

    // ── Input e envio de mensagem ───────────────────────────────────────────
    handleInputChange(event) {
        this.inputMessage = event.target.value;
    }

    async handleSend() {
        if (!this.inputMessage.trim() || !this.selectedPhone) return;

        this.sending = true;
        this.error = null;

        try {
            await sendMessage({
                phone: this.selectedPhone,
                message: this.inputMessage.trim(),
            });
            this.inputMessage = '';
            await refreshApex(this.wiredMessagesResult);
            await refreshApex(this.wiredConversationsResult);
        } catch (err) {
            this.error = err.body?.message || 'Erro ao enviar mensagem';
        } finally {
            this.sending = false;
        }
    }

    handleKeyDown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.handleSend();
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────
    formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    scrollToBottom() {
        setTimeout(() => {
            const container = this.template.querySelector('.chat-messages');
            if (container) container.scrollTop = container.scrollHeight;
        }, 100);
    }

    get hasConversations() {
        return this.conversations.length > 0;
    }

    get hasMessages() {
        return this.messages.length > 0;
    }

    get selectedConversationName() {
        const conv = this.conversations.find((c) => c.id === this.selectedConversationId);
        return conv ? conv.name : '';
    }
}
