import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { LogEntry } from '../store';

const LEVEL_COLORS: Record<string, string> = {
  error: 'text-red-400',
  warn: 'text-yellow-400',
  info: 'text-text-primary',
  debug: 'text-text-muted',
};

export const LogViewer: React.FC<{
  entries: LogEntry[];
  filter?: string;
  emptyText?: string;
}> = ({ entries, filter = '', emptyText }) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) {
      return entries;
    }
    return entries.filter(
      (e) =>
        e.message.toLowerCase().includes(q) ||
        e.service.toLowerCase().includes(q) ||
        e.level.toLowerCase().includes(q)
    );
  }, [entries, filter]);

  useEffect(() => {
    if (stickToBottom && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filtered, stickToBottom]);

  const handleScroll = () => {
    if (!containerRef.current) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setStickToBottom(scrollHeight - scrollTop - clientHeight < 40);
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto font-mono text-xs leading-5 p-3.5 bg-panel-bg rounded-xl border border-panel-border"
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full py-12 text-text-muted">
            {filter ? t.common.noLogsMatchFilter : emptyText || t.common.noLogsYet}
          </div>
        ) : (
          filtered.map((item, idx) => (
            <div key={idx} className="flex gap-2.5 hover:bg-white/[0.03] py-0.5 px-1.5 rounded">
              <span className="text-text-muted shrink-0 select-none tabular-nums">
                {item.timestamp ? item.timestamp.slice(0, 12) : '--:--:--'}
              </span>
              <span className="text-sky-400/90 shrink-0 select-none font-medium">
                [{item.service}]
              </span>
              <span className={`${LEVEL_COLORS[item.level] || 'text-text-primary'} break-all whitespace-pre-wrap`}>
                {item.message}
              </span>
            </div>
          ))
        )}
      </div>

      {!stickToBottom && (
        <button
          type="button"
          onClick={() => {
            setStickToBottom(true);
            if (containerRef.current) {
              containerRef.current.scrollTop = containerRef.current.scrollHeight;
            }
          }}
          className="absolute bottom-4 right-4 bg-accent-blue text-white text-xs px-3 py-1.5 rounded-full shadow-lg hover:opacity-90 transition-opacity"
        >
          {t.common.jumpToBottom}
        </button>
      )}
    </div>
  );
};
