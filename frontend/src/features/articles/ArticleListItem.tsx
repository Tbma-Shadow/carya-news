import { Link } from 'react-router-dom'
import type { ArticleResponse } from '../../types/articles'
import { formatArticleDate } from './formatArticleDate'

interface ArticleListItemProps {
  article: ArticleResponse
}

export function ArticleListItem({ article }: ArticleListItemProps) {
  const translatedTitle = article.translation?.title?.trim() || null
  const translatedDescription = article.translation?.description?.trim() || null
  const originalDescription = article.original.description?.trim() || null
  const usesTranslation = article.original.language === 'EN' && translatedTitle !== null
  const primaryTitle = translatedTitle ?? article.original.title
  const primaryDescription = usesTranslation ? translatedDescription : originalDescription
  const showEnglishTitle =
    usesTranslation &&
    article.original.language === 'EN' &&
    article.original.title.trim() !== primaryTitle
  const timestamp = article.publishedAt ?? article.collectedAt
  const primaryLanguage =
    usesTranslation || article.original.language === 'ZH_CN' ? 'zh-CN' : 'en'

  return (
    <li className="article-list-item">
      <article>
        <div className="article-list-item__metadata">
          <span>{article.source.name}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={timestamp}>{formatArticleDate(timestamp)}</time>
        </div>

        <h2 className="article-list-item__title" lang={primaryLanguage}>
          <Link to={`/articles/${article.id}`}>{primaryTitle}</Link>
        </h2>

        {article.tags.length > 0 && (
          <ul className="article-list-item__tags" aria-label="匹配关键词">
            {article.tags.map((tag) => <li key={tag}>{tag}</li>)}
          </ul>
        )}

        {primaryDescription && (
          <p className="article-list-item__description" lang={primaryLanguage}>
            {primaryDescription}
          </p>
        )}

        {showEnglishTitle && (
          <p className="article-list-item__original-title" lang="en">
            {article.original.title}
          </p>
        )}
        {article.original.language === 'EN' && <p className="article-list-item__translation-status">{usesTranslation ? '机器翻译 · 可对照原文' : '中文译文待更新，系统会自动补译'}</p>}

        <a
          className="article-list-item__external-link"
          href={article.url}
          target="_blank"
          rel="noreferrer"
        >
          查看原文 ↗
        </a>
      </article>
    </li>
  )
}
