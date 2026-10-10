// Identify explicitly named news roundups, not arbitrary numbered tutorials.
export function isRoundup(article:{title:string;content:string}) {
  return /早报|晚报|新闻汇总|资讯汇总|每日科技简报/.test(article.title)&&
    (article.content.match(/(?:^|\n)\s*\d{1,2}[.、．]\s*/g)||[]).length>=3;
}
