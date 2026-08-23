export function DecidePage() {
  return (
    <section className="placeholder-page">
      <h1>选书决策</h1>
      <p className="placeholder-lede">
        从模糊的「想读」，到可解释的「读 / 不读」。
      </p>
      <div className="placeholder-card">
        <p>本页面将在 Phase 3 实现，规划中的流程：</p>
        <ol>
          <li>一句话目标解析，含糊时追问一轮（可点选项，不问开放问题）</li>
          <li>候选圈定：搜索 + 相似书 + 粗筛，5 本里圈 3 本</li>
          <li>决策卡：结论 / 内容匹配 / 阅读成本 / 评论分歧 / 个人关联 / 替代方案</li>
          <li>三个动作：现在读（跳微信读书）· 放入待读 · 排除，全部落档</li>
        </ol>
      </div>
    </section>
  );
}
