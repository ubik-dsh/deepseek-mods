/**
 * `@local/dsh-voice-stream` — browser half.
 *
 * Одна кнопка в строке служебных кнопок шапки сеанса: она показывает, читается ли
 * ответ вслух, и переключает это одним нажатием. Оператор просил именно кнопку:
 * бывает, что хочется читать глазами и звук мешает.
 *
 * Кнопка ничего не решает сама: она читает и пишет тот же файл-переключатель
 * (`ГОЛОС.txt` рядом с настроенным `say_stream.py`, то есть в папке `runtime` установленного
 * пакета), который читает голосовой процесс, поэтому состояние в панели,
 * в лампе и у голоса всегда одно.
 *
 * Написано в том формате, который отдаёт браузерный загрузчик модулей
 * (`window.__ModuleLoader__.load({ id, factory })`), шага сборки здесь нет. Из внешнего
 * берётся только `react`: это один из девяти базовых модулей.
 */

window.__ModuleLoader__.load({
	id: "@local/dsh-voice-stream",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");

		/** Строка служебных кнопок в шапке сеанса — та же, где живут прочие действия. */
		const SLOT_NAME = "conversation.session.header.utilities";
		/** Маршрут, который поднимает хостовая половина этого же пакета. */
		const ENDPOINT = "/api/voice-stream.mod";

		/** Адрес харнесса, с запасным вариантом для пустого origin. */
		function hostBase() {
			const origin = globalThis.location?.origin;
			return origin !== undefined && origin !== "null" ? origin : "http://dsh.internal";
		}

		/** Человекочитаемое сообщение неизвестной ошибки. */
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}

		/**
		 * Позвать хостовую половину.
		 * @param method - `GET` читает состояние, `POST` переключает.
		 * @param payload - `{ on: boolean }` для `POST`.
		 * @returns снимок состояния.
		 */
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
			if (body === null) throw new Error(`HTTP ${response.status}`);
			if (body.ok === false) throw new Error(body.error ?? `HTTP ${response.status}`);
			return body;
		}

		const styles = {
			button: {
				display: "inline-flex",
				alignItems: "center",
				gap: "6px",
				height: "28px",
				padding: "0 10px",
				borderRadius: "999px",
				border: "1px solid currentColor",
				background: "transparent",
				color: "inherit",
				font: "inherit",
				fontSize: "12px",
				lineHeight: 1,
				cursor: "pointer",
				opacity: 0.9,
			},
			off: { opacity: 0.55, textDecoration: "line-through" },
			dot: { width: "8px", height: "8px", borderRadius: "50%", background: "currentColor" },
			error: { fontSize: "11px", opacity: 0.8 },
		};

		/**
		 * Две кнопки: включить или выключить голос, и прочитать последний ответ заново.
		 *
		 * Вторая нужна потому, что ответ можно пропустить: оператор отошёл, вернулся, а читать
		 * уже нечего. Хост держит текст последнего ответа, поэтому повтор идёт тем же путём,
		 * каким ответ читался вживую.
		 *
		 * @returns кнопки для строки служебных действий.
		 */
		function VoiceButton() {
			const [state, setState] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(null);
			const [notice, setNotice] = react.useState(null);

			react.useEffect(() => {
				let alive = true;
				callHost("GET").then(
					(snapshot) => {
						if (alive) setState(snapshot);
					},
					(failure) => {
						if (alive) setError(messageOf(failure));
					},
				);
				return () => {
					alive = false;
				};
			}, []);

			const toggle = () => {
				if (state === null || busy) return;
				setBusy(true);
				setError(null);
				callHost("POST", { on: !state.on }).then(
					(snapshot) => setState(snapshot),
					(failure) => setError(messageOf(failure)),
				).finally(() => setBusy(false));
			};

			/** Прочитать последний ответ заново. */
			const repeat = () => {
				if (state === null || busy) return;
				setBusy(true);
				setError(null);
				setNotice(null);
				callHost("POST", { repeat: true }).then(
					(snapshot) => {
						setState(snapshot);
						setNotice(snapshot.chars === undefined
							? "читаю заново"
							: `читаю заново: ${Math.round(snapshot.chars / 16)} с речи`);
					},
					(failure) => setError(messageOf(failure)),
				).finally(() => setBusy(false));
			};

			const on = state === null ? null : state.on === true;
			const canRepeat = state !== null && state.hasLast === true;
			/**
			 * ХОСТ СТАРОЙ СБОРКИ. Страница подтягивает новую браузерную половину сразу, а хост
			 * живёт в запущенном процессе и обновляется только перезапуском. Тогда кнопка
			 * видна, но повторять ей нечем: в ответе хоста нет поля `hasLast`. Оператор это уже
			 * видел («вижу кнопку, но она не активна»), поэтому мёртвая кнопка теперь говорит
			 * причину словами, а не молчит.
			 */
			const staleHost = state !== null && state.hasLast === undefined;
			/**
			 * ГОЛОС МОЖЕТ БЫТЬ НЕДОСТУПЕН, И ОБ ЭТОМ НАДО СКАЗАТЬ. Хост шлёт причину в поле
			 * `voiceError`: не найден питон, не поднялся процесс. Раньше в этом случае кнопка
			 * выглядела рабочей, человек включал голос и не слышал ничего без объяснений.
			 */
			const voiceError = typeof state?.voiceError === "string" && state.voiceError !== "" ? state.voiceError : null;
			const label = voiceError !== null
				? "Голос: недоступен"
				: on === null ? "Голос…" : on ? "Голос: вкл" : "Голос: выкл";
			const title = voiceError !== null
				? `Голос не работает: ${voiceError}`
				: on === null
					? "Состояние голоса не прочитано"
					: on
						? "Ответы читаются вслух. Нажми, чтобы выключить звук."
						: "Ответы читаются только глазами. Нажми, чтобы включить звук.";
			const repeatTitle = staleHost
				? "Хост в памяти старой сборки: перезапусти dsh web, иначе повторять нечем"
				: canRepeat
					? `Прочитать последний ответ заново (${state.lastChars} знаков)`
					: "Повторять нечего: в этой сессии ответа ещё не было";

			return react.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: "6px" } },
				react.createElement("button", {
					type: "button",
					onClick: toggle,
					disabled: busy || state === null,
					title,
					"aria-pressed": on === true,
					"aria-label": title,
					style: on === false ? { ...styles.button, ...styles.off } : styles.button,
				}, react.createElement("span", { style: styles.dot }), label),
				react.createElement("button", {
					type: "button",
					onClick: repeat,
					disabled: busy || !canRepeat,
					title: repeatTitle,
					"aria-label": repeatTitle,
					style: canRepeat ? styles.button : { ...styles.button, ...styles.off },
				}, "Повторить"),
				staleHost
					? react.createElement("span", { style: styles.error, title: repeatTitle }, "нужен перезапуск dsh web")
					: null,
				voiceError === null
					? null
					: react.createElement("span", { style: styles.error, title: `Голос не работает: ${voiceError}` }, "голос недоступен"),
				notice === null ? null : react.createElement("span", { style: styles.error }, notice),
				error === null ? null : react.createElement("span", { style: styles.error, title: error }, "нет связи"),
			);
		}

		/**
		 * Поставить кнопку в строку служебных действий шапки сеанса.
		 * @param ctx - браузерный контекст с реестром слотов.
		 */
		function apply(ctx) {
			ctx.slots.inject(SLOT_NAME, () => ctx.slots.register({
				name: SLOT_NAME,
				id: "voice-stream",
				inject: () => ({}),
			}, VoiceButton));
		}

		exports.apply = apply;
		/** Службы браузерной половины: нужен только реестр слотов. */
		exports.inject = ["slots"];
		return module.exports;
	},
});
