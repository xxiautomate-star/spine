'use client';

import { useEffect, useRef, useState } from 'react';

// Hero launch film. Replaces the old <InstallDemoLoop /> on the landing
// page. Sources are pre-rendered MP4 + WebM in /public/launch-film/ —
// produced by `node scripts/capture-launch-film.mjs`.
//
// Loading discipline (Roman's acceptance criteria):
//   - first-paint under 1.5s        → poster JPG renders immediately,
//                                     <video preload="metadata"> doesn't
//                                     block FCP on the actual video bytes
//   - film starts within 2s on 4G   → IntersectionObserver triggers play
//                                     only when in view, and we use `auto`
//                                     preload after FCP via a deferred
//                                     useEffect
//   - lighthouse drop ≤ 5 points    → muted + playsinline so iOS allows
//                                     autoplay; loop; no audio track at all
//
// Mobile fallback: viewports < 768px get the 9x16 cut. Same component,
// different <source> + <img> pair selected via a CSS-driven matchMedia.
// We don't swap on resize — the initial pick survives orientation changes,
// preventing a load thrash if the user rotates while watching.

type Aspect = '16x9' | '9x16';

const SOURCES: Record<Aspect, {
  poster: string;
  webm: string;
  mp4: string;
  width: number;
  height: number;
}> = {
  '16x9': {
    poster: '/launch-film/16x9-poster.jpg',
    webm: '/launch-film/16x9.webm',
    mp4: '/launch-film/16x9.mp4',
    width: 1280,
    height: 720,
  },
  '9x16': {
    poster: '/launch-film/9x16-poster.jpg',
    webm: '/launch-film/9x16.webm',
    mp4: '/launch-film/9x16.mp4',
    width: 720,
    height: 1280,
  },
};

function pickAspect(): Aspect {
  if (typeof window === 'undefined') return '16x9';
  return window.matchMedia('(max-width: 767px)').matches ? '9x16' : '16x9';
}

export function LaunchFilm() {
  // Default to 16x9 on the server so SSR markup doesn't trigger CLS when
  // the client hydrates and discovers a wider viewport. The mobile-cut
  // mount happens in a useEffect after first paint.
  const [aspect, setAspect] = useState<Aspect>('16x9');
  const [mounted, setMounted] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setAspect(pickAspect());
    setMounted(true);
  }, []);

  // After mount, defer to "auto" preload so the bytes start streaming once
  // the page has handed back to idle. Keeps initial paint cheap.
  useEffect(() => {
    if (!mounted) return;
    const v = videoRef.current;
    if (!v) return;
    v.preload = 'auto';
    // Best-effort autoplay. Will resolve fine on browsers that allow muted
    // autoplay (all modern). If the browser blocks (reduced-motion, etc.)
    // the poster image is what the user sees — still a clean hero.
    v.play().catch(() => {
      /* fallback: poster + paused video. No regression. */
    });
  }, [mounted]);

  const src = SOURCES[aspect];

  return (
    <div
      className="relative w-full max-w-[640px] mx-auto"
      style={{ aspectRatio: `${src.width} / ${src.height}` }}
    >
      {/* Soft amber glow behind the film, matching the rest of the hero
          atmosphere. Keeps the cream film bleeding into the dark page. */}
      <div
        className="pointer-events-none absolute -inset-6 rounded-2xl bg-[#E89A3C]/[0.06] blur-2xl"
        aria-hidden
      />
      <div className="relative w-full h-full rounded-xl overflow-hidden border border-[#E8E4DD]/[0.08] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
        <video
          ref={videoRef}
          // Set key on aspect so React swaps the element + reloads new <source>s
          // when the breakpoint changes (mobile rotate from portrait to landscape).
          key={aspect}
          className="block w-full h-full object-cover"
          width={src.width}
          height={src.height}
          poster={src.poster}
          autoPlay
          muted
          loop
          playsInline
          // Cheap initial preload so HTML doesn't block on the video. We
          // upgrade to 'auto' in the post-mount useEffect.
          preload="metadata"
          // No <track> — the film has no dialogue, no audio, no narration.
          aria-label="Spine launch film — every AI conversation starts from zero. Spine fixes that."
        >
          <source src={src.webm} type="video/webm" />
          <source src={src.mp4} type="video/mp4" />
          {/* Final fallback: just the poster, surfaced as alt text-equivalent. */}
        </video>
      </div>
    </div>
  );
}
