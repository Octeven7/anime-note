import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoteBody } from './Markdown';
describe('笔记安全渲染', () => {
  it('剧透在原文行内覆盖，不拆段落、不折叠，默认对辅助阅读隐藏', () => {
    const html = renderToStaticMarkup(<NoteBody body={'**加粗** <u>下划线</u> ||结局||'} />);
    expect(html).toContain('<strong>加粗</strong>');
    expect(html).toContain('<u>下划线</u>');
    expect(html).toContain('spoiler-inline covered');
    expect(html).toContain('aria-label="显示剧透文字"');
    expect(html).toContain('aria-hidden="true" inert="">结局');
    expect(html).not.toContain('<details');
    expect(html.match(/<p>/g)).toHaveLength(1);
  });
  it('遮罩跨空行时每段保持遮挡，后文保持可见', () => {
    const html = renderToStaticMarkup(<NoteBody body={'前文 ||第一段\n\n第二段|| 后文'} />);
    expect(html.match(/spoiler-inline covered/g)).toHaveLength(2);
    expect(html).toContain('inert="">第二段</span></span> 后文');
  });
  it('保留单次换行、空行和遮罩内的格式', () => {
    const html = renderToStaticMarkup(
      <NoteBody body={'第一行\n第二行\n\n前文 ||**结局**\n下一行|| 后文'} />,
    );
    expect(html).toContain('第一行<br/>\n第二行');
    expect(html).toContain('<strong>结局</strong><br/>\n下一行');
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(html).toContain('spoiler-inline covered');
  });
  it('不执行原始 HTML 和不安全链接', () => {
    const html = renderToStaticMarkup(
      <NoteBody body={'<script>alert(1)</script>\n\n[链接](javascript:alert(1))'} />,
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
  });
});
