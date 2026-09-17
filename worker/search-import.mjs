import { all, first, run, required, safeUrl, text, now, HttpError, withLock } from './common.mjs';
import { ingest, createSource } from './data.mjs';
import { searchMatches } from './search.mjs';
import { validateTranslationUnits } from './ai.mjs';
import { validateMonetaryTranslation } from './evidence.mjs';

// Called by the authenticated Codex importer after opening and verifying sources.
export async function importSearch(env, input) {
  const watchlist = await required(env.DB, 'watchlists', input.watchlistId);
  if (!watchlist.enabled) throw new HttpError(409, '关注主题已停用');
  if (!Array.isArray(input.articles) || input.articles.length > 30) throw new HttpError(400, '每批最多导入 30 篇新闻');
  const keys = await all(env.DB, 'SELECT * FROM keywords WHERE watchlist_id=? AND enabled=1', watchlist.id);
  if (!keys.length) throw new HttpError(400, '请先启用关注关键词');
  return withLock(env, 'search-import', async () => {
    const result = { saved:0, duplicates:0, rejected:0, articles:[], errors:[] };
    const domains = new Map();
    for (const [index, item] of input.articles.entries()) {
      try {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, '新闻记录无效');
        const url = safeUrl(item.url), site = safeUrl(new URL(url).origin);
        const title = text(item.title, '标题', 2000), description = text(item.description, '摘要', 3000);
        if (!['EN','ZH_CN'].includes(item.language)) throw new HttpError(400, '仅接收中文和英文新闻');
        if (!item.publishedAt || !Number.isFinite(+new Date(item.publishedAt)) || +new Date(item.publishedAt)>Date.now()+86400000) throw new HttpError(400, '请核实新闻发布日期');
        const matched = keys.filter(k=>searchMatches({title,description}, k.keyword));
        if (!matched.length) throw new HttpError(400, '未匹配当前关注关键词');
        let translation=null;
        if (item.language==='EN' && item.translation) {
          const translatedTitle=text(item.translation.title,'中文标题',2000), translatedDescription=text(item.translation.description,'中文摘要',3000);
          for(const [original,translated] of [[title,translatedTitle],[description,translatedDescription]]) {
            if(!/[\u3400-\u9fff]/u.test(translated))throw new HttpError(400,'译文须为中文');
            validateTranslationUnits(original,translated);
            validateMonetaryTranslation(original,translated);
          }
          translation={version:'codex-v1',language:'ZH_CN',title:translatedTitle,description:translatedDescription,content:null};
        }
        const existing=await first(env.DB,'SELECT id FROM articles WHERE url=?',url);
        if(existing) {
          for(const key of matched)await run(env.DB,'INSERT OR IGNORE INTO article_keyword_matches VALUES(?,?)',existing.id,key.id);
          result.duplicates++;result.articles.push({id:existing.id,url,saved:false});continue;
        }
        const domain=new URL(site).hostname.replace(/^www\./,'');
        if((domains.get(domain)||0)>=3)throw new HttpError(400,'同一媒体每批最多新增 3 篇');
        let source=await first(env.DB,'SELECT * FROM sources WHERE url=?',site);
        if(!source) {
          const created=await createSource(env.DB,{name:text(item.sourceName,'媒体名称'),url:site,type:'WEBSITE',priority:'MEDIUM',language:item.language,contentEnrichmentEnabled:true});
          source=await required(env.DB,'sources',created.id);
        }
        if(!source.enabled || source.language!==item.language)throw new HttpError(400,'来源已停用或语言不一致');
        const stored=await ingest(env.DB,{sourceId:source.id,title,description,url,publishedAt:item.publishedAt});
        for(const key of matched)await run(env.DB,'INSERT OR IGNORE INTO article_keyword_matches VALUES(?,?)',stored.row.id,key.id);
        if(translation && stored.saved)await run(env.DB,'UPDATE articles SET translation=? WHERE id=?',JSON.stringify(translation),stored.row.id);
        result[stored.saved?'saved':'duplicates']++;domains.set(domain,(domains.get(domain)||0)+1);
        result.articles.push({id:stored.row.id,url,saved:stored.saved});
      } catch(e) {
        if(!(e instanceof HttpError) && !/translation|unit|amount|金额|单位/i.test(e.message))throw e;
        result.rejected++;result.errors.push({index,message:e instanceof HttpError?e.message:'译文数字或单位校验失败'});
      }
    }
    await run(env.DB,'INSERT INTO search_import_runs(imported_at,summary) VALUES(?,?)',now(),JSON.stringify(result));
    await run(env.DB,'DELETE FROM search_import_runs WHERE imported_at<?',new Date(Date.now()-90*86400000).toISOString());
    return result;
  });
}
