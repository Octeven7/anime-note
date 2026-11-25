import { useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

type InlineNode = {
  type: string;
  value?: string;
  children?: InlineNode[];
  data?: { hName: string; hProperties?: Record<string, unknown> };
};

// Preserve inline formatting and paragraph flow rather than splitting Markdown
// into separately rendered blocks. Soft line breaks match the editor's Enter key.
function remarkNotebook() {
  return (tree: InlineNode) => {
    let continuingSpoiler = false;
    const walk = (node: InlineNode) => {
      if (!node.children) return;
      node.children.forEach(walk);
      const output: InlineNode[] = [];
      const stack: { kind: string; node: InlineNode }[] = [];
      const append = (child: InlineNode) =>
        (stack.length ? stack[stack.length - 1].node.children! : output).push(child);
      const marker = (kind: string, close = false) => {
        if (stack.at(-1)?.kind === kind) stack.pop();
        else if (!close) {
          const wrapper: InlineNode = {
            type: 'notebookInline',
            children: [],
            data:
              kind === 'spoiler'
                ? { hName: 'span', hProperties: { dataSpoiler: 'true' } }
                : { hName: 'u' },
          };
          append(wrapper);
          stack.push({ kind, node: wrapper });
        }
      };
      const paragraph = ['paragraph', 'heading', 'tableCell'].includes(node.type);
      if (paragraph && continuingSpoiler) marker('spoiler');
      for (const child of node.children) {
        if (child.type === 'text') {
          for (const fragment of (child.value || '').split(/(\|\||\n)/)) {
            if (fragment === '||') marker('spoiler');
            else if (fragment === '\n') append({ type: 'break' });
            else if (fragment) append({ type: 'text', value: fragment });
          }
        } else if (child.type === 'html' && /^<\/?u>$/.test(child.value || '')) {
          marker('underline', child.value === '</u>');
        } else append(child);
      }
      node.children = output;
      if (paragraph) continuingSpoiler = stack.some((entry) => entry.kind === 'spoiler');
    };
    walk(tree);
  };
}

export function SpoilerText({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`spoiler-inline ${revealed ? 'revealed' : 'covered'}`}
      role="button"
      tabIndex={0}
      aria-label={revealed ? '隐藏剧透文字' : '显示剧透文字'}
      aria-pressed={revealed}
      onClick={() => setRevealed((value) => !value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          setRevealed((value) => !value);
        }
      }}
    >
      <span aria-hidden={!revealed} inert={!revealed}>
        {children}
      </span>
    </span>
  );
}

const notebookComponents: Components = {
  span: ({ node, children }) =>
    node?.properties.dataSpoiler ? <SpoilerText>{children}</SpoilerText> : <span>{children}</span>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

export function NoteBody({ body }: { body: string }) {
  return (
    <div className="prose-note">
      <Markdown
        remarkPlugins={[remarkGfm, remarkNotebook]}
        rehypePlugins={[
          [
            rehypeSanitize,
            {
              ...defaultSchema,
              tagNames: [...defaultSchema.tagNames!, 'u'],
              attributes: { ...defaultSchema.attributes, span: ['dataSpoiler'] },
            },
          ],
        ]}
        skipHtml
        components={notebookComponents}
      >
        {body}
      </Markdown>
    </div>
  );
}
