"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearCachedProfile,
  createClient,
  getBrowserAuthState,
  getCachedProfile,
  getCachedProfileCredits,
  setCachedProfileCredits,
} from "@/lib/supabase/client";

export function useStudioAuth() {
  const supabase = useMemo(() => createClient(), []);
  const requestSeqRef = useRef(0);
  const userIdRef = useRef<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [credits, setCreditsState] = useState<number | null>(null);

  const setAnonymousState = useCallback(() => {
    userIdRef.current = null;
    setIsAuthenticated(false);
    setAuthChecked(true);
    setUserId(null);
    setCreditsState(null);
  }, []);

  const applyAuthenticatedUser = useCallback(async (user: { id: string }, nextCredits?: number | null) => {
    userIdRef.current = user.id;
    setIsAuthenticated(true);
    setAuthChecked(true);
    setUserId(user.id);

    if (typeof nextCredits === "number") {
      setCreditsState(nextCredits);
      setCachedProfileCredits(user.id, nextCredits);
      return;
    }

    const creditsFromCache = await getCachedProfileCredits(user.id);
    if (userIdRef.current === user.id) setCreditsState(creditsFromCache);
  }, []);

  const refreshAuth = useCallback(async () => {
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;

    const applyIfCurrent = async (fn: () => void | Promise<void>) => {
      if (requestSeqRef.current !== seq) return false;
      await fn();
      return true;
    };

    const browserState = await getBrowserAuthState();
    if (browserState.status === "authenticated") {
      await applyIfCurrent(() => applyAuthenticatedUser(browserState.user));
      return true;
    }

    try {
      const profile = await getCachedProfile();
      if (profile?.user?.id) {
        await applyIfCurrent(() => applyAuthenticatedUser({ id: profile.user!.id! }, profile.credits));
        return true;
      }
    } catch {
      // The browser state below distinguishes an outage from real logout.
    }

    if (browserState.status === "unavailable") {
      await applyIfCurrent(() => setAuthChecked(true));
      return userIdRef.current !== null;
    }

    await applyIfCurrent(setAnonymousState);
    return false;
  }, [applyAuthenticatedUser, setAnonymousState]);

  const setCredits = useCallback((nextCredits: number | null) => {
    setCreditsState(nextCredits);
    if (userId && typeof nextCredits === "number") setCachedProfileCredits(userId, nextCredits);
  }, [userId]);

  const refreshCredits = useCallback(async () => {
    const currentUserId = userIdRef.current;
    if (!currentUserId) return null;
    try {
      const profile = await getCachedProfile({ force: true });
      if (profile?.user?.id !== currentUserId || typeof profile.credits !== "number") return null;
      setCreditsState(profile.credits);
      setCachedProfileCredits(currentUserId, profile.credits);
      return profile.credits;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void refreshAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === "SIGNED_OUT") {
        clearCachedProfile();
        void refreshAuth();
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void refreshAuth();
      }
    });

    return () => {
      cancelled = true;
      requestSeqRef.current += 1;
      subscription.unsubscribe();
    };
  }, [refreshAuth, supabase]);

  return {
    authChecked,
    isAuthenticated,
    userId,
    credits,
    setCredits,
    refreshCredits,
    refreshAuth,
  };
}
