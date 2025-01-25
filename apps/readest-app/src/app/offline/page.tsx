import Image from 'next/image';

export default function Offline() {
  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-gray-100 text-center'>
      <div className='mb-4'>
        <Image src='/icon.png' alt='App Icon' width={100} height={100} className='rounded-lg' />
      </div>

      <h1 className='text-2xl font-bold text-gray-800'>Readest</h1>

      <p className='mt-2 text-gray-600'>
        It seems you&apos;re offline. Please check your internet connection and try again.
      </p>
    </div>
  );
}
