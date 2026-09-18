/**
 * `@local/dsh-system-prompt-mod` — browser half.
 *
 * Registers one control into the Session Header utilities slot of the chat
 * page. It opens a modal that reads the live system prompt from the host half,
 * offers a large editor, and applies the result on the next model request.
 *
 * Hand-written in the built-bundle format the client module system serves
 * (`window.__ModuleLoader__.load({ id, factory })`), so no build step is
 * involved. Only baseline platform modules are required.
 */

window.__ModuleLoader__.load({
	id: "@local/dsh-system-prompt-mod",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = react.createElement;

		/** Session Header utilities slot — the same row the first-party header actions use. */
		const SLOT_NAME = "conversation.session.header.utilities";
		/** Exact host route registered by this package's node half. */
		const ENDPOINT = "/api/system-prompt.mod";

		/**
	 * The shipped Modal is `min(380px, 100%)` wide, which is cramped for prompt
	 * prose. Own a class on the dialog and double it; the style tag follows the
	 * client-bundle CSS idiom (one tag per plugin, reused across reloads).
	 */
		const DIALOG_CLASS = "dspm-dialog";
		const CSS_TAG_ID = "@local/dsh-system-prompt-mod/Modal.module.css";
		const CSS = "." + DIALOG_CLASS + "{width:min(760px,100%) !important}";
		if (typeof document !== "undefined"
			&& document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG_ID) + "]") === null) {
			const styleTag = document.createElement("style");
			styleTag.dataset.plugin = "@local/dsh-system-prompt-mod";
			styleTag.dataset.pluginCss = CSS_TAG_ID;
			styleTag.textContent = CSS;
			document.head.appendChild(styleTag);
		}

		/** Browser origin, with the connection carrier's null-origin fallback. */
		function hostBase() {
			const origin = globalThis.location?.origin;
			return origin !== undefined && origin !== "null" ? origin : "http://dsh.internal";
		}

		/** Human-readable message of an unknown thrown value. */
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}

		/**
	 * Call the host half.
	 * @param method - `GET` reads state and the rendered prompt, `POST` saves an edit.
	 * @param payload - optional JSON body for `POST`.
	 * @param sessionId - live session whose agent scope renders the prompt.
	 * @returns the host snapshot.
	 */
		async function callHost(method, payload, sessionId) {
			const target = new URL(ENDPOINT, hostBase());
			if (typeof sessionId === "string" && sessionId !== "") {
				target.searchParams.set("sessionId", sessionId);
			}
			const init = { method, headers: { accept: "application/json" } };
			if (payload !== undefined) {
				init.headers["content-type"] = "application/json";
				init.body = JSON.stringify(payload);
			}
			const response = await fetch(target.toString(), init);
			let body = null;
			try {
				body = await response.json();
			} catch {
				body = null;
			}
			if (body === null) throw new Error(`HTTP ${response.status}`);
			if (!response.ok || body.ok === false) throw new Error(body.error ?? `HTTP ${response.status}`);
			return body;
		}

		const styles = {
			status: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "10px", fontSize: "13px" },
			modeRow: { display: "flex", gap: "10px", alignItems: "center", marginBottom: "10px", fontSize: "13px" },
			actionsRow: { display: "flex", flexWrap: "nowrap", gap: "8px", alignItems: "center", marginTop: "12px" },
			action: { flex: "1 1 0", minWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
			textarea: {
				width: "100%",
				minHeight: "38vh",
				resize: "vertical",
				boxSizing: "border-box",
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
				fontSize: "12.5px",
				lineHeight: "1.5",
				padding: "10px",
				borderRadius: "8px",
				border: "1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.4))",
				background: "var(--dsw-alias-bg-secondary, rgba(127,127,127,.06))",
				color: "inherit",
			},
			notice: { marginTop: "10px", fontSize: "12.5px", lineHeight: "1.5", whiteSpace: "pre-wrap" },
			noticeError: { color: "var(--dsw-alias-state-error-primary, #d33)" },
			noticeInfo: { color: "var(--dsw-alias-label-secondary, inherit)" },
			pre: {
				margin: "8px 0 0",
				maxHeight: "30vh",
				overflow: "auto",
				padding: "10px",
				borderRadius: "8px",
				background: "var(--dsw-alias-bg-secondary, rgba(127,127,127,.06))",
				fontSize: "12px",
				lineHeight: "1.45",
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
			},
			footer: { display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" },
			label: { fontSize: "13px", opacity: 0.85 },
		};

		/**
	 * The editor modal: live host state from the current session's agent scope,
	 * one textarea, and explicit apply/disable actions.
	 * @param props - `open`/`onClose` from the header control plus the session id.
	 * @returns the modal contribution.
	 */
		function SystemPromptEditor({ open, onClose, sessionId }) {
			const [snapshot, setSnapshot] = react.useState(null);
			const [text, setText] = react.useState("");
			const [mode, setMode] = react.useState("append");
			const [enabled, setEnabled] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);
			const [showCurrent, setShowCurrent] = react.useState(false);

			const adopt = (state) => {
				setSnapshot(state);
				setText(typeof state.text === "string" ? state.text : "");
				setMode(state.mode === "replace" ? "replace" : "append");
				setEnabled(state.enabled === true);
			};

			react.useEffect(() => {
				if (!open) return;
				let alive = true;
				setBusy(true);
				setNotice(null);
				callHost("GET", undefined, sessionId).then((state) => {
					if (alive) adopt(state);
				}, (error) => {
					if (alive) setNotice({ kind: "error", text: messageOf(error) });
				}).finally(() => {
					if (alive) setBusy(false);
				});
				return () => {
					alive = false;
				};
			}, [open, sessionId]);

			const submit = (payload, info) => {
				setBusy(true);
				setNotice(null);
				callHost("POST", { sessionId, ...payload }, sessionId).then((state) => {
					adopt(state);
					setNotice({ kind: "info", text: info });
				}, (error) => {
					setNotice({ kind: "error", text: messageOf(error) });
				}).finally(() => {
					setBusy(false);
				});
			};

			/** The current prompt the host rendered, preferring the unmodified base. */
			const currentPrompt = snapshot === null
				? ""
				: (snapshot.baseAvailable ? snapshot.basePrompt : snapshot.effectivePrompt) ?? "";

			const statusLine = snapshot === null
				? (busy ? "Загрузка…" : "")
				: [
					snapshot.active
						? (snapshot.mode === "replace" ? "Активно: полная замена промпта" : "Активно: дополнение к промпту")
						: "Мод выключен — используется штатный промпт",
					`• ${String(currentPrompt.length)} символов`,
				].join(" ");

			const body = h(react.Fragment, null,
				h("div", { style: styles.status },
					h(primitives.Tag, { tone: enabled ? "solid" : "neutral" }, enabled ? "включён" : "выключен"),
					h("span", { style: styles.label }, statusLine)),
				h("div", { style: styles.modeRow },
					h(primitives.Switch, {
						checked: mode === "replace",
						label: "Режим замены",
						onChange: (next) => {
							setMode(next === true ? "replace" : "append");
						},
					}),
					h("span", { style: styles.label }, mode === "replace"
						? "Заменить системный промпт целиком (текст ниже становится всем промптом)"
						: "Добавить текст в конец системного промпта")),
				h("textarea", {
					style: styles.textarea,
					value: text,
					spellCheck: false,
					placeholder: "Текст вашего системного промпта…",
					onChange: (event) => {
						setText(event.target.value);
					},
				}),
				h("div", { style: styles.actionsRow },
					h(primitives.Button, {
						variant: "outline",
						style: styles.action,
						title: "Перенести текущий системный промпт в редактор",
						disabled: busy || currentPrompt === "",
						onClick: () => {
							setText(currentPrompt);
							setNotice({ kind: "info", text: "Текущий промпт загружен в редактор — правьте и сохраняйте." });
						},
					}, "Взять текущий"),
					h(primitives.Button, {
						variant: "outline",
						style: styles.action,
						title: "Показать или скрыть текущий системный промпт",
						onClick: () => {
							setShowCurrent((value) => !value);
						},
					}, showCurrent ? "Скрыть" : "Показать")),
				showCurrent && h("pre", { style: styles.pre }, snapshot?.effectivePrompt ?? ""),
				snapshot?.effectivePrompt == null && snapshot?.error != null
					&& h("div", { style: { ...styles.notice, ...styles.noticeError } }, snapshot.error),
				snapshot?.effectivePrompt != null && snapshot?.exact === false
					&& h("div", { style: { ...styles.notice, ...styles.noticeInfo } },
						`Предпросмотр показан без подстановки переменных (${String(snapshot.error ?? "")}). На сам промпт это не влияет.`),
				snapshot !== null && h("div", { style: { ...styles.notice, ...styles.noticeInfo } },
					`Источник: ${snapshot.scoped ? "scope текущей сессии" : "глобальный слой"} • файл: ${String(snapshot.path)}`),
				notice !== null && h("div", {
					style: { ...styles.notice, ...(notice.kind === "error" ? styles.noticeError : styles.noticeInfo) },
				}, notice.text),
			);

			const footer = h("div", { style: styles.footer },
				enabled && h(primitives.Button, {
					variant: "outline",
					disabled: busy,
					onClick: () => {
						submit({ enabled: false }, "Мод выключен: используется штатный системный промпт.");
					},
				}, "Выключить"),
				h(primitives.Button, {
					variant: "ghost",
					disabled: busy,
					onClick: onClose,
				}, "Закрыть"),
				h(primitives.Button, {
					variant: "primary",
					disabled: busy,
					onClick: () => {
						submit({ enabled: true, mode, text }, "Сохранено. Изменения применятся со следующего сообщения.");
					},
				}, "Сохранить и применить"));

			return h(primitives.Modal, {
				open,
				onClose,
				className: DIALOG_CLASS,
				title: "Системный промпт",
				description: "Промпт, который DSH отправляет модели вместе с каждым запросом.",
				closeLabel: "Закрыть",
				children: body,
				footer,
			});
		}

		/**
	 * Session Header control: one button that opens the editor modal.
	 * @param props - standard session-scoped slot props; only `sessionId` is used.
	 * @returns the header contribution.
	 */
		function SystemPromptButton(props) {
			const [open, setOpen] = react.useState(false);
			const sessionId = props?.sessionId;
			return h(react.Fragment, null,
				h(primitives.Button, {
					variant: "ghost",
					icon: h(primitives.IconPersonalizationOutline16, {}),
					title: "Системный промпт: посмотреть и изменить",
					"aria-label": "Системный промпт",
					onClick: () => {
						setOpen(true);
					},
				}, "Промпт"),
				h(SystemPromptEditor, {
					open,
					sessionId,
					onClose: () => {
						setOpen(false);
					},
				}));
		}

		/** Required client services: the slot registry. */
		const inject = ["slots"];

		/**
	 * Register the header control.
	 * @param ctx - browser context carrying the `slots` service.
	 */
		function apply(ctx) {
			ctx.slots.inject(SLOT_NAME, () => ctx.slots.register({
				name: SLOT_NAME,
				id: "system-prompt-mod",
				inject: () => ({}),
			}, SystemPromptButton));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
