"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** VOZEB Agent message typography, kept separate from the composer chrome. */
export function AgentMessageMarkdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children: value }) => <h1 className="mb-2 mt-5 text-lg font-semibold leading-7 first:mt-0">{value}</h1>,
          h2: ({ children: value }) => <h2 className="mb-2 mt-5 text-base font-semibold leading-7 first:mt-0">{value}</h2>,
          h3: ({ children: value }) => <h3 className="mb-1.5 mt-4 text-[15px] font-semibold leading-6 first:mt-0">{value}</h3>,
          p: ({ children: value }) => <p className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">{value}</p>,
          strong: ({ children: value }) => <strong className="font-semibold text-[#171b20] dark:text-white">{value}</strong>,
          ul: ({ children: value }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-[#a2aab4]">{value}</ul>,
          ol: ({ children: value }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-[#8d96a2]">{value}</ol>,
          li: ({ children: value }) => <li className="pl-0.5">{value}</li>,
          blockquote: ({ children: value }) => <blockquote className="my-3 border-l-2 border-[#d7dce2] pl-3 text-[#657080] dark:border-[#48505a] dark:text-[#b4bcc6]">{value}</blockquote>,
          a: ({ children: value, href }) => <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-[#5963d9] underline decoration-[#5963d9]/35 underline-offset-2 hover:decoration-current dark:text-[#aeb4ff]">{value}</a>,
          pre: ({ children: value }) => <pre className="my-3 max-w-full overflow-x-auto rounded-xl border border-[#e3e7eb] bg-[#f7f8fa] p-3 text-[13px] leading-6 dark:border-[#30363e] dark:bg-[#15181c]">{value}</pre>,
          code: ({ children: value, className }) => className ? <code className={`${className} font-mono text-[13px]`}>{value}</code> : <code className="rounded bg-[#f0f2f4] px-1 py-0.5 font-mono text-[0.9em] dark:bg-[#282d34]">{value}</code>,
          table: ({ children: value }) => <div className="my-3 max-w-full overflow-x-auto"><table className="w-full min-w-max border-collapse text-left text-sm">{value}</table></div>,
          th: ({ children: value }) => <th className="border-b border-[#d6dbe1] px-2 py-1.5 font-semibold dark:border-[#49515b]">{value}</th>,
          td: ({ children: value }) => <td className="border-b border-[#e5e8ec] px-2 py-1.5 align-top dark:border-[#30363e]">{value}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
