import { useUsageStore } from "@/modules/usage";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

const PROVIDERS: { id: string; name: string; paste: boolean }[] = [
  { id: "codex", name: "Codex", paste: false },
  { id: "claude", name: "Claude", paste: true },
];

export function AccountsSection() {
  const { login, loginStart, loginFinish, logout } = useUsageStore();
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [code, setCode] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const refreshConnected = async () => {
    const entries = await Promise.all(
      PROVIDERS.map(
        async (p) =>
          [
            p.id,
            await invoke<boolean>("usage_connected", { provider: p.id }),
          ] as const,
      ),
    );
    setConnected(Object.fromEntries(entries));
  };
  useEffect(() => {
    void refreshConnected();
  }, []);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Usage accounts"
        description="Sign in to show coding-agent usage in the status bar."
      />
      {PROVIDERS.map((p) => (
        <div key={p.id} className="rounded-lg border border-border/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">{p.name}</span>
            <span className="text-xs text-muted-foreground">
              {connected[p.id] ? "Connected" : "Not connected"}
            </span>
          </div>
          {connected[p.id] ? (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={async () => {
                await logout(p.id);
                await refreshConnected();
              }}
            >
              Disconnect
            </button>
          ) : p.paste ? (
            <div className="space-y-2">
              <button
                type="button"
                className="text-sm text-primary"
                disabled={busy === p.id}
                onClick={() => void loginStart(p.id)}
              >
                Open sign-in page
              </button>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded border border-border/60 bg-transparent px-2 py-1 text-sm"
                  placeholder="Paste the code from the browser"
                  value={code[p.id] ?? ""}
                  onChange={(e) =>
                    setCode((c) => ({ ...c, [p.id]: e.target.value }))
                  }
                />
                <button
                  type="button"
                  className="text-sm text-primary"
                  onClick={async () => {
                    setBusy(p.id);
                    await loginFinish(p.id, code[p.id] ?? "");
                    setBusy(null);
                    await refreshConnected();
                  }}
                >
                  Finish
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="text-sm text-primary"
              disabled={busy === p.id}
              onClick={async () => {
                setBusy(p.id);
                await login(p.id);
                setBusy(null);
                await refreshConnected();
              }}
            >
              {busy === p.id ? "Waiting for browser…" : "Connect"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
