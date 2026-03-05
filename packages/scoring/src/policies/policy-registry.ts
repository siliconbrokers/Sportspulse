import type { PolicyDefinition, PolicyIdentity } from './policy-identity.js';
import { MVP_POLICY } from './policy-identity.js';

const POLICIES: readonly PolicyDefinition[] = [MVP_POLICY];

export function getPolicy(identity: PolicyIdentity): PolicyDefinition | undefined {
  return POLICIES.find(
    p => p.policyKey === identity.policyKey && p.policyVersion === identity.policyVersion
  );
}

export function getDefaultPolicy(): PolicyDefinition {
  return MVP_POLICY;
}
