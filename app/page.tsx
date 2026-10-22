"use client";

import { useEffect, useState, type ReactNode } from "react";
import { checkInput } from "../lib/validate";
import { sheetToMarkdown } from "../lib/export";
import { summarizeSheet } from "../lib/sheet";
import type { Answers, FlaggedQuestion, Question, Rule } from "../lib/types";

type Fail = { ok: false; message: string; detail?: string };
type Busy = "gaps" | "sheet" | "ask" | null;
type Sheet = { rules: Rule[]; openGaps: FlaggedQuestion[]; inPerson: FlaggedQuestion[] };
type AskResult = { captured: boolean; answer: string; cited: Rule[] };
type Filter = "all" | "conflict" | "nocont" | "leaver" | "missing";

const GAP_MESSAGES = ["Reading the SOP…", "Checking it against the cases…", "Writing questions for the leaver…"];
const SHEET_MESSAGES = ["Reading the leaver's answers…", "Writing rules, each with its quote…", "Checking for conflicts and gaps…"];
const SUGGESTIONS = ["Who approves exceptions?", "What if a step fails?", "What are the deadlines?"];
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "conflict", label: "Conflicts" },
  { key: "nocont", label: "No contingency" },
  { key: "leaver", label: "From leaver" },
  { key: "missing", label: "Source not found" },
];

async function post<R>(url: string, body: unknown): Promise<R | Fail> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch {
    return { ok: false, message: "Something went wrong, try again." };
  }
}

function Badge({ color, children }: { color: "red" | "amber" | "blue" | "grey" | "green"; children: ReactNode }) {
  return <span className={`badge ${color}`}>{children}</span>;
}

function ErrorBox({ error }: { error: Fail | null }) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      {error.message}
      {error.detail && <small>{error.detail}</small>}
    </div>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

// A circular progress ring. `percent` is 0 to 100; whatever is passed as children sits in the middle.
function Ring({ percent, size = 112, stroke = 11, children }: { percent: number; size?: number; stroke?: number; children?: ReactNode }) {
  const p = Math.min(100, Math.max(0, percent));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  return (
    <div className="ring" style={{ width: size, height: size }} data-percent={p} role="img" aria-label={`${p}% of questions answered`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={mid} cy={mid} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="ring-fill"
          cx={mid}
          cy={mid}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p / 100)}
          transform={`rotate(-90 ${mid} ${mid})`}
        />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}

// Cycles through short status messages while a slow AI step runs, so the wait feels like progress.
function useCycle(messages: string[], active: boolean): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) { setI(0); return; }
    const t = setInterval(() => setI((n) => (n + 1) % messages.length), 2600);
    return () => clearInterval(t);
  }, [active, messages.length]);
  return messages[i];
}

// Scroll to a section only if it isn't already comfortably on screen.
function scrollToSection(id: string) {
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.55) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 80);
}

function matchesFilter(r: Rule, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "conflict") return r.conflict;
  if (f === "nocont") return r.no_contingency;
  if (f === "leaver") return r.source === "leaver";
  return r.source_found === false;
}

function ruleClass(r: Rule): string {
  if (r.source_found === false) return "rule--missing";
  if (r.conflict) return "rule--conflict";
  if (r.no_contingency) return "rule--nocont";
  if (r.source === "leaver") return "rule--leaver";
  return "";
}

export default function Home() {
  const [sop, setSop] = useState("");
  const [cases, setCases] = useState("");
  const [busy, setBusy] = useState<Busy>(null);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [askText, setAskText] = useState("");
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [exportMsg, setExportMsg] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const [gapsError, setGapsError] = useState<Fail | null>(null);
  const [sheetError, setSheetError] = useState<Fail | null>(null);
  const [askError, setAskError] = useState<Fail | null>(null);

  const gapMessage = useCycle(GAP_MESSAGES, busy === "gaps");
  const sheetMessage = useCycle(SHEET_MESSAGES, busy === "sheet");

  useEffect(() => { if (questions.length > 0) scrollToSection("sec-gaps"); }, [questions.length]);
  useEffect(() => { if (sheet) scrollToSection("sec-sheet"); }, [sheet]);
  useEffect(() => { if (confirmed) scrollToSection("sec-ask"); }, [confirmed]);

  async function loadSample() {
    try {
      const [a, b] = await Promise.all([
        fetch("/samples/sop-fpna-month-end-close.txt"),
        fetch("/samples/cases.txt"),
      ]);
      if (!a.ok || !b.ok) throw new Error("missing");
      setSop(await a.text());
      setCases(await b.text());
      setGapsError(null);
    } catch {
      setGapsError({ ok: false, message: "Couldn't load the sample." });
    }
  }

  async function findGaps() {
    setQuestions([]); setAnswers({}); setSheet(null); setConfirmed(false); setAskResult(null);
    setSheetError(null); setAskError(null);
    const problem = checkInput(sop, cases);
    if (problem) {
      setGapsError({ ok: false, message: problem });
      return;
    }
    setGapsError(null);
    setBusy("gaps");
    const res = await post<{ ok: true; questions: Question[] }>("/api/gaps", { sop, cases });
    setBusy(null);
    if (res.ok) setQuestions(res.questions);
    else setGapsError(res);
  }

  function setAnswer(id: string, change: Partial<Answers[string]>) {
    setAnswers((prev) => {
      const current = prev[id] ?? { text: "", inPerson: false };
      return { ...prev, [id]: { ...current, ...change } };
    });
  }

  async function buildSheet() {
    setSheet(null); setConfirmed(false); setAskResult(null); setSheetError(null); setFilter("all");
    setBusy("sheet");
    const res = await post<{ ok: true } & Sheet>("/api/sheet", { sop, cases, questions, answers });
    setBusy(null);
    if (res.ok) setSheet(res);
    else setSheetError(res);
  }

  async function ask() {
    setAskResult(null); setAskError(null);
    setBusy("ask");
    const res = await post<{ ok: true } & AskResult>("/api/ask", { question: askText, rules: sheet?.rules });
    setBusy(null);
    if (res.ok) setAskResult(res);
    else setAskError(res);
  }

  const summary = sheet ? summarizeSheet(questions.length, sheet.rules, sheet.openGaps.length, sheet.inPerson.length) : null;
  const answeredNow = questions.filter((q) => (answers[q.id]?.text ?? "").trim() !== "").length;
  const inPersonNow = questions.filter((q) => answers[q.id]?.inPerson).length;
  const visibleRules = sheet ? sheet.rules.filter((r) => matchesFilter(r, filter)) : [];
  const filterCount = (f: Filter) => (sheet ? sheet.rules.filter((r) => matchesFilter(r, f)).length : 0);

  function sheetMarkdown(): string {
    if (!sheet || !summary) return "";
    const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    return sheetToMarkdown(sheet.rules, sheet.openGaps, sheet.inPerson, summary, date);
  }

  async function copySheet() {
    try {
      await navigator.clipboard.writeText(sheetMarkdown());
      setExportMsg("Copied to the clipboard.");
    } catch {
      setExportMsg("Copying was blocked here. Use Download instead.");
    }
  }

  function downloadSheet() {
    const blob = new Blob([sheetMarkdown()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "continuity-rules-sheet.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExportMsg("Downloaded continuity-rules-sheet.md.");
  }

  // Which step of the journey the person is on.
  const done = [questions.length > 0, !!sheet, confirmed, !!askResult];
  const currentStep = done.findIndex((d) => !d);
  const steps = [
    { id: "sec-input", label: "Paste", enabled: true },
    { id: "sec-gaps", label: "Review gaps", enabled: questions.length > 0 },
    { id: "sec-sheet", label: "Rules sheet", enabled: !!sheet },
    { id: "sec-ask", label: "Ask the bot", enabled: confirmed },
  ];

  return (
    <>
      <header className="hero">
        <div className="wrap">
          <h1><span className="mark">Continuity</span></h1>
          <p className="tagline">Paste the handover SOP and a few real cases. Find what they don&apos;t say.</p>
          <nav className="stepper" aria-label="Progress">
            <ol>
              {steps.map((s, i) => (
                <li key={s.id} className={done[i] ? "done" : i === currentStep ? "current" : ""}>
                  <a href={`#${s.id}`} aria-disabled={!s.enabled} aria-current={i === currentStep ? "step" : undefined}>{s.label}</a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </header>

      <main>
        {questions.length === 0 && busy !== "gaps" && (
          <div className="how">
            <div className="how-card"><strong>Paste the SOP and cases</strong><span>Or load the sample to see it work in a minute.</span></div>
            <div className="how-card"><strong>See what it leaves out</strong><span>Every question quotes the exact line it comes from.</span></div>
            <div className="how-card"><strong>Get a sourced rules sheet</strong><span>The leaver answers, and every rule keeps its quote.</span></div>
          </div>
        )}

        <section className="card" id="sec-input">
          <h2>1. The handover documents</h2>
          <div className="field-meta">
            <label htmlFor="sop">SOP</label>
            <span className="count">
              {sop.length.toLocaleString()} characters{sop.trim().length < 200 ? " · at least 200 needed" : ""}
            </span>
          </div>
          <textarea id="sop" rows={9} value={sop} onChange={(e) => setSop(e.target.value)} placeholder="Paste the SOP here" />
          <div className="field-meta">
            <label htmlFor="cases">2–3 real cases</label>
            <span className="count">{cases.length.toLocaleString()} characters</span>
          </div>
          <textarea id="cases" rows={6} value={cases} onChange={(e) => setCases(e.target.value)} placeholder="Paste real cases here (optional but helpful)" />
          <div className="row">
            <button onClick={findGaps} disabled={busy !== null}>
              {busy === "gaps" ? <><Spinner />Finding gaps…</> : "Find gaps"}
            </button>
            <button className="secondary" onClick={loadSample} disabled={busy !== null}>Load sample</button>
            <span className="note">The sample is a made-up month-end close. It usually takes 5 to 20 seconds.</span>
          </div>
          {busy === "gaps" && (
            <div className="working" role="status"><Spinner /><span>{gapMessage}</span></div>
          )}
          <ErrorBox error={gapsError} />
        </section>

        {questions.length > 0 && (
          <div className="grid2" id="sec-gaps">
            <section className="card">
              <h2>2. Gaps found: questions for the leaver</h2>
              <p className="note">Suggested by AI, so it is not a complete list. Each quote is checked against your text.</p>
              {questions.length < 5 && <p className="note">Only {questions.length} gaps found for this text.</p>}
              {questions.map((q) => (
                <div className="item q" key={q.id}>
                  <strong>{q.id}. {q.question}</strong>
                  <blockquote>
                    <span className="mark">“{q.quote}”</span>{" "}
                    {q.source_found === false && <Badge color="red">source not found</Badge>}
                  </blockquote>
                  <div className="why">{q.why_it_matters}</div>
                </div>
              ))}
            </section>

            <section className="card leaver-card">
              <h2>Leaver</h2>
              <p className="note">Answer what you can. Leave the rest blank, or tick &quot;needs in-person&quot;.</p>
              <div className="meter" aria-hidden="true">
                <span style={{ width: `${questions.length ? Math.round((answeredNow / questions.length) * 100) : 0}%` }} />
              </div>
              <p className="note" role="status">
                {answeredNow} of {questions.length} answered{inPersonNow > 0 ? ` · ${inPersonNow} for a live conversation` : ""}
              </p>
              {questions.map((q) => {
                const a = answers[q.id];
                const isAnswered = (a?.text ?? "").trim() !== "";
                return (
                  <div className={`item${isAnswered ? " is-answered" : ""}${a?.inPerson ? " is-inperson" : ""}`} key={q.id}>
                    <label htmlFor={`a-${q.id}`}><span className="dot" aria-hidden="true" />{q.id}. {q.question}</label>
                    <textarea
                      id={`a-${q.id}`}
                      rows={2}
                      value={a?.text ?? ""}
                      onChange={(e) => setAnswer(q.id, { text: e.target.value })}
                    />
                    <label className="note">
                      <input
                        type="checkbox"
                        checked={a?.inPerson ?? false}
                        onChange={(e) => setAnswer(q.id, { inPerson: e.target.checked })}
                      />{" "}
                      needs in-person
                    </label>
                  </div>
                );
              })}
              <div className="row">
                <button onClick={buildSheet} disabled={busy !== null}>
                  {busy === "sheet" ? <><Spinner />Building…</> : "Build rules sheet"}
                </button>
                <span className="note">Blank answers become open gaps. Nothing is guessed.</span>
              </div>
              {busy === "sheet" && (
                <div className="working" role="status"><Spinner /><span>{sheetMessage}</span></div>
              )}
              <ErrorBox error={sheetError} />
            </section>
          </div>
        )}

        {sheet && (
          <section className="card print-sheet" id="sec-sheet" style={{ marginTop: 18 }}>
            <h2>3. Rules sheet</h2>
            {summary && (
              <div className="status" role="group" aria-label="Handover status">
                <Ring percent={summary.percent}>
                  <span className="ring-pct">{summary.percent}%</span>
                  <span className="ring-sub">answered</span>
                </Ring>
                <div className="status-body">
                  <div>
                    <strong>Handover status:</strong> {summary.answered} of {summary.total} questions answered ({summary.percent}%)
                  </div>
                  <div className="chips">
                    <Badge color={summary.open > 0 ? "amber" : "green"}>{summary.open} open {summary.open === 1 ? "gap" : "gaps"}</Badge>
                    <Badge color={summary.inPerson > 0 ? "blue" : "grey"}>{summary.inPerson} needs in-person</Badge>
                    <Badge color={summary.conflicts > 0 ? "red" : "green"}>{summary.conflicts} {summary.conflicts === 1 ? "conflict" : "conflicts"} to check</Badge>
                    <Badge color={summary.noContingency > 0 ? "amber" : "green"}>{summary.noContingency} no contingency documented</Badge>
                    <Badge color={summary.sourceNotFound > 0 ? "red" : "green"}>{summary.sourceNotFound} source not found</Badge>
                  </div>
                </div>
              </div>
            )}
            <div className="row no-print">
              <button className="secondary" onClick={copySheet}>Copy as Markdown</button>
              <button className="secondary" onClick={downloadSheet}>Download .md</button>
              <button className="secondary" onClick={() => window.print()}>Print or save as PDF</button>
              {exportMsg && <span className="note" role="status">{exportMsg}</span>}
            </div>
            <p className="note">
              Tags marked AI-flagged are the AI&apos;s judgement. Check them against the quote beside each rule.
            </p>
            <div className="filters no-print" role="group" aria-label="Filter rules">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`chip${filter === f.key ? " on" : ""}`}
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}<span className="n">{filterCount(f.key)}</span>
                </button>
              ))}
            </div>

            {visibleRules.length === 0 && <p className="note">No rules match this filter.</p>}
            {visibleRules.map((r) => (
              <div className={`item rule ${ruleClass(r)}`} key={r.id}>
                <strong>{r.id}.</strong> {r.rule}{" "}
                <Badge color="grey">{r.source === "SOP" ? "from SOP" : "from leaver"}</Badge>
                {r.source_found === false && <Badge color="red">source not found</Badge>}
                {r.added_as_written && <Badge color="grey">added as written</Badge>}
                {r.conflict && <Badge color="red">AI-flagged: conflict</Badge>}
                {r.no_contingency && <Badge color="amber">AI-flagged: no contingency documented</Badge>}
                {r.question_id && sheet.inPerson.some((p) => p.id === r.question_id) && (
                  <Badge color="blue">needs in-person</Badge>
                )}
                <blockquote><span className="mark">“{r.quote}”</span></blockquote>
                {r.conflict && r.conflict_note && <div className="why">Conflict: {r.conflict_note}</div>}
              </div>
            ))}

            <h2 className="sheet-section-title">Open gaps (unanswered)</h2>
            {sheet.openGaps.length === 0 ? (
              <p className="note">None. Every question has an answer.</p>
            ) : (
              sheet.openGaps.map((g) => (
                <div className="item" key={g.id}>
                  {g.id}. {g.question} <Badge color="amber">open gap</Badge>
                  {g.inPerson && <Badge color="blue">needs in-person</Badge>}
                </div>
              ))
            )}

            {sheet.inPerson.length > 0 && (
              <>
                <h2 className="sheet-section-title">Needs in-person</h2>
                {sheet.inPerson.map((g) => (
                  <div className="item" key={g.id}>{g.id}. {g.question}</div>
                ))}
              </>
            )}

            <div className="row">
              {!confirmed ? (
                <>
                  <button onClick={() => setConfirmed(true)}>Confirm sheet</button>
                  <span className="note">Confirming unlocks the bot, which answers only from this sheet.</span>
                </>
              ) : (
                <Badge color="blue">Sheet confirmed</Badge>
              )}
            </div>
          </section>
        )}

        {sheet && confirmed && (
          <section className="card" id="sec-ask" style={{ marginTop: 18 }}>
            <h2>4. Ask the bot</h2>
            <p className="note">It answers only from the confirmed rules above.</p>
            <label htmlFor="ask">Your question</label>
            <textarea id="ask" rows={2} value={askText} onChange={(e) => setAskText(e.target.value)} />
            <div className="suggest">
              <span className="note">Try:</span>
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => setAskText(s)}>{s}</button>
              ))}
            </div>
            <div className="row">
              <button onClick={ask} disabled={busy !== null || askText.trim() === ""}>
                {busy === "ask" ? <><Spinner />Thinking…</> : "Ask"}
              </button>
            </div>
            <ErrorBox error={askError} />
            {askResult && (
              <div className={`item answer-card${askResult.captured ? "" : " not-captured"}`}>
                <div className="answer">{askResult.answer}</div>
                {askResult.captured && (
                  <>
                    <div className="note">Cited: {askResult.cited.map((r) => r.id).join(", ")}</div>
                    {askResult.cited.map((r) => (
                      <blockquote key={r.id}><strong>{r.id}:</strong> {r.rule}</blockquote>
                    ))}
                  </>
                )}
              </div>
            )}
          </section>
        )}
      </main>

      {questions.length > 0 && (
        <a className="dock no-print" href={sheet ? "#sec-sheet" : "#sec-gaps"} aria-label={`Progress: ${answeredNow} of ${questions.length} questions answered`}>
          <Ring percent={Math.round((answeredNow / questions.length) * 100)} size={54} stroke={6}>
            <span className="ring-pct">{Math.round((answeredNow / questions.length) * 100)}%</span>
          </Ring>
          <span className="dock-text">
            <strong>{answeredNow} of {questions.length}</strong> answered
            {inPersonNow > 0 ? <span className="dock-sub">{inPersonNow} for a live talk</span> : null}
          </span>
        </a>
      )}

      <footer className="foot">
        Continuity is a prototype. Nothing is saved, so refreshing the page starts over.
      </footer>
    </>
  );
}
