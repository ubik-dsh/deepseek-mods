/**
 * `@local/dsh-style-switch` — browser half.
 *
 * One control in the Session Header utilities row: it shows the style in force
 * and opens a small dialog to change it. Changing it takes effect on the next
 * message — the host half re-reads its state at every prompt assembly.
 *
 * Hand-written in the built-bundle format the client module system serves
 * (`window.__ModuleLoader__.load({ id, factory })`), so no build step is
 * involved. Only baseline platform modules are required.
 */

window.__ModuleLoader__.load({
	id: "@local/dsh-style-switch",
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
		const ENDPOINT = "/api/style-switch.mod";

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
		 * @param method - `GET` reads the current style, `POST` chooses one.
		 * @param payload - optional JSON body for `POST`.
		 * @returns the host snapshot.
		 */
		async function callHost(method, payload) {
			const target = new URL(ENDPOINT, hostBase());
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
			row: {
				display: "flex",
				alignItems: "center",
				gap: "8px",
				marginBottom: "8px",
				fontSize: "13px",
			},
			option: {
				display: "block",
				width: "100%",
				textAlign: "left",
				padding: "10px 12px",
				marginBottom: "8px",
				borderRadius: "10px",
				border: "1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.4))",
				background: "var(--dsw-alias-bg-secondary, rgba(127,127,127,.06))",
				cursor: "pointer",
				color: "inherit",
			},
			optionActive: {
				borderColor: "var(--dsw-alias-state-success-primary, #2f6b3a)",
				background: "var(--dsw-alias-bg-tertiary, rgba(127,127,127,.14))",
			},
			optionName: { fontWeight: 600, marginBottom: "2px" },
			optionSummary: { fontSize: "12.5px", opacity: 0.75, lineHeight: 1.4 },
			notice: { marginTop: "10px", fontSize: "12.5px", lineHeight: 1.5, whiteSpace: "pre-wrap" },
			noticeError: { color: "var(--dsw-alias-state-error-primary, #d33)" },
			noticeInfo: { color: "var(--dsw-alias-label-secondary, inherit)" },
			pre: {
				margin: "8px 0 0",
				maxHeight: "32vh",
				overflow: "auto",
				padding: "10px",
				borderRadius: "8px",
				background: "var(--dsw-alias-bg-secondary, rgba(127,127,127,.06))",
				fontSize: "12px",
				lineHeight: 1.45,
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
			},
			footer: { display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" },
			label: { fontSize: "13px", opacity: 0.85 },
		};

		/**
		 * The switch dialog: every offered style as a clickable card, the current
		 * one marked, plus the text the chosen style actually adds to the prompt.
		 * @param props - `open`/`onClose` from the header control.
		 * @returns the modal contribution.
		 */
		function StyleDialog({ open, onClose }) {
			const [snapshot, setSnapshot] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);
			const [showText, setShowText] = react.useState(false);

			react.useEffect(() => {
				if (!open) return;
				let alive = true;
				setBusy(true);
				setNotice(null);
				callHost("GET").then((state) => {
					if (alive) setSnapshot(state);
				}, (error) => {
					if (alive) setNotice({ kind: "error", text: messageOf(error) });
				}).finally(() => {
					if (alive) setBusy(false);
				});
				return () => {
					alive = false;
				};
			}, [open]);

			const choose = (id) => {
				setBusy(true);
				setNotice(null);
				callHost("POST", { style: id }).then((state) => {
					setSnapshot(state);
					setNotice({ kind: "info", text: `Стиль «${state.label}» выбран. Применится со следующего сообщения.` });
				}, (error) => {
					setNotice({ kind: "error", text: messageOf(error) });
				}).finally(() => {
					setBusy(false);
				});
			};

			const options = snapshot === null ? [] : snapshot.styles;
			const body = h(react.Fragment, null,
				h("div", { style: styles.row },
					h(primitives.Tag, { tone: snapshot?.contributes === true ? "solid" : "neutral" },
						snapshot?.contributes === true ? "добавляет к промпту" : "ничего не добавляет"),
					h("span", { style: styles.label }, snapshot === null
						? (busy ? "Загрузка…" : "")
						: `сейчас: ${String(snapshot.label)}`)),
				options.map((option) => h("button", {
					key: option.id,
					type: "button",
					style: option.id === snapshot?.style ? { ...styles.option, ...styles.optionActive } : styles.option,
					disabled: busy,
					onClick: () => {
						choose(option.id);
					},
				},
					h("div", { style: styles.optionName }, option.id === snapshot?.style
						? `${option.label} — выбран`
						: option.label),
					h("div", { style: styles.optionSummary }, option.summary))),
				h("div", { style: styles.row },
					h(primitives.Button, {
						variant: "outline",
						disabled: busy || snapshot === null || snapshot.text === "",
						onClick: () => {
							setShowText((value) => !value);
						},
					}, showText ? "Скрыть текст" : "Показать текст"),
					h("span", { style: styles.label }, snapshot === null || snapshot.text === ""
						? "у этого стиля нет своего текста"
						: `${String(snapshot.text.length)} символов в промпте`)),
				showText && snapshot !== null && snapshot.text !== ""
					&& h("pre", { style: styles.pre }, snapshot.text),
				notice !== null && h("div", {
					style: { ...styles.notice, ...(notice.kind === "error" ? styles.noticeError : styles.noticeInfo) },
				}, notice.text),
				snapshot !== null && h("div", { style: { ...styles.notice, ...styles.noticeInfo } },
					`Раздел промпта: ${String(snapshot.section)} (порядок ${String(snapshot.order)}) • файл: ${String(snapshot.path)}`));

			const footer = h("div", { style: styles.footer },
				h(primitives.Button, { variant: "ghost", disabled: busy, onClick: onClose }, "Закрыть"));

			return h(primitives.Modal, {
				open,
				onClose,
				title: "Стиль работы",
				description: "Как думать над следующим сообщением. Режим отвечает за длину, стиль — за способ.",
				closeLabel: "Закрыть",
				children: body,
				footer,
			});
		}

		/**
		 * Session Header control: the current style as a button, opening the switch.
		 * @param props - standard session-scoped slot props; none are required.
		 * @returns the header contribution.
		 */
		function StyleButton() {
			const [open, setOpen] = react.useState(false);
			const [label, setLabel] = react.useState(null);
			react.useEffect(() => {
				let alive = true;
				callHost("GET").then((state) => {
					if (alive) setLabel(state.label);
				}, () => {
					// A header control that cannot read its state must not remove itself
					// from the row: the harness version may simply be newer than this mod.
					if (alive) setLabel(null);
				});
				return () => {
					alive = false;
				};
			}, [open]);
			return h(react.Fragment, null,
				h(primitives.Button, {
					variant: "ghost",
					icon: h(primitives.IconPersonalizationOutline16, {}),
					title: "Стиль работы: как думать над сообщением",
					"aria-label": "Стиль работы",
					onClick: () => {
						setOpen(true);
					},
				}, label === null ? "Стиль" : `Стиль: ${label}`),
				h(StyleDialog, {
					open,
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
				id: "style-switch",
				inject: () => ({}),
			}, StyleButton));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
