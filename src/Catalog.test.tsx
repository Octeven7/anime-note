import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SubjectGrid } from './Catalog';
import type { Subject } from './types';

it('追番列表仅在看和搁置展示集数，其余状态保留名称和个人评分', () => {
  for (const status of ['wish', 'doing', 'done', 'hold', 'dropped']) {
    const html = renderToStaticMarkup(
      <SubjectGrid
        items={[
          {
            id: 'test',
            bangumi_id: 1,
            name: '测试',
            name_cn: '',
            score: 8,
            air_date: null,
            image_url: null,
            rating_count: 10,
            status,
            watched: 3,
            myScore: 9,
          } as Subject,
        ]}
      />,
    );
    expect(html.includes('已看 3 集')).toBe(status === 'doing' || status === 'hold');
    expect(html).toContain('我的评分 9');
  }
});
