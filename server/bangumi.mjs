export class UpstreamError extends Error {
  status = 502;
  constructor(message, upstreamStatus = null) {
    super(message);
    this.upstreamStatus = upstreamStatus;
  }
}
export class BangumiClient {
  constructor({
    baseUrl = 'https://api.bgm.tv',
    fetchImpl = fetch,
    userAgent = process.env.BANGUMI_USER_AGENT || 'paper-screen/0.1.0 (personal-development)',
    token = process.env.BANGUMI_TOKEN,
    intervalMs = 1100,
  } = {}) {
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
    this.ua = userAgent;
    this.token = token;
    this.intervalMs = intervalMs;
    this.queue = Promise.resolve();
    this.last = 0;
  }
  request(path, { method = 'GET', body } = {}) {
    const work = this.queue.then(async () => {
      const delay = Math.max(0, this.intervalMs - (Date.now() - this.last));
      if (delay) await new Promise((r) => setTimeout(r, delay));
      this.last = Date.now();
      try {
        const headers = { 'User-Agent': this.ua, Accept: 'application/json' };
        if (this.token) headers.Authorization = `Bearer ${this.token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await this.fetch(`${this.baseUrl}${path}`, {
          method,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          headers,
          signal: AbortSignal.timeout(15000),
          redirect: 'error',
        });
        if (!response.ok)
          throw new UpstreamError(`Bangumi 请求失败（${response.status}）`, response.status);
        return await response.json();
      } catch (e) {
        if (e instanceof UpstreamError) throw e;
        throw new UpstreamError('无法连接 Bangumi，请稍后重试');
      }
    });
    this.queue = work.catch(() => {});
    return work;
  }
  calendar() {
    return this.request('/calendar');
  }
  searchTag(tag, offset = 0) {
    return this.request(`/v0/search/subjects?limit=100&offset=${offset}`, {
      method: 'POST',
      body: { keyword: '', sort: 'rank', filter: { type: [2], nsfw: false, tag: [tag] } },
    });
  }
  async subjectBundle(id) {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid Bangumi ID');
    const subject = await this.request(`/v0/subjects/${id}`);
    if (subject.type !== 2) throw new UpstreamError('只支持动画条目', 422);
    if (subject.nsfw) throw new UpstreamError('当前版本不导入 R18 详情', 403);
    const episodes = [];
    let offset = 0;
    while (true) {
      const result = await this.request(`/v0/episodes?subject_id=${id}&limit=100&offset=${offset}`);
      if (!Array.isArray(result.data)) throw new UpstreamError('Bangumi 章节格式不符合预期');
      episodes.push(...result.data);
      offset += result.data.length;
      if (!result.data.length || offset >= result.total) break;
      if (offset > 10000) throw new UpstreamError('章节数量超出导入上限');
    }
    const characters = await this.request(`/v0/subjects/${id}/characters`);
    const persons = await this.request(`/v0/subjects/${id}/persons`);
    if (!Array.isArray(characters) || !Array.isArray(persons))
      throw new UpstreamError('Bangumi 关联资料格式不符合预期');
    return { subject, episodes, characters, persons };
  }
}
