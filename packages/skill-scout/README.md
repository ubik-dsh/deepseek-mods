# Skill scout

A DSH plugin adding a **Skill scout** tab to *Settings → Plugins*, one step after
**Skills**. It is a board for finding and judging skills, and it is the piece that
makes the search accumulate instead of starting over.

## The pipeline

```
a task        anyone — a person or an agent — says what to go and look for
   ↓
the scout     searches the skill roots and GitHub, ranks what comes back
   ↓
triage        cheap: structure, size, whether it can run here at all   ← most stop here
   ↓
the hearing   prosecutor, defence, judge — only for the survivors
   ↓
the catalogue one entry: link, description, two axes, verdict, rating, what was taken
   ↓
Add           a person decides. Nothing is adopted by the pipeline.
```

## Why the tab does not search

The obvious design is for the panel to run the search when the button is pressed. It is
the wrong one, for two reasons.

**It would put a credential and an outbound call behind a browser button.** Searching
needs a GitHub token and the network. Both belong to the agent that already holds them;
neither belongs in a route the page can reach.

**And it would not finish the job.** Judging needs a reader, and the reader is an agent.
Half a pipeline behind a button and half in a person is worse than a queue.

So pressing search **writes a task**. An agent takes it, runs the scout, triages what
comes back, puts the survivors on trial, and writes the catalogue. The tab is a board
both sides can see and write to.

## Two axes, not one score

| axis | the question |
|---|---|
| **Worth keeping** | the verdict of the hearing |
| **Runs here** | whether it can be used in this Harness at all |

They are separate because they diverge. One of the three skills judged so far was a
gate that hooks a mechanism this Harness does not have: a good idea, competently made,
and unusable here. A single score would have hidden exactly the distinction the
catalogue exists to keep.

## The rating carries its case count

Every entry shows the hearing's rating **and how many hearings are behind it**, because
a bare number reads as calibrated. Three hearings is not a scale, and the entry says so
rather than implying otherwise.

## What it writes

Two files in the Harness home, both owned by this plugin:

| file | what |
|---|---|
| `skill-scout-queue.json` | the tasks: what was asked, who asked, what came back, and the counts |
| `skill-catalogue.json` | the entries: what was found, what was decided, and on what evidence |

The skills repository carries a **rendered snapshot** of the catalogue as Markdown,
written by the agent when the catalogue changes. It is a record and is named as one, so
there is no second live copy to drift.

## Refreshing, and what needs what

| what changes | what it needs |
|---|---|
| a task, a claim, a verdict, an entry, adoption | **nothing** — written and read live |
| installing this plugin for the first time | the page reloaded (F5) |
| updating an already-installed copy | `dsh web` restarted |

## What the tab does not do

- **It does not search.** An agent does, and that is a design decision rather than a
  missing feature — see above.
- **It does not adopt.** The Add button is a person's; a pipeline that adopts its own
  findings can install something nobody chose.
- **It does not judge.** The hearing is a procedure in a skill, not code. The host half
  only stores what the hearing produced.
- **It does not touch the skills themselves.** It is a catalogue of what was found
  elsewhere, not a manager of what is installed. That is the Skills tab next door.
