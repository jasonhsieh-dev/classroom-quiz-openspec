export const LEGACY_QUESTION_PROMPT = "（舊活動未保存完整題目）";

interface VisibleQuestion {
  displayNumber: string;
  promptText?: string | null;
}

export function QuestionPresentation({
  question,
  headingLevel = 4,
  compact = false,
}: {
  question: VisibleQuestion;
  headingLevel?: 3 | 4;
  compact?: boolean;
}) {
  const promptText = question.promptText?.trim() || LEGACY_QUESTION_PROMPT;
  if (compact) {
    return <span className="question-presentation compact">
      <span className="question-number">題號 {question.displayNumber}</span>
      <span className="question-prompt">{promptText}</span>
    </span>;
  }
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return <div className="question-presentation">
    <Heading>題號 {question.displayNumber}</Heading>
    <p className="question-prompt">{promptText}</p>
  </div>;
}
