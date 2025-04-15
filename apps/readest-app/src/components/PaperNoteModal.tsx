import React, { useState } from 'react';
import Dialog from './Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { BooknoteGroup, PaperNoteApi } from '@/types/book';
import { findTocItemBS } from '@/utils/toc';
import { CFI } from '@/libs/document';

export const setImportDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('export_window');
  if (visible) {
    (dialog as HTMLDialogElement)?.showModal();
  } else {
    (dialog as HTMLDialogElement)?.close();
  }
};

interface ExportToPaperNoteWindowProps {
  //   onImport: (host: string, port: string) => Promise<void>;
}

export const ExportToPaperNoteWindow: React.FC<ExportToPaperNoteWindowProps> = ({}) => {
  const _ = useTranslation();
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8080'); // 默认端口
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [bookInfo] = useState({
    title: '',
    type: 1 as 0 | 1, // 默认为电子书
    locationUnit: 0 as 0 | 1 | 2, // 默认使用进度
  });
  const { sideBarBookKey } = useSidebarStore();
  const { getConfig, getBookData } = useBookDataStore();

  // 校验IP/域名格式
  const validateHost = (value: string) => {
    // IP地址校验 (IPv4)
    const ipRegex =
      /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

    // 域名校验
    const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+\.[a-zA-Z]{2,11}?$/;

    // localhost 或 本地网络名称
    const localRegex = /^localhost$|^[a-zA-Z0-9-]+$/;

    return ipRegex.test(value) || domainRegex.test(value) || localRegex.test(value);
  };

  // 校验端口
  const validatePort = (value: string) => {
    const portNum = parseInt(value, 10);
    return !isNaN(portNum) && portNum > 0 && portNum <= 65535;
  };

  // 测试连接
  const testConnection = async () => {
    if (!validateHost(host)) {
      setError(_('Please enter a valid IP address or hostname.'));
      return;
    }

    if (!validatePort(port)) {
      setError(_('Port must be between 1 and 65535.'));
      return;
    }

    setIsTesting(true);
    setError('');
    setSuccess('');

    try {
      // 这里使用fetch测试连接
      await fetch(`http://${host}:${port}/ping`, {
        method: 'HEAD',
        mode: 'no-cors', // 避免CORS问题
        cache: 'no-store',
      });

      // 只要能收到响应就认为连接成功
      setSuccess(_('Connection successful'));
    } catch (err) {
      setError(_('Failed to connect to server. Please check address and port.'));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async () => {
    // if (!success && !confirm(_('Server connection not verified. Continue anyway?'))) {
    //   return;
    // }
    if (!sideBarBookKey) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('No book selected'),
        className: 'whitespace-nowrap',
        timeout: 2000,
      });
      return;
    }
    const bookData = getBookData(sideBarBookKey)!;
    const { bookDoc, book } = bookData;
    if (!bookDoc || !book || !bookDoc.toc) return;
    const config = getConfig(sideBarBookKey)!;
    const { booknotes: allNotes = [] } = config;
    const booknotes = allNotes.filter((note) => !note.deletedAt);
    if (booknotes.length === 0) {
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('No annotations to export'),
        className: 'whitespace-nowrap',
        timeout: 2000,
      });
      return;
    }

    const booknoteGroups: { [href: string]: BooknoteGroup } = {};
    for (const booknote of booknotes) {
      const tocItem = findTocItemBS(bookDoc.toc ?? [], booknote.cfi);
      const href = tocItem?.href || '';
      const label = tocItem?.label || '';
      const id = tocItem?.id || 0;

      if (!booknoteGroups[href]) {
        booknoteGroups[href] = { id, href, label, booknotes: [] };
      }
      booknoteGroups[href].booknotes.push(booknote);
    }

    Object.values(booknoteGroups).forEach((group) => {
      group.booknotes.sort((a, b) => CFI.compare(a.cfi, b.cfi));
    });

    const sortedGroups = Object.values(booknoteGroups).sort((a, b) => a.id - b.id);

    setIsLoading(true);
    setError('');

    try {
      const paperNotes: PaperNoteApi = {
        title: book.title,
        type: bookInfo.type,
        author: book.author,
        cover: book.coverImageUrl?.substring(5),
        translator: '',
        publisher: '',
        publishDate: 0, // 默认为0
        isbn: '',
        locationUnit: bookInfo.locationUnit,
        entries: sortedGroups.flatMap((group) =>
          group.booknotes.map((note) => ({
            page: 0, // 默认为0 暂时不使用
            text: note.text,
            note: note.note,
            chapter: group.label || _('Untitled'),
            time: Math.floor(note.createdAt / 1000),
          })),
        ),
      };

      const response = await fetch(`http://${host}:${port}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paperNotes),
      });
      if (response.status === 200) {
        setSuccess(_('Export successful'));
        console.log(JSON.stringify(paperNotes));
      } else {
        const errorText = await response.text();
        setError(_('Export failed') + ': ' + errorText);
      }
    } catch (err) {
      setError(_('Export failed') + ': ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      id='export_window'
      isOpen={false}
      title={_('Export Server Config')}
      onClose={() => setImportDialogVisible(false)}
      boxClassName='sm:!w-96 sm:h-auto'
    >
      <div className='flex h-full flex-col items-center justify-center p-4'>
        <div className='w-full px-4'>
          <div className='flex flex-col space-y-4'>
            <div className='form-control w-full'>
              <label className='label'>
                <span className='label-text'>{_('Server Address')}</span>
              </label>
              <input
                type='text'
                placeholder='192.168.1.1 or example.com'
                className={`input input-bordered w-full ${
                  host && !validateHost(host) ? 'input-error' : ''
                }`}
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setSuccess('');
                }}
              />
              {host && !validateHost(host) && (
                <label className='label'>
                  <span className='label-text-alt text-error'>
                    {_('Please enter a valid IP address or hostname.')}
                  </span>
                </label>
              )}
            </div>

            <div className='form-control w-full'>
              <label className='label'>
                <span className='label-text'>{_('Port')}</span>
              </label>
              <input
                type='number'
                placeholder='8080'
                min='1'
                max='65535'
                className={`input input-bordered w-full ${
                  port && !validatePort(port) ? 'input-error' : ''
                }`}
                value={port}
                onChange={(e) => {
                  setPort(e.target.value);
                  setSuccess('');
                }}
              />
              {port && !validatePort(port) && (
                <label className='label'>
                  <span className='label-text-alt text-error'>{_('Port must be between 1 and 65535.')}</span>
                </label>
              )}
            </div>
          </div>

          <div className='mt-4 flex justify-end'>
            <button
              className='btn btn-outline mr-2'
              onClick={testConnection}
              disabled={isTesting || !host || !port || !validateHost(host) || !validatePort(port)}
            >
              {isTesting ? (
                <>
                  <span className='loading loading-spinner'></span>
                  {_('Testing...')}
                </>
              ) : (
                _('Test Connection')
              )}
            </button>
          </div>

          {success && (
            <div className='alert alert-success mt-4 py-2'>
              <svg
                xmlns='http://www.w3.org/2000/svg'
                className='h-6 w-6 shrink-0 stroke-current'
                fill='none'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                />
              </svg>
              <span>{success}</span>
            </div>
          )}

          {error && (
            <div className='alert alert-error mt-4 py-2'>
              <svg
                xmlns='http://www.w3.org/2000/svg'
                className='h-6 w-6 shrink-0 stroke-current'
                fill='none'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z'
                />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div className='mt-6 flex justify-end space-x-2'>
            <button
              className='btn btn-ghost'
              onClick={() => setImportDialogVisible(false)}
              disabled={isLoading}
            >
              {_('Cancel')}
            </button>
            <button
              className='btn btn-primary'
              onClick={handleSubmit}
              disabled={isLoading || (!success && !host)}
            >
              {isLoading ? (
                <>
                  <span className='loading loading-spinner'></span>
                  {_('Exporting...')}
                </>
              ) : (
                _('Export')
              )}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
