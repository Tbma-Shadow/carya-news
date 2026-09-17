import { ArticleFeed } from '../features/articles/ArticleFeed'

export function HomePage() {
  return (
    <main className="page-shell">
      <section className="feed-page" aria-labelledby="latest-news-heading">
        <header className="feed-page__heading">
          <span className="page-eyebrow">CARYA NEWS</span>
          <h1 id="latest-news-heading">最新资讯</h1>
          <p>查看储能行业动态，按来源与关键词筛选，阅读原文和中文译文。</p>
        </header>
        <ArticleFeed />
      </section>
    </main>
  )
}
