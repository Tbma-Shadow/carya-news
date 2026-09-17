# 新闻抓取与周报

核对日期：2026-09-17。生产域名：https://news.caryaenergy.com 。

## 来源与时间

当前启用 pv magazine 的 https://www.pv-magazine.com/feed/ 和 Canary Media 的 https://www.canarymedia.com/rss.rss 。两者都是英文 RSS。Brave 与 GNews 的代码仍保留，但生产环境使用 RSS，没有全网搜索。

| 北京时间 | 行为 |
| --- | --- |
| 每天 08:00 | 按启用的关注关键词检索昨天至今天的 RSS 内容，每个关键词最多 20 条；此前为 5 条 |
| 每天 20:00 | 同步每个 RSS 源的最近 100 条，按储能相关性筛选后入库 |
| 每小时第 20 分钟 | 补译尚未完成的标题、摘要和正文 |
| 每周一 08:10 | 生成上一周周一至周日的中文总结；不再生成日报 |
| 每周一 09:10、10:10 | 重试未完成的周报；成功的周报不重复生成 |

## 筛选和去重

早间检索按关注关键词对英文标题和摘要做不区分大小写的子串匹配，不搜索正文，也不是语义检索。当前关键词为 energy storage、battery storage、BESS。

晚间同步使用两组固定储能词：命中一个强相关短语，或至少三个弱相关短语，才保存文章。强相关短语包括 energy storage、battery storage、BESS、grid-scale battery、home battery、flow battery 等；弱相关词包括 battery、lfp、lithium-ion、virtual power plant、vpp、pcs、grid-forming 等。具体词表在 worker/providers.mjs。

保存前统一 HTTPS 链接，去除片段和常见跟踪参数，以规范化后的 URL 去重。不同媒体报道同一事件仍保存为多篇新闻，周报可以合并讨论并列出各自来源。

入库后提取正文，优先翻译标题和摘要，正文由补译任务继续处理。翻译结果按原文片段缓存，避免重复调用。新增和修改关键词会补匹配已有文章，不必等 RSS 再次出现相同链接。

## 已知范围

- RSS 只提供各媒体当前公开的条目，早间日期筛选不能找回已经离开 RSS 的历史文章。
- 关键词匹配可能漏掉同义词，也可能误收仅在摘要中顺带提到储能的文章。
- 正文提取可能被媒体拒绝，或包含少量页面附带文字。提取失败时仍保留标题、摘要和原文链接。
- 机器翻译保留英文对照，并检查金额及功率、容量单位；这不等于人工审校。
- 周报按新闻发布时间统计，缺少发布时间时使用收录时间；最多选择 40 篇与当前关注关键词匹配的文章。
- 本次检查开始时共 13 篇新闻，均有正文、均无中文译文，job_runs 中尚无执行记录。该记录只描述检查时状态，不代表定时任务永久失效。

实现位置：worker/providers.mjs 负责来源抓取、筛选和提取；worker/data.mjs 负责入库、去重和关键词关联；worker/ai.mjs 负责翻译与额度；worker/weekly.mjs 负责周报；worker/index.mjs 负责定时调度。
