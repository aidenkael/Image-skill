'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AIProfileInputSchema,
  PROVIDER_PRESET_LABELS,
  profileDefaults,
  type AIConnectionCapability,
  type AIProfileInput,
  type AIProfilePreset,
  type AIProfilePublic,
  type AISettingsPublic,
  type ActiveAIProfilesInput,
  type ImageBatchMode,
  type ImagePromptEnhancement,
  type ImageSizeMode,
  type StructuredOutputMode,
} from '@/core/system';

export interface AISettingsActions {
  createProfile(input: AIProfileInput): Promise<AISettingsPublic>;
  updateProfile(id: string, input: AIProfileInput): Promise<AISettingsPublic>;
  deleteProfile(id: string): Promise<AISettingsPublic>;
  setActiveProfiles(input: ActiveAIProfilesInput): Promise<AISettingsPublic>;
  testProfile(id: string, capability: AIConnectionCapability): Promise<{ ok: true; message: string }>;
}

interface Props extends AISettingsActions {
  open: boolean;
  settings: AISettingsPublic | null;
  loading: boolean;
  onClose(): void;
}

type Draft = AIProfileInput & { apiKey: string };

function newDraft(preset: AIProfilePreset = 'aliyun-qwen'): Draft {
  const defaults = profileDefaults(preset);
  return {
    name: preset === 'aliyun-qwen' ? '百炼配置' : preset === 'volcengine-ark' ? 'Seedream 配置' : '自定义配置',
    preset,
    apiKey: '',
    vision: { ...defaults.vision },
    image: { ...defaults.image },
  };
}

function profileDraft(profile: AIProfilePublic): Draft {
  return {
    name: profile.name,
    preset: profile.preset,
    apiKey: '',
    vision: { ...profile.vision },
    image: { ...profile.image },
  };
}

export function AISettingsDialog(props: Props) {
  const { open, settings, loading, onClose } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => newDraft());
  const [isNew, setIsNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !settings) return;
    const current = settings.profiles.find((profile) => profile.id === selectedId) ?? settings.profiles[0];
    if (current) {
      setSelectedId(current.id);
      setDraft(profileDraft(current));
      setIsNew(false);
    } else {
      setSelectedId(null);
      setDraft(newDraft());
      setIsNew(true);
    }
    setConfirmDelete(false);
    setMessage(null);
    setError(null);
    // Dialog initialization intentionally follows open/settings identity, not local selection edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const validationError = useMemo(() => {
    const parsed = AIProfileInputSchema.safeParse({
      ...draft,
      apiKey: draft.apiKey.trim() || undefined,
    });
    if (isNew && draft.apiKey.trim().length < 8) return '新建配置时必须填写至少 8 个字符的 API Key';
    return parsed.success ? null : parsed.error.issues[0]?.message ?? '请检查配置内容';
  }, [draft, isNew]);

  if (!open) return null;
  const selectedProfile = settings?.profiles.find((profile) => profile.id === selectedId) ?? null;

  function selectProfile(profile: AIProfilePublic) {
    setSelectedId(profile.id);
    setDraft(profileDraft(profile));
    setIsNew(false);
    setConfirmDelete(false);
    setMessage(null);
    setError(null);
  }

  function startNew() {
    setSelectedId(null);
    setDraft(newDraft());
    setIsNew(true);
    setConfirmDelete(false);
    setMessage(null);
    setError(null);
  }

  function changePreset(preset: AIProfilePreset) {
    const defaults = profileDefaults(preset);
    setDraft((current) => ({
      ...current,
      preset,
      vision: { ...defaults.vision },
      image: { ...defaults.image },
    }));
  }

  async function run<T>(action: () => Promise<T>, success: string): Promise<T | null> {
    setBusy(true); setMessage(null); setError(null);
    try {
      const result = await action();
      setMessage(success);
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally { setBusy(false); }
  }

  async function save() {
    if (validationError) return;
    const input: AIProfileInput = { ...draft, apiKey: draft.apiKey.trim() || undefined };
    if (isNew) {
      const next = await run(() => props.createProfile(input), '配置已创建并立即生效');
      const created = next?.profiles.at(-1);
      if (created) {
        selectProfile(created);
        setMessage('配置已创建并立即生效');
      }
    } else if (selectedId) {
      const next = await run(() => props.updateProfile(selectedId, input), '配置已保存并立即生效');
      const updated = next?.profiles.find((profile) => profile.id === selectedId);
      if (updated) {
        selectProfile(updated);
        setMessage('配置已保存并立即生效');
      }
    }
  }

  async function remove() {
    if (!selectedId) return;
    const deletingId = selectedId;
    const next = await run(() => props.deleteProfile(deletingId), '配置已删除');
    if (!next) return;
    const replacement = next.profiles[0];
    if (replacement) selectProfile(replacement); else startNew();
    setMessage('配置已删除');
  }

  async function setActive(capability: AIConnectionCapability, value: string) {
    if (!settings) return;
    await run(() => props.setActiveProfiles({
      visionProfileId: capability === 'vision' ? value || null : settings.activeVisionProfileId,
      imageProfileId: capability === 'image' ? value || null : settings.activeImageProfileId,
    }), capability === 'vision' ? '商品分析配置已切换' : '氛围主图配置已切换');
  }

  async function test(capability: AIConnectionCapability) {
    if (!selectedId) return;
    await run(() => props.testProfile(selectedId, capability), capability === 'vision' ? '商品分析连接成功' : '氛围主图连接成功');
  }

  const visionProfiles = settings?.profiles.filter((profile) => profile.vision.enabled) ?? [];
  const imageProfiles = settings?.profiles.filter((profile) => profile.image.enabled) ?? [];

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-dialog settings-center" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
        <div className="dialog-title"><div><h2 id="ai-settings-title">AI 设置</h2><p>分别管理商品分析与氛围主图使用的 API。</p></div><button type="button" className="dialog-close" onClick={onClose}>关闭</button></div>

        <div className="active-profile-selectors">
          <label>商品分析使用<select value={settings?.activeVisionProfileId ?? ''} disabled={busy || loading} onChange={(event) => void setActive('vision', event.target.value)}><option value="">未选择</option>{visionProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
          <label>氛围主图使用<select value={settings?.activeImageProfileId ?? ''} disabled={busy || loading} onChange={(event) => void setActive('image', event.target.value)}><option value="">未选择</option>{imageProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        </div>

        <div className="settings-center-body">
          <aside className="profile-list">
            <button type="button" className="btn profile-new" onClick={startNew}>＋ 新建配置</button>
            {settings?.profiles.map((profile) => (
              <button key={profile.id} type="button" className={`profile-row${profile.id === selectedId && !isNew ? ' is-active' : ''}`} onClick={() => selectProfile(profile)}>
                <strong>{profile.name}</strong><span>{PROVIDER_PRESET_LABELS[profile.preset]}</span><small>{profile.vision.enabled ? '识图 ' : ''}{profile.image.enabled ? '生图' : ''}</small>
              </button>
            ))}
            {settings?.profiles.length === 0 ? <p className="hint">尚无已保存配置</p> : null}
          </aside>

          <div className="profile-editor">
            <div className="profile-editor-heading"><strong>{isNew ? '新建配置' : '编辑配置'}</strong>{!isNew ? <button type="button" className="danger-link" onClick={() => setConfirmDelete(true)}>删除</button> : null}</div>
            {confirmDelete ? <div className="delete-confirm"><span>确定删除"{selectedProfile?.name}"吗？</span><button type="button" className="btn danger-button" disabled={busy} onClick={() => void remove()}>确认删除</button><button type="button" className="btn" onClick={() => setConfirmDelete(false)}>取消</button></div> : null}
            <div className="profile-fields">
              <label className="field">配置名称<input className="input" maxLength={60} value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} /></label>
              <label className="field">提供商预设<select className="input" value={draft.preset} onChange={(event) => changePreset(event.target.value as AIProfilePreset)}>{Object.entries(PROVIDER_PRESET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="field">API Key<input className="input" type="password" autoComplete="new-password" value={draft.apiKey} onChange={(event) => setDraft((value) => ({ ...value, apiKey: event.target.value }))} placeholder={isNew ? '必填，仅保存在服务端' : `${selectedProfile?.maskedKey ?? ''}（留空保持不变）`} /></label>
            </div>

            <VisionCapabilityEditor
              enabled={draft.vision.enabled}
              onEnabled={(enabled) => setDraft((value) => ({ ...value, vision: { ...value.vision, enabled } }))}
              driver={draft.vision.driver}
              endpoint={draft.vision.endpoint}
              model={draft.vision.model}
              compatibility={draft.vision.compatibility}
              onDriver={(driver) => setDraft((value) => ({ ...value, vision: { ...value.vision, driver: driver as 'openai-compatible-vision' } }))}
              onEndpoint={(endpoint) => setDraft((value) => ({ ...value, vision: { ...value.vision, endpoint } }))}
              onModel={(model) => setDraft((value) => ({ ...value, vision: { ...value.vision, model } }))}
              onCompatibility={(patch) => setDraft((value) => ({ ...value, vision: { ...value.vision, compatibility: { ...value.vision.compatibility, ...patch } } }))}
              onTest={() => void test('vision')}
              canTest={!isNew && draft.vision.enabled && !busy}
            />
            <ImageCapabilityEditor
              enabled={draft.image.enabled}
              onEnabled={(enabled) => setDraft((value) => ({ ...value, image: { ...value.image, enabled } }))}
              driver={draft.image.driver}
              endpoint={draft.image.endpoint}
              model={draft.image.model}
              compatibility={draft.image.compatibility}
              onDriver={(driver) => setDraft((value) => ({ ...value, image: { ...value.image, driver: driver as Draft['image']['driver'] } }))}
              onEndpoint={(endpoint) => setDraft((value) => ({ ...value, image: { ...value.image, endpoint } }))}
              onModel={(model) => setDraft((value) => ({ ...value, image: { ...value.image, model } }))}
              onCompatibility={(patch) => setDraft((value) => ({ ...value, image: { ...value.image, compatibility: { ...value.image.compatibility, ...patch } } }))}
              onTest={() => void test('image')}
              canTest={!isNew && draft.image.enabled && !busy}
            />

            {validationError ? <div className="validation-hint">{validationError}</div> : null}
            <div className="dialog-actions"><button type="button" className="btn btn-primary" disabled={busy || Boolean(validationError)} onClick={() => void save()}>{busy ? '处理中…' : '保存配置'}</button></div>
            {message ? <div className="status-notice">{message}</div> : null}
            {error ? <div className="status-error">{error}</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ── Vision capability editor ── */

function VisionCapabilityEditor(props: {
  enabled: boolean; onEnabled(value: boolean): void;
  driver: string; endpoint: string; model: string;
  compatibility: Draft['vision']['compatibility'];
  onDriver(value: string): void; onEndpoint(value: string): void; onModel(value: string): void;
  onCompatibility(patch: Partial<Draft['vision']['compatibility']>): void;
  onTest(): void; canTest: boolean;
}) {
  const [advanced, setAdvanced] = useState(false);
  return (
    <fieldset className="capability-editor">
      <legend>商品分析</legend>
      <label className="capability-toggle"><input type="checkbox" checked={props.enabled} onChange={(event) => props.onEnabled(event.target.checked)} />启用</label>
      <label className="field">协议<select className="input" value={props.driver} onChange={(event) => props.onDriver(event.target.value)}><option value="openai-compatible-vision">OpenAI 兼容识图</option></select></label>
      <label className="field">接口地址<input className="input" value={props.endpoint} onChange={(event) => props.onEndpoint(event.target.value)} /></label>
      <label className="field">模型<input className="input" maxLength={120} value={props.model} onChange={(event) => props.onModel(event.target.value)} /></label>
      <button type="button" className="btn test-button" disabled={!props.canTest} onClick={props.onTest}>测试连接</button>
      <details open={advanced} onToggle={(event) => setAdvanced((event.target as HTMLDetailsElement).open)}>
        <summary className="advanced-toggle">高级兼容设置</summary>
        <label className="field">结构化输出
          <select className="input" value={props.compatibility.structuredOutput} onChange={(event) => props.onCompatibility({ structuredOutput: event.target.value as StructuredOutputMode })}>
            <option value="auto">自动（推荐）</option>
            <option value="json-schema">JSON Schema</option>
            <option value="json-object">JSON Object</option>
            <option value="text-json">纯 JSON 文本</option>
          </select>
        </label>
        <label className="capability-toggle"><input type="checkbox" checked={props.compatibility.imageInput} onChange={(event) => props.onCompatibility({ imageInput: event.target.checked })} />支持图片输入</label>
      </details>
    </fieldset>
  );
}

/* ── Image capability editor ── */

function ImageCapabilityEditor(props: {
  enabled: boolean; onEnabled(value: boolean): void;
  driver: string; endpoint: string; model: string;
  compatibility: Draft['image']['compatibility'];
  onDriver(value: string): void; onEndpoint(value: string): void; onModel(value: string): void;
  onCompatibility(patch: Partial<Draft['image']['compatibility']>): void;
  onTest(): void; canTest: boolean;
}) {
  const [advanced, setAdvanced] = useState(false);
  const isArk = props.driver === 'volcengine-ark-image';
  return (
    <fieldset className="capability-editor">
      <legend>氛围主图</legend>
      <label className="capability-toggle"><input type="checkbox" checked={props.enabled} onChange={(event) => props.onEnabled(event.target.checked)} />启用</label>
      <label className="field">协议<select className="input" value={props.driver} onChange={(event) => props.onDriver(event.target.value)}><option value="dashscope-image">百炼图片</option><option value="volcengine-ark-image">火山方舟图片</option></select></label>
      <label className="field">接口地址<input className="input" value={props.endpoint} onChange={(event) => props.onEndpoint(event.target.value)} /></label>
      <label className="field">模型<input className="input" maxLength={120} value={props.model} onChange={(event) => props.onModel(event.target.value)} /></label>
      <button type="button" className="btn test-button" disabled={!props.canTest} onClick={props.onTest}>测试连接</button>
      <details open={advanced} onToggle={(event) => setAdvanced((event.target as HTMLDetailsElement).open)}>
        <summary className="advanced-toggle">高级兼容设置</summary>
        <label className="capability-toggle"><input type="checkbox" checked={props.compatibility.referenceImage} onChange={(event) => props.onCompatibility({ referenceImage: event.target.checked })} />参考图输入</label>
        <label className="field">批量生成
          <select className="input" value={isArk && props.compatibility.batchMode === 'native' ? 'single' : props.compatibility.batchMode} onChange={(event) => props.onCompatibility({ batchMode: event.target.value as ImageBatchMode })}>
            <option value="auto">自动</option>
            <option value="single">单张循环</option>
            <option value="native" disabled={isArk}>原生批量{isArk ? '（当前协议不支持）' : ''}</option>
          </select>
        </label>
        <label className="field">尺寸控制
          <select className="input" value={props.compatibility.sizeMode} onChange={(event) => props.onCompatibility({ sizeMode: event.target.value as ImageSizeMode })}>
            <option value="mapped">预设映射</option>
            <option value="provider-default">服务端默认</option>
          </select>
        </label>
        {props.compatibility.sizeMode === 'mapped' && (
          <>
            <label className="field field-compact">1:1 尺寸<input className="input input-compact" value={props.compatibility.sizeByRatio['1:1'] ?? ''} onChange={(event) => props.onCompatibility({ sizeByRatio: { ...props.compatibility.sizeByRatio, '1:1': event.target.value || undefined } })} /></label>
            <label className="field field-compact">3:4 尺寸<input className="input input-compact" value={props.compatibility.sizeByRatio['3:4'] ?? ''} onChange={(event) => props.onCompatibility({ sizeByRatio: { ...props.compatibility.sizeByRatio, '3:4': event.target.value || undefined } })} /></label>
            <label className="field field-compact">4:3 尺寸<input className="input input-compact" value={props.compatibility.sizeByRatio['4:3'] ?? ''} onChange={(event) => props.onCompatibility({ sizeByRatio: { ...props.compatibility.sizeByRatio, '4:3': event.target.value || undefined } })} /></label>
          </>
        )}
        <label className="field">提示词扩写
          <select className="input" value={isArk && props.compatibility.promptEnhancement === 'on' ? 'off' : props.compatibility.promptEnhancement} onChange={(event) => props.onCompatibility({ promptEnhancement: event.target.value as ImagePromptEnhancement })}>
            <option value="auto">自动</option>
            <option value="off">关</option>
            <option value="on" disabled={isArk}>开{isArk ? '（当前协议不支持）' : ''}</option>
          </select>
        </label>
      </details>
    </fieldset>
  );
}
