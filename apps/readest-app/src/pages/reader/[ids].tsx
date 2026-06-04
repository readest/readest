import { useRouter } from 'next/router';
import { AuthProvider } from '@/context/AuthContext';
import { EnvProvider } from '@/context/EnvContext';
import Reader from '@/app/reader/components/Reader';

export default function Page() {
  const router = useRouter();
  const ids = router.query['ids'] as string;
  return (
    <EnvProvider>
      <AuthProvider>
        <Reader ids={ids} />
      </AuthProvider>
    </EnvProvider>
  );
}
