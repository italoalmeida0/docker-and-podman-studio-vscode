import React from 'react';

/**
 * Miniature SVG of the approved Dual-Cards Frosted-Glass Porcelain Squircle logo.
 */
export const StudioAppTile: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <defs>
      <linearGradient id="miniCeramic" x1="32" y1="2" x2="32" y2="62" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FFFFFF" />
        <stop offset="55%" stopColor="#F8FAFC" />
        <stop offset="100%" stopColor="#E4E7EE" />
      </linearGradient>
      <linearGradient id="miniDocker" x1="16" y1="18" x2="36" y2="38" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38BDF8" />
        <stop offset="100%" stopColor="#2563EB" />
      </linearGradient>
      <linearGradient id="miniPodman" x1="28" y1="18" x2="48" y2="38" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#9333EA" />
        <stop offset="100%" stopColor="#5B21B6" />
      </linearGradient>
      <clipPath id="miniSq">
        <rect x="2" y="2" width="60" height="60" rx="15" />
      </clipPath>
      <clipPath id="miniUpper">
        <rect x="2" y="2" width="60" height="30" />
      </clipPath>
      <clipPath id="miniLower">
        <rect x="2" y="32" width="60" height="30" />
      </clipPath>
      <filter id="miniFrost" x="-6" y="14" width="76" height="54" filterUnits="userSpaceOnUse">
        <feGaussianBlur stdDeviation="3.4" />
      </filter>
    </defs>

    <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#miniCeramic)" />

    <g clipPath="url(#miniSq)">
      <g clipPath="url(#miniUpper)">
        <line x1="22" y1="2" x2="22" y2="32" stroke="#CBD2E0" strokeWidth="0.8" />
        <line x1="42" y1="2" x2="42" y2="32" stroke="#CBD2E0" strokeWidth="0.8" />
        <line x1="2" y1="17" x2="62" y2="17" stroke="#CBD2E0" strokeWidth="0.8" />
        <path d="M 8 32 A 24 24 0 0 1 56 32" stroke="#C4CCDC" strokeWidth="0.9" fill="none" />
        <rect x="17" y="19" width="20" height="20" rx="4.5" transform="rotate(-14 27 29)" fill="url(#miniDocker)" />
        <rect x="27" y="19" width="20" height="20" rx="4.5" transform="rotate(14 37 29)" fill="url(#miniPodman)" fillOpacity="0.92" />
      </g>

      <g clipPath="url(#miniLower)">
        <rect x="2" y="32" width="60" height="30" fill="#ECEEF4" />
        <g filter="url(#miniFrost)" opacity="0.88">
          <rect x="17" y="19" width="20" height="20" rx="4.5" transform="rotate(-14 27 29)" fill="url(#miniDocker)" />
          <rect x="27" y="19" width="20" height="20" rx="4.5" transform="rotate(14 37 29)" fill="url(#miniPodman)" />
        </g>
        <rect x="2" y="32" width="60" height="30" fill="#F1F3F8" fillOpacity="0.46" />
        <line x1="2" y1="32" x2="62" y2="32" stroke="#D2D8E4" strokeWidth="0.9" />
      </g>
    </g>

    <rect x="2.5" y="2.5" width="59" height="59" rx="14.5" stroke="#C8D0DF" strokeWidth="1" />
  </svg>
);

export const DockerMark: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <rect x="5" y="9.4" width="2.6" height="2.4" rx="0.5" fill="currentColor" />
    <rect x="8.3" y="9.4" width="2.6" height="2.4" rx="0.5" fill="currentColor" />
    <rect x="11.6" y="9.4" width="2.6" height="2.4" rx="0.5" fill="currentColor" />
    <rect x="8.3" y="6.3" width="2.6" height="2.4" rx="0.5" fill="currentColor" />
    <rect x="11.6" y="6.3" width="2.6" height="2.4" rx="0.5" fill="currentColor" />
    <path
      d="M3.2 13.1H16.6C17.4 13.1 18.2 12.75 18.75 12.05C19.35 12.25 20.35 12.2 21 11.55C20.75 13.05 19.75 13.85 18.7 14.05C17.75 16.95 15.1 18.5 11.2 18.5C6.85 18.5 3.9 16.55 3.2 13.1Z"
      fill="currentColor"
    />
  </svg>
);

export const PodmanMark: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M12 3.2L19.4 7.45V15.95L12 20.2L4.6 15.95V7.45L12 3.2Z"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
    />
    <path
      d="M12 7.6L15.7 9.75V14.05L12 16.2L8.3 14.05V9.75L12 7.6Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
);
