function main() {
	(function (global) {
		"use strict";

		const LIFECYCLE_KEYS = [
			"start",
			"filter",
			"sort",
			"static",
			"pagination",
			"beforeRender",
			"render",
			"afterRender",
		];

		const state = {
			enabled: false,
			options: {
				collapsed: true,
				showItemsPreview: false,
				maxItemPreview: 5,
				logWatchers: true,
				gui: true,
			},
			instrumentedLists: new WeakSet(),
			statsByList: new WeakMap(),
			listRefs: new Set(),
			latestSnapshots: new Map(),
			gui: {
				visible: false,
				root: null,
				summaryEl: null,
				tableBodyEl: null,
				jsonEl: null,
			},
		};

		function nowIso() {
			return new Date().toISOString();
		}

		function getRefValue(refLike) {
			if (!refLike || typeof refLike !== "object") return refLike;
			if (Object.prototype.hasOwnProperty.call(refLike, "value")) return refLike.value;
			return refLike;
		}

		function safeClone(input) {
			try {
				return JSON.parse(JSON.stringify(input));
			} catch {
				return input;
			}
		}

		function safeStringify(input, spacing = 2) {
			const seen = new WeakSet();
			try {
				return JSON.stringify(
					input,
					(key, value) => {
						if (typeof value === "object" && value !== null) {
							if (seen.has(value)) return "[Circular]";
							seen.add(value);
						}
						if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
						if (typeof value === "symbol") return value.toString();
						return value;
					},
					spacing,
				);
			} catch {
				return String(input);
			}
		}

		function formatValue(value) {
			if (Array.isArray(value)) {
				return value.map((v) => (typeof v === "string" ? v : safeStringify(v, 0))).join(", ");
			}
			if (typeof value === "string") return value;
			if (value === null || typeof value === "undefined") return "";
			try {
				return safeStringify(value, 0);
			} catch {
				return String(value);
			}
		}

		function getRawFilterGroups(rawFilters) {
			if (!rawFilters || typeof rawFilters !== "object") {
				return { source: "none", groups: [] };
			}

			if (rawFilters._rawValue && Array.isArray(rawFilters._rawValue.groups)) {
				return { source: "_rawValue.groups", groups: rawFilters._rawValue.groups };
			}

			if (Array.isArray(rawFilters.groups)) {
				return { source: "groups", groups: rawFilters.groups };
			}

			return { source: "none", groups: [] };
		}

		function getAppliedConditions(snapshot) {
			const rawFilters = snapshot && snapshot.filters ? snapshot.filters.raw : null;
			const extracted = getRawFilterGroups(rawFilters);
			const rows = [];

			extracted.groups.forEach((group, groupIndex) => {
				const conditions = Array.isArray(group && group.conditions) ? group.conditions : [];
				conditions.forEach((condition, conditionIndex) => {
					const fieldKey = condition && condition.fieldKey ? condition.fieldKey : "";
					const value = condition ? condition.value : "";
					if (!fieldKey && (value === "" || typeof value === "undefined" || value === null)) return;

					rows.push({
						groupIndex: groupIndex,
						conditionIndex: conditionIndex,
						groupId: group && group.id ? group.id : "",
						conditionId: condition && condition.id ? condition.id : "",
						fieldKey: fieldKey,
						op: condition && condition.op ? condition.op : "contain",
						value: formatValue(value),
						interacted: Boolean(condition && condition.interacted),
						source: extracted.source,
					});
				});
			});

			return rows;
		}

		function createCell(text) {
			const td = document.createElement("td");
			td.textContent = text;
			td.style.borderBottom = "1px solid #2b2f3a";
			td.style.padding = "4px 6px";
			td.style.verticalAlign = "top";
			td.style.wordBreak = "break-word";
			return td;
		}

		function ensureGui() {
			if (state.gui.root) return;

			const root = document.createElement("div");
			root.id = "astet-fs-list-debug-panel";
			root.style.position = "fixed";
			root.style.right = "16px";
			root.style.bottom = "16px";
			root.style.width = "min(720px, calc(100vw - 32px))";
			root.style.maxHeight = "70vh";
			root.style.overflow = "hidden";
			root.style.zIndex = "2147483647";
			root.style.background = "#111827";
			root.style.color = "#e5e7eb";
			root.style.border = "1px solid #374151";
			root.style.borderRadius = "10px";
			root.style.boxShadow = "0 10px 40px rgba(0,0,0,0.35)";
			root.style.font =
				"12px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

			const header = document.createElement("div");
			header.style.display = "flex";
			header.style.alignItems = "center";
			header.style.justifyContent = "space-between";
			header.style.padding = "8px 10px";
			header.style.borderBottom = "1px solid #374151";
			header.style.background = "#0b1220";

			const title = document.createElement("div");
			title.textContent = "FS List Debug - Applied Filters";
			title.style.fontWeight = "700";

			const controls = document.createElement("div");
			controls.style.display = "flex";
			controls.style.gap = "6px";

			const refreshBtn = document.createElement("button");
			refreshBtn.type = "button";
			refreshBtn.textContent = "Refresh";
			refreshBtn.style.cursor = "pointer";
			refreshBtn.style.border = "1px solid #4b5563";
			refreshBtn.style.background = "#1f2937";
			refreshBtn.style.color = "#e5e7eb";
			refreshBtn.style.padding = "4px 8px";
			refreshBtn.style.borderRadius = "6px";
			refreshBtn.addEventListener("click", () => renderGui());

			const closeBtn = document.createElement("button");
			closeBtn.type = "button";
			closeBtn.textContent = "Close";
			closeBtn.style.cursor = "pointer";
			closeBtn.style.border = "1px solid #4b5563";
			closeBtn.style.background = "#1f2937";
			closeBtn.style.color = "#e5e7eb";
			closeBtn.style.padding = "4px 8px";
			closeBtn.style.borderRadius = "6px";
			closeBtn.addEventListener("click", () => closeGui());

			controls.appendChild(refreshBtn);
			controls.appendChild(closeBtn);
			header.appendChild(title);
			header.appendChild(controls);

			const body = document.createElement("div");
			body.style.padding = "8px 10px 10px";
			body.style.maxHeight = "calc(70vh - 42px)";
			body.style.overflow = "auto";

			const summary = document.createElement("div");
			summary.style.marginBottom = "8px";
			summary.style.color = "#9ca3af";

			const table = document.createElement("table");
			table.style.width = "100%";
			table.style.borderCollapse = "collapse";
			table.style.tableLayout = "fixed";

			const thead = document.createElement("thead");
			const headRow = document.createElement("tr");
			["List", "Source", "fieldKey", "value", "op", "group", "condition", "interacted"].forEach(
				(label) => {
					const th = document.createElement("th");
					th.textContent = label;
					th.style.textAlign = "left";
					th.style.padding = "4px 6px";
					th.style.borderBottom = "1px solid #4b5563";
					th.style.color = "#d1d5db";
					headRow.appendChild(th);
				},
			);
			thead.appendChild(headRow);

			const tbody = document.createElement("tbody");
			table.appendChild(thead);
			table.appendChild(tbody);

			const jsonLabel = document.createElement("div");
			jsonLabel.textContent = "Latest raw filters JSON";
			jsonLabel.style.marginTop = "10px";
			jsonLabel.style.marginBottom = "4px";
			jsonLabel.style.color = "#9ca3af";

			const jsonPre = document.createElement("pre");
			jsonPre.style.margin = "0";
			jsonPre.style.padding = "8px";
			jsonPre.style.background = "#0b1220";
			jsonPre.style.border = "1px solid #374151";
			jsonPre.style.borderRadius = "8px";
			jsonPre.style.whiteSpace = "pre-wrap";
			jsonPre.style.maxHeight = "180px";
			jsonPre.style.overflow = "auto";
			jsonPre.style.color = "#c7d2fe";

			body.appendChild(summary);
			body.appendChild(table);
			body.appendChild(jsonLabel);
			body.appendChild(jsonPre);

			root.appendChild(header);
			root.appendChild(body);
			document.body.appendChild(root);

			state.gui.root = root;
			state.gui.summaryEl = summary;
			state.gui.tableBodyEl = tbody;
			state.gui.jsonEl = jsonPre;
		}

		function renderGui() {
			if (!state.gui.visible) return;
			ensureGui();

			const summaryEl = state.gui.summaryEl;
			const tbody = state.gui.tableBodyEl;
			const jsonEl = state.gui.jsonEl;
			if (!summaryEl || !tbody || !jsonEl) return;

			tbody.innerHTML = "";

			const entries = Array.from(state.latestSnapshots.entries());
			const rows = [];
			entries.forEach(([label, entry]) => {
				const conditions = getAppliedConditions(entry.snapshot);
				if (!conditions.length) {
					rows.push({
						listLabel: label,
						source: getRawFilterGroups(
							entry.snapshot && entry.snapshot.filters && entry.snapshot.filters.raw,
						).source,
						fieldKey: "(none)",
						value: "",
						op: "",
						group: "",
						condition: "",
						interacted: "",
					});
					return;
				}

				conditions.forEach((condition) => {
					rows.push({
						listLabel: label,
						source: condition.source,
						fieldKey: condition.fieldKey,
						value: condition.value,
						op: condition.op,
						group: String(condition.groupIndex),
						condition: String(condition.conditionIndex),
						interacted: condition.interacted ? "true" : "false",
					});
				});
			});

			rows.forEach((row) => {
				const tr = document.createElement("tr");
				tr.appendChild(createCell(row.listLabel));
				tr.appendChild(createCell(row.source));
				tr.appendChild(createCell(row.fieldKey));
				tr.appendChild(createCell(row.value));
				tr.appendChild(createCell(row.op));
				tr.appendChild(createCell(row.group));
				tr.appendChild(createCell(row.condition));
				tr.appendChild(createCell(row.interacted));
				tbody.appendChild(tr);
			});

			summaryEl.textContent =
				"Lists: " +
				String(entries.length) +
				" | Conditions shown: " +
				String(rows.filter((r) => r.fieldKey !== "(none)").length) +
				" | Updated: " +
				nowIso();

			const latestEntry = entries.length ? entries[entries.length - 1][1] : null;
			const latestRaw =
				latestEntry && latestEntry.snapshot && latestEntry.snapshot.filters
					? latestEntry.snapshot.filters.raw
					: null;
			jsonEl.textContent = latestRaw ? safeStringify(latestRaw, 2) : "(no filters.raw yet)";
		}

		function openGui() {
			state.gui.visible = true;
			ensureGui();
			state.gui.root.style.display = "block";
			renderGui();
			return api;
		}

		function closeGui() {
			state.gui.visible = false;
			if (state.gui.root) state.gui.root.style.display = "none";
			return api;
		}

		function toggleGui() {
			if (state.gui.visible) return closeGui();
			return openGui();
		}

		function summarizeFilterGroups(filtersValue) {
			if (!filtersValue || !Array.isArray(filtersValue.groups)) {
				return [];
			}

			return filtersValue.groups.map((group) => ({
				id: group.id,
				conditionsMatch: group.conditionsMatch || "and",
				conditionCount: Array.isArray(group.conditions) ? group.conditions.length : 0,
				conditions: Array.isArray(group.conditions)
					? group.conditions.map((condition) => ({
							id: condition.id,
							type: condition.type,
							fieldKey: condition.fieldKey,
							op: condition.op || "contain",
							value: safeClone(condition.value),
							interacted: Boolean(condition.interacted),
							fieldMatch: condition.fieldMatch || "or",
							filterMatch: condition.filterMatch || "or",
						}))
					: [],
			}));
		}

		function summarizeItems(listInstance, countOnly) {
			const items = getRefValue(listInstance.items) || [];
			if (countOnly || !state.options.showItemsPreview) {
				return { count: Array.isArray(items) ? items.length : 0 };
			}

			const preview = (Array.isArray(items) ? items : []).slice(0, state.options.maxItemPreview);
			return {
				count: Array.isArray(items) ? items.length : 0,
				preview: preview.map((item) => ({
					id: item && item.id,
					href: item && item.href,
					currentIndex: item && item.currentIndex,
					fields: item && item.fields ? Object.keys(item.fields) : [],
				})),
			};
		}

		function snapshotListState(listInstance) {
			const filtersValue = getRefValue(listInstance.filters);
			const sortingValue = getRefValue(listInstance.sorting);
			const currentPage = getRefValue(listInstance.currentPage);
			const itemsPerPage = getRefValue(listInstance.itemsPerPage);
			const totalPages = getRefValue(listInstance.totalPages);
			const hasInteracted = getRefValue(listInstance.hasInteracted);

			return {
				timestamp: nowIso(),
				listIdentity: {
					pageIndex: listInstance.pageIndex,
					instance: listInstance.instance || null,
					showQuery: Boolean(listInstance.showQuery),
					searchParamsPrefix: listInstance.searchParamsPrefix || "",
					paginationSearchParam: listInstance.paginationSearchParam || null,
				},
				reactive: {
					hasInteracted: Boolean(hasInteracted),
					currentPage: Number.isFinite(currentPage) ? currentPage : currentPage,
					itemsPerPage: Number.isFinite(itemsPerPage) ? itemsPerPage : itemsPerPage,
					totalPages: Number.isFinite(totalPages) ? totalPages : totalPages,
					itemSummary: summarizeItems(listInstance, false),
				},
				filters: {
					groupsMatch: filtersValue && filtersValue.groupsMatch ? filtersValue.groupsMatch : "and",
					groups: summarizeFilterGroups(filtersValue),
					raw: safeClone(filtersValue),
				},
				sorting: safeClone(sortingValue),
			};
		}

		function getListLabel(listInstance) {
			const instance = listInstance.instance || "default";
			return "list:" + instance + "#" + String(listInstance.pageIndex);
		}

		function getListStats(listInstance) {
			if (!state.statsByList.has(listInstance)) {
				state.statsByList.set(listInstance, {
					hookCounts: Object.create(null),
					watchCounts: Object.create(null),
				});
			}
			return state.statsByList.get(listInstance);
		}

		function logState(title, listInstance, extra) {
			if (!state.enabled) return;

			const label = getListLabel(listInstance);
			const header = "[FS LIST DEBUG] " + title + " | " + label;
			const snapshot = snapshotListState(listInstance);
			const stats = getListStats(listInstance);
			const useCollapsed = Boolean(state.options.collapsed);

			if (useCollapsed) console.groupCollapsed(header);
			else console.group(header);

			console.log("snapshot", snapshot);
			if (extra) console.log("event", extra);
			console.log("stats", {
				hooks: safeClone(stats.hookCounts),
				watchers: safeClone(stats.watchCounts),
			});
			console.groupEnd();

			state.latestSnapshots.set(label, {
				snapshot: snapshot,
				title: title,
				extra: safeClone(extra),
				updatedAt: nowIso(),
			});

			if (state.gui.visible) renderGui();
		}

		function incrementCount(bucket, key) {
			bucket[key] = (bucket[key] || 0) + 1;
		}

		function addLifecycleHooks(listInstance) {
			if (typeof listInstance.addHook !== "function") return;

			const stats = getListStats(listInstance);
			LIFECYCLE_KEYS.forEach((key) => {
				try {
					listInstance.addHook(key, function (items) {
						incrementCount(stats.hookCounts, key);
						logState("hook:" + key, listInstance, {
							incomingItems: Array.isArray(items) ? items.length : null,
						});
						return items;
					});
				} catch (error) {
					console.warn("[FS LIST DEBUG] Failed to add hook", key, error);
				}
			});
		}

		function addReactiveWatchers(listInstance) {
			if (!state.options.logWatchers) return;
			if (typeof listInstance.watch !== "function") return;

			const stats = getListStats(listInstance);

			const watchers = [
				{
					key: "filters",
					source: function () {
						return getRefValue(listInstance.filters);
					},
				},
				{
					key: "sorting",
					source: function () {
						return getRefValue(listInstance.sorting);
					},
				},
				{
					key: "currentPage",
					source: function () {
						return getRefValue(listInstance.currentPage);
					},
				},
				{
					key: "itemsPerPage",
					source: function () {
						return getRefValue(listInstance.itemsPerPage);
					},
				},
				{
					key: "itemsCount",
					source: function () {
						const items = getRefValue(listInstance.items) || [];
						return Array.isArray(items) ? items.length : 0;
					},
				},
				{
					key: "hasInteracted",
					source: function () {
						return Boolean(getRefValue(listInstance.hasInteracted));
					},
				},
			];

			watchers.forEach((watcher) => {
				try {
					listInstance.watch(
						watcher.source,
						function (nextValue, prevValue) {
							incrementCount(stats.watchCounts, watcher.key);
							logState("watch:" + watcher.key, listInstance, {
								next: safeClone(nextValue),
								prev: safeClone(prevValue),
							});
						},
						{ deep: true },
					);
				} catch (error) {
					console.warn("[FS LIST DEBUG] Failed to watch", watcher.key, error);
				}
			});
		}

		function instrumentList(listInstance) {
			if (!listInstance || state.instrumentedLists.has(listInstance)) return;

			state.instrumentedLists.add(listInstance);
			state.listRefs.add(listInstance);

			addLifecycleHooks(listInstance);
			addReactiveWatchers(listInstance);
			logState("instrumented", listInstance);
		}

		function onListInstances(listInstances) {
			const instances = Array.isArray(listInstances) ? listInstances : [];
			instances.forEach(instrumentList);
		}

		function hookIntoFinsweetList() {
			global.FinsweetAttributes ||= [];
			global.FinsweetAttributes.push(["list", onListInstances]);
		}

		function start(options) {
			if (state.enabled) {
				console.info("[FS LIST DEBUG] Already started.");
				return api;
			}

			if (options && typeof options === "object") {
				state.options = Object.assign({}, state.options, options);
			}

			state.enabled = true;
			hookIntoFinsweetList();
			if (state.options.gui) openGui();
			console.info("[FS LIST DEBUG] Started", safeClone(state.options));
			return api;
		}

		function stop() {
			state.enabled = false;
			console.info("[FS LIST DEBUG] Stopped (hooks remain attached, logging disabled).");
			return api;
		}

		function printAll() {
			if (!state.listRefs.size) {
				console.info("[FS LIST DEBUG] No list instances captured yet.");
				return api;
			}

			state.listRefs.forEach((listInstance) => {
				logState("snapshot", listInstance);
			});
			return api;
		}

		function help() {
			console.log("[FS LIST DEBUG] API:");
			console.log("- AstetFsListDebug.start(options)");
			console.log("- AstetFsListDebug.stop()");
			console.log("- AstetFsListDebug.printAll()");
			console.log("- AstetFsListDebug.snapshot(listInstance)");
			console.log("- AstetFsListDebug.openGui()");
			console.log("- AstetFsListDebug.closeGui()");
			console.log("- AstetFsListDebug.toggleGui()");
			console.log("- AstetFsListDebug.help()");
			return api;
		}

		function snapshot(listInstance) {
			if (!listInstance) return null;
			return snapshotListState(listInstance);
		}

		const api = {
			start: start,
			stop: stop,
			printAll: printAll,
			snapshot: snapshot,
			openGui: openGui,
			closeGui: closeGui,
			toggleGui: toggleGui,
			help: help,
		};

		global.AstetFsListDebug = api;
	})(window);

	AstetFsListDebug.start({
		collapsed: true,
		showItemsPreview: false,
		maxItemPreview: 5,
		logWatchers: true,
	});

	function clickToCopy() {
		const HANDLE_CLASS = "u-click-copy";
		const COPIED_TEXT = "Copied!";
		const FEEDBACK_MS = 1100;

		function normalizeCopyValue(href) {
			if (!href) return "";
			const raw = String(href).trim();
			const lower = raw.toLowerCase();

			function stripAfterDelimiters(value, delimiters) {
				let out = value;
				delimiters.forEach((d) => {
					const idx = out.indexOf(d);
					if (idx !== -1) out = out.slice(0, idx);
				});
				return out;
			}

			if (lower.startsWith("mailto:")) {
				const withoutScheme = raw.slice("mailto:".length);
				const stripped = stripAfterDelimiters(withoutScheme, ["?", "#"]);
				try {
					return decodeURIComponent(stripped);
				} catch {
					return stripped;
				}
			}

			if (lower.startsWith("tel:")) {
				const withoutScheme = raw.slice("tel:".length);
				const stripped = stripAfterDelimiters(withoutScheme, ["?", "#", ";"]);
				try {
					return decodeURIComponent(stripped);
				} catch {
					return stripped;
				}
			}

			if (lower.startsWith("sms:")) {
				const withoutScheme = raw.slice("sms:".length);
				const stripped = stripAfterDelimiters(withoutScheme, ["?", "#", ";"]);
				try {
					return decodeURIComponent(stripped);
				} catch {
					return stripped;
				}
			}

			return raw;
		}

		async function copyTextToClipboard(text) {
			if (!text) return false;
			try {
				if (navigator.clipboard?.writeText && window.isSecureContext) {
					await navigator.clipboard.writeText(text);
					return true;
				}
			} catch {
				// fallback below
			}

			try {
				const ta = document.createElement("textarea");
				ta.value = text;
				ta.setAttribute("readonly", "");
				ta.style.position = "fixed";
				ta.style.left = "-9999px";
				ta.style.top = "0";
				ta.style.opacity = "0";
				document.body.appendChild(ta);
				ta.select();
				const ok = document.execCommand("copy");
				document.body.removeChild(ta);
				return ok;
			} catch {
				return false;
			}
		}

		function getLinkFromTrigger(triggerEl, clickTarget) {
			if (!triggerEl) return null;
			if (clickTarget?.closest) {
				const withinAnchor = clickTarget.closest("a[href]");
				if (withinAnchor && triggerEl.contains(withinAnchor)) return withinAnchor;
			}
			if (triggerEl.matches?.("a[href]")) return triggerEl;
			return triggerEl.querySelector?.("a[href]") ?? null;
		}

		function ensureFeedbackUI(link) {
			if (!link || link.dataset.clickCopyUiReady === "1") return;
			link.dataset.clickCopyUiReady = "1";

			const originalWrap = document.createElement("span");
			originalWrap.dataset.clickCopyOriginal = "1";
			while (link.firstChild) originalWrap.appendChild(link.firstChild);

			const copiedWrap = document.createElement("span");
			copiedWrap.dataset.clickCopyCopied = "1";
			copiedWrap.setAttribute("aria-hidden", "true");
			copiedWrap.textContent = COPIED_TEXT;

			link.appendChild(originalWrap);
			link.appendChild(copiedWrap);

			// Keep layout stable: feedback swaps via opacity only.
			const computed = window.getComputedStyle(link);
			if (computed.position === "static") link.style.position = "relative";

			copiedWrap.style.position = "absolute";
			copiedWrap.style.inset = "0";
			copiedWrap.style.pointerEvents = "none";
			copiedWrap.style.opacity = "0";
			copiedWrap.style.display = "flex";
			copiedWrap.style.alignItems = "center";
			const ta = computed.textAlign;
			copiedWrap.style.justifyContent =
				ta === "center" ? "center" : ta === "right" ? "flex-end" : "flex-start";
			copiedWrap.style.whiteSpace = "nowrap";
			copiedWrap.style.color = "currentColor";
			copiedWrap.style.font = "inherit";
			copiedWrap.style.lineHeight = "inherit";
			copiedWrap.style.textDecoration = "inherit";
		}

		function showCopied(link) {
			if (!link) return;
			ensureFeedbackUI(link);

			const originalWrap = link.querySelector("span[data-click-copy-original='1']");
			const copiedWrap = link.querySelector("span[data-click-copy-copied='1']");
			if (!originalWrap || !copiedWrap) return;

			// Allow repeated clicks without piling up timers/tweens.
			if (link._clickCopyTimeout) {
				clearTimeout(link._clickCopyTimeout);
				link._clickCopyTimeout = null;
			}

			const hasGsap = typeof window.gsap !== "undefined" && typeof window.gsap.to === "function";
			if (hasGsap) {
				gsap.killTweensOf([originalWrap, copiedWrap]);
				gsap.set(originalWrap, { autoAlpha: 1 });
				gsap.set(copiedWrap, { autoAlpha: 0 });
				gsap.to(originalWrap, { duration: 0.12, autoAlpha: 0, ease: "sine.inOut" });
				gsap.to(copiedWrap, { duration: 0.12, autoAlpha: 1, ease: "sine.inOut" });
				link._clickCopyTimeout = setTimeout(() => {
					gsap.to(copiedWrap, { duration: 0.2, autoAlpha: 0, ease: "sine.inOut" });
					gsap.to(originalWrap, { duration: 0.2, autoAlpha: 1, ease: "sine.inOut" });
					link._clickCopyTimeout = null;
				}, FEEDBACK_MS);
				return;
			}

			// Non-GSAP fallback: immediate swap, then revert.
			originalWrap.style.opacity = "0";
			copiedWrap.style.opacity = "1";
			link._clickCopyTimeout = setTimeout(() => {
				copiedWrap.style.opacity = "0";
				originalWrap.style.opacity = "1";
				link._clickCopyTimeout = null;
			}, FEEDBACK_MS);
		}

		const onClick = async (e) => {
			// Let users keep normal behavior for modified clicks (new tab, etc.)
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			if (e.button !== 0) return; // left click only

			const trigger = e.target?.closest?.(`.${HANDLE_CLASS}`);
			if (!trigger) return;
			const link = getLinkFromTrigger(trigger, e.target);
			if (!link) return;

			// Only intercept tel/email/sms links. Leave normal URLs alone.
			const rawHrefAttr = link.getAttribute("href") || "";
			const rawHref = rawHrefAttr || link.href || "";
			const lowerHref = String(rawHref).trim().toLowerCase();
			const isHandled =
				lowerHref.startsWith("mailto:") ||
				lowerHref.startsWith("tel:") ||
				lowerHref.startsWith("sms:");
			if (!isHandled) return;

			const valueToCopy = normalizeCopyValue(rawHref);
			if (!valueToCopy) return;

			e.preventDefault();
			const ok = await copyTextToClipboard(valueToCopy);
			if (ok) showCopied(link);
		};

		document.addEventListener("click", onClick, { passive: false });

		// Return a cleanup function for page transitions, if ever needed.
		return () => document.removeEventListener("click", onClick);
	}

	function homeCarousel() {
		// get section and list
		const section = document.querySelector(".c-home-carousel");
		if (!section) return;
		const listEl = section.querySelector(".home-carousel_list");
		if (!listEl) return;

		// add a "loading" class immediately
		document.documentElement.classList.add("home-carousel-loading");

		let didSetReadyClasses = false;
		function setCarouselReady(reason) {
			if (didSetReadyClasses) return;
			didSetReadyClasses = true;
			document.documentElement.classList.remove("home-carousel-loading");
			document.documentElement.classList.add("home-carousel-loaded");
			if (reason) console.log("homeCarousel ready:", reason);
		}

		// If there are no slides, Keen's `created` callback may never fire.
		// Fail open: toggle classes so the page doesn't stay in a loading state.
		const slideCount = listEl.querySelectorAll(".home-carousel_slide").length;
		if (!slideCount) {
			setCarouselReady("no-slides");
			return;
		}

		let started = false;

		function startCarousel() {
			if (started) return;
			started = true;

			initKeen();
		}

		// fallback if imagesLoaded doesnt exist
		if (!astet.hasImagesLoaded) {
			startCarousel();
		} else {
			const imgLoad = imagesLoaded(listEl, { background: true });
			imgLoad.on("always", () => startCarousel());
			setTimeout(() => startCarousel(), 2500); // timeout fallback if image load takes too long
		}

		function initKeen() {
			const DURATION = 1;
			const DURATION_MS = DURATION * 1000;
			const power3InOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
			const opacityScalingFactor = 1.1;

			if (typeof window.KeenSlider === "undefined") {
				setCarouselReady("keen-missing");
				return;
			}

			let slider;
			try {
				slider = new KeenSlider(
					listEl,
					{
						loop: true,
						selector: ".home-carousel_slide",
						defaultAnimation: {
							duration: DURATION_MS,
							easing: power3InOut,
						},
						drag: true,
						dragSpeed: 0.75,
						detailsChanged: (s) => {
							s.slides.forEach((slide, idx) => {
								const overlay = slide.querySelector(".home-carousel_slide-overlay");
								if (overlay) {
									overlay.style.opacity = Math.min(
										1,
										opacityScalingFactor * (1 - s.track.details.slides[idx].portion),
									);
								}
							});
						},
						created: (s) => {
							initControls(s);
							updateName(s); // set initial name
							setCarouselReady("keen-created");
						},

						slideChanged: (s) => {
							updateName(s); // update after next/prev (and drag) actually changes slide
						},
					},
					[],
				);
			} catch (e) {
				console.warn("homeCarousel: KeenSlider init failed", e);
				setCarouselReady("keen-init-failed");
				return;
			}

			// Safety net: if Keen never calls `created`, don't keep the page "loading".
			setTimeout(() => setCarouselReady("created-timeout"), 1000);

			astet.slider = slider;
		}

		function initControls(s) {
			const prevBtn = document.querySelector("button.home-carousel_btn.is-prev");
			const nextBtn = document.querySelector("button.home-carousel_btn.is-next");
			if (!prevBtn || !nextBtn) return;

			prevBtn.addEventListener("click", () => s.prev());
			nextBtn.addEventListener("click", () => s.next());
		}

		function updateName(s) {
			const nameEl = document.querySelector(".home-carousel_name");
			if (!nameEl) return;

			// rel is the current visible slide index (relative). Works nicely with loop.
			const rel = s.track.details.rel;
			const slideEl = s.slides[rel];
			const projectName = slideEl?.dataset?.projectName ?? "";
			const projectLocation = slideEl?.dataset?.projectLocation ?? "";
			const newName = projectLocation ? `${projectName}, ${projectLocation}` : projectName;
			console.log("Updating name to:", newName);
			gsap.to(nameEl, {
				duration: 1,
				ease: "power3.inOut",
				text: { value: newName, delimiter: "", speed: 2.5 },
			});
		}
	}

	function loadCardsOnScroll() {
		const revealCardsImmediately = () => {
			const cards = document.querySelectorAll(".c-card, .anim-load-item");
			if (!cards.length) return;
			gsap.set(cards, { autoAlpha: 1, y: 0 });
		};

		const markFilterListLoaded = () => {
			document.documentElement.classList.add("filter-list-loaded");
		};

		// for each .c-cols-section, create a scrolltrigger that fades in each .c-card inside it with a stagger
		const sections = document.querySelectorAll(".anim-load-trigger");
		sections.forEach((section) => {
			const cards = section.querySelectorAll(".c-card, .anim-load-item");
			if (!cards.length) return;

			gsap.to(cards, {
				scrollTrigger: {
					trigger: section,
					start: "top 80%",
				},
				autoAlpha: 1,
				y: 0,
				duration: 0.5,
				ease: "sine.inOut",
				stagger: 0.15,
				onComplete: () => {
					console.log("Loaded cards in section:", section);
				},
			});
		});

		// batch
		ScrollTrigger.batch(".anim-load-batch-trigger :is(.c-card, .anim-load-item)", {
			onEnter: (batch) =>
				gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.5, ease: "sine.inOut", stagger: 0.15 }),
			start: "top 95%",
		});

		// click events on any filter controls will immediately set autoAlpha and y to 1 and 0 respectively, to ensure they are visible if user filters before scroll
		// filter controls are .checkbox_label
		const filterControls = document.querySelectorAll(".checkbox_label");
		filterControls.forEach((control) => {
			control.addEventListener("click", () => {
				revealCardsImmediately();
				markFilterListLoaded();
			});
		});
	}

	/* TO DO - check if we still need this scroll trigger refresh now that we are using filter control clicks to set all cards visible		 */
	function finsweetScrollTriggerRefresh() {
		if (window._astetFsScrollTriggerRefreshHooked) return;
		window._astetFsScrollTriggerRefreshHooked = true;

		function getFilterInputs() {
			return Array.from(document.querySelectorAll("input[fs-list-field][fs-list-value]"));
		}

		function syncWebflowFilterUi() {
			getFilterInputs().forEach((input) => {
				const label = input.closest("label");
				if (!label) return;

				const isChecked = Boolean(input.checked);
				if (
					label.classList.contains("check_field") ||
					label.classList.contains("radio-button_field")
				) {
					label.classList.toggle("is-list-active", isChecked);
				}

				const redirected = label.querySelector(".w-checkbox-input, .w-form-formradioinput");
				if (redirected) redirected.classList.toggle("w--redirected-checked", isChecked);
			});
		}

		function getSupportedFilterFields() {
			const fields = new Set();
			getFilterInputs().forEach((input) => {
				const field = input.getAttribute("fs-list-field");
				if (field) fields.add(field);
			});
			return fields;
		}

		function getValidControlValuesByField() {
			const map = new Map();
			getFilterInputs().forEach((input) => {
				const field = input.getAttribute("fs-list-field");
				const value = input.getAttribute("fs-list-value");
				if (!field || !value) return;
				if (!map.has(field)) map.set(field, new Set());
				map.get(field).add(String(value));
			});
			return map;
		}

		function parseCleanFilterParams() {
			const params = new URLSearchParams(window.location.search);
			const supportedFields = getSupportedFilterFields();
			const map = new Map();

			supportedFields.forEach((field) => {
				const raw = params.get(field);
				if (!raw) return;
				const value = String(raw).trim();
				if (!value) return;
				map.set(field, value);
			});

			return map;
		}

		function applyFilterMapToControls(filterMap, options = {}) {
			const dispatchEvents = Boolean(options.dispatchEvents);
			const forceDispatch = Boolean(options.forceDispatch);
			const inputs = getFilterInputs();
			if (!inputs.length || !filterMap.size) return;

			filterMap.forEach((value, field) => {
				inputs
					.filter((input) => input.getAttribute("fs-list-field") === field)
					.forEach((input) => {
						const inputValue = input.getAttribute("fs-list-value") || "";
						const shouldCheck = inputValue === value;
						const didChange = input.checked !== shouldCheck;
						input.checked = shouldCheck;

						if (dispatchEvents && (didChange || (forceDispatch && shouldCheck))) {
							input.dispatchEvent(new Event("input", { bubbles: true }));
							input.dispatchEvent(new Event("change", { bubbles: true }));
						}
					});
			});

			syncWebflowFilterUi();
		}

		function getFilterMapFromCheckedControls() {
			const map = new Map();
			getFilterInputs().forEach((input) => {
				if (!input.checked) return;
				const field = input.getAttribute("fs-list-field");
				const value = input.getAttribute("fs-list-value");
				if (!field || !value) return;
				if (!map.has(field)) map.set(field, value);
			});
			return map;
		}

		function writeCleanFilterUrl(filterMap, options = {}) {
			const replace = options.replace !== false;
			const url = new URL(window.location.href);
			const supportedFields = getSupportedFilterFields();

			supportedFields.forEach((field) => {
				url.searchParams.delete(field);
				url.searchParams.delete(`${field}_equal`);
			});

			filterMap.forEach((value, field) => {
				if (!value) return;
				url.searchParams.set(field, value);
			});

			const search = url.searchParams.toString();
			const next = `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
			const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
			if (next === current) return;

			if (replace) history.replaceState(history.state, "", next);
			else history.pushState(history.state, "", next);
		}

		function clearIncomingFilterUrlParams(filterMap) {
			if (!filterMap || !filterMap.size) return;
			const url = new URL(window.location.href);
			let didChange = false;

			filterMap.forEach((_, field) => {
				if (url.searchParams.has(field)) {
					url.searchParams.delete(field);
					didChange = true;
				}
				const equalKey = `${field}_equal`;
				if (url.searchParams.has(equalKey)) {
					url.searchParams.delete(equalKey);
					didChange = true;
				}
			});

			if (!didChange) return;

			const search = url.searchParams.toString();
			const next = `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
			const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
			if (next === current) return;

			history.replaceState(history.state, "", next);
		}

		function getFilterListElements() {
			return Array.from(document.querySelectorAll('[fs-list-element="list"]'));
		}

		function setInitialFilterMask(masked) {
			getFilterListElements().forEach((el) => {
				if (!el) return;
				if (masked) {
					if (!el.dataset.astetInitialVisibility)
						el.dataset.astetInitialVisibility = el.style.visibility || "";
					el.style.visibility = "hidden";
					return;
				}

				if (Object.prototype.hasOwnProperty.call(el.dataset, "astetInitialVisibility")) {
					el.style.visibility = el.dataset.astetInitialVisibility;
					delete el.dataset.astetInitialVisibility;
				} else {
					el.style.visibility = "";
				}
			});
		}

		function revealCardsAfterFilter() {
			const cards = document.querySelectorAll(".c-card, .anim-load-item");
			if (!cards.length || typeof window.gsap === "undefined") return;
			gsap.set(cards, { autoAlpha: 1, y: 0 });
		}

		const initialFilterMap = parseCleanFilterParams();
		const hasInitialFilters = initialFilterMap.size > 0;
		const urlFilterState = {
			isApplyingInitialFilters: hasInitialFilters,
			didDispatchInitialEvents: false,
			hadManualInteraction: false,
			hasInitialMask: hasInitialFilters,
		};

		if (hasInitialFilters) setInitialFilterMask(true);

		const filterInputs = getFilterInputs();
		filterInputs.forEach((input) => {
			const markManualInteraction = () => {
				if (urlFilterState.didDispatchInitialEvents) return;
				urlFilterState.hadManualInteraction = true;
			};

			input.addEventListener("input", markManualInteraction);
			input.addEventListener("change", markManualInteraction);
		});

		if (hasInitialFilters) {
			// Prime controls before Finsweet initializes so first render can be filtered.
			applyFilterMapToControls(initialFilterMap, { dispatchEvents: false });
			clearIncomingFilterUrlParams(initialFilterMap);
			document.documentElement.classList.add("filter-list-loaded");
		}

		const refreshSoon = () => {
			console.log("Finsweet list rendered/updated, refreshing ScrollTrigger...");
			if (typeof window.ScrollTrigger === "undefined") return;
			if (typeof ScrollTrigger.refresh !== "function") return;
			// Defer to ensure DOM/layout has settled after Finsweet renders.
			requestAnimationFrame(() => setTimeout(() => ScrollTrigger.refresh(), 0));
		};

		window.FinsweetAttributes ||= [];
		window.FinsweetAttributes.push([
			"list",
			(listInstances) => {
				if (
					hasInitialFilters &&
					!urlFilterState.didDispatchInitialEvents &&
					!urlFilterState.hadManualInteraction
				) {
					// If listeners are now attached, emit changes so filtering definitely runs.
					applyFilterMapToControls(initialFilterMap, {
						dispatchEvents: true,
						forceDispatch: true,
					});
					urlFilterState.didDispatchInitialEvents = true;
				} else if (hasInitialFilters && urlFilterState.hadManualInteraction) {
					// User changed filters before URL defaults could dispatch; do not override manually chosen state.
					urlFilterState.didDispatchInitialEvents = true;
					urlFilterState.isApplyingInitialFilters = false;
				}

				(listInstances || []).forEach((listInstance) => {
					if (!listInstance || typeof listInstance.addHook !== "function") return;

					let isRepairingInvalidFilters = false;
					let hasQueuedReFilter = false;

					const sanitizeListFilters = () => {
						if (isRepairingInvalidFilters) return false;

						const filtersRef = listInstance.filters;
						const filtersValue =
							filtersRef && typeof filtersRef === "object" ? filtersRef.value : null;
						if (!filtersValue || !Array.isArray(filtersValue.groups)) return false;

						const validControlValuesByField = getValidControlValuesByField();
						if (!validControlValuesByField.size) return false;

						let didChange = false;
						filtersValue.groups.forEach((group) => {
							const originalConditions = Array.isArray(group && group.conditions)
								? group.conditions
								: [];
							const nextConditions = [];

							originalConditions.forEach((condition) => {
								const fieldKey = condition && condition.fieldKey ? condition.fieldKey : "";
								const allowedValues = fieldKey ? validControlValuesByField.get(fieldKey) : null;

								if (!allowedValues || !allowedValues.size) {
									nextConditions.push(condition);
									return;
								}

								const rawValue = condition ? condition.value : "";
								if (Array.isArray(rawValue)) {
									const filteredValues = rawValue.filter((v) => allowedValues.has(String(v)));
									if (filteredValues.length !== rawValue.length) didChange = true;
									if (!filteredValues.length) {
										didChange = true;
										return;
									}

									if (filteredValues.length === rawValue.length) {
										nextConditions.push(condition);
										return;
									}

									nextConditions.push({ ...condition, value: filteredValues });
									return;
								}

								if (!allowedValues.has(String(rawValue))) {
									didChange = true;
									return;
								}

								nextConditions.push(condition);
							});

							if (nextConditions.length !== originalConditions.length) didChange = true;
							if (nextConditions.length !== originalConditions.length) {
								if (group) group.conditions = nextConditions;
							}
						});

						if (!didChange) return false;

						isRepairingInvalidFilters = true;
						try {
							// Keep the same ref object to avoid breaking FS reactivity internals.
							filtersRef.value = filtersValue;
						} finally {
							isRepairingInvalidFilters = false;
						}

						console.warn("[astet] Removed invalid cross-field filter values from list state.");

						if (!hasQueuedReFilter && typeof listInstance.triggerHook === "function") {
							hasQueuedReFilter = true;
							requestAnimationFrame(() => {
								hasQueuedReFilter = false;
								if (typeof listInstance.triggerHook === "function") {
									listInstance.triggerHook("filter");
								}
							});
						}

						return true;
					};

					listInstance.addHook("afterRender", () => {
						refreshSoon();
						syncWebflowFilterUi();

						sanitizeListFilters();

						if (urlFilterState.hasInitialMask) {
							setInitialFilterMask(false);
							urlFilterState.hasInitialMask = false;
						}

						if (urlFilterState.isApplyingInitialFilters) {
							revealCardsAfterFilter();
							urlFilterState.isApplyingInitialFilters = false;
						}
					});
				});

				// Run once on init, too.
				refreshSoon();
				syncWebflowFilterUi();
			},
		]);
	}

	function nav_openClose() {
		const MOBILE_PORTRAIT_QUERY = "(max-width: 479px)";

		const navBtn = document.querySelector(".nav_mobile-btn");
		if (!navBtn) return;
		if (typeof window.gsap === "undefined") return;

		const mql =
			typeof window.matchMedia === "function" ? window.matchMedia(MOBILE_PORTRAIT_QUERY) : null;

		let cleanup = null;
		let open = false;

		function setup() {
			if (cleanup) return;

			const navEl = document.querySelector(".nav");
			if (!navEl) return;

			const menuWrap = navEl.querySelector(".nav_menu-outer-wrap");
			const menuBg = navEl.querySelector(".nav_menu-bg");
			const menuInner = navEl.querySelector(".nav_menu-inner-wrap");
			const menuLinks = Array.from(navEl.querySelectorAll(".nav_menu-link"));
			const socials = navEl.querySelector(".nav_socials");

			if (!menuWrap || !menuBg || !menuInner) return;

			open = false;
			astet.navOpen = false;
			document.documentElement.classList.remove("nav-open");
			navBtn.setAttribute("aria-expanded", "false");
			menuWrap.style.display = "none";

			gsap.set([menuBg, menuInner], { autoAlpha: 0 });
			if (menuLinks.length) gsap.set(menuLinks, { autoAlpha: 0 });
			if (socials) gsap.set(socials, { autoAlpha: 0 });

			const tl = gsap.timeline({
				paused: true,
				defaults: { duration: 0.5, ease: "sine.inOut" },
			});

			// Base fade-in
			tl.to([menuBg, menuInner], { autoAlpha: 1, duration: 0.25, ease: "sine.inOut" }, 0);

			// Link stagger + socials fade
			if (menuLinks.length) tl.to(menuLinks, { autoAlpha: 1, duration: 0.25, stagger: 0.03 }, 0.2);
			if (socials) tl.to(socials, { autoAlpha: 1, duration: 0.25 }, 0.22);

			tl.eventCallback("onReverseComplete", () => {
				menuWrap.style.display = "none";
			});

			const onClick = () => {
				console.log("Nav button clicked. Current open state:", open);
				open = !open;
				astet.navOpen = open;
				document.documentElement.classList.toggle("nav-open", open);
				navBtn.setAttribute("aria-expanded", String(open));

				if (open) {
					menuWrap.style.display = "flex";
					tl.play();
				} else {
					tl.reverse();
				}
			};

			navBtn.addEventListener("click", onClick);

			cleanup = () => {
				navBtn.removeEventListener("click", onClick);
				open = false;
				astet.navOpen = false;
				document.documentElement.classList.remove("nav-open");
				navBtn.setAttribute("aria-expanded", "false");
				menuWrap.style.display = "";
				tl.kill();
				gsap.set([menuBg, menuInner], { clearProps: "all" });
				if (menuLinks.length) gsap.set(menuLinks, { clearProps: "all" });
				if (socials) gsap.set(socials, { clearProps: "all" });
				// gsap.set([svgLine1, svgLine2, svgLine3], { clearProps: "all" });
			};
		}

		function teardown() {
			if (!cleanup) return;
			cleanup();
			cleanup = null;
		}

		function syncToBreakpoint() {
			if (!mql || mql.matches) setup();
			else teardown();
		}

		syncToBreakpoint();

		if (mql) {
			if (typeof mql.addEventListener === "function")
				mql.addEventListener("change", syncToBreakpoint);
			else if (typeof mql.addListener === "function") mql.addListener(syncToBreakpoint);
		}

		return () => {
			teardown();
			if (!mql) return;
			if (typeof mql.removeEventListener === "function")
				mql.removeEventListener("change", syncToBreakpoint);
			else if (typeof mql.removeListener === "function") mql.removeListener(syncToBreakpoint);
		};
	}

	function nav_hideShow() {
		const nav = document.querySelector(".nav");
		if (!nav) return;
		if (typeof window.ScrollTrigger === "undefined" || typeof ScrollTrigger.create !== "function")
			return;

		// --- DEBUG LOGGING (enable with localStorage.setItem("astet:debugNav","1")) ---
		const DEBUG_NAV = (() => {
			try {
				return localStorage.getItem("astet:debugNav") === "1";
			} catch {
				return false;
			}
		})();
		const log = (...args) => {
			if (!DEBUG_NAV) return;
			console.log("[nav_hideShow]", ...args);
		};

		const showThreshold = 10; // Always show when within this distance from top
		const hideThreshold = 60; // Can hide only after passing this
		const revealBuffer = 10; // Scroll-up distance before revealing
		const hideBuffer = 10; // Small buffer to prevent flicker

		let lastScrollY = window.scrollY;
		let currentScrollY = window.scrollY;
		let revealDistance = 0;
		let navHidden = false;
		let ticking = false;

		const isInPageVariant = nav.matches('[data-wf--nav--variant="in-page"]');
		let hideEnabled = !isInPageVariant;
		let armStartY = 0; // for in-page variant: scrollY where hide/show becomes active

		function setHideEnabled(enabled, reason) {
			const next = Boolean(enabled);
			if (hideEnabled === next) return;
			hideEnabled = next;
			nav.classList.toggle("is-hide-enabled", hideEnabled);
			log("hideEnabled", { hideEnabled, reason });

			if (!hideEnabled) armStartY = 0;

			// Reset scroll deltas so we don't immediately hide on the first armed frame.
			lastScrollY = window.scrollY;
			currentScrollY = window.scrollY;
			revealDistance = 0;

			if (!hideEnabled) {
				nav.classList.remove("is-hidden", "is-past-threshold");
				navHidden = false;
			}
		}

		// Track changes to reduce noisy logs
		let lastLog = {
			navHidden,
			isPast:
				hideEnabled &&
				(isInPageVariant ? currentScrollY - armStartY : currentScrollY) > hideThreshold,
			y: currentScrollY,
		};

		log("init", {
			showThreshold,
			hideThreshold,
			revealBuffer,
			hideBuffer,
			startY: currentScrollY,
			isInPageVariant,
		});

		// Clean up any existing trigger
		const oldTrigger = ScrollTrigger.getById("nav_hideShow");
		if (oldTrigger) {
			log("killing old ScrollTrigger#nav_hideShow");
			oldTrigger.kill();
		}

		const oldArmTrigger = ScrollTrigger.getById("nav_hideShow_arm");
		if (oldArmTrigger) {
			log("killing old ScrollTrigger#nav_hideShow_arm");
			oldArmTrigger.kill();
		}

		// For the "in-page" sticky nav variant, only start hide/show once the hero has
		// scrolled past the top of the viewport.
		if (isInPageVariant) {
			const candidateSelectors = [".c-home-carousel"];

			let heroEl = null;
			for (const sel of candidateSelectors) {
				try {
					const found = document.querySelector(sel);
					if (found) {
						heroEl = found;
						log("hero found", { selector: sel, heroEl });
						break;
					}
				} catch (e) {
					log("invalid hero selector", { selector: sel, error: String(e) });
				}
			}

			if (heroEl) {
				setHideEnabled(false, "init-in-page");
				ScrollTrigger.create({
					id: "nav_hideShow_arm",
					trigger: heroEl,
					start: "bottom top",
					end: "bottom top",
					onEnter(self) {
						armStartY = self?.start ?? window.scrollY;
						setHideEnabled(true, "hero-passed");
					},
					onLeaveBack: () => setHideEnabled(false, "hero-visible"),
					onRefresh(self) {
						// Ensure correct state after layout shifts / late-loading media.
						const y = window.scrollY;
						const armed = y >= self.start;
						if (armed) {
							armStartY = self.start;
							// Keep deltas stable if baseline shifts.
							lastScrollY = y;
							currentScrollY = y;
							revealDistance = 0;
						}
						setHideEnabled(armed, "refresh");
					},
				});
			} else {
				// Fail safe: if we can't find the hero, keep hide/show disabled for this variant.
				setHideEnabled(false, "no-hero");
				log("in-page variant: .c-home-carousel not found; hide/show will remain disabled", {
					candidateSelectors,
				});
			}
		} else {
			// Ensure class isn't left behind if markup changes.
			nav.classList.remove("is-hide-enabled");
		}

		// rAF update loop
		function updateNav() {
			ticking = false;

			const yRaw = currentScrollY;
			const delta = yRaw - lastScrollY;
			const y = isInPageVariant ? yRaw - armStartY : yRaw;
			const isPast = hideEnabled && y > hideThreshold;

			if (!hideEnabled) {
				// While the hero is still on-screen (in-page variant), keep nav in its static/sticky state.
				if (navHidden) {
					log("forced show (hide disabled)", { y });
					nav.classList.remove("is-hidden", "is-past-threshold");
					navHidden = false;
				}
				revealDistance = 0;
				lastScrollY = yRaw;
				return;
			}

			// Helpful “why didn’t it hide?” log (only when scrolling down past threshold)
			if (DEBUG_NAV && delta > 0 && isPast && !navHidden && delta <= hideBuffer) {
				log("not hiding (delta too small)", { y, lastScrollY, delta, hideBuffer });
			}

			// --- NAV VISIBILITY ---
			if (y <= showThreshold) {
				if (navHidden) {
					log("show (near top)", { y, showThreshold });
					nav.classList.remove("is-hidden", "is-past-threshold");
					navHidden = false;
				}
				revealDistance = 0;
			} else if (delta > hideBuffer && y > hideThreshold && !navHidden) {
				log("hide (scrolling down)", { y, lastScrollY, delta, hideBuffer });
				nav.classList.add("is-hidden", "is-past-threshold");
				navHidden = true;
				revealDistance = 0;
			} else if (delta < 0 && navHidden) {
				revealDistance -= delta; // delta is negative
				if (DEBUG_NAV) log("scrolling up while hidden", { y, delta, revealDistance, revealBuffer });
				if (revealDistance >= revealBuffer) {
					log("reveal (scrolled up enough)", { y, revealDistance, revealBuffer });
					nav.classList.remove("is-hidden");
					navHidden = false;
					revealDistance = 0;
				}
			}

			nav.classList.toggle("is-past-threshold", isPast);

			// Log state transitions (kept minimal)
			if (DEBUG_NAV) {
				const stateChanged =
					lastLog.navHidden !== navHidden ||
					lastLog.isPast !== isPast ||
					Math.abs(lastLog.y - y) >= 50;
				if (stateChanged) {
					log("state", { y, lastScrollY, delta, navHidden, isPast, revealDistance });
					lastLog = { navHidden, isPast, y };
				}
			}

			lastScrollY = yRaw;
		}

		// ScrollTrigger watches scroll and schedules an update
		ScrollTrigger.create({
			id: "nav_hideShow",
			start: 0,
			end: () => ScrollTrigger.maxScroll(window),
			invalidateOnRefresh: true,
			onUpdate(self) {
				currentScrollY = window.scrollY;

				if (DEBUG_NAV && self?.direction) {
					// direction: 1 down, -1 up
					log("onUpdate", { y: currentScrollY, direction: self.direction });
				}

				if (!ticking) {
					ticking = true;
					requestAnimationFrame(updateNav);
				}
			},
		});
	}

	astet.hasImagesLoaded = typeof window.imagesLoaded === "function";
	clickToCopy();
	homeCarousel();
	loadCardsOnScroll();
	finsweetScrollTriggerRefresh();
	nav_openClose();
	nav_hideShow();
}
