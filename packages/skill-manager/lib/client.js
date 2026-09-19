/**
 * `@local/dsh-skill-manager` — browser half.
 *
 * Registers one tab in Settings → Plugins, one step after the mods tab. The tab
 * lists every skill this Harness resolves, grouped by the root it came from, with
 * the description DSH itself matches on, and a switch that pauses or resumes a
 * skill without a restart.
 *
 * The card is deliberately the same shape as a mod card and is built from the same
 * platform elements — `Tag`, `StateDot`, `Button` — so a paused skill reads red and
 * an available one reads green, exactly as a mod does. A panel that looked like a
 * different product would make the same state look like a different state.
 *
 * Expanded, a skill shows the two descriptions it can carry, because they are not
 * the same text and are not for the same reader:
 *
 *   * **the model-facing description**, which lives in the `SKILL.md` frontmatter
 *     because that is the string DSH matches a request against — so this is the only
 *     place an edit can matter;
 *   * **the human summary**, one line, kept in the registry, never shown to a model.
 *
 * Hand-written in the built-bundle format the client module system serves
 * (`window.__ModuleLoader__.load({ id, factory })`); only baseline platform modules
 * are required.
 */

window.__ModuleLoader__.load({
	id: "@local/dsh-skill-manager",
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
		const ENDPOINT = "/api/skill-manager.mod";
		/** Locale namespace owned by this plugin. */
		const NS = "skill-manager";

		const en = {
			tab: "Skills",
			title: "Skill availability",
			subtitle: "What this Harness resolves, and which of it is paused right now.",
			refresh: "Refresh",
			updatedAt: "Updated at",
			loading: "Loading…",
			empty: "No skills found in any root.",
			stateOn: "Available",
			stateOff: "Paused",
			stateBroken: "Not registered",
			pause: "Pause",
			resume: "Resume",
			scope: "Root",
			rank: "Rank",
			file: "File",
			size: "Size",
			problem: "Not registered because",
			shadow: "Shadowed by",
			shadowHint: "Another root wins resolution for this name, so this copy is not the one served.",
			modelDescription: "Description for the model",
			modelHint: "This is the text DSH matches a request against, and it is written straight into the skill's frontmatter. Nothing else in the file is touched.",
			humanSummary: "One line for a person",
			humanHint: "Kept in the registry beside this panel. No model ever reads it.",
			save: "Save",
			saved: "Saved.",
			registered: "registered",
			unregistered: "not registered yet",
			registry: "Registry",
			noteToggle: "Pausing renames the file DSH reads — SKILL.md becomes SKILL.md.paused. Nothing is deleted and nothing is edited, and the running session notices at once: the model stops being offered the skill on its next look at the list.",
			noteValidity: "A skill whose name is not kebab-case, is longer than 64 characters, or does not match its folder is silently not registered — which is why a skill can be sitting in a root and still not be offered.",
			noteScope: "Only the roots this Harness resolves are touched. Bundled skills are not listed and cannot be paused.",
			busy: "Working…",
			okPaused: "Paused.",
			okResumed: "Resumed.",
			errOutsideRoots: "That file is outside every skill root, so it was left alone.",
			errNotFound: "That file is no longer there.",
			errAlreadyPaused: "It is already paused.",
			errNotPaused: "It is not paused.",
			errTargetExists: "The name it would take is already in use.",
			errNotRegistered: "That skill is not in the registry.",
			errWriteFailed: "The change could not be written.",
			errReadFailed: "The skill roots could not be read.",
			errBadRequest: "The request was malformed.",
			errGeneric: "Something went wrong.",
		};

		const ru = {
			tab: "Скиллы",
			title: "Доступность скиллов",
			subtitle: "Что этот Harness видит и что из этого сейчас на паузе.",
			refresh: "Обновить",
			updatedAt: "Обновлено в",
			loading: "Загрузка…",
			empty: "Ни в одном корне скиллов не найдено.",
			stateOn: "Доступен",
			stateOff: "На паузе",
			stateBroken: "Не зарегистрирован",
			pause: "Поставить на паузу",
			resume: "Снять с паузы",
			scope: "Корень",
			rank: "Ранг",
			file: "Файл",
			size: "Размер",
			problem: "Не зарегистрирован, потому что",
			shadow: "Перекрыт",
			shadowHint: "Другой корень выигрывает разрешение этого имени, поэтому отдаётся не эта копия.",
			modelDescription: "Описание для модели",
			modelHint: "Именно по этому тексту DSH сопоставляет запрос, и он записывается прямо в шапку скилла. Больше в файле ничего не трогается.",
			humanSummary: "Кратко для человека",
			humanHint: "Хранится в реестре рядом с этой панелью. Модель его не читает никогда.",
			save: "Сохранить",
			saved: "Сохранено.",
			registered: "в реестре",
			unregistered: "ещё не в реестре",
			registry: "Реестр",
			noteToggle: "Пауза переименовывает файл, который читает DSH: SKILL.md становится SKILL.md.paused. Ничего не удаляется и не правится, а работающая сессия замечает это сразу — модель перестаёт получать этот скилл при следующем обращении к списку.",
			noteValidity: "Скилл, у которого name не в kebab-case, длиннее 64 символов или не совпадает с папкой, молча не регистрируется — поэтому скилл может лежать в корне и всё равно не предлагаться.",
			noteScope: "Затрагиваются только корни, которые разрешает этот Harness. Встроенные скиллы не показаны, и их нельзя поставить на паузу.",
			busy: "Работаю…",
			okPaused: "Поставлен на паузу.",
			okResumed: "Снят с паузы.",
			errOutsideRoots: "Этот файл вне всех корней скиллов, поэтому он не тронут.",
			errNotFound: "Этого файла больше нет.",
			errAlreadyPaused: "Он уже на паузе.",
			errNotPaused: "Он не на паузе.",
			errTargetExists: "Имя, которое он занял бы, уже занято.",
			errNotRegistered: "Этого скилла нет в реестре.",
			errWriteFailed: "Изменение не записалось.",
			errReadFailed: "Не удалось прочитать корни скиллов.",
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
		 * Translator. The slot's own `t` wins when the platform provides a working one;
		 * otherwise the built-in dictionary answers. The language is read on every
		 * lookup, not captured, so the tab label — which is asked for through
		 * `translator(null)` and has only the DOM to go on — still follows a change.
		 */
		function translator(platformT) {
			return (key) => {
				if (typeof platformT === "function") {
					try {
						const value = platformT(key);
						if (typeof value === "string" && value !== "" && value !== key) return value;
					} catch { /* fall through to the built-in dictionary */ }
				}
				const lang = locale();
				return DICTIONARIES[lang]?.[key] ?? DICTIONARIES.en[key] ?? key;
			};
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
			"outside-roots": "errOutsideRoots",
			"not-found": "errNotFound",
			"already-paused": "errAlreadyPaused",
			"not-paused": "errNotPaused",
			"target-exists": "errTargetExists",
			"not-registered": "errNotRegistered",
			"write-failed": "errWriteFailed",
			"read-failed": "errReadFailed",
			"bad-request": "errBadRequest",
		};

		/** The panel's only styling; the palette variables are the platform's. */
		const styles = {
			wrap: { display: "grid", gap: "14px", fontSize: "13px" },
			head: { display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "baseline", justifyContent: "space-between" },
			refreshBox: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
			stamp: { fontSize: "12px", opacity: 0.65, whiteSpace: "nowrap" },
			title: { margin: 0, fontSize: "15px", fontWeight: 600 },
			subtitle: { margin: "2px 0 0", opacity: 0.7, fontSize: "12.5px" },
			root: {
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
				fontSize: "12px",
				opacity: 0.75,
				wordBreak: "break-all",
			},
			layer: { display: "grid", gap: "6px" },
			layerName: { fontSize: "12.5px", fontWeight: 600, opacity: 0.85 },
			card: {
				borderRadius: "10px",
				border: "1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.28))",
				background: "var(--dsw-alias-bg-secondary, rgba(127,127,127,.05))",
				overflow: "hidden",
			},
			cardHeader: {
				display: "flex",
				alignItems: "center",
				gap: "10px",
				padding: "10px 12px",
				cursor: "pointer",
			},
			cardMain: { flex: "1 1 auto", minWidth: 0 },
			cardRight: { display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 },
			skillName: {
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
				fontSize: "12.5px",
				wordBreak: "break-all",
			},
			description: { fontSize: "12px", opacity: 0.72, marginTop: "3px", lineHeight: 1.45 },
			human: { fontSize: "12px", opacity: 0.9, marginTop: "3px", fontStyle: "italic" },
			dot: { display: "inline-flex", alignItems: "center" },
			chevron: { display: "inline-flex", opacity: 0.55, transition: "transform .15s ease" },
			details: {
				display: "grid",
				gridTemplateColumns: "auto minmax(0, 1fr)",
				gap: "4px 14px",
				margin: 0,
				padding: "0 12px 12px",
				fontSize: "12.5px",
			},
			detailsLabel: { opacity: 0.6 },
			fieldset: { gridColumn: "1 / -1", display: "grid", gap: "6px", marginTop: "6px" },
			fieldLabel: { fontSize: "12px", fontWeight: 600, opacity: 0.85 },
			fieldHint: { fontSize: "11.5px", opacity: 0.6, lineHeight: 1.4 },
			input: {
				width: "100%",
				boxSizing: "border-box",
				fontFamily: "inherit",
				fontSize: "12.5px",
				lineHeight: 1.5,
				padding: "7px 9px",
				borderRadius: "8px",
				color: "inherit",
				border: "1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.28))",
				background: "var(--dsw-alias-bg-primary, rgba(127,127,127,.06))",
				resize: "vertical",
			},
			badges: { display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center", marginTop: "4px" },
			badge: { fontSize: "11px", opacity: 0.85 },
			actions: { display: "flex", gap: "6px", flexWrap: "nowrap", alignItems: "center" },
			notice: { fontSize: "12.5px", lineHeight: 1.5 },
			noticeError: { color: "var(--dsw-alias-state-error-primary, #d33)" },
			noticeInfo: { opacity: 0.75 },
			notes: { display: "grid", gap: "5px", fontSize: "12px", opacity: 0.7, lineHeight: 1.5 },
			section: { display: "grid", gap: "6px" },
		};

		/** Bytes, phrased the way a person reads them. */
		function sizeOf(bytes) {
			if (typeof bytes !== "number" || bytes <= 0) return "—";
			if (bytes < 1024) return `${String(bytes)} B`;
			if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
			return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		}

		/** The tab body. */
		function SkillManagerTab(props) {
			const t = react.useMemo(() => translator(props?.t), [props?.t]);
			const [state, setState] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);
			const [refreshedAt, setRefreshedAt] = react.useState(null);
			const [expanded, setExpanded] = react.useState(null);
			const [draft, setDraft] = react.useState({ model: "", human: "" });

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
						setNotice(null);
					} catch (error) {
						setNotice({ kind: "error", text: `${t("errReadFailed")} ${String(error?.message ?? error)}` });
					}
				})();
			}, [t]);

			react.useEffect(() => { load(); }, [load]);

			// The roots can change from outside this window — a skill added by a tool, a
			// folder renamed in a terminal — so re-read on focus rather than making the
			// reader hunt for the button.
			react.useEffect(() => {
				const onFocus = () => { load(); };
				globalThis.addEventListener?.("focus", onFocus);
				return () => { globalThis.removeEventListener?.("focus", onFocus); };
			}, [load]);

			const run = (payload, okKey) => {
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
							setNotice({ kind: "info", text: t(okKey) });
						}
					} catch (error) {
						setNotice({ kind: "error", text: `${t("errWriteFailed")} ${String(error?.message ?? error)}` });
					} finally {
						setBusy(false);
					}
				})();
			};

			const openCard = (skill) => {
				const isOpen = expanded === skill.file;
				setExpanded(isOpen ? null : skill.file);
				setDraft({ model: skill.description, human: skill.humanSummary });
			};

			const head = h("div", { style: styles.head, key: "head" },
				h("div", { key: "titles" },
					h("h3", { style: styles.title }, t("title")),
					h("p", { style: styles.subtitle }, t("subtitle"))),
				h("div", { style: styles.refreshBox, key: "refresh" },
					refreshedAt !== null ? h("span", { style: styles.stamp }, `${t("updatedAt")} ${refreshedAt}`) : null,
					h(primitives.Button, { variant: "outline", disabled: busy, onClick: () => { load(); } }, t("refresh"))));

			/**
			 * One skill. The plate is the switch, the chevron holds everything that is
			 * not a decision — the same split the mods tab uses, so that the pointer of
			 * somebody scanning the list never lands on something irreversible.
			 */
			const cardOf = (skill) => {
				const key = skill.file;
				const isOpen = expanded === key;
				const broken = skill.problem !== null && skill.problem !== undefined;
				const tone = broken ? "warning" : (skill.paused ? "danger" : "success");
				const label = broken ? t("stateBroken") : (skill.paused ? t("stateOff") : t("stateOn"));
				const dotState = broken ? "error" : (skill.paused ? "idle" : "done");

				const act = (payload, okKey) => (event) => {
					if (typeof event?.stopPropagation === "function") event.stopPropagation();
					run(payload, okKey);
				};

				const tag = h(primitives.Tag, { tone, key: "tag" }, label);

				const pair = (labelText, value, id) => [
					h("dt", { style: styles.detailsLabel, key: `${id}-l` }, labelText),
					h("dd", { style: { margin: 0, wordBreak: "break-all" }, key: `${id}-v` }, value),
				];
				const rows = [
					pair(t("scope"), `${skill.sourceLabel} · ${String(skill.rank)}`, "s"),
					pair(t("file"), skill.file, "f"),
					pair(t("size"), sizeOf(skill.bytes), "z"),
				];
				if (broken) rows.push(pair(t("problem"), skill.problem, "p"));
				if (skill.shadowedBy) {
					rows.push(pair(t("shadow"), skill.shadowedBy, "sh"));
					rows.push(h("dd", { style: { ...styles.noticeInfo, gridColumn: "1 / -1", margin: 0 }, key: "shh" }, t("shadowHint")));
				}

				// The registration form. Two descriptions, because they have two readers
				// and only one of them is a model.
				rows.push(h("div", { style: styles.fieldset, key: "form" },
					h("label", { style: styles.fieldLabel, key: "ml", htmlFor: `${key}-model` }, t("modelDescription")),
					h("textarea", {
						key: "mi",
						id: `${key}-model`,
						style: { ...styles.input, minHeight: "84px" },
						value: draft.model,
						disabled: busy,
						onClick: (event) => { event.stopPropagation(); },
						onChange: (event) => { setDraft({ ...draft, model: event.target.value }); },
					}),
					h("div", { style: styles.fieldHint, key: "mh" }, t("modelHint")),
					h("label", { style: styles.fieldLabel, key: "hl", htmlFor: `${key}-human` }, t("humanSummary")),
					h("input", {
						key: "hi",
						id: `${key}-human`,
						style: styles.input,
						value: draft.human,
						disabled: busy,
						onClick: (event) => { event.stopPropagation(); },
						onChange: (event) => { setDraft({ ...draft, human: event.target.value }); },
					}),
					h("div", { style: styles.fieldHint, key: "hh" }, t("humanHint")),
					h("div", { style: styles.actions, key: "fa" },
						h(primitives.Button, {
							variant: "outline",
							disabled: busy || broken,
							onClick: act({ action: "describe", file: skill.file, modelDescription: draft.model, humanSummary: draft.human, workspace: skill.sourceLabel }, "saved"),
						}, t("save")),
						h("span", { style: styles.badge, key: "rs" },
							skill.registered ? t("registered") : t("unregistered")))));

				rows.push(
					h("dt", { style: styles.detailsLabel, key: "a-l" }, t("stateOn")),
					h("dd", { style: { margin: 0 }, key: "a-v" }, h("div", { style: styles.actions },
						skill.paused
							? h(primitives.Button, {
								variant: "outline",
								disabled: busy,
								key: "resume",
								onClick: act({ action: "resume", file: skill.file }, "okResumed"),
							}, t("resume"))
							: h(primitives.Button, {
								variant: "outline",
								disabled: busy,
								key: "pause",
								onClick: act({ action: "pause", file: skill.file }, "okPaused"),
							}, t("pause")))));

				return h("div", { style: styles.card, key },
					h("div", {
						style: styles.cardHeader,
						role: "button",
						"aria-expanded": isOpen,
						onClick: () => { openCard(skill); },
					},
						h("div", { style: styles.cardMain },
							h("div", { style: styles.skillName }, skill.name),
							skill.humanSummary !== ""
								? h("div", { style: styles.human }, skill.humanSummary)
								: null,
							skill.description !== "" ? h("div", { style: styles.description }, skill.description) : null),
						h("div", { style: styles.cardRight },
							h("span", { style: styles.dot, key: "dot" }, h(primitives.StateDot, { state: dotState })),
							!broken
								? h("span", {
									key: "toggle",
									role: "button",
									title: skill.paused ? t("resume") : t("pause"),
									style: { display: "inline-flex", cursor: busy ? "default" : "pointer" },
									onClick: skill.paused
										? act({ action: "resume", file: skill.file }, "okResumed")
										: act({ action: "pause", file: skill.file }, "okPaused"),
								}, tag)
								: tag,
							h("span", {
								key: "chevron",
								style: { ...styles.chevron, transform: isOpen ? "rotate(180deg)" : "none" },
							}, h(primitives.IconChevronDownOutline14, {})))),
					isOpen ? h("dl", { style: styles.details }, ...rows) : null);
			};

			const body = [];
			if (state === null) {
				body.push(h("div", { style: styles.noticeInfo, key: "loading" }, t("loading")));
			} else if (state.total === 0) {
				body.push(h("div", { style: styles.noticeInfo, key: "empty" }, t("empty")));
			} else {
				const byGroup = new Map();
				for (const skill of state.skills) {
					const list = byGroup.get(skill.source) ?? [];
					list.push(skill);
					byGroup.set(skill.source, list);
				}
				for (const root of state.roots) {
					const group = byGroup.get(root.source);
					if (group === undefined) continue;
					body.push(h("div", { style: styles.layer, key: `root-${root.source}` },
						h("div", { style: styles.layerName },
							`${root.label} · ${t("rank")} ${String(root.rank)} · ${String(group.length)}`),
						h("div", { style: styles.root }, root.path),
						...group.map((skill) => cardOf(skill))));
				}
			}

			if (notice !== null) {
				body.push(h("div", {
					style: notice.kind === "error" ? { ...styles.notice, ...styles.noticeError } : { ...styles.notice, ...styles.noticeInfo },
					key: "notice",
				}, notice.text));
			}

			if (state !== null) {
				body.unshift(h("div", { style: styles.badges, key: "counts" },
					h(primitives.Tag, { tone: "success", key: "on" }, `${t("stateOn")}: ${String(state.total - state.paused)}`),
					h(primitives.Tag, { tone: "danger", key: "off" }, `${t("stateOff")}: ${String(state.paused)}`),
					h(primitives.Tag, { tone: "neutral", key: "reg" }, `${t("registry")}: ${String(state.registered)}`),
					state.workspaces.length > 0
						? h("span", { style: styles.badge, key: "ws" },
							state.workspaces.map((space) => space.title).join(", "))
						: null));
			}

			body.push(h("div", { style: styles.notes, key: "notes" },
				h("div", { key: "n1" }, t("noteToggle")),
				h("div", { key: "n2" }, t("noteValidity")),
				h("div", { key: "n3" }, t("noteScope"))));

			return h("div", { style: styles.wrap }, head, ...body);
		}

		/** Required client services: the slot registry and the locale registry. */
		const inject = ["slots", "locale"];

		/**
		 * Register the settings tab.
		 * @param ctx - browser context carrying `slots` and `locale`.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { en, ru }), "skill-manager: dictionaries");
			ctx.slots.inject(SLOT_NAME, () => ctx.slots.register({
				name: SLOT_NAME,
				id: "skills",
				order: 30,
				label: () => translator(null)("tab"),
				locale: NS,
			}, SkillManagerTab));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
