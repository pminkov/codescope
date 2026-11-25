const icons = {
  areas: /* HTML */ `
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 10h18M11 10v11M11 15h10" />
  `,
  presentation: /* HTML */ `
    <path d="M3 3h18v13H3zM12 16v5m-5 0 5-5 5 5M7 7h10M7 11h6" />
  `,
  endpoints: /* HTML */ `
    <rect x="3" y="3" width="18" height="7" rx="2" />
    <rect x="3" y="14" width="18" height="7" rx="2" />
    <path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" />
  `,
  folder: /* HTML */ `
    <path d="M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
  `,
  flow: /* HTML */ `
    <path d="M9 5h8.5a3.5 3.5 0 0 1 0 7h-11a3.5 3.5 0 0 0 0 7H15" />
    <circle cx="18" cy="19" r="3" />
    <circle cx="6" cy="5" r="3" />
  `,
  sequences: /* HTML */ `
    <path d="m16 3 4 4-4 4M20 7H4m4 14-4-4 4-4M4 17h16" />
  `,
  nouns: /* HTML */ `
    <rect x="3" y="4" width="7" height="7" rx="1.5" />
    <rect x="14" y="13" width="7" height="7" rx="1.5" />
    <path d="M6 11v6h8M10 7h7v6" />
  `,
  code: /* HTML */ `
    <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20" />
  `,
  scan: /* HTML */ `
    <path d="M4 7V4h3m10 0h3v3m0 10v3h-3M7 20H4v-3M7 8h10M7 12h10M7 16h6" />
  `,
  search: /* HTML */ `
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m16 16 4 4" />
  `,
  arrow: /* HTML */ `
    <path d="M5 12h14m-6-6 6 6-6 6" />
  `,
  chevron: /* HTML */ `
    <path d="m9 5 7 7-7 7" />
  `,
  sun: /* HTML */ `
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" />
  `,
  moon: /* HTML */ `
    <path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z" />
  `,
  settings: /* HTML */ `
    <path d="M10 3h4l.8 2.5 1.5.9 2.6-.6 2.1 3.6-1.8 1.7v1.8l1.8 1.7-2.1 3.6
      -2.6-.6-1.5.9L14 21h-4l-.8-2.5-1.5-.9-2.6.6L3 14.6l1.8-1.7v-1.8L3 9.4l2.1-3.6
      2.6.6 1.5-.9Z" />
    <circle cx="12" cy="12" r="3" />
  `,
  file: /* HTML */ `
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Zm0 0v5h5M8 13h8m-8 4h5" />
  `,
  info: /* HTML */ `
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6m0-11v1" />
  `,
  check: /* HTML */ `
    <path d="m5 12 4 4L19 6" />
  `,
  architecture: /* HTML */ `
    <rect x="9" y="3" width="6" height="5" rx="1" />
    <rect x="2" y="16" width="6" height="5" rx="1" />
    <rect x="16" y="16" width="6" height="5" rx="1" />
    <path d="M12 8v4M5 16v-4h14v4" />
  `,
  browser: /* HTML */ `
    <rect x="2" y="3" width="20" height="18" rx="2" />
    <path d="M2 8h20M5 5.5h1m2 0h1" />
  `,
  database: /* HTML */ `
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" />
  `,
  external: /* HTML */ `
    <path d="M14 3h7v7m0-7L10 14M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5" />
  `,
  rename: /* HTML */ `
    <path d="m16 3 5 5-12 12H4v-5ZM14 5l5 5" />
  `,
  rerun: /* HTML */ `
    <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5" />
  `,
  duplicate: /* HTML */ `
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M16 8V3H3v13h5" />
  `,
  delete: /* HTML */ `
    <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
  `,
  close: /* HTML */ `
    <path d="m6 6 12 12M6 18 18 6" />
  `,
  down: /* HTML */ `
    <path d="m6 9 6 6 6-6" />
  `,
  more: /* HTML */ `
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  `,
  clock: /* HTML */ `
    <circle cx="12" cy="12" r="9" />
    <path d="M12 6v6l4 2" />
  `,
  all: /* HTML */ `
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  `,
};

// Render an accessible decorative SVG from the shared icon set.
export const renderIcon = (name, extra = '') => /* HTML */ `
  <svg
    class="icon ${extra}"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${icons[name] || icons.file}
  </svg>
`;
