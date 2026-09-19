/**
 * `@local/dsh-skill-scout` — browser half.
 *
 * One tab in Settings → Plugins, after Skills. Three things on it:
 *
 *   a task field   anyone — a person or an agent — says what to go and look for
 *   the queue      what was asked, what has been taken, what came back
 *   the catalogue  what was found and what was decided, with two axes and the Add button
 *
 * The tab does not search. It cannot: searching needs a token and the network, and
 * both belong to the agent that already holds them. Pressing the button writes a
 * task; an agent takes it, runs the scout, puts the survivors on trial, and writes the
 * catalogue. The panel is a board that both sides can see and write to.
 *
 * The Add button is the only place adoption happens, and it is a person's. A pipeline
 * that adopts its own findings is a pipeline that can install something nobody chose.
 */

window.__ModuleLoader__.load({
	id: "@local/dsh-skill-scout",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = react.createElement;

		const SLOT_NAME = "settings.plugins.tab";
		const ENDPOINT = "/api/skill-scout.mod";
		const NS = "skill-scout";

		const en = {
			tab: "Collection",
			title: "Collection of found skills",
			subtitle: "Skills already found and judged. Each carries what the hearing decided, its rating, and the date it entered. The scout reads this before it searches, so nothing is hunted for twice.",
			ask: "What to look for",
			askHint: "A description, not keywords — the scout turns it into words and their synonyms itself. \"A skill that drives a Windows program with no API\" is better than \"windows automation\".",
			askPlaceholder: "e.g. a skill for evaluating other skills before adopting them",
			search: "Send the scout",
			searching: "Queued.",
			queue: "The queue",
			queueEmpty: "Nothing asked for yet.",
			status: "pending",
			status_taken: "taken",
			status_done: "done",
			askedBy: "asked by",
			found: "found",
			triaged: "triaged",
			judged: "judged",
			addedCount: "added",
			take: "Take",
			dismiss: "Dismiss",
			catalogue: "The catalogue",
			catalogueEmpty: "Nothing judged yet. The queue is where that starts.",
			keep: "Worth keeping",
			runsHere: "Runs here",
			hearing: "Hearing",
			rating: "Rating",
			against: "vs",
			cases: "hearing(s) behind it",
			uncalibrated: "not calibrated — too few hearings to read as a scale",
			takenFrom: "Taken from it",
			open: "Open the source",
			discuss: "Discuss with the agent",
			copyLabel: "Paste this into the chat",
			discussed: "Discussed — ask again",
			discussHint: "The skill has gone into the chat. Decide it there: say install it or leave it, and the agent records that. Nothing is adopted by a click.",
			discussLead: "Let us discuss the skill",
			discussAsk: "Tell me what is worth taking from it and what it would give our family of skills, then say what you propose — install, port, or drop. I will answer install it or leave it.",
			added: "Added",
			forget: "Remove from the list",
			addedOn: "Added",
			home: "Lives in",
			noHome: "nowhere yet — not usable until it has a home",
			partState: "state",
			fires: "fires when",
			partsLine: "parts taken",
			placed: "placed",
			trialled: "trialled",
			noteKeep: "Worth keeping is the verdict of the hearing. Runs here is a separate question — a good skill for a mechanism this Harness does not have is good and unusable, and one score would hide that.",
			noteCollector: "This is a store, not a search. The scout reads it first and only then goes to GitHub, so a skill found once is never hunted for again.",
			noteQueue: "The tab is a board, not a worker. It writes the task; an agent runs the search, because searching needs a token and the network and neither belongs behind a button in a browser.",
			noteAdd: "Adding is a person's decision and the only way anything is adopted.",
			refresh: "Refresh",
			updatedAt: "Updated at",
			loading: "Loading…",
			busy: "Working…",
			errEmptyTask: "Write what to look for first.",
			errNoSuchTask: "That task is gone.",
			errNotPending: "That task was already taken.",
			errNoSuchEntry: "That entry is gone.",
			errWriteFailed: "The change could not be written.",
			errReadFailed: "The board could not be read.",
			errBadRequest: "The request was malformed.",
			errGeneric: "Something went wrong.",
		};

		const ru = {
			tab: "Коллекция",
			title: "Коллекция найденных скиллов",
			subtitle: "Уже найденные и отсуженные скиллы. У каждого — вердикт суда, рейтинг и дата попадания. Скаут читает это ДО поиска, поэтому дважды ничего не ищется.",
			ask: "Что искать",
			askHint: "Опиши задачу, а не ключевые слова — разведчик сам превратит её в слова и синонимы. «Скилл, который управляет программой Windows без API» лучше, чем «windows automation».",
			askPlaceholder: "например: скилл для оценки других скиллов перед тем, как их брать",
			search: "Отправить разведчика",
			searching: "В очереди.",
			queue: "Очередь",
			queueEmpty: "Пока ничего не просили.",
			status: "ждёт",
			status_taken: "взято",
			status_done: "готово",
			askedBy: "спросил",
			found: "найдено",
			triaged: "отсеяно",
			judged: "судимо",
			addedCount: "добавлено",
			take: "Взять",
			dismiss: "Убрать",
			catalogue: "Каталог",
			catalogueEmpty: "Пока никого не судили. Начинается это в очереди.",
			keep: "Стоит держать",
			runsHere: "Работает здесь",
			hearing: "Суд",
			rating: "Рейтинг",
			against: "против",
			cases: "дел за ним",
			uncalibrated: "не калибровано — дел слишком мало, чтобы читать как шкалу",
			takenFrom: "Взято из него",
			open: "Открыть источник",
			discuss: "Обсудить с агентом",
			copyLabel: "Скопируй это в чат",
			discussed: "Обсуждали — ещё раз",
			discussHint: "Скилл ушёл в чат. Решайте там: скажи «ставь» или «откажись», и агент это запишет. Нажатием ничего не принимается.",
			discussLead: "Обсудим скилл",
			discussAsk: "Расскажи, что из него стоит взять и что это даст нашей семье скиллов, и что предлагаешь — поставить, перенести или отказаться. Я отвечу «ставь» или «откажись».",
			added: "Добавлено",
			forget: "Удалить из списка",
			addedOn: "Добавлено",
			home: "Живёт в",
			noHome: "пока нигде — не применимо, пока нет дома",
			partState: "состояние",
			fires: "срабатывает когда",
			partsLine: "частей взято",
			placed: "размещено",
			trialled: "испытано",
			noteKeep: "«Стоит держать» — вердикт суда. «Работает здесь» — отдельный вопрос: хороший скилл для механизма, которого в этом Harness нет, хорош и неприменим, и одна оценка это скрыла бы.",
			noteCollector: "Это запасник, а не поиск. Скаут читает его первым и только потом идёт на GitHub, поэтому найденное однажды больше не ищется.",
			noteQueue: "Вкладка — доска, а не работник. Она пишет задание; поиск выполняет агент, потому что для поиска нужен токен и сеть, и ни то ни другое не должно стоять за кнопкой в браузере.",
			noteAdd: "Ничего не принимается нажатием и единственный способ что-либо принять.",
			refresh: "Обновить",
			updatedAt: "Обновлено в",
			loading: "Загрузка…",
			busy: "Работаю…",
			errEmptyTask: "Сначала напиши, что искать.",
			errNoSuchTask: "Этого задания больше нет.",
			errNotPending: "Это задание уже взято.",
			errNoSuchEntry: "Этой записи больше нет.",
			errWriteFailed: "Изменение не записалось.",
			errReadFailed: "Не удалось прочитать доску.",
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
				// it does not own — asking it first made the whole panel English on a
				// Russian interface, while the tab label, which asks with no translator
				// at all, was correctly Russian. That asymmetry was the tell.
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

		/**
		 * The sentence to paste into the chat. It carries the whole decision, because
		 * the agent has not seen this panel: what was found, what the hearing decided,
		 * and what is being asked of it.
		 */
		function discussPrompt(entry, t) {
			const lines = [
				`${t("discussLead")} «${entry.name}» — ${entry.repo}`,
				"",
				`${t("keep")}: ${entry.keep} · ${t("runsHere")}: ${entry.runsHere}`,
			];
			if (entry.hearing?.verdict) lines.push(`${t("hearing")}: ${entry.hearing.verdict}`);
			if (typeof entry.hearing?.prosecutor === "number") {
				lines.push(`${t("rating")}: ${String(entry.hearing.prosecutor)}/10 `
					+ `${t("against")} ${String(entry.hearing.defence)}/10`);
			}
			if (entry.taken?.length) lines.push(`${t("taken")}: ${entry.taken.join("; ")}`);
			lines.push("", `${t("open")}: ${entry.url}`, "", t("discussAsk"));
			return lines.join("\n");
		}

		const ERROR_KEYS = {
			"empty-task": "errEmptyTask",
			"no-such-task": "errNoSuchTask",
			"not-pending": "errNotPending",
			"no-such-entry": "errNoSuchEntry",
			"write-failed": "errWriteFailed",
			"read-failed": "errReadFailed",
			"bad-request": "errBadRequest",
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
			input: {
				width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: "12.5px",
				lineHeight: 1.5, padding: "7px 9px", borderRadius: "8px", color: "inherit",
				border: "1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.28))",
				background: "var(--dsw-alias-bg-primary, rgba(127,127,127,.06))",
				resize: "vertical",
			},
			hint: { fontSize: "11.5px", opacity: 0.6, lineHeight: 1.45 },
			row: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
			card: {
				borderRadius: "10px",
				border: "1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.28))",
				background: "var(--dsw-alias-bg-secondary, rgba(127,127,127,.05))",
				overflow: "hidden",
			},
			cardHeader: { display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", cursor: "pointer" },
			cardMain: { flex: "1 1 auto", minWidth: 0 },
			cardRight: { display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 },
			name: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "14px", opacity: 0.8, wordBreak: "break-all" },
			summary: { fontSize: "13px", lineHeight: 1.45, marginTop: "4px", opacity: 0.9 },
			meta: { fontSize: "11.5px", opacity: 0.6, marginTop: "4px", wordBreak: "break-all" },
			details: {
				display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "4px 14px",
				margin: 0, padding: "0 12px 12px", fontSize: "12.5px",
			},
			detailsLabel: { opacity: 0.6 },
			tagRow: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" },
			chevron: { display: "inline-flex", opacity: 0.55, transition: "transform .15s ease" },
			notice: { fontSize: "12.5px", lineHeight: 1.5 },
			noticeError: { color: "var(--dsw-alias-state-error-primary, #d33)" },
			noticeInfo: { opacity: 0.75 },
			notes: { display: "grid", gap: "5px", fontSize: "12px", opacity: 0.7, lineHeight: 1.5 },
			empty: { opacity: 0.6, fontSize: "12.5px" },
			link: { color: "inherit", textDecoration: "underline", opacity: 0.85 },
		};

		const STATUS_TONE = { pending: "warning", taken: "neutral", done: "success" };
		const KEEP_TONE = { yes: "success", "with a boundary": "warning", no: "danger" };
		const RUNS_TONE = { yes: "success", "after porting": "warning", no: "danger" };

		function ScoutTab(props) {
			const t = react.useMemo(() => translator(props?.t), [props?.t]);
			const [state, setState] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);
			const [text, setText] = react.useState("");
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

			const submit = () => {
				if (text.trim() === "") {
					setNotice({ kind: "error", text: t("errEmptyTask") });
					return;
				}
				run({ action: "ask", text, by: "human" }, t("searching"));
				setText("");
			};

			const head = h("div", { style: styles.head, key: "head" },
				h("div", { key: "titles" },
					h("h3", { style: styles.title }, t("title")),
					h("p", { style: styles.subtitle }, t("subtitle"))),
				h("div", { style: styles.refreshBox, key: "refresh" },
					refreshedAt !== null ? h("span", { style: styles.stamp }, `${t("updatedAt")} ${refreshedAt}`) : null,
					h(primitives.Button, { variant: "outline", disabled: busy, onClick: () => { load(); } }, t("refresh"))));

			// The tab holds no task field and no queue on purpose. Asking for a search is
			// a sentence to the scout, and the scout is a skill — the board that used to
			// live here was a second way to do the same thing, with its own state to go
			// stale. What is left is the collection itself.
			const body = [];

			// ── the catalogue ─────────────────────────────────────────────────
			const catalogueSection = [h("div", { style: styles.sectionName, key: "n" },
				`${t("catalogue")}${state === null ? "" : ` · ${String(state.entries.length)}`}`
				+ (state === null || state.takenTotal === undefined ? ""
					: ` · ${t("partsLine")} ${String(state.takenTotal)}, `
						+ `${t("placed")} ${String(state.takenPlaced)}, `
						+ `${t("trialled")} ${String(state.takenTrialled)}`))];
			if (state !== null && state.entries.length === 0) {
				catalogueSection.push(h("div", { style: styles.empty, key: "e" }, t("catalogueEmpty")));
			}
			for (const entry of state?.entries ?? []) {
				const isOpen = expanded === entry.id;
				const pair = (label, value, id) => [
					h("dt", { style: styles.detailsLabel, key: `${id}-l` }, label),
					h("dd", { style: { margin: 0, wordBreak: "break-all" }, key: `${id}-v` }, value),
				];
				const rows = [
					pair(t("keep"), entry.keep, "k"),
					pair(t("runsHere"), entry.runsHere, "r"),
				];
				if (entry.hearing?.verdict) {
					rows.push(pair(t("hearing"), entry.hearing.verdict, "h"));
				}
				if (typeof entry.hearing?.prosecutor === "number") {
					rows.push(pair(t("rating"),
						`${String(entry.hearing.prosecutor)}/10 ${t("against") ?? "vs"} `
						+ `${String(entry.hearing.defence)}/10`
						+ (typeof entry.hearing.cases === "number" ? ` · ${String(entry.hearing.cases)} ${t("cases")}` : ""),
						"rt"));
				}
				if (entry.taken?.length) {
					// Each part with its home and its trigger, because a part without them is a
					// wish. The state is shown so that "recorded" is visibly not "done".
					const parts = entry.taken.map((one, index) => {
						const part = typeof one === "string"
							? { part: one, home: "", trigger: "", state: "recorded" }
							: one;
						const where = part.home === ""
							? t("noHome")
							: `${t("home")}: ${part.home}`;
						return h("div", { key: `part-${String(index)}`, style: { marginBottom: "5px" } },
							h("div", {}, `${String(index + 1)}. ${part.part}`),
							h("div", { style: { opacity: 0.6, fontSize: "11.5px" } },
								`${where} · ${t("partState")}: ${part.state}`
								+ (part.trigger ? ` · ${t("fires")}: ${part.trigger}` : "")));
					});
					rows.push(pair(t("takenFrom"), h("div", {}, ...parts), "tk"));
				}
				if (entry.note) rows.push(pair("", entry.note, "nt"));
				rows.push(
					h("dt", { style: styles.detailsLabel, key: "a-l" }, t("copyLabel")),
					h("dd", { style: { margin: 0 }, key: "a-v" }, h("div", { style: styles.row },
						h("textarea", {
							readOnly: true,
							value: discussPrompt(entry, t),
							style: { ...styles.input, minHeight: "76px", fontSize: "11.5px", opacity: 0.9 },
							// One click takes the whole sentence; there is nothing here to edit.
							onClick: (event) => { event.stopPropagation(); event.target.select(); },
						}),
						h("a", {
							href: entry.url, target: "_blank", rel: "noreferrer",
							style: styles.link, key: "open",
							onClick: (event) => { event.stopPropagation(); },
						}, t("open")),
						h(primitives.Button, {
							variant: "ghost", disabled: busy, key: "forget",
							onClick: (event) => {
								event.stopPropagation();
								run({ action: "forget", id: entry.id });
							},
						}, t("forget")))));

				catalogueSection.push(h("div", { style: styles.card, key: entry.id },
					h("div", {
						style: styles.cardHeader,
						role: "button",
						"aria-expanded": isOpen,
						onClick: () => { setExpanded(isOpen ? null : entry.id); },
					},
						h("div", { style: styles.cardMain },
							h("div", { style: styles.name }, entry.name),
							entry.description ? h("div", { style: styles.summary }, entry.description) : null,
							h("div", { style: styles.meta },
								`${entry.repo}${entry.path ? ` · ${entry.path}` : ""}`
								+ (typeof entry.stars === "number" ? ` · ${entry.stars.toLocaleString()}★` : "")
								+ (entry.checkedAt ? ` · ${entry.checkedAt.slice(0, 10)}` : ""))),
						h("div", { style: styles.cardRight },
							h("span", { style: styles.tagRow },
								h(primitives.Tag, { tone: KEEP_TONE[entry.keep] ?? "neutral", key: "k" }, entry.keep),
								h(primitives.Tag, { tone: RUNS_TONE[entry.runsHere] ?? "neutral", key: "r" }, entry.runsHere)),
							entry.adopted === true ? h(primitives.Tag, { tone: "success" }, t("added")) : null,
							h("span", {
								key: "chevron",
								style: { ...styles.chevron, transform: isOpen ? "rotate(180deg)" : "none" },
							}, h(primitives.IconChevronDownOutline14, {})))),
					isOpen ? h("dl", { style: styles.details }, ...rows) : null));
			}
			body.push(h("div", { style: styles.section, key: "catalogue" }, ...catalogueSection));

			if (notice !== null) {
				body.push(h("div", {
					style: notice.kind === "error"
						? { ...styles.notice, ...styles.noticeError }
						: { ...styles.notice, ...styles.noticeInfo },
					key: "notice",
				}, notice.text));
			}

			body.push(h("div", { style: styles.notes, key: "notes" },
				h("div", { key: "n0" }, t("noteCollector")),
				h("div", { key: "n2" }, t("noteKeep")),
				h("div", { key: "n3" }, t("noteAdd"))));

			return h("div", { style: styles.wrap }, head, ...body);
		}

		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { en, ru }), "skill-scout: dictionaries");
			ctx.slots.inject(SLOT_NAME, () => ctx.slots.register({
				name: SLOT_NAME,
				id: "skill-scout",
				order: 31,
				label: () => translator(null)("tab"),
				locale: NS,
			}, ScoutTab));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
