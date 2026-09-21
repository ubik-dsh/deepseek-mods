# @local/dsh-locale-ru

**Russian localization** for the harness Web GUI. The harness ships English and Chinese
only; this plugin adds a third language through the locale registry's public
language-pack API.

*Русская версия: [README.ru.md](README.ru.md).*

![Language selection in Russian](../../docs/screenshots/russian-settings.png)

## Coverage

| Metric | Value |
|---|---|
| Namespaces | 42 |
| Translated strings | 1257 |
| Of them containing Cyrillic | 1195 |
| Bundle size | ~88 KiB |

The remaining ~60 values are intentionally untranslated: `OK`, `HTML`, `PDF`,
`JSON`, model ids, application names, and strings that are nothing but
placeholders (`{name}`, `{value}K`).

## How it works

```js
ctx.locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' })
ctx.locale.register(namespace, 'ru', dictionary)
```

The fallback chain ends at `en`, so a namespace or key without a translation
keeps showing English: the pack degrades per key rather than breaking the UI.

## Choosing the language

**Settings → General → Language → Русский.** The switch is instant, without a
reload, and the choice is persisted in `$DSH_HOME/settings.yaml`.

A browser asking for Russian (`Accept-Language: ru`) gets the Russian UI right
away — the harness derives the locale from the browser until an explicit preference is
stored.

## Editing translations

`lib/client.js` is **generated**. Edit the sources and rebuild:

```
i18n/en/<namespace>.json    the English source, extracted from a harness install
i18n/ru/<namespace>.json    the Russian translation
```

```bash
node tools/build-locale.mjs
```

The builder refuses to write the bundle if a translation has a different key
set or different placeholders than its English source, so a typo cannot ship
silently. It also refuses empty values.

## Refreshing for a new harness version

```bash
node tools/extract-locale.mjs     # re-read the shipped dictionaries
node tools/build-locale.mjs       # rebuild, keeping existing translations
```

New namespaces and new keys appear in English until they are translated in
`i18n/ru/`.

## Limitations

- The harness provides no plural rules to language packs, so forms were chosen for the
  `.one`/`.other` categories the interface selects between.
- Copy that plugins read once at registration time (slash-command descriptions
  and the like) keeps the language it was registered under until the page is
  reloaded — a harness constraint, not this pack's.
- The `directory-browser` namespace (13 strings) was translated by hand: its
  dictionary is registered in a loop, which the automated extractor cannot
  follow.
