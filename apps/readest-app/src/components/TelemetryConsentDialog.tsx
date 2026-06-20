'use client';

import { LuCheck, LuChartLine, LuX } from 'react-icons/lu';

import ModalPortal from '@/components/ModalPortal';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { optInTelemetry, optOutTelemetry } from '@/utils/telemetry';

interface TelemetryConsentDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * First-launch consent prompt asking new users whether to share anonymous
 * usage data. Shown to a small fraction of new users; the rest are opted out
 * silently.
 */
export default function TelemetryConsentDialog({ open, onClose }: TelemetryConsentDialogProps) {
  const _ = useTranslation();
  const { envConfig } = useEnv();

  if (!open) return null;

  // Persist `telemetryEnabled` via the settings store if it has already
  // been seeded by the library/reader page; otherwise go straight through
  // appService.loadSettings + saveSettings so we don't overwrite the on-disk
  // file with a near-empty store snapshot.
  const persistTelemetryEnabled = async (value: boolean) => {
    const store = useSettingsStore.getState();
    if (store.settings && typeof store.settings.version === 'number') {
      const next = { ...store.settings, telemetryEnabled: value };
      store.setSettings(next);
      await store.saveSettings(envConfig, next);
    } else {
      const appService = await envConfig.getAppService();
      const settings = await appService.loadSettings();
      settings.telemetryEnabled = value;
      await appService.saveSettings(settings);
    }
  };

  const accept = async () => {
    optInTelemetry();
    await persistTelemetryEnabled(true);
    onClose();
  };

  const decline = async () => {
    optOutTelemetry();
    await persistTelemetryEnabled(false);
    onClose();
  };

  return (
    <ModalPortal>
      <dialog className='modal modal-open'>
        <div className='modal-box bg-base-100 w-[min(420px,calc(100vw-2rem))] rounded-2xl p-0'>
          <div className='border-base-content/10 flex flex-col items-center gap-3 border-b px-6 pb-5 pt-7 text-center'>
            <div
              className='eink-bordered bg-base-200 text-base-content/80 flex h-12 w-12 items-center justify-center rounded-full'
              aria-hidden='true'
            >
              <LuChartLine size={22} strokeWidth={1.75} />
            </div>
            <h3 className='text-base-content text-base font-semibold tracking-tight'>
              {_('Help improve Readest')}
            </h3>
            <p className='text-base-content/65 text-[13px] leading-relaxed'>
              {_(
                'Share anonymous usage data so we can understand how Readest is used and make it better.',
              )}
            </p>
          </div>

          <ul className='space-y-2.5 px-6 py-5'>
            <ConsentRow kind='positive' label={_('Anonymous, aggregated feature usage')} />
            <ConsentRow kind='negative' label={_('No personal information')} />
            <ConsentRow kind='negative' label={_('No book content or reading data')} />
          </ul>

          <div className='border-base-content/10 flex flex-col gap-2 border-t px-6 py-4'>
            <button
              type='button'
              onClick={accept}
              className='btn btn-contrast h-10 min-h-0 rounded-xl text-sm font-medium'
            >
              {_('Share anonymous data')}
            </button>
            <button
              type='button'
              onClick={decline}
              className='eink-bordered text-base-content hover:bg-base-200 h-10 rounded-xl border border-transparent text-sm font-medium transition-colors'
            >
              {_('Not now')}
            </button>
            <p className='text-base-content/55 pt-1 text-center text-[11px]'>
              {_('You can change this anytime in Settings.')}
            </p>
          </div>
        </div>
      </dialog>
    </ModalPortal>
  );
}

function ConsentRow({ kind, label }: { kind: 'positive' | 'negative'; label: string }) {
  const isPositive = kind === 'positive';
  // Positive: filled disc. We deliberately skip `eink-bordered` here so the
  // eink override that paints `bg-base-content` solid wins, keeping the row
  // visually distinct from the negative (outlined) rows on e-paper.
  // Negative: outlined disc — `eink-bordered` flips to base-100 + 1px border
  // under eink, and `border-base-content/15` carries the boundary on color
  // themes.
  return (
    <li className='flex items-center gap-3'>
      <span
        className={
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full ' +
          (isPositive
            ? 'bg-base-content text-base-100'
            : 'eink-bordered border-base-content/15 text-base-content/70 border')
        }
        aria-hidden='true'
      >
        {isPositive ? <LuCheck size={14} strokeWidth={2.5} /> : <LuX size={14} strokeWidth={2.5} />}
      </span>
      <span className='text-base-content/85 text-[13px] leading-snug'>{label}</span>
    </li>
  );
}
