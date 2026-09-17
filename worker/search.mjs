const aliases = {
  'energy storage': ['energy storage', '储能'],
  'battery storage': ['battery storage', '电池储能'],
  bess: ['BESS', '电池储能系统'],
  '储能': ['储能', 'energy storage'],
  '电池储能': ['电池储能', 'battery storage'],
};
export function searchTerms(keyword) {
  return aliases[keyword.trim().toLowerCase()] || [keyword.trim()];
}
export function searchMatches(article, keyword) {
  const value = `${article.title || ''} ${article.description || ''}`.toLowerCase();
  return searchTerms(keyword).some(term => {
    if (term.toLowerCase() === 'bess') return /\bbess\b/i.test(value) && /battery|storage|energy|储能/i.test(value);
    if (/^[a-z ]+$/i.test(term)) return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(value);
    return value.includes(term.toLowerCase());
  });
}
