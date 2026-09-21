/**
 * `@local/dsh-mcp-store` — browser half.
 *
 * One tab in Settings → Plugins, after the skill Collection. It is the **store of MCP
 * servers**: a table of three columns, which are the three things a person and an agent
 * each need from it —
 *
 *   server           what it is called
 *   comment          the operator's own note, in whatever language he writes
 *   for the agent    the short description a future agent reads when deciding whether
 *                    to reach for this server at all
 *
 * A row opens into the rest: the transport, the endpoint or the command, where it came
 * from, when it entered, what was measured against it, and **the loader rows to paste**.
 *
 * The last one is the honest boundary. This panel does not write the harness's MCP
 * configuration, because that changes what every later session can call — a different
 * act from keeping a note, with a different blast radius. So it shows the operator the
 * exact snippet and the exact file, and he decides. A store that installed itself would
 * make every entry a decision nobody took.
 *
 * Hand-written in the built-bundle format the client module system serves
 * (`window.__ModuleLoader__.load({ id, factory })`); only baseline platform modules are
 * required.
 */

window.__ModuleLoader__.load({
	id: "@local/dsh-mcp-store",
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
		const ENDPOINT = "/api/mcp-store.mod";
		/** Locale namespace owned by this plugin. */
		const NS = "mcp-store";

		const en = {
			tab: "MCP store",
			title: "Store of MCP servers",
			subtitle: "Servers worth reaching for, with the line an agent reads to decide. This is a registry: it records, and it enables nothing.",
			// the three columns
			colStore: "The store",
			colServer: "Server",
			colComment: "Comment",
			colDescription: "Mini-description for the agent",
			tableEmpty: "The store is empty.",
			refresh: "Refresh",
			updatedAt: "Updated at",
			loading: "Loading…",
			busy: "Working…",
			// statuses
			statusProposed: "proposed",
			statusTried: "tried",
			statusWorking: "working",
			statusRefused: "refused",
			// the expanded row
			detailsTransport: "Transport",
			detailsEndpoint: "Endpoint",
			detailsCommand: "Command",
			detailsSource: "Source",
			detailsAdded: "Added",
			detailsUpdated: "Changed",
			detailsMeasured: "Measured",
			detailsSince: "Since then",
			detailsAgentLine: "Written for an agent",
			open: "Open the source",
			forget: "Remove from the store",
			// the paste box
			snippetLabel: "Paste this into the harness to actually load it",
			snippetGoes: "Goes into",
			snippetWhy: "The store does not enable anything. A server is loaded by a loader row in the profile's patch layer, and writing that file changes what every later session can call — so it is pasted by hand, by you.",
			snippetUnknown: "The file this harness reads for MCP servers could not be determined, so the snippet has no destination.",
			// the chat hand-off
			copyLabel: "Paste this into the chat",
			discuss: "Discuss with the agent",
			discussHint: "The entry went into the chat. Say what to change or say enable it, and the agent records that with the store's own tools — nothing is changed here by a click.",
			discussLead: "MCP store: let us look at",
			discussAsk: "Tell me what this server would give us, which of its tools you would actually reach for, and what you propose — enable it, test it first, or refuse it. I will answer.",
			// notes
			noteStore: "The table is the store: one file in the harness home, readable and writable by hand. The agent reaches it with the tools mcp_store_add, mcp_store_list, mcp_store_update and mcp_store_note — so “add this to the MCP store” in the chat has somewhere to land.",
			noteDescription: "The third column is the one that matters: a future agent reads it to decide whether this server is worth the tokens. Write it for a machine — what the server gives and when to reach for it — not for a person.",
			noteComment: "The comment column is yours, in whatever language you write, and nothing translates or rewrites it. A store that edited your own note would be your store no more.",
			noteStatus: "proposed means written down and never run. working and refused are decisions, and a new measurement does not quietly undo either.",
			// errors
			errNeedsName: "A server needs a name.",
			errBadId: "That name has no characters an id can be built from — use letters, digits or dashes.",
			errNeedsDescription: "A server needs a description for the agent.",
			errNeedsUrl: "An http server needs a URL.",
			errNeedsCommand: "A stdio server needs a command.",
			errBadTransport: "That transport is not one this harness has.",
			errBadStatus: "That status is not one of the four.",
			errBadArgs: "The argument list must be a list of strings.",
			errEmptyNote: "Write what was measured first.",
			errNoSuchEntry: "That entry is gone.",
			errWriteFailed: "The change could not be written.",
			errReadFailed: "The store could not be read.",
			errBadRequest: "The request was malformed.",
			errGeneric: "Something went wrong.",
		};

		const ru = {
			tab: "Хранилище MCP",
			title: "Хранилище MCP-серверов",
			subtitle: "Серверы, к которым стоит тянуться, и строка, по которой агент решает. Это реестр: он записывает и ничего не включает.",
			colStore: "Хранилище",
			colServer: "Сервер",
			colComment: "Комментарий",
			colDescription: "Мини-описание для агента",
			tableEmpty: "Хранилище пусто.",
			refresh: "Обновить",
			updatedAt: "Обновлено в",
			loading: "Загрузка…",
			busy: "Работаю…",
			statusProposed: "предложен",
			statusTried: "пробовали",
			statusWorking: "работает",
			statusRefused: "отказано",
			detailsTransport: "Транспорт",
			detailsEndpoint: "Адрес",
			detailsCommand: "Команда",
			detailsSource: "Источник",
			detailsAdded: "Добавлен",
			detailsUpdated: "Изменён",
			detailsMeasured: "Измерено",
			detailsSince: "С тех пор",
			detailsAgentLine: "Написано для агента",
			open: "Открыть источник",
			forget: "Убрать из хранилища",
			snippetLabel: "Вставь это в харнесс, чтобы он действительно загрузил сервер",
			snippetGoes: "Кладётся в",
			snippetWhy: "Хранилище ничего не включает. Сервер загружается строкой в патч-слое профиля, а запись в этот файл меняет то, что сможет вызвать каждая следующая сессия — поэтому её вставляешь ты, руками.",
			snippetUnknown: "Не удалось определить, из какого файла этот харнесс читает MCP-серверы, поэтому у сниппета нет адреса.",
			copyLabel: "Скопируй это в чат",
			discuss: "Обсудить с агентом",
			discussHint: "Запись ушла в чат. Скажи, что поправить, или скажи «включи» — и агент запишет это своими инструментами хранилища. Нажатием здесь ничего не меняется.",
			discussLead: "Хранилище MCP: посмотрим на",
			discussAsk: "Расскажи, что этот сервер нам даёт, за какими его инструментами ты бы действительно тянулся, и что предлагаешь — включить, сначала проверить или отказаться. Я отвечу.",
			noteStore: "Таблица и есть хранилище: один файл в домашнем каталоге харнесса, читаемый и правимый руками. Агент достаёт его инструментами mcp_store_add, mcp_store_list, mcp_store_update и mcp_store_note — поэтому у фразы «добавь это в хранилище MCP» в чате есть куда лечь.",
			noteDescription: "Третий столбец — главный: будущий агент читает его, чтобы решить, стоит ли этот сервер своих токенов. Пиши для машины — что сервер даёт и когда за ним тянуться, — а не для человека.",
			noteComment: "Столбец комментария — твой, на любом языке, и ничто его не переводит и не переписывает. Хранилище, правящее твою же заметку, перестало бы быть твоим.",
			noteStatus: "«предложен» — записано и ни разу не запущено. «работает» и «отказано» — решения, и новое измерение молча не отменяет ни то ни другое.",
			errNeedsName: "Серверу нужно имя.",
			errBadId: "В этом имени нет символов, из которых можно собрать id — используй буквы, цифры или дефисы.",
			errNeedsDescription: "Серверу нужно описание для агента.",
			errNeedsUrl: "Http-серверу нужен адрес.",
			errNeedsCommand: "Stdio-серверу нужна команда.",
			errBadTransport: "Такого транспорта в этом харнессе нет.",
			errBadStatus: "Такого состояния нет среди четырёх.",
			errBadArgs: "Список аргументов должен быть списком строк.",
			errEmptyNote: "Сначала напиши, что измерено.",
			errNoSuchEntry: "Этой записи больше нет.",
			errWriteFailed: "Изменение не записалось.",
			errReadFailed: "Не удалось прочитать хранилище.",
			errBadRequest: "Запрос был некорректным.",
			errGeneric: "Что-то пошло не так.",
		};

		const DICTIONARIES = { en, ru };

		/**
		 * The interface language, from the page first and the browser second.
		 *
		 * The language pack sets `documentElement.lang` when the active locale changes,
		 * so the page is authoritative. `navigator.language` is only a fallback for a
		 * harness that renders before the locale runtime has run.
		 */
		function locale() {
			const candidates = [
				typeof document === "undefined" ? "" : document.documentElement?.lang,
				typeof navigator === "undefined" ? "" : navigator.language,
			];
			for (const candidate of candidates) {
				const tag = String(candidate ?? "").toLowerCase();
				if (tag.startsWith("ru")) return "ru";
				if (tag.startsWith("en")) return "en";
			}
			return "en";
		}

		function translator(platformT) {
			return (key) => {
				// Our own dictionary wins, because these are our own keys. The platform
				// translator answers for its namespace and falls back to English for keys
				// it does not own, so asking it first makes a Russian panel English while
				// the tab label — which asks with no translator at all — stays Russian.
				const own = DICTIONARIES[locale()]?.[key];
				if (typeof own === "string") return own;
				if (typeof platformT === "function") {
					try {
						const value = platformT(key);
						if (typeof value === "string" && value !== "" && value !== key) return value;
					} catch { /* fall through */ }
				}
				return DICTIONARIES.en[key] ?? key;
			};
		}

		function hostBase() {
			const origin = globalThis.location?.origin;
			return origin !== undefined && origin !== "null" ? origin : "http://dsh.internal";
		}

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

		/** The label a state reads as, in the interface language. */
		const STATUS_LABEL = {
			proposed: "statusProposed",
			tried: "statusTried",
			working: "statusWorking",
			refused: "statusRefused",
		};

		/** How a state reads at a glance: green works, red is a decision against, amber is open. */
		const STATUS_TONE = {
			proposed: "neutral",
			tried: "warning",
			working: "success",
			refused: "danger",
		};

		/** The platform dot, with the same vocabulary the plugin inventory uses. */
		const STATUS_DOT = {
			proposed: "idle",
			tried: "idle",
			working: "done",
			refused: "error",
		};

		/**
		 * The sentence to paste into the chat. It carries the whole entry, because the
		 * agent has not seen this table: what the server is, what it would give, where it
		 * came from, and what is being asked of it.
		 */
		function discussPrompt(entry, t) {
			const lines = [
				`${t("discussLead")} «${entry.name}» — ${entry.transport}`,
				"",
				`${t("colDescription")}: ${entry.description}`,
			];
			if (entry.comment !== "") lines.push(`${t("colComment")}: ${entry.comment}`);
			if (entry.url !== "") lines.push(`${t("detailsEndpoint")}: ${entry.url}`);
			if (entry.command !== "") {
				lines.push(`${t("detailsCommand")}: ${[entry.command, ...(entry.args ?? [])].join(" ")}`);
			}
			lines.push(`${t("tab")}: ${entry.status}`);
			if (entry.source !== "") lines.push(`${t("detailsSource")}: ${entry.source}`);
			if ((entry.found ?? []).length > 0) {
				lines.push("", `${t("detailsMeasured")}:`, ...(entry.found ?? []).map((one) => `- ${one.fact}`));
			}
			lines.push("", t("discussAsk"));
			return lines.join("\n");
		}

		const ERROR_KEYS = {
			"needs-name": "errNeedsName",
			"bad-id": "errBadId",
			"needs-description": "errNeedsDescription",
			"needs-url": "errNeedsUrl",
			"needs-command": "errNeedsCommand",
			"bad-transport": "errBadTransport",
			"bad-status": "errBadStatus",
			"bad-args": "errBadArgs",
			"empty-note": "errEmptyNote",
			"empty-name": "errNeedsName",
			"empty-description": "errNeedsDescription",
			"no-such-entry": "errNoSuchEntry",
			"write-failed": "errWriteFailed",
			"read-failed": "errReadFailed",
			"bad-request": "errBadRequest",
			"method-not-allowed": "errBadRequest",
		};

		const styles = {
			wrap: { display: "grid", gap: "14px", fontSize: "13px" },
			head: { display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "baseline", justifyContent: "space-between" },
			refreshBox: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
			stamp: { fontSize: "12px", opacity: 0.65, whiteSpace: "nowrap" },
			title: { margin: 0, fontSize: "15px", fontWeight: 600 },
			subtitle: { margin: "2px 0 0", opacity: 0.7, fontSize: "12.5px" },
			section: { display: "grid", gap: "7px" },
			sectionName: { fontSize: "12.5px", fontWeight: 600, opacity: 0.85 },
			// The table is a four-column grid: the three the operator named, plus the
			// chevron. Built from grid rather than a <table> because the expanded row has
			// to span all of it, and because every other panel in this family is built the
			// same way out of platform elements.
			table: {
				borderRadius: "10px",
				border: "1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.28))",
				overflow: "hidden",
				background: "var(--dsw-alias-bg-secondary, rgba(127,127,127,.05))",
			},
			// One declaration used by the header and by every row, so the columns of the
			// header cannot drift from the columns of the body.
			grid: {
				display: "grid",
				gridTemplateColumns: "minmax(120px, 0.9fr) minmax(140px, 1.3fr) minmax(180px, 2fr) 28px",
				gap: "12px",
				alignItems: "center",
			},
			row: {
				padding: "9px 12px",
				borderTop: "1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.18))",
			},
			rowHead: {
				padding: "8px 12px",
				fontSize: "11.5px",
				textTransform: "uppercase",
				letterSpacing: ".04em",
				opacity: 0.6,
			},
			rowLine: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
			cellName: {
				display: "flex", alignItems: "center", gap: "8px", minWidth: 0,
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
				fontSize: "13px",
			},
			nameText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
			cellText: { minWidth: 0, lineHeight: 1.45, wordBreak: "break-word" },
			cellDim: { minWidth: 0, lineHeight: 1.45, wordBreak: "break-word", opacity: 0.68 },
			cellEmpty: { minWidth: 0, opacity: 0.45, fontStyle: "italic" },
			// The row's own state, under the row's own description: a dot and a word rather
			// than a second column, because the operator named three columns and a table of
			// five is not the table he asked for.
			cellState: { display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", fontSize: "11.5px", opacity: 0.72 },
			transportTag: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "11px", opacity: 0.8 },
			chevron: { display: "inline-flex", opacity: 0.55, transition: "transform .15s ease" },
			detailRow: {
				gridColumn: "1 / -1",
				display: "grid",
				gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)",
				gap: "10px 20px",
				padding: "2px 0 12px",
			},
			details: {
				display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "4px 14px",
				margin: 0, padding: 0, fontSize: "12.5px", alignContent: "start",
			},
			detailsLabel: { opacity: 0.6 },
			measured: { display: "grid", gap: "4px", fontSize: "12px", opacity: 0.75, lineHeight: 1.5 },
			measuredLine: { paddingLeft: "10px", textIndent: "-10px" },
			pasteBlock: { display: "grid", gap: "6px", alignContent: "start" },
			pasteLabel: { fontSize: "12px", fontWeight: 600, opacity: 0.8 },
			pasteGoes: { fontSize: "11.5px", opacity: 0.7, wordBreak: "break-all" },
			input: {
				width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: "12.5px",
				lineHeight: 1.5, padding: "7px 9px", borderRadius: "8px", color: "inherit",
				border: "1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.28))",
				background: "var(--dsw-alias-bg-primary, rgba(127,127,127,.06))",
				resize: "vertical",
			},
			mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
			hint: { fontSize: "11.5px", opacity: 0.6, lineHeight: 1.45 },
			notice: { fontSize: "12.5px", lineHeight: 1.5 },
			noticeError: { color: "var(--dsw-alias-state-error-primary, #d33)" },
			noticeInfo: { opacity: 0.75 },
			notes: { display: "grid", gap: "5px", fontSize: "12px", opacity: 0.7, lineHeight: 1.5 },
			empty: { opacity: 0.6, fontSize: "12.5px", padding: "10px 12px" },
			link: { color: "inherit", textDecoration: "underline", opacity: 0.85 },
		};

		function StoreTab(props) {
			const t = react.useMemo(() => translator(props?.t), [props?.t]);
			const [state, setState] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);
			const [refreshedAt, setRefreshedAt] = react.useState(null);
			const [expanded, setExpanded] = react.useState(null);

			const load = react.useCallback(() => {
				void (async () => {
					try {
						const answer = await callHost("GET");
						if (answer?.ok !== true) {
							setNotice({ kind: "error", text: t(ERROR_KEYS[answer?.code] ?? "errGeneric") });
							return;
						}
						setState(answer.state);
						setRefreshedAt(new Date().toLocaleTimeString());
					} catch (error) {
						setNotice({ kind: "error", text: `${t("errReadFailed")} ${String(error?.message ?? error)}` });
					}
				})();
			}, [t]);

			react.useEffect(() => { load(); }, [load]);
			react.useEffect(() => {
				const onFocus = () => { load(); };
				globalThis.addEventListener?.("focus", onFocus);
				return () => { globalThis.removeEventListener?.("focus", onFocus); };
			}, [load]);

			const run = (payload, okText) => {
				if (busy) return;
				setBusy(true);
				void (async () => {
					try {
						const answer = await callHost("POST", payload);
						if (answer?.ok !== true) {
							setNotice({ kind: "error", text: t(ERROR_KEYS[answer?.code] ?? "errGeneric") });
						} else {
							setState(answer.state);
							setRefreshedAt(new Date().toLocaleTimeString());
							if (okText !== undefined) setNotice({ kind: "info", text: okText });
						}
					} catch (error) {
						setNotice({ kind: "error", text: `${t("errWriteFailed")} ${String(error?.message ?? error)}` });
					} finally {
						setBusy(false);
					}
				})();
			};

			const head = h("div", { style: styles.head, key: "head" },
				h("div", { key: "titles" },
					h("h3", { style: styles.title }, t("title")),
					h("p", { style: styles.subtitle }, t("subtitle"))),
				h("div", { style: styles.refreshBox, key: "refresh" },
					refreshedAt !== null ? h("span", { style: styles.stamp }, `${t("updatedAt")} ${refreshedAt}`) : null,
					h(primitives.Button, { variant: "outline", disabled: busy, onClick: () => { load(); } },
						busy ? t("busy") : t("refresh"))));

			const body = [];

			// The section is named for what it holds, not by repeating the panel title above
			// it — the count is the part that changes.
			const count = state === null ? "" : ` · ${String(state.entries.length)}`;
			const counts = state === null
				? ""
				: ` · ${t("statusProposed")} ${String(state.proposed)}, `
					+ `${t("statusWorking")} ${String(state.working)}, `
					+ `${t("statusRefused")} ${String(state.refused)}`;

			// The header and every row are built from one `grid` declaration, so the
			// columns the operator reads cannot drift from the columns he clicks.
			const headerRow = h("div", { style: { ...styles.grid, ...styles.rowHead }, key: "head-row" },
				h("div", { key: "c1" }, t("colServer")),
				h("div", { key: "c2" }, t("colComment")),
				h("div", { key: "c3" }, t("colDescription")),
				h("div", { key: "c4" }));
			const tableRows = [];
			if (state !== null && state.entries.length === 0) {
				tableRows.push(h("div", { style: { ...styles.empty, ...styles.row }, key: "empty" }, t("tableEmpty")));
			}

			for (const entry of state?.entries ?? []) {
				const isOpen = expanded === entry.id;
				const statusLabel = t(STATUS_LABEL[entry.status] ?? "statusProposed");
				// The whole row is the control, so the chevron is a visual affordance and the
				// click target is the row itself — the same shape a mod and a skill card use.
				const cells = h("div", {
					style: { ...styles.grid, ...styles.row },
					key: "row",
					role: "button",
					"aria-expanded": isOpen,
					onClick: () => { setExpanded(isOpen ? null : entry.id); },
				},
					h("div", { style: styles.cellName, key: "name" },
						h("span", { style: styles.nameText, title: entry.name }, entry.name),
						h(primitives.Tag, { tone: STATUS_TONE[entry.status] ?? "neutral" },
							statusLabel)),
					entry.comment !== ""
						? h("div", { style: styles.cellText, key: "comment" }, entry.comment)
						: h("div", { style: styles.cellEmpty, key: "comment" }, "—"),
					// Two children, and the state line is the second — not one child that is an
					// array. Passed as an array the description arrives as a single nested child,
					// and anything walking the tree sees a node where the text should be: the
					// panel looked right and the third column was unreachable. The unit test caught
					// it, which is the only reason this comment exists.
					h("div", { style: styles.cellDim, key: "description" },
						entry.description,
						h("div", { style: styles.cellState, key: "state" },
							h(primitives.StateDot, { state: STATUS_DOT[entry.status] ?? "idle" }),
							h("span", null, statusLabel),
							h("span", { style: styles.transportTag }, entry.transport))),
					h("span", {
						key: "chevron",
						style: { ...styles.chevron, transform: isOpen ? "rotate(180deg)" : "none" },
					}, h(primitives.IconChevronDownOutline14, {})));

				const pair = (label, value, id) => [
					h("dt", { style: styles.detailsLabel, key: `${id}-l` }, label),
					h("dd", { style: { margin: 0, wordBreak: "break-all" }, key: `${id}-v` }, value),
				];
				const rows = [
					pair(t("detailsTransport"),
						h("span", { style: styles.mono }, entry.transport)
						, "t"),
				];
				if (entry.transport === "stdio") {
					rows.push(pair(t("detailsCommand"),
						h("span", { style: styles.mono },
							[entry.command, ...(entry.args ?? [])].join(" ")), "c"));
				} else if (entry.url !== "") {
					rows.push(pair(t("detailsEndpoint"),
						h("a", {
							href: entry.url, target: "_blank", rel: "noreferrer", style: styles.link,
							onClick: (event) => { event.stopPropagation(); },
						}, entry.url), "u"));
				}
				rows.push(pair(t("detailsAgentLine"),
					h("span", { style: styles.cellDim }, entry.description), "d"));
				if (entry.source !== "") {
					rows.push(pair(t("detailsSource"),
						/^https?:/u.test(entry.source)
							? h("a", {
								href: entry.source, target: "_blank", rel: "noreferrer", style: styles.link,
								onClick: (event) => { event.stopPropagation(); },
							}, t("open"))
							: h("span", { style: styles.cellDim }, entry.source), "s"));
				}
				rows.push(pair(t("detailsAdded"), String(entry.addedAt ?? "").slice(0, 10), "a"));

				const measured = (entry.found ?? []).map((one, index) => h("div", {
					style: styles.measuredLine, key: `f-${String(index)}`,
				}, `• ${one.at === null ? "" : `${one.at} — `}${one.fact}`));
				const since = (entry.observations ?? []).map((one, index) => h("div", {
					style: styles.measuredLine, key: `o-${String(index)}`,
				}, `• ${String(one.at ?? "").slice(0, 10)} — ${one.text}`));

				const details = h("div", { style: styles.detailRow, key: "details" },
					h("div", { key: "left" },
						h("dl", { style: styles.details }, ...rows),
						measured.length > 0 || since.length > 0
							? h("div", { style: { marginTop: "8px" } },
								measured.length > 0
									? h("div", { style: styles.pasteLabel, key: "ml" }, t("detailsMeasured"))
									: null,
								h("div", { style: styles.measured, key: "mv" }, ...measured),
								since.length > 0
									? h("div", { style: { ...styles.pasteLabel, marginTop: "6px" }, key: "sl" },
										t("detailsSince"))
									: null,
								h("div", { style: styles.measured, key: "sv" }, ...since))
							: null),
					h("div", { style: styles.pasteBlock, key: "right" },
						h("div", { style: styles.pasteLabel }, t("snippetLabel")),
						h("div", { style: styles.pasteGoes },
							state?.patchFile !== undefined && state.patchFile !== ""
								? `${t("snippetGoes")}: ${state.patchFile}`
								: t("snippetUnknown")),
						h("textarea", {
							readOnly: true,
							value: entry.snippet ?? "",
							style: { ...styles.input, ...styles.mono, minHeight: "104px", fontSize: "11.5px", opacity: 0.9 },
							// One click takes the whole snippet; there is nothing here to edit.
							onClick: (event) => { event.stopPropagation(); event.target.select(); },
						}),
						h("div", { style: styles.hint }, t("snippetWhy")),
						h("div", { style: styles.pasteLabel, marginTop: "4px" }, t("copyLabel")),
						h("textarea", {
							readOnly: true,
							value: discussPrompt(entry, t),
							style: { ...styles.input, minHeight: "76px", fontSize: "11.5px", opacity: 0.9 },
							onClick: (event) => { event.stopPropagation(); event.target.select(); },
						}),
						h("div", { style: styles.rowLine },
							h(primitives.Button, {
								variant: "ghost", disabled: busy, key: "forget",
								onClick: (event) => {
									event.stopPropagation();
									run({ action: "forget", id: entry.id });
								},
							}, t("forget")))));

				tableRows.push(h("div", { key: entry.id },
					cells,
					isOpen ? details : null));
			}

			body.push(h("div", { style: styles.section, key: "section" },
				h("div", { style: styles.sectionName }, `${t("colStore")}${count}${counts}`),
				h("div", { style: styles.table }, headerRow, ...tableRows)));

			if (notice !== null) {
				body.push(h("div", {
					style: notice.kind === "error"
						? { ...styles.notice, ...styles.noticeError }
						: { ...styles.notice, ...styles.noticeInfo },
					key: "notice",
				}, notice.text));
			}

			body.push(h("div", { style: styles.notes, key: "notes" },
				h("div", { key: "n0" }, t("noteStore")),
				h("div", { key: "n1" }, t("noteDescription")),
				h("div", { key: "n2" }, t("noteComment")),
				h("div", { key: "n3" }, t("noteStatus"))));

			return h("div", { style: styles.wrap }, head, ...body);
		}

		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { en, ru }), "mcp-store: dictionaries");
			ctx.slots.inject(SLOT_NAME, () => ctx.slots.register({
				name: SLOT_NAME,
				id: "mcp-store",
				order: 32,
				label: () => translator(null)("tab"),
				locale: NS,
			}, StoreTab));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
