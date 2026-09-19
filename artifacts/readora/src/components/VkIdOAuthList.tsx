import { useEffect, useRef, useState } from "react";

interface VkOAuthConfig {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

interface VkLoginPayload {
  code?: string;
  state?: string;
  device_id?: string;
}

export function VkIdOAuthList() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initialize(): Promise<void> {
      try {
        const configResponse = await fetch("/api/auth/vk/config", {
          credentials: "include",
        });
        const configData = (await configResponse.json().catch(() => null)) as VkOAuthConfig | { error?: string } | null;
        if (!configResponse.ok) {
          throw new Error((configData as { error?: string } | null)?.error ?? "Не удалось загрузить вход через VK ID");
        }
        if (cancelled || !containerRef.current) return;

        const VKID = await import("@vkid/sdk");
        if (cancelled || !containerRef.current) return;

        VKID.Config.init({
          app: Number((configData as VkOAuthConfig).clientId),
          redirectUrl: (configData as VkOAuthConfig).redirectUri,
          responseMode: VKID.ConfigResponseMode.Callback,
          state: (configData as VkOAuthConfig).state,
          codeChallenge: (configData as VkOAuthConfig).codeChallenge,
          scope: "email vkid.personal_info",
        });

        const oauthList = new VKID.OAuthList();
        oauthList
          .render({
            container: containerRef.current,
            oauthList: [VKID.OAuthName.VK, VKID.OAuthName.MAIL, VKID.OAuthName.OK],
            scheme: VKID.Scheme.LIGHT,
            lang: VKID.Languages.RUS,
            styles: { height: 44, borderRadius: 8 },
          })
          .on(VKID.WidgetEvents.ERROR, () => {
            if (!cancelled) setError("Не удалось открыть вход через VK ID");
          })
          .on(VKID.OAuthListInternalEvents.LOGIN_SUCCESS, (payload: VkLoginPayload) => {
            if (!payload.code || !payload.device_id) {
              setError("VK ID вернул неполные данные авторизации");
              return;
            }

            const state = payload.state ?? (configData as VkOAuthConfig).state;
            const params = new URLSearchParams({
              code: payload.code,
              device_id: payload.device_id,
              state,
            });
            window.location.assign(`/api/auth/vk/callback?${params.toString()}`);
          });
      } catch (initializationError) {
        if (!cancelled) {
          setError(initializationError instanceof Error ? initializationError.message : "Не удалось загрузить вход через VK ID");
        }
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      containerRef.current?.replaceChildren();
    };
  }, []);

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="min-h-11 w-full" />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
