import React, { useEffect, useState, useRef } from 'react';
import { useBuddyReadStore } from '@/store/buddyReadStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { createShare } from '@/libs/share';
import { isReadestCloudStorageActive } from '@/services/sync/cloudSyncProvider';
import { READEST_WEB_BASE_URL } from '@/services/constants';
import clsx from 'clsx';

const BuddyReadView: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const progress = useBookProgress(bookKey);
  const { getBookData } = useBookDataStore();
  const { user } = useAuth();
  const { appService, envConfig } = useEnv();
  const [copyingInvite, setCopyingInvite] = useState(false);

  const {
    currentBuddyReadId,
    activeBuddyRead,
    comments,
    hasMoreComments,
    postComment,
    fetchComments,
    fetchAnnotations,
    fetchBuddyReadDetails,
  } = useBuddyReadStore();

  const [messageText, setMessageText] = useState('');
  const [revealedComments, setRevealedComments] = useState<Record<number, boolean>>({});
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Form State for creating a new buddy read
  const [description, setDescription] = useState('');
  const [maxMembers, setMaxMembers] = useState(10);
  const [creating, setCreating] = useState(false);

  const bookData = getBookData(bookKey);
  const book = bookData?.book;

  // Calculate current user progress percentage
  const currentProgressPercent = progress
    ? Math.round((((progress.pageinfo?.current || 0) + 1) / (progress.pageinfo?.total || 1)) * 100)
    : 0;

  const currentPage = progress ? (progress.pageinfo?.current || 0) + 1 : 1;

  const commentsPageRef = useRef(1);
  const loadingMoreRef = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const commentsLengthRef = useRef(comments.length);

  useEffect(() => {
    commentsLengthRef.current = comments.length;
  }, [comments.length]);

  useEffect(() => {
    commentsPageRef.current = 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    lastCommentIdRef.current = null;
  }, [currentBuddyReadId]);

  const handleLoadMore = async (prevHeight?: number, container?: HTMLDivElement | null) => {
    if (loadingMoreRef.current || !currentBuddyReadId) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = commentsPageRef.current + 1;
      await fetchComments(currentBuddyReadId, nextPage, 15);
      commentsPageRef.current = nextPage;

      if (prevHeight && container) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight - prevHeight;
        });
      }
    } catch (err) {
      console.error('Failed to load more comments:', err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollTop <= 5 && hasMoreComments && !loadingMoreRef.current) {
      const previousScrollHeight = target.scrollHeight;
      handleLoadMore(previousScrollHeight, target);
    }
  };

  // Poll comments and annotations every 15 seconds
  useEffect(() => {
    if (!currentBuddyReadId) return;

    const refreshData = () => {
      fetchBuddyReadDetails(currentBuddyReadId);
      fetchComments(currentBuddyReadId, 1, Math.max(15, commentsLengthRef.current));
      fetchAnnotations(currentBuddyReadId);
    };

    refreshData();
    const interval = setInterval(refreshData, 15000);
    return () => clearInterval(interval);
  }, [currentBuddyReadId, fetchComments, fetchAnnotations, fetchBuddyReadDetails]);

  const lastCommentIdRef = useRef<number | null>(null);

  // Scroll to bottom when comments update (only if a new comment is appended at the bottom)
  useEffect(() => {
    if (comments.length === 0) {
      lastCommentIdRef.current = null;
      return;
    }
    const lastComment = comments[comments.length - 1];
    const lastId = lastComment?.commentId;

    if (lastId !== lastCommentIdRef.current) {
      const isInitial = lastCommentIdRef.current === null;
      chatEndRef.current?.scrollIntoView({
        behavior: isInitial ? 'auto' : 'smooth',
      });
      lastCommentIdRef.current = lastId;
    }
  }, [comments]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!book || creating) return;

    setCreating(true);
    try {
      const store = useBuddyReadStore.getState();
      await store.createBuddyRead({
        bookHash: book.hash,
        title: book.title,
        author: book.author || '',
        description: description.trim() || `${_('Buddy read for')} ${book.title}`,
        maxMembers: Number(maxMembers),
        startDate: new Date().toISOString(),
      });
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Buddy read created successfully!'),
        timeout: 2500,
      });
    } catch (err: any) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: err.message || _('Could not create buddy read'),
        timeout: 3000,
      });
    } finally {
      setCreating(false);
    }
  };

  if (!user) {
    return (
      <div className='flex h-full flex-col items-center justify-center p-6 text-center text-base-content/60 font-sans bg-base-100 min-h-[400px]'>
        <p className='text-sm font-medium mb-3'>
          {_('Please sign in to participate in Buddy Reads.')}
        </p>
      </div>
    );
  }

  if (!currentBuddyReadId || !activeBuddyRead) {
    return (
      <div className='flex h-full flex-col p-5 font-sans bg-base-100 min-h-[400px] overflow-y-auto'>
        <h3 className='text-md font-bold text-primary mb-1'>{_('Start Buddy Read')}</h3>
        <p className='text-xs text-base-content/70 mb-5 leading-relaxed'>
          {_(
            'Create a group discussion and highlight sharing session for this book. Invite your friends to read along with you!',
          )}
        </p>

        <form onSubmit={handleCreate} className='space-y-4 flex-grow flex flex-col justify-between'>
          <div className='space-y-4'>
            <div className='form-control'>
              <label className='label py-1'>
                <span className='label-text text-xs font-bold text-base-content/85'>
                  {_('Book Title')}
                </span>
              </label>
              <input
                type='text'
                value={book?.title || ''}
                disabled
                className='input input-sm bg-base-200 border border-base-300 text-base-content/70 h-9 rounded-md px-3 text-xs w-full cursor-not-allowed font-medium'
              />
            </div>

            <div className='form-control'>
              <label className='label py-1'>
                <span className='label-text text-xs font-bold text-base-content/85'>
                  {_('Group Description')}
                </span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={_(
                  "E.g., Let's read 2 chapters every week! Avoid sharing spoilers past progress...",
                )}
                className='textarea textarea-sm bg-base-100 border border-base-300 focus:outline-none focus:border-primary text-xs rounded-md p-2.5 w-full min-h-[80px]'
              />
            </div>

            <div className='form-control'>
              <label className='label py-1'>
                <span className='label-text text-xs font-bold text-base-content/85'>
                  {_('Maximum Participants')}
                </span>
              </label>
              <input
                type='number'
                min={2}
                max={50}
                value={maxMembers}
                onChange={(e) => setMaxMembers(Number(e.target.value))}
                className='input input-sm bg-base-100 border border-base-300 focus:outline-none focus:border-primary text-xs h-9 rounded-md px-3 w-full font-medium'
              />
            </div>
          </div>

          <button
            type='submit'
            disabled={creating || !book}
            className='btn btn-sm btn-primary mt-6 w-full capitalize text-xs font-bold h-9 rounded-md'
          >
            {creating ? _('Creating...') : _('Create Group')}
          </button>
        </form>
      </div>
    );
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim()) return;

    try {
      await postComment(
        currentBuddyReadId,
        messageText.trim(),
        currentProgressPercent,
        currentPage,
      );
      setMessageText('');
    } catch (err) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to send comment'),
        timeout: 2000,
      });
    }
  };

  const copyInviteLink = async () => {
    if (copyingInvite) return;
    setCopyingInvite(true);

    let inviteUrl = `${READEST_WEB_BASE_URL}/buddy-read/join?id=${currentBuddyReadId}`;

    try {
      if (book) {
        const settings = useSettingsStore.getState().settings;
        const inReadestStorage = !!book.uploadedAt && isReadestCloudStorageActive(settings);

        if (!inReadestStorage && appService) {
          eventDispatcher.dispatch('toast', {
            type: 'info',
            message: _('Uploading book to cloud to generate shareable invite...'),
            timeout: 3000,
          });
          await appService.uploadBook(book, () => {});
          await useLibraryStore.getState().updateBook(envConfig, book);
        }

        const response = await createShare({
          bookHash: book.hash,
          expirationDays: 7,
          title: book.title,
          author: book.author ?? null,
          format: book.format,
          cfi: null,
        });

        if (response?.token) {
          inviteUrl += `&shareToken=${response.token}`;
        }
      }
    } catch (err) {
      console.warn(
        'Could not generate share token for buddy read invite. Falling back to basic link.',
        err,
      );
    } finally {
      navigator.clipboard.writeText(inviteUrl);
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Invitation link copied to clipboard!'),
        timeout: 2500,
      });
      setCopyingInvite(false);
    }
  };

  const toggleReveal = (commentId: number) => {
    setRevealedComments((prev) => ({
      ...prev,
      [commentId]: !prev[commentId],
    }));
  };

  return (
    <div className='flex h-full flex-col font-sans bg-base-100 min-h-[400px]'>
      {/* Group Info Header */}
      <div className='p-4 border-b border-base-300 bg-base-200/50 flex-shrink-0'>
        <h3 className='text-md font-bold text-primary truncate'>
          {activeBuddyRead.title || _('Buddy Read')}
        </h3>
        <p className='text-xs text-base-content/70 mt-1 max-h-12 overflow-y-auto'>
          {activeBuddyRead.buddyReadDescription || _('Reading together!')}
        </p>
        <button
          onClick={copyInviteLink}
          disabled={copyingInvite}
          className='btn btn-xs btn-outline btn-primary mt-2.5 w-full capitalize text-xs font-semibold'
        >
          {copyingInvite ? _('Generating Invite...') : _('Invite Buddies')}
        </button>
      </div>

      {/* Members Section */}
      <div className='p-3 bg-base-200/30 border-b border-base-300 flex-shrink-0'>
        <h4 className='text-xs font-semibold text-base-content/80 uppercase tracking-wider mb-2'>
          {_('Members Progress')}
        </h4>
        <div className='flex flex-wrap gap-2 max-h-24 overflow-y-auto'>
          {activeBuddyRead.members?.map((member: any) => {
            const isSelf = member.userId === activeBuddyRead.hostUserId;
            return (
              <div
                key={member.userId}
                className='flex items-center gap-1.5 px-2.5 py-1 bg-base-300/60 rounded-full text-xs font-medium'
              >
                {member.user_avatar ? (
                  <img
                    src={member.user_avatar}
                    alt={member.user_name}
                    className='w-4 h-4 rounded-full object-cover'
                  />
                ) : (
                  <div className='w-4 h-4 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] uppercase font-bold'>
                    {member.user_name?.slice(0, 1)}
                  </div>
                )}
                <span className='truncate max-w-[80px]'>
                  {member.user_name} {isSelf && `(${_('Host')})`}
                </span>
                <span className='badge badge-ghost badge-sm text-[10px] px-1 ml-0.5 bg-base-100/50'>
                  {member.progressPercentage ?? 0}%
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chat History Panel */}
      <div
        className='flex-1 overflow-y-auto p-4 space-y-3.5 min-h-0 bg-base-100'
        onScroll={handleScroll}
      >
        {comments.length === 0 ? (
          <div className='flex h-full flex-col items-center justify-center text-center text-base-content/50 py-10'>
            <p className='text-xs'>{_('No messages yet. Say hi!')}</p>
          </div>
        ) : (
          <>
            {hasMoreComments && (
              <div className='flex justify-center mb-2'>
                <button
                  type='button'
                  onClick={(e) => {
                    const container = e.currentTarget.closest('.overflow-y-auto') as HTMLDivElement;
                    handleLoadMore(container?.scrollHeight, container);
                  }}
                  disabled={loadingMore}
                  className='btn btn-xs btn-ghost text-xs text-primary font-semibold hover:bg-transparent normal-case'
                >
                  {loadingMore ? _('Loading older messages...') : _('Load older messages')}
                </button>
              </div>
            )}
            {comments.map((msg) => {
              const isSpoiler = (msg.progressPercentage || 0) > currentProgressPercent;
              const isRevealed = revealedComments[msg.commentId];
              const isMe = msg.supabaseUserId === user?.id;

              return (
                <div
                  key={msg.commentId}
                  className={clsx(
                    'chat',
                    isMe
                      ? 'chat-end flex flex-col items-end'
                      : 'chat-start flex flex-col items-start',
                  )}
                >
                  {/* Meta details */}
                  <div className='chat-header flex items-center gap-1.5 mb-1 text-xs opacity-75'>
                    <span className='font-bold text-base-content/90'>
                      {isMe ? _('You') : msg.user_name || 'Reader'}
                    </span>
                    <span className='text-[10px] bg-primary/10 text-primary font-bold px-1 rounded-sm'>
                      {_('Page')} {msg.pageNumber || 1} ({msg.progressPercentage || 0}%)
                    </span>
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={clsx(
                      'chat-bubble max-w-full text-sm py-2 px-3 rounded-lg border',
                      isSpoiler && !isRevealed
                        ? 'bg-warning/10 border-warning/35 text-warning-content cursor-pointer'
                        : isMe
                          ? 'bg-primary text-primary-content border-transparent'
                          : 'bg-base-200 border-base-300 text-base-content',
                    )}
                    onClick={() => isSpoiler && toggleReveal(msg.commentId)}
                  >
                    {isSpoiler && !isRevealed ? (
                      <div className='flex items-center gap-1.5 font-medium select-none text-xs'>
                        <span>⚠️ {_('Spoiler Alert')}</span>
                        <span className='underline text-[10px] opacity-80'>
                          ({_('Click to view')})
                        </span>
                      </div>
                    ) : (
                      <p className='whitespace-pre-wrap break-words leading-relaxed'>
                        {msg.commentText}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input controls */}
      <form
        onSubmit={handleSend}
        className='p-3 border-t border-base-300 bg-base-200/40 flex-shrink-0'
      >
        <div className='flex gap-2 items-center'>
          <input
            type='text'
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder={_('Write comment / message...')}
            className='input input-sm flex-1 bg-base-100 border border-base-300 focus:outline-none focus:border-primary text-sm h-9 rounded-md px-3'
          />
          <button
            type='submit'
            disabled={!messageText.trim()}
            className='btn btn-sm btn-primary h-9 rounded-md px-4 capitalize text-xs font-semibold'
          >
            {_('Send')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default BuddyReadView;
