import { all, withLock } from './common.mjs';
import { postProcess } from './providers.mjs';

export async function translatePending(env) {
  return withLock(env, 'translation-queue', async () => {
    const metadata = await all(env.DB, `SELECT a.id FROM articles a JOIN sources s ON s.id=a.source_id WHERE s.language='EN' AND (coalesce(json_extract(a.translation,'$.version'),'') NOT IN ('qwen-storage-v2','codex-v1') OR json_extract(a.translation,'$.title') IS NULL OR (a.description IS NOT NULL AND json_extract(a.translation,'$.description') IS NULL)) ORDER BY coalesce(a.translation_attempted_at,'') ASC,coalesce(a.published_at,a.collected_at) DESC LIMIT 12`);
    const result = { selected: 0, succeeded: 0, failed: 0, extracted: 0, extractionFailed: 0 };
    for (const a of metadata) {
      const status = await withLock(env, `article:${a.id}`, () => postProcess(env, a.id, { metadata:true, extract:false, contentTranslation:false }));
      result.selected++;
      result[status.metadataTranslationStatus === 'SUCCESS' ? 'succeeded' : 'failed']++;
    }
    // Extraction is independent of AI quota; retry unavailable publishers at most daily.
    const missing = await all(env.DB, "SELECT a.id FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.content IS NULL AND s.content_enrichment_enabled=1 AND (a.extraction_attempted_at IS NULL OR a.extraction_attempted_at<?) ORDER BY coalesce(a.extraction_attempted_at,'') ASC,a.id DESC LIMIT 6", new Date(Date.now()-86400000).toISOString());
    for (const a of missing) {
      const status = await withLock(env, `article:${a.id}`, () => postProcess(env, a.id, { metadata:false, extract:true, contentTranslation:false }));
      result[status.contentExtractionStatus === 'SUCCESS' ? 'extracted' : 'extractionFailed']++;
    }
    const bodies = await all(env.DB, `SELECT a.id FROM articles a JOIN sources s ON s.id=a.source_id WHERE s.language='EN' AND a.content IS NOT NULL AND json_extract(a.translation,'$.content') IS NULL ORDER BY coalesce(a.translation_attempted_at,'') ASC,coalesce(a.published_at,a.collected_at) DESC LIMIT 3`);
    for (const a of bodies) {
      const status = await withLock(env, `article:${a.id}`, () => postProcess(env, a.id, { metadata:false, extract:false, contentTranslation:true }));
      result.selected++;
      result[status.contentTranslationStatus === 'SUCCESS' ? 'succeeded' : 'failed']++;
    }
    return result;
  });
}
