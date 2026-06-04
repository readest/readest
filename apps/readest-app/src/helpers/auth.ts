interface UseAuthCallbackOptions {
  navigate: (path: string) => void;
}

export function handleAuthCallback({ navigate }: UseAuthCallbackOptions) {
  navigate('/library');
}
