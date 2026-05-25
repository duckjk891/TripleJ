import './StepIndicator.css';

export default function StepIndicator({ steps, current }) {
  return (
    <ol className="step-indicator" aria-label="진행 단계">
      {steps.map((label, idx) => {
        const stepNo = idx + 1;
        const isCurrent = stepNo === current;
        const isDone = stepNo < current;
        const cls = ['step-indicator__item'];
        if (isCurrent) cls.push('is-current');
        if (isDone) cls.push('is-done');
        return (
          <li key={label + idx} className={cls.join(' ')}>
            <span className="step-indicator__dot" aria-hidden="true">
              {stepNo}
            </span>
            <span className="step-indicator__label">{label}</span>
            {idx < steps.length - 1 && (
              <span className="step-indicator__line" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
