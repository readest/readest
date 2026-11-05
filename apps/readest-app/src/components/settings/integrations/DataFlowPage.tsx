import clsx from 'clsx';
import Image from 'next/image';
import React, { useEffect, useState } from 'react';
import {
  RiAlertLine,
  RiAppleLine,
  RiBook3Line,
  RiBookOpenLine,
  RiBookReadLine,
  RiBookmark3Line,
  RiCheckLine,
  RiCloudFill,
  RiCloudLine,
  RiDatabase2Line,
  RiFileList3Line,
  RiGoogleLine,
  RiHeadphoneLine,
  RiMicrosoftLine,
  RiPlanetLine,
  RiRssLine,
  RiSendPlaneLine,
  RiSubtractLine,
  RiWifiLine,
} from 'react-icons/ri';
import { useTranslation } from '@/hooks/useTranslation';
import { runConnectionCheck, type FlowConnector } from '@/services/sync/dataFlow/connectors';
import {
  getConnectorHealth,
  getConnectorTotals,
  readFlowState,
} from '@/services/sync/dataFlow/log';
import type {
  ConnectorId,
  FlowDirection,
  FlowEntry,
  FlowKind,
  FlowState,
} from '@/services/sync/dataFlow/types';
import { formatSyncTimeFromNow } from '@/utils/time';
import SubPageHeader from '../SubPageHeader';
import { BoxedList, NavigationRow, SettingsRow } from '../primitives';
import { useFlowConnectors, useFlowState } from './useFlowConnectors';

// Opening the page checks everything, so going back and forth must not.
const RECHECK_AFTER_MS = 5 * 60 * 1000;
const HISTORY_ROWS = 50;

const NODE_HEIGHT = 48;
const NODE_GAP = 8;
const LINES_WIDTH = 72;

const ICONS: Record<ConnectorId, React.ElementType> = {
  'readest-cloud': RiCloudFill,
  kosync: RiBookOpenLine,
  bookorbit: RiPlanetLine,
  readwise: RiBookReadLine,
  hardcover: RiBook3Line,
  pagebound: RiBookmark3Line,
  notion: RiFileList3Line,
  audiobookshelf: RiHeadphoneLine,
  opds: RiRssLine,
  localsend: RiWifiLine,
  send: RiSendPlaneLine,
  webdav: RiCloudLine,
  gdrive: RiGoogleLine,
  s3: RiDatabase2Line,
  onedrive: RiMicrosoftLine,
  icloud: RiAppleLine,
};

const HEALTH_ICONS = { ok: RiCheckLine, failed: RiAlertLine, unknown: RiSubtractLine };

const useFlowLabels = () => {
  const _ = useTranslation();
  const health = {
    ok: _('Working'),
    failed: _('Needs attention'),
    unknown: _('Not checked yet'),
  };
  const flows: Record<FlowDirection, Record<FlowKind, string>> = {
    pull: {
      progress: _('Progress received'),
      notes: _('Notes received'),
      books: _('Books received'),
    },
    push: { progress: _('Progress sent'), notes: _('Notes sent'), books: _('Books sent') },
  };
  return { health, flows };
};

const nodeCenter = (index: number) => index * (NODE_HEIGHT + NODE_GAP) + NODE_HEIGHT / 2;

const FlowLines: React.FC<{
  sources: FlowConnector[];
  sinks: FlowConnector[];
  state: FlowState;
}> = ({ sources, sinks, state }) => {
  const rows = Math.max(sources.length, sinks.length);
  const height = rows * NODE_HEIGHT + (rows - 1) * NODE_GAP;
  const hub = height / 2;
  const middle = LINES_WIDTH / 2;
  const curve = (x: number, y: number) => `M${x} ${y} C${middle} ${y} ${x} ${hub} ${middle} ${hub}`;
  const line = (connector: FlowConnector, x: number, index: number) => {
    const direction = x === 0 ? 'pull' : 'push';
    const failed = getConnectorHealth(state, connector.id, direction) === 'failed';
    return (
      <path
        key={`${connector.id}-${x}`}
        d={curve(x, nodeCenter(index))}
        fill='none'
        stroke='currentColor'
        strokeWidth={failed ? 2 : 1.5}
        strokeDasharray={failed ? '4 3' : undefined}
        className={failed ? 'text-base-content' : 'text-base-content/30'}
      />
    );
  };
  return (
    <div className='relative' style={{ width: LINES_WIDTH, height }}>
      <svg
        aria-hidden='true'
        width={LINES_WIDTH}
        height={height}
        className='absolute inset-0 rtl:-scale-x-100'
      >
        {sources.map((connector, index) => line(connector, 0, index))}
        {sinks.map((connector, index) => line(connector, LINES_WIDTH, index))}
      </svg>
      <div
        className='eink-bordered border-base-200 bg-base-100 absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border rtl:translate-x-1/2'
        style={{ top: hub, insetInlineStart: middle }}
      >
        <Image src='/icon.png' alt='' width={24} height={24} className='h-6 w-6' />
      </div>
    </div>
  );
};

const FlowNode: React.FC<{
  connector: FlowConnector;
  direction: FlowDirection;
  count: number;
  state: FlowState;
  onOpen: () => void;
}> = ({ connector, direction, count, state, onOpen }) => {
  const _ = useTranslation();
  const { health } = useFlowLabels();
  const status = getConnectorHealth(state, connector.id, direction);
  const Icon = ICONS[connector.id];
  const HealthIcon = HEALTH_ICONS[status];
  return (
    <li>
      <button
        type='button'
        onClick={onOpen}
        aria-label={`${_(connector.title)}: ${health[status]}`}
        style={{ height: NODE_HEIGHT }}
        className={clsx(
          'eink-bordered bg-base-100 hover:bg-base-200/50 flex w-full items-center gap-2 rounded-lg border px-2 text-start',
          'transition-colors duration-150',
          'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
          status === 'failed' ? 'border-base-content' : 'border-base-200',
        )}
      >
        <Icon aria-hidden='true' className='h-4 w-4 shrink-0' />
        <span className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate text-sm leading-tight'>{_(connector.title)}</span>
          <span className='flex items-center gap-1 text-xs leading-tight'>
            <HealthIcon aria-hidden='true' className='h-3 w-3 shrink-0' />
            <span className='tabular-nums'>{count}</span>
          </span>
        </span>
      </button>
    </li>
  );
};

const FlowColumn: React.FC<{
  title: string;
  connectors: FlowConnector[];
  direction: FlowDirection;
  state: FlowState;
  onOpen: (connector: FlowConnector) => void;
}> = ({ title, connectors, direction, state, onOpen }) => (
  <ul aria-label={title} className='flex min-w-0 flex-col' style={{ gap: NODE_GAP }}>
    {connectors.map((connector) => {
      const totals = getConnectorTotals(state, connector.id);
      return (
        <FlowNode
          key={connector.id}
          connector={connector}
          direction={direction}
          count={direction === 'pull' ? totals.pulled : totals.pushed}
          state={state}
          onOpen={() => onOpen(connector)}
        />
      );
    })}
  </ul>
);

const HistoryRow: React.FC<{ entry: FlowEntry }> = ({ entry }) => {
  const _ = useTranslation();
  const { flows } = useFlowLabels();
  const flow = flows[entry.direction][entry.kind];
  const time = formatSyncTimeFromNow(entry.at);
  return (
    <SettingsRow
      asLabel={false}
      label={<span className='line-clamp-1'>{entry.bookTitle ?? flow}</span>}
      description={entry.error ? `${entry.error} · ${time}` : `${flow} · ${time}`}
    >
      <span className='shrink-0 text-sm tabular-nums'>
        {entry.error ? _('Failed') : entry.count}
      </span>
    </SettingsRow>
  );
};

const ConnectorDetail: React.FC<{
  connector: FlowConnector;
  state: FlowState;
  onBack: () => void;
  onOpenSettings: (id: ConnectorId) => void;
}> = ({ connector, state, onBack, onOpenSettings }) => {
  const _ = useTranslation();
  const { flows } = useFlowLabels();
  const [checking, setChecking] = useState(false);
  const check = state.checks[connector.id];
  const entries = state.entries.filter((entry) => entry.connector === connector.id);

  const recheck = async () => {
    setChecking(true);
    await runConnectionCheck(connector);
    setChecking(false);
  };

  const rows = [
    ...connector.sources.map((kind) => ({ direction: 'pull' as const, kind })),
    ...connector.sinks.map((kind) => ({ direction: 'push' as const, kind })),
  ];

  return (
    <div className='my-4 w-full'>
      <SubPageHeader
        parentLabel={_('Data Flow')}
        currentLabel={_(connector.title)}
        description={_('Whether this integration answers, and what it has synced on this device')}
        onBack={onBack}
      />
      <div className='space-y-6'>
        <BoxedList title={_('Connection')}>
          {connector.check ? (
            <SettingsRow
              asLabel={false}
              label={!check ? _('Not checked yet') : check.ok ? _('Connected') : _('Not connected')}
              description={
                check &&
                (check.message
                  ? _(check.message)
                  : _('Checked {{time}}', { time: formatSyncTimeFromNow(check.at) }))
              }
            >
              <button
                type='button'
                onClick={recheck}
                disabled={checking}
                className='btn btn-ghost btn-sm eink-bordered shrink-0'
              >
                {checking ? _('Checking…') : _('Check')}
              </button>
            </SettingsRow>
          ) : (
            <SettingsRow asLabel={false} label={_('This integration has no connection check')} />
          )}
        </BoxedList>

        <BoxedList title={_('Synced')}>
          {rows.map(({ direction, kind }) => {
            const total = state.totals[`${connector.id}:${direction}:${kind}`];
            const failed = (total?.lastFailureAt ?? 0) >= (total?.lastSuccessAt ?? 0);
            const at = failed ? total?.lastFailureAt : total?.lastSuccessAt;
            return (
              <SettingsRow
                key={`${direction}-${kind}`}
                asLabel={false}
                label={flows[direction][kind]}
                description={
                  at
                    ? `${failed ? total?.lastError : _('Last synced')} · ${formatSyncTimeFromNow(at)}`
                    : undefined
                }
              >
                <span className='shrink-0 text-sm tabular-nums'>{total?.count ?? 0}</span>
              </SettingsRow>
            );
          })}
        </BoxedList>

        <BoxedList title={_('Sync History')}>
          {entries.length > 0 ? (
            entries
              .slice(0, HISTORY_ROWS)
              .map((entry) => (
                <HistoryRow key={`${entry.at}-${entry.direction}-${entry.kind}`} entry={entry} />
              ))
          ) : (
            <SettingsRow asLabel={false} label={_('Nothing has synced yet')} />
          )}
        </BoxedList>

        <BoxedList>
          <NavigationRow title={_('Open Settings')} onClick={() => onOpenSettings(connector.id)} />
        </BoxedList>
      </div>
    </div>
  );
};

interface DataFlowPageProps {
  onBack: () => void;
  onOpenSettings: (id: ConnectorId) => void;
}

/**
 * Where reading data comes from and where it goes: sources on one side,
 * destinations on the other, Readest in the middle. An integration that works
 * both ways is on both sides. Counts and history are this device's own.
 */
const DataFlowPage: React.FC<DataFlowPageProps> = ({ onBack, onOpenSettings }) => {
  const _ = useTranslation();
  const { health } = useFlowLabels();
  const connectors = useFlowConnectors();
  const state = useFlowState();
  const [selectedId, setSelectedId] = useState<ConnectorId | null>(null);
  const [checking, setChecking] = useState(false);

  const runChecks = async (list: FlowConnector[]) => {
    setChecking(true);
    await Promise.all(list.map(runConnectionCheck));
    setChecking(false);
  };

  useEffect(() => {
    const { checks } = readFlowState();
    const stale = connectors.filter(
      (connector) =>
        connector.check && Date.now() - (checks[connector.id]?.at ?? 0) > RECHECK_AFTER_MS,
    );
    if (stale.length > 0) void runChecks(stale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = connectors.find((connector) => connector.id === selectedId);
  if (selected) {
    return (
      <ConnectorDetail
        connector={selected}
        state={state}
        onBack={() => setSelectedId(null)}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  const sources = connectors.filter((connector) => connector.sources.length > 0);
  const sinks = connectors.filter((connector) => connector.sinks.length > 0);
  const counts = { ok: 0, failed: 0, unknown: 0 };
  for (const { id } of connectors) counts[getConnectorHealth(state, id)]++;
  const open = (connector: FlowConnector) => setSelectedId(connector.id);

  return (
    <div className='my-4 w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Data Flow')}
        description={_('See where your reading data comes from and where it goes')}
        onBack={onBack}
      />
      {connectors.length === 0 ? (
        <BoxedList>
          <SettingsRow asLabel={false} label={_('No integrations are set up yet')} />
        </BoxedList>
      ) : (
        <div className='space-y-3'>
          <div className='card eink-bordered border-base-200 bg-base-100 border p-3'>
            <div className='mb-2 grid grid-cols-2 text-xs font-medium'>
              <span>{_('Sources')}</span>
              <span className='text-end'>{_('Destinations')}</span>
            </div>
            <div
              className='grid items-start'
              style={{ gridTemplateColumns: `minmax(0,1fr) ${LINES_WIDTH}px minmax(0,1fr)` }}
            >
              <FlowColumn
                title={_('Sources')}
                connectors={sources}
                direction='pull'
                state={state}
                onOpen={open}
              />
              <FlowLines sources={sources} sinks={sinks} state={state} />
              <FlowColumn
                title={_('Destinations')}
                connectors={sinks}
                direction='push'
                state={state}
                onOpen={open}
              />
            </div>
          </div>
          <div className='flex items-center justify-between gap-3 px-4'>
            <span className='flex flex-wrap gap-x-3 text-sm'>
              <span className='whitespace-nowrap'>{`${health.ok}: ${counts.ok}`}</span>
              <span className='whitespace-nowrap'>{`${health.failed}: ${counts.failed}`}</span>
            </span>
            <button
              type='button'
              onClick={() => runChecks(connectors.filter((connector) => connector.check))}
              disabled={checking}
              className='btn btn-ghost btn-sm eink-bordered shrink-0'
            >
              {checking ? _('Checking…') : _('Check All')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataFlowPage;
