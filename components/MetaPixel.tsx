'use client';

import { useEffect } from 'react';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

// Mounts Meta Pixel and fires a PageView. No-op unless NEXT_PUBLIC_META_PIXEL_ID is set.
// PageView fires on mount; Lead fires from the form submit handler.

export function MetaPixel({ pixelId }: { pixelId?: string }) {
  useEffect(() => {
    if (!pixelId || typeof window === 'undefined' || window.fbq) return;

    (function (f: any, b: any, e: string, v: string) {
      let n: any;
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
      const t = b.createElement(e) as HTMLScriptElement;
      t.async = true;
      t.src = v;
      const s = b.getElementsByTagName(e)[0];
      s.parentNode?.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    window.fbq!('init', pixelId);
    window.fbq!('track', 'PageView');
  }, [pixelId]);

  if (!pixelId) return null;
  return (
    <noscript>
      <img
        height="1"
        width="1"
        alt=""
        style={{ display: 'none' }}
        src={`https://www.facebook.com/tr?id=${encodeURIComponent(pixelId)}&ev=PageView&noscript=1`}
      />
    </noscript>
  );
}
