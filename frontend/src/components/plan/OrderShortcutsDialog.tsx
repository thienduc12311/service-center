import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui';
import { ORDER_SHORTCUT_HELP, type OrderShortcut } from './orderShortcuts';

export interface OrderShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** The `plans:orderShortcuts.*` label for each shortcut. */
const SHORTCUT_LABEL_KEY = {
  'focus-quick-add': 'orderShortcuts.focusQuickAdd',
  'select-next': 'orderShortcuts.selectNext',
  'select-previous': 'orderShortcuts.selectPrevious',
  'move-down': 'orderShortcuts.moveDown',
  'move-up': 'orderShortcuts.moveUp',
  edit: 'orderShortcuts.edit',
  remove: 'orderShortcuts.remove',
  deselect: 'orderShortcuts.deselect',
  help: 'orderShortcuts.help',
} as const satisfies Record<OrderShortcut, string>;

const KBD_CLASS =
  'rounded-md bg-slate-100 px-1.5 py-0.5 font-sans text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700';

/** The "?" dialog: every order shortcut and what it does. */
export const OrderShortcutsDialog = ({ open, onClose }: OrderShortcutsDialogProps) => {
  const { t } = useTranslation('plans');
  return (
    <Modal open={open} title={t('orderShortcuts.title')} onClose={onClose}>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{t('orderShortcuts.intro')}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-sm">
        {ORDER_SHORTCUT_HELP.map((row) => (
          <Fragment key={row.shortcut}>
            <dt className="flex flex-wrap items-center gap-1 text-slate-500">
              {row.keys.map((key, index) => (
                <Fragment key={key}>
                  {index > 0 && <span className="text-xs">{t('orderShortcuts.or')}</span>}
                  <kbd className={KBD_CLASS}>{key}</kbd>
                </Fragment>
              ))}
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">{t(SHORTCUT_LABEL_KEY[row.shortcut])}</dd>
          </Fragment>
        ))}
      </dl>
    </Modal>
  );
};
