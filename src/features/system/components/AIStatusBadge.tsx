'use client';

export function AIStatusBadge({ aiConfigured }: { aiConfigured: boolean | null }) {
  if (aiConfigured === null) return <span className="ai-status">AI 状态读取中</span>;
  return (
    <span
      className={`ai-status ${aiConfigured ? 'is-ready' : 'is-missing'}`}
      title={
        aiConfigured
          ? 'AI 能力已配置'
          : '在项目 .env 中配置 DASHSCOPE_API_KEY 后重新启动工作台。'
      }
    >
      {aiConfigured ? 'AI 已配置' : 'AI 未配置'}
    </span>
  );
}
