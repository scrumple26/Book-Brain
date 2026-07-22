"use client";

import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { capabilitiesFor, clientPremiumUids, type AiCapability } from "./capabilities";

/**
 * Capabilities for the signed-in user, for deciding what UI to render.
 *
 * This is cosmetic. It hides features the user can't use; it does not protect
 * spend. Anyone can edit the bundle and reveal the Book Brain tab — they will
 * still get a 403 from every route, because the server runs the same function
 * against a server-only env var. Never move a spend decision into this hook.
 */
export function useCapabilities(): Set<AiCapability> {
  const { user } = useAuth();
  return useMemo(() => capabilitiesFor(user?.uid, clientPremiumUids()), [user?.uid]);
}
