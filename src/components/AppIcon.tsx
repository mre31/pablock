import iconUrl from '../../assets/icon.svg';

export function AppIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <img
      src={iconUrl}
      alt="Pablock"
      width={size}
      height={size}
      draggable={false}
      className={className}
    />
  );
}
