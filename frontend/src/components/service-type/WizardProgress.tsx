import { WIZARD_STEPS, WIZARD_STEP_LABELS, type WizardStep } from './types';

export interface WizardProgressProps {
  current: WizardStep;
}

/** The three-dot rail above the wizard card; filled up to the current step. */
export const WizardProgress = ({ current }: WizardProgressProps) => {
  const currentIndex = WIZARD_STEPS.indexOf(current);

  return (
    <ol className="mx-auto mb-8 flex max-w-lg items-start">
      {WIZARD_STEPS.map((step, index) => {
        const reached = index <= currentIndex;
        return (
          <li
            key={step}
            className="relative flex flex-1 flex-col items-center"
            aria-current={step === current ? 'step' : undefined}
          >
            {index > 0 && (
              <span
                className={`absolute right-1/2 top-[7px] h-0.5 w-full ${
                  reached ? 'bg-emerald-600' : 'bg-slate-200'
                }`}
                aria-hidden="true"
              />
            )}
            <span
              className={`size-3.5 rounded-full ${reached ? 'bg-emerald-600' : 'bg-slate-300'}`}
              aria-hidden="true"
            />
            <span
              className={`mt-2 text-sm ${
                step === current ? 'font-medium text-slate-900' : 'text-slate-500'
              }`}
            >
              {WIZARD_STEP_LABELS[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
};
