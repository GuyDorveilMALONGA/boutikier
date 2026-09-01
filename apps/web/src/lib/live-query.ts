import { useEffect, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

export const visibleLiveQuery = {
  refetchInterval: () => document.visibilityState === "visible" && navigator.onLine ? 3_000 : false,
  refetchIntervalInBackground: false,
  refetchOnReconnect: "always" as const,
  refetchOnWindowFocus: "always" as const,
};

export function useRefreshOnResume(keys: QueryKey[]) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      for (const queryKey of keys) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [keys, queryClient]);
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);
  return online;
}

