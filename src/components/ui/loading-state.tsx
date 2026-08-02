interface LoadingStateProps {
  label: string;
}

export function LoadingState({ label }: LoadingStateProps) {
  return (
    <p className="flex items-center gap-2 text-blue-100/60">
      <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      {label}
    </p>
  );
}
