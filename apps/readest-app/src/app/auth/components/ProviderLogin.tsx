import clsx from 'clsx';

export type OAuthProvider = 'google' | 'apple' | 'azure' | 'github' | 'discord';

interface ProviderLoginProp {
  provider: OAuthProvider;
  handleSignIn: (provider: OAuthProvider) => Promise<void>;
  Icon: React.ElementType;
  label: string;
}

export const ProviderLogin: React.FC<ProviderLoginProp> = ({
  provider,
  handleSignIn,
  Icon,
  label,
}) => {
  return (
    <button
      type='button'
      onClick={() => {
        void handleSignIn(provider).catch((error) => {
          console.warn(`Failed to sign in with ${provider}:`, error);
        });
      }}
      className={clsx(
        'eink-bordered flex h-11 w-full items-center justify-center gap-2.5',
        'border-base-200 bg-base-100 rounded-lg border px-4',
        'text-base-content text-sm font-medium',
        'transition-colors duration-150',
        'hover:border-base-300 hover:bg-base-200/60',
        'active:bg-base-200/80',
        'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
      )}
    >
      <Icon className='h-5 w-5' aria-hidden='true' />
      <span className='line-clamp-1'>{label}</span>
    </button>
  );
};
