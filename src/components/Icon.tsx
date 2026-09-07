/**
 * lucide 대신 쓰는 인라인 아이콘
 * grop HTML의 data-lucide 와 같은 선 굵기(1.6~2)를 맞춥니다.
 */
type IconProps = {
  name:
    | 'home'
    | 'clipboard-list'
    | 'file-text'
    | 'sparkles'
    | 'calendar'
    | 'users'
    | 'settings'
    | 'bell'
    | 'chevron-left'
    | 'chevron-right'
    | 'folder-plus'
    | 'x'
    | 'circle-user'
    | 'check-circle'
    | 'arrow-left'
    | 'clipboard'
    | 'pencil'
    | 'user-plus'
    | 'plus'
    | 'clock'
    | 'download'
    | 'copy'
    | 'share-2'
    | 'minus-circle';
  className?: string;
};

export default function Icon({ name, className }: IconProps) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };

  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 10v10h14V10" />
        </svg>
      );
    case 'clipboard-list':
      return (
        <svg {...common}>
          <rect x="8" y="3" width="8" height="4" rx="1" />
          <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <path d="M8 12h8M8 16h5" />
        </svg>
      );
    case 'file-text':
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6M9 13h6M9 17h6" />
        </svg>
      );
    case 'sparkles':
      return (
        <svg {...common}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.2 6.2l2.5 2.5M15.3 15.3l2.5 2.5M17.8 6.2l-2.5 2.5M8.7 15.3l-2.5 2.5" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" />
          <circle cx="17" cy="9" r="2.4" />
          <path d="M21 19c0-2.2-1.6-3.8-3.6-4.5" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case 'bell':
      return (
        <svg {...common}>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
      );
    case 'chevron-left':
      return (
        <svg {...common}>
          <path d="M15 6 9 12l6 6" />
        </svg>
      );
    case 'chevron-right':
      return (
        <svg {...common}>
          <path d="m9 6 6 6-6 6" />
        </svg>
      );
    case 'folder-plus':
      return (
        <svg {...common}>
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <path d="M12 11v6M9 14h6" />
        </svg>
      );
    case 'x':
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case 'circle-user':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 19c1.5-3 4-5 7-5s5.5 2 7 5" />
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
    case 'check-circle':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12.5 2.5 2.5 4.5-5" />
        </svg>
      );
    case 'arrow-left':
      return (
        <svg {...common}>
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
      );
    case 'clipboard':
      return (
        <svg {...common}>
          <rect x="8" y="3" width="8" height="4" rx="1" />
          <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        </svg>
      );
    case 'pencil':
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
        </svg>
      );
    case 'user-plus':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M17 11v6M14 14h6" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'download':
      return (
        <svg {...common}>
          <path d="M12 3v12M7 10l5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...common}>
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case 'share-2':
      return (
        <svg {...common}>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
        </svg>
      );
    case 'minus-circle':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12h8" />
        </svg>
      );
    default:
      return null;
  }
}
