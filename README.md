# Continuity

**Find what the handover documents don't say, and get the leaver to fill it in, before they leave.**

A hackathon MVP. You paste an SOP and a few real cases, the app asks the leaver the questions the SOP doesn't answer, and turns the answers into a rules sheet where every rule quotes its source.

## Job to be done

> When I take over a process from someone who's leaving and the handover documents only list the steps, I want to find out what those documents don't say and get the leaver to fill it in quickly, so I can run the process without learning the exceptions through errors and escalations.

**User:** an incoming team lead or successor at an Indian services firm (IT, BFSI, KPO) who has just been handed an SOP by a colleague on their way out.

## The 3 tests the MVP must pass

1. **Find gaps.** Paste an SOP plus 2–3 real cases (or click **Load sample**) and click **Find gaps**. Within about 20 seconds you see 5–10 questions for the leaver. Each quotes the exact source step word for word and says why it matters.
2. **Leaver panel, rules sheet, bot.** In the **Leaver** panel you answer some questions, leave some blank, and tick one as "needs in-person". Click **Build rules sheet**. Each rule quotes its source (SOP or leaver). Conflicts are flagged, risky steps are marked "no contingency documented", ticked items are marked "needs in-person", and unanswered questions are listed as open gaps. Click **Confirm sheet**, then ask the bot a question. If the sheet covers it, you get an answer citing the rule number. If not, you get exactly `not captured`.
3. **Bad input never crashes or invents content.**
   - Empty or very short text (under ~200 characters) shows "Paste a process description", with no AI call.
   - Text that isn't a work process (e.g. a recipe) shows "This doesn't look like a process".
   - Building the sheet with all answers blank gives a sheet from the SOP only, with every question listed as an open gap.
   - Any rule whose quote isn't found in the source text is tagged "source not found", checked by plain code.

All three were checked in the running app with the made-up FP&A sample and a separate accounts-payable SOP.

## Current workflow → future workflow

| | Today | With Continuity |
|---|---|---|
| **What the successor gets** | An SOP that lists steps | The SOP plus a list of what it leaves out |
| **How gaps are found** | Learned later, through errors and escalations | Found on day one by reading the SOP against real cases |
| **Getting the leaver's knowledge** | Ad-hoc chats, a rushed last-day call, or nothing | A short list of specific questions, each tied to a quoted step |
| **What the leaver does** | Tries to remember everything | Answers a few pointed questions, or ticks "needs in-person" for the hard ones |
| **What the successor ends up with** | Their memory of conversations | A rules sheet where every rule quotes its source, conflicts are flagged, and open gaps are listed |
| **Questions later** | Ask the leaver (who has gone) | Ask the bot. It answers only from the confirmed sheet, or says `not captured` |

## Architecture: Input → AI → Logic → Action → Output

The app has four AI calls. Everything else is plain code. The fourth call (the team question bank) was added after the original three-call plan.

### A. Find gaps
- **Input:** SOP text and cases (typed, pasted, or loaded from the sample).
- **AI (call 1):** decides if the text is a work process, then returns 5–10 questions, each with an exact quote and a "why it matters".
- **Logic (plain code):**
  - Checks the length first, and makes no AI call if the input is too short or too long.
  - Validates the AI's JSON, with one retry.
  - Checks every quote against your text.
  - Tops up with a second AI call if fewer than 5 questions came back, then merges, de-duplicates and caps at 10.
- **Action:** you click **Find gaps**.
- **Output:** question cards with the quote and "why it matters". A red "source not found" badge appears where a quote isn't really in your text.

### B. Build rules sheet
- **Input:** the SOP, the cases, and the leaver's answers (blank ones marked blank).
- **AI (call 2):** returns rules with a source, a quote, a conflict flag and a no-contingency flag.
- **Logic (plain code):**
  - Validates the JSON, with one retry.
  - Checks each quote against the right source: the SOP and cases, or that question's answer.
  - Adds any sentence of a leaver's answer the AI left out, word for word, labelled "added as written".
  - Builds the open-gaps and "needs in-person" lists from your blank boxes and ticks.
- **Action:** you answer some questions, leave some blank, tick one, click **Build rules sheet**, then **Confirm sheet**.
- **Output:** the rules sheet, with quotes, tags, open gaps and in-person items.

### C. Ask the bot
- **Input:** your question, plus only the confirmed rules whose quotes were found in the source.
- **AI (call 3):** returns whether the sheet covers it, an answer, and the rule numbers it used.
- **Logic (plain code):** if the AI says "not covered", or cites no rule that really exists, the screen shows exactly `not captured`, whatever the AI wrote.
- **Action:** the Ask box only appears after you click **Confirm sheet**.
- **Output:** the answer with its cited rules shown underneath, or `not captured`.

### D. Ask the team question bank (outside the SOP)
- **Input:** a question, plus a **team question bank**: past questions and answers between colleagues (who answered, and when). Paste your own, or click **Load example bank**. Format: `Q:`, `A:`, `By:`, `Date:` lines, with a blank line between entries.
- **AI (call 4):** answers only from the bank. If entries disagree, the answer starts with "The answers disagree." and says what each one says.
- **Logic (plain code):**
  - Parses the bank, numbers the entries B1, B2 and so on, and skips entries missing a `Q:` or `A:`.
  - If the bank is large, sends only the entries that share the most words with the question.
  - Checks that every cited entry really exists. If the AI cites none, or says it found nothing, the screen shows exactly `not in the bank`.
  - Rejects an answer that names a person whose entry was not cited, so a past answer is never credited to the wrong colleague.
  - Prints who said it and when next to each cited entry, straight from the bank, not from the AI.
- **Action:** switch to the **Team question bank** tab in the Ask panel. When the rules sheet answers `not captured`, a link offers to search the bank with the same question.
- **Output:** the answer, labelled "From team Q&A. Not the SOP.", with the cited entries underneath. This is informal knowledge, so it is kept apart from the sheet, which is built only from the SOP, the cases and the leaver's answers.

### Also included
- **Handover status ring:** above the rules sheet, a circular progress ring and a count of questions answered, open gaps, items that need in-person, conflicts to check, rules marked "no contingency documented", and rules with source not found. A small floating ring shows the same progress live from the moment the questions appear. It is plain counting, with no AI call.
- **Export:** copy the sheet as Markdown, download it as `continuity-rules-sheet.md`, or print it or save it as a PDF. The print view shows only the sheet.
- **Automatic retry:** if the AI service answers "busy" (HTTP 5xx) or "rate limited" (429), the app waits a moment and tries again, up to three tries in total. A timeout or a rejected key is not retried.

## Where AI is used, what stays human, and why

**AI does the reading and writing that needs meaning:** spotting an exception in a case that the SOP never mentions, a step with no fallback, two steps that disagree in different words, and turning free-form answers into clean rules. A keyword rule can't do that.

**Plain code does everything that has a right answer:** the input checks, the JSON shape check, the quote check, the open-gap list, the in-person tags, the citation check, the `not captured` rule, and showing/hiding panels. These are never left to the AI, because the AI can invent quotes and mark its own homework.

**What stays human:**
- You choose the input and when to run each step.
- You judge each question and decide what to ask.
- The leaver answers, leaves blank, or says "needs in-person". Only people know what to ask in a real conversation.
- You check the sheet against the quote beside every rule. Tags marked "AI-flagged" are the AI's judgement and need checking.
- You click **Confirm sheet**, so a person has signed off on what the bot knows.

### Why these tools
- **Next.js:** one app, one main screen, with server routes for the AI calls, and it deploys to Vercel as-is.
- **AI calls only on the server** (`app/api/...`): the API key stays out of the browser. It is read from `.env.local`, never written into code, and never committed.
- **Gemini (free) for testing, Claude for the real thing:** the model is a setting (`AI_PROVIDER` in `.env.local`), so you can build and test for free and switch to Claude Haiku later without changing code. The Claude path is written but has not been tested with a live key yet.
- **Plain TypeScript checks and Vitest:** the safety rules are small, exact functions with unit tests, not prompts.
- **State lives in the browser:** no login, no database. Refreshing starts over, by design for the demo.

## Failure cases and what happens

| Situation | What the user sees |
|---|---|
| Empty or under ~200 characters | "Paste a process description". No AI call. |
| Over about 30,000 characters | "That's too long, paste just the relevant part". No AI call. |
| Not a work process (recipe, story, hobby) | "This doesn't look like a process", plus the AI's one-line reason |
| Sample file can't load | "Couldn't load the sample." Your typed text is left alone. |
| API key missing or rejected | A clear message pointing to `.env.local` |
| AI provider busy (5xx) or rate-limited (429) | The app retries automatically, up to three tries in total. If it is still busy: "The AI service is busy right now. Try again in a moment." |
| AI provider times out or is down | "Something went wrong, try again." A timeout is not retried, because it already used the time limit. |
| AI returns broken JSON twice | The same friendly error, never a crash |
| AI returns fewer than 5 questions | Code asks for more. If it still falls short, it says "Only N gaps found for this text." |
| AI invents or alters a quote | A red "source not found" badge. Such rules are also kept out of what the bot knows. |
| AI quotes a short fragment to back a rule | Treated as not found. A short quote must be a whole sentence of the source. |
| AI drops part of a leaver's answer | The missing sentence is added to the sheet word for word, tagged "added as written" |
| Bot can't answer from the sheet | Exactly `not captured`, with a link to try the team question bank |
| Asking the bank with no bank loaded | "Load a question bank first, or paste your own below." No AI call. |
| The bank has no answer | Exactly `not in the bank` |
| AI cites a bank entry that doesn't exist | Exactly `not in the bank` |
| AI credits an answer to the wrong person | The answer is rejected and shown as `not in the bank` |
| Two bank entries disagree | The answer starts "The answers disagree." and both entries are shown |
| A bank entry has no `Q:` or `A:` line | It is skipped, and the count says how many were skipped |
| Bank over 200 entries or 40,000 characters | Extra entries are ignored, or a "too large" message is shown |
| All answers left blank | A sheet from the SOP only, and every question listed as an open gap |

**Known limits:**
- The AI can miss a real gap, so the screen says the questions are not a complete list.
- The conflict and no-contingency tags are AI judgement and vary from run to run, so check them against the quote.
- A rule can still be backed by a real quote that doesn't fully support it. The quote check proves the quote exists, not that the rule is right.
- A very short SOP step that isn't a complete sentence may be tagged "source not found".

## Run it locally

You need Node.js 20 or newer (LTS is fine) and git.

```bash
git clone https://github.com/utkarshkapoor04/continuity.git
cd continuity
npm install
```

Create your settings file by copying the example:

```bash
cp .env.example .env.local
```

On Windows PowerShell, use `Copy-Item .env.example .env.local`.

Open `.env.local` and fill in the key for the AI you want to use:

```
AI_PROVIDER=gemini
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-flash-lite-latest
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-haiku-5-5
```

- **Free testing:** get a Gemini key at https://aistudio.google.com/apikey. Free tiers may use what you send to improve Google's products, so only use the made-up sample, never real company documents.
- **Switching to Claude:** set `AI_PROVIDER=claude`, and put your Anthropic key on the `ANTHROPIC_API_KEY=` line.
- Never paste a key into chat, code or a commit. `.env.local` is in `.gitignore`.
- If a Gemini model name stops working, change `GEMINI_MODEL` to a current Flash or Flash-Lite model.

Start the app, then open http://localhost:3000 :

```bash
npm run dev
```

Click **Load sample**, then **Find gaps**. Restart the app after editing `.env.local`.

Run the checks:

```bash
npm test
npx tsc --noEmit
```

## Project layout

```
app/page.tsx              the one screen (all state lives here, in the browser)
app/api/gaps/route.ts     AI call 1: find gaps
app/api/sheet/route.ts    AI call 2: build the rules sheet
app/api/ask/route.ts      AI call 3: answer from the sheet
app/api/bank/route.ts     AI call 4: answer from the team question bank
lib/bank.ts               question bank: parsing, choosing entries, checking answers
lib/ai.ts                 the only file that talks to an AI (Gemini or Claude)
lib/prompts.ts            the three instructions given to the AI
lib/validate.ts           input checks and JSON shape checks
lib/quotes.ts             the quote checker
lib/sheet.ts              open gaps, tags, merging, citation checks
public/samples/           made-up FP&A month-end close SOP and cases, and an example question bank
tests/logic.test.ts       unit tests for the plain-code safety rules
```

## Out of scope for this MVP

Integrations (SharePoint, drives, email, ticketing), real company data, voice answers, Slack/Teams reminders, a manager view of handover completeness, logins and a database, n8n workflows, GitHub storage of rules sheets, and a separate link for the leaver. These are later versions.

## Deploying

The app is a standard Next.js project and deploys to Vercel. Add `AI_PROVIDER` and the matching API key as environment variables in the Vercel project settings, not in the code.
