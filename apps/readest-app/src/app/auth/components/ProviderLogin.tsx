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
      onClick={() => {
        void handleSignIn(provider).catch((error) => {
          console.warn(`Failed to sign in with ${provider}:`, error);
        });
      }}
      className={clsx(
        'mb-2 flex w-64 items-center justify-center rounded border p-2.5',
        'bg-base-100 border-base-300 hover:bg-base-200 shadow-sm transition',
      )}
    >
      <Icon />
      <span className='text-base-content/75 px-2 text-sm'>{label}</span>
    </button>
  );
};
