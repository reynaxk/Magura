/** RSS news — 5 sources, parsed without dependencies. */
export const NEWS_SOURCES = [
  { id: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { id: 'cointelegraph', url: 'https://cointelegraph.com/rss' },
  { id: 'decrypt', url: 'https://decrypt.co/feed' },
  { id: 'theblock', url: 'https://www.theblock.co/rss.xml' },
  { id: 'blockworks', url: 'https://blockworks.co/feed' },
];

export interface NewsEntry {
  source: string;
  title: string;
  url: string;
  publishedAt: Date;
}

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim() : '';
};

export async function fetchNews(sources = NEWS_SOURCES): Promise<NewsEntry[]> {
  const all = await Promise.allSettled(
    sources.map(async (s) => {
      const res = await fetch(s.url, { headers: { 'user-agent': 'MaguraBot/1.0' } });
      const xml = await res.text();
      return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].slice(0, 20).map((m) => ({
        source: s.id,
        title: tag(m[0], 'title'),
        url: tag(m[0], 'link'),
        publishedAt: new Date(tag(m[0], 'pubDate') || Date.now()),
      }));
    }),
  );
  return all
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((n) => n.title && n.url)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}
