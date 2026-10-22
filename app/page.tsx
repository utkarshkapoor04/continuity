"use client";

import { useState, type ReactNode } from "react";
import { checkInput } from "../lib/validate";
import type { Answers, FlaggedQuestion, Question, Rule } from "../lib/types";

type Fail = { ok: false; message: string; detail?: string };
type Busy = "gaps" | "sheet" | "ask" | null;
type Sheet = { rules: Rule[]; openGaps: FlaggedQuestion[]; inPerson: FlaggedQuestion[] };
type AskResult = { captured: boolean; answer: string; cited: Rule[] };

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

function Badge({ color, children }: { color: "red" | "amber" | "blue" | "grey"; children: ReactNode }) {
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

  const [gapsError, setGapsError] = useState<Fail | null>(null);
  const [sheetError, setSheetError] = useState<Fail | null>(null);
  const [askError, setAskError] = useState<Fail | null>(null);

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
    setSheet(null); setConfirmed(false); setAskResult(null); setSheetError(null);
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

  return (
    <main>
      <h1>Continuity</h1>
      <p className="tagline">Paste the handover SOP and a few real cases. Find what they don&apos;t say.</p>

      <section className="card">
        <h2>1. The handover documents</h2>
        <label htmlFor="sop">SOP</label>
        <textarea id="sop" rows={9} value={sop} onChange={(e) => setSop(e.target.value)} placeholder="Paste the SOP here" />
        <label htmlFor="cases">2–3 real cases</label>
        <textarea id="cases" rows={6} value={cases} onChange={(e) => setCases(e.target.value)} placeholder="Paste real cases here (optional but helpful)" />
        <div className="row">
          <button onClick={findGaps} disabled={busy !== null}>
            {busy === "gaps" ? "Finding gaps…" : "Find gaps"}
          </button>
          <button className="secondary" onClick={loadSample} disabled={busy !== null}>Load sample</button>
          {busy === "gaps" && <span className="note">This can take up to 20 seconds.</span>}
        </div>
        <ErrorBox error={gapsError} />
      </section>

      {questions.length > 0 && (
        <>
          <div className="grid2">
            <section className="card">
              <h2>2. Gaps found: questions for the leaver</h2>
              <p className="note">Suggested by AI, so it is not a complete list. Each quote is checked against your text.</p>
              {questions.length < 5 && <p className="note">Only {questions.length} gaps found for this text.</p>}
              {questions.map((q) => (
                <div className="item" key={q.id}>
                  <strong>{q.id}. {q.question}</strong>
                  <blockquote>
                    “{q.quote}”{" "}
                    {q.source_found === false && <Badge color="red">source not found</Badge>}
                  </blockquote>
                  <div className="why">Why it matters: {q.why_it_matters}</div>
                </div>
              ))}
            </section>

            <section className="card">
              <h2>Leaver</h2>
              <p className="note">Answer what you can. Leave the rest blank, or tick &quot;needs in-person&quot;.</p>
              {questions.map((q) => (
                <div className="item" key={q.id}>
                  <label htmlFor={`a-${q.id}`}>{q.id}. {q.question}</label>
                  <textarea
                    id={`a-${q.id}`}
                    rows={2}
                    value={answers[q.id]?.text ?? ""}
                    onChange={(e) => setAnswer(q.id, { text: e.target.value })}
                  />
                  <label className="note">
                    <input
                      type="checkbox"
                      checked={answers[q.id]?.inPerson ?? false}
                      onChange={(e) => setAnswer(q.id, { inPerson: e.target.checked })}
                    />{" "}
                    needs in-person
                  </label>
                </div>
              ))}
              <div className="row">
                <button onClick={buildSheet} disabled={busy !== null}>
                  {busy === "sheet" ? "Building…" : "Build rules sheet"}
                </button>
                {busy === "sheet" && <span className="note">This can take up to 30 seconds.</span>}
              </div>
              <ErrorBox error={sheetError} />
            </section>
          </div>
        </>
      )}

      {sheet && (
        <section className="card">
          <h2>3. Rules sheet</h2>
          <p className="note">
            Tags marked AI-flagged are the AI&apos;s judgement. Check them against the quote beside each rule.
          </p>
          {sheet.rules.map((r) => (
            <div className="item" key={r.id}>
              <strong>{r.id}.</strong> {r.rule}{" "}
              <Badge color="grey">{r.source === "SOP" ? "from SOP" : "from leaver"}</Badge>
              {r.source_found === false && <Badge color="red">source not found</Badge>}
              {r.added_as_written && <Badge color="grey">added as written</Badge>}
              {r.conflict && <Badge color="red">AI-flagged: conflict</Badge>}
              {r.no_contingency && <Badge color="amber">AI-flagged: no contingency documented</Badge>}
              {r.question_id && sheet.inPerson.some((p) => p.id === r.question_id) && (
                <Badge color="blue">needs in-person</Badge>
              )}
              <blockquote>“{r.quote}”</blockquote>
              {r.conflict && r.conflict_note && <div className="why">Conflict: {r.conflict_note}</div>}
            </div>
          ))}

          <h2 style={{ marginTop: 16 }}>Open gaps (unanswered)</h2>
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
              <h2 style={{ marginTop: 16 }}>Needs in-person</h2>
              {sheet.inPerson.map((g) => (
                <div className="item" key={g.id}>{g.id}. {g.question}</div>
              ))}
            </>
          )}

          <div className="row">
            {!confirmed ? (
              <button onClick={() => setConfirmed(true)}>Confirm sheet</button>
            ) : (
              <Badge color="blue">Sheet confirmed</Badge>
            )}
          </div>
        </section>
      )}

      {sheet && confirmed && (
        <section className="card">
          <h2>4. Ask the bot</h2>
          <p className="note">It answers only from the confirmed rules above.</p>
          <label htmlFor="ask">Your question</label>
          <textarea id="ask" rows={2} value={askText} onChange={(e) => setAskText(e.target.value)} />
          <div className="row">
            <button onClick={ask} disabled={busy !== null || askText.trim() === ""}>
              {busy === "ask" ? "Thinking…" : "Ask"}
            </button>
          </div>
          <ErrorBox error={askError} />
          {askResult && (
            <div className="item">
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
  );
}
