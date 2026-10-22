"use client";

import { useEffect, useMemo, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { checkInput } from "../lib/validate";
import { sheetToMarkdown } from "../lib/export";
import { summarizeSheet } from "../lib/sheet";
import { parseBank } from "../lib/bank";
import { contextAround, locateQuote } from "../lib/locate";
import type { BankEntry } from "../lib/bank";
import type { Answers, FlaggedQuestion, Question, Rule } from "../lib/types";

type Fail = { ok: false; message: string; detail?: string };
type Busy = "gaps" | "sheet" | "ask" | null;
type Sheet = { rules: Rule[]; openGaps: FlaggedQuestion[]; inPerson: FlaggedQuestion[] };
type AskResult = { captured: boolean; answer: string; cited: Rule[] };
type BankResult = { found: boolean; answer: string; cited: BankEntry[] };
type Filter = "all" | "conflict" | "nocont" | "leaver" | "missing" | "unsure";
type AskMode = "sheet" | "bank";
type Review = Record<string, "ok" | "unsure">;
type HistoryItem = { mode: AskMode; question: string; answer: string; hit: boolean };

const GAP_MESSAGES = ["Reading the SOP…", "Checking it against the cases…", "Writing questions for the leaver…"];
const SHEET_MESSAGES = ["Reading the leaver's answers…", "Writing rules, each with its quote…", "Checking for conflicts and gaps…"];
const SHEET_SUGGESTIONS = ["Who approves exceptions?", "What if a step fails?", "What are the deadlines?"];
const BANK_SUGGESTIONS = ["What if the bank portal is down?", "Who can unlock the ledger?", "How does a new analyst get ERP access?"];
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "conflict", label: "Conflicts" },
  { key: "nocont", label: "No contingency" },
  { key: "leaver", label: "From leaver" },
  { key: "missing", label: "Source not found" },
  { key: "unsure", label: "Not sure" },
];
const SAMPLES = {
  fpna: { sop: "/samples/sop-fpna-month-end-close.txt", cases: "/samples/cases.txt" },
  ap: { sop: "/samples/sop-ap-vendor-invoices.txt", cases: "/samples/cases-ap-vendor-invoices.txt" },
};

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
function Ring({ percent, size = 96, stroke = 7, children }: { percent: number; size?: number; stroke?: number; children?: ReactNode }) {
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

function matchesFilter(r: Rule, f: Filter, review: Review): boolean {
  if (f === "all") return true;
  if (f === "conflict") return r.conflict;
  if (f === "nocont") return r.no_contingency;
  if (f === "leaver") return r.source === "leaver";
  if (f === "unsure") return review[r.id] === "unsure";
  return r.source_found === false;
}

function ruleClass(r: Rule): string {
  if (r.source_found === false) return "rule--missing";
  if (r.conflict) return "rule--conflict";
  return "";
}

// Turns "R6 conflicts with R7" into text where R6 and R7 are links that jump to those rules.
function RuleRefs({ text, ids, onGo }: { text: string; ids: Set<string>; onGo: (id: string) => void }) {
  return (
    <>
      {text.split(/(\bR\d+\b)/g).map((part, i) =>
        ids.has(part) ? (
          <button key={i} type="button" className="linklike ref" onClick={() => onGo(part)}>{part}</button>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

// The few lines of the user's own text around a quote, with the quote highlighted.
function Context({ quote, sop, cases }: { quote: string; sop: string; cases: string }) {
  const inSop = locateQuote(sop, quote);
  const inCases = inSop ? null : locateQuote(cases, quote);
  const range = inSop ?? inCases;
  if (!range) return <p className="note ctx">This quote was not found in your text.</p>;
  const c = contextAround(inSop ? sop : cases, range, 1, 1);
  return (
    <div className="ctx">
      <div className="ctx-label">In the {inSop ? "SOP" : "cases"}</div>
      <pre className="ctx-text">{c.before}<mark>{c.match}</mark>{c.after}</pre>
    </div>
  );
}

export default function Home() {
  const [sop, setSop] = useState("");
  const [cases, setCases] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [dropping, setDropping] = useState<"sop" | "cases" | null>(null);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [openCtx, setOpenCtx] = useState<Record<string, boolean>>({});
  const [hoverQ, setHoverQ] = useState<string | null>(null);
  const [leaverView, setLeaverView] = useState<"all" | "one">("all");
  const [cur, setCur] = useState(0);

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [review, setReview] = useState<Review>({});
  const [flashId, setFlashId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const [askText, setAskText] = useState("");
  const [askMode, setAskMode] = useState<AskMode>("sheet");
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [bankText, setBankText] = useState("");
  const [bankResult, setBankResult] = useState<BankResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [exportMsg, setExportMsg] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const [gapsError, setGapsError] = useState<Fail | null>(null);
  const [sheetError, setSheetError] = useState<Fail | null>(null);
  const [askError, setAskError] = useState<Fail | null>(null);
  const [bankError, setBankError] = useState<Fail | null>(null);

  const gapMessage = useCycle(GAP_MESSAGES, busy === "gaps");
  const sheetMessage = useCycle(SHEET_MESSAGES, busy === "sheet");
  const bank = useMemo(() => parseBank(bankText), [bankText]);

  useEffect(() => { if (questions.length > 0) scrollToSection("sec-gaps"); }, [questions.length]);
  useEffect(() => { if (sheet) scrollToSection("sec-sheet"); }, [sheet]);
  useEffect(() => { if (confirmed) scrollToSection("sec-ask"); }, [confirmed]);

  async function loadSample(which: keyof typeof SAMPLES = "fpna") {
    try {
      const [a, b] = await Promise.all([fetch(SAMPLES[which].sop), fetch(SAMPLES[which].cases)]);
      if (!a.ok || !b.ok) throw new Error("missing");
      setSop(await a.text());
      setCases(await b.text());
      setGapsError(null);
    } catch {
      setGapsError({ ok: false, message: "Couldn't load the sample." });
    }
  }

  async function loadBankSample() {
    try {
      const res = await fetch("/samples/question-bank.txt");
      if (!res.ok) throw new Error("missing");
      setBankText(await res.text());
      setBankError(null);
    } catch {
      setBankError({ ok: false, message: "Couldn't load the example bank." });
    }
  }

  // Put the text of a dropped or chosen file into one of the two boxes.
  async function takeFile(file: File | undefined, target: "sop" | "cases") {
    setDropping(null);
    if (!file) return;
    if (!/\.(txt|md|markdown|csv)$/i.test(file.name) && !file.type.startsWith("text/")) {
      setGapsError({ ok: false, message: "Only .txt or .md files can be dropped here. For other formats, copy the text and paste it." });
      return;
    }
    if (file.size > 200_000) {
      setGapsError({ ok: false, message: "That file is too large. Paste just the relevant part." });
      return;
    }
    const text = await file.text();
    if (target === "sop") setSop(text);
    else setCases(text);
    setGapsError(null);
  }
  const dropProps = (target: "sop" | "cases") => ({
    onDragOver: (e: DragEvent) => { e.preventDefault(); setDropping(target); },
    onDragLeave: () => setDropping(null),
    onDrop: (e: DragEvent) => { e.preventDefault(); takeFile(e.dataTransfer.files[0], target); },
  });

  async function findGaps() {
    setQuestions([]); setAnswers({}); setSheet(null); setConfirmed(false); setAskResult(null); setBankResult(null);
    setSheetError(null); setAskError(null); setBankError(null);
    setReview({}); setHistory([]); setOpenCtx({}); setCur(0);
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
    setSheet(null); setConfirmed(false); setAskResult(null); setBankResult(null); setSheetError(null); setFilter("all");
    setReview({}); setHistory([]);
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
    if (res.ok) {
      setAskResult(res);
      setHistory((h) => [{ mode: "sheet" as const, question: askText, answer: res.answer, hit: res.captured }, ...h].slice(0, 10));
    } else setAskError(res);
  }

  async function askBank() {
    setBankResult(null); setBankError(null);
    if (bank.entries.length === 0) {
      setBankError({ ok: false, message: "Load a question bank first, or paste your own below." });
      return;
    }
    setBusy("ask");
    const res = await post<{ ok: true } & BankResult>("/api/bank", { question: askText, entries: bank.entries });
    setBusy(null);
    if (res.ok) {
      setBankResult(res);
      setHistory((h) => [{ mode: "bank" as const, question: askText, answer: res.answer, hit: res.found }, ...h].slice(0, 10));
    } else setBankError(res);
  }

  function submitAsk() {
    if (askMode === "sheet") ask();
    else askBank();
  }

  // From a "not captured" answer: try the same question against the team question bank.
  function tryBank() {
    setAskMode("bank");
    if (bank.entries.length > 0) askBank();
  }

  // Jump to a rule and flash it, so a reference like "R6" is something you can click.
  function goToRule(id: string) {
    setFilter("all");
    setFlashId(id);
    setTimeout(() => document.getElementById(`rule-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    setTimeout(() => setFlashId(null), 1800);
  }

  function jumpToQuestion(index: number) {
    setCur(index);
    if (leaverView === "all") {
      const id = questions[index]?.id;
      setTimeout(() => {
        document.getElementById(`qi-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        document.getElementById(`a-${id}`)?.focus({ preventScroll: true });
      }, 60);
    }
  }

  // Ctrl+Enter in an answer box moves on to the next question.
  function nextOnCtrlEnter(e: KeyboardEvent, index: number) {
    if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
    e.preventDefault();
    if (index + 1 < questions.length) jumpToQuestion(index + 1);
    else document.getElementById("build")?.focus();
  }

  const ids = useMemo(() => new Set(sheet?.rules.map((r) => r.id) ?? []), [sheet]);
  const summary = sheet ? summarizeSheet(questions.length, sheet.rules, sheet.openGaps.length, sheet.inPerson.length) : null;
  const answeredNow = questions.filter((q) => (answers[q.id]?.text ?? "").trim() !== "").length;
  const inPersonNow = questions.filter((q) => answers[q.id]?.inPerson).length;
  const visibleRules = sheet ? sheet.rules.filter((r) => matchesFilter(r, filter, review)) : [];
  const filterCount = (f: Filter) => (sheet ? sheet.rules.filter((r) => matchesFilter(r, f, review)).length : 0);
  const okCount = sheet ? sheet.rules.filter((r) => review[r.id] === "ok").length : 0;
  const unsureCount = sheet ? sheet.rules.filter((r) => review[r.id] === "unsure").length : 0;

  function toggleReview(id: string, value: "ok" | "unsure") {
    setReview((prev) => {
      const next = { ...prev };
      if (next[id] === value) delete next[id];
      else next[id] = value;
      return next;
    });
  }

  function sheetMarkdown(): string {
    if (!sheet || !summary) return "";
    const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    return sheetToMarkdown(sheet.rules, sheet.openGaps, sheet.inPerson, summary, date, review);
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
  const done = [questions.length > 0, !!sheet, confirmed, !!(askResult || bankResult)];
  const currentStep = done.findIndex((d) => !d);
  const steps = [
    { id: "sec-input", label: "Paste", enabled: true },
    { id: "sec-gaps", label: "Review gaps", enabled: questions.length > 0 },
    { id: "sec-sheet", label: "Rules sheet", enabled: !!sheet },
    { id: "sec-ask", label: "Ask the bot", enabled: confirmed },
  ];
  const dockPercent = questions.length ? Math.round((answeredNow / questions.length) * 100) : 0;
  const askErr = askMode === "sheet" ? askError : bankError;
  const one = questions[Math.min(cur, Math.max(questions.length - 1, 0))];

  function answerItem(q: Question, index: number) {
    const a = answers[q.id];
    const isAnswered = (a?.text ?? "").trim() !== "";
    return (
      <div
        id={`qi-${q.id}`}
        className={`item${isAnswered ? " is-answered" : ""}${a?.inPerson ? " is-inperson" : ""}${hoverQ === q.id ? " linked" : ""}`}
        key={q.id}
        onMouseEnter={() => setHoverQ(q.id)}
        onMouseLeave={() => setHoverQ(null)}
      >
        <label htmlFor={`a-${q.id}`}><span className="dot" aria-hidden="true" />{q.id}. {q.question}</label>
        <textarea
          id={`a-${q.id}`}
          rows={2}
          value={a?.text ?? ""}
          onChange={(e) => setAnswer(q.id, { text: e.target.value })}
          onFocus={() => setHoverQ(q.id)}
          onKeyDown={(e) => nextOnCtrlEnter(e, index)}
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
  }

  return (
    <>
      <header className="hero">
        <div className="wrap">
          <h1>Continuity</h1>
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
        <section className="card" id="sec-input">
          <h2>1. The handover documents</h2>
          {questions.length === 0 && busy !== "gaps" && (
            <p className="how">
              Paste your own, drop a .txt or .md file onto a box, or try a sample scenario:{" "}
              <button type="button" className="linklike" onClick={() => loadSample("fpna")}>Month-end close (finance)</button>
              {" · "}
              <button type="button" className="linklike" onClick={() => loadSample("ap")}>Vendor invoices (accounts payable)</button>
            </p>
          )}
          <div className="field-meta">
            <label htmlFor="sop">SOP</label>
            <span className="count">
              {sop.length.toLocaleString()} characters{sop.trim().length < 200 ? " · at least 200 needed" : ""}
              {" · "}
              <label className="file-pick">choose a file
                <input type="file" accept=".txt,.md,.markdown,.csv,text/plain" onChange={(e) => { takeFile(e.target.files?.[0], "sop"); e.target.value = ""; }} />
              </label>
            </span>
          </div>
          <textarea
            id="sop"
            className={dropping === "sop" ? "dropping" : ""}
            rows={9}
            value={sop}
            onChange={(e) => setSop(e.target.value)}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && busy === null) { e.preventDefault(); findGaps(); } }}
            placeholder="Paste the SOP here, or drop a .txt or .md file"
            {...dropProps("sop")}
          />
          <div className="field-meta">
            <label htmlFor="cases">2–3 real cases</label>
            <span className="count">
              {cases.length.toLocaleString()} characters
              {" · "}
              <label className="file-pick">choose a file
                <input type="file" accept=".txt,.md,.markdown,.csv,text/plain" onChange={(e) => { takeFile(e.target.files?.[0], "cases"); e.target.value = ""; }} />
              </label>
            </span>
          </div>
          <textarea
            id="cases"
            className={dropping === "cases" ? "dropping" : ""}
            rows={6}
            value={cases}
            onChange={(e) => setCases(e.target.value)}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && busy === null) { e.preventDefault(); findGaps(); } }}
            placeholder="Paste real cases here (optional but helpful)"
            {...dropProps("cases")}
          />
          <div className="row">
            <button onClick={findGaps} disabled={busy !== null}>
              {busy === "gaps" ? <><Spinner />Finding gaps…</> : "Find gaps"}
            </button>
            <button className="secondary" onClick={() => loadSample("fpna")} disabled={busy !== null}>Load sample</button>
            <span className="note">Tip: Ctrl+Enter in a box does the same. It usually takes 5 to 20 seconds.</span>
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
                <div
                  className={`item q${hoverQ === q.id ? " linked" : ""}`}
                  key={q.id}
                  onMouseEnter={() => setHoverQ(q.id)}
                  onMouseLeave={() => setHoverQ(null)}
                >
                  <strong>{q.id}. {q.question}</strong>
                  <blockquote>
                    <span className="mark">“{q.quote}”</span>{" "}
                    {q.source_found === false && <Badge color="red">source not found</Badge>}
                  </blockquote>
                  <div className="why">{q.why_it_matters}</div>
                  <button
                    type="button"
                    className="linklike small"
                    aria-expanded={!!openCtx[q.id]}
                    onClick={() => setOpenCtx((o) => ({ ...o, [q.id]: !o[q.id] }))}
                  >
                    {openCtx[q.id] ? "Hide context" : "Show in context"}
                  </button>
                  {openCtx[q.id] && <Context quote={q.quote} sop={sop} cases={cases} />}
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
              <div className="tabs" role="group" aria-label="How to answer">
                <button type="button" className={`chip${leaverView === "all" ? " on" : ""}`} aria-pressed={leaverView === "all"} onClick={() => setLeaverView("all")}>All questions</button>
                <button type="button" className={`chip${leaverView === "one" ? " on" : ""}`} aria-pressed={leaverView === "one"} onClick={() => setLeaverView("one")}>One at a time</button>
              </div>
              <div className="qnav no-print" role="group" aria-label="Jump to a question">
                {questions.map((q, i) => {
                  const a = answers[q.id];
                  const state = a?.inPerson ? " inperson" : (a?.text ?? "").trim() !== "" ? " answered" : "";
                  return (
                    <button
                      key={q.id}
                      type="button"
                      className={`qdot${state}${leaverView === "one" && i === cur ? " current" : ""}`}
                      title={`${q.id}: ${q.question}`}
                      aria-label={`Go to question ${i + 1}`}
                      onClick={() => jumpToQuestion(i)}
                      onMouseEnter={() => setHoverQ(q.id)}
                      onMouseLeave={() => setHoverQ(null)}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>

              {leaverView === "all" ? (
                questions.map((q, i) => answerItem(q, i))
              ) : (
                one && (
                  <>
                    {answerItem(one, cur)}
                    <div className="row">
                      <button type="button" className="secondary" disabled={cur === 0} onClick={() => setCur((c) => Math.max(0, c - 1))}>Previous</button>
                      <button type="button" className="secondary" disabled={cur >= questions.length - 1} onClick={() => setCur((c) => Math.min(questions.length - 1, c + 1))}>Next</button>
                      <span className="note">{cur + 1} of {questions.length}{cur >= questions.length - 1 ? " · that was the last one" : " · Ctrl+Enter also moves on"}</span>
                    </div>
                  </>
                )
              )}

              <div className="row">
                <button id="build" onClick={buildSheet} disabled={busy !== null}>
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
          <section className="card print-sheet" id="sec-sheet">
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
              Tags marked AI-flagged are the AI&apos;s judgement. Check them against the quote beside each rule, and mark each rule as you go.
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
            <p className="note no-print" role="status" id="review-count">
              Your review: {okCount} look right · {unsureCount} not sure · {sheet.rules.length - okCount - unsureCount} not yet looked at
            </p>

            {visibleRules.length === 0 && <p className="note">No rules match this filter.</p>}
            {visibleRules.map((r) => (
              <div className={`item rule ${ruleClass(r)}${flashId === r.id ? " flash" : ""}`} id={`rule-${r.id}`} key={r.id}>
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
                {r.conflict && r.conflict_note && (
                  <div className="why">Conflict: <RuleRefs text={r.conflict_note} ids={ids} onGo={goToRule} /></div>
                )}
                <div className="review no-print" role="group" aria-label={`Your review of ${r.id}`}>
                  <button type="button" className={`mini${review[r.id] === "ok" ? " on-ok" : ""}`} aria-pressed={review[r.id] === "ok"} onClick={() => toggleReview(r.id, "ok")}>Looks right</button>
                  <button type="button" className={`mini${review[r.id] === "unsure" ? " on-unsure" : ""}`} aria-pressed={review[r.id] === "unsure"} onClick={() => toggleReview(r.id, "unsure")}>Not sure</button>
                </div>
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
          <section className="card" id="sec-ask">
            <h2>4. Ask the bot</h2>
            <div className="tabs" role="tablist" aria-label="Where the bot looks">
              <button type="button" role="tab" aria-selected={askMode === "sheet"} className={`chip${askMode === "sheet" ? " on" : ""}`} onClick={() => setAskMode("sheet")}>Rules sheet</button>
              <button type="button" role="tab" aria-selected={askMode === "bank"} className={`chip${askMode === "bank" ? " on" : ""}`} onClick={() => setAskMode("bank")}>Team question bank</button>
            </div>
            <p className="note">
              {askMode === "sheet"
                ? "It answers only from the confirmed rules above."
                : "For questions the SOP does not cover. It answers from past questions between colleagues. This is unofficial: it is not from the SOP."}
            </p>

            {askMode === "bank" && (
              <div className="bank">
                <label htmlFor="bank">Question bank</label>
                <textarea
                  id="bank"
                  rows={7}
                  value={bankText}
                  onChange={(e) => setBankText(e.target.value)}
                  placeholder={"Q: What if the portal is down?\nA: Call the bank's desk.\nBy: Rohan, FP&A analyst\nDate: 4 Sep 2026\n\n(one blank line between entries)"}
                />
                <div className="row">
                  <button type="button" className="secondary" onClick={loadBankSample}>Load example bank</button>
                  {bankText && <button type="button" className="secondary" onClick={() => { setBankText(""); setBankResult(null); }}>Clear</button>}
                  <span className="note" role="status">
                    {bank.entries.length} {bank.entries.length === 1 ? "entry" : "entries"} loaded
                    {bank.skipped > 0 ? ` · ${bank.skipped} skipped (each needs a Q: and an A: line)` : ""}
                  </span>
                </div>
              </div>
            )}

            <label htmlFor="ask">Your question</label>
            <textarea
              id="ask"
              rows={2}
              value={askText}
              onChange={(e) => setAskText(e.target.value)}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && busy === null && askText.trim() !== "") { e.preventDefault(); submitAsk(); } }}
            />
            <div className="suggest">
              <span className="note">Try:</span>
              {(askMode === "sheet" ? SHEET_SUGGESTIONS : BANK_SUGGESTIONS).map((s) => (
                <button key={s} type="button" className="chip" onClick={() => setAskText(s)}>{s}</button>
              ))}
            </div>
            <div className="row">
              <button onClick={submitAsk} disabled={busy !== null || askText.trim() === ""}>
                {busy === "ask" ? <><Spinner />Thinking…</> : "Ask"}
              </button>
            </div>
            <ErrorBox error={askErr} />

            {askMode === "sheet" && askResult && (
              <>
                <div className={`item answer-card${askResult.captured ? "" : " not-captured"}`}>
                  <div className="answer">{askResult.answer}</div>
                  {askResult.captured && (
                    <>
                      <div className="note">
                        Cited:{" "}
                        {askResult.cited.map((r, i) => (
                          <span key={r.id}>{i > 0 ? ", " : ""}<button type="button" className="linklike ref" onClick={() => goToRule(r.id)}>{r.id}</button></span>
                        ))}
                      </div>
                      {askResult.cited.map((r) => (
                        <blockquote key={r.id}><strong>{r.id}:</strong> {r.rule}</blockquote>
                      ))}
                    </>
                  )}
                </div>
                {!askResult.captured && (
                  <p className="fallback note">
                    The sheet doesn&apos;t cover this. <button type="button" className="linklike" onClick={tryBank}>Search the team question bank</button>
                  </p>
                )}
              </>
            )}

            {askMode === "bank" && bankResult && (
              <div className={`item answer-card bank-card${bankResult.found ? "" : " not-captured"}`}>
                <div className="answer">{bankResult.answer}</div>
                {bankResult.found && (
                  <>
                    <div className="origin">From team Q&amp;A. Not the SOP.</div>
                    {bankResult.cited.map((e) => (
                      <blockquote key={e.id}>
                        <strong>{e.id}</strong> {e.question}<br />
                        {e.answer}
                        {(e.by || e.date) && <span className="by"> — {[e.by, e.date].filter(Boolean).join(", ")}</span>}
                      </blockquote>
                    ))}
                  </>
                )}
              </div>
            )}

            {history.length > 1 && (
              <details className="hist no-print">
                <summary>Earlier questions ({history.length - 1})</summary>
                <ul>
                  {history.slice(1).map((h, i) => (
                    <li key={i}>
                      <button type="button" className="linklike" onClick={() => { setAskMode(h.mode); setAskText(h.question); }}>{h.question}</button>
                      <span className="note"> · {h.mode === "bank" ? "bank" : "sheet"} · {h.hit ? h.answer.slice(0, 90) : h.answer}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}
      </main>

      {questions.length > 0 && (
        <a className="dock no-print" href={sheet ? "#sec-sheet" : "#sec-gaps"} aria-label={`Progress: ${answeredNow} of ${questions.length} questions answered`}>
          <Ring percent={dockPercent} size={48} stroke={5}>
            <span className="ring-pct">{dockPercent}%</span>
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
