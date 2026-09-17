import iconUrl from '../../assets/icon-backgroundless.png';

interface AppIconProps {
  size?: number;
  className?: string;
  invert?: boolean;
}

export function AppIcon({ size = 16, className, invert = false }: AppIconProps) {
  return (
    <img
      src={iconUrl}
      alt="Pablock"
      width={size}
      height={size}
      draggable={false}
      className={`${className ?? ''} ${invert ? 'icon-invert' : ''}`.trim()}
    />
  );
}
