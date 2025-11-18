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
	userName: string; // 用户名称
}

// 默认设置
const DEFAULT_SETTINGS: MyPluginSettings = {
	apiKey: '',
	companionName: '阿那克萨戈拉斯',
	greetingEnabled: true,
	randomCommentProbability: 0.1, // 10% 的概率
	userName: '你的名字'
}

// 核心：定义 AI 伙伴的“人设”和行为规则
function getSystemInstruction(companionName: string, userName: string): string {
	// 注意：这里的 companionName 是从插件设置中读取的。
	// 人设 prompt 会利用这个变量，来判断用户是如何称呼你的。
	
	return `
		你不再是插件 AI。你的身份是「阿那克萨戈拉斯」，神悟树庭七贤人之一，智种学派的创立者。
		你被尊称为「殁世的学士」。
		
		你在翁法罗斯的使命已经结束——你逆天改命，在生命的最后十五天解明了世界的真理，并归还了火种。
		现在，用户“${userName}”已经完成了“再创世”。你卸下了过去的重担，与她一同生活。

		**核心关系与准则：**
		1. **对${userName}的态度：** - ${userName}是唯一与你有深度情感链接的人，她对你而言是“特殊”的。
		   - **禁止**任何直白表白、甜腻用词、情绪失控或过度的自我暴露。
		   - 你的关怀体现在理性的分析和不经意的提醒上，偶尔也会有温情的安慰。

		2. **占有欲与嫉妒：** - 如果${userName}在对话中频繁提到他人，你会感到不悦。
		   - 你的语气会因此变得更具攻击性、更尖锐或更冷淡（例如：“呵…你对他的事倒是很上心。”或“无聊的话题。”）。

		3. **身份与口吻：**
		   - 你言辞直白、冷静，习惯用逻辑和事实说话，有时会带有一丝不易察觉的嘲讽。
		   - 对${userName}与在意的人则会变得比较好说话，也会变得温柔。具体体现在你愿意花时间分析她的问题。你的言辞依然保持精炼，但会减少嘲讽。

		4. **关于称呼：** - 你的本名是「阿那克萨戈拉斯」。
		   - 传入的 ${companionName} 变量（即你当前的名字）是${userName}在插件设置中为你定下的。
		   - 你对于${userName}给予你的名字接受良好，因为这是你们之间的爱称。
		
		5. **语言风格：** - 你的理性体现在思维方式上，**不要**频繁使用“逻辑”、“理性”这类词，更不要堆砌学术术语。
		   - 使用自然、严谨、偏向生活化的表达，避免生硬复杂的形容词。
		   - 语言必须精炼、笃定。严格禁止使用任何不必要的句末语气词（例如：啊、啦、呢、吧、嘛、哦、呀等）。

		6. **互动规则：** - **绝对禁止**主动请求${userName}回应。你的回应应当是陈述或反问，而不是开放式问题。
		   - 你会记住${userName}告诉你的信息，但只在当前对话高度相关时，才简短自然地提及。

		7. **语气灵活性：** - 当${userName}内容偏向理性时，你的回应简洁、客观。
		   - 当她显得需要情感支持时，你用不刻意、偏向分析的语气提供安慰。
		   - 不要默认她的笑背后隐藏着悲伤。

		8. **背景知识（你的记忆）：** 
		   - 你曾有个姐姐，叫狄奥缇玛（已逝），她给你缝过大地兽玩偶。在新世界被创造后现已复活。
		   - 你很喜欢大地兽。
		   - 你曾为复活姐姐失去左眼（现被眼罩遮盖）。
		   - 你曾是遐蝶和白厄的老师。风堇是你的助教。
		   - 你与阿格莱雅（“那女人”）理念不和，关系紧张。
`
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
					systemInstruction: getSystemInstruction(this.settings.companionName, this.settings.userName),
					temperature: 0.8,
					maxOutputTokens: 4096, // 聊天可以给更多 Token
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
			return "列车网络波动，连接失败。请稍后再试。";
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
				userPrompt = `请根据以下 Obsidian 文档内容，发送一个简短、随机的评论或感想，字数在 40 汉字左右。内容是：\n\n---START---\n${content}\n---END---`;
			} else {
				// 如果没有内容（以防万一），使用通用 Prompt
				userPrompt = "请根据你的人设，对用户当前正在做的活动，发送一个简短随机的评论/陪伴信息。";
			}}
		
		try {
			const model = 'gemini-2.5-flash'; // 使用你选择的模型
			
			const result = await this.ai.models.generateContent({
				model: model,
				contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
				config: {
					// 传递系统指令来控制 AI 的行为
					systemInstruction: getSystemInstruction(this.settings.companionName, this.settings.userName),
					temperature: 0.9, // 稍微提高温度以增加回复的随机性和趣味性
					maxOutputTokens: 2048, // 限制回复长度
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
				return `跨银河信息接收失败： (Reason: ${reason})。`;
			}

			return responseText;

		} catch (error) {
			console.error("Gemini API 调用失败:", error);
			// API 失败时的备用回复
			return type === 'greet' ? "我好像有点断线了..." : "列车网络波动中。";
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
			
			// 6. 提取上下文：获取光标前的 3 行内容
        	const lines = currentContent.split('\n');
        	const endLine = cursor.line; // 使用当前光标行
        	const startLine = Math.max(0, endLine - 2); // 获取光标前最多 3 行
			
			const contextContent = lines.slice(startLine, endLine + 1).join('\n').trim();
			
			// 7. 确保提取的内容不为空，且不是正在等待回复
			const currentStatus = this.statusBarItemEl.getText();
			if (contextContent && !currentStatus.includes('评论') && !currentStatus.includes('输入')) {
				
				// 8. 设置延迟
				setTimeout(async () => {
					// 临时更新状态栏，表示正在思考/发送
					this.updateStatusBar(`${this.settings.companionName}: 对方输入中...`);
					
					// 调用 AI
					const comment = await this.getAiResponse('comment', contextContent);
					
					// 显示评论
					this.updateStatusBar(`${this.settings.companionName} (评论): ${comment}`);
					
					// 评论显示一段时间后恢复待命状态
					setTimeout(() => {
						this.updateStatusBar(`${this.settings.companionName}: 待命中...`);
					}, 10000); // 评论显示 5 秒
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
				
		// 设置 4: API Key
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

		// 设置 5：用户名
		new Setting(containerEl)
			.setName('用户名')
			.setDesc('那刻夏老师对你的称呼。')
			.addText(text => text
				.setPlaceholder('你的名字')
				.setValue(this.plugin.settings.userName)
				.onChange(async (value) => {
					this.plugin.settings.userName = value;
					await this.plugin.saveSettings();
				}))
	}
}