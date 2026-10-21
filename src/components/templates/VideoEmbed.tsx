"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import type { TemplateDetail } from "@/lib/templates/types";

type Video = NonNullable<TemplateDetail["video"]>;

const PROVIDER_LABEL: Record<Video["provider"], string> = { youtube: "YouTube", vimeo: "Vimeo", loom: "Loom" };

type ViewProps = {
  video: Video;
  /** A first-party screenshot URL; never a remote thumbnail (that would be a third-party request before the click). */
  poster?: string;
  title: string;
  playing: boolean;
  onPlay: () => void;
};

/**
 * Presentational: before `playing`, a poster (or neutral panel) and a play button, with no third-party URL in the
 * DOM at all; once playing, the sandboxed provider iframe.
 */
export function VideoEmbedView({ video, poster, title, playing, onPlay }: ViewProps) {
  if (playing) {
    return (
      <iframe
        src={video.embedUrl}
        title={title}
        allow="fullscreen; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        loading="lazy"
        className="h-full w-full border-0"
      />
    );
  }
  return (
    <div className="relative h-full w-full bg-muted">
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" aria-hidden="true" className="h-full w-full object-cover opacity-60" decoding="async" />
      )}
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play video (loads ${PROVIDER_LABEL[video.provider]})`}
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
          <Play className="h-6 w-6 translate-x-0.5" aria-hidden="true" />
        </span>
        <span className="rounded bg-background/80 px-2 py-0.5 text-xs text-muted-foreground">
          Loads {PROVIDER_LABEL[video.provider]} on click
        </span>
      </button>
    </div>
  );
}

/** Click-to-load video embed: nothing is requested from the provider until the visitor presses play. */
export function VideoEmbed({ video, poster, title = "Template video" }: { video: Video; poster?: string; title?: string }) {
  const [playing, setPlaying] = useState(false);
  return <VideoEmbedView video={video} poster={poster} title={title} playing={playing} onPlay={() => setPlaying(true)} />;
}
