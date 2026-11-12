const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#171b2e"/>
      <stop offset="1" stop-color="#2c2445"/>
    </linearGradient>
    <linearGradient id="wave" x1="0" x2="1">
      <stop offset="0" stop-color="#7ed7ff"/>
      <stop offset=".52" stop-color="#8b9cff"/>
      <stop offset="1" stop-color="#ff8ac7"/>
    </linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="12"/></filter>
  </defs>
  <rect width="640" height="360" rx="42" fill="url(#bg)"/>
  <circle cx="502" cy="96" r="78" fill="#ff8ac7" opacity=".18" filter="url(#glow)"/>
  <circle cx="152" cy="278" r="96" fill="#7ed7ff" opacity=".14" filter="url(#glow)"/>
  <path d="M0 246c64-39 112-40 173-11 71 33 116 34 183 1 62-30 122-31 179 1 38 22 69 28 105 17v106H0z" fill="url(#wave)" opacity=".78"/>
  <path d="M0 282c72-36 126-34 187-4 65 32 119 31 183 0 67-32 132-32 188 2 28 17 56 23 82 20v60H0z" fill="#fff" opacity=".08"/>
  <path d="M320 158c-20-31-71-19-71 23 0 35 42 69 71 90 29-21 71-55 71-90 0-42-51-54-71-23z" fill="#ff8ac7" opacity=".95"/>
  <path d="M320 169c-13-21-47-13-47 15 0 23 28 46 47 60 19-14 47-37 47-60 0-28-34-36-47-15z" fill="#fff" opacity=".82"/>
</svg>`;
export const XINCHAO_ART = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
