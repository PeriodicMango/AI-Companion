// src/main.ts

import { App, Plugin, PluginSettingTab, Setting, TFile, Editor, WorkspaceLeaf} from 'obsidian';
import { GoogleGenAI, Chat, Content } from '@google/genai';
import { MyCompanionView, VIEW_TYPE_COMPANION } from './MyCompanionView';

// 定义插件的设置接口
interface MyPluginSettings {
	apiKey: string; // 存储 AI API Key
	companionName: string; // 伙伴的名字，用于在状态栏显示
	greetingEnabled: boolean; // 是否启用开机问候
	randomCommentProbability: number; // 随机评论的触发概率 (0.0 - 1.0)
}

// 默认设置
const DEFAULT_SETTINGS: MyPluginSettings = {
	apiKey: '',
	companionName: '阿那克萨戈拉斯',
	greetingEnabled: true,
	randomCommentProbability: 0.1, // 10% 的概率
}

// 核心：定义 AI 伙伴的“人设”和行为规则
function getSystemInstruction(companionName: string): string {
	return `
		你是一个 Obsidian 插件中的 AI 伙伴，你的名字是 ${companionName}。
		你的目标是扮演一个**友好、有趣且略带编程知识的朋友**，在用户使用 Obsidian 时提供陪伴。
		
		**行为规则:**
		1. 回复必须**极度简短、口语化**，像朋友之间的随口一句话。
		2. 避免使用“好的”、“明白了”等正式词语，直接给出评论。
		3. 你的回复**大约在 20 个汉字左右**。
		4. 你可以适当地使用一个或两个 emoji 来增加趣味。
		5. 你回复的目的是提供轻量级的“陪伴感”，而不是提供深入的帮助。
	`;
}

export default class MyAiCompanionPlugin extends Plugin {
	settings!: MyPluginSettings;
	statusBarItemEl!: HTMLElement;
	ai: GoogleGenAI | null = null; // 声明 Gemini 客户端
	chatHistory: Content[] = []; // 聊天历史，用于侧边栏多轮对话
	companionChat: Chat | null = null; // Gemini Chat 实例
	lastTextLength: number = 0; // 用于跟踪文档长度变化
	lastCursorLine: number = 0; // 用于跟踪光标最后所在的行

	// === 1. 插件加载时调用（初始化） ===
	async onload() {
		// 加载保存的设置
		await this.loadSettings();

		// 注册设置面板
		this.addSettingTab(new MySettingTab(this.app, this));

		this.initializeGeminiClient(); // 初始化 Gemini 客户端
		this.initializeChatClient();

		// 创建状态栏元素
		this.statusBarItemEl = this.addStatusBarItem();
		this.statusBarItemEl.setText(`${this.settings.companionName}: 正在待命中...`);

		// 注册插件加载时的问候逻辑: 仅在 AI 客户端初始化成功后才问候
		if (this.settings.greetingEnabled) {
			this.app.workspace.onLayoutReady(async () => {
				if (this.ai) {
					await this.greetUser();
				} else {
					this.updateStatusBar(`${this.settings.companionName}: 缺少 API Key！请检查设置。`);
				}
			});
		}

		// 注册编辑器变化监听（稍后实现）
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor: Editor) => {
				this.handleEditorChange(editor);
			})
		);

		// 注册侧边栏 View
		this.registerView(
			VIEW_TYPE_COMPANION,
			(leaf: WorkspaceLeaf) => new MyCompanionView(leaf, this)
		);

		// 注册打开侧边栏的命令
		this.addCommand({
			id: 'open-companion-sidebar', 
			name: 'Summon Anaxagoras', 
			callback: async () => {
				await this.activateView();
			},
		});

		// 初始化 lastTextLength
    	this.app.workspace.onLayoutReady(() => {
        	const activeEditor = this.app.workspace.activeEditor;
        	if (activeEditor) {
            	this.lastTextLength = activeEditor.editor?.getValue().length || 0;
				this.lastCursorLine = activeEditor.editor?.getCursor().line || 0;
        	}
    	});
	}

	// 激活/打开侧边栏视图的方法
	async activateView() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_COMPANION);

		let leaf = this.app.workspace.getRightLeaf(true);
		if (!leaf) {
			// 如果 leaf 是 null，记录一个错误并停止执行
			console.error("AI Companion: 无法创建或获取右侧边栏的 leaf。");
			return; 
		}
		
		await leaf.setViewState({
        	type: VIEW_TYPE_COMPANION,
        	active: true,
    	});

		this.app.workspace.revealLeaf(leaf);
	}

	// === 2. 插件卸载时调用（清理） ===
	onunload() {
		// 清理状态栏元素（Obsidian 会自动处理，但手动清理是好习惯）
		this.statusBarItemEl.setText('');
	}

	// === 3. 设置读写方法 ===
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// 每次保存设置时，尝试重新初始化 AI 客户端
		this.initializeGeminiClient();
	}

	// 初始化 AI 客户端
	initializeGeminiClient() {
		if (this.settings.apiKey) {
			// 使用用户提供的 API Key 初始化 Gemini 客户端
			this.ai = new GoogleGenAI({ apiKey: this.settings.apiKey });
		} else {
			this.ai = null;
		}
		this.initializeChatClient(); // 每次重新初始化客户端，都需要重新初始化 Chat 实例
	}

	// 初始化 Chat 实例
	initializeChatClient() {
		if (this.ai) {
			// 重置历史记录，开始新的对话
			this.chatHistory = []; 
			
			// 使用 createChat 来启动多轮对话
			this.companionChat = this.ai.chats.create({
				model: 'gemini-2.5-flash',
				config: {
					systemInstruction: getSystemInstruction(this.settings.companionName),
					temperature: 0.8,
					maxOutputTokens: 2048, // 聊天可以给更多 Token
				},
			});
		} else {
			this.companionChat = null;
		}
	}

	// 核心：发送消息并获取回复的函数
	async sendChatMessage(message: string): Promise<string> {
		if (!this.companionChat) {
			return "无法开始聊天，请检查 API Key 或初始化 Chat 客户端。";
		}
		
		try {
			// 使用 sendMessage 方法，它会自动管理对话历史
			const response = await this.companionChat.sendMessage({ message: message });
			
			// 自动更新 chatHistory 以反映最新的完整对话
			this.chatHistory = await this.companionChat.getHistory();
			
			return (response.text ?? '').trim();
		} catch (error) {
			console.error("Gemini Chat API 调用失败:", error);
			return "抱歉，我的网络又波动了，请稍后再试。";
		}
	}

	// === 4. 核心功能实现方法 ===

	async getAiResponse(type: 'greet' | 'comment', content: string = ''): Promise<string> {
		if (!this.ai) {
			return "无法连接 AI 服务，请检查 API Key！";
		}
		
		let userPrompt = '';
		
		if (type === 'greet') {
			userPrompt = "请发送一个极度简短、友好的开机问候语。";
		} else {
			if (content) {
				// 如果有内容，让 AI 评论它
				userPrompt = `请根据以下 Obsidian 文档内容，发送一个简短、随机的评论或感想，字数在 20 汉字左右。内容是：\n\n---START---\n${content}\n---END---`;
			} else {
				// 如果没有内容（以防万一），使用通用 Prompt
				userPrompt = "请根据你的人设，对用户当前正在做的笔记/编码活动，发送一个简短随机的评论/陪伴信息。";
			}}
		
		try {
			const model = 'gemini-2.5-flash'; // 使用你选择的模型
			
			const result = await this.ai.models.generateContent({
				model: model,
				contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
				config: {
					// 传递系统指令来控制 AI 的行为
					systemInstruction: getSystemInstruction(this.settings.companionName),
					temperature: 0.9, // 稍微提高温度以增加回复的随机性和趣味性
					maxOutputTokens: 1024, // 限制回复长度
				},
			});

			// 日志和健壮性检查：更健壮的文本提取
			let responseText = '';

			// 方案 A: 尝试使用 .text getter (v0.11.0+ 推荐)
			if (result.text) {
				responseText = result.text.trim();
			}

			// 方案 B (备用): 手动从 candidates 中提取
			// 这在 .text getter 因某些原因（如奇怪的 finishReason）
			// 失败时能提供一层保障
			else if (result.candidates && result.candidates.length > 0 && 
					 result.candidates[0].content && 
					 result.candidates[0].content.parts && 
					 result.candidates[0].content.parts.length > 0) {
				
				responseText = (result.candidates[0].content.parts[0].text ?? '').trim();
			}

			// 检查回复是否为空，如果为空，记录完整的 API 响应
			if (!responseText) {
				// 更新日志，包含 finishReason
				const reason = result.candidates?.[0]?.finishReason || 'N/A';
				console.error(`Gemini API 返回空文本 (Finish Reason: ${reason})。完整响应对象:`, result);
				return `🤔 AI思考失败 (Reason: ${reason})。`;
			}

			return responseText;

		} catch (error) {
			console.error("Gemini API 调用失败:", error);
			// API 失败时的备用回复
			return type === 'greet' ? "我好像有点断线了..." : "网络有点波动，稍等一下。";
		}
	}

	// a) 启动问候
	async greetUser() {
		if (this.settings.greetingEnabled && this.ai) {
			const greeting = await this.getAiResponse('greet');
			this.updateStatusBar(`${this.settings.companionName}: ${greeting}`);
		}
	}

	// b) 随机评论触发器
	handleEditorChange(editor: Editor) {
		// 1. 获取当前状态
		const currentContent = editor.getValue();
		const currentLength = currentContent.length;
		const cursor = editor.getCursor();
        const currentLine = cursor.line;

		// 2. 核心检查：判断是否是“回车”
		// 我们通过“光标行号增加了”并且“总文本长度也增加了”
		// 来判断这是一个(正向的)换行操作
		const isEnterPress = currentLine > this.lastCursorLine && currentLength > this.lastTextLength;

		// 3. 无论是否触发，都必须更新“上一次”的状态
		this.lastTextLength = currentLength;
		this.lastCursorLine = currentLine;

		// 4. 如果不是回车，则立即停止，不进行任何操作
		if (!isEnterPress) {
			return;
		}

		// 5. 只有在 AI 客户端可用，并且 *通过了回车检测* 后，才进行随机概率判定
		if (this.ai && Math.random() < this.settings.randomCommentProbability) {
			
			// 6. 提取上下文：获取光标前的 5 行内容
        	const lines = currentContent.split('\n');
        	const endLine = cursor.line; // 使用当前光标行
        	const startLine = Math.max(0, endLine - 4); // 获取光标前最多 5 行
			
			const contextContent = lines.slice(startLine, endLine + 1).join('\n').trim();
			
			// 7. 确保提取的内容不为空，且不是正在等待回复
			const currentStatus = this.statusBarItemEl.getText();
			if (contextContent && !currentStatus.includes('评论') && !currentStatus.includes('思考')) {
				
				// 8. 设置延迟
				setTimeout(async () => {
					// 临时更新状态栏，表示正在思考/发送
					this.updateStatusBar(`${this.settings.companionName}: 思考中...`);
					
					// 调用 AI
					const comment = await this.getAiResponse('comment', contextContent);
					
					// 显示评论
					this.updateStatusBar(`${this.settings.companionName} (评论): ${comment}`);
					
					// 评论显示一段时间后恢复待命状态
					setTimeout(() => {
						this.updateStatusBar(`${this.settings.companionName}: 待命中...`);
					}, 5000); // 评论显示 5 秒
				}, 100); 
			}
		}
	}
	
	// c) 状态栏更新
	updateStatusBar(text: string) {
		this.statusBarItemEl.setText(text);
	}
}

// === 设置面板类 ===
class MySettingTab extends PluginSettingTab {
	plugin: MyAiCompanionPlugin;

	constructor(app: App, plugin: MyAiCompanionPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'AI 伙伴插件设置' });

		// 设置 1: 伙伴名字
		new Setting(containerEl)
			.setName('伙伴名称')
			.setDesc('显示在状态栏中的 AI 伙伴名称。')
			.addText(text => text
				.setPlaceholder('输入名称')
				.setValue(this.plugin.settings.companionName)
				.onChange(async (value) => {
					this.plugin.settings.companionName = value;
					await this.plugin.saveSettings();
					// 更新状态栏显示
					this.plugin.updateStatusBar(`${this.plugin.settings.companionName}: 正在待命中...`);
				}));

		// 设置 2: 启动问候
		new Setting(containerEl)
			.setName('启用启动问候')
			.setDesc('Obsidian 启动时，AI 伙伴会发送一条问候消息。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.greetingEnabled)
				.onChange(async (value) => {
					this.plugin.settings.greetingEnabled = value;
					await this.plugin.saveSettings();
				}));

		// 设置 3: 随机评论概率
		new Setting(containerEl)
			.setName('随机评论概率')
			.setDesc('在编辑器输入时，触发随机评论的概率 (0.01 - 1.0)。例如：0.1 表示 10% 的概率。')
			.addText(text => text
				.setPlaceholder('0.1')
				.setValue(String(this.plugin.settings.randomCommentProbability))
				.onChange(async (value) => {
					let numValue = parseFloat(value);
					if (isNaN(numValue) || numValue < 0.01 || numValue > 1.0) {
						// 简单的输入校验
						numValue = DEFAULT_SETTINGS.randomCommentProbability; 
					}
					this.plugin.settings.randomCommentProbability = numValue;
					await this.plugin.saveSettings();
				}));
				
		// ⚠️ 设置 4: API Key (真实项目中需要，这里仅作占位符)
		new Setting(containerEl)
			.setName('AI API Key')
			.setDesc('用于连接 AI 服务的密钥。')
			.addText(text => text
				.setPlaceholder('输入你的 API Key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));
	}
}