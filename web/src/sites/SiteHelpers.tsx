import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Notice, useAction, type Row, type T } from "./shared";

export function Interview({
  siteId,
  runs,
  t,
  canEdit,
}: {
  siteId: string;
  runs: Row[];
  t: T;
  canEdit: boolean;
}) {
  const run = runs.find(
      (r) => r.step === "interview" && r.status === "succeeded",
    ),
    questions = run?.steps[0]?.output?.questions ?? [],
    [answers, setAnswers] = useState<Record<string, string>>({}),
    [saved, setSaved] = useState(false),
    a = useAction();
  return (
    <section className="catalog-panel">
      <div className="sites-dialogue" role="log" aria-label={t("interview")}>
        {!questions.length ? (
          <p className="muted">{t("empty")}</p>
        ) : (
          questions.map((q: Row) => (
            <article key={q.id}>
              <p className="sites-question">{q.question}</p>
              <label>
                {t("answer")}
                <textarea
                  aria-label={t("answer")}
                  rows={3}
                  maxLength={800}
                  disabled={!canEdit}
                  value={answers[q.id] ?? ""}
                  onChange={(e) =>
                    setAnswers((old) => ({ ...old, [q.id]: e.target.value }))
                  }
                />
              </label>
            </article>
          ))
        )}
      </div>
      {canEdit && questions.length > 0 && (
        <button
          disabled={a.busy || !Object.values(answers).some((v) => v.trim())}
          onClick={() =>
            void a.run(async () => {
              await api("/sites/" + siteId + "/interview/answers", "POST", {
                runId: run!.id,
                answers: questions
                  .filter((q: Row) => answers[q.id]?.trim())
                  .map((q: Row) => ({
                    questionId: q.id,
                    answer: answers[q.id].trim(),
                  })),
              });
              setSaved(true);
            })
          }
        >
          {t("submitAnswers")}
        </button>
      )}
      <Notice t={t} error={a.error} />
      {saved && (
        <p className="notice success" role="status">
          {t("candidatesSaved")}
        </p>
      )}
    </section>
  );
}
export function IssueList({ issues, t }: { issues: Row[]; t: T }) {
  return issues.length ? (
    <ul className="sites-issues" role="list">
      {issues.map((i, index) => (
        <li key={index}>
          {t(i.code)}
          {i.token ? " · " + i.token : ""}
        </li>
      ))}
    </ul>
  ) : null;
}
export function RefPicker({
  refs,
  facts,
  t,
  onChange,
  disabled,
}: {
  refs: Row[];
  facts: Row[];
  t: T;
  onChange: (refs: Row[]) => void;
  disabled?: boolean;
}) {
  return (
    <details className="sites-refs">
      <summary>
        {t("factRefs")} ({refs.length})
      </summary>
      <div className="sites-choice-list">
        {!facts.length && (
          <p>
            {t("noFacts")} <Link to="/facts">{t("facts")}</Link>
          </p>
        )}
        {refs
          .filter(
            (r) =>
              !facts.some(
                (f) => f.id === r.factId && f.revision === r.revision,
              ),
          )
          .map((r) => (
            <label key={r.factId} className="catalog-check">
              <input
                disabled={disabled}
                type="checkbox"
                checked
                onChange={() =>
                  onChange(refs.filter((x) => x.factId !== r.factId))
                }
              />
              {t("stale")} {r.factId}
            </label>
          ))}
        {facts.map((f) => (
          <label key={f.id} className="catalog-check">
            <input
              disabled={disabled}
              type="checkbox"
              checked={refs.some(
                (r) => r.factId === f.id && r.revision === f.revision,
              )}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [
                        ...refs.filter((r) => r.factId !== f.id),
                        { factId: f.id, revision: f.revision },
                      ]
                    : refs.filter((r) => r.factId !== f.id),
                )
              }
            />
            <span>
              <strong>
                {f.value}
                {f.unit ? " " + f.unit : ""}
              </strong>
              <small>{f.type}</small>
              <small>
                {t("sourceQuote")}: {f.source.quote}
              </small>
            </span>
          </label>
        ))}
      </div>
    </details>
  );
}
