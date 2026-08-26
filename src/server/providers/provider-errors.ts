export class ProviderConfigError extends Error {}

export class ProviderRequestError extends Error {}

export function providerHttpError(status: number): ProviderRequestError {
  if (status === 401 || status === 403) {
    return new ProviderRequestError(
      'AI Key 无效、区域不匹配或当前模型未授权，请检查 AI 设置与模型权限。',
    );
  }
  if (status === 429) {
    return new ProviderRequestError('AI 服务当前限流或账户额度受限，请稍后重试并检查额度。');
  }
  if (status >= 500) {
    return new ProviderRequestError('AI 服务暂时不可用，请稍后重试。');
  }
  return new ProviderRequestError('AI 服务请求失败，请检查 AI 设置后重试。');
}

export function providerFetchError(error: unknown): ProviderRequestError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new ProviderRequestError('AI 服务响应超时，请稍后重试。');
  }
  return new ProviderRequestError('无法连接 AI 服务，请检查网络后重试。');
}

export function invalidProviderResponse(): ProviderRequestError {
  return new ProviderRequestError('AI 返回结果无法解析，请重新尝试。');
}
