---
name: create-a-skill
description: Author a new DSH skill — a folder of instructions that an agent loads on demand. Use when the user asks you to learn a tool, a site, or a workflow and keep it for later, or says "make yourself a skill for X".
---

# Authoring a DSH skill

A skill is a file an agent reads when a task matches it. It is not a plugin: it
needs no install, no restart, and no code. That is the whole point — you can give
yourself a new capability in one file, and it is live immediately.

## Where it goes

DSH looks for skills in seven roots. Ranks run 100 to 600 and **the lower rank
wins** when two roots offer the same name; the nearest layer beats a duplicate
outright, and rank only decides between roots inside one layer.

| Root | Rank | Use it for |
|---|---|---|
| `<project>/.dsh/skills` | 100 | a project's own skills |
| `<project>/.agents/skills` | 200 | project skills that should travel with the repository — **prefer this one** |
| a runtime registration | 250 | skills a plugin registers while running |
| custom roots, if configured | 300 | an installation's own arrangement |
| `$DSH_HOME/skills` | 400 | one person's skills, for every project |
| `$DSH_AGENTS_HOME`, default `~/.agents`, then `/skills` | 500 | shared across the agents on a machine |
| the bundled directory | 600 | shipped with the harness, and trusted |

Every one of them is watched. Write the file and the skill exists — no restart,
no reload, no install.

Prefer `<project>/.agents/skills` for anything meant to travel with a repository:
clone the repository, open it as the workspace, and the agent already has the
capability. Reach for `$DSH_HOME/skills` when the skill should follow the person
rather than the project.

## The file

Two shapes are accepted:

```
.agents/skills/
  create-a-skill/
    SKILL.md            ← a bundle, with room for resources beside it
  quick-note.md         ← a flat file, for something with no resources
```

Reach for the bundle when the skill needs supporting files — a template, a
checklist, a script. Those live next to `SKILL.md` and are addressed relative to
the skill's own directory, which the agent is told when the skill loads.

## Frontmatter is the whole interface

```yaml
---
name: weekly-report
description: Build the weekly report from the repository. Use when the user asks for the weekly summary, the Monday report, or the status round-up.
---
```

- **`name` is required** and must be kebab-case: lowercase letters, digits and
  single hyphens — `^[a-z0-9]+(?:-[a-z0-9]+)*$`. `Weekly_Report`, `weekly report`
  and `weekly--report` are all silently ignored, which is the failure you will
  spend longest not noticing.
- **`description` is required.** See below; it is the important one.
- **`disable-model-invocation: true`** keeps a skill away from the model, for
  something only a person should run. **`user-invocable: false`** does the
  opposite. Both are kebab-case; the older camelCase spellings are rejected with
  a message telling you the new name.
- A missing or malformed frontmatter block means the file is skipped, with a
  reason written to the log. Nothing tells you in the conversation.

## The description is the trigger

An agent never sees your instructions until it decides they apply. What it sees
first is a catalogue of every skill's **name and description** and nothing else.
A vague description is a skill that never loads.

Write it as two things in one sentence or two: what the skill produces, and the
words that should make an agent reach for it.

- Weak: `Helps with reports.`
- Strong: `Build the weekly report from the repository. Use when the user asks
  for the weekly summary, the Monday report, or the status round-up.`

Name the situations in the user's own vocabulary. That is the matching surface.

## Write instructions, not documentation

The body is read by an agent that is about to do the work, so write it as a
procedure:

- Start with the steps, in order. Background goes after, or nowhere.
- State the exact commands, paths and file names. An agent should not have to
  invent an interface you already know.
- Say what a correct result looks like, and how to check it — a command, a file
  that must exist, a field that must be present.
- Record what goes wrong and what it looks like: the error text, the silent
  failure, the plausible-looking wrong answer. This is the part that turns a
  description of the task into a skill.
- If something is version-dependent, say which version you checked, and tell the
  agent to confirm it against the installation in front of it rather than
  trusting the file. Interfaces move; a skill that states a stale fact with
  confidence is worse than one that says where to look.

Keep it as long as it needs to be and no longer. Every line competes for
attention with the actual task.

## Prove it before you finish

1. **Did it appear?** Write the file, then check the session's skill catalogue.
   A correctly formed skill shows up immediately, with no restart. If it is
   absent, the frontmatter is the reason — check the name against the kebab-case
   rule first, then the indentation of the YAML.
2. **Can it be loaded?** Ask for it by name. A load returns the instructions and
   the skill's base directory; if the body is missing, the frontmatter block is
   not delimited correctly.
3. **Does it actually work?** Run the task the skill describes, on a real input,
   and check the result against the check you wrote in step 1 of the body. A
   skill that loads but produces the wrong thing is worse than no skill, because
   it will be trusted.

## The contract this file was written against

DSH `0.1.5-rc.2`. The locations and their ranks, the kebab-case rule, the two
required fields and the live discovery were read out of `@deepseek-ai/dsh-skill`
and `@deepseek-ai/dsh-skill-filesystem`, and confirmed by dropping a skill into a
live workspace and watching the catalogue change.

The first version of this file listed only the two project roots and missed the
user-level ones — a third-party skill's documentation had them right and forced
the correction. Read other people's skills; they are the cheapest way to find out
what you assumed.

If those packages have moved on, read them again before trusting this file:

```bash
find "$(dirname "$(command -v dsh)")" -name 'index.js' -path '*dsh-skill*'
```

---

Кратко по-русски: скилл — это файл, который агент читает, когда задача
совпадает. Лежит в `<проект>/.agents/skills/<имя>/SKILL.md` или плоским `.md`,
подхватывается сразу, без перезапуска. В заголовке обязательны `name`
(только строчные буквы, цифры и одиночные дефисы) и `description` — именно по
нему агент решает, что скилл подходит, поэтому в описании должны стоять слова
пользователя. Тело пишется как инструкция: шаги, точные команды, признак
правильного результата и то, как выглядит типичная ошибка.
