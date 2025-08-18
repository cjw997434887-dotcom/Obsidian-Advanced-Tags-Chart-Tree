// main.ts
// Obsidian 插件：Advanced Tags Chart Tree - main
// 说明：基于“基础版1.0”，恢复/优化动画预热、拖拽即插入（#tag 文本）、任意输入框/ contenteditable 支持、设置界面排版

import { App, ItemView, Plugin, WorkspaceLeaf, PluginSettingTab, Setting, TFile, MarkdownView } from "obsidian";

const VIEW_TYPE_TAG_TREE = "tag-tree-view";

interface TagNode {
  name: string;
  fullPath: string;
  count: number;
  children: Map<string, TagNode>;
  expanded: boolean;
  lastUsed?: number;
}

interface Settings {
  // 基础与动画设置（中文注释将显示在设置页）
  idleTimeout: number; // 进入空闲状态的无操作时长（毫秒）
  activeBarOpacity: number; // 活动状态下背景条的不透明度
  idleBarAlpha: number; // 空闲时背景条不透明度
  expandDuration: number; // 子列表高度展开/收起动画时长 (ms)
  expandEasing: string; // 高度动画缓动曲线
  maxBarWidth: number; // 背景条最大宽度（像素）
  barAnimationDuration: number; // 背景条整体动画时长（ms）
  barFadeDuration: number; // 背景条渐显/渐隐时长（ms）
  subTagIndent: number; // 子标签文本缩进距离（像素）
  sidePadding: number; // 面板左右内边距（像素）

  // 横向动画与分段控制（可单独设置）
  barExpandDuration: number;
  barCollapseDuration: number;
  barFadeInDuration: number;
  barFadeOutDuration: number;
  barPreheatExpandMs: number; // 展开预热时间（ms）
  barPreheatCollapseMs: number; // 收起预热时间（ms）

  // 色彩与呈现
  barColor0: string;
  barColor1: string;
  barColor2: string;
  barColor3: string;
  barCornerRadius: number;

  // 其他
  rightPadding: number;

  // 排序
  sortBy: "count" | "latest";
  sortOrder: "desc" | "asc";

  // 热更新 debounce 等
  metadataDebounceMs: number;
  frontmatterReadDelay: number;
}

const DEFAULT_SETTINGS: Settings = {
  idleTimeout: 8000,
  activeBarOpacity: 0.30,
  idleBarAlpha: 0.95,
  expandDuration: 320,
  expandEasing: "cubic-bezier(0.2,0.8,0.2,1)",
  maxBarWidth: 300,
  barAnimationDuration: 320,
  barFadeDuration: 200,
  subTagIndent: 12,
  sidePadding: 16,

  barExpandDuration: 260,
  barCollapseDuration: 220,
  barFadeInDuration: 160,
  barFadeOutDuration: 140,
  barPreheatExpandMs: 100,
  barPreheatCollapseMs: 80,

  barColor0: "#9BE9A8",
  barColor1: "#40C463",
  barColor2: "#30A14E",
  barColor3: "#216E39",
  barCornerRadius: 4,

  rightPadding: 12,

  sortBy: "count",
  sortOrder: "desc",

  metadataDebounceMs: 40,
  frontmatterReadDelay: 80,
};

export default class TagTreePlugin extends Plugin {
  settings: Settings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_TAG_TREE, (leaf: WorkspaceLeaf) => new TagTreeView(leaf, this.app, this.settings));

    this.addCommand({
      id: "open-tag-tree-view",
      name: "打开标签树状面板",
      callback: () => {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_TAG_TREE);
        let leaf = this.app.workspace.getRightLeaf(false);
        if (!leaf) leaf = this.app.workspace.getLeaf(true);
        leaf.setViewState({ type: VIEW_TYPE_TAG_TREE, active: true });
        this.app.workspace.revealLeaf(leaf);
      },
    });

    this.addSettingTab(new TagTreeSettingTab(this.app, this));

    // 插入样式
    const style = document.createElement("style");
    style.id = "tag-tree-plugin-style";
    style.textContent = `
      /* 面板主样式 */
      .tag-tree-view-container { transition: color 1s ease; color: inherit; background-color: transparent; height:100%; overflow:auto; box-sizing:border-box; font-size:13px; }
      .tag-tree-view-container.idle { color: transparent !important; }

      ul.tag-tree-ul { list-style:none; padding-left:0; margin:0; }
      li.tag-tree-li { position:relative; padding-left:18px; margin-bottom:6px; height:24px; line-height:24px; z-index:3; }

      .tag-tree-view-arrow { position:absolute; left:0; top:50%; transform:translateY(-50%); width:16px; cursor:pointer; z-index:6; transition: transform 220ms var(--easing); }
      .tag-tree-view-arrow svg { display:block; width:12px; height:12px; }
      .tag-tree-view-arrow.expanded { transform: translateY(-50%) rotate(90deg); }

      .tag-tree-view-flex-container { display:flex; justify-content:space-between; align-items:center; position:relative; z-index:7; color:inherit; user-select:text; height:24px; padding-left:0; }
      .tag-tree-name { cursor:pointer; user-select:none; }
      .tag-tree-count { flex:0 0 48px; text-align:right; color:var(--text-muted); padding-left:8px; }

      .tag-tree-bar-overlay { position:absolute; inset:0; pointer-events:none; z-index:1; }
      .tag-tree-view-bg-bar { position:absolute; height:24px; pointer-events:none; overflow:hidden; transform-origin:left center; }
      .tag-tree-view-bg-bar .bar-inner { position:absolute; left:0; right:0; top:0; bottom:0; transform-origin:left center; }

      ul.tag-tree-children { list-style:none; padding-left:0; margin-left:0; overflow:hidden; max-height:0; opacity:0; transition-property:max-height,opacity; }

      /* 设置页样式：更精简高级 */
      .tag-tree-settings-hr { height:1px; border:none; margin:12px 0; background-color: var(--interactive-accent, var(--accent)); opacity:0.12; }
      .tag-tree-settings-group-title { margin:6px 0 8px 0; font-weight:600; font-size:13px; color:var(--text-normal); }

      .tag-tree-dragging { opacity:0.85; }
    `;
    document.head.appendChild(style);
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TAG_TREE);
    const el = document.getElementById("tag-tree-plugin-style");
    if (el) el.remove();
  }

  async loadSettings() {
    const s = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, s || {});
  }
  async saveSettings() { await this.saveData(this.settings); }
}

/* 设置页（分组、中文注释） */
class TagTreeSettingTab extends PluginSettingTab {
  plugin: TagTreePlugin;
  constructor(app: App, plugin: TagTreePlugin) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl("h2", { text: "Advanced Tags - 设置", cls: "tag-tree-settings-title" });

    // 热更新设置组
    containerEl.createEl("div", { text: "热更新 (Hot update)", cls: "tag-tree-settings-group-title" });
    new Setting(containerEl).setName("Metadata debounce (ms)").setDesc("处理 metadata 变更时的防抖时间，越低响应越快但 CPU 占用可能上升（默认 40ms）")
      .addText(t => t.setValue(String(this.plugin.settings.metadataDebounceMs)).onChange(async v => { this.plugin.settings.metadataDebounceMs = Number(v) || DEFAULT_SETTINGS.metadataDebounceMs; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Frontmatter read delay (ms)").setDesc("当缓存缺失 frontmatter 时，读取文件内容解析 frontmatter 的延迟（默认 80ms）")
      .addText(t => t.setValue(String(this.plugin.settings.frontmatterReadDelay)).onChange(async v => { this.plugin.settings.frontmatterReadDelay = Number(v) || DEFAULT_SETTINGS.frontmatterReadDelay; await this.plugin.saveSettings(); }));

    containerEl.createEl("hr", { cls: "tag-tree-settings-hr" });

    // 动画设置组
    containerEl.createEl("div", { text: "动画 (Animation)", cls: "tag-tree-settings-group-title" });
    new Setting(containerEl).setName("Slide duration (ms)").setDesc("展开/收起子列表的高度动画时长")
      .addText(t => t.setValue(String(this.plugin.settings.expandDuration)).onChange(async v => { this.plugin.settings.expandDuration = Number(v) || DEFAULT_SETTINGS.expandDuration; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Slide easing").setDesc("高度动画缓动曲线 (CSS)")
      .addText(t => t.setValue(this.plugin.settings.expandEasing).onChange(async v => { this.plugin.settings.expandEasing = v || DEFAULT_SETTINGS.expandEasing; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Bar expand (ms)").setDesc("背景条横向伸展时间")
      .addText(t => t.setValue(String(this.plugin.settings.barExpandDuration)).onChange(async v => { this.plugin.settings.barExpandDuration = Number(v) || DEFAULT_SETTINGS.barExpandDuration; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Bar collapse (ms)").setDesc("背景条横向收缩时间")
      .addText(t => t.setValue(String(this.plugin.settings.barCollapseDuration)).onChange(async v => { this.plugin.settings.barCollapseDuration = Number(v) || DEFAULT_SETTINGS.barCollapseDuration; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Bar preheat expand (ms)").setDesc("展开时背景条预热时间（会让条在高度动画前准备就绪）")
      .addText(t => t.setValue(String(this.plugin.settings.barPreheatExpandMs)).onChange(async v => { this.plugin.settings.barPreheatExpandMs = Number(v) || DEFAULT_SETTINGS.barPreheatExpandMs; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Bar preheat collapse (ms)").setDesc("收起时背景条预热时间（收缩先于高度折叠）")
      .addText(t => t.setValue(String(this.plugin.settings.barPreheatCollapseMs)).onChange(async v => { this.plugin.settings.barPreheatCollapseMs = Number(v) || DEFAULT_SETTINGS.barPreheatCollapseMs; await this.plugin.saveSettings(); }));

    containerEl.createEl("hr", { cls: "tag-tree-settings-hr" });

    // 布局设置组
    containerEl.createEl("div", { text: "面板布局 (Layout)", cls: "tag-tree-settings-group-title" });
    new Setting(containerEl).setName("Side padding (px)").setDesc("插件内容距离左右容器边缘的距离")
      .addText(t => t.setValue(String(this.plugin.settings.sidePadding)).onChange(async v => { this.plugin.settings.sidePadding = Number(v) || DEFAULT_SETTINGS.sidePadding; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Sub-tag indent (px)").setDesc("子标签文本相对于父标签的缩进距离（背景条保持与父对齐）")
      .addText(t => t.setValue(String(this.plugin.settings.subTagIndent)).onChange(async v => { this.plugin.settings.subTagIndent = Number(v) || DEFAULT_SETTINGS.subTagIndent; await this.plugin.saveSettings(); }));

    containerEl.createEl("hr", { cls: "tag-tree-settings-hr" });

    // 个性化（颜色等）
    containerEl.createEl("div", { text: "个性化 (Colors & Appearance)", cls: "tag-tree-settings-group-title" });
    try {
      new Setting(containerEl).setName("Color - lowest").addColorPicker(cb => cb.setValue(this.plugin.settings.barColor0).onChange(async v => { this.plugin.settings.barColor0 = v; await this.plugin.saveSettings(); }));
      new Setting(containerEl).setName("Color - low").addColorPicker(cb => cb.setValue(this.plugin.settings.barColor1).onChange(async v => { this.plugin.settings.barColor1 = v; await this.plugin.saveSettings(); }));
      new Setting(containerEl).setName("Color - mid").addColorPicker(cb => cb.setValue(this.plugin.settings.barColor2).onChange(async v => { this.plugin.settings.barColor2 = v; await this.plugin.saveSettings(); }));
      new Setting(containerEl).setName("Color - high").addColorPicker(cb => cb.setValue(this.plugin.settings.barColor3).onChange(async v => { this.plugin.settings.barColor3 = v; await this.plugin.saveSettings(); }));
    } catch (e) {
      // 如果 addColorPicker 不可用，退回为文本输入
      new Setting(containerEl).setName("Color - lowest (hex)").addText(t => t.setValue(this.plugin.settings.barColor0).onChange(async v => { this.plugin.settings.barColor0 = v || DEFAULT_SETTINGS.barColor0; await this.plugin.saveSettings(); }));
      new Setting(containerEl).setName("Color - low (hex)").addText(t => t.setValue(this.plugin.settings.barColor1).onChange(async v => { this.plugin.settings.barColor1 = v || DEFAULT_SETTINGS.barColor1; await this.plugin.saveSettings(); }));
      new Setting(containerEl).setName("Color - mid (hex)").addText(t => t.setValue(this.plugin.settings.barColor2).onChange(async v => { this.plugin.settings.barColor2 = v || DEFAULT_SETTINGS.barColor2; await this.plugin.saveSettings(); }));
      new Setting(containerEl).setName("Color - high (hex)").addText(t => t.setValue(this.plugin.settings.barColor3).onChange(async v => { this.plugin.settings.barColor3 = v || DEFAULT_SETTINGS.barColor3; await this.plugin.saveSettings(); }));
    }
    new Setting(containerEl).setName("Bar corner radius (px)").addText(t => t.setValue(String(this.plugin.settings.barCornerRadius)).onChange(async v => { this.plugin.settings.barCornerRadius = Number(v) || DEFAULT_SETTINGS.barCornerRadius; await this.plugin.saveSettings(); }));

    containerEl.createEl("hr", { cls: "tag-tree-settings-hr" });

    // 排序设置
    containerEl.createEl("div", { text: "排序 (Sorting)", cls: "tag-tree-settings-group-title" });
    new Setting(containerEl).setName("Sort by").addDropdown(d => d.addOption("count", "Count").addOption("latest", "Latest").setValue(this.plugin.settings.sortBy).onChange(async v => { this.plugin.settings.sortBy = v as any; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Sort order").addDropdown(d => d.addOption("desc", "Descending").addOption("asc", "Ascending").setValue(this.plugin.settings.sortOrder).onChange(async v => { this.plugin.settings.sortOrder = v as any; await this.plugin.saveSettings(); }));
  }
}

/* ---------- 辅助工具函数 ---------- */
function escSelector(s: string) {
  // CSS.escape 兼容性处理
  // @ts-ignore
  if (typeof (window as any).CSS?.escape === "function") return (window as any).CSS.escape(s);
  return s.replace(/(["\\#.:?+*~\[\]()'`=!<>|\/@{}])/g, "\\$1");
}
function nextAnimationFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}
function hexToRgb(hex: string) {
  if (!hex) return { r: 64, g: 169, b: 99 };
  const h = hex.replace("#", "");
  const normalized = (h.length === 3) ? h.split("").map(c => c + c).join("") : h;
  const bigint = parseInt(normalized, 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}
const INLINE_TAG_RE = /(?:^|\s|[^\\\w-])#([\u4e00-\u9fff\w\/\-_]+)/g;

function parseFrontmatterTagsFromContent(content: string): string[] {
  const res: string[] = [];
  if (!content) return res;
  const fmMatch = content.match(/^---\s*[\r\n]([\s\S]*?)\r?\n---/);
  if (!fmMatch) return res;
  const fm = fmMatch[1];

  const tagsLineMatch = fm.match(/(^|\n)tags\s*:\s*(.*)/i);
  if (!tagsLineMatch) return res;

  let tail = tagsLineMatch[2].trim();
  if (tail.startsWith("[")) {
    const inner = tail.replace(/^\[|\]$/g, "");
    const parts = inner.split(",").map((s: string) => s.replace(/['"]/g, "").trim()).filter(Boolean);
    for (const p of parts) res.push(p.startsWith("#") ? p.slice(1) : p);
    return Array.from(new Set(res));
  }

  if (/^["'].*["']$/.test(tail) || tail.indexOf(",") !== -1) {
    const cleaned = tail.replace(/^["']|["']$/g, "");
    const parts = cleaned.split(",").map((s: string) => s.trim()).filter(Boolean);
    for (const p of parts) res.push(p.startsWith("#") ? p.slice(1) : p);
    return Array.from(new Set(res));
  }

  const idx = fm.indexOf(tagsLineMatch[0]);
  if (idx >= 0) {
    const after = fm.slice(idx + tagsLineMatch[0].length);
    const lines = after.split(/\r?\n/);
    for (const ln of lines) {
      const m = ln.match(/^\s*-\s*(.+)/);
      if (m) {
        const v = m[1].trim().replace(/^["']|["']$/g, "");
        if (v) res.push(v.startsWith("#") ? v.slice(1) : v);
      } else {
        if (ln.trim().length === 0) continue;
        break;
      }
    }
  }
  return Array.from(new Set(res));
}

/* ---------- 主视图类 ---------- */
class TagTreeView extends ItemView {
  app: App;
  settings: Settings;
  rootNode: TagNode | null = null;
  maxCount = 0;
  idleTimeout: ReturnType<typeof setTimeout> | null = null;
  treeContainer: HTMLElement | null = null;
  barOverlay: HTMLElement | null = null;
  _idleReset: (() => void) | null = null;

  // 存储文件到标签映射 与 计数
  perFileTagMap: Record<string, string[]> = {};
  tagCounts: Record<string, number> = {};
  tagLastUsed: Record<string, number> = {};

  // 热更新相关
  pendingFilesForMeta: Set<string> = new Set();
  metaTimer: number | null = null;
  modifyTimers: Record<string, number> = {};
  overlayRebuildTimer: number | null = null;

  // overlay 与动画同步
  rafId: number | null = null;
  overlaySyncEndAt = 0;
  overlayInstantUntil = 0;
  lastRebuildTime = 0;

  // resize observer
  resizeObserver: ResizeObserver | null = null;

  currentOpId = 0;
  creatingDuringExpand = false;

  constructor(leaf: WorkspaceLeaf, app: App, settings: Settings) {
    super(leaf);
    this.app = app;
    this.settings = settings;
  }

  getViewType() { return VIEW_TYPE_TAG_TREE; }
  getDisplayText() { return "标签树状面板"; }
  // 在 TagTreeView 类内新增：
  getIcon(): string {
    // 可选图标示例（Obsidian 使用 lucide 图标集）
    // 常用： "tags", "tag", "bar-chart-2", "pie-chart", "layers", "list", "search"
    return "list-tree";
  }


  async onOpen(): Promise<void> {
    this.containerEl.empty();
    this.containerEl.addClass("tag-tree-view-container");
    // 设置内边距
    this.containerEl.style.paddingLeft = `${this.settings.sidePadding}px`;
    this.containerEl.style.paddingRight = `${this.settings.sidePadding}px`;
    this.containerEl.style.paddingTop = `12px`;
    this.containerEl.style.paddingBottom = `12px`;

    // 初始化 per-file 标签映射与计数
    await this.initializePerFileMapAndCounts();

    // 监听 Vault 事件（create/delete/modify/rename）
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.extension === "md") this.onFileCreated(file);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile && file.extension === "md") this.onFileDeleted(file);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile) this.onFileRenamed(file, oldPath);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      const p = file.path;
      if (this.modifyTimers[p]) { clearTimeout(this.modifyTimers[p]); delete this.modifyTimers[p]; }
      this.modifyTimers[p] = window.setTimeout(async () => {
        delete this.modifyTimers[p];
        const cache = this.app.metadataCache.getFileCache(file);
        const cacheTags = this.getTagsFromCacheDirect(cache);
        if (!arrayEqual(cacheTags, this.perFileTagMap[p])) {
          this.handleSingleFileCacheChange(p, cacheTags, file);
          return;
        }
        const fileTags = await this.getTagsFromFileAsync(p);
        if (!arrayEqual(fileTags, this.perFileTagMap[p])) {
          this.handleSingleFileCacheChange(p, fileTags, file);
          return;
        }
      }, Math.max(12, Math.min(120, this.settings.metadataDebounceMs)));
    }));

    // metadataCache changed 事件（差异化）
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      const cache = this.app.metadataCache.getFileCache(file);
      const cacheTags = this.getTagsFromCacheDirect(cache);
      const prev = this.perFileTagMap[file.path] || [];
      if (!arrayEqual(cacheTags, prev)) {
        // 立刻处理该文件
        this.pendingFilesForMeta.delete(file.path);
        this.handleSingleFileCacheChange(file.path, cacheTags, file);
        return;
      }
      this.pendingFilesForMeta.add(file.path);
      if (this.metaTimer) window.clearTimeout(this.metaTimer);
      this.metaTimer = window.setTimeout(() => {
        const paths = Array.from(this.pendingFilesForMeta);
        this.pendingFilesForMeta.clear();
        this.metaTimer = null;
        void this.processMetadataChanges(paths);
      }, this.settings.metadataDebounceMs);
    }));

    this.bindIdleEvents();

    // treeContainer: 实际树 DOM（ul/li）
    this.treeContainer = this.containerEl.createDiv();
    this.treeContainer.className = "tag-tree-root";
    this.treeContainer.style.position = "relative";

    // overlay 放置背景条（absolute），在 treeContainer 内
    this.barOverlay = this.treeContainer.createDiv("tag-tree-bar-overlay");
    this.barOverlay.style.position = "absolute";
    this.barOverlay.style.left = "0";
    this.barOverlay.style.top = "0";
    this.barOverlay.style.right = "0";
    this.barOverlay.style.bottom = "0";
    this.barOverlay.style.pointerEvents = "none";
    this.barOverlay.style.zIndex = "1";

    // resize observer：窗口大小变动时重绘 overlay
    this.resizeObserver = new ResizeObserver(() => {
      this.rebuildOverlayBars();
      this.startOverlaySync(Math.max(200, this.settings.expandDuration));
    });
    if (this.treeContainer) this.resizeObserver.observe(this.treeContainer);

    // 建树并渲染
    this.rootNode = this.buildTagTreeWithLastUsed(this.tagCounts, this.tagLastUsed);
    this.accumulateCounts(this.rootNode);
    this.maxCount = Math.max(...Object.values(this.tagCounts), 1);

    // 全局拖放处理：拖拽时将 #tag 文本插入到目标输入或 editor
    this.registerDomEvent(document, "drop", this.handleDocumentDrop.bind(this));
    this.registerDomEvent(document, "dragover", (e: DragEvent) => { e.preventDefault(); });

    this.renderTree(true);
  }

  async onClose(): Promise<void> {
    this.unbindIdleEvents();
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    if (this.resizeObserver && this.treeContainer) { this.resizeObserver.unobserve(this.treeContainer); this.resizeObserver.disconnect(); this.resizeObserver = null; }
  }

  /* ---------- 初始化与标签收集 ---------- */
  private async initializePerFileMapAndCounts() {
    const files = this.app.vault.getMarkdownFiles();
    this.perFileTagMap = {};
    this.tagCounts = {};
    this.tagLastUsed = {};
    for (const f of files) {
      const tags = this.getTagsFromFileCache(f);
      this.perFileTagMap[f.path] = tags;
      for (const t of tags) {
        this.tagCounts[t] = (this.tagCounts[t] || 0) + 1;
        const mtime = (f.stat && (f.stat.mtime || f.stat.mtime != null)) ? (f.stat.mtime as unknown as number) : Date.now();
        this.tagLastUsed[t] = Math.max(this.tagLastUsed[t] || 0, mtime);
      }
    }
    this.maxCount = Math.max(...Object.values(this.tagCounts), 1);
  }

  // 从 cache（metadataCache）直接取 tags（包含 inline tags 与 frontmatter tags）
  private getTagsFromFileCache(file: TFile): string[] {
    const cache = this.app.metadataCache.getFileCache(file);
    const set = new Set<string>();
    if (cache) {
      if ((cache as any).tags && Array.isArray((cache as any).tags)) {
        for (const t of (cache as any).tags) {
          if (!t) continue;
          let tagVal = (typeof t === "string") ? t : (t.tag || "");
          if (!tagVal) continue;
          if (tagVal.startsWith("#")) tagVal = tagVal.slice(1);
          tagVal = String(tagVal).trim();
          if (tagVal) set.add(tagVal);
        }
      }
      if ((cache as any).frontmatter && (cache as any).frontmatter.tags) {
        const fmTags = (cache as any).frontmatter.tags;
        if (Array.isArray(fmTags)) {
          for (const t of fmTags) {
            if (!t) continue;
            let v = String(t).trim();
            if (v.startsWith("#")) v = v.slice(1);
            if (v) set.add(v);
          }
        } else if (typeof fmTags === "string") {
          const parts = fmTags.split(/\s*,\s*/).map((s: string) => s.trim()).filter(Boolean);
          for (const p of parts) {
            let v = p;
            if (v.startsWith("#")) v = v.slice(1);
            if (v) set.add(v);
          }
        }
      }
    }
    return Array.from(set);
  }

  private getTagsFromCacheDirect(cache: any): string[] {
    const set = new Set<string>();
    if (!cache) return [];
    if (cache.tags && Array.isArray(cache.tags)) {
      for (const t of cache.tags) {
        if (!t) continue;
        let tagVal = (typeof t === "string") ? t : (t.tag || "");
        if (!tagVal) continue;
        if (tagVal.startsWith("#")) tagVal = tagVal.slice(1);
        tagVal = String(tagVal).trim();
        if (tagVal) set.add(tagVal);
      }
    }
    if (cache.frontmatter && cache.frontmatter.tags) {
      const fm = cache.frontmatter.tags;
      if (Array.isArray(fm)) {
        for (const t of fm) {
          if (!t) continue;
          let v = String(t).trim();
          if (v.startsWith("#")) v = v.slice(1);
          if (v) set.add(v);
        }
      } else if (typeof fm === "string") {
        const parts = fm.split(/\s*,\s*/).map((s: string) => s.trim()).filter(Boolean);
        for (const p of parts) {
          let v = p;
          if (v.startsWith("#")) v = v.slice(1);
          if (v) set.add(v);
        }
      }
    }
    return Array.from(set);
  }

  // 当 cache 中没有 frontmatter tags 时，延迟读取文件以解析 frontmatter
  private async getTagsFromFileAsync(path: string): Promise<string[]> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return [];
    const cache = this.app.metadataCache.getFileCache(file);
    let inlineTags: string[] = [];
    let frontTagsFromCache: string[] = [];
    if (cache) {
      if ((cache as any).tags && Array.isArray((cache as any).tags)) {
        inlineTags = (cache as any).tags.map((t: any) => {
          let tagVal = (typeof t === "string") ? t : (t.tag || "");
          if (!tagVal) return "";
          if (tagVal.startsWith("#")) tagVal = tagVal.slice(1);
          return String(tagVal).trim();
        }).filter(Boolean);
      }
      if ((cache as any).frontmatter && (cache as any).frontmatter.tags) {
        const fmTags = (cache as any).frontmatter.tags;
        if (Array.isArray(fmTags)) frontTagsFromCache = fmTags.map((t: any) => String(t || "").trim()).filter(Boolean);
        else if (typeof fmTags === "string") frontTagsFromCache = (fmTags.split(/\s*,\s*/).map((s: string) => s.trim()).filter(Boolean));
      }
    }
    const mergedQuick = Array.from(new Set([...(inlineTags || []), ...(frontTagsFromCache || [])].map(s => s.startsWith("#") ? s.slice(1) : s)));
    if (frontTagsFromCache && frontTagsFromCache.length > 0) return mergedQuick;

    const delay = Math.max(0, Number(this.settings.frontmatterReadDelay || DEFAULT_SETTINGS.frontmatterReadDelay));
    if (delay > 0) await new Promise(res => setTimeout(res, delay));
    try {
      const content = await this.app.vault.read(file);
      const fmTags = parseFrontmatterTagsFromContent(content);
      const inlineSet = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = INLINE_TAG_RE.exec(content)) !== null) {
        if (m[1]) {
          const t = m[1].trim();
          if (t) inlineSet.add(t.startsWith("#") ? t.slice(1) : t);
        }
      }
      const combined = Array.from(new Set([...(Array.from(inlineSet) || []), ...(fmTags || [])].map(s => s.startsWith("#") ? s.slice(1) : s)));
      return combined;
    } catch (e) {
      return mergedQuick;
    }
  }

  /* ---------- Vault 文件事件处理（create/delete/modify/rename） ---------- */
  private onFileCreated(file: TFile) {
    void (async () => {
      const newTags = await this.getTagsFromFileAsync(file.path);
      this.perFileTagMap[file.path] = newTags;
      const added: string[] = [];
      const mtime = (file.stat && (file.stat.mtime || file.stat.mtime != null)) ? (file.stat.mtime as unknown as number) : Date.now();
      for (const t of newTags) {
        const prev = this.tagCounts[t] || 0;
        this.tagCounts[t] = prev + 1;
        this.tagLastUsed[t] = Math.max(this.tagLastUsed[t] || 0, mtime);
        if (prev === 0) added.push(t);
      }
      this.maxCount = Math.max(...Object.values(this.tagCounts), 1);

      if (added.length > 0) {
        this.rootNode = this.buildTagTreeWithLastUsed(this.tagCounts, this.tagLastUsed);
        this.accumulateCounts(this.rootNode);
        this.maxCount = Math.max(...Object.values(this.tagCounts), 1);
        this.renderTree(false);
        await nextAnimationFrame(); await nextAnimationFrame();
        for (const t of added) {
          this.createBarForFullpathWithRetry(t, 6).then(ok => { if (!ok) this.scheduleOverlayRebuild(120); });
        }
        this.startOverlaySync(this.settings.expandDuration + 80);
      } else {
        const affected = newTags.filter(t => !!(this.treeContainer?.querySelector(`li.tag-tree-li[data-fullpath="${escSelector(t)}"]`)));
        if (affected.length > 0) this.updateCountsAndBars(affected);
      }
    })();
  }

  private onFileDeleted(file: TFile) {
    const oldTags = this.perFileTagMap[file.path] || [];
    delete this.perFileTagMap[file.path];
    const removed: string[] = [];
    for (const t of oldTags) {
      const prev = this.tagCounts[t] || 0;
      const now = Math.max(0, prev - 1);
      if (now === 0) { delete this.tagCounts[t]; removed.push(t); delete this.tagLastUsed[t]; } else this.tagCounts[t] = now;
    }
    this.maxCount = Math.max(...Object.values(this.tagCounts), 1);

    if (removed.length > 0) {
      this.rootNode = this.buildTagTreeWithLastUsed(this.tagCounts, this.tagLastUsed);
      this.accumulateCounts(this.rootNode);
      this.maxCount = Math.max(...Object.values(this.tagCounts), 1);
      this.renderTree(false);

      if (this.barOverlay) {
        for (const t of removed) {
          const sel = `.tag-tree-view-bg-bar[data-fullpath="${escSelector(t)}"]`;
          const b = this.barOverlay.querySelector<HTMLElement>(sel);
          if (b) {
            const inner = b.querySelector<HTMLElement>(".bar-inner");
            if (inner) {
              inner.style.transition = `transform ${Math.max(80, this.settings.barCollapseDuration)}ms ${this.settings.expandEasing}, opacity ${Math.max(40, this.settings.barFadeOutDuration)}ms linear`;
              inner.style.transformOrigin = "left center";
              inner.style.transform = "scaleX(0)";
              inner.style.opacity = "0";
              setTimeout(() => { b.remove(); }, Math.max(120, this.settings.barCollapseDuration));
            } else {
              b.remove();
            }
          }
        }
      }
      this.scheduleOverlayRebuild(120);
    } else {
      this.scheduleOverlayRebuild(120);
    }
  }

  private onFileRenamed(file: TFile, oldPath: string) {
    const tags = this.perFileTagMap[oldPath];
    if (tags) {
      delete this.perFileTagMap[oldPath];
      this.perFileTagMap[file.path] = tags;
    } else {
      this.onFileCreated(file);
    }
  }

  // 批量处理 metadata 变更（差异化渲染）
  private async processMetadataChanges(paths: string[]) {
    const globallyAdded: Set<string> = new Set();
    const globallyRemoved: Set<string> = new Set();
    const changedTagsSet: Set<string> = new Set();

    for (const p of paths) {
      const oldTags = this.perFileTagMap[p] || [];
      const file = this.app.vault.getAbstractFileByPath(p);
      if (!(file instanceof TFile)) {
        for (const t of oldTags) {
          const prev = this.tagCounts[t] || 0;
          const now = Math.max(0, prev - 1);
          if (now === 0) { delete this.tagCounts[t]; globallyRemoved.add(t); } else this.tagCounts[t] = now;
          changedTagsSet.add(t);
        }
        delete this.perFileTagMap[p];
        continue;
      }
      const newTags = await this.getTagsFromFileAsync(p);
      this.perFileTagMap[p] = newTags;

      const oldSet = new Set(oldTags);
      const newSet = new Set(newTags);
      for (const t of newSet) {
        if (!oldSet.has(t)) {
          const prev = this.tagCounts[t] || 0;
          this.tagCounts[t] = prev + 1;
          if (prev === 0) globallyAdded.add(t);
          changedTagsSet.add(t);
        }
      }
      for (const t of oldSet) {
        if (!newSet.has(t)) {
          const prev = this.tagCounts[t] || 0;
          const now = Math.max(0, prev - 1);
          if (now === 0) { delete this.tagCounts[t]; globallyRemoved.add(t); } else this.tagCounts[t] = now;
          changedTagsSet.add(t);
        }
      }

      const mtime = (file.stat && (file.stat.mtime || file.stat.mtime != null)) ? (file.stat.mtime as unknown as number) : Date.now();
      for (const t of newTags) {
        this.tagLastUsed[t] = Math.max(this.tagLastUsed[t] || 0, mtime);
      }
    }

    this.maxCount = Math.max(...Object.values(this.tagCounts), 1);

    if (globallyAdded.size > 0) await this.handleTagsAdded(Array.from(globallyAdded));
    if (globallyRemoved.size > 0) this.handleTagsRemoved(Array.from(globallyRemoved));
    if (changedTagsSet.size > 0) this.updateCountsAndBars(Array.from(changedTagsSet));

    const recheckDelay = Math.max(40, (this.settings.frontmatterReadDelay || DEFAULT_SETTINGS.frontmatterReadDelay) * 2);
    setTimeout(async () => {
      const recheckPaths = paths.filter(p => !!this.app.vault.getAbstractFileByPath(p));
      if (recheckPaths.length === 0) return;
      let anyChange = false;
      for (const p of recheckPaths) {
        const prev = this.perFileTagMap[p] || [];
        const newTags = await this.getTagsFromFileAsync(p);
        if (!arrayEqual(prev, newTags)) {
          anyChange = true;
          this.pendingFilesForMeta.add(p);
        }
      }
      if (anyChange) {
        if (this.metaTimer) clearTimeout(this.metaTimer);
        this.metaTimer = window.setTimeout(() => {
          const paths2 = Array.from(this.pendingFilesForMeta);
          this.pendingFilesForMeta.clear();
          this.metaTimer = null;
          void this.processMetadataChanges(paths2);
        }, this.settings.metadataDebounceMs);
      }
    }, recheckDelay);
  }

  /* ---------- Overlay / 重建/差异化更新 ---------- */
  private scheduleOverlayRebuild(delay = 160) {
    if (this.overlayRebuildTimer) { clearTimeout(this.overlayRebuildTimer); this.overlayRebuildTimer = null; }
    this.overlayRebuildTimer = window.setTimeout(() => {
      this.rebuildOverlayBars();
      this.overlayRebuildTimer = null;
    }, delay);
  }

  private async handleTagsAdded(tags: string[]) {
    this.rootNode = this.buildTagTreeWithLastUsed(this.tagCounts, this.tagLastUsed);
    this.accumulateCounts(this.rootNode);
    this.maxCount = Math.max(...Object.values(this.tagCounts), 1);

    this.renderTree(false);
    await nextAnimationFrame(); await nextAnimationFrame();

    for (const t of tags) {
      this.createBarForFullpathWithRetry(t, 6).then(ok => { if (!ok) this.scheduleOverlayRebuild(120); });
    }
    this.startOverlaySync(this.settings.expandDuration + 80);
  }

  private handleTagsRemoved(tags: string[]) {
    this.rootNode = this.buildTagTreeWithLastUsed(this.tagCounts, this.tagLastUsed);
    this.accumulateCounts(this.rootNode);
    this.maxCount = Math.max(...Object.values(this.tagCounts), 1);

    this.renderTree(false);

    if (this.barOverlay) {
      for (const t of tags) {
        const sel = `.tag-tree-view-bg-bar[data-fullpath="${escSelector(t)}"]`;
        const b = this.barOverlay.querySelector<HTMLElement>(sel);
        if (b) {
          const inner = b.querySelector<HTMLElement>(".bar-inner");
          if (inner) {
            inner.style.transition = `transform ${Math.max(80, this.settings.barCollapseDuration)}ms ${this.settings.expandEasing}, opacity ${Math.max(40, this.settings.barFadeOutDuration)}ms linear`;
            inner.style.transformOrigin = "left center";
            inner.style.transform = "scaleX(0)";
            inner.style.opacity = "0";
            setTimeout(() => { b.remove(); }, Math.max(120, this.settings.barCollapseDuration));
          } else {
            b.remove();
          }
        }
      }
    }
    this.scheduleOverlayRebuild(120);
  }

  private updateCountsAndBars(tags: string[]) {
    if (!this.barOverlay || !this.treeContainer) return;
    for (const t of tags) {
      const li = this.treeContainer.querySelector<HTMLLIElement>(`li.tag-tree-li[data-fullpath="${escSelector(t)}"]`);
      if (li) {
        const cnt = li.querySelector<HTMLElement>(".tag-tree-count");
        if (cnt) cnt.textContent = String(this.tagCounts[t] || 0);
      }
    }

    for (const t of tags) {
      const sel = `.tag-tree-view-bg-bar[data-fullpath="${escSelector(t)}"]`;
      const b = this.barOverlay.querySelector<HTMLElement>(sel);
      const count = this.tagCounts[t] || 0;

      const treeRect = this.treeContainer.getBoundingClientRect();
      const liFor = this.treeContainer.querySelector<HTMLLIElement>(`li.tag-tree-li[data-fullpath="${escSelector(t)}"]`);
      const alignLeftForUpdate = liFor ? liFor.getBoundingClientRect().left - treeRect.left : 0;
      const containerClientWidth = this.treeContainer.clientWidth || (treeRect.right - treeRect.left);
      const rightPadding = Number(this.settings.rightPadding || DEFAULT_SETTINGS.rightPadding);
      const available = Math.max(40, containerClientWidth - alignLeftForUpdate - rightPadding);
      const actualMaxBarWidth = Math.min(this.settings.maxBarWidth, available);

      const w = (count / Math.max(1, this.maxCount)) * actualMaxBarWidth;

      if (b) {
        b.style.transition = `width ${Math.max(120, this.settings.barAnimationDuration)}ms ${this.settings.expandEasing}, left ${Math.max(120, this.settings.barAnimationDuration)}ms ${this.settings.expandEasing}`;
        b.style.width = `${w}px`;
        const inner = b.querySelector<HTMLElement>(".bar-inner");
        if (inner) {
          const raw = this.getBgBarColorRaw(count);
          inner.style.transition = `background-color 200ms linear, opacity ${Math.max(40, this.settings.barFadeDuration)}ms linear`;
          inner.style.backgroundColor = this.containerEl.hasClass("idle")
            ? `rgba(${raw.r},${raw.g},${raw.b},${this.settings.idleBarAlpha})`
            : `rgba(${raw.r},${raw.g},${raw.b},${this.settings.activeBarOpacity})`;
          inner.style.borderRadius = `${this.settings.barCornerRadius}px`;
        }
      } else {
        this.createBarForFullpathWithRetry(t, 6).then(ok => {
          if (!ok) this.scheduleOverlayRebuild(120);
        });
      }
    }

    this.startOverlaySync(Math.max(120, this.settings.barAnimationDuration));
  }

  /* ---------- 构造/渲染 树结构 ---------- */
  private buildTagTreeWithLastUsed(tagCounts: Record<string, number>, tagLastUsed: Record<string, number>): TagNode {
    const root: TagNode = { name: "", fullPath: "", count: 0, children: new Map(), expanded: true, lastUsed: 0 };
    for (const fullTag in tagCounts) {
      const parts = fullTag.split("/");
      let cur = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!cur.children.has(part)) {
          cur.children.set(part, {
            name: part,
            fullPath: cur.fullPath ? `${cur.fullPath}/${part}` : part,
            count: 0,
            children: new Map(),
            expanded: false,
            lastUsed: 0,
          });
        }
        cur = cur.children.get(part)!;
        if (i === parts.length - 1) {
          cur.count = tagCounts[fullTag];
          cur.lastUsed = tagLastUsed[fullTag] || 0;
        }
      }
    }
    return root;
  }

  private renderTree(rebuildOverlay = true) {
    if (!this.treeContainer || !this.rootNode) return;

    const preserveOverlay = !rebuildOverlay && this.barOverlay;
    if (!preserveOverlay) {
      this.treeContainer.innerHTML = "";
      this.barOverlay = this.treeContainer.createDiv("tag-tree-bar-overlay");
      this.barOverlay.style.position = "absolute";
      this.barOverlay.style.left = "0";
      this.barOverlay.style.top = "0";
      this.barOverlay.style.right = "0";
      this.barOverlay.style.bottom = "0";
      this.barOverlay.style.pointerEvents = "none";
      this.barOverlay.style.zIndex = "1";
    } else {
      const savedOverlay = this.barOverlay!;
      this.treeContainer.innerHTML = "";
      this.treeContainer.appendChild(savedOverlay);
    }

    const ul = document.createElement("ul");
    ul.className = "tag-tree-ul";
    this.renderNode(this.rootNode, ul, 0, null);
    this.treeContainer.appendChild(ul);

    if (rebuildOverlay) this.rebuildOverlayBars();
    else this.startOverlaySync(this.settings.expandDuration + 80);
  }

  private renderNode(node: TagNode, container: HTMLElement, level: number, parentAlignLeft: number | null) {
    if (node.name === "") {
      const childrenArr = Array.from(node.children.values());
      const sorted = this.sortChildren(childrenArr);
      sorted.forEach(child => this.renderNode(child, container, level, parentAlignLeft));
      return;
    }

    const li = document.createElement("li");
    li.className = "tag-tree-li";
    (li as HTMLElement).dataset.fullPath = node.fullPath;
    li.style.position = "relative";
    li.style.height = `24px`;
    li.style.zIndex = "3";

    // 箭头
    if (node.children.size > 0) {
      const arrow = document.createElement("span");
      arrow.className = "tag-tree-view-arrow";
      if (node.expanded) arrow.classList.add("expanded"); else arrow.classList.remove("expanded");
      arrow.style.setProperty("--easing", this.settings.expandEasing);
      arrow.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
      arrow.onclick = (e) => {
        e.stopPropagation();
        node.expanded = !node.expanded;
        if (node.expanded) arrow.classList.add("expanded"); else arrow.classList.remove("expanded");
        this.updateSubtreeRender(li, node, level + 1);
      };
      li.appendChild(arrow);
    }

    const flex = document.createElement("div");
    flex.className = "tag-tree-view-flex-container";
    // 仅文本缩进（背景条对齐由 overlay 控制）
    (flex as HTMLElement).style.marginLeft = `${this.settings.subTagIndent * (level + 1)}px`;

    const nameSpan = document.createElement("span");
    nameSpan.className = "tag-tree-name";
    nameSpan.textContent = node.name;
    nameSpan.onclick = (e) => { e.stopPropagation(); this.openSearchWithTag(node.fullPath); };

    // 立即支持拖拽（无长按）
    this.attachDragHandlers(nameSpan, node.fullPath);

    flex.appendChild(nameSpan);

    const cnt = document.createElement("span");
    cnt.className = "tag-tree-count";
    cnt.textContent = node.count.toString();
    flex.appendChild(cnt);

    li.appendChild(flex);
    container.appendChild(li);

    if (!this.treeContainer || !this.barOverlay) return;
    const treeRect = this.treeContainer.getBoundingClientRect();
    const liRect = li.getBoundingClientRect();
    const thisLineLeft = liRect.left - treeRect.left;
    const alignLeft = parentAlignLeft !== null ? parentAlignLeft : thisLineLeft;

    if (this.barOverlay && !this.barOverlay.querySelector(`.tag-tree-view-bg-bar[data-fullpath="${escSelector(node.fullPath)}"]`)) {
      // 新建 overlay 背景条（差异化创建）
      const bar = document.createElement("div");
      bar.className = "tag-tree-view-bg-bar";
      bar.setAttribute("data-fullpath", node.fullPath);
      bar.setAttribute("data-count", String(node.count));

      // 根据容器宽度自适应最大宽度
      const containerClientWidth = this.treeContainer.clientWidth || (treeRect.right - treeRect.left);
      const rightPadding = Number(this.settings.rightPadding || DEFAULT_SETTINGS.rightPadding);
      const available = Math.max(40, containerClientWidth - alignLeft - rightPadding);
      const actualMaxBarWidth = Math.min(this.settings.maxBarWidth, available);

      const w = (node.count / Math.max(1, this.maxCount)) * actualMaxBarWidth;
      bar.style.left = `${alignLeft}px`;
      bar.style.transform = `translateY(${liRect.top - treeRect.top}px)`;
      bar.style.width = `0px`; // 新建先为 0，随后扩展（动画）
      bar.style.height = `${liRect.height}px`;
      bar.style.borderRadius = `${this.settings.barCornerRadius}px`;

      const inner = document.createElement("div");
      inner.className = "bar-inner";
      const raw = this.getBgBarColorRaw(node.count);
      inner.style.backgroundColor = this.containerEl.hasClass("idle")
        ? `rgba(${raw.r},${raw.g},${raw.b},${this.settings.idleBarAlpha})`
        : `rgba(${raw.r},${raw.g},${raw.b},${this.settings.activeBarOpacity})`;

      inner.style.borderRadius = `${this.settings.barCornerRadius}px`;
      inner.style.transformOrigin = "left center";
      inner.style.transform = "scaleX(0)";
      inner.style.opacity = "0";
      inner.style.transition = `transform ${Math.max(80, this.settings.barExpandDuration)}ms ${this.settings.expandEasing}, opacity ${Math.max(40, this.settings.barFadeInDuration)}ms linear`;

      bar.appendChild(inner);
      this.barOverlay.appendChild(bar);

      // 启动扩展动画（下一帧）
      requestAnimationFrame(() => {
        const animateWidthMs = Math.max(80, this.settings.barExpandDuration);
        bar.style.transition = `width ${animateWidthMs}ms ${this.settings.expandEasing}, left ${animateWidthMs}ms ${this.settings.expandEasing}`;
        bar.style.width = `${w}px`;
        requestAnimationFrame(() => {
          inner.style.transform = "scaleX(1)";
          inner.style.opacity = "1";
        });
      });
    }

    // 递归渲染子节点（如果展开）
    if (node.expanded && node.children.size > 0) {
      const ul = document.createElement("ul");
      ul.className = "tag-tree-children";
      ul.style.paddingLeft = "0";
      ul.style.marginLeft = "0";
      ul.style.transitionDuration = `${this.settings.expandDuration}ms`;
      ul.style.transitionTimingFunction = this.settings.expandEasing;
      ul.style.maxHeight = "0px";
      ul.style.opacity = "0";

      this.creatingDuringExpand = true;
      const childrenArr = Array.from(node.children.values());
      const sortedChildren = this.sortChildren(childrenArr);
      sortedChildren.forEach((child) => this.renderNode(child, ul, level + 1, alignLeft));
      this.creatingDuringExpand = false;

      container.appendChild(ul);

      // 展开高度动画并在合适时刻预热/播放条动画
      requestAnimationFrame(() => {
        const fullH = ul.scrollHeight;
        ul.style.maxHeight = `${fullH}px`;
        ul.style.opacity = "1";

        // 计算预热时间（展开时）
        const startOffset = Math.max(0, (this.settings.expandDuration || 0) - (this.settings.barPreheatExpandMs || DEFAULT_SETTINGS.barPreheatExpandMs));
        const opId = ++this.currentOpId;
        // 先延迟一小段时间再播放条展开动画（preheat）
        const preheatTimer = window.setTimeout(() => {
          if (opId !== this.currentOpId) return;
          const descendants = this.collectDescendantFullPaths(node);
          // 播放条伸展动画
          this.playBarsExpand(descendants, opId).then(() => {
            if (opId !== this.currentOpId) return;
            this.rebuildOverlayBars();
          });
        }, startOffset);

        const onEnd = (e: TransitionEvent) => {
          if (e.propertyName === "max-height") {
            ul.style.maxHeight = "none";
            ul.removeEventListener("transitionend", onEnd);
            clearTimeout(preheatTimer);
            // 确保 overlay 同步
            this.startOverlaySync(this.settings.expandDuration + 80);
          }
        };
        ul.addEventListener("transitionend", onEnd);
      });
    }
  }

  private sortChildren(children: TagNode[]): TagNode[] {
    const key = this.settings.sortBy;
    const order = this.settings.sortOrder === "asc" ? 1 : -1;
    const copy = children.slice();
    copy.sort((a, b) => {
      if (key === "count") {
        const ca = a.count || 0;
        const cb = b.count || 0;
        if (ca === cb) return a.name.localeCompare(b.name);
        return (ca - cb) * order;
      } else {
        const la = a.lastUsed || 0;
        const lb = b.lastUsed || 0;
        if (la === lb) return a.name.localeCompare(b.name);
        return (la - lb) * order;
      }
    });
    return copy;
  }

  private updateSubtreeRender(parentLi: HTMLElement, node: TagNode, level: number) {
    const opId = ++this.currentOpId;

    // 如果已经有子 UL（收起逻辑）
    let siblingUl = parentLi.nextElementSibling;
    if (siblingUl && siblingUl.classList.contains("tag-tree-children")) {
      // 折叠：先播放子条的收缩动画，再收起高度
      const descendants = this.collectDescendantFullPaths(node);
      // 锁定子条当前 top 值，防止收起动画导致 overlay 跳动
      descendants.forEach(fp => {
        const selBar = `.tag-tree-view-bg-bar[data-fullpath="${escSelector(fp)}"]`;
        const barEl = this.barOverlay?.querySelector<HTMLElement>(selBar);
        if (barEl) {
          const treeRect = this.treeContainer!.getBoundingClientRect();
          const top = barEl.getBoundingClientRect().top - treeRect.top;
          barEl.setAttribute("data-locked-top", String(top));
        }
      });

      // 播放子条收缩动画（以左为基点缩小）
      const collapsePromise = this.playBarsCollapse(descendants, opId);

      // 计算何时开始高度折叠：在 collapse 动画完成后或提前某个预热时间
      const collapseDur = Math.max(0, this.settings.barCollapseDuration || DEFAULT_SETTINGS.barCollapseDuration);
      const preheatCollapse = Math.max(0, this.settings.barPreheatCollapseMs || DEFAULT_SETTINGS.barPreheatCollapseMs);
      const heightStartAfter = Math.max(0, collapseDur - preheatCollapse);

      setTimeout(() => {
        if (opId !== this.currentOpId) return;
        const current = siblingUl as HTMLElement;
        const full = current.scrollHeight;
        current.style.maxHeight = `${full}px`;
        current.style.transitionDuration = `${this.settings.expandDuration}ms`;
        current.style.transitionTimingFunction = this.settings.expandEasing;
        current.offsetHeight; // force reflow
        current.style.maxHeight = "0px";
        current.style.opacity = "0";

        const onEnd = (e: TransitionEvent) => {
          if (e.propertyName === "max-height") {
            current.removeEventListener("transitionend", onEnd);
            current.remove();
            // 移除 overlay 中被折叠的子条（只移除受影响的）
            descendants.forEach(fp => {
              const selBar = `.tag-tree-view-bg-bar[data-fullpath="${escSelector(fp)}"]`;
              const b = this.barOverlay?.querySelector<HTMLElement>(selBar);
              if (b) b.remove();
            });
            // 清除锁定 top 属性
            Array.from(this.barOverlay?.querySelectorAll<HTMLElement>(".tag-tree-view-bg-bar") || []).forEach(b => b.removeAttribute("data-locked-top"));
            this.rebuildOverlayBars();
          }
        };
        current.addEventListener("transitionend", onEnd);
      }, heightStartAfter);

      // overlay 同步
      const syncDur = Math.max(this.settings.barCollapseDuration, this.settings.expandDuration) + 160;
      this.startOverlaySync(syncDur);

      if (this._idleReset) this._idleReset();
      return;
    }

    // 展开（插入子 ul）
    if (node.expanded && node.children.size > 0) {
      const treeRect = this.treeContainer!.getBoundingClientRect();
      const parentRect = parentLi.getBoundingClientRect();
      const alignLeft = parentRect.left - treeRect.left;

      const ul = document.createElement("ul");
      ul.className = "tag-tree-children";
      ul.style.paddingLeft = "0";
      ul.style.marginLeft = "0";
      ul.style.transitionDuration = `${this.settings.expandDuration}ms`;
      ul.style.transitionTimingFunction = this.settings.expandEasing;
      ul.style.maxHeight = "0px";
      ul.style.opacity = "0";

      this.creatingDuringExpand = true;
      const childrenArr = Array.from(node.children.values());
      const sortedChildren = this.sortChildren(childrenArr);
      sortedChildren.forEach((child) => this.renderNode(child, ul, level + 1, alignLeft));
      this.creatingDuringExpand = false;

      parentLi.parentElement!.insertBefore(ul, parentLi.nextSibling);

      // 先 trigger 高度展开，再按 preheat 播放条动画
      requestAnimationFrame(() => {
        const full = ul.scrollHeight;
        ul.style.maxHeight = `${full}px`;
        ul.style.opacity = "1";

        const startOffset = Math.max(0, (this.settings.expandDuration || 0) - (this.settings.barPreheatExpandMs || DEFAULT_SETTINGS.barPreheatExpandMs));
        const myOp = opId;
        const preheatTimer = window.setTimeout(() => {
          if (myOp !== this.currentOpId) return;
          const descendants = this.collectDescendantFullPaths(node);
          this.playBarsExpand(descendants, myOp).then(() => {
            if (myOp !== this.currentOpId) return;
            // 在播放完成后确保 overlay 重建（清理 locked 属性）
            Array.from(this.barOverlay?.querySelectorAll<HTMLElement>(".tag-tree-view-bg-bar") || []).forEach(b => b.removeAttribute("data-locked-top"));
            this.rebuildOverlayBars();
          });
        }, startOffset);

        const onEnd = (e: TransitionEvent) => {
          if (e.propertyName === "max-height") {
            ul.removeEventListener("transitionend", onEnd);
            clearTimeout(preheatTimer);
            // 当高度动画完成时，确保 overlay 同步
            this.startOverlaySync(this.settings.expandDuration + 80);
          }
        };
        ul.addEventListener("transitionend", onEnd);
      });

      if (this._idleReset) this._idleReset();
      return;
    }

    // 兜底：重建 overlay
    this.rebuildOverlayBars();
    if (this._idleReset) this._idleReset();
  }

  /* ---------- 背景条动画（扩展 / 收缩），确保以左为基点 ---------- */
  private async playBarsExpand(fullpaths: string[], opId: number): Promise<void> {
    if (!this.barOverlay) return;
    if (fullpaths.length === 0) return;

    const dur = Math.max(0, this.settings.barExpandDuration || DEFAULT_SETTINGS.barExpandDuration);
    const fade = Math.max(0, this.settings.barFadeInDuration || DEFAULT_SETTINGS.barFadeInDuration);
    const total = Math.max(dur, fade) + 40;

    // 确保这些 bar 存在
    for (const fp of fullpaths) {
      const selBar = `.tag-tree-view-bg-bar[data-fullpath="${escSelector(fp)}"]`;
      if (!this.barOverlay.querySelector(selBar)) await this.createBarForFullpathWithRetry(fp, 6);
    }

    fullpaths.forEach(fp => {
      const innerSel = `.tag-tree-view-bg-bar[data-fullpath="${escSelector(fp)}"] .bar-inner`;
      const inner = this.barOverlay!.querySelector<HTMLElement>(innerSel);
      if (inner) {
        inner.style.transition = `transform ${dur}ms ${this.settings.expandEasing}, opacity ${fade}ms linear, background-color 200ms linear`;
        inner.style.transformOrigin = "left center";
        inner.style.transform = "scaleX(1)";
        inner.style.opacity = "1";
        const parent = inner.parentElement;
        if (parent) parent.removeAttribute("data-new");
      }
    });

    this.startOverlaySync(total);

    await new Promise<void>((resolve) => {
      const start = performance.now();
      const tick = () => {
        if (opId !== this.currentOpId) { resolve(); return; }
        if (performance.now() - start >= total) { resolve(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  private async playBarsCollapse(fullpaths: string[], opId: number): Promise<void> {
    if (!this.barOverlay) return;
    if (fullpaths.length === 0) return;

    const dur = Math.max(0, this.settings.barCollapseDuration || DEFAULT_SETTINGS.barCollapseDuration);
    const fade = Math.max(0, this.settings.barFadeOutDuration || DEFAULT_SETTINGS.barFadeOutDuration);
    const total = Math.max(dur, fade) + 40;

    fullpaths.forEach(fp => {
      const innerSel = `.tag-tree-view-bg-bar[data-fullpath="${escSelector(fp)}"] .bar-inner`;
      const inner = this.barOverlay!.querySelector<HTMLElement>(innerSel);
      if (inner) {
        inner.style.transition = `transform ${dur}ms ${this.settings.expandEasing}, opacity ${fade}ms linear`;
        inner.style.transformOrigin = "left center";
        // 收缩以左为基点：scaleX(0) 从左侧消失
        inner.style.transform = "scaleX(0)";
        inner.style.opacity = "0";
      }
    });

    this.startOverlaySync(total);

    await new Promise<void>((resolve) => {
      const start = performance.now();
      const tick = () => {
        if (opId !== this.currentOpId) { resolve(); return; }
        if (performance.now() - start >= total) { resolve(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  private collectDescendantFullPaths(node: TagNode): string[] {
    const res: string[] = [];
    const dfs = (n: TagNode) => { n.children.forEach(c => { res.push(c.fullPath); dfs(c); }); };
    dfs(node);
    return res;
  }

  /* ---------- rebuildOverlayBars：差异化重建、避免阻塞 ---------- */
  private rebuildOverlayBars() {
    if (!this.treeContainer || !this.barOverlay) return;
    const now = performance.now();
    if (now - this.lastRebuildTime < 8) return; // 限流
    this.lastRebuildTime = now;

    const treeRect = this.treeContainer.getBoundingClientRect();
    const lisAll = Array.from(this.treeContainer.querySelectorAll<HTMLLIElement>("li.tag-tree-li"));
    const lis = lisAll.filter(li => li.getAttribute("data-removed") !== "1");

    // 收集现有 bars
    const existingBars = new Map<string, HTMLElement>();
    Array.from(this.barOverlay.querySelectorAll<HTMLElement>(".tag-tree-view-bg-bar")).forEach(b => {
      const fp = b.getAttribute("data-fullpath") || "";
      existingBars.set(fp, b);
    });

    const used = new Set<string>();
    for (let i = 0; i < lis.length; i++) {
      const li = lis[i];
      const fp = li.dataset.fullPath || "";
      const liRect = li.getBoundingClientRect();
      const countEl = li.querySelector<HTMLElement>(".tag-tree-count");
      const count = countEl ? Number(countEl.textContent || "0") : 0;

      let alignLeft = liRect.left - treeRect.left;
      // 寻找左侧第一个缩进更小的兄弟以对齐父条
      for (let j = i - 1; j >= 0; j--) {
        const candRect = lis[j].getBoundingClientRect();
        if (candRect.left < liRect.left - 0.5) { alignLeft = candRect.left - treeRect.left; break; }
      }

      const containerClientWidth = this.treeContainer.clientWidth || (treeRect.right - treeRect.left);
      const rightPadding = Number(this.settings.rightPadding || DEFAULT_SETTINGS.rightPadding);
      const available = Math.max(40, containerClientWidth - alignLeft - rightPadding);
      const actualMaxBarWidth = Math.min(this.settings.maxBarWidth, available);

      const w = (count / Math.max(1, this.maxCount)) * actualMaxBarWidth;

      let bar = existingBars.get(fp);
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "tag-tree-view-bg-bar";
        bar.setAttribute("data-fullpath", fp);
        const inner = document.createElement("div");
        inner.className = "bar-inner";
        inner.style.transform = "scaleX(1)";
        inner.style.opacity = "1";
        inner.style.borderRadius = `${this.settings.barCornerRadius}px`;
        bar.appendChild(inner);
        this.barOverlay.appendChild(bar);
      }

      bar.setAttribute("data-count", String(count));
      const locked = bar.getAttribute("data-locked-top");
      if (locked !== null) {
        bar.style.transform = `translateY(${Number(locked)}px)`;
        if (performance.now() < this.overlayInstantUntil) {
          bar.style.transition = `left 0ms linear, width 0ms linear, background-color 0ms linear, transform 0ms linear`;
        } else {
          const dur = Math.max(200, this.settings.expandDuration);
          bar.style.transition = `left ${dur}ms ${this.settings.expandEasing}, width ${dur}ms ${this.settings.expandEasing}, background-color 200ms linear, transform ${dur}ms ${this.settings.expandEasing}`;
        }
      } else {
        const top = liRect.top - treeRect.top;
        bar.style.transform = `translateY(${top}px)`;
        if (performance.now() < this.overlayInstantUntil) {
          bar.style.transition = `left 0ms linear, width 0ms linear, background-color 0ms linear, transform 0ms linear`;
        } else {
          const dur = Math.max(200, this.settings.expandDuration);
          bar.style.transition = `left ${dur}ms ${this.settings.expandEasing}, transform ${dur}ms ${this.settings.expandEasing}, width ${dur}ms ${this.settings.expandEasing}, background-color 200ms linear`;
        }
      }

      bar.style.left = `${alignLeft}px`;
      bar.style.width = `${w}px`;
      bar.style.height = `${liRect.height}px`;
      bar.style.borderRadius = `${this.settings.barCornerRadius}px`;

      const innerEl = bar.querySelector<HTMLElement>(".bar-inner");
      if (innerEl) {
        const raw = this.getBgBarColorRaw(count);
        innerEl.style.backgroundColor = this.containerEl.hasClass("idle")
          ? `rgba(${raw.r},${raw.g},${raw.b},${this.settings.idleBarAlpha})`
          : `rgba(${raw.r},${raw.g},${raw.b},${this.settings.activeBarOpacity})`;
        innerEl.style.borderRadius = `${this.settings.barCornerRadius}px`;
      }

      used.add(fp);
    }

    // 移除多余 bars
    Array.from(this.barOverlay.querySelectorAll<HTMLElement>(".tag-tree-view-bg-bar")).forEach(b => {
      const fp = b.getAttribute("data-fullpath") || "";
      if (!used.has(fp)) b.remove();
    });
  }

  private startOverlaySync(duration: number) {
    const now = performance.now();
    this.overlaySyncEndAt = Math.max(this.overlaySyncEndAt, now + duration);
    this.overlayInstantUntil = Math.max(this.overlayInstantUntil, now + duration + 120);

    if (this.rafId === null) {
      const tick = () => {
        this.rebuildOverlayBars();
        if (performance.now() < this.overlaySyncEndAt) {
          this.rafId = requestAnimationFrame(tick);
        } else {
          this.rebuildOverlayBars();
          if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; this.overlaySyncEndAt = 0; }
        }
      };
      this.rafId = requestAnimationFrame(tick);
    }
  }

  private async createBarForFullpathWithRetry(fullpath: string, maxFrames = 6): Promise<boolean> {
    for (let i = 0; i < maxFrames; i++) {
      if (!this.treeContainer || !this.barOverlay) return false;
      if (!this.tagCounts[fullpath]) return false;
      const li = this.treeContainer.querySelector<HTMLLIElement>(`li.tag-tree-li[data-fullpath="${escSelector(fullpath)}"]`);
      if (li) {
        if (li.getAttribute("data-removed") === "1") return false;
        const existing = this.barOverlay.querySelector<HTMLElement>(`.tag-tree-view-bg-bar[data-fullpath="${escSelector(fullpath)}"]`);
        if (existing) return true;
        await nextAnimationFrame();
        return this.createBarForFullpath(fullpath);
      }
      await nextAnimationFrame();
    }
    return false;
  }

  private createBarForFullpath(fullpath: string): boolean {
    if (!this.treeContainer || !this.barOverlay) return false;
    if (!this.tagCounts[fullpath]) return false;
    const li = this.treeContainer.querySelector<HTMLLIElement>(`li.tag-tree-li[data-fullpath="${escSelector(fullpath)}"]`);
    if (!li) return false;
    if (li.getAttribute("data-removed") === "1") return false;

    const existing = this.barOverlay.querySelector<HTMLElement>(`.tag-tree-view-bg-bar[data-fullpath="${escSelector(fullpath)}"]`);
    if (existing) return true;

    const treeRect = this.treeContainer.getBoundingClientRect();
    const liRect = li.getBoundingClientRect();

    const lis = Array.from(this.treeContainer.querySelectorAll<HTMLLIElement>("li.tag-tree-li"));
    let alignLeft = liRect.left - treeRect.left;
    for (let i = 0; i < lis.length; i++) {
      if (lis[i] === li) {
        for (let j = i - 1; j >= 0; j--) {
          const candRect = lis[j].getBoundingClientRect();
          if (candRect.left < liRect.left - 0.5) { alignLeft = candRect.left - treeRect.left; break; }
        }
        break;
      }
    }

    const countEl = li.querySelector<HTMLElement>(".tag-tree-count");
    const count = countEl ? Number(countEl.textContent || "0") : (this.tagCounts[fullpath] || 0);

    const containerClientWidth = this.treeContainer.clientWidth || (treeRect.right - treeRect.left);
    const rightPadding = Number(this.settings.rightPadding || DEFAULT_SETTINGS.rightPadding);
    const available = Math.max(40, containerClientWidth - alignLeft - rightPadding);
    const actualMaxBarWidth = Math.min(this.settings.maxBarWidth, available);

    const w = (count / Math.max(1, this.maxCount)) * actualMaxBarWidth;

    const bar = document.createElement("div");
    bar.className = "tag-tree-view-bg-bar";
    bar.setAttribute("data-fullpath", fullpath);
    bar.setAttribute("data-count", String(count));
    bar.style.left = `${alignLeft}px`;
    bar.style.transform = `translateY(${liRect.top - treeRect.top}px)`;
    bar.style.width = `0px`;
    bar.style.height = `${liRect.height}px`;
    bar.style.borderRadius = `${this.settings.barCornerRadius}px`;

    const inner = document.createElement("div");
    inner.className = "bar-inner";
    const raw = this.getBgBarColorRaw(count);
    inner.style.backgroundColor = this.containerEl.hasClass("idle")
      ? `rgba(${raw.r},${raw.g},${raw.b},${this.settings.idleBarAlpha})`
      : `rgba(${raw.r},${raw.g},${raw.b},${this.settings.activeBarOpacity})`;

    inner.style.borderRadius = `${this.settings.barCornerRadius}px`;
    inner.style.transformOrigin = "left center";
    inner.style.transform = "scaleX(0)";
    inner.style.opacity = "0";
    inner.style.transition = `transform ${Math.max(80, this.settings.barExpandDuration)}ms ${this.settings.expandEasing}, opacity ${Math.max(40, this.settings.barFadeInDuration)}ms linear`;

    bar.appendChild(inner);
    this.barOverlay.appendChild(bar);

    requestAnimationFrame(() => {
      bar.style.transition = `width ${Math.max(80, this.settings.barExpandDuration)}ms ${this.settings.expandEasing}, left ${Math.max(80, this.settings.barExpandDuration)}ms ${this.settings.expandEasing}`;
      bar.style.width = `${w}px`;
      requestAnimationFrame(() => {
        inner.style.transform = "scaleX(1)";
        inner.style.opacity = "1";
      });
    });

    return true;
  }

  private getBgBarColorRaw(count: number) {
    const cols = [this.settings.barColor0, this.settings.barColor1, this.settings.barColor2, this.settings.barColor3];
    const ratio = count / Math.max(1, this.maxCount);
    const idx = ratio > 0.75 ? 3 : ratio > 0.5 ? 2 : ratio > 0.25 ? 1 : 0;
    return hexToRgb(cols[idx] || DEFAULT_SETTINGS.barColor1);
  }

  /* ---------- 待机（Idle）相关：字体透明 & 背景条亮显 ---------- */
  private bindIdleEvents() {
    const reset = () => {
      if (this.idleTimeout) clearTimeout(this.idleTimeout);

      this.containerEl.removeClass("idle");
      this.resetFontStyle();

      this.showBarsGray();
      this.showArrowsAndTextNormal();

      this.idleTimeout = setTimeout(() => {
        this.containerEl.addClass("idle");
        this.setIdleFontStyle();
        this.showBarsFullColor();
      }, this.settings.idleTimeout);
    };

    this._idleReset = reset;

    this.containerEl.addEventListener("mousemove", reset);
    this.containerEl.addEventListener("keydown", reset);
    this.containerEl.addEventListener("wheel", reset);
    this.containerEl.addEventListener("touchstart", reset);
    this.containerEl.addEventListener("mouseenter", reset);

    reset();
  }

  private unbindIdleEvents() {
    if (this._idleReset) {
      this.containerEl.removeEventListener("mousemove", this._idleReset);
      this.containerEl.removeEventListener("keydown", this._idleReset);
      this.containerEl.removeEventListener("wheel", this._idleReset);
      this.containerEl.removeEventListener("touchstart", this._idleReset);
      this.containerEl.removeEventListener("mouseenter", this._idleReset);
    }
    if (this.idleTimeout) clearTimeout(this.idleTimeout);
  }

  private resetFontStyle() {
    this.containerEl.style.color = "";
    const arrows = this.containerEl.querySelectorAll<HTMLElement>(".tag-tree-view-arrow");
    arrows.forEach(a => a.style.color = "");
  }

  private setIdleFontStyle() {
    this.containerEl.style.color = "transparent";
    const arrows = this.containerEl.querySelectorAll<HTMLElement>(".tag-tree-view-arrow");
    arrows.forEach(a => a.style.color = "transparent");
  }

  private showBarsGray() {
    if (!this.barOverlay) return;
    const bars = this.barOverlay.querySelectorAll<HTMLElement>(".tag-tree-view-bg-bar .bar-inner");
    bars.forEach((barInner) => {
      barInner.style.backgroundColor = `rgba(64,169,99,${this.settings.activeBarOpacity})`;
    });
  }

  private showBarsFullColor() {
    if (!this.barOverlay || !this.treeContainer) return;
    const bars = Array.from(this.barOverlay.querySelectorAll<HTMLElement>(".tag-tree-view-bg-bar .bar-inner"));
    bars.forEach((barInner) => {
      const parent = barInner.parentElement;
      const countAttr = parent?.getAttribute("data-count");
      const count = countAttr ? Number(countAttr) : 0;
      const raw = this.getBgBarColorRaw(count);
      barInner.style.backgroundColor = `rgba(${raw.r},${raw.g},${raw.b},${this.settings.idleBarAlpha})`;
    });
  }

  private showArrowsAndTextNormal() {
    const arrows = this.containerEl.querySelectorAll<HTMLElement>(".tag-tree-view-arrow");
    arrows.forEach(a => (a.style.color = ""));
    const flexes = this.containerEl.querySelectorAll<HTMLElement>(".tag-tree-view-flex-container");
    flexes.forEach(f => (f.style.color = ""));
  }

  /* ---------- 搜索标签（改为 tag:#tag 以匹配 frontmatter） ---------- */
  openSearchWithTag(tag: string) {
    const leaves = this.app.workspace.getLeavesOfType("search");
    const query = `tag:#${tag}`;
    if (leaves.length === 0) {
      (this.app as any).commands.executeCommandById("app:open-search");
      setTimeout(() => {
        const newLeaves = this.app.workspace.getLeavesOfType("search");
        if (newLeaves.length > 0) this.focusAndSetSearch(newLeaves[0], query);
      }, 200);
    } else {
      this.app.workspace.setActiveLeaf(leaves[0], { focus: true });
      this.focusAndSetSearch(leaves[0], query);
    }
  }

  private focusAndSetSearch(leaf: WorkspaceLeaf, query: string) {
    const input = leaf.view.containerEl.querySelector('input[type="search"]') as HTMLInputElement | null;
    if (input) {
      input.value = query;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.selectionStart = input.selectionEnd = input.value.length;
      input.focus();
    }
  }

  /* ---------- 单文件 cache 变更处理（差异化） ---------- */
  private handleSingleFileCacheChange(path: string, cacheTags: string[], file?: TFile) {
    const old = this.perFileTagMap[path] || [];
    const oldSet = new Set(old);
    const newSet = new Set(cacheTags);

    const added: string[] = [];
    const removed: string[] = [];

    for (const t of newSet) if (!oldSet.has(t)) added.push(t);
    for (const t of oldSet) if (!newSet.has(t)) removed.push(t);

    if (added.length === 0 && removed.length === 0) {
      return;
    }

    const mtime = file && file.stat && (file.stat.mtime || file.stat.mtime != null) ? (file.stat.mtime as unknown as number) : Date.now();

    for (const t of added) {
      const prev = this.tagCounts[t] || 0;
      this.tagCounts[t] = prev + 1;
      this.tagLastUsed[t] = Math.max(this.tagLastUsed[t] || 0, mtime);
    }
    for (const t of removed) {
      const prev = this.tagCounts[t] || 0;
      const now = Math.max(0, prev - 1);
      if (now === 0) { delete this.tagCounts[t]; delete this.tagLastUsed[t]; } else this.tagCounts[t] = now;
    }

    this.perFileTagMap[path] = cacheTags;
    this.maxCount = Math.max(...Object.values(this.tagCounts), 1);

    if (added.length > 0) this.handleTagsAdded(added);
    if (removed.length > 0) this.handleTagsRemoved(removed);

    const changed = [...added, ...removed];
    if (changed.length > 0) this.updateCountsAndBars(changed);
  }

  /* ---------- 拖拽：立即生效，输出纯文本 "#tag" ---------- */
  private attachDragHandlers(el: HTMLElement, fullpath: string) {
    if ((el as any).__dragHandlersAttached) return;
    (el as any).__dragHandlersAttached = true;

    // 立即可拖拽
    el.draggable = true;

    el.addEventListener("dragstart", (e: DragEvent) => {
      try {
        const tagText = `#${fullpath}`; // 插入时只输出纯文本 #fullpath（无尾空格）
        if (e.dataTransfer) {
          e.dataTransfer.setData("text/plain", tagText);
          e.dataTransfer.setData("application/x-tag", fullpath);
          // 尝试设置拖拽图像（复制节点）
          try {
            const crt = el.cloneNode(true) as HTMLElement;
            crt.style.position = "absolute";
            crt.style.left = "-9999px";
            document.body.appendChild(crt);
            e.dataTransfer.setDragImage(crt, 8, 8);
            setTimeout(() => crt.remove(), 50);
          } catch (err) {
            // ignore
          }
        }
      } catch (err) {}
      el.classList.add("tag-tree-dragging");
    });

    el.addEventListener("dragend", (e: DragEvent) => {
      el.classList.remove("tag-tree-dragging");
    });
  }

  /* ---------- 文档 drop 处理：支持 input/textarea/contenteditable/Obsidian 编辑器 ---------- */
  private async handleDocumentDrop(e: DragEvent) {
    if (!e.dataTransfer) return;
    const tag = (e.dataTransfer.getData("application/x-tag") || "").trim();
    const text = (e.dataTransfer.getData("text/plain") || "").trim();
    if (!tag && !text) return;

    e.preventDefault();
    e.stopPropagation();

    // 使用落点优先策略：如果 drop 目标是在一个 input/textarea/contenteditable 元素上，
    // 则把纯文本 "#fullpath" 插入到该输入的光标位置；否则插入到当前活动 Markdown 编辑器
    const target = e.target as HTMLElement | null;
    if (target) {
      // 最近的 input 或 textarea
      const inputEl = target.closest("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null;
      if (inputEl) {
        try {
          const insertion = text || `#${tag}`;
          // 插入到当前光标位置（一些 third-party 输入框可能不支持 selectionStart）
          const start = (inputEl.selectionStart ?? inputEl.value.length);
          const end = (inputEl.selectionEnd ?? start);
          const before = inputEl.value.slice(0, start);
          const after = inputEl.value.slice(end);
          inputEl.value = before + insertion + after;
          inputEl.dispatchEvent(new Event("input", { bubbles: true }));
          inputEl.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        } catch (err) {
          console.warn("插入到输入框失败：", err);
        }
      }

      // contenteditable 区域（div[contenteditable=true] 等）
      const editable = target.closest("[contenteditable='true']") as HTMLElement | null;
      if (editable) {
        try {
          const insertion = text || `#${tag}`;
          const sel = document.getSelection();
          if (sel && sel.rangeCount > 0 && editable.contains(sel.anchorNode)) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const node = document.createTextNode(insertion);
            range.insertNode(node);
            // 将光标移动到插入之后
            range.setStartAfter(node);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            // 触发 input 事件
            editable.dispatchEvent(new Event("input", { bubbles: true }));
            return;
          } else {
            // fallback: append to editable
            editable.appendChild(document.createTextNode(insertion));
            editable.dispatchEvent(new Event("input", { bubbles: true }));
            return;
          }
        } catch (err) {
          console.warn("插入到 contenteditable 失败：", err);
        }
      }
    }

    // 否则插入到当前活动的 Markdown 编辑器（如果存在）
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mdView) return;
    const editor = mdView.editor;
    if (!editor) return;
    const insertText = text || `#${tag}`;
    editor.replaceSelection(insertText);
    editor.focus();
  }

  /* ---------- 其余 small helpers ---------- */
  accumulateCounts(node: TagNode): number {
    if (node.children.size === 0) return node.count;
    let total = node.count;
    node.children.forEach(child => { total += this.accumulateCounts(child); });
    node.count = total;
    return total;
  }

  private collectDescendantFullPathsSimple(node: TagNode) { return this.collectDescendantFullPaths(node); }
}

/* ---------- 帮助函数 ---------- */
function arrayEqual(a: string[] | undefined, b: string[] | undefined) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const sa = Array.from(a).sort();
  const sb = Array.from(b).sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}
