// main.ts
import { App, ItemView, Plugin, WorkspaceLeaf, PluginSettingTab, Setting, TFile } from "obsidian";

const VIEW_TYPE_TAG_TREE = "tag-tree-view";

interface TagNode {
  name: string;
  fullPath: string;
  count: number;
  children: Map<string, TagNode>;
  expanded: boolean;
}

interface Settings {
  idleTimeout: number;
  activeBarOpacity: number;
  idleBarAlpha: number;
  expandDuration: number;
  expandEasing: string;
  maxBarWidth: number;
  barAnimationDuration: number;
  barFadeDuration: number;
  subTagIndent: number;
  sidePadding: number;
  metadataDebounceMs: number;

  barExpandDuration: number;
  barCollapseDuration: number;
  barFadeInDuration: number;
  barFadeOutDuration: number;

  barColor0: string;
  barColor1: string;
  barColor2: string;
  barColor3: string;

  rightPadding: number;
  frontmatterReadDelay: number;
  barPreheatExpandMs: number;
  barPreheatCollapseMs: number;

  barCornerRadius: number; // 新增：背景条圆角（px）
}

const DEFAULT_SETTINGS: Settings = {
  idleTimeout: 8000,
  activeBarOpacity: 0.30,
  idleBarAlpha: 0.95,
  expandDuration: 320,
  expandEasing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  maxBarWidth: 150,
  barAnimationDuration: 320,
  barFadeDuration: 200,
  subTagIndent: 9,
  sidePadding: 16,
  metadataDebounceMs: 40,

  barExpandDuration: 240,
  barCollapseDuration: 200,
  barFadeInDuration: 160,
  barFadeOutDuration: 120,

  barColor0: "#9BE9A8",
  barColor1: "#40C463",
  barColor2: "#30A14E",
  barColor3: "#216E39",

  rightPadding: 12,
  frontmatterReadDelay: 80,
  barPreheatExpandMs: 80,
  barPreheatCollapseMs: 40,

  barCornerRadius: 3,
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
        if (leaf == null) leaf = this.app.workspace.getLeaf(true);
        leaf.setViewState({ type: VIEW_TYPE_TAG_TREE, active: true });
        this.app.workspace.revealLeaf(leaf);
      },
    });

    this.addSettingTab(new TagTreeSettingTab(this.app, this));

    const style = document.createElement("style");
    style.id = "tag-tree-plugin-style";
    style.textContent = `
      .tag-tree-view-container { transition: color 1s ease; color: inherit; background-color: transparent; height:100%; overflow-y:auto; box-sizing:border-box; font-size:13px; user-select:none; }
      .tag-tree-view-container.idle { color: transparent !important; }

      ul.tag-tree-ul { list-style:none; padding-left:0 !important; margin-left:0 !important; }
      li.tag-tree-li { position:relative; padding-left:18px; margin-bottom:6px; height:22px; line-height:22px; z-index:3; }

      .tag-tree-view-arrow { display:inline-block; width:16px; position:absolute; left:0; top:50%; transform:translateY(-50%); cursor:pointer; user-select:none; transition: color 0.2s ease; z-index:6; }
      .tag-tree-view-arrow svg { display:block; width:12px; height:12px; transition: transform 220ms var(--easing, cubic-bezier(0.2,0.8,0.2,1)); transform-origin:center; }
      .tag-tree-view-arrow.expanded svg { transform: rotate(90deg); }

      .tag-tree-view-flex-container { display:flex; justify-content:space-between; align-items:center; position:relative; z-index:7; color:inherit; user-select:text; height:22px; }
      .tag-tree-view-flex-container .tag-name { cursor:pointer; }
      .tag-tree-view-count { flex:0 0 48px; text-align:right; color:var(--text-muted); padding-left:8px; }

      .tag-tree-bar-overlay { position:absolute; inset:0; pointer-events:none; z-index:1; }
      .tag-tree-view-bg-bar { position:absolute; height:22px; pointer-events:none; overflow:hidden; will-change:left,transform,width,opacity; }
      .tag-tree-view-bg-bar .bar-inner { position:absolute; left:0; top:0; bottom:0; right:0; transform-origin:left center; will-change:transform,opacity,background-color; }

      ul.tag-tree-children { list-style:none; padding-left:0 !important; margin-left:0 !important; overflow:hidden; max-height:0; opacity:0; transition-property:max-height,opacity; }

      .tag-tree-settings-hr { height:1px; border:none; margin:12px 0; background-color: var(--interactive-accent, var(--accent, #40C463)); opacity:0.12; }
      .tag-tree-settings-group-title { margin: 6px 0 8px 0; font-weight:600; font-size:13px; color: var(--text-normal); }
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

/* Settings Tab（重构分组与排版） */
class TagTreeSettingTab extends PluginSettingTab {
  plugin: TagTreePlugin;
  constructor(app: App, plugin: TagTreePlugin) { super(app, plugin); this.plugin = plugin; }

  private hr(container: HTMLElement) { container.createEl("hr", { cls: "tag-tree-settings-hr" }); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "标签树设置" });

    // ===== Heat Update（热更新） =====
    containerEl.createEl("div", { text: "热更新（Heat Update）", cls: "tag-tree-settings-group-title" });
    new Setting(containerEl).setName("Metadata debounce (ms)")
      .setDesc("处理 metadata 变更时的防抖时间（毫秒），较小值更实时但会增加处理频率。")
      .addText(t => t.setValue(String(this.plugin.settings.metadataDebounceMs)).onChange(async v => { this.plugin.settings.metadataDebounceMs = Number(v) || DEFAULT_SETTINGS.metadataDebounceMs; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Frontmatter read delay (ms)")
      .setDesc("当 cache 未包含 frontmatter 时，延迟读取文件内容解析 frontmatter（毫秒）。")
      .addText(t => t.setValue(String(this.plugin.settings.frontmatterReadDelay)).onChange(async v => { this.plugin.settings.frontmatterReadDelay = Number(v) || DEFAULT_SETTINGS.frontmatterReadDelay; await this.plugin.saveSettings(); }));

    this.hr(containerEl);

    // ===== Animation（动画效果） =====
    containerEl.createEl("div", { text: "动画（Animation）", cls: "tag-tree-settings-group-title" });

    new Setting(containerEl).setName("Slide duration (ms)")
      .setDesc("展开/收起子列表时的高度动画时长（毫秒）。")
      .addText(t => t.setValue(String(this.plugin.settings.expandDuration)).onChange(async v => { this.plugin.settings.expandDuration = Number(v) || DEFAULT_SETTINGS.expandDuration; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Slide easing")
      .setDesc("展开/收起高度动画的缓动曲线（cubic-bezier 或关键字）。")
      .addText(t => t.setValue(this.plugin.settings.expandEasing).onChange(async v => { this.plugin.settings.expandEasing = v || DEFAULT_SETTINGS.expandEasing; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Bar expand (ms)")
      .setDesc("背景条横向伸展动画时长（毫秒）。")
      .addText(t => t.setValue(String(this.plugin.settings.barExpandDuration)).onChange(async v => { this.plugin.settings.barExpandDuration = Number(v) || DEFAULT_SETTINGS.barExpandDuration; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Bar collapse (ms)")
      .setDesc("背景条横向收缩动画时长（毫秒）。")
      .addText(t => t.setValue(String(this.plugin.settings.barCollapseDuration)).onChange(async v => { this.plugin.settings.barCollapseDuration = Number(v) || DEFAULT_SETTINGS.barCollapseDuration; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Bar fade in (ms)")
      .setDesc("背景条渐显动画时长（毫秒）。")
      .addText(t => t.setValue(String(this.plugin.settings.barFadeInDuration)).onChange(async v => { this.plugin.settings.barFadeInDuration = Number(v) || DEFAULT_SETTINGS.barFadeInDuration; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Bar fade out (ms)")
      .setDesc("背景条渐隐动画时长（毫秒）。")
      .addText(t => t.setValue(String(this.plugin.settings.barFadeOutDuration)).onChange(async v => { this.plugin.settings.barFadeOutDuration = Number(v) || DEFAULT_SETTINGS.barFadeOutDuration; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Bar preheat (expand, ms)")
      .setDesc("展开时，背景条提前启动（毫秒），用于高度动画与背景条的连贯性。")
      .addText(t => t.setValue(String(this.plugin.settings.barPreheatExpandMs)).onChange(async v => { this.plugin.settings.barPreheatExpandMs = Number(v) || DEFAULT_SETTINGS.barPreheatExpandMs; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Bar preheat (collapse, ms)")
      .setDesc("收起时的预热设置（毫秒）。")
      .addText(t => t.setValue(String(this.plugin.settings.barPreheatCollapseMs)).onChange(async v => { this.plugin.settings.barPreheatCollapseMs = Number(v) || DEFAULT_SETTINGS.barPreheatCollapseMs; await this.plugin.saveSettings(); }));

    this.hr(containerEl);

    // ===== Layout（面板布局） =====
    containerEl.createEl("div", { text: "面板布局（Layout）", cls: "tag-tree-settings-group-title" });

    new Setting(containerEl).setName("Side padding (px)")
      .setDesc("插件内容与容器左右的距离（像素）。")
      .addText(t => t.setValue(String(this.plugin.settings.sidePadding)).onChange(async v => { this.plugin.settings.sidePadding = Number(v) || DEFAULT_SETTINGS.sidePadding; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Sub-tag indent (px)")
      .setDesc("子标签名称相对于父标签的缩进距离（像素）。注意背景条不会缩进，只是文字缩进。")
      .addText(t => t.setValue(String(this.plugin.settings.subTagIndent)).onChange(async v => { this.plugin.settings.subTagIndent = Number(v) || DEFAULT_SETTINGS.subTagIndent; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Right padding (px)")
      .setDesc("背景条在计算最大宽度时留在右侧的额外空白（像素）。")
      .addText(t => t.setValue(String(this.plugin.settings.rightPadding)).onChange(async v => { this.plugin.settings.rightPadding = Number(v) || DEFAULT_SETTINGS.rightPadding; await this.plugin.saveSettings(); }));

    this.hr(containerEl);

    // ===== Personalization（个性化——颜色 / 圆角 / 透明度） =====
    containerEl.createEl("div", { text: "个性化（Personalization）", cls: "tag-tree-settings-group-title" });

    try {
      new Setting(containerEl).setName("Bar color — lowest").setDesc("四档颜色：最低档。")
        .addColorPicker(cb => cb.setValue(this.plugin.settings.barColor0).onChange(async (v) => { this.plugin.settings.barColor0 = v; await this.plugin.saveSettings(); }));
      new Setting(containerEl).setName("Bar color — low").setDesc("四档颜色：低档。")
        .addColorPicker(cb => cb.setValue(this.plugin.settings.barColor1).onChange(async (v) => { this.plugin.settings.barColor1 = v; await this.plugin.saveSettings(); }));
      new Setting(containerEl).setName("Bar color — mid").setDesc("四档颜色：中档。")
        .addColorPicker(cb => cb.setValue(this.plugin.settings.barColor2).onChange(async (v) => { this.plugin.settings.barColor2 = v; await this.plugin.saveSettings(); }));
      new Setting(containerEl).setName("Bar color — high").setDesc("四档颜色：高档。")
        .addColorPicker(cb => cb.setValue(this.plugin.settings.barColor3).onChange(async (v) => { this.plugin.settings.barColor3 = v; await this.plugin.saveSettings(); }));
    } catch (e) {
      new Setting(containerEl).setName("Bar color — lowest (hex)").setDesc("四档颜色：最低档（十六进制）。").addText(t => t.setValue(this.plugin.settings.barColor0).onChange(async v => { this.plugin.settings.barColor0 = v || DEFAULT_SETTINGS.barColor0; await this.plugin.saveSettings(); }));
      new Setting(containerEl).setName("Bar color — low (hex)").setDesc("四档颜色：低档（十六进制）。").addText(t => t.setValue(this.plugin.settings.barColor1).onChange(async v => { this.plugin.settings.barColor1 = v || DEFAULT_SETTINGS.barColor1; await this.plugin.saveSettings(); }));
      new Setting(containerEl).setName("Bar color — mid (hex)").setDesc("四档颜色：中档（十六进制）。").addText(t => t.setValue(this.plugin.settings.barColor2).onChange(async v => { this.plugin.settings.barColor2 = v || DEFAULT_SETTINGS.barColor2; await this.plugin.saveSettings(); }));
      new Setting(containerEl).setName("Bar color — high (hex)").setDesc("四档颜色：高档（十六进制）。").addText(t => t.setValue(this.plugin.settings.barColor3).onChange(async v => { this.plugin.settings.barColor3 = v || DEFAULT_SETTINGS.barColor3; await this.plugin.saveSettings(); }));
    }

    new Setting(containerEl).setName("Bar corner radius (px)")
      .setDesc("背景条圆角（像素）。")
      .addText(t => t.setValue(String(this.plugin.settings.barCornerRadius)).onChange(async v => { this.plugin.settings.barCornerRadius = Number(v) || DEFAULT_SETTINGS.barCornerRadius; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Active bar opacity").setDesc("活动状态时，背景条的不透明度（0–1）。")
      .addText(t => t.setValue(String(this.plugin.settings.activeBarOpacity)).onChange(async v => { this.plugin.settings.activeBarOpacity = Math.max(0, Math.min(1, Number(v) || DEFAULT_SETTINGS.activeBarOpacity)); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Idle bar alpha").setDesc("空闲状态时，背景条的 alpha（0–1）。")
      .addText(t => t.setValue(String(this.plugin.settings.idleBarAlpha)).onChange(async v => { this.plugin.settings.idleBarAlpha = Math.max(0, Math.min(1, Number(v) || DEFAULT_SETTINGS.idleBarAlpha)); await this.plugin.saveSettings(); }));

    this.hr(containerEl);

    // ===== Idle timeout（进入空闲状态的无操作时长） =====
    containerEl.createEl("div", { text: "空闲（Idle）设置", cls: "tag-tree-settings-group-title" });
    new Setting(containerEl)
      .setName("进入空闲的无操作时长（ms）")
      .setDesc("在面板内没有交互（鼠标/键盘/触摸/滚轮/悬停）达到该时间后进入空闲状态（字体透明并显示高亮背景条）。")
      .addText(text => text
        .setValue(String(this.plugin.settings.idleTimeout ?? DEFAULT_SETTINGS.idleTimeout))
        .onChange(async (v) => {
          const n = Number(v);
          this.plugin.settings.idleTimeout = Number.isNaN(n) ? DEFAULT_SETTINGS.idleTimeout : Math.max(0, Math.floor(n));
          await this.plugin.saveSettings();
        })
      );
  }
}

/* helpers */
function escSelector(s: string) {
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

/* parse YAML frontmatter helper */
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
    const parts = inner.split(",").map(s => s.replace(/['"]/g, "").trim()).filter(Boolean);
    for (const p of parts) res.push(p.startsWith("#") ? p.slice(1) : p);
    return Array.from(new Set(res));
  }

  if (/^["'].*["']$/.test(tail) || tail.indexOf(",") !== -1) {
    const cleaned = tail.replace(/^["']|["']$/g, "");
    const parts = cleaned.split(",").map(s => s.trim()).filter(Boolean);
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

/* inline tag regex helper */
const INLINE_TAG_RE = /(?:^|\s|[^\\\w-])#([\u4e00-\u9fff\w\/\-_]+)/g;

/* TagTreeView （核心实现保留之前的成熟逻辑，略去部分重复注释，关注已修改点） */
class TagTreeView extends ItemView {
  public readonly app: App;
  private settings: Settings;
  private rootNode: TagNode | null = null;
  private maxCount = 0;
  private idleTimeout: ReturnType<typeof setTimeout> | null = null;
  private treeContainer: HTMLElement | null = null;
  private barOverlay: HTMLElement | null = null;
  private _idleReset: (() => void) | null = null;
  private readonly rowHeight = 22;

  private perFileTagMap: Record<string, string[]> = {};
  private tagCounts: Record<string, number> = {};

  private pendingFilesForMeta: Set<string> = new Set();
  private metaTimer: number | null = null;

  private modifyTimers: Record<string, number> = {};
  private rafId: number | null = null;
  private overlaySyncEndAt = 0;
  private overlayInstantUntil = 0;
  private lastRebuildTime = 0;

  private resizeObserver: ResizeObserver | null = null;

  private creatingDuringExpand = false;
  private currentOpId = 0;

  constructor(leaf: WorkspaceLeaf, app: App, settings: Settings) {
    super(leaf);
    this.app = app;
    this.settings = settings;
  }

  getViewType() { return VIEW_TYPE_TAG_TREE; }
  getDisplayText() { return "标签树状面板"; }

  async onOpen(): Promise<void> {
    this.containerEl.empty();
    this.containerEl.addClass("tag-tree-view-container");
    this.containerEl.style.paddingLeft = `${this.settings.sidePadding}px`;
    this.containerEl.style.paddingRight = `${this.settings.sidePadding}px`;
    this.containerEl.style.paddingTop = `16px`;
    this.containerEl.style.paddingBottom = `12px`;

    await this.initializePerFileMapAndCounts();

    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.extension === "md") this.onFileCreated(file);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile && file.extension === "md") this.onFileDeleted(file);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile) this.onFileRenamed(file, oldPath);
    }));

    // vault.modify: cache-first 快速检测
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      const p = file.path;

      if (this.modifyTimers[p]) { clearTimeout(this.modifyTimers[p]); delete this.modifyTimers[p]; }

      this.modifyTimers[p] = window.setTimeout(async () => {
        delete this.modifyTimers[p];

        const cache = this.app.metadataCache.getFileCache(file);
        const cacheTags = this.getTagsFromCacheDirect(cache);

        if (!arrayEqual(cacheTags, this.perFileTagMap[p])) {
          this.handleSingleFileCacheChange(p, cacheTags);
          return;
        }

        // fallback: 读盘解析（若 cache 没有变化）
        const fileTags = await this.getTagsFromFileAsync(p);
        if (!arrayEqual(fileTags, this.perFileTagMap[p])) {
          this.handleSingleFileCacheChange(p, fileTags);
          return;
        }
      }, Math.max(12, Math.min(120, this.settings.metadataDebounceMs)));
    }));

    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;

      const cache = this.app.metadataCache.getFileCache(file);
      const cacheTags = this.getTagsFromCacheDirect(cache);
      const prev = this.perFileTagMap[file.path] || [];
      if (!arrayEqual(cacheTags, prev)) {
        this.pendingFilesForMeta.delete(file.path);
        this.handleSingleFileCacheChange(file.path, cacheTags);
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

    this.treeContainer = this.containerEl.createDiv();
    this.treeContainer.className = "tag-tree-root";
    this.treeContainer.style.position = "relative";

    this.barOverlay = this.treeContainer.createDiv("tag-tree-bar-overlay");
    this.barOverlay.style.position = "absolute";
    this.barOverlay.style.left = "0";
    this.barOverlay.style.top = "0";
    this.barOverlay.style.right = "0";
    this.barOverlay.style.bottom = "0";
    this.barOverlay.style.pointerEvents = "none";
    this.barOverlay.style.zIndex = "1";

    this.resizeObserver = new ResizeObserver(() => {
      this.rebuildOverlayBars();
      this.startOverlaySync(Math.max(200, this.settings.expandDuration));
    });
    if (this.treeContainer) this.resizeObserver.observe(this.treeContainer);

    this.rootNode = this.buildTagTree(this.tagCounts);
    this.accumulateCounts(this.rootNode);
    this.maxCount = Math.max(...Object.values(this.tagCounts), 1);

    this.renderTree(true);
  }

  async onClose(): Promise<void> {
    this.unbindIdleEvents();
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    if (this.resizeObserver && this.treeContainer) { this.resizeObserver.unobserve(this.treeContainer); this.resizeObserver.disconnect(); this.resizeObserver = null; }
  }

  // ---------- metadata helpers ----------
  private async initializePerFileMapAndCounts() {
    const files = this.app.vault.getMarkdownFiles();
    this.perFileTagMap = {};
    this.tagCounts = {};
    for (const f of files) {
      const tags = this.getTagsFromFileCache(f);
      this.perFileTagMap[f.path] = tags;
      for (const t of tags) this.tagCounts[t] = (this.tagCounts[t] || 0) + 1;
    }
    this.maxCount = Math.max(...Object.values(this.tagCounts), 1);
  }

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
          const parts = fmTags.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
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
        const parts = fm.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
        for (const p of parts) {
          let v = p;
          if (v.startsWith("#")) v = v.slice(1);
          if (v) set.add(v);
        }
      }
    }
    return Array.from(set);
  }

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
        else if (typeof fmTags === "string") frontTagsFromCache = (fmTags.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean));
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

  private async onFileCreated(file: TFile) {
    const newTags = await this.getTagsFromFileAsync(file.path);
    this.perFileTagMap[file.path] = newTags;
    const added: string[] = [];
    for (const t of newTags) {
      const prev = this.tagCounts[t] || 0;
      this.tagCounts[t] = prev + 1;
      if (prev === 0) added.push(t);
    }
    this.maxCount = Math.max(...Object.values(this.tagCounts), 1);

    if (added.length > 0) {
      this.rootNode = this.buildTagTree(this.tagCounts);
      this.accumulateCounts(this.rootNode);
      this.maxCount = Math.max(...Object.values(this.tagCounts), 1);
      this.renderTree(false);
      nextAnimationFrame().then(() => nextAnimationFrame()).then(() => {
        for (const t of added) {
          this.createBarForFullpathWithRetry(t, 6).then(ok => {
            if (!ok) this.scheduleOverlayRebuild(120);
          });
        }
        this.startOverlaySync(this.settings.expandDuration + 80);
      });
    } else {
      const affected = newTags.filter(t => !!(this.treeContainer?.querySelector(`li.tag-tree-li[data-fullpath="${escSelector(t)}"]`)));
      if (affected.length > 0) this.updateCountsAndBars(affected);
    }
  }

  private onFileDeleted(file: TFile) {
    const oldTags = this.perFileTagMap[file.path] || [];
    delete this.perFileTagMap[file.path];
    const removed: string[] = [];
    for (const t of oldTags) {
      const prev = this.tagCounts[t] || 0;
      const now = Math.max(0, prev - 1);
      if (now === 0) { delete this.tagCounts[t]; removed.push(t); } else this.tagCounts[t] = now;
    }
    this.maxCount = Math.max(...Object.values(this.tagCounts), 1);

    if (removed.length > 0) {
      this.rootNode = this.buildTagTree(this.tagCounts);
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
      void this.onFileCreated(file);
    }
  }

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
    }

    this.maxCount = Math.max(...Object.values(this.tagCounts), 1);

    if (globallyAdded.size > 0) await this.handleTagsAdded(Array.from(globallyAdded));
    if (globallyRemoved.size > 0) this.handleTagsRemoved(Array.from(globallyRemoved));
    if (changedTagsSet.size > 0) this.updateCountsAndBars(Array.from(changedTagsSet));

    const recheckDelay = Math.max(40, (this.settings.frontmatterReadDelay || DEFAULT_SETTINGS.frontmatterReadDelay) * 2);
    setTimeout(async () => {
      const recheckPaths = paths.filter(p => {
        return !!this.app.vault.getAbstractFileByPath(p);
      });
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

  private overlayRebuildTimer: number | null = null;
  private useRequestIdle = typeof (window as any).requestIdleCallback === "function";

  private scheduleOverlayRebuild(delay = 160) {
    if (this.overlayRebuildTimer) { clearTimeout(this.overlayRebuildTimer); this.overlayRebuildTimer = null; }
    if (this.useRequestIdle) {
      try {
        (window as any).requestIdleCallback(() => { this.rebuildOverlayBars(); }, { timeout: delay });
        return;
      } catch (e) {}
    }
    this.overlayRebuildTimer = window.setTimeout(() => {
      this.rebuildOverlayBars();
      this.overlayRebuildTimer = null;
    }, delay);
  }

  private async handleTagsAdded(tags: string[]) {
    this.rootNode = this.buildTagTree(this.tagCounts);
    this.accumulateCounts(this.rootNode);
    this.maxCount = Math.max(...Object.values(this.tagCounts), 1);

    this.renderTree(false);

    await nextAnimationFrame();
    await nextAnimationFrame();
    for (const t of tags) {
      this.createBarForFullpathWithRetry(t, 6).then(ok => {
        if (!ok) this.scheduleOverlayRebuild(120);
      });
    }
    this.startOverlaySync(this.settings.expandDuration + 80);
  }

  private handleTagsRemoved(tags: string[]) {
    this.rootNode = this.buildTagTree(this.tagCounts);
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
    if (!this.barOverlay) return;
    for (const t of tags) {
      const li = this.treeContainer?.querySelector<HTMLLIElement>(`li.tag-tree-li[data-fullpath="${escSelector(t)}"]`);
      if (li) {
        const cnt = li.querySelector<HTMLElement>(".tag-tree-view-count");
        if (cnt) cnt.textContent = String(this.tagCounts[t] || 0);
      }
    }

    for (const t of tags) {
      const sel = `.tag-tree-view-bg-bar[data-fullpath="${escSelector(t)}"]`;
      const b = this.barOverlay.querySelector<HTMLElement>(sel);
      const count = this.tagCounts[t] || 0;

      if (!this.treeContainer) continue;
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

    if (rebuildOverlay) {
      this.rebuildOverlayBars();
    } else {
      this.startOverlaySync(this.settings.expandDuration + 80);
    }
  }

  private renderNode(node: TagNode, container: HTMLElement, level: number, parentAlignLeft: number | null) {
    if (node.name === "") {
      node.children.forEach(child => this.renderNode(child, container, level, parentAlignLeft));
      return;
    }

    const li = document.createElement("li");
    li.className = "tag-tree-li";
    (li as HTMLElement).dataset.fullPath = node.fullPath;
    li.style.position = "relative";
    li.style.height = `${this.rowHeight}px`;
    li.style.zIndex = "3";

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
    flex.style.marginLeft = `${this.settings.subTagIndent * (level + 1)}px`;
    const nameSpan = document.createElement("span");
    nameSpan.className = "tag-name";
    nameSpan.textContent = node.name;
    nameSpan.onclick = (e) => { e.stopPropagation(); this.openSearchWithTag(node.fullPath); };
    flex.appendChild(nameSpan);

    const cnt = document.createElement("span");
    cnt.className = "tag-tree-view-count";
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
      const bar = document.createElement("div");
      bar.className = "tag-tree-view-bg-bar";
      bar.setAttribute("data-fullpath", node.fullPath);
      bar.setAttribute("data-count", String(node.count));

      const containerClientWidth = this.treeContainer.clientWidth || (treeRect.right - treeRect.left);
      const rightPadding = Number(this.settings.rightPadding || DEFAULT_SETTINGS.rightPadding);
      const available = Math.max(40, containerClientWidth - alignLeft - rightPadding);
      const actualMaxBarWidth = Math.min(this.settings.maxBarWidth, available);

      const w = (node.count / Math.max(1, this.maxCount)) * actualMaxBarWidth;
      bar.style.left = `${alignLeft}px`;
      bar.style.transform = `translateY(${liRect.top - treeRect.top}px)`;
      bar.style.width = `${w}px`;
      bar.style.height = `${liRect.height}px`;
      bar.style.borderRadius = `${this.settings.barCornerRadius}px`;

      const raw = this.getBgBarColorRaw(node.count);
      const inner = document.createElement("div");
      inner.className = "bar-inner";

      inner.style.borderRadius = `${this.settings.barCornerRadius}px`;
      if (this.creatingDuringExpand) {
        inner.style.backgroundColor = this.containerEl.hasClass("idle")
          ? `rgba(${raw.r},${raw.g},${raw.b},${this.settings.idleBarAlpha})`
          : `rgba(${raw.r},${raw.g},${raw.b},${this.settings.activeBarOpacity})`;
        inner.style.transition = `transform ${Math.max(80, this.settings.barExpandDuration)}ms ${this.settings.expandEasing}, opacity ${Math.max(40, this.settings.barFadeInDuration)}ms linear, background-color 200ms linear`;
        inner.style.transformOrigin = "left center";
        inner.style.transform = "scaleX(0)";
        inner.style.opacity = "0";
        bar.setAttribute("data-new", "1");
      } else {
        inner.style.backgroundColor = this.containerEl.hasClass("idle")
          ? `rgba(${raw.r},${raw.g},${raw.b},${this.settings.idleBarAlpha})`
          : `rgba(${raw.r},${raw.g},${raw.b},${this.settings.activeBarOpacity})`;
        inner.style.transition = `transform ${Math.max(80, this.settings.barAnimationDuration)}ms ${this.settings.expandEasing}, opacity ${Math.max(40, this.settings.barFadeDuration)}ms linear, background-color 200ms linear`;
        inner.style.transformOrigin = "left center";
        inner.style.transform = "scaleX(1)";
        inner.style.opacity = "1";
        bar.setAttribute("data-new", "0");
      }

      bar.appendChild(inner);
      this.barOverlay.appendChild(bar);
    }

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
      node.children.forEach((child) => this.renderNode(child, ul, level + 1, alignLeft));
      this.creatingDuringExpand = false;

      container.appendChild(ul);

      requestAnimationFrame(() => {
        const fullH = ul.scrollHeight;
        ul.style.maxHeight = `${fullH}px`;
        ul.style.opacity = "1";
        const onEnd = (e: TransitionEvent) => {
          if (e.propertyName === "max-height") {
            ul.style.maxHeight = "none";
            ul.removeEventListener("transitionend", onEnd);
          }
        };
        ul.addEventListener("transitionend", onEnd);

        this.startOverlaySync(this.settings.expandDuration + 80);
      });
    }
  }

  private updateSubtreeRender(parentLi: HTMLElement, node: TagNode, level: number) {
    const opId = ++this.currentOpId;

    let siblingUl = parentLi.nextElementSibling;
    if (siblingUl && siblingUl.classList.contains("tag-tree-children")) {
      const descendants = this.collectDescendantFullPaths(node);
      descendants.forEach(fp => {
        const selBar = `.tag-tree-view-bg-bar[data-fullpath="${escSelector(fp)}"]`;
        const barEl = this.barOverlay?.querySelector<HTMLElement>(selBar);
        if (barEl) {
          const treeRect = this.treeContainer!.getBoundingClientRect();
          const top = barEl.getBoundingClientRect().top - treeRect.top;
          barEl.setAttribute("data-locked-top", String(top));
        }
      });

      const collapsePlayPromise = this.playBarsCollapse(descendants, opId);

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
        current.offsetHeight;
        current.style.maxHeight = "0px";
        current.style.opacity = "0";

        const onEnd = (e: TransitionEvent) => {
          if (e.propertyName === "max-height") {
            current.removeEventListener("transitionend", onEnd);
            current.remove();
            descendants.forEach(fp => {
              const selBar = `.tag-tree-view-bg-bar[data-fullpath="${escSelector(fp)}"]`;
              const b = this.barOverlay?.querySelector<HTMLElement>(selBar);
              if (b) b.remove();
            });
            Array.from(this.barOverlay?.querySelectorAll<HTMLElement>(".tag-tree-view-bg-bar") || []).forEach(b => b.removeAttribute("data-locked-top"));
            this.rebuildOverlayBars();
          }
        };
        current.addEventListener("transitionend", onEnd);
      }, heightStartAfter);

      const syncDur = Math.max(this.settings.barCollapseDuration, this.settings.expandDuration) + 160;
      this.startOverlaySync(syncDur);

      if (this._idleReset) this._idleReset();
      return;
    }

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
      node.children.forEach((child) => this.renderNode(child, ul, level + 1, alignLeft));
      this.creatingDuringExpand = false;

      parentLi.parentElement!.insertBefore(ul, parentLi.nextSibling);

      requestAnimationFrame(() => {
        const full = ul.scrollHeight;
        ul.style.maxHeight = `${full}px`;
        ul.style.opacity = "1";

        const startOffset = Math.max(0, (this.settings.expandDuration || 0) - (this.settings.barPreheatExpandMs || DEFAULT_SETTINGS.barPreheatExpandMs));

        const startBarsTimer = window.setTimeout(() => {
          if (opId !== this.currentOpId) return;
          const descendants = this.collectDescendantFullPaths(node);
          this.playBarsExpand(descendants, opId).then(() => {
            if (opId !== this.currentOpId) return;
            Array.from(this.barOverlay?.querySelectorAll<HTMLElement>(".tag-tree-view-bg-bar") || []).forEach(b => b.removeAttribute("data-locked-top"));
            this.rebuildOverlayBars();
          });
        }, startOffset);

        const onEnd = (e: TransitionEvent) => {
          if (e.propertyName !== "max-height") return;
          ul.removeEventListener("transitionend", onEnd);
          clearTimeout(startBarsTimer);
          if (opId !== this.currentOpId) return;
          const descendants = this.collectDescendantFullPaths(node);
          this.playBarsExpand(descendants, opId).then(() => {
            if (opId !== this.currentOpId) return;
            Array.from(this.barOverlay?.querySelectorAll<HTMLElement>(".tag-tree-view-bg-bar") || []).forEach(b => b.removeAttribute("data-locked-top"));
            this.rebuildOverlayBars();
          });
        };
        ul.addEventListener("transitionend", onEnd);

        this.startOverlaySync(this.settings.expandDuration + 80);
      });

      if (this._idleReset) this._idleReset();
      return;
    }

    this.rebuildOverlayBars();
    if (this._idleReset) this._idleReset();
  }

  private async playBarsExpand(fullpaths: string[], opId: number): Promise<void> {
    if (!this.barOverlay) return;
    if (fullpaths.length === 0) return;

    const dur = Math.max(0, this.settings.barExpandDuration || DEFAULT_SETTINGS.barExpandDuration);
    const fade = Math.max(0, this.settings.barFadeInDuration || DEFAULT_SETTINGS.barFadeInDuration);
    const total = Math.max(dur, fade) + 30;

    for (const fp of fullpaths) {
      const sel = `.tag-tree-view-bg-bar[data-fullpath="${escSelector(fp)}"]`;
      if (!this.barOverlay.querySelector(sel)) {
        await this.createBarForFullpathWithRetry(fp, 6);
      }
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

    await new Promise<void>(resolve => {
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
    const total = Math.max(dur, fade) + 30;

    fullpaths.forEach(fp => {
      const innerSel = `.tag-tree-view-bg-bar[data-fullpath="${escSelector(fp)}"] .bar-inner`;
      const inner = this.barOverlay!.querySelector<HTMLElement>(innerSel);
      if (inner) {
        inner.style.transition = `transform ${dur}ms ${this.settings.expandEasing}, opacity ${fade}ms linear`;
        inner.style.transformOrigin = "left center";
        inner.style.transform = "scaleX(0)";
        inner.style.opacity = "0";
      }
    });

    this.startOverlaySync(total);

    await new Promise<void>(resolve => {
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

  private rebuildOverlayBars() {
    if (!this.treeContainer || !this.barOverlay) return;
    const now = performance.now();
    if (now - this.lastRebuildTime < 12) return;
    this.lastRebuildTime = now;

    const instantMode = now < this.overlayInstantUntil;
    const treeRect = this.treeContainer.getBoundingClientRect();
    const lisAll = Array.from(this.treeContainer.querySelectorAll<HTMLLIElement>("li.tag-tree-li"));
    const lis = lisAll.filter(li => li.getAttribute("data-removed") !== "1");

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
      const countEl = li.querySelector<HTMLElement>(".tag-tree-view-count");
      const count = countEl ? Number(countEl.textContent || "0") : 0;

      let alignLeft = liRect.left - treeRect.left;
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
        if (instantMode) {
          bar.style.transition = `left 0ms linear, width 0ms linear, background-color 0ms linear, transform 0ms linear`;
        } else {
          const dur = Math.max(200, this.settings.expandDuration);
          bar.style.transition = `left ${dur}ms ${this.settings.expandEasing}, width ${dur}ms ${this.settings.expandEasing}, background-color 200ms linear, transform ${dur}ms ${this.settings.expandEasing}`;
        }
      } else {
        const top = liRect.top - treeRect.top;
        bar.style.transform = `translateY(${top}px)`;
        if (instantMode) {
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

    const countEl = li.querySelector<HTMLElement>(".tag-tree-view-count");
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

  // 修改点：搜索格式改为 `tag:#标签`，和官方一致（可匹配 frontmatter tags）
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

  private handleSingleFileCacheChange(path: string, cacheTags: string[]) {
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

    for (const t of added) {
      const prev = this.tagCounts[t] || 0;
      this.tagCounts[t] = prev + 1;
    }
    for (const t of removed) {
      const prev = this.tagCounts[t] || 0;
      const now = Math.max(0, prev - 1);
      if (now === 0) delete this.tagCounts[t];
      else this.tagCounts[t] = now;
    }

    this.perFileTagMap[path] = cacheTags;

    this.maxCount = Math.max(...Object.values(this.tagCounts), 1);

    if (added.length > 0) this.handleTagsAdded(added);
    if (removed.length > 0) this.handleTagsRemoved(removed);

    const changed = [...added, ...removed];
    if (changed.length > 0) this.updateCountsAndBars(changed);
  }

  buildTagTree(tagCounts: Record<string, number>): TagNode {
    const root: TagNode = { name: "", fullPath: "", count: 0, children: new Map(), expanded: true };
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
          });
        }
        cur = cur.children.get(part)!;
        if (i === parts.length - 1) cur.count = tagCounts[fullTag];
      }
    }
    return root;
  }

  accumulateCounts(node: TagNode): number {
    if (node.children.size === 0) return node.count;
    let total = node.count;
    node.children.forEach(child => { total += this.accumulateCounts(child); });
    node.count = total;
    return total;
  }
}

/* utils */
function arrayEqual(a: string[] | undefined, b: string[] | undefined) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const sa = Array.from(a).sort();
  const sb = Array.from(b).sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}
