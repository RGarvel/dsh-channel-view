window.__ModuleLoader__.load({
	id: "dsh-channel-view",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let createPortal = null;
		try {
			const ReactDOM = require("react-dom");
			createPortal = ReactDOM.createPortal || (ReactDOM.default && ReactDOM.default.createPortal) || null;
		} catch (e) { /* 无 react-dom → 浮层兜底模式 */ }

		/**
		 * dsh-channel-view 客户端 v2.4（rail 折叠态收束）。
		 *
		 * - 同名会话去重后缀（cwd 末级目录名，撞车再追短 id）+ 完整 id/cwd hover；
		 * - 未注册工作区的孤儿会话标注（工作区已移除）；
		 * - 隐藏官方「工作区」标题文本，用注入的 [工作区|Channels] tab 对替换（修①：不再重复）；
		 * - 切换粒度 = 标题文本所在容器的兄弟节点（修②：分组列表真正隐藏）；
		 * - 分组视图对齐官方层级：可折叠组头、行缩进、hover、运行中脉冲圆点、更新时间排序（修③④）；
		 * - 归档会话不进主分组，底部「已归档」折叠组浅色呈现、可点开（默认收起）；
		 * - 锚定失败 / 无 react-dom → footer ▦ 浮层兜底（浮层头部 portal ✓/✘）；
		 * - v2.4：折叠（rail）态收束为单个「两 tab」图标注入 sectionHeader 首位，
		 *   点击展开宿主侧栏并恢复上次的 tab 选择；rail 态隐藏 channels 列表与 tab 对；
		 *   看门狗补判 labelEl.isConnected（官方标题重挂载后强制重装锚点，修折叠再展开出双 tab）；
		 *   tab 按钮与容器加 whiteSpace:nowrap（修窄栏竖排换行）。
		 */

		const inject = ["slots", "sessions", "workspaces"];

		// —— 运行中脉冲动画 + rail 悬停指示点（一次性注入）——
		function ensureStyleTag() {
			if (document.getElementById("dshcv-style")) return;
			const s = document.createElement("style");
			s.id = "dshcv-style";
			s.textContent = "@keyframes dshcv-pulse{0%,100%{opacity:1}50%{opacity:.35}}"
				+ ".dshcv-ind{position:relative}"
				+ ".dshcv-ind::after{content:\"\";position:absolute;left:50%;bottom:3px;transform:translateX(-50%);"
				+ "width:4px;height:4px;border-radius:50%;background:currentColor;opacity:0;transition:opacity .15s ease;pointer-events:none}"
				+ ".dshcv-ind:hover::after,.dshcv-ind:focus-visible::after{opacity:.85}";
			document.head.appendChild(s);
		}

		/** 行 → 渠道分类。优先级：真实声明(qqChannel) > 演示锁存 > subagent 标记 > 未观测。 */
		function channelOf(row) {
			const pv = row.projectionValues || {};
			if (pv.qqChannel === "qq/c2c") {
				return { key: "qq/c2c", label: "QQ 私聊 (qq/c2c)", sort: 0 };
			}
			if (pv.qqChannel === "qq/group") {
				return { key: "qq/group", label: "QQ 群聊 (qq/group)", sort: 1 };
			}
			if (typeof pv.channelSpike === "string" && pv.channelSpike !== "unobserved") {
				return { key: "declared:" + pv.channelSpike, label: `演示渠道 (${pv.channelSpike})`, sort: 2 };
			}
			if (row.origin === "subagent") {
				return { key: "subagent", label: "子代理 (subagent)", sort: 3 };
			}
			return { key: "unobserved", label: "未观测（冷/未声明）", sort: 4 };
		}

		function isRunning(row) {
			return row.running === true || row.isRunning === true || row.status === "running";
		}

		// —— 去重/孤儿标注辅助 ——
		const normPath = (p) => (p || "").replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
		const baseName = (p) => {
			const segs = (p || "").replace(/[\\/]+$/, "").split(/[\\/]/);
			return segs[segs.length - 1] || "";
		};
		const shortId = (id) => String(id || "").replace(/^session-/, "").slice(0, 8);

		/** 注册工作区路径集合（规范化）；拿不到 items 时返回 null（跳过孤儿判定）。 */
		function useWorkspacePaths(services) {
			const items = services.useWorkspaces ? services.useWorkspaces((s) => s.items) : undefined;
			return react.useMemo(() => {
				if (!Array.isArray(items)) return null;
				const set = new Set();
				for (const it of items) {
					const p = normPath(typeof it === "string" ? it : it && it.path);
					if (p) set.add(p); // 形状异常（无 path）时保持空集 → 跳过孤儿判定，不误标
				}
				return set;
			}, [items]);
		}

		/**
		 * 同名去重后缀：全量行按 displayTitle 分组，重名组内优先用 cwd 末级目录名；
		 * 末级名也撞车或无 cwd → 追加短 id。@returns Map<rowId, suffix>
		 */
		function computeDupSuffixes(allRows) {
			const byTitle = new Map();
			for (const r of allRows) {
				const t = r.displayTitle || r.id;
				if (!byTitle.has(t)) byTitle.set(t, []);
				byTitle.get(t).push(r);
			}
			const out = new Map();
			for (const group of byTitle.values()) {
				if (group.length < 2) continue;
				const bns = new Map(group.map((r) => [r.id, baseName(r.cwd)]));
				const bnCount = new Map();
				for (const b of bns.values()) bnCount.set(b, (bnCount.get(b) || 0) + 1);
				for (const r of group) {
					const b = bns.get(r.id);
					const sid = shortId(r.id);
					let suffix = b || sid;
					if ((!b || bnCount.get(b) > 1) && !String(suffix).includes(sid)) suffix += "·" + sid;
					out.set(r.id, suffix);
				}
			}
			return out;
		}

		/** 顶层读行 + 归档拆分（可见组 + 底部折叠的已归档组）。 */
		function useVisibleRows(services) {
			const rawList = services.useSessions ? services.useSessions((s) => s) : null;
			const archivedIds = services.useWorkspaces ? services.useWorkspaces((s) => s.archivedSessionIds) : undefined;
			return react.useMemo(() => {
				const all = rawList ? rawList.ids.map((id) => rawList.byId[id]).filter(Boolean) : [];
				if (!archivedIds) return { visible: all, archived: [] };
				const isArchived = (id) => (typeof archivedIds.has === "function" ? archivedIds.has(id)
					: Array.isArray(archivedIds) && archivedIds.includes(id));
				return { visible: all.filter((r) => !isArchived(r.id)), archived: all.filter((r) => isArchived(r.id)) };
			}, [rawList, archivedIds]);
		}

		const groupHeaderStyle = {
			display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none",
			fontSize: 12, fontWeight: 600, opacity: 0.72, padding: "6px 8px 4px",
		};
		const rowStyle = {
			display: "flex", alignItems: "center", gap: 7, padding: "5px 8px 5px 22px",
			cursor: "pointer", borderRadius: 6, fontSize: 13, minWidth: 0,
		};
		const titleStyle = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 };
		const dotStyle = {
			width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
			background: "#2ecc71", animation: "dshcv-pulse 1.2s ease-in-out infinite",
		};

		const tagStyle = { fontSize: 11, opacity: 0.45, flexShrink: 0, marginLeft: 2 };

		function ChannelGroups({ rows, archived, openSession, workspacePaths }) {
			const [collapsed, setCollapsed] = react.useState(() => ({ __archived__: true }));
			const dupSuffix = react.useMemo(() => computeDupSuffixes(rows.concat(archived || [])), [rows, archived]);
			const isOrphan = (row) => !!(workspacePaths && workspacePaths.size > 0 && row.cwd
				&& !workspacePaths.has(normPath(row.cwd)));
			const groups = new Map();
			for (const row of rows) {
				const c = channelOf(row);
				if (!groups.has(c.key)) groups.set(c.key, { label: c.label, sort: c.sort, items: [] });
				groups.get(c.key).items.push(row);
			}
			const ordered = Array.from(groups.entries())
				.sort((a, b) => a[1].sort - b[1].sort || b[1].items.length - a[1].items.length);
			if (archived && archived.length > 0) {
				ordered.push(["__archived__", { label: "已归档", sort: 9, items: archived }]);
			}
			return react.createElement("div", { style: { paddingTop: 2 } },
				ordered.map(([key, g]) => {
					const open = !collapsed[key];
					const isArchivedGroup = key === "__archived__";
					const items = g.items.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
					return react.createElement("div", { key, style: { marginBottom: 2 } },
						react.createElement("div", {
							style: isArchivedGroup ? Object.assign({}, groupHeaderStyle, { opacity: 0.5 }) : groupHeaderStyle,
							onClick: () => setCollapsed((m) => Object.assign({}, m, { [key]: open })),
						},
							react.createElement("span", { style: { fontSize: 10, width: 10 } }, open ? "▾" : "▸"),
							react.createElement("span", null, g.label),
							react.createElement("span", { style: { opacity: 0.55, fontWeight: 400, marginLeft: "auto", fontSize: 11 } }, g.items.length)),
						open ? items.map((row) => {
							const baseTitle = row.displayTitle || row.id;
							const suffix = dupSuffix.get(row.id);
							const orphan = isOrphan(row);
							const hover = `${baseTitle}${suffix ? " · " + suffix : ""}${orphan ? "（工作区已移除）" : ""}`
								+ ` · ${row.cwd || "无路径"} · ${row.id}${isArchivedGroup ? " · 归档会话，点击尝试打开" : " · 点击打开"}`;
							return react.createElement("div", {
								key: row.id,
								onClick: () => { if (typeof openSession === "function") openSession(row.id); },
								style: isArchivedGroup ? Object.assign({}, rowStyle, { opacity: 0.55 }) : rowStyle,
								onMouseEnter: (e) => { e.currentTarget.style.background = "rgba(128,128,128,.14)"; },
								onMouseLeave: (e) => { e.currentTarget.style.background = "transparent"; },
								title: hover,
							},
								!isArchivedGroup && isRunning(row) ? react.createElement("span", { style: dotStyle }) : react.createElement("span", { style: { width: 7, flexShrink: 0 } }),
								react.createElement("span", { style: titleStyle }, baseTitle),
								suffix ? react.createElement("span", { style: tagStyle }, "·" + suffix) : null,
								orphan ? react.createElement("span", { style: tagStyle }, "（工作区已移除）") : null);
						}) : null);
				}));
		}

		/** 在 scope 内找文本恰为 工作区/Workspaces 的最小元素，返回 { labelEl, row }。 */
		function findSectionRow(scope) {
			const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				const text = (node.textContent || "").trim();
				if (text === "工作区" || text === "Workspaces") {
					const labelEl = node.parentElement;
					if (!labelEl) return null;
					const row = labelEl.closest("div") || labelEl.parentElement || labelEl;
					return { labelEl, row };
				}
			}
			return null;
		}

		/**
		 * 注入锚点。隐藏官方标题文本（由 tab 对替换）；tabWrap 顶替标题位置、
		 * viewHost 插到 row 之后。container=row.parentElement 为切换作用域。
		 */
		function installAnchors() {
			const scope = document.querySelector('[class*="regionArea"]');
			if (!scope) return null;
			const found = findSectionRow(scope);
			if (!found) return null;
			for (const stale of scope.querySelectorAll('[data-dshcv]')) stale.remove();
			const { labelEl, row } = found;
			if (!row.parentElement) return null;

			const prevLabelDisplay = labelEl.style.display;
			labelEl.style.display = "none";

			const tabWrap = document.createElement("div");
			tabWrap.setAttribute("data-dshcv", "tab");
			tabWrap.style.cssText = "display:inline-flex;gap:2px;align-items:center;font-size:12px;vertical-align:middle;";
			labelEl.parentElement.insertBefore(tabWrap, labelEl.nextSibling);

			const viewHost = document.createElement("div");
			viewHost.setAttribute("data-dshcv", "view");
			row.parentElement.insertBefore(viewHost, row.nextSibling);

			return { tabWrap, viewHost, row, container: row.parentElement, labelEl, prevLabelDisplay };
		}

		function TabsIsland({ services, rows, archived, workspacePaths, wide }) {
			const [view, setView] = react.useState("workspace");
			const [anchors, setAnchors] = react.useState(null);
			const [railHost, setRailHost] = react.useState(null);

			// 安装 + 看门狗：React 重渲染冲掉注入节点 / 换语言时自动重装。
			// 判活须含 labelEl.isConnected：折叠/展开切换中官方标题会整体重挂载，
			// 旧 tabWrap/viewHost 可能作为 sectionHeader 的孤儿子节点存活 → 强制重装。
			react.useEffect(() => {
				if (!createPortal || wide === false) return;
				ensureStyleTag();
				let disposed = false;
				let tries = 0;
				const attempt = () => {
					if (disposed) return;
					if (anchors && anchors.labelEl.isConnected && anchors.tabWrap.isConnected && anchors.viewHost.isConnected) return;
					if (anchors) { setAnchors(null); return; } // 掉线 → 下一轮重装
					const a = installAnchors();
					if (a) { setAnchors(a); return; }
					tries += 1;
					if (tries < 60) setTimeout(attempt, 1000);
				};
				attempt();
				const wd = setInterval(attempt, 2000);
				return () => { disposed = true; clearInterval(wd); };
			}, [anchors, wide]);

			// v2.4 rail 态：往（折叠态仍存在的）sectionHeader 首位注入「两 tab」图标锚点
			react.useEffect(() => {
				if (!createPortal || wide !== false) return;
				ensureStyleTag();
				let disposed = false;
				const marked = new Set();
				const ensure = () => {
					if (disposed) return null;
					const scope = document.querySelector('[class*="regionArea"]');
					const header = scope ? scope.querySelector('[class*="sectionHeader"]') : null;
					if (!header) return null;
					let node = header.querySelector('[data-dshcv="railtab"]');
					if (!node) {
						node = document.createElement("div");
						node.setAttribute("data-dshcv", "railtab");
						node.style.cssText = "display:inline-flex;align-items:center;";
						header.insertBefore(node, header.firstChild);
					}
					// v2.4：rail 图标统一悬停指示点——宿主「新建对话」「搜索」按钮补挂 dshcv-ind
					// （React 重渲染可能剥掉外部 class，由 2s 看门狗幂等补挂）
					for (const sel of ['button[class*="newSession"]', 'button[class*="searchButton"]']) {
						const b = document.querySelector(sel);
						if (b && !b.classList.contains("dshcv-ind")) { b.classList.add("dshcv-ind"); marked.add(b); }
					}
					return node;
				};
				const first = ensure();
				if (first) setRailHost(first);
				const wd = setInterval(() => {
					const n = ensure();
					if (n) setRailHost((prev) => (prev === n && n.isConnected ? prev : n));
				}, 2000);
				return () => {
					disposed = true;
					clearInterval(wd);
					document.querySelectorAll('[data-dshcv="railtab"]').forEach((el) => el.remove());
					for (const b of marked) { try { b.classList.remove("dshcv-ind"); } catch (e) { /* detached */ } }
					setRailHost(null);
				};
			}, [wide]);

			// 视图切换：channels = 从 row 向上到 scope 逐层剪掉非锚点兄弟（路径剪枝）。
			// rail（wide===false）态：不剪枝（cleanup 已恢复），并隐藏 channels 列表。
			react.useEffect(() => {
				if (!anchors) return;
				const { row, viewHost, tabWrap } = anchors;
				if (wide === false) { viewHost.style.display = "none"; return; }
				const scope = document.querySelector('[class*="regionArea"]');
				if (!scope || !row.isConnected) return; // 锚点已脱离：等看门狗重装，期间不剪枝
				const hidden = [];
				const anchorsIn = (el) => el === viewHost || el === tabWrap
					|| el.contains(viewHost) || el.contains(tabWrap);
				if (view === "channels") {
					viewHost.style.display = "";
					let node = row;
					while (node && node !== scope) {
						const parent = node.parentElement;
						if (!parent) break;
						for (const sib of Array.from(parent.children)) {
							if (sib === node || anchorsIn(sib)) continue;
							hidden.push([sib, sib.style.display]);
							sib.style.display = "none";
						}
						if (parent === scope) break;
						node = parent;
					}
				} else {
					viewHost.style.display = "none";
				}
				return () => {
					for (const [el, prev] of hidden) el.style.display = prev || "";
				};
			}, [anchors, view, wide]);

			// 卸载清理：移除注入节点、恢复官方标题文本
			react.useEffect(() => () => {
				if (anchors) {
					try {
						anchors.labelEl.style.display = anchors.prevLabelDisplay || "";
						anchors.tabWrap.remove();
						anchors.viewHost.remove();
					} catch (e) { /* detached already */ }
				}
			}, [anchors]);

			if (!createPortal) return null;

			const tabBtn = (label, target) => react.createElement("button", {
				key: target,
				onClick: () => setView(target),
				style: {
					cursor: "pointer", border: "none", color: "inherit", padding: "2px 7px",
					borderRadius: 5, fontSize: 12, lineHeight: "18px", whiteSpace: "nowrap",
					background: view === target ? "rgba(128,128,128,.16)" : "transparent",
					fontWeight: view === target ? 600 : 400,
					opacity: view === target ? 1 : 0.6,
				},
			}, label);

			const tabs = react.createElement("div", { style: { display: "contents" } },
				tabBtn("工作区", "workspace"),
				tabBtn(`Channels ${rows.length}`, "channels"));

			// v2.4 rail：单个「两 tab 堆叠」图标，点击展开宿主侧栏（沿用官方图标按钮观感）。
			// 指示点为悬停态（.dshcv-ind::after，与「新建对话」「搜索」共用），不再常显 tab 状态。
			const railTab = createPortal ? react.createElement("button", {
				type: "button",
				className: "dshcv-ind",
				title: "工作区 / Channels（点击展开侧边栏）",
				"aria-label": "工作区 / Channels（点击展开侧边栏）",
				onClick: () => {
					const toggle = document.querySelector('button[class*="_toggle"]')
						|| Array.from(document.querySelectorAll("button")).find((b) =>
							/展开侧边栏|Expand sidebar/i.test(b.getAttribute("aria-label") || ""));
					if (toggle) toggle.click();
				},
				style: {
					cursor: "pointer", border: "none", padding: 0, display: "inline-flex",
					alignItems: "center", justifyContent: "center", width: 28, height: 28,
					borderRadius: "50%", background: "transparent",
					color: view === "channels" ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)",
				},
			}, react.createElement("svg", {
				width: 18, height: 18, viewBox: "0 0 16 16", fill: "none",
				stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round",
			},
			react.createElement("rect", { x: 2, y: 2, width: 12, height: 4.4, rx: 1.4 }),
			react.createElement("rect", { x: 2, y: 9.2, width: 12, height: 4.8, rx: 1.4 }))) : null;

			return react.createElement(react.Fragment, null,
				anchors ? createPortal(tabs, anchors.tabWrap) : null,
				anchors && view === "channels" ? createPortal(
					react.createElement(ChannelGroups, { rows, archived, workspacePaths, openSession: services.openSession }),
					anchors.viewHost) : null,
				railHost && railTab ? createPortal(railTab, railHost) : null);
		}

		const overlayStyle = {
			position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.45)",
			display: "flex", alignItems: "center", justifyContent: "center",
		};
		const panelStyle = {
			width: 420, maxWidth: "90vw", maxHeight: "70vh", overflow: "auto", padding: 16,
			borderRadius: 10, background: "var(--color-bg-elevated, #1f2329)",
			color: "var(--color-text, #eee)", boxShadow: "0 8px 40px rgba(0,0,0,.4)",
			fontFamily: "system-ui, sans-serif",
		};

		/** footer 入口 = 兜底浮层（锚定失败/无 react-dom 时唯一入口）。 */
		function ChannelPanel(props) {
			const services = props.services;
			const wide = props.wide;
			const [open, setOpen] = react.useState(false);
			const { visible: rows, archived } = useVisibleRows(services);
			const workspacePaths = useWorkspacePaths(services);
			const entry = react.createElement("button", {
				onClick: () => setOpen(true),
				title: "Channels（浮层备份入口；标题行旁有正式 tab 时二者共用同一视图）",
				style: { cursor: "pointer", border: "none", background: "transparent", color: "inherit", fontSize: 12, opacity: 0.85, padding: "6px 8px", borderRadius: 6 },
			}, wide ? "Channels ▦" : "▦");
			if (!services.useSessions) {
				return react.createElement("span", { title: "diagnostic: sessions service hook unavailable" }, entry);
			}
			return react.createElement(react.Fragment, null,
				react.createElement(TabsIsland, { services, rows, archived, workspacePaths, wide }),
				open ? react.createElement("div", { style: overlayStyle, onClick: () => setOpen(false) },
					react.createElement("div", { style: panelStyle, onClick: (e) => e.stopPropagation() },
						react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } },
							react.createElement("strong", null, "Channel view"),
							react.createElement("span", { style: { fontSize: 11, opacity: 0.6 } }, createPortal ? "portal ✓" : "portal ✘（浮层降级）")),
						react.createElement(ChannelGroups, { rows, archived, workspacePaths, openSession: services.openSession }))) : null);
		}

		function apply(ctx) {
			const sessions = ctx.sessions || {};
			const workspaces = ctx.workspaces || {};
			const services = {
				useSessions: typeof sessions.useSessions === "function" ? sessions.useSessions.bind(sessions) : undefined,
				useWorkspaces: typeof workspaces.useWorkspaces === "function" ? workspaces.useWorkspaces.bind(workspaces) : undefined,
				openSession: typeof sessions.open === "function" ? sessions.open.bind(sessions) : undefined,
			};
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "channel-view-spike",
				order: 500,
				label: () => "Channels",
			}, (props) => {
				// runtime-share 注入的 occupant props 优先（v1 已验证 useSessions 由此到达），ctx 兜底
				const merged = {
					useSessions: props.useSessions || services.useSessions,
					useWorkspaces: props.useWorkspaces || services.useWorkspaces,
					openSession: props.openSession || services.openSession,
				};
				return react.createElement(ChannelPanel, Object.assign({}, props, { services: merged }));
			}));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
