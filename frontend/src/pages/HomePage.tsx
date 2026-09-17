import { ArticleFeed } from '../features/articles/ArticleFeed'

export function HomePage() {
  return (
    <main className="page-shell">
      <section className="feed-page" aria-labelledby="latest-news-heading">
        <header className="feed-page__heading">
          <span className="page-eyebrow">CARYA NEWS</span>
          <h1 id="latest-news-heading">最新资讯</h1>
          <p>汇集公开新闻网站的中英文储能资讯，按关键词发现新闻，保留媒体来源、原文和中文译文。</p>
        </header>
        <ArticleFeed />
      </section>
    </main>
  )
}
