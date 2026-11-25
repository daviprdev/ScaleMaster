const IG_SCOPES =
  "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_insights";

// Com configId = Login Unificado (Facebook Login for Business): as permissões vêm da configuração.
export function montarUrlOAuth(opts: {
  clientId: string;
  configId?: string | null;
  redirectUri: string;
  state: string;
}): string {
  if (opts.configId) {
    return (
      "https://www.facebook.com/dialog/oauth?" +
      new URLSearchParams({
        client_id: opts.clientId,
        config_id: opts.configId,
        redirect_uri: opts.redirectUri,
        response_type: "code",
        // decisão: prompt=login como no exemplo da Meta — sempre mostra as opções Facebook e Instagram.
        prompt: "login",
        state: opts.state,
      }).toString()
    );
  }
  return (
    "https://www.instagram.com/oauth/authorize" +
    "?client_id=" + opts.clientId +
    "&redirect_uri=" + encodeURIComponent(opts.redirectUri) +
    "&scope=" + IG_SCOPES +
    "&response_type=code" +
    "&state=" + opts.state
  );
}
