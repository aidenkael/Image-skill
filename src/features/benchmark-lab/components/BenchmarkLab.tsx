'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  BenchmarkLane,
  BenchmarkRunRecord,
  BenchmarkRunSummary,
  BenchmarkScenario,
} from '@/core/benchmark-lab';
import type { AISettingsPublic } from '@/core/system';
import {
  ALL_BENCHMARK_LANES,
  ALL_BENCHMARK_SCENARIOS,
  BENCHMARK_LANE_LABELS,
  BENCHMARK_SCENARIO_LABELS,
  executeBenchmark,
  fetchAISettings,
  planReferencePackPreview,
  type BenchmarkReferencePackPreview,
} from '@/features/benchmark-lab/model/benchmark-lab';

/**
 * Benchmark Lab：内部 R&D 界面。
 * 输入面板 + Reference Pack 预览 + 结果矩阵 + 聚合摘要；不改动正式工作台。
 */

/** lane → 驱动目标（与 server/benchmark-lab/lanes.ts 预设一致；features 不得 import server，故此处维护展示用映射） */
const LANE_DRIVER_TARGETS: Record<BenchmarkLane, 'dashscope-image' | 'volcengine-ark-image'> = {
  'qwen-single-extend-on': 'dashscope-image',
  'qwen-single-extend-off': 'dashscope-image',
  'qwen-multi-ref': 'dashscope-image',
  'seedream-multi-ref': 'volcengine-ark-image',
  'wan-multi-ref': 'dashscope-image',
};

const styles = {
  page: { maxWidth: 1280, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#1f2937' } as const,
  panel: { border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 16, background: '#fff' } as const,
  h1: { fontSize: 20, fontWeight: 700, marginBottom: 4 } as const,
  h2: { fontSize: 15, fontWeight: 700, margin: '0 0 10px' } as const,
  label: { fontSize: 13, color: '#4b5563', display: 'block', marginBottom: 6 } as const,
  row: { display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' } as const,
  check: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, marginRight: 12, marginBottom: 6 } as const,
  select: { fontSize: 13, padding: '4px 8px', minWidth: 200 } as const,
  button: { fontSize: 14, padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#2563eb', color: '#fff' } as const,
  ghostButton: { fontSize: 13, padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' } as const,
  error: { color: '#b91c1c', fontSize: 13, marginTop: 8 } as const,
  thumb: { width: 96, height: 96, objectFit: 'cover', borderRadius: 4, border: '2px solid transparent', display: 'block' } as const,
  badge: (pass: boolean) => ({
    fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
    background: pass ? '#dcfce7' : '#fee2e2', color: pass ? '#166534' : '#991b1b',
  }) as const,
  table: { borderCollapse: 'collapse', width: '100%' } as const,
  cell: { border: '1px solid #e5e7eb', padding: 8, verticalAlign: 'top', fontSize: 12 } as const,
};

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
}

export function BenchmarkLab() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [ratio, setRatio] = useState<'1:1' | '3:4' | '4:3'>('3:4');
  const [scenarios, setScenarios] = useState<BenchmarkScenario[]>([...ALL_BENCHMARK_SCENARIOS]);
  const [lanes, setLanes] = useState<BenchmarkLane[]>([...ALL_BENCHMARK_LANES]);
  const [settings, setSettings] = useState<AISettingsPublic | null>(null);
  const [visionProfileId, setVisionProfileId] = useState<string | null>(null);
  const [dashscopeProfileId, setDashscopeProfileId] = useState<string>('');
  const [arkProfileId, setArkProfileId] = useState<string>('');
  const [preview, setPreview] = useState<BenchmarkReferencePackPreview | null>(null);
  const [summary, setSummary] = useState<BenchmarkRunSummary | null>(null);
  const [busy, setBusy] = useState<'idle' | 'preview' | 'run'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAISettings()
      .then((result) => {
        setSettings(result);
        setVisionProfileId(result.activeVisionProfileId);
        const dashscope = result.profiles.find(
          (profile) => profile.image.enabled
            && profile.image.driver === 'dashscope-image'
            && profile.id === result.activeImageProfileId,
        ) ?? result.profiles.find((profile) => profile.image.enabled && profile.image.driver === 'dashscope-image');
        const ark = result.profiles.find((profile) => profile.image.enabled && profile.image.driver === 'volcengine-ark-image');
        setDashscopeProfileId(dashscope?.id ?? '');
        setArkProfileId(ark?.id ?? '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : '读取 AI 设置失败'));
  }, []);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const visionProfiles = useMemo(
    () => settings?.profiles.filter((profile) => profile.vision.enabled) ?? [],
    [settings],
  );
  const dashscopeProfiles = useMemo(
    () => settings?.profiles.filter((profile) => profile.image.enabled && profile.image.driver === 'dashscope-image') ?? [],
    [settings],
  );
  const arkProfiles = useMemo(
    () => settings?.profiles.filter((profile) => profile.image.enabled && profile.image.driver === 'volcengine-ark-image') ?? [],
    [settings],
  );

  const laneProfileIds = useMemo(() => {
    const mapping: Partial<Record<BenchmarkLane, string>> = {};
    for (const lane of lanes) {
      const profileId = LANE_DRIVER_TARGETS[lane] === 'dashscope-image' ? dashscopeProfileId : arkProfileId;
      if (profileId) mapping[lane] = profileId;
    }
    return mapping;
  }, [lanes, dashscopeProfileId, arkProfileId]);

  function handleFileChange(next: File | null) {
    setFile(next);
    setPreviewUrl(next ? URL.createObjectURL(next) : null);
    setPreview(null);
    setSummary(null);
  }

  async function handlePreview() {
    if (!file) { setError('请先选择源商品图'); return; }
    setBusy('preview');
    setError(null);
    try {
      const result = await planReferencePackPreview(file, visionProfileId);
      setPreview(result.referencePack);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reference Pack 规划失败');
    } finally {
      setBusy('idle');
    }
  }

  async function handleRun() {
    if (!file) { setError('请先选择源商品图'); return; }
    if (scenarios.length === 0 || lanes.length === 0) { setError('请至少选择一个场景与一条路线'); return; }
    setBusy('run');
    setError(null);
    try {
      const result = await executeBenchmark(file, {
        scenarios,
        lanes,
        ratio,
        ...(note.trim() ? { note: note.trim() } : {}),
        visionProfileId,
        laneProfileIds,
      });
      setSummary(result);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Benchmark 运行失败');
    } finally {
      setBusy('idle');
    }
  }

  const pack = summary?.referencePack ?? preview;

  return (
    <div style={styles.page}>
      <div style={styles.h1}>Benchmark Lab · 商品一致性实验台</div>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
        内部 R&D：同一商品 × 同一场景，对比多条执行路线的保真表现。
        <a href="/" style={{ marginLeft: 8 }}>返回工作台</a>
      </p>

      {/* 输入面板 */}
      <section style={styles.panel}>
        <div style={styles.h2}>输入</div>
        <div style={styles.row}>
          <div>
            <span style={styles.label}>源商品图</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
            />
            {previewUrl ? (
              <img src={previewUrl} alt="源商品图" style={{ ...styles.thumb, marginTop: 8, width: 120, height: 120 }} />
            ) : null}
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <span style={styles.label}>创作备注（可选，软性方向）</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              style={{ width: '100%', fontSize: 13 }}
              maxLength={500}
            />
            <span style={styles.label}>输出比例</span>
            <select value={ratio} onChange={(event) => setRatio(event.target.value as typeof ratio)} style={styles.select}>
              <option value="3:4">3:4</option>
              <option value="1:1">1:1</option>
              <option value="4:3">4:3</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <span style={styles.label}>场景（默认全选）</span>
          {ALL_BENCHMARK_SCENARIOS.map((scenario) => (
            <label key={scenario} style={styles.check}>
              <input
                type="checkbox"
                checked={scenarios.includes(scenario)}
                onChange={() => setScenarios((current) => toggle(current, scenario))}
              />
              {BENCHMARK_SCENARIO_LABELS[scenario]}
            </label>
          ))}
        </div>

        <div style={{ marginTop: 8 }}>
          <span style={styles.label}>执行路线（默认全选）</span>
          {ALL_BENCHMARK_LANES.map((lane) => (
            <label key={lane} style={styles.check}>
              <input
                type="checkbox"
                checked={lanes.includes(lane)}
                onChange={() => setLanes((current) => toggle(current, lane))}
              />
              {BENCHMARK_LANE_LABELS[lane]}
            </label>
          ))}
        </div>

        <div style={{ ...styles.row, marginTop: 12 }}>
          <div>
            <span style={styles.label}>Vision 配置（参考包规划 + 判定）</span>
            <select
              value={visionProfileId ?? ''}
              onChange={(event) => setVisionProfileId(event.target.value || null)}
              style={styles.select}
            >
              {visionProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </div>
          <div>
            <span style={styles.label}>DashScope / Wan 路线生图配置</span>
            <select
              value={dashscopeProfileId}
              onChange={(event) => setDashscopeProfileId(event.target.value)}
              style={styles.select}
            >
              <option value="">（未选择，按活动配置）</option>
              {dashscopeProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}（{profile.image.model}）</option>
              ))}
            </select>
          </div>
          <div>
            <span style={styles.label}>方舟 Seedream 路线生图配置</span>
            <select
              value={arkProfileId}
              onChange={(event) => setArkProfileId(event.target.value)}
              style={styles.select}
            >
              <option value="">（未选择，按活动配置）</option>
              {arkProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}（{profile.image.model}）</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button style={styles.button} onClick={handleRun} disabled={busy !== 'idle'}>
            {busy === 'run' ? '运行中（可能耗时较长）…' : '运行 Benchmark'}
          </button>
          <button style={styles.ghostButton} onClick={handlePreview} disabled={busy !== 'idle'}>
            {busy === 'preview' ? '规划中…' : '仅预览 Reference Pack'}
          </button>
        </div>
        {error ? <div style={styles.error}>{error}</div> : null}
      </section>

      {/* Reference Pack 预览 */}
      {pack ? (
        <section style={styles.panel}>
          <div style={styles.h2}>Reference Pack（1 张完整源图 + 自动细节裁剪）</div>
          <div style={{ fontSize: 13, marginBottom: 10 }}>{pack.summary}</div>
          <div style={styles.row}>
            <div style={{ textAlign: 'center' }}>
              <img src={pack.sourceUrl} alt="完整源图" style={{ ...styles.thumb, width: 120, height: 120 }} />
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>完整源图</div>
            </div>
            {pack.crops.map((crop) => (
              <div key={crop.key} style={{ textAlign: 'center' }}>
                <img src={crop.url} alt={crop.label} style={{ ...styles.thumb, width: 120, height: 120 }} />
                <div style={{ fontSize: 12, marginTop: 4 }}>{crop.label}</div>
                <div style={{ fontSize: 11, color: '#6b7280', maxWidth: 120 }}>{crop.reason}</div>
              </div>
            ))}
            {pack.crops.length === 0 ? <div style={{ fontSize: 13, color: '#6b7280' }}>未识别到高风险细节区域</div> : null}
          </div>
        </section>
      ) : null}

      {/* 结果矩阵 */}
      {summary ? (
        <>
          <section style={styles.panel}>
            <div style={styles.h2}>结果矩阵（行 = 场景，列 = 路线）</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.cell} />
                    {summary.runs.length > 0
                      ? [...new Set(summary.runs.map((run) => run.lane))].map((lane) => (
                        <th key={lane} style={styles.cell}>{BENCHMARK_LANE_LABELS[lane]}</th>
                      ))
                      : null}
                  </tr>
                </thead>
                <tbody>
                  {[...new Set(summary.runs.map((run) => run.scenario))].map((scenario) => (
                    <tr key={scenario}>
                      <td style={{ ...styles.cell, fontWeight: 600 }}>{BENCHMARK_SCENARIO_LABELS[scenario]}</td>
                      {[...new Set(summary.runs.map((run) => run.lane))].map((lane) => (
                        <td key={lane} style={styles.cell}>
                          <RunCell record={summary.runs.find((run) => run.scenario === scenario && run.lane === lane)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 聚合摘要 */}
          <section style={styles.panel}>
            <div style={styles.h2}>聚合摘要</div>
            <div style={{ fontSize: 13, lineHeight: 1.9 }}>
              <div>总通过：{summary.totalPass} / 总失败：{summary.totalFail}</div>
              <div>
                最佳路线（按总通过数）：
                {summary.bestLanes.length > 0
                  ? summary.bestLanes.map((lane) => BENCHMARK_LANE_LABELS[lane]).join('、')
                  : '无路线通过任何候选'}
              </div>
              <div>
                最常见失败原因：
                {summary.topFailureReasons.length > 0
                  ? summary.topFailureReasons.map((item) => `${item.reason}（${item.count}）`).join('、')
                  : '无'}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function RunCell({ record }: { record?: BenchmarkRunRecord }) {
  if (!record) return <span style={{ color: '#9ca3af' }}>未运行</span>;
  if (record.status === 'unavailable' || record.status === 'error') {
    return (
      <div>
        <span style={{ ...styles.badge(false), background: '#f3f4f6', color: '#4b5563' }}>
          {record.status === 'unavailable' ? '不可用' : '执行错误'}
        </span>
        <div style={{ marginTop: 6, color: '#6b7280' }}>{record.statusReason}</div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ marginBottom: 6, fontWeight: 600 }}>
        PASS {record.passCount} / {record.passCount + record.failCount}
        <span style={{ color: '#9ca3af', fontWeight: 400 }}>　FAIL {record.failCount}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {record.candidates.map((candidate) => (
          <div key={candidate.candidateIndex} title={[
            candidate.status === 'pass' ? 'PASS' : `FAIL: ${candidate.hardFailures.join(', ')}`,
            candidate.notes ?? '',
          ].filter(Boolean).join('\n')}>
            <img
              src={candidate.url}
              alt={`候选 ${candidate.candidateIndex + 1}`}
              style={{ ...styles.thumb, borderColor: candidate.status === 'pass' ? '#22c55e' : '#ef4444' }}
            />
            <span style={styles.badge(candidate.status === 'pass')}>
              {candidate.status === 'pass' ? 'PASS' : 'FAIL'}
            </span>
          </div>
        ))}
      </div>
      {Object.keys(record.hardFailureCounts).length > 0 ? (
        <div style={{ marginTop: 6, color: '#b91c1c' }}>
          {Object.entries(record.hardFailureCounts).map(([reason, count]) => `${reason}×${count}`).join('、')}
        </div>
      ) : null}
    </div>
  );
}
