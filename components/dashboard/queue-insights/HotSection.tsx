"use client";

import { Send, TrendingUp } from "lucide-react";
import { Avatar, Badge, Button } from "@/components/ui";
import type { HotSection as HotData, PostCard } from "@/lib/queue-insights/types";
import { fmtAgo, fmtAgoMin, fmtMultiple, fmtReadAt, plural } from "./format";
import { InsightCard, LazyThumb, Num, ViewOnInstagram } from "./parts";

/** Post fora da curva das últimas 48h e o atalho para levar o vídeo às outras contas. */
export function HotSection({ hot, onRepublish }: { hot: HotData; onRepublish: (post: PostCard) => void }) {
  const [main, ...rest] = hot.highlighted;
  const target = main ?? hot.fallback;
  const accounts = hot.republishAccountIds.length;
  const canRepublish = !!target?.videoId && accounts > 0;

  return (
    <InsightCard
      eyebrow={main ? "Bombando agora" : "Últimas 48h"}
      tone={main ? "success" : "neutral"}
      title={hot.text.title}
      headingId="qi-hot-title"
    >
      {hot.text.body && <p className="text-[13px] leading-5 text-ink-2">{hot.text.body}</p>}

      {main && <BigPost post={main} />}
      {rest.slice(0, 2).map((p) => (
        <CompactPost key={`${p.source}:${p.postId}`} post={p} />
      ))}
      {!main && hot.fallback && <CompactPost post={hot.fallback} />}

      {target && (
        <div className="flex flex-col gap-1.5 pt-1">
          <Button
            variant="secondary"
            size="md"
            icon={<Send size={14} />}
            disabled={!canRepublish}
            onClick={() => target && onRepublish(target)}
          >
            Publicar nas outras contas
          </Button>
          <p className="text-xs text-ink-3">
            {!target.videoId
              ? "O vídeo saiu da Biblioteca — não dá para republicar."
              : accounts > 0
                ? `${plural(accounts, "conta da fila ainda não postou", "contas da fila ainda não postaram")} esse vídeo. Abre o Postar para você revisar.`
                : "Todas as contas ativas da fila já usaram esse vídeo."}
          </p>
        </div>
      )}
    </InsightCard>
  );
}

/** " lidas há 12 min" logo depois de "views" — a hora exata vai no `title`. */
function readAgo(post: PostCard): string {
  return post.viewsReadAt ? ` lidas ${fmtAgoMin(post.viewsReadAt)}` : "";
}

function readTitle(post: PostCard): string | undefined {
  return post.viewsReadAt ? `Views lidas em ${fmtReadAt(post.viewsReadAt)}` : undefined;
}

function RisingBadge({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <Badge tone="success" className="w-fit gap-1 whitespace-normal">
      <TrendingUp size={12} aria-hidden="true" />
      {text}
    </Badge>
  );
}

function BigPost({ post }: { post: PostCard }) {
  return (
    <div className="flex gap-3">
      <LazyThumb src={post.publicUrl} className="w-[112px]" label={`Vídeo do post de @${post.username}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar size="sm" src={post.avatarUrl} alt={post.username} />
          <span className="truncate text-[13px] font-medium text-ink">@{post.username}</span>
        </div>
        <div className="flex flex-col">
          <Num value={post.views} className="font-mono text-[22px] font-semibold leading-7 text-success" />
          <span className="text-xs text-ink-3" title={readTitle(post)}>
            views{readAgo(post)}
          </span>
        </div>
        {post.multiple != null && (
          <p className="text-[13px] text-ink-2">
            <span className="font-medium text-ink">{fmtMultiple(post.multiple)}</span> o normal da conta
          </p>
        )}
        <p className="text-xs text-ink-3">publicado {fmtAgo(post.publishedAt)}</p>
        <RisingBadge text={post.risingText} />
        <ViewOnInstagram post={post} />
      </div>
    </div>
  );
}

function CompactPost({ post }: { post: PostCard }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line px-2.5 py-2">
      <LazyThumb src={post.publicUrl} className="w-10 rounded-md" label={`Vídeo do post de @${post.username}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-ink">@{post.username}</span>
        <span className="text-xs text-ink-3" title={readTitle(post)}>
          <Num value={post.views} className="font-medium text-success" /> views{readAgo(post)}
          {post.multiple != null && ` · ${fmtMultiple(post.multiple)} o normal`}
          {` · ${fmtAgo(post.publishedAt)}`}
        </span>
        <RisingBadge text={post.risingText} />
      </div>
    </div>
  );
}
