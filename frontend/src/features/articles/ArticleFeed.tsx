import { WebSearchStatus } from './WebSearchStatus'
import { useEffect, useState } from 'react'
import { getArticles } from '../../api/articles'
import { getWatchlists } from '../../api/watchlists'
import type { ArticlePageResponse } from '../../types/articles'
import type { WatchlistResponse } from '../../types/watchlists'
import { ArticleListItem } from './ArticleListItem'
import { FeedToolbar } from './FeedToolbar'
import { PaginationControls } from './PaginationControls'
import { ScheduleInfo } from '../system/ScheduleInfo'

const PAGE_SIZE = 20

type LoadStatus = 'loading' | 'success' | 'error'

export function ArticleFeed() {
  const [page, setPage] = useState(0)
  const [keywordInput, setKeywordInput] = useState('')
  const [submittedKeyword, setSubmittedKeyword] = useState('')
  const [selectedKeywordId, setSelectedKeywordId] = useState<number | null>(null)
  const [articlePage, setArticlePage] = useState<ArticlePageResponse | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [watchlists, setWatchlists] = useState<WatchlistResponse[]>([])
  const [keywordsLoading, setKeywordsLoading] = useState(true)
  const [keywordsError, setKeywordsError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    getWatchlists(controller.signal)
      .then((response) => {
        setWatchlists(
          response
            .filter((watchlist) => watchlist.enabled)
            .map((watchlist) => ({
              ...watchlist,
              keywords: watchlist.keywords.filter((keyword) => keyword.enabled),
            }))
            .filter((watchlist) => watchlist.keywords.length > 0),
        )
        setKeywordsError(false)
        setKeywordsLoading(false)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setKeywordsError(true)
        setKeywordsLoading(false)
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    setArticlePage(null)

    getArticles(
      {
        page,
        size: PAGE_SIZE,
        keywordId: selectedKeywordId ?? undefined,
        keyword: submittedKeyword || undefined,
      },
      controller.signal,
    )
      .then((response) => {
        setArticlePage(response)
        setStatus('success')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setStatus('error')
      })

    return () => controller.abort()
  }, [page, selectedKeywordId, submittedKeyword])

  const submitSearch = () => {
    setPage(0)
    setSubmittedKeyword(keywordInput.trim())
  }

  const changeKeyword = (keywordId: number | null) => {
    setPage(0)
    setSelectedKeywordId(keywordId)
  }

  return (
    <section className="article-feed" aria-label="资讯列表">
      <FeedToolbar
        keywordInput={keywordInput}
        onKeywordInputChange={setKeywordInput}
        onSearch={submitSearch}
        watchlists={watchlists}
        selectedKeywordId={selectedKeywordId}
        onKeywordChange={changeKeyword}
        keywordsLoading={keywordsLoading}
        keywordsError={keywordsError}
      />
      <WebSearchStatus />


      <div className="article-feed__results" aria-live="polite" aria-busy={status === 'loading'}>
        {status === 'loading' && <p className="status-message">正在加载资讯…</p>}

        {status === 'error' && (
          <p className="status-message status-message--error">资讯加载失败，请稍后重试。</p>
        )}

        {status === 'success' && articlePage?.content.length === 0 && (
          <p className="status-message">没有找到符合条件的资讯。</p>
        )}

        {status === 'success' && articlePage && articlePage.content.length > 0 && (
          <>
            <ul className="article-feed__list">
              {articlePage.content.map((article) => (
                <ArticleListItem article={article} key={article.id} />
              ))}
            </ul>
            <PaginationControls
              page={articlePage.page}
              totalPages={articlePage.totalPages}
              first={articlePage.first}
              last={articlePage.last}
              onPrevious={() => setPage((currentPage) => Math.max(0, currentPage - 1))}
              onNext={() => setPage((currentPage) => currentPage + 1)}
            />
          </>
        )}
      </div>
    </section>
  )
}
