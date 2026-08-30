'use client';

import type { ProductIntelligenceRecord } from '@/core/intelligence';

interface ProductInsightBarProps {
  assetCount: number;
  selectedCount: number;
  record: ProductIntelligenceRecord | null;
  loading: boolean;
  analyzing: boolean;
  error: string | null;
  fresh: boolean;
  hasUnanalyzedAssets: boolean;
  aiConfigured: boolean;
  onAnalyze(): void;
}

export function ProductInsightBar(props: ProductInsightBarProps) {
  const {
    assetCount,
    selectedCount,
    record,
    loading,
    analyzing,
    error,
    fresh,
    hasUnanalyzedAssets,
    aiConfigured,
    onAnalyze,
  } = props;

  if (assetCount === 0) {
    return (
      <section className="insight-bar insight-empty">
        上传商品图后可分析商品并获得展示方案参考；不分析也可以直接使用 AI 推荐方案。
      </section>
    );
  }
  if (loading) return <section className="insight-bar">正在读取商品分析…</section>;
  if (analyzing) {
    return <section className="insight-bar is-working">正在理解商品与策划展示方案… 切换任务或商品不会中断。</section>;
  }

  return (
    <section className="insight-bar">
      {record ? (
        <div className="insight-summary">
          <div>
            <div className="insight-heading">
              <strong>{record.analysis.category}</strong>
              <span>已分析 {record.assetSnapshot.length} 张素材</span>
            </div>
            <p>{record.analysis.visualSummary}</p>
            <div className="fact-chips">
              {record.analysis.visibleFacts.slice(0, 3).map((fact) => (
                <span key={fact.text}>{fact.text}</span>
              ))}
            </div>
            {!fresh ? (
              <div className="insight-warning">
                上次分析使用的素材已变化，建议重新分析以更新商品理解。
              </div>
            ) : hasUnanalyzedAssets ? (
              <div className="insight-note">有新素材未参与上次分析，可按当前选择重新分析。</div>
            ) : null}
          </div>
          <button
            type="button"
            className="btn"
            disabled={selectedCount === 0 || !aiConfigured}
            onClick={onAnalyze}
          >
            重新分析当前选择
          </button>
        </div>
      ) : (
        <div className="insight-summary">
          <div>
            <strong>AI 尚未分析商品</strong>
            <p>分析商品可获得更贴合的展示方案参考；不分析也可以直接使用 AI 推荐方案。</p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selectedCount === 0 || !aiConfigured}
            onClick={onAnalyze}
          >
            分析已选商品图
          </button>
        </div>
      )}
      {error ? <div className="status-error insight-error">{error}</div> : null}
      {!aiConfigured ? <div className="insight-warning">请先在 AI 设置中选择商品分析配置</div> : null}
    </section>
  );
}
