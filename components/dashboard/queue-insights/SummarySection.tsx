"use client";

import { Avatar, Badge } from "@/components/ui";
import type { PostCard, Summary } from "@/lib/queue-insights/types";
import {
  fmtAgo,
  fmtAgoMin,
  fmtCompact,
  fmtDayMonth,
  fmtMultiple,
  fmtReadAfterPublish,
  fmtReadAt,
  isInitialRead,
} from "./format";
import { Eyebrow, LazyThumb, MiniStat, Num, ViewOnInstagram } from "./parts";

/** Resumo da fila (desde o começo dela) + o post de mais views. */
export function SummarySection({ summary }: { summary: Summary }) {
  const since = summary.since ? `desde ${fmtDayMonth(summary.since)}` : undefined;
  return (
    <section aria-label="Resumo da fila" className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Posts da fila" value={summary.posts} hint={since} />
        <MiniStat label="Views" value={summary.totalViews} valueClassName="text-success" />
        <MiniStat
          label="Views/post"
          value={summary.viewsPerPost}
          hint={summary.medianViews != null ? `mediana ${fmtCompact(summary.medianViews)}` : undefined}
        />
      </div>

      {summary.bestPost && <BestPostCard post={summary.bestPost} />}
    </section>
  );
}

function BestPostCard({ post }: { post: PostCard }) {
  return (
    <div className="flex gap-3 rounded-xl border border-line bg-surface p-3">
      <LazyThumb src={post.publicUrl} className="w-[72px]" label={`Vídeo do post de @${post.username}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Eyebrow tone="success">Melhor post da fila</Eyebrow>
        <div className="flex min-w-0 items-center gap-2">
          <Avatar size="sm" src={post.avatarUrl} alt={post.username} />
          <span className="truncate text-[13px] font-medium text-ink">@{post.username}</span>
        </div>
        <p className="text-[13px] text-ink-2">
          <Num value={post.views} className="font-mono text-base font-semibold text-success" /> views
          {post.multiple != null && (
            <>
              {" · "}
              <span className="text-ink">{fmtMultiple(post.multiple)}</span> o normal da conta
            </>
          )}
        </p>
        <p className="text-xs text-ink-3">publicado {fmtAgo(post.publishedAt)}</p>
        <ReadTiming post={post} />
        <ViewOnInstagram post={post} />
      </div>
    </div>
  );
}

/**
 * Quando as views foram lidas. Leitura dos primeiros minutos fica marcada:
 * o número ainda sobe até a leitura de 4h.
 */
function ReadTiming({ post }: { post: PostCard }) {
  if (!post.viewsReadAt) return null;
  const initial = isInitialRead(post.publishedAt, post.viewsReadAt);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <p className="text-xs text-ink-3" title={`Views lidas em ${fmtReadAt(post.viewsReadAt)}`}>
        views lidas {fmtReadAfterPublish(post.publishedAt, post.viewsReadAt)} · {fmtAgoMin(post.viewsReadAt)}
      </p>
      {initial && (
        <Badge tone="warning" title="Lida antes das 4h de publicado — o número sobe na próxima leitura.">
          leitura inicial
        </Badge>
      )}
    </div>
  );
}
