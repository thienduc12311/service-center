import { useTranslation } from 'react-i18next';
import { Icon } from '../icons';
import { WIZARD_STEPS, WIZARD_STEP_LABEL_KEYS, type WizardStep } from './types';

export interface WizardProgressProps {
  current: WizardStep;
}

/** The three-dot rail above the wizard card; filled up to the current step. */
export const WizardProgress = ({ current }: WizardProgressProps) => {
  const { t } = useTranslation('teams');
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
                className={`absolute right-1/2 top-[13px] h-0.5 w-full ${
                  reached ? 'bg-brand-600' : 'bg-slate-200 dark:bg-slate-700'
                }`}
                aria-hidden="true"
              />
            )}
            <span
              className={`relative grid size-7 place-items-center rounded-full text-xs font-semibold tabular-nums ring-4 ring-app-canvas ${
                index < currentIndex
                  ? 'bg-brand-600 text-white'
                  : step === current
                    ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30'
                    : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
              }`}
              aria-hidden="true"
            >
              {index < currentIndex ? <Icon name="check" className="size-3.5" strokeWidth={2.5} /> : index + 1}
            </span>
            <span
              className={`mt-2 text-center text-xs sm:text-sm ${
                step === current ? 'font-semibold text-slate-900 dark:text-white' : reached ? 'text-slate-700 dark:text-slate-300' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {t(WIZARD_STEP_LABEL_KEYS[step])}
            </span>
          </li>
        );
      })}
    </ol>
  );
};
