const paths = {
 book:'<path d="M3 5q5-1 9 3 4-4 9-3v14q-5-1-9 2-4-3-9-2zM12 8v13"/>',
 guide:'<circle cx="12" cy="12" r="9"/><path d="M9.2 9a2.8 2.8 0 0 1 5.5.4c0 2-2.7 2.3-2.7 4.3M12 17h.01"/>',
 globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
 down:'<path d="m6 9 6 6 6-6"/>',
 library:'<path d="M4 4v16m4-16v16m3-15 2-1 5 15-2 1zM20 4v16"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 play:'<path d="m8 4 12 8-12 8z" fill="currentColor" stroke="none"/>',
 stop:'<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
 mic:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4m-4 0h8"/>',
 wave:'<path d="M3 10v4m4-8v12m5-16v20m5-17v14m4-9v4"/>',
 upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
 pointer:'<path d="M8 12V5a1.7 1.7 0 0 1 3.4 0v6l1-1q1-1 2.2.4 1.7-1 3 1 2 0 2 2v2c0 4-2 6-5 6h-2c-2 0-3-.7-4-2L4 13q-.5-2.5 2-2z"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
 volume:'<path d="M3 9h4l5-4v14l-5-4H3zm12-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'
};
export function icon(name){return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">'+(paths[name]||'')+'</svg>'}

