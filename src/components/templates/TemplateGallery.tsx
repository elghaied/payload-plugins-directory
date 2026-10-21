"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Expand, Play, X } from "lucide-react";
import type { TemplateDetail, TemplateImage } from "@/lib/templates/types";
import type { StackValue } from "@/lib/templates/stack";
import { TemplatePanel } from "./TemplatePanel";
import { VideoEmbed } from "./VideoEmbed";

type Screenshot = TemplateDetail["screenshots"][number];
type Video = NonNullable<TemplateDetail["video"]>;

type Props = {
  name: string;
  screenshots: Screenshot[];
  video?: Video;
  /** Shown when there are no screenshots: the README image, GitHub's social card (hotlinked, allow-listed) or the branded panel. */
  fallback: TemplateImage;
  stack: StackValue;
};

/** An image that swaps to a muted panel with the template's initial when it fails to load (as TemplateCard does). */
function GalleryImage({
  src,
  alt,
  remote,
  name,
  className,
  eager,
}: {
  src: string;
  alt: string;
  remote: boolean;
  name: string;
  className: string;
  eager?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // The load may have already failed before hydration, so onError never fires: check once on mount.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth === 0) setFailedSrc(src);
  }, [src]);
  if (failedSrc === src) {
    return (
      <div
        role="img"
        aria-label={`${alt} (unavailable)`}
        className="flex h-full w-full items-center justify-center bg-muted text-4xl font-semibold text-muted-foreground"
      >
        {name.trim().charAt(0).toUpperCase() || "?"}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      onError={() => setFailedSrc(src)}
      src={src}
      alt={alt}
      decoding="async"
      {...(remote || !eager ? { loading: "lazy" as const } : {})}
      {...(remote ? { referrerPolicy: "no-referrer" as const } : {})}
      className={className}
    />
  );
}

/**
 * Screenshot gallery (spec goal 3): a 16:10 main panel, a row of thumbnail buttons (a last "Video" thumbnail when a
 * video exists, which swaps the main panel to the click-to-load embed), and a native <dialog> full-screen view with
 * ←/→ and on-screen buttons. Esc closes it (native), and focus goes back to the button that opened it.
 */
export function TemplateGallery({ name, screenshots, video, fallback, stack }: Props) {
  const count = screenshots.length;
  // Image slots: the screenshots, or the single fallback image. The slot after them is the video.
  const imageSlots = Math.max(count, 1);
  const [index, setIndex] = useState(0);
  const [lightIndex, setLightIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const showingVideo = Boolean(video) && index === imageSlots;
  const current = screenshots[Math.min(index, count - 1)];

  const openLightbox = () => {
    setLightIndex(showingVideo ? 0 : index);
    // The page behind a full-screen view must not scroll (or show its scrollbar).
    document.documentElement.style.overflow = "hidden";
    dialogRef.current?.showModal();
  };
  const onDialogClose = () => {
    document.documentElement.style.overflow = "";
    triggerRef.current?.focus();
  };
  // Never leave the page locked if the gallery unmounts while open (client navigation).
  useEffect(() => () => {
    document.documentElement.style.overflow = "";
  }, []);
  const closeLightbox = () => dialogRef.current?.close();
  const step = (delta: number) => setLightIndex((i) => (i + delta + count) % count);
  const onDialogKey = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    }
  };

  const thumbClass = (selected: boolean) =>
    `relative aspect-[16/10] w-24 shrink-0 overflow-hidden rounded-md border-2 bg-muted transition-colors sm:w-28 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      selected ? "border-primary" : "border-transparent opacity-80 hover:opacity-100"
    }`;

  return (
    <section aria-label={`${name} preview`} className="mb-8">
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border bg-muted">
        {showingVideo && video ? (
          <VideoEmbed video={video} poster={screenshots[0]?.full} title={`${name} video`} />
        ) : current ? (
          <GalleryImage
            key={current.full}
            src={current.full}
            alt={current.alt || `${name} screenshot ${index + 1}`}
            remote={false}
            name={name}
            eager={index === 0}
            className="h-full w-full object-cover object-top"
          />
        ) : fallback.panel ? (
          <TemplatePanel name={name} stack={stack} />
        ) : (
          <GalleryImage
            src={fallback.src}
            alt={`${name} preview`}
            remote={!fallback.local}
            name={name}
            className="h-full w-full object-cover object-top"
          />
        )}
        {count > 0 && !showingVideo && (
          <button
            ref={triggerRef}
            type="button"
            onClick={openLightbox}
            aria-label="View full screen"
            className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-md bg-background/90 px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Expand className="h-3.5 w-3.5" aria-hidden="true" />
            View full screen
          </button>
        )}
      </div>

      {(count > 1 || video) && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Gallery thumbnails">
          {count === 0 && (
            <button type="button" onClick={() => setIndex(0)} aria-label="Show preview image" aria-pressed={!showingVideo} className={thumbClass(!showingVideo)}>
              {fallback.panel ? (
                <TemplatePanel name={name} stack={stack} className="p-2 sm:p-2 [&_p]:text-[10px]" />
              ) : (
                <GalleryImage src={fallback.src} alt="" remote={!fallback.local} name={name} className="h-full w-full object-cover object-top" />
              )}
            </button>
          )}
          {screenshots.map((s, i) => (
            <button
              key={s.full}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show screenshot ${i + 1} of ${count}`}
              aria-pressed={index === i}
              className={thumbClass(index === i)}
            >
              <GalleryImage src={s.card} alt="" remote={false} name={name} className="h-full w-full object-cover object-top" />
            </button>
          ))}
          {video && (
            <button
              type="button"
              onClick={() => setIndex(imageSlots)}
              aria-label="Show video"
              aria-pressed={showingVideo}
              className={`${thumbClass(showingVideo)} flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground`}
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Video
            </button>
          )}
        </div>
      )}

      {count > 0 && (
        <dialog
          ref={dialogRef}
          aria-label={`${name} screenshots, full screen`}
          onKeyDown={onDialogKey}
          onClose={onDialogClose}
          className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none bg-black p-0 text-white backdrop:bg-black open:flex open:flex-col"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span aria-live="polite">
              {lightIndex + 1} / {count}
            </span>
            <button
              type="button"
              onClick={closeLightbox}
              aria-label="Close full screen view"
              className="rounded-md p-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={screenshots[lightIndex]?.full}
              src={screenshots[lightIndex]?.full}
              alt={screenshots[lightIndex]?.alt || `${name} screenshot ${lightIndex + 1}`}
              decoding="async"
              loading="lazy"
              className="max-h-full max-w-full object-contain"
            />
            {count > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label="Previous screenshot"
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-4"
                >
                  <ChevronLeft className="h-6 w-6" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label="Next screenshot"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-4"
                >
                  <ChevronRight className="h-6 w-6" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </dialog>
      )}
    </section>
  );
}
