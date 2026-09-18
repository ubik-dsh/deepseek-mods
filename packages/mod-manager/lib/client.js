/**
 * `@local/dsh-mod-manager` — browser half.
 *
 * Registers one tab in Settings → Plugins. The tab lists every loader row in
 * every patch layer of this Harness home, says for each whether the package is
 * on disk and whether the running page was served it, and offers turn-off,
 * turn-on and remove.
 *
 * The two facts are deliberately kept apart, because they differ: a row can be
 * present while the page was loaded before it appeared, and a package can be on
 * disk with its row removed. Merging them into one "installed" badge would hide
 * exactly the state a person opens this panel to understand.
 *
 * Hand-written in the built-bundle format the client module system serves
 * (`window.__ModuleLoader__.load({ id, factory })`); only baseline platform
 * modules are required.
 */

window.__ModuleLoader__.load({
	id: "@local/dsh-mod-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = react.createElement;

		/** Settings tab slot; the Plugins section renders one panel per entry. */
		const SLOT_NAME = "settings.plugins.tab";
		/** Exact host route registered by this package's node half. */
		const ENDPOINT = "/api/mod-manager.mod";
		/** Locale namespace owned by this plugin. */
		const NS = "mod-manager";

		const en = {
			tab: "Mods",
			title: "Installed mods",
			subtitle: "Loader rows in this Harness home and the packages they mount.",
			home: "Harness home",
			refresh: "Refresh",
			loading: "Loading…",
			empty: "No loader rows in this home yet.",
			layerMissing: "this layer does not exist yet",
			colMod: "Mod",
			colState: "State",
			colSize: "Size",
			colActions: "Actions",
			served: "served to this page",
			notServed: "not served here",
			onDisk: "on disk",
			notOnDisk: "missing on disk",
			selfBadge: "this panel",
			offBadge: "turned off",
			unmanaged: "not managed",
			disable: "Turn off",
			enable: "Turn on",
			uninstall: "Remove",
			confirmUninstall: "Remove this mod? A copy of the package and the patch files is saved first.",
			orphans: "Packages with no loader row",
			orphansHint: "Present under @local/ but no patch layer mounts them, so nothing loads them.",
			backups: "Snapshots",
			noteLive: "Turning a mod off or on takes effect in the running server without a restart. Changing a mod's files does not — that needs a restart of dsh web.",
			noteScope: "Only @local/ packages are managed here, and this panel never turns itself off. Shipped DSH plugins are untouched.",
			busy: "Working…",
			okDisabled: "Turned off.",
			okEnabled: "Turned on.",
			okUninstalled: "Removed.",
			errUnknownLayer: "That patch layer no longer exists.",
			errRowNotFound: "That row is no longer in the patch file.",
			errPackageNotInstalled: "The package is not on disk, so its row was not restored. Install it with tools/install.mjs first.",
			errForbiddenPackage: "Only @local/ packages can be managed here.",
			errSelfManaged: "This panel cannot turn itself off.",
			errWriteFailed: "The change could not be written.",
			errReadFailed: "The Harness home could not be read.",
			errBadRequest: "The request was malformed.",
			errGeneric: "Something went wrong.",
		};

		const ru = {
			tab: "Моды",
			title: "Установленные моды",
			subtitle: "Строки загрузчика в этом домашнем каталоге и пакеты, которые они монтируют.",
			home: "Домашний каталог",
			refresh: "Обновить",
			loading: "Загрузка…",
			empty: "В этом каталоге пока нет строк загрузчика.",
			layerMissing: "этого слоя ещё нет",
			colMod: "Мод",
			colState: "Состояние",
			colSize: "Размер",
			colActions: "Действия",
			served: "отдан этой странице",
			notServed: "не отдан здесь",
			onDisk: "на диске",
			notOnDisk: "нет на диске",
			selfBadge: "эта панель",
			offBadge: "выключен",
			unmanaged: "не управляется",
			disable: "Выключить",
			enable: "Включить",
			uninstall: "Удалить",
			confirmUninstall: "Удалить мод? Копия пакета и файлов патча сохраняется заранее.",
			orphans: "Пакеты без строки загрузчика",
			orphansHint: "Лежат в @local/, но ни один слой патча их не монтирует — значит, ничто их не загружает.",
			backups: "Снапшоты",
			noteLive: "Выключение и включение мода применяется в работающем сервере без перезапуска. А изменение файлов мода — нет: для этого нужен перезапуск dsh web.",
			noteScope: "Здесь управляются только пакеты @local/, и панель никогда не выключает сама себя. Штатные плагины DSH не затрагиваются.",
			busy: "Работаю…",
			okDisabled: "Выключен.",
			okEnabled: "Включён.",
			okUninstalled: "Удалён.",
			errUnknownLayer: "Этого слоя патча больше нет.",
			errRowNotFound: "Этой строки больше нет в файле патча.",
			errPackageNotInstalled: "Пакета нет на диске, поэтому строка не восстановлена. Сначала установите его через tools/install.mjs.",
			errForbiddenPackage: "Здесь можно управлять только пакетами @local/.",
			errSelfManaged: "Эта панель не может выключить саму себя.",
			errWriteFailed: "Не удалось записать изменение.",
			errReadFailed: "Не удалось прочитать домашний каталог.",
			errBadRequest: "Запрос был некорректным.",
			errGeneric: "Что-то пошло не так.",
		};

		const DICTIONARIES = { en, ru };

		/** The language the GUI is currently showing, as far as the DOM records it. */
		function locale() {
			const lang = typeof document === "undefined" ? "" : String(document.documentElement?.lang ?? "");
			return lang.toLowerCase().startsWith("ru") ? "ru" : "en";
		}

		/**
	 * Translator. The slot's own `t` wins when the platform provides a working
	 * one; otherwise the built-in dictionary answers. Falling back rather than
	 * trusting either alone means a missing dictionary or a renamed key shows
	 * readable text instead of a raw key.
	 *
	 * The language is read on every lookup, not captured here, so a translator
	 * that is memoized still follows a language change.
	 */
		function translator(platformT) {
			return (key) => {
				if (typeof platformT === "function") {
					try {
						const value = platformT(key);
						if (typeof value === "string" && value !== "" && value !== key) return value;
					} catch {}
				}
				const lang = locale();
				return DICTIONARIES[lang]?.[key] ?? DICTIONARIES.en[key] ?? key;
			};
		}

		/** Human-readable size. */
		function sizeOf(bytes) {
			if (typeof bytes !== "number" || bytes <= 0) return "—";
			if (bytes < 1024) return `${String(bytes)} B`;
			if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
		}

		/**
	 * Package names this page was actually served, read from the boot graph the
	 * document requested — the same fact `tools/boot-check.mjs` reads from
	 * outside, seen from inside the page.
	 *
	 * Both the DOM and the resource timeline are consulted: the loader may
	 * request a bundle through a `<script>` tag or a preload link, and the
	 * resource timeline also catches one that has already been removed from the
	 * document. Missing a source would mark a served mod as unserved, which is
	 * the one wrong answer this panel must not give.
	 */
		function bootGraphUrls() {
			const urls = [];
			if (typeof document !== "undefined") {
				for (const node of document.querySelectorAll("script[src],link[href]")) {
					const url = node.getAttribute("src") ?? node.getAttribute("href") ?? "";
					if (url.includes("/plugins/")) urls.push(url);
				}
			}
			if (typeof performance !== "undefined" && typeof performance.getEntriesByType === "function") {
				for (const entry of performance.getEntriesByType("resource")) {
					if (typeof entry?.name === "string" && entry.name.includes("/plugins/")) urls.push(entry.name);
				}
			}
			return urls;
		}

		function servedNames() {
			const names = new Set();
			for (const url of bootGraphUrls()) {
				const marker = url.indexOf("??");
				if (marker === -1) continue;
				for (const part of url.slice(marker + 2).split(",")) {
					const clean = part.replace(/&rev=.*$/u, "").replace(/\/client\.js$/u, "").trim();
					if (clean !== "") names.add(clean);
				}
			}
			return names;
		}

		/** Browser origin, with the connection carrier's null-origin fallback. */
		function hostBase() {
			const origin = globalThis.location?.origin;
			return origin !== undefined && origin !== "null" ? origin : "http://dsh.internal";
		}

		/** Call the host half and unwrap its envelope. */
		async function callHost(method, payload) {
			const init = { method, headers: { accept: "application/json" } };
			if (payload !== undefined) {
				init.headers["content-type"] = "application/json";
				init.body = JSON.stringify(payload);
			}
			const response = await fetch(new URL(ENDPOINT, hostBase()).toString(), init);
			let body = null;
			try {
				body = await response.json();
			} catch {
				body = null;
			}
			if (body === null) throw new Error(`HTTP ${String(response.status)}`);
			return body;
		}

		/** The dictionary key that phrases a failed action. */
		const ERROR_KEYS = {
			"unknown-layer": "errUnknownLayer",
			"row-not-found": "errRowNotFound",
			"package-not-installed": "errPackageNotInstalled",
			"forbidden-package": "errForbiddenPackage",
			"self-managed": "errSelfManaged",
			"write-failed": "errWriteFailed",
			"read-failed": "errReadFailed",
			"bad-request": "errBadRequest",
		};

		const styles = {
			wrap: { display: "grid", gap: "14px", fontSize: "13px" },
			head: { display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "baseline", justifyContent: "space-between" },
			title: { margin: 0, fontSize: "15px", fontWeight: 600 },
			subtitle: { margin: "2px 0 0", opacity: 0.7, fontSize: "12.5px" },
			home: {
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
				fontSize: "12px",
				opacity: 0.75,
				wordBreak: "break-all",
			},
			layer: { display: "grid", gap: "6px" },
			layerName: { fontSize: "12.5px", fontWeight: 600, opacity: 0.85 },
			row: {
				display: "grid",
				gridTemplateColumns: "minmax(0, 1fr) auto",
				gap: "10px",
				alignItems: "center",
				padding: "9px 11px",
				borderRadius: "8px",
				border: "1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.28))",
				background: "var(--dsw-alias-bg-secondary, rgba(127,127,127,.05))",
			},
			modName: {
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
				fontSize: "12.5px",
				wordBreak: "break-all",
			},
			rowId: { fontSize: "11.5px", opacity: 0.6 },
			badges: { display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center", marginTop: "4px" },
			badge: { fontSize: "11px", opacity: 0.85 },
			actions: { display: "flex", gap: "6px", flexWrap: "nowrap" },
			notice: { fontSize: "12.5px", lineHeight: 1.5 },
			noticeError: { color: "var(--dsw-alias-state-error-primary, #d33)" },
			noticeInfo: { opacity: 0.75 },
			notes: { display: "grid", gap: "5px", fontSize: "12px", opacity: 0.7, lineHeight: 1.5 },
			section: { display: "grid", gap: "6px" },
		};

		/** One badge: a translated label, plus a tone when it carries meaning. */
		function badge(t, key, tone) {
			return h(primitives.Tag, { tone: tone ?? "neutral", key }, t(key));
		}

		/**
	 * The panel: current state on top, one block per patch layer, then orphans.
	 * @param props - slot props; `t` is used when the platform supplies it.
	 * @returns the settings tab content.
	 */
		function ModManagerTab(props) {
			// Memoized: a fresh translator on every render would make `load` a new
			// function each time, and the effect below would refetch forever.
			const t = react.useMemo(() => translator(props?.t), [props?.t]);
			const [state, setState] = react.useState(null);
			const [served, setServed] = react.useState(() => servedNames());
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);

			const load = react.useCallback(() => {
				setBusy(true);
				setNotice(null);
				// The failure branch reports instead of throwing: a throw inside the
				// fulfilment handler would escape the rejection handler below and
				// surface as an unhandled rejection rather than a message.
				callHost("GET").then((body) => {
					if (body.ok === false) {
						setNotice({ kind: "error", text: t(ERROR_KEYS[body.code] ?? "errGeneric") });
						return;
					}
					setState(body);
					setServed(servedNames());
				}, (error) => {
					setNotice({ kind: "error", text: t(ERROR_KEYS[String(error?.message)] ?? "errGeneric") });
				}).finally(() => {
					setBusy(false);
				});
			}, [t]);

			react.useEffect(() => {
				load();
			}, [load]);

			const run = (payload, okKey) => {
				setBusy(true);
				setNotice(null);
				callHost("POST", payload).then((body) => {
					if (body.ok === false) {
						setNotice({ kind: "error", text: t(ERROR_KEYS[body.code] ?? "errGeneric") });
						if (body.state !== undefined) setState(body.state);
						return;
					}
					if (body.state !== undefined) setState(body.state);
					setServed(servedNames());
					setNotice({ kind: "info", text: t(okKey) });
				}, (error) => {
					setNotice({ kind: "error", text: t(ERROR_KEYS[String(error?.message)] ?? "errGeneric") });
				}).finally(() => {
					setBusy(false);
				});
			};

			const head = h("div", { style: styles.head },
				h("div", null,
					h("h3", { style: styles.title }, t("title")),
					h("p", { style: styles.subtitle }, t("subtitle"))),
				h(primitives.Button, {
					variant: "outline",
					disabled: busy,
					onClick: load,
				}, busy ? t("busy") : t("refresh")));

			const body = [];
			body.push(h("div", { style: styles.home, key: "home" }, `${t("home")}: ${String(state?.home ?? "…")}`));

			if (state === null && busy) {
				body.push(h("div", { style: styles.notice, key: "loading" }, t("loading")));
			}

			const rowOf = (layer, row) => {
				const present = row.package !== null && row.package !== undefined;
				const isServed = served.has(row.name);
				const badges = h("div", { style: styles.badges },
					row.disabled ? badge(t, "offBadge", "solid") : null,
					row.self ? badge(t, "selfBadge", "solid") : null,
					!row.managed ? h("span", { style: styles.badge, key: "unmanaged" }, t("unmanaged")) : null,
					present
						? h("span", { style: styles.badge, key: "disk" }, `• ${t("onDisk")}`)
						: badge(t, "notOnDisk", "neutral"),
					h("span", { style: styles.badge, key: "served" }, isServed ? `• ${t("served")}` : `• ${t("notServed")}`));

				// Which toggle is offered follows whether the row is in the patch
				// file, not whether the package is on disk: a broken row can still
				// be turned off, and a turned-off row is the only thing that can be
				// turned back on.
				const canManage = row.managed && !row.self;
				const actions = h("div", { style: styles.actions },
					canManage
						? (row.disabled
							? h(primitives.Button, {
								variant: "outline",
								disabled: busy,
								key: "enable",
								title: present ? undefined : t("errPackageNotInstalled"),
								onClick: () => {
									run({ action: "enable", layer: layer.key, id: row.id }, "okEnabled");
								},
							}, t("enable"))
							: h(primitives.Button, {
								variant: "outline",
								disabled: busy,
								key: "disable",
								onClick: () => {
									run({ action: "disable", layer: layer.key, id: row.id }, "okDisabled");
								},
							}, t("disable")))
						: null,
					canManage && present && !row.disabled
						? h(primitives.Button, {
							variant: "ghost",
							disabled: busy,
							key: "uninstall",
							onClick: () => {
								if (globalThis.confirm?.(t("confirmUninstall")) === false) return;
								run({ action: "uninstall", layer: layer.key, id: row.id }, "okUninstalled");
							},
						}, t("uninstall"))
						: null);

				return h("div", { style: styles.row, key: `${layer.key}:${row.id}` },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: styles.modName }, row.name),
						h("div", { style: styles.rowId }, `id: ${row.id}`),
						badges),
					actions);
			};

			for (const layer of state?.layers ?? []) {
				body.push(h("div", { style: styles.layer, key: layer.key },
					h("div", { style: styles.layerName },
						`${layer.label}${layer.exists ? "" : ` — ${t("layerMissing")}`}`),
					layer.rows.length === 0
						? h("div", { style: styles.noticeInfo }, t("empty"))
						: layer.rows.map((row) => rowOf(layer, row))));
			}

			if ((state?.orphans ?? []).length > 0) {
				body.push(h("div", { style: styles.section, key: "orphans" },
					h("div", { style: styles.layerName }, t("orphans")),
					h("div", { style: styles.noticeInfo }, t("orphansHint")),
					state.orphans.map((entry) => h("div", { style: styles.row, key: entry.name },
						h("div", { style: { minWidth: 0 } },
							h("div", { style: styles.modName }, entry.name),
							h("div", { style: styles.rowId }, `${entry.directory}${entry.version === null ? "" : ` • ${entry.version}`}`)),
						h("div", { style: styles.badge }, sizeOf(entry.bytes))))));
			}

			if (state !== null) {
				body.push(h("div", { style: styles.notes, key: "notes" },
					h("div", null, t("noteLive")),
					h("div", null, t("noteScope")),
					h("div", null, `${t("backups")}: ${String(state.backupRoot)}`)));
			}

			if (notice !== null) {
				body.push(h("div", {
					style: { ...styles.notice, ...(notice.kind === "error" ? styles.noticeError : styles.noticeInfo) },
					key: "notice",
				}, notice.text));
			}

			return h("div", { style: styles.wrap }, head, ...body);
		}

		/** Required client services: the slot registry and the locale registry. */
		const inject = ["slots", "locale"];

		/**
	 * Register the settings tab.
	 * @param ctx - browser context carrying `slots` and `locale`.
	 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { en, ru }), "mod-manager: dictionaries");
			ctx.slots.inject(SLOT_NAME, () => ctx.slots.register({
				name: SLOT_NAME,
				id: "mods",
				order: 20,
				label: () => translator(null)("tab"),
				locale: NS,
			}, ModManagerTab));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
