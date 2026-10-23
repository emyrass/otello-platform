import type { AppState } from "./types.ts";

/** Removes signing keys, endpoint URLs, and credential secrets before a response is sent. */
export function toPublicState(state: AppState): AppState {
  return {
    ...state,
    keystore: {},
    resources: state.resources.map((resource) => {
      const next = { ...resource, endpointConfigured: Boolean(resource.endpointUrl) };
      delete next.endpointUrl;
      return next;
    }),
    leases: state.leases.map((lease) => {
      if (!lease.credential) return lease;
      return {
        ...lease,
        credential: { ...lease.credential, secret: "" },
      };
    }),
  };
}
