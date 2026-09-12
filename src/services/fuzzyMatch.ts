/**
 * 顺序模糊匹配：查询字符按顺序出现即命中。
 * 连续命中给更高分，用于在命令面板里把"开头匹配"排到前面。
 * 返回 null 表示未命中。
 */
export const fuzzyScore = (query: string, target: string): number | null => {
  if (!query) return 0;
  const haystack = target.toLowerCase();
  const needle = query.toLowerCase();
  let cursor = 0;
  let score = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return null;
    score += found === cursor ? 2 : 1;
    cursor = found + 1;
  }
  return score;
};
