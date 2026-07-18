import { useCallback, useEffect, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { native } from "@/lib/native";
import {
  getWslHome,
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
} from "@/modules/workspace";

async function resolveEnvHome(env: WorkspaceEnv): Promise<string> {
  return env.kind === "wsl"
    ? getWslHome(env.distro)
    : (await homeDir()).replace(/\\/g, "/");
}

type Params = {
  workspaceEnv: WorkspaceEnv;
  setWorkspaceEnv: (env: WorkspaceEnv) => void;
};

export function useWorkspaceSwitcher({
  workspaceEnv,
  setWorkspaceEnv,
}: Params) {
  const [home, setHome] = useState<string | null>(null);
  const [launchCwd, setLaunchCwd] = useState<string | null>(null);
  const [launchCwdResolved, setLaunchCwdResolved] = useState(false);

  useEffect(() => {
    homeDir()
      .then(async (path) => {
        const normalized = path.replace(/\\/g, "/");
        setHome(normalized);
        await native.workspaceAuthorize(normalized).catch(() => {});
      })
      .catch(() => setHome(null));
  }, []);

  useEffect(() => {
    native
      .workspaceCurrentDir()
      .then(setLaunchCwd)
      .catch(() => setLaunchCwd(null))
      .finally(() => setLaunchCwdResolved(true));
  }, []);

  const authorizeHome = useCallback(async (nextHome: string) => {
    setHome(nextHome);
    try {
      await native.workspaceAuthorize(nextHome);
    } catch {
      return;
    }
  }, []);

  const switchWorkspace = useCallback(
    async (env: WorkspaceEnv): Promise<boolean> => {
      if (
        env.kind === workspaceEnv.kind &&
        (env.kind === "local" ||
          (workspaceEnv.kind === "wsl" && env.distro === workspaceEnv.distro))
      ) {
        return false;
      }
      try {
        const nextHome = await resolveEnvHome(env);
        setWorkspaceEnv(env.kind === "local" ? LOCAL_WORKSPACE : env);
        await authorizeHome(nextHome);
        return true;
      } catch (error) {
        window.alert(String(error));
        return false;
      }
    },
    [workspaceEnv, setWorkspaceEnv, authorizeHome],
  );

  const adoptWorkspaceEnv = useCallback(
    async (env: WorkspaceEnv): Promise<string | null> => {
      setWorkspaceEnv(env.kind === "local" ? LOCAL_WORKSPACE : env);
      try {
        const nextHome = await resolveEnvHome(env);
        await authorizeHome(nextHome);
        return nextHome;
      } catch {
        return null;
      }
    },
    [setWorkspaceEnv, authorizeHome],
  );

  return {
    home,
    launchCwd,
    launchCwdResolved,
    switchWorkspace,
    adoptWorkspaceEnv,
  };
}
