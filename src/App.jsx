import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase, getDeviceId } from "./supabaseClient";

/* ---------------------------------------------------------
   Design tokens — "technician's diagnostic panel"
--------------------------------------------------------- */
const T = {
  bg: "#0F1216",
  panel: "#171B21",
  panel2: "#1D222B",
  border: "#2A2F3A",
  text: "#ECEEF1",
  muted: "#8B93A3",
  amber: "#E8A23D",
  teal: "#3FA7A0",
  green: "#57B87D",
  red: "#E2635F",
  mono: "'IBM Plex Mono', 'SFMono-Regular', ui-monospace, monospace",
  sans: "'IBM Plex Sans', system-ui, -apple-system, sans-serif",
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// Map a Supabase `questions` row to the shape the UI uses.
function mapRow(row) {
  return {
    id: row.id,
    exam: row.exam,
    domain: row.domain,
    q: row.question,
    options: row.options,
    correct: row.correct_index,
    exp: row.explanation,
  };
}

/* ---------------------------------------------------------
   Main App
--------------------------------------------------------- */
export default function App() {
  const [view, setView] = useState("loading"); // loading | error | setup | quiz | results | dashboard | bookmarks
  const [loadError, setLoadError] = useState(null);
  const [examChoice, setExamChoice] = useState("mixed"); // core1 | core2 | mixed | bookmarked
  const [count, setCount] = useState(10);
  const [questions, setQuestions] = useState([]);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [current, setCurrent] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [history, setHistory] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const timerRef = useRef(null);
  const deviceId = useMemo(() => getDeviceId(), []);

  const DOMAINS = useMemo(() => [...new Set(questions.map(q => q.domain))], [questions]);

  // Load questions, history, and bookmarks from Supabase on first run
  useEffect(() => {
    (async () => {
      try {
        const { data: qRows, error: qErr } = await supabase.from("questions").select("*");
        if (qErr) throw qErr;
        if (!qRows || qRows.length === 0) {
          setLoadError(
            "No questions found in Supabase. Run supabase/schema.sql and supabase/seed.sql in your project's SQL Editor."
          );
          setView("error");
          return;
        }
        setQuestions(qRows.map(mapRow));

        const { data: hRows, error: hErr } = await supabase
          .from("quiz_history")
          .select("*")
          .eq("device_id", deviceId)
          .order("created_at", { ascending: true });
        if (hErr) throw hErr;
        setHistory(hRows || []);

        const { data: bRows, error: bErr } = await supabase
          .from("bookmarks")
          .select("question_id")
          .eq("device_id", deviceId);
        if (bErr) throw bErr;
        setBookmarks((bRows || []).map(r => r.question_id));

        setView("setup");
      } catch (e) {
        console.error(e);
        setLoadError(e.message || "Failed to load data from Supabase. Check your .env credentials.");
        setView("error");
      }
    })();
  }, [deviceId]);

  const toggleBookmark = useCallback(async (id) => {
    const isBookmarked = bookmarks.includes(id);
    setBookmarks(prev => isBookmarked ? prev.filter(x => x !== id) : [...prev, id]);
    try {
      if (isBookmarked) {
        await supabase.from("bookmarks").delete().eq("device_id", deviceId).eq("question_id", id);
      } else {
        await supabase.from("bookmarks").insert({ device_id: deviceId, question_id: id });
      }
    } catch (e) {
      console.error("Bookmark sync failed", e);
      setBookmarks(prev => isBookmarked ? [...prev, id] : prev.filter(x => x !== id));
    }
  }, [bookmarks, deviceId]);

  useEffect(() => {
    if (view !== "quiz") return;
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current);
          finishQuiz();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function startQuiz() {
    let pool;
    if (examChoice === "bookmarked") pool = questions.filter(q => bookmarks.includes(q.id));
    else if (examChoice === "mixed") pool = questions;
    else pool = questions.filter(q => q.exam === examChoice);

    if (pool.length === 0) return;
    const n = Math.min(count, pool.length);
    const picked = shuffle(pool).slice(0, n);
    const secs = n * 60;
    setQuizQuestions(picked);
    setAnswers({});
    setCurrent(0);
    setSecondsLeft(secs);
    setTotalSeconds(secs);
    setView("quiz");
  }

  function selectAnswer(idx) {
    const q = quizQuestions[current];
    if (answers[q.id] !== undefined) return;
    setAnswers(prev => ({ ...prev, [q.id]: idx }));
  }

  function goNext() {
    if (current < quizQuestions.length - 1) setCurrent(c => c + 1);
    else finishQuiz();
  }
  function goPrev() {
    if (current > 0) setCurrent(c => c - 1);
  }

  async function finishQuiz() {
    clearInterval(timerRef.current);
    setView("results");
    const domainStats = {};
    let correctCount = 0;
    quizQuestions.forEach(q => {
      const sel = answers[q.id];
      const isCorrect = sel === q.correct;
      if (isCorrect) correctCount++;
      if (!domainStats[q.domain]) domainStats[q.domain] = { correct: 0, total: 0 };
      domainStats[q.domain].total++;
      if (isCorrect) domainStats[q.domain].correct++;
    });
    const entry = {
      device_id: deviceId,
      exam: examChoice,
      score: correctCount,
      total: quizQuestions.length,
      domain_stats: domainStats,
    };
    try {
      const { data, error } = await supabase.from("quiz_history").insert(entry).select().single();
      if (error) throw error;
      setHistory(prev => [...prev, data]);
    } catch (e) {
      console.error("Failed to save quiz result", e);
      setHistory(prev => [...prev, { ...entry, created_at: new Date().toISOString() }]);
    }
  }

  function aggregateDomains() {
    const agg = {};
    DOMAINS.forEach(d => { agg[d] = { correct: 0, total: 0 }; });
    history.forEach(h => {
      Object.entries(h.domain_stats || {}).forEach(([d, s]) => {
        if (!agg[d]) agg[d] = { correct: 0, total: 0 };
        agg[d].correct += s.correct;
        agg[d].total += s.total;
      });
    });
    return agg;
  }

  return (
    <div style={{
      background: T.bg, color: T.text, minHeight: "100vh", fontFamily: T.sans,
      padding: "24px 16px calc(24px + env(safe-area-inset-bottom))", boxSizing: "border-box",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        html, body, #root { height: 100%; background: ${T.bg}; }
        button { font-family: inherit; cursor: pointer; }
        button:disabled { cursor: default; }
        button:focus-visible, label:focus-within { outline: 2px solid ${T.amber}; outline-offset: 2px; }
        ::selection { background: ${T.amber}; color: #14181C; }
      `}</style>

      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Header view={view} setView={setView} bookmarkCount={bookmarks.length} />

        {view === "loading" && (
          <div style={{ textAlign: "center", padding: "60px 0", color: T.muted, fontFamily: T.mono, fontSize: 13 }}>
            Connecting to Supabase…
          </div>
        )}

        {view === "error" && (
          <Panel style={{ borderColor: T.red }}>
            <div style={{ color: T.red, fontWeight: 700, marginBottom: 8 }}>Couldn't load data</div>
            <div style={{ color: T.muted, fontSize: 14, lineHeight: 1.6 }}>{loadError}</div>
          </Panel>
        )}

        {view === "setup" && (
          <SetupScreen
            examChoice={examChoice} setExamChoice={setExamChoice}
            count={count} setCount={setCount}
            onStart={startQuiz}
            totalQuestions={questions.length}
            bookmarkCount={bookmarks.length}
          />
        )}

        {view === "quiz" && quizQuestions.length > 0 && (
          <QuizScreen
            question={quizQuestions[current]}
            index={current}
            totalQ={quizQuestions.length}
            selected={answers[quizQuestions[current].id]}
            onSelect={selectAnswer}
            onNext={goNext}
            onPrev={goPrev}
            secondsLeft={secondsLeft}
            totalSeconds={totalSeconds}
            isBookmarked={bookmarks.includes(quizQuestions[current].id)}
            onToggleBookmark={() => toggleBookmark(quizQuestions[current].id)}
          />
        )}

        {view === "results" && (
          <ResultsScreen
            quizQuestions={quizQuestions}
            answers={answers}
            bookmarks={bookmarks}
            onToggleBookmark={toggleBookmark}
            onRestart={() => setView("setup")}
            onDashboard={() => setView("dashboard")}
          />
        )}

        {view === "dashboard" && (
          <Dashboard history={history} aggregateDomains={aggregateDomains} />
        )}

        {view === "bookmarks" && (
          <BookmarksScreen
            questions={questions}
            bookmarks={bookmarks}
            onToggleBookmark={toggleBookmark}
            onPractice={() => { setExamChoice("bookmarked"); setView("setup"); }}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Header / nav
--------------------------------------------------------- */
function Header({ view, setView, bookmarkCount }) {
  const navVisible = view !== "quiz" && view !== "loading" && view !== "error";
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: navVisible ? 16 : 28, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontFamily: T.mono, fontSize: 12, color: T.amber, letterSpacing: 1, marginBottom: 4 }}>
            A+ 220-1201 / 220-1202
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>Diagnostic Bench</div>
        </div>
      </div>
      {navVisible && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <NavButton active={view === "setup"} onClick={() => setView("setup")}>New quiz</NavButton>
          <NavButton active={view === "dashboard"} onClick={() => setView("dashboard")}>Weak areas</NavButton>
          <NavButton active={view === "bookmarks"} onClick={() => setView("bookmarks")}>
            Bookmarks{bookmarkCount > 0 ? ` (${bookmarkCount})` : ""}
          </NavButton>
        </div>
      )}
    </div>
  );
}

function NavButton({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: active ? T.panel2 : "transparent",
      border: `1px solid ${active ? T.teal : T.border}`,
      color: active ? T.teal : T.muted,
      borderRadius: 6, padding: "7px 13px", fontSize: 13,
    }}>
      {children}
    </button>
  );
}

/* ---------------------------------------------------------
   Setup Screen
--------------------------------------------------------- */
function SetupScreen({ examChoice, setExamChoice, count, setCount, onStart, totalQuestions, bookmarkCount }) {
  const examOptions = [
    { key: "core1", label: "Core 1", sub: "220-1201 · Hardware, Networking, Mobile" },
    { key: "core2", label: "Core 2", sub: "220-1202 · OS, Security, Software" },
    { key: "mixed", label: "Mixed", sub: "Both exams combined" },
  ];
  if (bookmarkCount > 0) {
    examOptions.push({ key: "bookmarked", label: "Bookmarked", sub: `${bookmarkCount} saved question${bookmarkCount === 1 ? "" : "s"}` });
  }
  const countOptions = [10, 20, 45];

  return (
    <div>
      <Panel>
        <SectionLabel>Select exam scope</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 10, marginTop: 10 }}>
          {examOptions.map(opt => (
            <button
              key={opt.key}
              onClick={() => setExamChoice(opt.key)}
              style={{
                textAlign: "left", padding: "14px 16px", borderRadius: 8,
                background: examChoice === opt.key ? T.panel2 : "transparent",
                border: `1px solid ${examChoice === opt.key ? T.amber : T.border}`,
                color: T.text,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 15 }}>{opt.label}</div>
              <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{opt.sub}</div>
            </button>
          ))}
        </div>
      </Panel>

      {examChoice !== "bookmarked" && (
        <Panel style={{ marginTop: 16 }}>
          <SectionLabel>Question count</SectionLabel>
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            {countOptions.map(c => (
              <button
                key={c}
                onClick={() => setCount(c)}
                style={{
                  padding: "10px 20px", borderRadius: 8,
                  background: count === c ? T.amber : "transparent",
                  border: `1px solid ${count === c ? T.amber : T.border}`,
                  color: count === c ? "#14181C" : T.text,
                  fontFamily: T.mono, fontWeight: 600, fontSize: 14,
                }}
              >
                {c >= totalQuestions ? `All (${totalQuestions})` : c}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 10, fontFamily: T.mono }}>
            Timer: 1 min / question · Feedback shown instantly after each answer
          </div>
        </Panel>
      )}

      <button
        onClick={onStart}
        style={{
          marginTop: 20, width: "100%", padding: "16px", borderRadius: 8,
          background: T.amber, border: "none", color: "#14181C",
          fontWeight: 700, fontSize: 16, letterSpacing: 0.2,
        }}
      >
        {examChoice === "bookmarked" ? "Practice bookmarked questions" : "Start timed quiz"}
      </button>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 13, color: T.muted, fontWeight: 500 }}>{children}</div>;
}

function Panel({ children, style }) {
  return (
    <div style={{
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10,
      padding: "18px 20px", ...style,
    }}>
      {children}
    </div>
  );
}

function BookmarkButton({ active, onClick, size = 14 }) {
  return (
    <button
      onClick={onClick}
      aria-label={active ? "Remove bookmark" : "Bookmark this question"}
      style={{
        background: "transparent", border: "none", padding: 4,
        color: active ? T.amber : T.muted, display: "flex", alignItems: "center", gap: 5,
        fontSize: 12, fontFamily: T.mono,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill={active ? T.amber : "none"} stroke={active ? T.amber : T.muted} strokeWidth="2">
        <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" strokeLinejoin="round" />
      </svg>
      {active ? "Saved" : "Save"}
    </button>
  );
}

/* ---------------------------------------------------------
   Quiz Screen — instant feedback on selection
--------------------------------------------------------- */
function QuizScreen({ question, index, totalQ, selected, onSelect, onNext, onPrev, secondsLeft, totalSeconds, isBookmarked, onToggleBookmark }) {
  const pct = totalSeconds > 0 ? secondsLeft / totalSeconds : 0;
  const low = pct < 0.15;
  const answered = selected !== undefined;
  const isCorrect = answered && selected === question.correct;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ fontFamily: T.mono, fontSize: 13, color: T.muted }}>
          Question {index + 1} / {totalQ}
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 22, fontWeight: 600, color: low ? T.red : T.text }}>
          {fmtTime(secondsLeft)}
        </div>
      </div>

      <div style={{ height: 4, background: T.border, borderRadius: 2, marginBottom: 22, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct * 100}%`, background: low ? T.red : T.teal, transition: "width 1s linear" }} />
      </div>

      <Panel>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.amber, letterSpacing: 0.5 }}>
            {question.exam === "core1" ? "CORE 1" : "CORE 2"} · {question.domain}
          </div>
          <BookmarkButton active={isBookmarked} onClick={onToggleBookmark} />
        </div>
        <div style={{ fontSize: 18, lineHeight: 1.5, marginBottom: 20, fontWeight: 500 }}>
          {question.q}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {question.options.map((opt, i) => {
            let bg = "transparent", border = T.border, color = T.text;
            if (answered) {
              if (i === question.correct) { bg = "rgba(87,184,125,0.12)"; border = T.green; color = T.green; }
              else if (i === selected) { bg = "rgba(226,99,95,0.12)"; border = T.red; color = T.red; }
              else { color = T.muted; }
            }
            return (
              <button
                key={i}
                onClick={() => onSelect(i)}
                disabled={answered}
                style={{
                  textAlign: "left", padding: "13px 16px", borderRadius: 8,
                  background: bg, border: `1px solid ${border}`, color,
                  fontSize: 14.5, display: "flex", gap: 12, alignItems: "center",
                  opacity: answered && i !== selected && i !== question.correct ? 0.6 : 1,
                }}
              >
                <span style={{ fontFamily: T.mono, fontSize: 12, width: 18, flexShrink: 0, color: "inherit", opacity: 0.7 }}>
                  {String.fromCharCode(65 + i)}
                </span>
                {opt}
                {answered && i === question.correct && <span style={{ marginLeft: "auto", fontSize: 12 }}>✓</span>}
                {answered && i === selected && i !== question.correct && <span style={{ marginLeft: "auto", fontSize: 12 }}>✕</span>}
              </button>
            );
          })}
        </div>

        {answered && (
          <div style={{
            marginTop: 16, padding: "14px 16px", borderRadius: 8,
            background: T.panel2, border: `1px solid ${isCorrect ? T.green : T.red}`,
          }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: isCorrect ? T.green : T.red, marginBottom: 6 }}>
              {isCorrect ? "Correct" : "Not quite"}
            </div>
            <div style={{ fontSize: 13.5, color: T.muted, lineHeight: 1.5 }}>{question.exp}</div>
          </div>
        )}
      </Panel>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
        <button
          onClick={onPrev}
          disabled={index === 0}
          style={{ padding: "12px 20px", borderRadius: 8, background: "transparent", border: `1px solid ${T.border}`, color: index === 0 ? T.border : T.muted }}
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!answered}
          style={{
            padding: "12px 24px", borderRadius: 8,
            background: answered ? T.amber : T.border,
            border: "none", color: answered ? "#14181C" : T.muted, fontWeight: 700,
          }}
        >
          {index === totalQ - 1 ? "Finish quiz" : "Next question"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Results Screen
--------------------------------------------------------- */
function ResultsScreen({ quizQuestions, answers, bookmarks, onToggleBookmark, onRestart, onDashboard }) {
  let correct = 0;
  const rows = quizQuestions.map(q => {
    const sel = answers[q.id];
    const isCorrect = sel === q.correct;
    if (isCorrect) correct++;
    return { q, sel, isCorrect };
  });
  const pct = Math.round((correct / quizQuestions.length) * 100);
  const passColor = pct >= 80 ? T.green : pct >= 60 ? T.amber : T.red;

  return (
    <div>
      <Panel style={{ textAlign: "center", padding: "28px 20px" }}>
        <div style={{ fontFamily: T.mono, fontSize: 12, color: T.muted, marginBottom: 8 }}>SCORE</div>
        <div style={{ fontFamily: T.mono, fontSize: 48, fontWeight: 700, color: passColor, lineHeight: 1 }}>{pct}%</div>
        <div style={{ fontSize: 14, color: T.muted, marginTop: 8 }}>{correct} of {quizQuestions.length} correct</div>
      </Panel>

      <div style={{ display: "flex", gap: 10, margin: "16px 0" }}>
        <button onClick={onDashboard} style={{ flex: 1, padding: "13px", borderRadius: 8, background: "transparent", border: `1px solid ${T.teal}`, color: T.teal, fontWeight: 600 }}>
          View weak areas
        </button>
        <button onClick={onRestart} style={{ flex: 1, padding: "13px", borderRadius: 8, background: T.amber, border: "none", color: "#14181C", fontWeight: 700 }}>
          New quiz
        </button>
      </div>

      <SectionLabel>Review</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        {rows.map(({ q, sel, isCorrect }) => (
          <Panel key={q.id} style={{ borderColor: isCorrect ? T.border : "#4A2A2A" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <div style={{ fontFamily: T.mono, fontSize: 11, color: T.amber }}>
                {q.exam === "core1" ? "CORE 1" : "CORE 2"} · {q.domain}
              </div>
              <BookmarkButton active={bookmarks.includes(q.id)} onClick={() => onToggleBookmark(q.id)} />
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 500, marginBottom: 8 }}>{q.q}</div>
            <div style={{ fontSize: 13.5, color: isCorrect ? T.green : T.red, marginBottom: 4 }}>
              Your answer: {sel !== undefined ? q.options[sel] : "(skipped)"}
            </div>
            {!isCorrect && (
              <div style={{ fontSize: 13.5, color: T.green, marginBottom: 8 }}>
                Correct answer: {q.options[q.correct]}
              </div>
            )}
            <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5 }}>{q.exp}</div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Bookmarks Screen
--------------------------------------------------------- */
function BookmarksScreen({ questions, bookmarks, onToggleBookmark, onPractice }) {
  const saved = questions.filter(q => bookmarks.includes(q.id));

  if (saved.length === 0) {
    return (
      <Panel style={{ textAlign: "center", padding: "36px 20px" }}>
        <div style={{ fontSize: 15, color: T.muted }}>No bookmarked questions yet.</div>
        <div style={{ fontSize: 13, color: T.muted, marginTop: 6 }}>
          Tap "Save" on any question during a quiz to review it here later.
        </div>
      </Panel>
    );
  }

  return (
    <div>
      <button onClick={onPractice} style={{
        width: "100%", padding: "14px", borderRadius: 8, background: T.amber,
        border: "none", color: "#14181C", fontWeight: 700, fontSize: 15, marginBottom: 16,
      }}>
        Practice these {saved.length} question{saved.length === 1 ? "" : "s"}
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {saved.map(q => (
          <Panel key={q.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <div style={{ fontFamily: T.mono, fontSize: 11, color: T.amber }}>
                {q.exam === "core1" ? "CORE 1" : "CORE 2"} · {q.domain}
              </div>
              <BookmarkButton active={true} onClick={() => onToggleBookmark(q.id)} />
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 500, marginBottom: 8 }}>{q.q}</div>
            <div style={{ fontSize: 13.5, color: T.green, marginBottom: 8 }}>
              Correct answer: {q.options[q.correct]}
            </div>
            <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5 }}>{q.exp}</div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Dashboard — weak-area tracking over time
--------------------------------------------------------- */
function Dashboard({ history, aggregateDomains }) {
  const agg = aggregateDomains();
  const rows = Object.entries(agg)
    .filter(([, s]) => s.total > 0)
    .map(([domain, s]) => ({ domain, pct: Math.round((s.correct / s.total) * 100), ...s }))
    .sort((a, b) => a.pct - b.pct);

  if (history.length === 0) {
    return (
      <Panel style={{ textAlign: "center", padding: "36px 20px" }}>
        <div style={{ fontSize: 15, color: T.muted }}>No quiz history yet.</div>
        <div style={{ fontSize: 13, color: T.muted, marginTop: 6 }}>Finish a quiz to start tracking your weak areas.</div>
      </Panel>
    );
  }

  return (
    <div>
      <Panel>
        <SectionLabel>Sessions completed</SectionLabel>
        <div style={{ fontFamily: T.mono, fontSize: 28, fontWeight: 700, marginTop: 6 }}>{history.length}</div>
      </Panel>

      <div style={{ marginTop: 16 }}>
        <SectionLabel>Performance by domain (all-time)</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {rows.map(r => (
            <Panel key={r.domain} style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 14 }}>{r.domain}</span>
                <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 600, color: r.pct >= 80 ? T.green : r.pct >= 60 ? T.amber : T.red }}>
                  {r.pct}% ({r.correct}/{r.total})
                </span>
              </div>
              <div style={{ height: 6, background: T.border, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${r.pct}%`, background: r.pct >= 80 ? T.green : r.pct >= 60 ? T.amber : T.red }} />
              </div>
            </Panel>
          ))}
        </div>
      </div>

      {rows.length > 0 && rows[0].pct < 70 && (
        <Panel style={{ marginTop: 16, borderColor: T.amber }}>
          <div style={{ fontSize: 13, color: T.amber, fontWeight: 600, marginBottom: 4 }}>Focus next</div>
          <div style={{ fontSize: 13.5, color: T.muted }}>
            {rows[0].domain} is your weakest area at {rows[0].pct}%. Consider a focused review before your next full quiz.
          </div>
        </Panel>
      )}
    </div>
  );
}
