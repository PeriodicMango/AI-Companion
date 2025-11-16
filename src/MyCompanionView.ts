// src/MyCompanionView.ts

import { ItemView, WorkspaceLeaf, setIcon, TFile } from 'obsidian';
import MyAiCompanionPlugin from './main'; // 导入主插件类

// 定义 View 的唯一标识符
export const VIEW_TYPE_COMPANION = 'ai-companion-view';

export class MyCompanionView extends ItemView {
    plugin: MyAiCompanionPlugin;
    chatDisplayArea!: HTMLElement; // 聊天消息显示区域
    inputEl!: HTMLInputElement; // 输入框

    constructor(leaf: WorkspaceLeaf, plugin: MyAiCompanionPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    // 设置视图的显示名称
    getViewType(): string {
        return VIEW_TYPE_COMPANION;
    }

    // 设置视图的显示名称和图标 (可选)
    getDisplayText(): string {
        return `${this.plugin.settings.companionName}`;
    }
    
    // 设置图标 (使用 Obsidian 内部图标)
    getIcon(): string {
        return 'message-circle'; // 可以选择一个合适的图标，例如 'bot' 或 'message-circle'
    }

    // 构建视图的 UI 界面
    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('companion-chat-view');

        // 视图布局：聊天显示区 + 输入区
        
        // 1. 聊天显示区
        this.chatDisplayArea = container.createDiv({ cls: 'chat-display-area' });
        
        // 初始问候
        this.displayMessage('👋 嗨！我是你的 AI 伙伴。开始跟我聊天吧！', this.plugin.settings.companionName, 'ai');
        
        // 2. 输入区
        const inputContainer = container.createDiv({ cls: 'chat-input-container' });
        
        this.inputEl = inputContainer.createEl('input', {
            type: 'text',
            placeholder: '输入消息...',
            cls: 'chat-input-box'
        });
        
        const sendButton = inputContainer.createEl('button', { text: '发送' });
        
        // 注册事件监听器
        sendButton.onclick = () => this.handleSendMessage();
        this.inputEl.addEventListener('keypress', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                this.handleSendMessage();
            }
        });
        
        // 初始加载历史记录
        this.loadChatHistory();
    }

    // 从插件中加载历史记录并显示
    loadChatHistory() {
        // 清空初始问候
        this.chatDisplayArea.empty(); 
        
        // 遍历 Content[] 历史记录并显示
        for (const message of this.plugin.chatHistory) {
            const sender = message.role === 'user' ? '我' : this.plugin.settings.companionName;
            const type = message.role === 'user' ? 'user' : 'ai';
            
            // 假设每个 Content 只有一个 Part 且是文本
            const text = message.parts?.[0]?.text ?? '';
            if (text) {
                this.displayMessage(text, sender, type);
            }
        }
    }

    // 统一的消息显示方法
    displayMessage(text: string, sender: string, type: 'user' | 'ai') {
        const messageDiv = this.chatDisplayArea.createDiv({ cls: `chat-message ${type}` });
        
        messageDiv.createEl('span', { cls: 'chat-sender', text: `${sender}:` });
        messageDiv.createEl('span', { cls: 'chat-text', text: text });
        
        // 自动滚动到底部
        this.chatDisplayArea.scrollTop = this.chatDisplayArea.scrollHeight;
    }

    // 处理发送按钮/Enter键点击事件
    async handleSendMessage() {
        const message = this.inputEl.value.trim();
        if (!message) return;

        if (!this.plugin.companionChat) {
            this.displayMessage('❌ 请在设置中输入 API Key！', '系统', 'ai');
            return;
        }

        // 1. 显示用户自己的消息
        this.displayMessage(message, '我', 'user');
        this.inputEl.value = ''; // 清空输入框
        
        // 2. 显示思考状态
        const loadingMessage = this.chatDisplayArea.createDiv({ cls: 'chat-message ai loading' });
        loadingMessage.createEl('span', { cls: 'chat-sender', text: `${this.plugin.settings.companionName}:` });
        loadingMessage.createEl('span', { cls: 'chat-text', text: '正在思考...' });

        try {
            // 3. 调用插件中的聊天发送方法
            const aiResponse = await this.plugin.sendChatMessage(message);
            
            // 4. 移除加载状态，并显示 AI 回复
            loadingMessage.remove(); 
            this.displayMessage(aiResponse, this.plugin.settings.companionName, 'ai');

        } catch (error) {
            console.error("聊天失败:", error);
            loadingMessage.remove();
            this.displayMessage('网络连接或 API 发生错误。', '系统', 'ai');
        }
    }

    // 视图关闭时的清理工作
    async onClose() {
        // 无需特殊清理
    }
}